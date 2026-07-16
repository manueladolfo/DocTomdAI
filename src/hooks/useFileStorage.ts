import localforage from 'localforage';

export interface StoredFile {
  id: string;
  name: string;
  blob: Blob;
  type: string;
  uploadedAt: string;
}

// Crear instancia dedicada de localForage para archivos de origen
const fileStore = localforage.createInstance({
  name: 'DocToMarkdown',
  storeName: 'source_documents'
});

export const useFileStorage = () => {
  const storeFile = async (id: string, name: string, blob: Blob, type: string): Promise<StoredFile> => {
    const storedFile: StoredFile = {
      id,
      name,
      blob,
      type,
      uploadedAt: new Date().toISOString()
    };
    await fileStore.setItem(id, storedFile);
    return storedFile;
  };

  const getFile = async (id: string): Promise<StoredFile | null> => {
    try {
      const file = await fileStore.getItem<StoredFile>(id);
      return file;
    } catch (error) {
      console.error('Error al obtener el archivo de IndexedDB:', error);
      return null;
    }
  };

  const deleteFile = async (id: string): Promise<void> => {
    try {
      await fileStore.removeItem(id);
    } catch (error) {
      console.error('Error al eliminar el archivo de IndexedDB:', error);
    }
  };

  const listStoredFiles = async (): Promise<StoredFile[]> => {
    const files: StoredFile[] = [];
    try {
      await fileStore.iterate<StoredFile, void>((value) => {
        files.push(value);
      });
      // Ordenar por fecha de subida de más reciente a más antiguo
      return files.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    } catch (error) {
      console.error('Error al iterar sobre IndexedDB:', error);
      return [];
    }
  };

  const clearAllFiles = async (): Promise<void> => {
    try {
      await fileStore.clear();
    } catch (error) {
      console.error('Error al limpiar el almacenamiento local de archivos:', error);
    }
  };

  return {
    storeFile,
    getFile,
    deleteFile,
    listStoredFiles,
    clearAllFiles
  };
};
