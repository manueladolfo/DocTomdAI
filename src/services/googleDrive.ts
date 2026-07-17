import type { Conversion } from '../hooks/useConversionHistory';
import type { StoredFile } from '../hooks/useFileStorage';

// Declaración para tipos de Google GIS API
declare global {
  interface Window {
    google: any;
  }
}

// Variables de configuración de la API de Google
// El usuario puede configurar estas variables en su archivo .env o en el panel de Ajustes de la barra lateral.

// Scopes necesarios para acceder a las carpetas de la aplicación creadas en Google Drive
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

/**
 * Inicializa y gestiona la autenticación de OAuth 2.0 Implicit Flow.
 * Retorna una Promesa con el Access Token de Google.
 */
export const authenticateGoogleDrive = (): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
      reject(new Error('Google Identity Services client no cargado. Revisa tu conexión a internet.'));
      return;
    }

    const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || localStorage.getItem('gdrive_client_id') || '').trim();
    if (!clientId) {
      reject(new Error('CLIENT_ID de Google Drive no configurado en Ajustes.'));
      return;
    }

    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: (response: any) => {
          if (response.error) {
            reject(new Error(`Autenticación fallida: ${response.error}`));
          } else if (response.access_token) {
            // Guardar token en localStorage
            localStorage.setItem('gdrive_access_token', response.access_token);
            localStorage.setItem('gdrive_token_expiry', (Date.now() + response.expires_in * 1000).toString());
            resolve(response.access_token);
          } else {
            reject(new Error('No se recibió Access Token de Google.'));
          }
        },
      });

      tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Recupera el Access Token guardado en localStorage si sigue vigente.
 */
export const getCachedAccessToken = (): string | null => {
  const token = localStorage.getItem('gdrive_access_token');
  const expiry = localStorage.getItem('gdrive_token_expiry');
  if (token && expiry && Date.now() < parseInt(expiry, 10)) {
    return token;
  }
  return null;
};

/**
 * Cierra sesión de Google Drive localmente.
 */
export const disconnectGoogleDrive = () => {
  localStorage.removeItem('gdrive_access_token');
  localStorage.removeItem('gdrive_token_expiry');
};

// --- CLIENTE REST API DE GOOGLE DRIVE ---

const fetchGoogleDrive = async (
  endpoint: string,
  token: string,
  options: RequestInit = {}
) => {
  const headers = new Headers(options.headers || {});
  headers.append('Authorization', `Bearer ${token}`);
  
  const response = await fetch(`https://www.googleapis.com/${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Error en Google Drive API (${endpoint}):`, errText);
    throw new Error(`Google Drive API error: ${response.statusText} (${response.status})`);
  }

  return response;
};

/**
 * Busca un archivo o carpeta por nombre y parent opcional.
 */
const findFileOrFolder = async (
  name: string,
  token: string,
  mimeType?: string,
  parentId?: string
): Promise<string | null> => {
  let query = `name = '${name}' and trashed = false`;
  if (mimeType) {
    query += ` and mimeType = '${mimeType}'`;
  }
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  } else {
    query += ` and 'root' in parents`;
  }

  const res = await fetchGoogleDrive(
    `drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
    token
  );
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0].id : null;
};

/**
 * Crea un directorio en Google Drive.
 */
const createFolder = async (
  name: string,
  token: string,
  parentId?: string
): Promise<string> => {
  const body = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentId ? [parentId] : undefined,
  };

  const res = await fetchGoogleDrive('drive/v3/files', token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return data.id;
};

/**
 * Sube o actualiza un archivo en Google Drive.
 */
const uploadOrUpdateFile = async (
  name: string,
  content: string | Blob,
  mimeType: string,
  folderId: string,
  token: string
): Promise<string> => {
  // 1. Comprobar si el archivo ya existe en esta carpeta
  const existingId = await findFileOrFolder(name, token, undefined, folderId);

  if (existingId) {
    // Actualizar contenido
    await fetchGoogleDrive(
      `upload/drive/v3/files/${existingId}?uploadType=media`,
      token,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': mimeType,
        },
        body: content,
      }
    );
    return existingId;
  } else {
    // Crear metadatos del archivo
    const metadataRes = await fetchGoogleDrive('drive/v3/files', token, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType,
        parents: [folderId],
      }),
    });
    const metadata = await metadataRes.json();
    const newId = metadata.id;

    // Subir contenido binario/texto
    await fetchGoogleDrive(
      `upload/drive/v3/files/${newId}?uploadType=media`,
      token,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': mimeType,
        },
        body: content,
      }
    );
    return newId;
  }
};

/**
 * Obtiene el ID del árbol de carpetas DocTomdAI/config y DocTomdAI/docs.
 */
export const getOrSetupFolderTree = async (
  token: string,
  onProgress?: (status: string) => void
): Promise<{ configFolderId: string; docsFolderId: string }> => {
  onProgress?.('Buscando carpeta raíz /DocTomdAI...');
  let rootFolderId = await findFileOrFolder('DocTomdAI', token, 'application/vnd.google-apps.folder');
  if (!rootFolderId) {
    onProgress?.('Creando carpeta raíz /DocTomdAI...');
    rootFolderId = await createFolder('DocTomdAI', token);
  }

  onProgress?.('Verificando carpeta /DocTomdAI/config...');
  let configFolderId = await findFileOrFolder('config', token, 'application/vnd.google-apps.folder', rootFolderId);
  if (!configFolderId) {
    onProgress?.('Creando carpeta /DocTomdAI/config...');
    configFolderId = await createFolder('config', token, rootFolderId);
  }

  onProgress?.('Verificando carpeta /DocTomdAI/docs...');
  let docsFolderId = await findFileOrFolder('docs', token, 'application/vnd.google-apps.folder', rootFolderId);
  if (!docsFolderId) {
    onProgress?.('Creando carpeta /DocTomdAI/docs...');
    docsFolderId = await createFolder('docs', token, rootFolderId);
  }

  return { configFolderId, docsFolderId };
};

/**
 * Descarga el contenido de un archivo como texto.
 */
const downloadFileAsText = async (fileId: string, token: string): Promise<string> => {
  const res = await fetchGoogleDrive(`drive/v3/files/${fileId}?alt=media`, token);
  return await res.text();
};

/**
 * Descarga el contenido de un archivo como Blob binario.
 */
const downloadFileAsBlob = async (fileId: string, token: string): Promise<Blob> => {
  const res = await fetchGoogleDrive(`drive/v3/files/${fileId}?alt=media`, token);
  return await res.blob();
};

// --- FLUJOS PRINCIPALES DE SINCRONIZACIÓN ---

/**
 * Sincroniza desde Local hacia Google Drive (Carga de datos).
 */
export const syncToGoogleDrive = async (
  token: string,
  history: Conversion[],
  files: StoredFile[],
  onProgress?: (status: string) => void
): Promise<void> => {
  onProgress?.('Conectando con Google Drive...');
  const { configFolderId, docsFolderId } = await getOrSetupFolderTree(token, onProgress);

  // 1. Guardar historial de conversiones en config/history.json
  onProgress?.('Subiendo base de datos de historial (history.json)...');
  const historyJson = JSON.stringify(history, null, 2);
  await uploadOrUpdateFile('history.json', historyJson, 'application/json', configFolderId, token);

  // 2. Guardar cada archivo binario original en docs/
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(`Subiendo archivos originales a /docs (${i + 1}/${files.length}): ${file.name}`);
    
    // Subir el blob original
    await uploadOrUpdateFile(file.name, file.blob, file.type, docsFolderId, token);

    // Subir también el Markdown correspondiente con extensión .md para facilitar acceso directo desde Drive
    const relatedConversion = history.find(c => c.id === file.id);
    if (relatedConversion) {
      const mdFileName = file.name.substring(0, file.name.lastIndexOf('.')) + '.md';
      await uploadOrUpdateFile(mdFileName, relatedConversion.texto_md_resultado, 'text/markdown', docsFolderId, token);
    }
  }

  onProgress?.('¡Sincronización completa finalizada!');
};

/**
 * Sincroniza desde Google Drive hacia Local (Descarga/Restauración).
 */
export const syncFromGoogleDrive = async (
  token: string,
  onProgress?: (status: string) => void
): Promise<{ history: Conversion[]; files: StoredFile[] }> => {
  onProgress?.('Conectando con Google Drive...');
  const { configFolderId, docsFolderId } = await getOrSetupFolderTree(token, onProgress);

  // 1. Descargar historial de conversiones
  onProgress?.('Buscando base de datos de historial (history.json)...');
  const historyFileId = await findFileOrFolder('history.json', token, 'application/json', configFolderId);
  
  let history: Conversion[] = [];
  if (historyFileId) {
    onProgress?.('Descargando historial...');
    const historyText = await downloadFileAsText(historyFileId, token);
    history = JSON.parse(historyText);
  } else {
    onProgress?.('No se encontró base de datos previa de historial.');
  }

  // 2. Descargar todos los archivos binarios de la carpeta docs/
  onProgress?.('Buscando archivos originales en /docs...');
  const query = `'${docsFolderId}' in parents and trashed = false`;
  const res = await fetchGoogleDrive(
    `drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType)`,
    token
  );
  const driveFilesList = await res.json();
  const driveFiles = driveFilesList.files || [];

  const files: StoredFile[] = [];

  // Filtrar solo los archivos originales (excluir archivos .md que subimos como espejo)
  const originalFiles = driveFiles.filter((f: any) => !f.name.endsWith('.md'));

  for (let i = 0; i < originalFiles.length; i++) {
    const fileMetadata = originalFiles[i];
    onProgress?.(`Descargando documentos originales (${i + 1}/${originalFiles.length}): ${fileMetadata.name}`);
    
    try {
      const blob = await downloadFileAsBlob(fileMetadata.id, token);
      
      // Buscar la ID en el historial descargado que tenga el mismo nombre de archivo
      const matchingHistory = history.find(c => c.nombre_archivo === fileMetadata.name);
      const fileId = matchingHistory ? matchingHistory.id : crypto.randomUUID();

      files.push({
        id: fileId,
        name: fileMetadata.name,
        blob,
        type: fileMetadata.mimeType,
        uploadedAt: matchingHistory ? matchingHistory.fecha_conversion : new Date().toISOString(),
      });
    } catch (err) {
      console.error(`Error al descargar el archivo ${fileMetadata.name}:`, err);
    }
  }

  onProgress?.('¡Restauración y sincronización finalizada con éxito!');
  return { history, files };
};
