import localforage from 'localforage';

export interface Conversion {
  id: string;
  nombre_archivo: string;
  fecha_conversion: string;
  texto_md_resultado: string;
}

// Crear instancia dedicada de localForage para el historial de conversiones
const historyStore = localforage.createInstance({
  name: 'DocToMarkdown',
  storeName: 'conversion_history'
});

export const useConversionHistory = () => {
  const saveConversion = async (
    id: string,
    nombre_archivo: string,
    texto_md_resultado: string
  ): Promise<Conversion> => {
    const newConversion: Conversion = {
      id,
      nombre_archivo,
      fecha_conversion: new Date().toISOString(),
      texto_md_resultado
    };
    await historyStore.setItem(id, newConversion);
    return newConversion;
  };

  const getConversion = async (id: string): Promise<Conversion | null> => {
    try {
      return await historyStore.getItem<Conversion>(id);
    } catch (error) {
      console.error('Error al obtener conversión del historial local:', error);
      return null;
    }
  };

  const listConversions = async (): Promise<Conversion[]> => {
    const list: Conversion[] = [];
    try {
      await historyStore.iterate<Conversion, void>((value) => {
        list.push(value);
      });
      // Ordenar cronológicamente (más recientes primero)
      return list.sort(
        (a, b) =>
          new Date(b.fecha_conversion).getTime() - new Date(a.fecha_conversion).getTime()
      );
    } catch (error) {
      console.error('Error al iterar sobre el historial de IndexedDB:', error);
      return [];
    }
  };

  const deleteConversion = async (id: string): Promise<void> => {
    try {
      await historyStore.removeItem(id);
    } catch (error) {
      console.error('Error al borrar conversión del historial local:', error);
    }
  };

  const clearHistory = async (): Promise<void> => {
    try {
      await historyStore.clear();
    } catch (error) {
      console.error('Error al vaciar el historial local:', error);
    }
  };

  // Importar en bloque (restauración desde Google Drive)
  const importHistory = async (conversions: Conversion[]): Promise<void> => {
    try {
      // Limpiar historial anterior para evitar duplicaciones extrañas
      await historyStore.clear();
      for (const item of conversions) {
        await historyStore.setItem(item.id, item);
      }
    } catch (error) {
      console.error('Error al importar historial en bloque:', error);
      throw error;
    }
  };

  return {
    saveConversion,
    getConversion,
    listConversions,
    deleteConversion,
    clearHistory,
    importHistory
  };
};
