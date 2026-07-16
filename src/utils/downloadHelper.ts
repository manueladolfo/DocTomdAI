/**
 * Utilidad para forzar la descarga de un archivo de texto (Markdown) en el cliente
 * codificado en UTF-8 y compatible con sistemas de escritorio y móviles.
 */
export const downloadMarkdown = (fileName: string, content: string): void => {
  try {
    // Asegurar que el nombre tenga la extensión .md
    const adjustedName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;

    // Crear un Blob de texto con codificación UTF-8 explícita
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
    
    // Crear enlace temporal en el DOM
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    link.href = url;
    link.setAttribute('download', adjustedName);
    
    // Ocultar el enlace en el body para prevenir saltos de scroll o renderizado
    link.style.position = 'fixed';
    link.style.opacity = '0';
    link.style.top = '0';
    link.style.left = '0';
    
    document.body.appendChild(link);
    
    // Forzar la acción de clic
    link.click();
    
    // Limpieza de memoria y DOM
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error al forzar la descarga del archivo Markdown:', error);
    alert('No se pudo descargar el archivo localmente. Inténtalo de nuevo.');
  }
};
