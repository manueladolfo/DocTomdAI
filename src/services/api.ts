/**
 * Servicio para invocar la API de Google Gemini en el cliente para la extracción OCR
 */

const fileToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onload = () => {
      const base64 = reader.result as string;
      const cleanBase64 = base64.substring(base64.indexOf(',') + 1);
      resolve(cleanBase64);
    };
    reader.onerror = (error) => reject(error);
  });
};

export const convertDocumentToMarkdown = async (
  fileBlob: Blob,
  fileMimeType: string,
  apiKey: string
): Promise<string> => {
  if (!apiKey) {
    throw new Error('API Key de Gemini no configurada.');
  }

  // Convertir archivo binario a Base64
  const base64Data = await fileToBase64(fileBlob);

  // Inyección estricta del Prompt de Sistema del Ingeniero OCR Principal
  const systemPrompt = 
    "Actúa como un experto en OCR y maquetación de documentos. Transcribe el siguiente archivo a formato Markdown estricto. Si encuentras tablas de contabilidad, balances o sumas y saldos, reconstrúyelas minuciosamente usando el formato estricto | columna |. No resumas, no te saltes párrafos, mantén intactos todos los valores numéricos con sus correspondientes signos y decimales, y respeta la jerarquía de títulos original utilizando # y ##.";

  // Usamos gemini-1.5-flash o gemini-2.5-flash que admiten PDFs e imágenes natively
  const model = 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: fileMimeType,
              data: base64Data
            }
          }
        ]
      }
    ],
    systemInstruction: {
      parts: [
        {
          text: systemPrompt
        }
      ]
    },
    generationConfig: {
      temperature: 0.1, // Baja temperatura para preservar datos exactos
      topP: 0.95
    }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData.error?.message || `Error HTTP ${response.status}`;
      throw new Error(errMsg);
    }

    const resJson = await response.json();
    
    // Validar y extraer el texto de la respuesta de Gemini
    const textResult = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResult) {
      throw new Error('La respuesta de la IA no contenía texto estructurado.');
    }

    return textResult;
  } catch (error: any) {
    console.error('Error al invocar la API de Gemini:', error);
    throw new Error(`Error en la extracción por IA: ${error.message || error}`);
  }
};
