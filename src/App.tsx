import { useState, useEffect, useRef } from 'react';
import { 
  FileText, 
  Image as ImageIcon, 
  Upload, 
  Cloud, 
  History, 
  Settings, 
  LogOut, 
  ArrowLeft, 
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
  Plus
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
  const [geminiApiKey, setGeminiApiKey] = useState<string>(localStorage.getItem('gemini_api_key') || '');
  const [googleClientId, setGoogleClientId] = useState<string>(localStorage.getItem('gdrive_client_id') || '');
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

  // Referencias para arrastrar y soltar
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      await processUploadedFile(selectedFiles[0]);
    }
  };

  const processUploadedFile = async (file: File) => {
    if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
      showToast('Error: Solo se admiten archivos PDF o imágenes.', 'error');
      return;
    }

    try {
      const id = crypto.randomUUID();
      const stored = await fileStorage.storeFile(id, file.name, file, file.type);
      setCurrentFile(stored);
      setConvertedMarkdown('');
      setViewState('workspace');
      showToast(`Archivo "${file.name}" cargado localmente.`, 'success');
      loadLocalData();
    } catch (error) {
      showToast('Error al almacenar el archivo localmente.', 'error');
    }
  };

  const triggerFileBrowser = () => {
    fileInputRef.current?.click();
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      await processUploadedFile(droppedFiles[0]);
    }
  };

  // Guardar configuración de Ajustes
  const saveSettings = () => {
    localStorage.setItem('gemini_api_key', geminiApiKey);
    localStorage.setItem('gdrive_client_id', googleClientId);
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

  // Convertir documento con Gemini
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
      
      // Guardar en el historial local
      await historyStorage.saveConversion(currentFile.id, currentFile.name, result);
      
      showToast('Conversión finalizada con éxito.', 'success');
      loadLocalData();

      // Sincronizar automáticamente con Google Drive si está conectado
      const cachedToken = getCachedAccessToken();
      if (cachedToken) {
        triggerAutoSync(cachedToken);
      }
    } catch (error: any) {
      showToast(error.message || 'Error en la conversión.', 'error');
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

      // Sincronización bidireccional inicial: descargar historial y archivos existentes
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
        // Si no hay datos en la nube, subimos los locales actuales
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

  // Forzar sincronización manual
  const handleManualSync = async () => {
    const token = getCachedAccessToken() || gdriveToken;
    if (!token) {
      handleConnectGoogleDrive();
      return;
    }

    try {
      setIsSyncing(true);
      setSyncStatus('Iniciando sincronización manual...');
      await syncToGoogleDrive(token, historyList, filesList, (status) => setSyncStatus(status));
      showToast('Sincronización manual completada.', 'success');
      setSyncStatus(null);
      setIsSyncing(false);
    } catch (error: any) {
      setSyncStatus(null);
      setIsSyncing(false);
      showToast(error.message || 'Error en la sincronización manual.', 'error');
    }
  };

  // Seleccionar archivo del historial
  const handleSelectHistoryItem = async (item: Conversion) => {
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

  // Descarga local
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

  // Renderizar Markdown básico a HTML para previsualización
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
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] w-auto max-w-md toast-entrance">
          <div className="bg-red-500/90 backdrop-blur-xl border border-white/10 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3">
            <AlertCircle className="text-white shrink-0" size={20} />
            <p className="text-white text-sm font-medium">{errorMsg}</p>
            <button onClick={() => setErrorMsg(null)} className="ml-2 hover:bg-white/10 p-1 rounded-lg transition-colors">
              <span className="material-symbols-outlined text-[18px] text-white">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Toast de éxito */}
      {successMsg && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] w-auto max-w-md toast-entrance">
          <div className="bg-green-500/90 backdrop-blur-xl border border-white/10 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3">
            <CheckCircle className="text-white shrink-0" size={20} />
            <p className="text-white text-sm font-medium">{successMsg}</p>
            <button onClick={() => setSuccessMsg(null)} className="ml-2 hover:bg-white/10 p-1 rounded-lg transition-colors">
              <span className="material-symbols-outlined text-[18px] text-white">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Pantalla de carga animada para sincronización de Google Drive */}
      {isSyncing && (
        <div className="fixed inset-0 bg-[#0F0F11]/90 backdrop-blur-xl z-[90] flex flex-col items-center justify-center">
          <div className="w-full max-w-md p-8 flex flex-col items-center text-center">
            <div className="relative mb-8">
              <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
              <Cloud className="absolute inset-0 m-auto text-primary animate-pulse" size={24} />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Google Drive Sync</h3>
            <p className="text-on-surface-variant text-sm animate-pulse">{syncStatus}</p>
            <div className="w-48 h-1 bg-white/5 rounded-full overflow-hidden mt-6">
              <div className="h-full bg-primary rounded-full animate-infinite-scroll w-1/3"></div>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar lateral */}
      <aside className="flex flex-col h-screen fixed left-0 top-0 z-40 bg-surface-container dark:bg-surface-container-high border-r border-outline-variant w-[260px] shrink-0">
        <div className="p-6 flex flex-col h-full">
          {/* Logo ocupando gran parte de arriba a la izquierda sin textos adicionales */}
          <div className="mb-8 cursor-pointer px-2 flex justify-center" onClick={handleGoDashboard}>
            <img src="/logo.png" alt="Logo de DocToMarkdown" className="w-full max-h-14 object-contain" />
          </div>

          {/* Botones de control rápido */}
          <div className="space-y-2 mb-6">
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

            {gdriveToken ? (
              <div className="space-y-1">
                <button 
                  onClick={handleManualSync}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 text-green-400 rounded-xl transition-all duration-200"
                >
                  <div className="flex items-center gap-3">
                    <RefreshCw size={14} className="animate-spin-slow" />
                    <span className="text-body-sm font-medium">Sincronizado</span>
                  </div>
                  <span className="text-[9px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded font-label-caps uppercase">Nube</span>
                </button>
                <button 
                  onClick={handleDisconnectGoogleDrive}
                  className="w-full flex items-center gap-3 px-4 py-2 text-on-surface-variant hover:text-red-400 rounded-xl transition-all duration-200 text-left text-xs"
                >
                  <LogOut size={12} />
                  <span>Desconectar Drive</span>
                </button>
              </div>
            ) : (
              <button 
                onClick={handleConnectGoogleDrive}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-surface border border-outline-variant hover:bg-surface-variant rounded-xl transition-all duration-200 group"
              >
                <Cloud className="text-primary group-hover:scale-110 transition-transform" size={18} />
                <span className="text-body-sm font-medium">Google Drive Backup</span>
              </button>
            )}
          </div>

          {/* Listado de Historial */}
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
                  {historyList.map((item) => (
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

      {/* Workspace principal */}
      <div className="flex-1 flex flex-col ml-[260px] h-screen overflow-hidden">
        {/* Header superior */}
        <header className="h-16 flex items-center justify-between px-8 bg-surface-container-low border-b border-outline-variant z-35 shrink-0">
          <div className="flex items-center gap-3">
            {viewState !== 'dashboard' && (
              <button onClick={handleGoDashboard} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-outline hover:text-white mr-2">
                <ArrowLeft size={16} />
              </button>
            )}
            <FileText className="text-primary shrink-0" size={18} />
            <h2 className="text-body-md font-medium text-white truncate max-w-md">
              {viewState === 'dashboard' && 'Dashboard Principal'}
              {viewState === 'import' && 'Nuevo Documento / Importar'}
              {viewState === 'workspace' && currentFile && currentFile.name}
            </h2>
          </div>
          
          <div className="flex items-center gap-3">
            {viewState === 'workspace' && currentFile && (
              <>
                <button 
                  onClick={handleConvert}
                  disabled={isConverting}
                  className="px-4 h-9 rounded-lg bg-primary hover:bg-primary-container text-on-primary font-semibold text-xs transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConverting ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      <span>Extrayendo...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw size={12} />
                      <span>Convertir con Gemini</span>
                    </>
                  )}
                </button>
                <button 
                  onClick={handleDownload}
                  disabled={!convertedMarkdown}
                  className={`px-4 h-9 rounded-lg font-semibold text-xs transition-all active:scale-95 flex items-center gap-2 shadow-lg ${
                    convertedMarkdown 
                      ? 'bg-white/5 hover:bg-white/10 text-white border border-outline-variant' 
                      : 'bg-white/5 text-outline cursor-not-allowed opacity-50'
                  }`}
                >
                  <Download size={12} />
                  <span>Descargar .md</span>
                </button>
              </>
            )}
          </div>
        </header>

        {/* Zona de contenido dinámico */}
        {viewState === 'dashboard' && (
          /* NUEVO DASHBOARD PREMIUM ANIMADO */
          <main className="flex-1 p-10 overflow-y-auto bg-background flex flex-col justify-between">
            {/* Cabecera del Dashboard */}
            <div className="space-y-2 mt-4 animate-fade-in">
              <h3 className="text-3xl font-bold text-white tracking-tight">Bienvenido a DocToMarkdown</h3>
              <p className="text-on-surface-variant text-sm max-w-2xl">
                Tu centro local de transcripción y maquetación de archivos. Convierte PDFs y capturas a Markdown de forma privada e instantánea.
              </p>
            </div>

            {/* Fila de Tarjetas de Estadísticas Animadas */}
            <div className="grid grid-cols-4 gap-6 my-8">
              {/* Card 1: Documentos Procesados */}
              <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between hover:border-primary/30 transition-all duration-300 group">
                <div className="flex items-center justify-between text-outline mb-4">
                  <span className="text-xs font-semibold uppercase tracking-wider font-label-caps">Procesados</span>
                  <FileText className="text-primary group-hover:scale-110 transition-transform" size={18} />
                </div>
                <div>
                  <h4 className="text-4xl font-extrabold text-white mb-1 animate-pulse-slow">
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
                  <h4 className="text-4xl font-extrabold text-white mb-1">
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
                  <h4 className="text-4xl font-extrabold text-white mb-1">
                    {calculateStorageSize()}
                  </h4>
                  <p className="text-[11px] text-on-surface-variant">Caché IndexedDB utilizada</p>
                </div>
              </div>

              {/* Card 4: Sincronización en la Nube */}
              <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between hover:border-primary/30 transition-all duration-300 group">
                <div className="flex items-center justify-between text-outline mb-4">
                  <span className="text-xs font-semibold uppercase tracking-wider font-label-caps">Cloud Backup</span>
                  <Cloud className={gdriveToken ? "text-green-400 animate-pulse" : "text-outline"} size={18} />
                </div>
                <div>
                  <h4 className={`text-xl font-bold mb-1 ${gdriveToken ? 'text-green-400' : 'text-outline'}`}>
                    {gdriveToken ? 'Sincronizado' : 'Desconectado'}
                  </h4>
                  <p className="text-[11px] text-on-surface-variant">
                    {gdriveToken ? 'Respaldo activo en Google Drive' : 'Vincular Google Drive en Ajustes'}
                  </p>
                </div>
              </div>
            </div>

            {/* Gran Botón de Acción Central (Bento style) */}
            <div className="grid grid-cols-12 gap-6 items-stretch mb-4">
              <div 
                onClick={handleNewDocument}
                className="col-span-8 glass-panel rounded-3xl p-8 flex flex-col justify-between group cursor-pointer hover:bg-white/5 transition-all duration-300 hover:border-primary/40 relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none group-hover:bg-primary/10 transition-colors"></div>
                <div className="flex justify-between items-start mb-12 relative z-10">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
                    <Upload size={24} />
                  </div>
                  <span className="text-xs font-label-caps uppercase tracking-wider text-primary border border-primary/20 px-3 py-1 rounded-full bg-primary/5">
                    Comenzar
                  </span>
                </div>
                <div className="relative z-10">
                  <h4 className="text-2xl font-bold text-white mb-2 group-hover:text-primary transition-colors flex items-center gap-2">
                    Iniciar Nueva Conversión
                    <span className="material-symbols-outlined text-[20px] transform group-hover:translate-x-1 transition-transform">arrow_forward</span>
                  </h4>
                  <p className="text-on-surface-variant text-sm max-w-lg leading-relaxed">
                    Sube un nuevo PDF, presupuesto, balance de sumas y saldos, o una captura para convertirla a Markdown estructurado al instante.
                  </p>
                </div>
              </div>

              <div 
                onClick={() => setIsSettingsOpen(true)}
                className="col-span-4 glass-panel rounded-3xl p-8 flex flex-col justify-between group cursor-pointer hover:bg-white/5 transition-all duration-300 hover:border-primary/30 relative overflow-hidden"
              >
                <div className="flex justify-between items-start mb-12">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-outline group-hover:scale-105 transition-transform">
                    <Settings size={24} />
                  </div>
                </div>
                <div>
                  <h4 className="text-lg font-bold text-white mb-1 group-hover:text-white/80 transition-colors">Ajustes de API</h4>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    Introduce tu API Key de Gemini y Google Client ID para habilitar la transcripción automática y los respaldos.
                  </p>
                </div>
              </div>
            </div>

            {/* Actividad Reciente */}
            {historyList.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-bold font-label-caps uppercase tracking-widest text-outline mb-3 flex items-center gap-2">
                  <Clock size={12} />
                  <span>Últimos documentos procesados</span>
                </h4>
                <div className="grid grid-cols-3 gap-4">
                  {historyList.slice(0, 3).map((item) => (
                    <div 
                      key={item.id} 
                      onClick={() => handleSelectHistoryItem(item)}
                      className="glass-panel p-4 rounded-xl cursor-pointer hover:bg-white/5 hover:border-outline transition-all duration-200 flex items-center gap-3"
                    >
                      <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-primary">
                        <FileText size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-white truncate">{item.nombre_archivo}</p>
                        <p className="text-[10px] text-outline mt-0.5">
                          {new Date(item.fecha_conversion).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </main>
        )}

        {viewState === 'import' && (
          /* PANTALLA DE CARGA DE NUEVO DOCUMENTO (DROPZONE ANTERIOR) */
          <main className="flex-1 p-8 overflow-y-auto flex flex-col items-center justify-center relative bg-background">
            <div className="w-full max-w-4xl text-center mb-10">
              <h3 className="text-3xl font-bold text-white mb-2 leading-tight">Carga tu documento</h3>
              <p className="text-on-surface-variant text-sm">
                Arrastra y suelta tus archivos para iniciar la conversión con la API de Gemini.
              </p>
            </div>

            {/* Layout Bento de Carga */}
            <div className="grid grid-cols-12 gap-6 w-full max-w-4xl h-[400px]">
              <div 
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={triggerFileBrowser}
                className="col-span-8 glass-panel rounded-3xl flex flex-col items-center justify-center p-8 relative transition-all duration-300 group cursor-pointer hover:border-primary/40 hover:bg-white/5"
              >
                <div className="absolute inset-4 border border-dashed border-outline-variant/30 rounded-2xl pointer-events-none group-hover:border-primary/40 transition-colors"></div>
                <div className="relative z-10 flex flex-col items-center text-center gap-4">
                  <div className="flex items-center -space-x-4 mb-2">
                    <div className="w-14 h-14 bg-surface-container-highest rounded-xl flex items-center justify-center shadow-lg border border-white/5 transform -rotate-6 transition-transform group-hover:-rotate-12">
                      <FileText size={28} className="text-red-400" />
                    </div>
                    <div className="w-16 h-16 bg-surface-container-highest rounded-xl flex items-center justify-center shadow-2xl border border-white/10 z-20 transition-transform group-hover:scale-105">
                      <Upload size={32} className="text-primary" />
                    </div>
                    <div className="w-14 h-14 bg-surface-container-highest rounded-xl flex items-center justify-center shadow-lg border border-white/5 transform rotate-6 transition-transform group-hover:rotate-12">
                      <ImageIcon size={28} className="text-amber-400" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-lg font-bold text-white">Arrastrar y soltar archivo aquí</p>
                    <p className="text-xs text-on-surface-variant">Soporta PDFs e imágenes (.png, .jpg, .webp)</p>
                  </div>
                  <button className="mt-2 px-6 h-10 rounded-full bg-primary hover:bg-primary-container text-on-primary font-semibold text-xs hover:scale-102 transition-transform active:scale-98 shadow-md">
                    Explorar archivos localmente
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileSelect} 
                    className="hidden" 
                    accept="application/pdf,image/*" 
                  />
                </div>
              </div>

              <div className="col-span-4 flex flex-col gap-6">
                <div 
                  onClick={gdriveToken ? handleManualSync : handleConnectGoogleDrive}
                  className="glass-panel flex-1 rounded-3xl p-6 flex flex-col items-center justify-center text-center hover:bg-white/5 transition-colors cursor-pointer group"
                >
                  <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mb-4 group-hover:bg-white/10 transition-all">
                    <svg className="w-6 h-6" viewBox="0 0 24 24">
                      <path d="M15.445 15.1l3.505-6.09h-3.505z" fill="#4285F4"></path>
                      <path d="M10.315 15.45l3.505 6.09h-3.505z" fill="#34A853"></path>
                      <path d="M6.81 15.1l3.505-6.09H3.305z" fill="#FBBC04"></path>
                      <path d="M10.315 9.36L6.81 15.45l3.505 6.09 3.505-6.09z" fill="#1967D2"></path>
                      <path d="M15.445 9.01L10.315 0h6.81l5.105 9.01z" fill="#167C32"></path>
                      <path d="M10.315 9.36L3.505 21.1h6.81l6.81-11.74z" fill="#F9AB00"></path>
                    </svg>
                  </div>
                  <p className="text-sm font-bold text-white mb-1">Google Drive</p>
                  <p className="text-[11px] text-on-surface-variant mb-4 px-2 leading-snug">
                    {gdriveToken ? 'Respaldo activo en tu nube.' : 'Sincroniza y respalda en tu nube de Google.'}
                  </p>
                  <button className="w-full py-2 rounded-lg bg-white/5 border border-white/10 text-white font-medium text-xs hover:bg-white/10 transition-colors">
                    {gdriveToken ? 'Sincronizar ahora' : 'Vincular cuenta'}
                  </button>
                </div>

                <div className="glass-panel flex-1 rounded-3xl p-6 flex flex-col justify-between relative overflow-hidden bg-gradient-to-br from-primary/5 to-transparent">
                  <div className="flex items-start justify-between">
                    <CheckCircle className="text-primary" size={24} />
                    <span className="text-[9px] uppercase font-bold text-primary/60 tracking-wider font-label-caps">Privacidad</span>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white mb-1 leading-snug">Almacenamiento Local</p>
                    <p className="text-[11px] text-on-surface-variant leading-relaxed">
                      Tus archivos binarios se almacenan localmente en IndexedDB. No se transfieren a bases de datos de terceros.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex items-center gap-6 opacity-60 text-xs text-outline">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">lock</span>
                Datos cifrados en cliente
              </span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">bolt</span>
                Extracción OCR ultrarrápida
              </span>
            </div>
          </main>
        )}

        {viewState === 'workspace' && currentFile && (
          /* WORKSPACE DE 3 COLUMNAS */
          <div className="flex-1 flex overflow-hidden">
            {/* Columna 2: Visor de Documento */}
            <section className="flex-1 flex flex-col min-w-0 border-r border-outline-variant bg-[#0F0F11]">
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

              <div className="flex-1 overflow-auto p-6 flex justify-center items-start">
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
            <section className="w-[520px] flex flex-col shrink-0 bg-surface">
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

              <div className="flex-1 overflow-y-auto p-6">
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
                    className="w-full h-full min-h-[400px] bg-transparent border-none text-on-surface-variant font-mono text-sm leading-relaxed p-0 focus:ring-0 focus:outline-none resize-none"
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
                  <span>{isConverting ? 'Procesando OCR...' : convertedMarkdown ? 'Listo' : 'Esperando conversión'}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span>UTF-8</span>
                  {gdriveToken && <span>Copia de seguridad en la nube</span>}
                </div>
              </footer>
            </section>
          </div>
        )}
      </div>

      {/* MODAL DE AJUSTES PREMIUM */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-[#0F0F11]/80 backdrop-blur-md z-50 flex items-center justify-center">
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
