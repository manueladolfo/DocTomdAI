import localforage from 'localforage';

export interface StoredFile {
  id: string;
  name: string;
  blob: Blob;
  type: string;
  uploadedAt: string;
}

// Estructura interna de almacenamiento para IndexedDB que evita bugs en WebKit/Safari iOS
interface DBStoredFile {
  id: string;
  name: string;
  arrayBuffer: ArrayBuffer;
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
    const arrayBuffer = await blob.arrayBuffer();
    const uploadedAt = new Date().toISOString();
    const dbStoredFile: DBStoredFile = {
      id,
      name,
      arrayBuffer,
      type,
      uploadedAt
    };
    await fileStore.setItem(id, dbStoredFile);
    
    return {
      id,
      name,
      blob,
      type,
      uploadedAt
    };
  };

  const getFile = async (id: string): Promise<StoredFile | null> => {
    try {
      const data = await fileStore.getItem<any>(id);
      if (!data) return null;

      // Retrocompatibilidad: Si el archivo ya existía con el formato antiguo de Blob nativo
      let blob: Blob;
      if (data.arrayBuffer) {
        blob = new Blob([data.arrayBuffer], { type: data.type });
      } else if (data.blob) {
        blob = data.blob;
      } else {
        return null;
      }

      return {
        id: data.id,
        name: data.name,
        blob,
        type: data.type,
        uploadedAt: data.uploadedAt
      };
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
      await fileStore.iterate<any, void>((value) => {
        let blob: Blob;
        if (value.arrayBuffer) {
          blob = new Blob([value.arrayBuffer], { type: value.type });
        } else if (value.blob) {
          blob = value.blob;
        } else {
          return;
        }

        files.push({
          id: value.id,
          name: value.name,
          blob,
          type: value.type,
          uploadedAt: value.uploadedAt
        });
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
