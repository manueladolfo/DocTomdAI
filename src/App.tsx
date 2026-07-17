import { useState, useEffect, useRef } from 'react';
import { 
  FileText, 
  Image as ImageIcon, 
  Upload, 
  History, 
  Settings, 
  LogOut, 
  ZoomIn, 
  ZoomOut, 
  Download, 
  Eye, 
  Code, 
  AlertCircle, 
  CheckCircle,
  Key,
  Globe,
  RefreshCw,
  Loader2,
  Clock,
  HardDrive,
  Plus,
  Home,
  X,
  AlertTriangle,
  Cloud,
  Copy
} from 'lucide-react';
import { useFileStorage, type StoredFile } from './hooks/useFileStorage';
import { useConversionHistory, type Conversion } from './hooks/useConversionHistory';
import { convertDocumentToMarkdown } from './services/api';
import { downloadMarkdown } from './utils/downloadHelper';
import { 
  authenticateGoogleDrive, 
  syncToGoogleDrive, 
  syncFromGoogleDrive, 
  getCachedAccessToken, 
  disconnectGoogleDrive 
} from './services/googleDrive';

interface QueueItem {
  id: string;
  name: string;
  type: string;
  progress: number;
  status: 'pending' | 'processing' | 'success' | 'error';
  errorMsg?: string;
}

export default function App() {
  const fileStorage = useFileStorage();
  const historyStorage = useConversionHistory();

  // Estados de la aplicación
  const [viewState, setViewState] = useState<'dashboard' | 'import' | 'workspace'>('dashboard');
  const [currentFile, setCurrentFile] = useState<StoredFile | null>(null);
  const [convertedMarkdown, setConvertedMarkdown] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('code');
  const [isConverting, setIsConverting] = useState(false);
  const [historyList, setHistoryList] = useState<Conversion[]>([]);
  const [filesList, setFilesList] = useState<StoredFile[]>([]);
  const [geminiApiKey, setGeminiApiKey] = useState<string>((localStorage.getItem('gemini_api_key') || import.meta.env.VITE_GEMINI_API_KEY || '').trim());
  const [googleClientId, setGoogleClientId] = useState<string>((localStorage.getItem('gdrive_client_id') || import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  // Estado de zoom para el visor
  const [zoomLevel, setZoomLevel] = useState(100);
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  // Estados de Google Drive y sincronización
  const [gdriveToken, setGdriveToken] = useState<string | null>(getCachedAccessToken());
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Estado del panel de Ajustes
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Cola de procesamiento por lotes
  const [uploadQueue, setUploadQueue] = useState<QueueItem[]>([]);

  // Adaptabilidad Mobile
  const [isMobile, setIsMobile] = useState(false);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<'visor' | 'markdown'>('visor');

  // Estados para visualizar Markdown flotante premium
  const [selectedMarkdownText, setSelectedMarkdownText] = useState<string | null>(null);
  const [selectedMarkdownFileName, setSelectedMarkdownFileName] = useState<string>('');
  const [isCopied, setIsCopied] = useState(false);

  // Referencia para procesar transparencia y recorte del logotipo
  const [logoSrc, setLogoSrc] = useState('/logo.png');

  // Referencias para arrastrar y soltar
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Algoritmo dinámico para remover el fondo sólido gris (#1A1E1F) y recortar márgenes vacíos del logotipo
  useEffect(() => {
    const img = new Image();
    img.src = '/logo.png';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        
        let minX = canvas.width;
        let minY = canvas.height;
        let maxX = 0;
        let maxY = 0;
        let hasForeground = false;

        // 1. Encontrar el recuadro delimitador real del logo y hacer transparente el fondo gris (#1A1E1F)
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const idx = (y * canvas.width + x) * 4;
            const r = data[idx];
            const g = data[idx+1];
            const b = data[idx+2];
            
            // Tolerancia de color para el fondo oscuro #1A1E1F
            const isBg = r >= 20 && r <= 35 && g >= 20 && g <= 35 && b >= 20 && b <= 35;
            
            if (isBg) {
              data[idx+3] = 0; // Transparente
            } else {
              hasForeground = true;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        if (hasForeground) {
          // 2. Crear un canvas recortado para eliminar los márgenes transparentes enormes
          const croppedWidth = maxX - minX + 1;
          const croppedHeight = maxY - minY + 1;
          
          const croppedCanvas = document.createElement('canvas');
          croppedCanvas.width = croppedWidth;
          croppedCanvas.height = croppedHeight;
          const croppedCtx = croppedCanvas.getContext('2d');
          
          if (croppedCtx) {
            ctx.putImageData(imgData, 0, 0);
            croppedCtx.drawImage(canvas, minX, minY, croppedWidth, croppedHeight, 0, 0, croppedWidth, croppedHeight);
            setLogoSrc(croppedCanvas.toDataURL());
          }
        } else {
          ctx.putImageData(imgData, 0, 0);
          setLogoSrc(canvas.toDataURL());
        }
      }
    };
  }, []);

  // Detectar tamaño de pantalla para la vista móvil
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Cargar datos iniciales
  useEffect(() => {
    loadLocalData();
  }, []);

  // Limpiar URL del objeto al cambiar de archivo
  useEffect(() => {
    if (currentFile) {
      const url = URL.createObjectURL(currentFile.blob);
      setFileUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setFileUrl(null);
    }
  }, [currentFile]);

  const loadLocalData = async () => {
    const conversions = await historyStorage.listConversions();
    const storedFiles = await fileStorage.listStoredFiles();
    setHistoryList(conversions);
    setFilesList(storedFiles);
  };

  // Manejar selección de múltiples archivos
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      await processMultipleFiles(Array.from(selectedFiles));
    }
  };

  // Procesar arrastre de múltiples archivos
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      await processMultipleFiles(Array.from(droppedFiles));
    }
  };

  const processMultipleFiles = async (files: File[]) => {
    const validFiles = files.filter(f => f.type === 'application/pdf' || f.type.startsWith('image/'));
    if (validFiles.length === 0) {
      showToast('Error: Solo se admiten archivos PDF o imágenes.', 'error');
      return;
    }

    const newItems: QueueItem[] = validFiles.map(file => ({
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type,
      progress: 0,
      status: 'pending'
    }));

    const filesMap = new Map<string, File>();
    newItems.forEach((item, index) => {
      filesMap.set(item.id, validFiles[index]);
    });

    setUploadQueue(prev => [...newItems, ...prev]);
    processQueue(newItems, filesMap);
  };

  // Procesar cola en segundo plano (Secuencial)
  const processQueue = async (itemsToProcess: QueueItem[], filesMap: Map<string, File>) => {
    for (const item of itemsToProcess) {
      setUploadQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'processing', progress: 15 } : q));
      
      const file = filesMap.get(item.id);
      if (!file) continue;

      try {
        setUploadQueue(prev => prev.map(q => q.id === item.id ? { ...q, progress: 40 } : q));
        const stored = await fileStorage.storeFile(item.id, file.name, file, file.type);
        
        await loadLocalData();

        if (!geminiApiKey) {
          throw new Error('API Key de Gemini no configurada');
        }

        setUploadQueue(prev => prev.map(q => q.id === item.id ? { ...q, progress: 70 } : q));
        const result = await convertDocumentToMarkdown(stored.blob, stored.type, geminiApiKey);
        
        setUploadQueue(prev => prev.map(q => q.id === item.id ? { ...q, progress: 90 } : q));
        await historyStorage.saveConversion(stored.id, stored.name, result, 'success');
        setUploadQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'success', progress: 100 } : q));
        
        const cachedToken = getCachedAccessToken();
        if (cachedToken) {
          triggerAutoSync(cachedToken);
        }
      } catch (error: any) {
        setUploadQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'error', errorMsg: error.message || 'Error en conversión' } : q));
        await historyStorage.saveConversion(item.id, item.name, '', 'error', error.message || 'Error en conversión');
      }
      
      await loadLocalData();
    }
  };

  const triggerFileBrowser = () => {
    fileInputRef.current?.click();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Guardar configuración de Ajustes
  const saveSettings = () => {
    const trimmedApiKey = geminiApiKey.trim();
    const trimmedClientId = googleClientId.trim();
    setGeminiApiKey(trimmedApiKey);
    setGoogleClientId(trimmedClientId);
    localStorage.setItem('gemini_api_key', trimmedApiKey);
    localStorage.setItem('gdrive_client_id', trimmedClientId);
    setIsSettingsOpen(false);
    showToast('Ajustes guardados correctamente.', 'success');
  };

  // Notificaciones flotantes (Toasts)
  const showToast = (msg: string, type: 'error' | 'success') => {
    setErrorMsg(null);
    setSuccessMsg(null);
    if (type === 'error') {
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(null), 5000);
    } else {
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(null), 5000);
    }
  };

  // Convertir documento actual individualmente
  const handleConvert = async () => {
    if (!currentFile) return;
    if (!geminiApiKey) {
      setIsSettingsOpen(true);
      showToast('Por favor, introduce tu API Key de Gemini en los Ajustes.', 'error');
      return;
    }

    setIsConverting(true);
    setErrorMsg(null);
    try {
      const result = await convertDocumentToMarkdown(
        currentFile.blob,
        currentFile.type,
        geminiApiKey
      );
      setConvertedMarkdown(result);
      await historyStorage.saveConversion(currentFile.id, currentFile.name, result, 'success');
      showToast('Conversión finalizada con éxito.', 'success');
      loadLocalData();

      const cachedToken = getCachedAccessToken();
      if (cachedToken) {
        triggerAutoSync(cachedToken);
      }
    } catch (error: any) {
      showToast(error.message || 'Error en la conversión.', 'error');
      await historyStorage.saveConversion(currentFile.id, currentFile.name, '', 'error', error.message || 'Error en conversión');
    } finally {
      setIsConverting(false);
    }
  };

  // Sincronización Automática hacia Google Drive
  const triggerAutoSync = async (token: string) => {
    try {
      const latestHistory = await historyStorage.listConversions();
      const latestFiles = await fileStorage.listStoredFiles();
      await syncToGoogleDrive(token, latestHistory, latestFiles);
      showToast('Respaldo en Google Drive sincronizado.', 'success');
    } catch (err) {
      console.error('Error en sincronización automática:', err);
    }
  };

  // Conectar con Google Drive
  const handleConnectGoogleDrive = async () => {
    if (!googleClientId) {
      setIsSettingsOpen(true);
      showToast('Configura tu Google Client ID en Ajustes para conectar Google Drive.', 'error');
      return;
    }

    try {
      setIsSyncing(true);
      setSyncStatus('Autenticando con Google...');
      const token = await authenticateGoogleDrive();
      setGdriveToken(token);

      setSyncStatus('Conectando y descargando copias de seguridad de Google Drive...');
      const { history, files } = await syncFromGoogleDrive(token, (status) => setSyncStatus(status));
      
      if (history.length > 0 || files.length > 0) {
        setSyncStatus('Restaurando datos locales de la aplicación...');
        await historyStorage.importHistory(history);
        await fileStorage.clearAllFiles();
        for (const file of files) {
          await fileStorage.storeFile(file.id, file.name, file.blob, file.type);
        }
        await loadLocalData();
        showToast('¡Datos de Google Drive restaurados con éxito!', 'success');
      } else {
        setSyncStatus('Subiendo datos actuales locales para crear respaldo...');
        await syncToGoogleDrive(token, historyList, filesList, (status) => setSyncStatus(status));
      }

      setSyncStatus(null);
      setIsSyncing(false);
    } catch (error: any) {
      setSyncStatus(null);
      setIsSyncing(false);
      showToast(error.message || 'Error al conectar con Google Drive.', 'error');
    }
  };

  // Desconectar Google Drive
  const handleDisconnectGoogleDrive = () => {
    disconnectGoogleDrive();
    setGdriveToken(null);
    showToast('Google Drive desconectado.', 'success');
  };

  // Respaldar (Exportar) Manualmente a Google Drive
  const handleManualExport = async () => {
    const token = getCachedAccessToken() || gdriveToken;
    if (!token) {
      handleConnectGoogleDrive();
      return;
    }

    try {
      setIsSyncing(true);
      setSyncStatus('Exportando y respaldando datos en Google Drive...');
      await syncToGoogleDrive(token, historyList, filesList, (status) => setSyncStatus(status));
      showToast('Exportación manual completada con éxito.', 'success');
      setSyncStatus(null);
      setIsSyncing(false);
    } catch (error: any) {
      setSyncStatus(null);
      setIsSyncing(false);
      showToast(error.message || 'Error en la exportación manual.', 'error');
    }
  };

  // Restaurar (Importar) Manualmente desde Google Drive
  const handleManualImport = async () => {
    const token = getCachedAccessToken() || gdriveToken;
    if (!token) {
      handleConnectGoogleDrive();
      return;
    }

    try {
      setIsSyncing(true);
      setSyncStatus('Buscando copias de seguridad en Google Drive...');
      const { history, files } = await syncFromGoogleDrive(token, (status) => setSyncStatus(status));
      
      if (history.length > 0 || files.length > 0) {
        setSyncStatus('Restaurando datos e importándolos en local...');
        await historyStorage.importHistory(history);
        await fileStorage.clearAllFiles();
        for (const file of files) {
          await fileStorage.storeFile(file.id, file.name, file.blob, file.type);
        }
        await loadLocalData();
        showToast('Importación manual completada con éxito.', 'success');
      } else {
        showToast('No se encontraron archivos de respaldo en Google Drive.', 'error');
      }
      setSyncStatus(null);
      setIsSyncing(false);
    } catch (error: any) {
      setSyncStatus(null);
      setIsSyncing(false);
      showToast(error.message || 'Error en la importación manual.', 'error');
    }
  };

  // Seleccionar archivo del historial
  const handleSelectHistoryItem = async (item: Conversion) => {
    if (item.status === 'error') {
      showToast(item.errorMsg || 'Este archivo falló en la conversión.', 'error');
      return;
    }
    setIsConverting(false);
    const file = await fileStorage.getFile(item.id);
    if (file) {
      setCurrentFile(file);
      setConvertedMarkdown(item.texto_md_resultado);
      setViewState('workspace');
      showToast(`Cargado archivo "${item.nombre_archivo}" del historial.`, 'success');
    } else {
      setCurrentFile({
        id: item.id,
        name: item.nombre_archivo,
        blob: new Blob([], { type: 'application/pdf' }),
        type: 'application/pdf',
        uploadedAt: item.fecha_conversion
      });
      setConvertedMarkdown(item.texto_md_resultado);
      setViewState('workspace');
      showToast(`Mostrando Markdown para "${item.nombre_archivo}" (archivo de origen no encontrado).`, 'success');
    }
  };

  // Descargar archivo original desde el historial
  const handleDownloadOriginal = async (id: string, name: string) => {
    const file = await fileStorage.getFile(id);
    if (file) {
      const url = URL.createObjectURL(file.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Descargando archivo original: ${name}`, 'success');
    } else {
      showToast('El archivo original no se encuentra almacenado localmente.', 'error');
    }
  };

  // Visualizar original en el Workspace
  const handleViewOriginal = async (id: string) => {
    const file = await fileStorage.getFile(id);
    if (file) {
      setCurrentFile(file);
      const conv = historyList.find(h => h.id === id);
      if (conv) {
        setConvertedMarkdown(conv.texto_md_resultado);
      }
      setViewState('workspace');
      setActiveWorkspaceTab('visor');
    } else {
      showToast('El archivo original no se encuentra almacenado localmente.', 'error');
    }
  };

  // Abrir ventana flotante premium para visualizar Markdown en crudo UTF-8
  const handleViewMarkdownModal = (name: string, text: string) => {
    setSelectedMarkdownFileName(name);
    setSelectedMarkdownText(text);
  };

  // Copiar texto al portapapeles
  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Ir a la pantalla de nuevo documento
  const handleNewDocument = () => {
    setCurrentFile(null);
    setConvertedMarkdown('');
    setViewState('import');
  };

  // Ir al Dashboard de bienvenida
  const handleGoDashboard = () => {
    setCurrentFile(null);
    setConvertedMarkdown('');
    setViewState('dashboard');
  };

  // Descarga local de markdown
  const handleDownload = () => {
    if (!currentFile || !convertedMarkdown) return;
    downloadMarkdown(currentFile.name, convertedMarkdown);
  };

  // Calcular tamaño estimado de IndexedDB
  const calculateStorageSize = () => {
    let size = 0;
    for (const file of filesList) {
      size += file.blob.size;
    }
    for (const h of historyList) {
      size += new Blob([h.texto_md_resultado]).size;
    }
    
    if (size === 0) return '0 KB';
    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Limpiar cola de subidas
  const clearUploadQueue = () => {
    setUploadQueue([]);
  };

  // Reintentar procesar un elemento de la cola que ha fallado
  const retryQueueItem = async (id: string) => {
    const item = uploadQueue.find(q => q.id === id);
    if (!item) return;

    // Cambiar a pending para mostrar el estado correcto en la UI
    setUploadQueue(prev => prev.map(q => q.id === id ? { ...q, status: 'pending', progress: 0, errorMsg: undefined } : q));

    try {
      const storedFile = await fileStorage.getFile(id);
      if (!storedFile) {
        throw new Error('Archivo original no encontrado en el almacenamiento local.');
      }

      const file = new File([storedFile.blob], storedFile.name, { type: storedFile.type });
      const filesMap = new Map<string, File>([[id, file]]);

      // Re-procesar la cola
      await processQueue([{ ...item, status: 'pending', progress: 0, errorMsg: undefined }], filesMap);
    } catch (error: any) {
      setUploadQueue(prev => prev.map(q => q.id === id ? { ...q, status: 'error', errorMsg: error.message || 'Error en reintento' } : q));
      await historyStorage.saveConversion(id, item.name, '', 'error', error.message || 'Error en reintento');
      await loadLocalData();
    }
  };

  // Renderizar Markdown básico a HTML
  const renderMarkdownToHtml = (md: string) => {
    if (!md) return '<p class="text-on-surface-variant italic">No hay contenido convertido.</p>';

    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    html = html.replace(/^# (.*?)$/gm, '<h1 class="text-2xl font-bold border-b border-outline-variant/30 pb-2 mb-4 mt-6 text-white">$1</h1>');
    html = html.replace(/^## (.*?)$/gm, '<h2 class="text-xl font-semibold mb-3 mt-4 text-primary">$1</h2>');
    html = html.replace(/^### (.*?)$/gm, '<h3 class="text-lg font-medium mb-2 mt-3 text-on-surface">$1</h3>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-white">$1</strong>');
    html = html.replace(/```([\s\S]*?)```/g, '<pre class="bg-surface-container p-4 rounded-xl font-mono text-sm border border-outline-variant/20 overflow-auto my-4 text-on-surface-variant">$1</pre>');
    html = html.replace(/`(.*?)`/g, '<code class="bg-surface-container-high px-1.5 py-0.5 rounded font-mono text-xs text-primary">$1</code>');
    html = html.replace(/^> (.*?)$/gm, '<blockquote class="border-l-4 border-primary bg-white/5 pl-4 py-2 rounded-r my-4 italic text-on-surface-variant">$1</blockquote>');

    const lines = html.split('\n');
    let inTable = false;
    let tableHtml = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('|') && line.endsWith('|')) {
        if (line.includes('---')) continue;
        
        if (!inTable) {
          inTable = true;
          tableHtml += '<div class="overflow-x-auto my-6"><table class="w-full text-left border-collapse border border-outline-variant/20 rounded-xl overflow-hidden"><tbody class="divide-y divide-outline-variant/10">';
        }

        const cells = line.split('|').slice(1, -1);
        const isHeader = tableHtml.includes('<thead>') === false && !tableHtml.includes('<tr>');
        
        tableHtml += '<tr class="hover:bg-white/5 transition-colors">';
        cells.forEach(cell => {
          const content = cell.trim();
          if (isHeader) {
            tableHtml += `<th class="px-4 py-3 bg-surface-container-high font-bold text-xs uppercase text-primary border-b border-outline-variant/20">${content}</th>`;
          } else {
            const isNumber = /^-?\d+(\.\d+)?%?$/.test(content.replace(/[\s€$]/g, ''));
            tableHtml += `<td class="px-4 py-3 text-sm text-on-surface-variant ${isNumber ? 'text-right font-mono' : ''}">${content}</td>`;
          }
        });
        tableHtml += '</tr>';
      } else {
        if (inTable) {
          inTable = false;
          tableHtml += '</tbody></table></div>';
          lines[i] = tableHtml + '\n' + lines[i];
          tableHtml = '';
        }
      }
    }
    
    if (inTable) {
      tableHtml += '</tbody></table></div>';
      html = lines.join('\n') + '\n' + tableHtml;
    } else {
      html = lines.join('\n');
    }

    html = html.replace(/^(?!<(h1|h2|h3|pre|blockquote|div|table|tr|th|td|li|ul))+(.*?)$/gm, '<p class="mb-3 text-on-surface-variant leading-relaxed">$2</p>');
    return html;
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-on-surface">
      {/* Toast de error */}
      {errorMsg && (
        <div className="fixed top-16 left-4 right-4 sm:left-1/2 sm:-translate-x-1/2 sm:right-auto sm:w-[90vw] sm:max-w-lg z-[100] toast-entrance">
          <div className="bg-red-500/95 backdrop-blur-xl border border-white/10 px-4 py-3 rounded-xl shadow-2xl flex items-start gap-3 max-h-[85vh] overflow-y-auto">
            <AlertCircle className="text-white shrink-0 mt-0.5" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-white text-[10px] uppercase font-bold tracking-wider mb-1 opacity-75 font-label-caps">Error</p>
              <p className="text-white text-xs font-medium leading-relaxed break-words whitespace-pre-wrap">{errorMsg}</p>
            </div>
            <button onClick={() => setErrorMsg(null)} className="ml-2 hover:bg-white/10 p-1.5 rounded-lg transition-colors shrink-0 cursor-pointer">
              <span className="material-symbols-outlined text-[18px] text-white block">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Toast de éxito */}
      {successMsg && (
        <div className="fixed top-16 left-4 right-4 sm:left-1/2 sm:-translate-x-1/2 sm:right-auto sm:w-auto sm:max-w-md z-[100] toast-entrance">
          <div className="bg-green-500/90 backdrop-blur-xl border border-white/10 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3">
            <CheckCircle className="text-white shrink-0" size={20} />
            <p className="text-white text-sm font-medium">{successMsg}</p>
            <button onClick={() => setSuccessMsg(null)} className="ml-2 hover:bg-white/10 p-1 rounded-lg transition-colors cursor-pointer">
              <span className="material-symbols-outlined text-[18px] text-white">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Pantalla de carga animada con icono de Nube en color sólido */}
      {isSyncing && (
        <div className="fixed inset-0 bg-[#0F0F11]/90 backdrop-blur-xl z-[90] flex flex-col items-center justify-center">
          <div className="w-full max-w-md p-8 flex flex-col items-center text-center">
            <div className="relative mb-8">
              <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
              <div className="absolute inset-0 m-auto flex items-center justify-center text-primary">
                <Cloud size={26} />
              </div>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Google Drive Sync</h3>
            <p className="text-on-surface-variant text-sm animate-pulse">{syncStatus}</p>
            <div className="w-48 h-1 bg-white/5 rounded-full overflow-hidden mt-6">
              <div className="h-full bg-primary rounded-full animate-infinite-scroll w-1/3"></div>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar lateral (Oculto en Móvil) */}
      {!isMobile && (
        <aside className="flex flex-col h-screen fixed left-0 top-0 z-40 bg-surface-container dark:bg-surface-container-high border-r border-outline-variant w-[260px] shrink-0 font-sans">
          <div className="p-6 flex flex-col h-full">
            
            {/* Logo recortado dinámicamente: Ocupa la mayor parte de la cuadrícula superior */}
            <div className="mb-8 cursor-pointer w-full flex justify-center items-center hover:scale-102 transition-transform duration-200" onClick={handleGoDashboard} title="Ir al Dashboard">
              <img 
                src={logoSrc} 
                alt="Logo de DocToMarkdown" 
                className="w-full max-h-32 object-contain"
              />
            </div>

            {/* Botones de control rápido */}
            <div className="space-y-3 mb-6">
              <button 
                onClick={handleGoDashboard}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                  viewState === 'dashboard' 
                    ? 'bg-primary-container text-on-primary-container font-semibold shadow-lg shadow-primary/10' 
                    : 'bg-white/5 hover:bg-white/10 text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <Home size={18} />
                <span className="text-body-sm font-medium">Inicio</span>
              </button>

              <button 
                onClick={handleNewDocument}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                  viewState === 'import' 
                    ? 'bg-primary-container text-on-primary-container font-semibold shadow-lg shadow-primary/10' 
                    : 'bg-white/5 hover:bg-white/10 text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <Plus size={18} />
                <span className="text-body-sm font-medium">Nuevo Documento</span>
              </button>

              {/* Botón de Google Drive con indicador de conexión y opciones de Backup */}
              {gdriveToken ? (
                <div className="space-y-1.5 p-3 rounded-xl bg-white/5 border border-outline-variant/10">
                  <div className="flex items-center justify-between mb-2 px-1 text-xs font-semibold text-white/80">
                    <div className="flex items-center gap-2">
                      <Cloud size={14} className="text-primary" />
                      <span>Google Drive Activo</span>
                    </div>
                    {/* Puntito verde de estado activo */}
                    <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.7)] animate-pulse"></div>
                  </div>
                  
                  <button 
                    onClick={handleManualExport}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-lg text-[11px] font-medium transition-colors"
                  >
                    <Upload size={12} />
                    <span>Exportar a Drive</span>
                  </button>

                  <button 
                    onClick={handleManualImport}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/5 text-white rounded-lg text-[11px] font-medium transition-colors"
                  >
                    <Download size={12} />
                    <span>Importar de Drive</span>
                  </button>

                  <button 
                    onClick={handleDisconnectGoogleDrive}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-outline hover:text-red-400 text-left text-[10px] transition-colors"
                  >
                    <LogOut size={10} />
                    <span>Desconectar cuenta</span>
                  </button>
                </div>
              ) : (
                <button 
                  onClick={handleConnectGoogleDrive}
                  className="w-full flex items-center justify-between px-4 py-3 bg-white/5 border border-outline-variant/30 hover:bg-white/10 text-on-surface hover:text-white rounded-xl transition-all duration-200 group text-left"
                >
                  <div className="flex items-center gap-3">
                    <Cloud size={18} className="text-outline group-hover:text-primary transition-colors" />
                    <span className="text-body-sm font-medium">Vincular Google Drive</span>
                  </div>
                  {/* Puntito rojo de estado desconectado */}
                  <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)] shrink-0"></div>
                </button>
              )}
            </div>

            {/* Listado de Historial en la barra lateral - MÁXIMO 5 CONVERSIONES */}
            <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-6">
              <div>
                <h3 className="text-label-caps font-label-caps text-outline mb-3 px-2 flex items-center gap-2">
                  <History size={12} />
                  <span>Historial Reciente</span>
                </h3>
                {historyList.length === 0 ? (
                  <p className="text-[11px] text-outline italic px-2">No hay conversiones guardadas.</p>
                ) : (
                  <div className="space-y-1">
                    {historyList.slice(0, 5).map((item) => (
                      <div 
                        key={item.id} 
                        onClick={() => handleSelectHistoryItem(item)}
                        className={`group flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150 ${
                          currentFile?.id === item.id && viewState === 'workspace'
                            ? 'bg-primary/10 text-primary border-l-2 border-primary' 
                            : 'text-on-surface-variant hover:bg-white/5 hover:text-on-surface'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <FileText size={14} className="shrink-0" />
                          <span className="text-body-sm truncate">{item.nombre_archivo}</span>
                        </div>
                        <button 
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (confirm('¿Seguro que deseas eliminar esta conversión del historial?')) {
                              await historyStorage.deleteConversion(item.id);
                              await fileStorage.deleteFile(item.id);
                              if (currentFile?.id === item.id) {
                                handleGoDashboard();
                              }
                              loadLocalData();
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded text-outline hover:text-red-400 transition-all"
                        >
                          <span className="material-symbols-outlined text-[14px]">delete</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Ajustes */}
            <div className="mt-auto pt-4 border-t border-outline-variant/30 space-y-1">
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-on-surface-variant hover:bg-white/5 hover:text-on-surface rounded-xl transition-all"
              >
                <Settings size={16} />
                <span className="text-body-sm">Ajustes de API</span>
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Workspace principal */}
      <div className={`flex-1 flex flex-col ${isMobile ? 'ml-0' : 'ml-[260px]'} h-screen overflow-hidden pb-${isMobile ? '16' : '0'}`}>
        
        {/* Header superior (Oculto en Dashboard) */}
        {viewState !== 'dashboard' && (
          <header className="h-16 flex items-center justify-between px-6 bg-surface-container-low border-b border-outline-variant z-35 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={handleGoDashboard} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-outline hover:text-white mr-1" title="Volver al Inicio">
                <Home size={16} />
              </button>
              <FileText className="text-primary shrink-0" size={18} />
              <h2 className="text-body-md font-medium text-white truncate max-w-[180px] sm:max-w-md">
                {viewState === 'import' && 'Importar Archivos'}
                {viewState === 'workspace' && currentFile && currentFile.name}
              </h2>
            </div>
            
            <div className="flex items-center gap-2">
              {viewState === 'workspace' && currentFile && (
                <>
                  <button 
                    onClick={handleConvert}
                    disabled={isConverting}
                    className="px-3 sm:px-4 h-9 rounded-lg bg-primary hover:bg-primary-container text-on-primary font-semibold text-xs transition-all active:scale-95 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isConverting ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        <span className="hidden sm:inline">Extrayendo...</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw size={12} />
                        <span className="hidden sm:inline">Convertir con Gemini</span>
                        <span className="sm:hidden">Convertir</span>
                      </>
                    )}
                  </button>
                  <button 
                    onClick={handleDownload}
                    disabled={!convertedMarkdown}
                    className={`px-3 sm:px-4 h-9 rounded-lg font-semibold text-xs transition-all active:scale-95 flex items-center gap-1.5 shadow-lg ${
                      convertedMarkdown 
                        ? 'bg-white/5 hover:bg-white/10 text-white border border-outline-variant' 
                        : 'bg-white/5 text-outline cursor-not-allowed opacity-50'
                    }`}
                  >
                    <Download size={12} />
                    <span className="hidden sm:inline">Descargar .md</span>
                    <span className="sm:hidden">Descargar</span>
                  </button>
                </>
              )}
            </div>
          </header>
        )}

        {/* Zona de contenido dinámico */}
        {viewState === 'dashboard' && (
          /* NUEVO DASHBOARD PREMIUM ANIMADO */
          <main className="flex-1 p-6 sm:p-10 overflow-y-auto bg-background flex flex-col justify-start space-y-8 pb-24 sm:pb-10 min-h-screen">
            {/* Cabecera del Dashboard */}
            <div className="space-y-2 mt-4 animate-fade-in">
              <h3 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Bienvenido a DocToMarkdown</h3>
              <p className="text-on-surface-variant text-sm max-w-2xl">
                Tu centro local de transcripción y maquetación de archivos. Convierte PDFs y capturas a Markdown de forma privada e instantánea.
              </p>
            </div>

            {/* Fila de Tarjetas de Estadísticas (Icono Nube Silueta) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Card 1: Documentos Procesados */}
              <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between hover:border-primary/30 transition-all duration-300 group">
                <div className="flex items-center justify-between text-outline mb-4">
                  <span className="text-xs font-semibold uppercase tracking-wider font-label-caps">Procesados</span>
                  <FileText className="text-primary group-hover:scale-110 transition-transform" size={18} />
                </div>
                <div>
                  <h4 className="text-3xl sm:text-4xl font-extrabold text-white mb-1 animate-pulse-slow">
                    {historyList.length}
                  </h4>
                  <p className="text-[11px] text-on-surface-variant">Archivos en base de datos local</p>
                </div>
              </div>

              {/* Card 2: Tiempo Ahorrado */}
              <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between hover:border-primary/30 transition-all duration-300 group">
                <div className="flex items-center justify-between text-outline mb-4">
                  <span className="text-xs font-semibold uppercase tracking-wider font-label-caps">Tiempo Ahorrado</span>
                  <Clock className="text-amber-400 group-hover:rotate-12 transition-transform" size={18} />
                </div>
                <div>
                  <h4 className="text-3xl sm:text-4xl font-extrabold text-white mb-1">
                    {(historyList.length * 2.5).toFixed(0)} min
                  </h4>
                  <p className="text-[11px] text-on-surface-variant">Estimado a 2.5 min por doc</p>
                </div>
              </div>

              {/* Card 3: Uso de Almacenamiento */}
              <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between hover:border-primary/30 transition-all duration-300 group">
                <div className="flex items-center justify-between text-outline mb-4">
                  <span className="text-xs font-semibold uppercase tracking-wider font-label-caps">Espacio Local</span>
                  <HardDrive className="text-blue-400 group-hover:scale-110 transition-transform" size={18} />
                </div>
                <div>
                  <h4 className="text-3xl sm:text-4xl font-extrabold text-white mb-1">
                    {calculateStorageSize()}
                  </h4>
                  <p className="text-[11px] text-on-surface-variant">Caché IndexedDB utilizada</p>
                </div>
              </div>

              {/* Card 4: Sincronización en la Nube con Icono de Nube Silueta */}
              <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between hover:border-primary/30 transition-all duration-300 group min-w-0">
                <div className="flex items-center justify-between text-outline mb-4">
                  <span className="text-xs font-semibold uppercase tracking-wider font-label-caps">Cloud Backup</span>
                  <Cloud size={18} className={gdriveToken ? "text-green-400 animate-pulse" : "text-outline"} />
                </div>
                <div className="min-w-0">
                  <h4 className={`text-lg sm:text-xl font-bold mb-1 truncate ${gdriveToken ? 'text-green-400' : 'text-outline'}`}>
                    {gdriveToken ? 'Sincronizado' : 'Desconectado'}
                  </h4>
                  <p className="text-[11px] text-on-surface-variant truncate">
                    {gdriveToken ? 'Respaldo activo en Drive' : 'Vincular cuenta en Ajustes'}
                  </p>
                </div>
              </div>
            </div>

            {/* Contenedor del Historial Completo (Reemplazando módulos Bento anteriores) */}
            <div className="glass-panel rounded-3xl p-6 sm:p-8 flex flex-col space-y-6">
              <div className="flex items-center justify-between border-b border-outline-variant/30 pb-4">
                <div className="space-y-1">
                  <h4 className="text-lg font-bold text-white">Historial Completo de Conversiones</h4>
                  <p className="text-xs text-on-surface-variant">Administra, visualiza y descarga tus archivos procesados localmente.</p>
                </div>
                <button 
                  onClick={handleNewDocument}
                  className="px-4 h-9 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-semibold text-xs transition-all active:scale-95 flex items-center gap-1.5 shadow-lg"
                >
                  <Plus size={14} />
                  <span>Nuevo Documento</span>
                </button>
              </div>

              {historyList.length === 0 ? (
                <div className="py-12 text-center text-outline italic text-sm">
                  No hay conversiones guardadas en el historial local. Sube un archivo para comenzar.
                </div>
              ) : (
                <>
                  {/* Vista Desktop: Tabla (visible en pantallas md o superiores) */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-outline-variant/20 text-[10px] uppercase tracking-wider font-label-caps text-outline">
                          <th className="py-3 px-4 font-semibold">Documento</th>
                          <th className="py-3 px-4 font-semibold">Fecha</th>
                          <th className="py-3 px-4 font-semibold">Estado</th>
                          <th className="py-3 px-4 font-semibold text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/10 text-sm">
                        {historyList.map((item) => (
                          <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
                            <td className="py-3.5 px-4 font-medium min-w-[200px]">
                              {item.status === 'error' ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-red-400 font-semibold break-all">{item.nombre_archivo}</span>
                                  <button 
                                    onClick={() => showToast(item.errorMsg || 'Error en conversión', 'error')}
                                    className="p-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded transition-colors"
                                    title="Ver mensaje de error"
                                  >
                                    <AlertCircle size={12} />
                                  </button>
                                </div>
                              ) : (
                                <span className="text-green-400 font-semibold break-all">{item.nombre_archivo}</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-outline text-xs whitespace-nowrap">
                              {new Date(item.fecha_conversion).toLocaleString('es-ES', { 
                                day: '2-digit', 
                                month: '2-digit', 
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              {item.status === 'error' ? (
                                <span className="text-[10px] uppercase font-bold tracking-wider font-label-caps text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-md">Fallo</span>
                              ) : (
                                <span className="text-[10px] uppercase font-bold tracking-wider font-label-caps text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-md">Éxito</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-2.5">
                                {/* Descarga original */}
                                <button 
                                  onClick={() => handleDownloadOriginal(item.id, item.nombre_archivo)}
                                  className="p-1.5 hover:bg-white/10 rounded-lg text-outline hover:text-white transition-colors"
                                  title="Descargar original"
                                >
                                  <Download size={14} />
                                </button>

                                {/* Visualizar original en Workspace */}
                                <button 
                                  onClick={() => handleViewOriginal(item.id)}
                                  className="p-1.5 hover:bg-white/10 rounded-lg text-outline hover:text-white transition-colors"
                                  title="Visualizar original"
                                >
                                  <Eye size={14} />
                                </button>

                                {/* Visualizar md (Caja flotante premium) */}
                                {item.status !== 'error' && (
                                  <button 
                                    onClick={() => handleViewMarkdownModal(item.nombre_archivo, item.texto_md_resultado)}
                                    className="p-1.5 hover:bg-white/10 rounded-lg text-outline hover:text-primary transition-colors"
                                    title="Ver Markdown Convertido"
                                  >
                                    <Code size={14} />
                                  </button>
                                )}

                                {/* Borrar */}
                                <button 
                                  onClick={async () => {
                                    if (confirm('¿Seguro que deseas eliminar esta conversión del historial?')) {
                                      await historyStorage.deleteConversion(item.id);
                                      await fileStorage.deleteFile(item.id);
                                      loadLocalData();
                                    }
                                  }}
                                  className="p-1.5 hover:bg-white/10 rounded-lg text-outline hover:text-red-400 transition-colors"
                                  title="Eliminar registro"
                                >
                                  <span className="material-symbols-outlined text-[15px]">delete</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Vista Mobile: Tarjetas compactas (visible en pantallas móviles < md) */}
                  <div className="block md:hidden space-y-4">
                    {historyList.map((item) => (
                      <div 
                        key={item.id} 
                        className="bg-white/[0.02] border border-outline-variant/10 rounded-2xl p-4 flex flex-col space-y-3"
                      >
                        {/* Fila superior: Nombre de archivo y Estado */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            {item.status === 'error' ? (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-red-400 font-semibold text-sm break-all">{item.nombre_archivo}</span>
                                <button 
                                  onClick={() => showToast(item.errorMsg || 'Error en conversión', 'error')}
                                  className="p-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded transition-colors shrink-0 flex items-center justify-center"
                                  title="Ver mensaje de error"
                                >
                                  <AlertCircle size={12} />
                                </button>
                              </div>
                            ) : (
                              <span className="text-green-400 font-semibold text-sm break-all">{item.nombre_archivo}</span>
                            )}
                          </div>
                          <div className="shrink-0 pt-0.5">
                            {item.status === 'error' ? (
                              <span className="text-[9px] uppercase font-bold tracking-wider font-label-caps text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">Fallo</span>
                            ) : (
                              <span className="text-[9px] uppercase font-bold tracking-wider font-label-caps text-green-400 bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 rounded">Éxito</span>
                            )}
                          </div>
                        </div>

                        {/* Fila intermedia: Fecha de conversión */}
                        <div className="flex items-center justify-between text-[11px] text-outline">
                          <span>Fecha</span>
                          <span>
                            {new Date(item.fecha_conversion).toLocaleString('es-ES', { 
                              day: '2-digit', 
                              month: '2-digit', 
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>

                        {/* Fila inferior: Botones de acciones */}
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant/10">
                          {/* Descarga original */}
                          <button 
                            onClick={() => handleDownloadOriginal(item.id, item.nombre_archivo)}
                            className="p-2 hover:bg-white/10 rounded-lg text-outline hover:text-white transition-colors flex items-center justify-center shrink-0"
                            title="Descargar original"
                          >
                            <Download size={15} />
                          </button>

                          {/* Visualizar original en Workspace */}
                          <button 
                            onClick={() => handleViewOriginal(item.id)}
                            className="p-2 hover:bg-white/10 rounded-lg text-outline hover:text-white transition-colors flex items-center justify-center shrink-0"
                            title="Visualizar original"
                          >
                            <Eye size={15} />
                          </button>

                          {/* Visualizar md (Caja flotante premium) */}
                          {item.status !== 'error' && (
                            <button 
                              onClick={() => handleViewMarkdownModal(item.nombre_archivo, item.texto_md_resultado)}
                              className="p-2 hover:bg-white/10 rounded-lg text-outline hover:text-primary transition-colors flex items-center justify-center shrink-0"
                              title="Ver Markdown Convertido"
                            >
                              <Code size={15} />
                            </button>
                          )}

                          {/* Borrar */}
                          <button 
                            onClick={async () => {
                              if (confirm('¿Seguro que deseas eliminar esta conversión del historial?')) {
                                await historyStorage.deleteConversion(item.id);
                                await fileStorage.deleteFile(item.id);
                                loadLocalData();
                              }
                            }}
                            className="p-2 hover:bg-white/10 rounded-lg text-outline hover:text-red-400 transition-colors flex items-center justify-center shrink-0"
                            title="Eliminar registro"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </main>
        )}

        {viewState === 'import' && (
          /* PANTALLA DE CARGA DE NUEVO DOCUMENTO */
          <main className="flex-1 p-6 sm:p-8 overflow-y-auto flex flex-col items-center justify-start bg-background space-y-8 pb-24 sm:pb-8">
            <div className="w-full max-w-4xl text-center mt-4 space-y-2">
              <h3 className="text-2xl sm:text-3xl font-bold text-white leading-tight">Carga tus documentos</h3>
              <p className="text-on-surface-variant text-sm">
                Puedes seleccionar o arrastrar **varios archivos a la vez** (PDFs o imágenes) para procesarlos por lotes.
              </p>
            </div>

            {/* Layout Bento de Carga */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 w-full max-w-4xl">
              <div 
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={triggerFileBrowser}
                className="col-span-1 sm:col-span-8 glass-panel rounded-3xl flex flex-col items-center justify-center p-8 relative transition-all duration-300 group cursor-pointer hover:border-primary/40 hover:bg-white/5 min-h-[250px]"
              >
                <div className="absolute inset-4 border border-dashed border-outline-variant/30 rounded-2xl pointer-events-none group-hover:border-primary/40 transition-colors"></div>
                <div className="relative z-10 flex flex-col items-center text-center gap-4">
                  <div className="flex items-center -space-x-4 mb-1">
                    <div className="w-12 h-12 bg-surface-container-highest rounded-xl flex items-center justify-center shadow-lg border border-white/5 transform -rotate-6">
                      <FileText size={24} className="text-red-400" />
                    </div>
                    <div className="w-14 h-14 bg-surface-container-highest rounded-xl flex items-center justify-center shadow-2xl border border-white/10 z-20 transition-transform group-hover:scale-105">
                      <Upload size={28} className="text-primary" />
                    </div>
                    <div className="w-12 h-12 bg-surface-container-highest rounded-xl flex items-center justify-center shadow-lg border border-white/5 transform rotate-6">
                      <ImageIcon size={24} className="text-amber-400" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-base sm:text-lg font-bold text-white">Arrastrar y soltar múltiples archivos aquí</p>
                    <p className="text-xs text-on-surface-variant">Soporta PDFs e imágenes (.png, .jpg, .webp)</p>
                  </div>
                  <button className="mt-1 px-5 h-9 rounded-full bg-primary hover:bg-primary-container text-on-primary font-semibold text-xs hover:scale-102 transition-transform shadow-md">
                    Explorar archivos
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileSelect} 
                    className="hidden" 
                    multiple
                    accept="application/pdf,image/*" 
                  />
                </div>
              </div>

              {/* Sincronización Google Drive (Icono Nube Silueta) y Privacidad */}
              <div className="col-span-1 sm:col-span-4 flex flex-col gap-6">
                <div 
                  onClick={!gdriveToken ? (e) => { e.stopPropagation(); handleConnectGoogleDrive(); } : undefined}
                  className="glass-panel flex-1 rounded-3xl p-5 flex flex-col items-center justify-center text-center hover:bg-white/5 transition-colors cursor-pointer group min-h-[140px]"
                >
                  <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center mb-3 group-hover:bg-white/10 transition-all text-outline group-hover:text-primary relative">
                    <Cloud size={20} className={gdriveToken ? "text-primary" : ""} />
                    {/* Puntito de estado según si está conectado o no */}
                    {gdriveToken ? (
                      <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.7)] animate-pulse"></div>
                    ) : (
                      <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]"></div>
                    )}
                  </div>
                  <p className="text-xs font-bold text-white mb-1">
                    {gdriveToken ? 'Google Drive Activo' : 'Vincular Google Drive'}
                  </p>
                  
                  {gdriveToken ? (
                    <div className="w-full space-y-1.5 mt-2">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleManualExport(); }}
                        className="w-full py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary font-semibold text-[10px] hover:bg-primary/20 transition-colors"
                      >
                        Exportar Manual
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleManualImport(); }}
                        className="w-full py-1.5 rounded-lg bg-white/5 border border-white/10 text-white font-semibold text-[10px] hover:bg-white/10 transition-colors"
                      >
                        Importar Manual
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleConnectGoogleDrive(); }}
                      className="w-full py-1.5 rounded-lg bg-white/5 border border-white/10 text-white font-medium text-[10px] hover:bg-white/10 transition-colors mt-2"
                    >
                      Vincular cuenta
                    </button>
                  )}
                </div>

                <div className="glass-panel flex-1 rounded-3xl p-5 flex flex-col justify-between relative overflow-hidden bg-gradient-to-br from-primary/5 to-transparent min-h-[120px]">
                  <div className="flex items-start justify-between">
                    <CheckCircle className="text-primary" size={20} />
                    <span className="text-[9px] uppercase font-bold text-primary/60 tracking-wider font-label-caps">Privado</span>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white mb-0.5">Almacenamiento Local</p>
                    <p className="text-[10px] text-on-surface-variant leading-relaxed">
                      Tus archivos se guardan en IndexedDB localmente, sin intermediarios.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Listado de Cola de Procesamiento */}
            {uploadQueue.length > 0 && (
              <div className="w-full max-w-4xl glass-panel rounded-3xl p-6 space-y-4 animate-fade-in">
                <div className="flex items-center justify-between border-b border-outline-variant/30 pb-3">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Loader2 size={16} className={uploadQueue.some(q => q.status === 'processing') ? 'animate-spin text-primary' : 'text-outline'} />
                    <span>Cola de Procesamiento ({uploadQueue.filter(q => q.status === 'success').length}/{uploadQueue.length})</span>
                  </h4>
                  <button 
                    onClick={clearUploadQueue} 
                    className="text-xs text-outline hover:text-white flex items-center gap-1 px-3 py-1 bg-white/5 rounded-lg border border-white/5 hover:bg-white/10 transition-colors"
                  >
                    <X size={12} />
                    <span>Limpiar Cola</span>
                  </button>
                </div>

                <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                  {uploadQueue.map(item => (
                    <div key={item.id} className="p-3.5 rounded-xl bg-white/5 border border-outline-variant/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all duration-200">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <FileText className="text-primary shrink-0" size={18} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-white truncate">{item.name}</p>
                          <p className="text-[10px] text-outline mt-0.5">
                            {item.type === 'application/pdf' ? 'Documento PDF' : 'Imagen'}
                          </p>
                        </div>
                      </div>

                      {/* Estado y Barra de Progreso */}
                      <div className="flex items-center gap-4 shrink-0">
                        {item.status === 'pending' && (
                          <span className="text-[10px] font-semibold text-outline bg-white/5 px-2 py-1 rounded">En espera</span>
                        )}
                        {item.status === 'processing' && (
                          <div className="flex items-center gap-3">
                            <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                              <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${item.progress}%` }}></div>
                            </div>
                            <span className="text-[10px] font-semibold text-primary font-mono">{item.progress}%</span>
                          </div>
                        )}
                        {item.status === 'success' && (
                          <div className="flex items-center gap-1.5 text-green-400 bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-lg">
                            <CheckCircle size={14} />
                            <span className="text-[10px] font-semibold">Convertido</span>
                          </div>
                        )}
                        {item.status === 'error' && (
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  retryQueueItem(item.id);
                                }}
                                className="flex items-center gap-1 text-[10px] font-semibold text-primary hover:text-white bg-primary/10 border border-primary/20 hover:bg-primary/30 transition-all px-2.5 py-1 rounded-lg cursor-pointer"
                                title="Reintentar procesamiento"
                              >
                                <RefreshCw size={10} className="hover:rotate-180 transition-transform duration-500" />
                                <span>Reintentar</span>
                              </button>
                              <div className="flex items-center gap-1.5 text-red-400 bg-red-500/10 border border-red-500/20 px-2.5 py-1 rounded-lg">
                                <AlertTriangle size={14} />
                                <span className="text-[10px] font-semibold">Error</span>
                              </div>
                            </div>
                            {item.errorMsg && (
                              <p 
                                className="text-[9px] text-red-300 max-w-[180px] text-right truncate cursor-pointer hover:underline" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  showToast(item.errorMsg || 'Error en conversión', 'error');
                                }}
                                title="Click para ver error completo"
                              >
                                {item.errorMsg}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center gap-6 opacity-60 text-xs text-outline">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">lock</span>
                Datos cifrados en cliente
              </span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">bolt</span>
                Extracción OCR por lotes
              </span>
            </div>
          </main>
        )}

        {viewState === 'workspace' && currentFile && (
          /* WORKSPACE DE 3 COLUMNAS */
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden pb-16 sm:pb-0">
            {/* Control de pestañas superior exclusivo para versión Móvil */}
            {isMobile && (
              <div className="flex bg-surface-container border-b border-outline-variant shrink-0 z-30">
                <button 
                  onClick={() => setActiveWorkspaceTab('visor')}
                  className={`flex-1 py-3 text-xs font-semibold text-center border-b-2 transition-colors ${
                    activeWorkspaceTab === 'visor' 
                      ? 'border-primary text-primary bg-white/2' 
                      : 'border-transparent text-outline hover:text-white'
                  }`}
                >
                  Visualizar Origen
                </button>
                <button 
                  onClick={() => setActiveWorkspaceTab('markdown')}
                  className={`flex-1 py-3 text-xs font-semibold text-center border-b-2 transition-colors ${
                    activeWorkspaceTab === 'markdown' 
                      ? 'border-primary text-primary bg-white/2' 
                      : 'border-transparent text-outline hover:text-white'
                  }`}
                >
                  Markdown / Editor
                </button>
              </div>
            )}

            {/* Columna 2: Visor de Documento */}
            <section className={`flex-1 flex flex-col min-w-0 border-r border-outline-variant bg-[#0F0F11] ${isMobile && activeWorkspaceTab !== 'visor' ? 'hidden' : 'flex'}`}>
              <header className="h-10 flex items-center justify-between px-4 bg-surface-container/60 shrink-0 select-none">
                <span className="text-[11px] font-medium text-outline uppercase tracking-wider font-label-caps">Visor de Origen</span>
                <div className="flex items-center gap-2 bg-surface p-0.5 rounded border border-outline-variant/30">
                  <button 
                    onClick={() => setZoomLevel(prev => Math.max(prev - 10, 50))}
                    className="p-1 hover:bg-white/10 rounded text-outline hover:text-white"
                  >
                    <ZoomOut size={14} />
                  </button>
                  <span className="text-[10px] font-label-caps text-outline w-10 text-center">{zoomLevel}%</span>
                  <button 
                    onClick={() => setZoomLevel(prev => Math.min(prev + 10, 200))}
                    className="p-1 hover:bg-white/10 rounded text-outline hover:text-white"
                  >
                    <ZoomIn size={14} />
                  </button>
                </div>
              </header>

              <div className="flex-1 overflow-auto p-4 sm:p-6 flex justify-center items-start">
                <div 
                  style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top center' }}
                  className="w-full max-w-[680px] bg-white rounded-xl shadow-2xl overflow-hidden transition-transform duration-200"
                >
                  {currentFile.type === 'application/pdf' ? (
                    fileUrl ? (
                      <iframe 
                        src={`${fileUrl}#toolbar=0&navpanes=0&scrollbar=0`} 
                        className="w-full aspect-[1/1.414] border-none"
                      />
                    ) : (
                      <div className="aspect-[1/1.414] w-full bg-zinc-100 flex flex-col items-center justify-center p-8 text-center text-zinc-500">
                        <FileText size={48} className="mb-4 text-zinc-400" />
                        <p className="text-sm font-semibold">Cargando visor PDF...</p>
                      </div>
                    )
                  ) : (
                    fileUrl ? (
                      <img src={fileUrl} alt="Documento original" className="w-full h-auto" />
                    ) : (
                      <div className="aspect-[1/1.414] w-full bg-zinc-100 flex flex-col items-center justify-center p-8 text-center text-zinc-500">
                        <ImageIcon size={48} className="mb-4 text-zinc-400" />
                        <p className="text-sm font-semibold">Cargando imagen...</p>
                      </div>
                    )
                  )}
                </div>
              </div>
            </section>

            {/* Columna 3: Editor y Previsualización Markdown */}
            <section className={`w-full md:w-[520px] flex flex-col shrink-0 bg-surface ${isMobile && activeWorkspaceTab !== 'markdown' ? 'hidden' : 'flex'}`}>
              <header className="h-10 flex items-center justify-between px-4 bg-surface-container-high/60 shrink-0 border-b border-outline-variant">
                <div className="flex items-center gap-1 h-full">
                  <button 
                    onClick={() => setActiveTab('code')}
                    className={`h-full px-3 text-xs font-semibold flex items-center gap-1.5 transition-all relative ${
                      activeTab === 'code' ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <Code size={14} />
                    <span>Código Markdown</span>
                    {activeTab === 'code' && <div className="active-tab-indicator w-full"></div>}
                  </button>
                  <button 
                    onClick={() => setActiveTab('preview')}
                    className={`h-full px-3 text-xs font-semibold flex items-center gap-1.5 transition-all relative ${
                      activeTab === 'preview' ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <Eye size={14} />
                    <span>Previsualización</span>
                    {activeTab === 'preview' && <div className="active-tab-indicator w-full"></div>}
                  </button>
                </div>
              </header>

              <div className="flex-1 overflow-y-auto p-5 sm:p-6">
                {isConverting ? (
                  <div className="space-y-6 skeleton-item">
                    <div className="w-1/3 h-5 bg-surface-container-highest rounded"></div>
                    <div className="w-3/4 h-10 bg-surface-container-highest rounded-xl"></div>
                    <div className="p-4 bg-surface-container-high/40 rounded-xl border border-outline-variant/10 grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <div className="w-12 h-2.5 bg-primary/20 rounded"></div>
                        <div className="w-24 h-4 bg-surface-container-highest rounded"></div>
                      </div>
                      <div className="space-y-1.5">
                        <div className="w-12 h-2.5 bg-primary/20 rounded"></div>
                        <div className="w-24 h-4 bg-surface-container-highest rounded"></div>
                      </div>
                    </div>
                  </div>
                ) : activeTab === 'code' ? (
                  <textarea 
                    value={convertedMarkdown}
                    onChange={(e) => setConvertedMarkdown(e.target.value)}
                    placeholder="Haz clic en 'Convertir con Gemini' para iniciar el procesamiento OCR del documento..."
                    className="w-full h-full min-h-[350px] bg-transparent border-none text-on-surface-variant font-mono text-sm leading-relaxed p-0 focus:ring-0 focus:outline-none resize-none"
                  />
                ) : (
                  <div 
                    className="prose prose-invert max-w-none text-on-surface-variant break-words"
                    dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(convertedMarkdown) }}
                  />
                )}
              </div>

              {/* Statusbar inferior */}
              <footer className="h-8 bg-surface-container border-t border-outline-variant px-4 flex items-center justify-between text-[9px] uppercase tracking-wider font-label-caps text-outline shrink-0">
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${isConverting ? 'bg-primary animate-pulse' : convertedMarkdown ? 'bg-green-500' : 'bg-outline'}`}></div>
                  <span>{isConverting ? 'Procesando...' : convertedMarkdown ? 'Listo' : 'Esperando conversión'}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span>UTF-8</span>
                  {gdriveToken && <span className="hidden sm:inline">Nube Activa</span>}
                </div>
              </footer>
            </section>
          </div>
        )}
      </div>

      {/* Menú de navegación inferior exclusivo para Vista Mobile */}
      {isMobile && (
        <div className="fixed bottom-0 left-0 right-0 h-16 bg-surface-container/90 backdrop-blur-md border-t border-outline-variant/30 flex items-center justify-around z-45 px-4 shadow-2xl">
          <button 
            onClick={handleGoDashboard} 
            className={`flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors w-16 h-full ${
              viewState === 'dashboard' ? 'text-primary' : 'text-outline hover:text-white'
            }`}
          >
            <Home size={18} />
            <span>Inicio</span>
          </button>
          
          <button 
            onClick={handleNewDocument} 
            className={`flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors w-16 h-full ${
              viewState === 'import' ? 'text-primary' : 'text-outline hover:text-white'
            }`}
          >
            <Plus size={18} />
            <span>Nuevo</span>
          </button>

          <button 
            onClick={() => setIsHistoryDrawerOpen(true)} 
            className="flex flex-col items-center justify-center gap-1 text-[10px] font-semibold text-outline hover:text-white w-16 h-full"
          >
            <History size={18} />
            <span>Historial</span>
          </button>

          <button 
            onClick={() => setIsSettingsOpen(true)} 
            className="flex flex-col items-center justify-center gap-1 text-[10px] font-semibold text-outline hover:text-white w-16 h-full"
          >
            <Settings size={18} />
            <span>Ajustes</span>
          </button>
        </div>
      )}

      {/* Cajón (Drawer) de Historial en Vista Mobile */}
      {isMobile && isHistoryDrawerOpen && (
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex justify-end animate-fade-in" 
          onClick={() => setIsHistoryDrawerOpen(false)}
        >
          <div 
            className="w-[280px] bg-surface-container-high h-full p-6 flex flex-col shadow-2xl border-l border-outline-variant/20" 
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6 pb-3 border-b border-outline-variant/30">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 font-label-caps">
                <History size={16} />
                <span>Historial Reciente</span>
              </h3>
              <button onClick={() => setIsHistoryDrawerOpen(false)} className="p-1 hover:bg-white/10 rounded text-white transition-colors">
                <X size={18} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {historyList.length === 0 ? (
                <p className="text-xs text-outline italic">No hay conversiones guardadas.</p>
              ) : (
                historyList.slice(0, 5).map((item) => (
                  <div 
                    key={item.id} 
                    onClick={() => {
                      handleSelectHistoryItem(item);
                      setIsHistoryDrawerOpen(false);
                    }}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                      currentFile?.id === item.id && viewState === 'workspace'
                        ? 'bg-primary/10 text-primary border-l-2 border-primary' 
                        : 'text-on-surface-variant hover:bg-white/5 hover:text-on-surface'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FileText size={14} className="shrink-0" />
                      <span className="text-xs truncate">{item.nombre_archivo}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* VENTANA FLOTANTE PREMIUM PARA VISUALIZAR MARKDOWN (Raw Text UTF-8) */}
      {selectedMarkdownText !== null && (
        <div 
          className="fixed inset-0 bg-[#0F0F11]/85 backdrop-blur-md z-[120] flex items-center justify-center p-4 sm:p-6 animate-fade-in"
          onClick={() => setSelectedMarkdownText(null)}
        >
          <div 
            className="w-full max-w-3xl h-[80vh] bg-surface-container-high/80 backdrop-blur-2xl border border-blue-500/50 shadow-[0_0_25px_rgba(59,130,246,0.25)] rounded-3xl p-6 flex flex-col relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabecera del visualizador */}
            <div className="flex items-center justify-between border-b border-outline-variant/30 pb-4 mb-4 select-none">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText className="text-blue-400 shrink-0" size={20} />
                <h3 className="text-base font-bold text-white truncate pr-4">{selectedMarkdownFileName}</h3>
              </div>
              
              <div className="flex items-center gap-2 shrink-0">
                {/* Botón copiar */}
                <button 
                  onClick={() => handleCopyText(selectedMarkdownText)}
                  className={`p-2 rounded-xl border transition-all flex items-center gap-1.5 text-xs font-semibold ${
                    isCopied 
                      ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                      : 'bg-white/5 hover:bg-white/10 border-white/5 text-outline hover:text-white'
                  }`}
                  title="Copiar contenido"
                >
                  {isCopied ? <CheckCircle size={14} /> : <Copy size={14} />}
                  <span>{isCopied ? 'Copiado' : 'Copiar'}</span>
                </button>

                {/* Botón descargar */}
                <button 
                  onClick={() => {
                    downloadMarkdown(selectedMarkdownFileName, selectedMarkdownText);
                    showToast('Archivo Markdown descargado con éxito.', 'success');
                  }}
                  className="p-2 bg-white/5 hover:bg-white/10 border border-white/5 text-outline hover:text-white rounded-xl transition-all flex items-center gap-1.5 text-xs font-semibold"
                  title="Descargar archivo .md"
                >
                  <Download size={14} />
                  <span>Descargar</span>
                </button>

                {/* Botón cerrar */}
                <button 
                  onClick={() => setSelectedMarkdownText(null)}
                  className="p-2 bg-white/5 hover:bg-red-500/10 border border-white/5 hover:border-red-500/20 text-outline hover:text-red-400 rounded-xl transition-all"
                  title="Cerrar visor"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Contenido en UTF-8 plano */}
            <div className="flex-1 overflow-auto bg-black/40 border border-outline-variant/10 rounded-2xl p-5 font-mono text-sm leading-relaxed text-on-surface-variant select-text whitespace-pre-wrap">
              {selectedMarkdownText || 'No hay contenido para mostrar.'}
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE AJUSTES PREMIUM */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-[#0F0F11]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface-container-high border border-outline-variant/30 rounded-3xl p-6 shadow-2xl modal-entrance">
            <div className="flex items-center gap-2.5 mb-6">
              <Settings className="text-primary" size={22} />
              <h3 className="text-lg font-bold text-white">Configuración del Sistema</h3>
            </div>
            
            <div className="space-y-4 mb-8">
              {/* API Key de Gemini */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-primary tracking-wider font-label-caps uppercase flex items-center gap-1.5">
                  <Key size={12} />
                  <span>API Key de Google Gemini</span>
                </label>
                <input 
                  type="password"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder="Introduce tu AI API Key de Gemini..."
                  className="w-full px-4 h-11 bg-surface rounded-xl border border-outline-variant/40 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                />
                <p className="text-[10px] text-outline leading-snug">
                  La API key se utiliza exclusivamente para realizar las llamadas de conversión desde tu navegador. Consíguela en Google AI Studio.
                </p>
              </div>

              {/* Google Drive Client ID */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-primary tracking-wider font-label-caps uppercase flex items-center gap-1.5">
                  <Globe size={12} />
                  <span>Google Client ID</span>
                </label>
                <input 
                  type="text"
                  value={googleClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                  placeholder="Introduce tu OAuth 2.0 Client ID..."
                  className="w-full px-4 h-11 bg-surface rounded-xl border border-outline-variant/40 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                />
                <p className="text-[10px] text-outline leading-snug">
                  Requerido para la autenticación de OAuth 2.0 de Google Drive. Consíguelo en Google Cloud Console creando una credencial de tipo "ID de cliente de OAuth".
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="px-5 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-white font-semibold text-xs transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={saveSettings}
                className="px-5 h-10 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-semibold text-xs transition-all shadow-lg"
              >
                Guardar Ajustes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
