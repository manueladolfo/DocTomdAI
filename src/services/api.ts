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

// Consultar dinámicamente los modelos autorizados para esta API Key
const fetchAvailableModels = async (apiKey: string): Promise<string[]> => {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    if (data.models && Array.isArray(data.models)) {
      return data.models
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => m.name.replace('models/', ''));
    }
  } catch (e) {
    console.error('Error al listar modelos disponibles:', e);
  }
  return [];
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

  // Obtener modelos permitidos por la API Key del usuario
  const availableModels = await fetchAvailableModels(apiKey);
  console.log('Modelos disponibles detectados para esta clave:', availableModels);

  // Lista de modelos preferidos ordenada por prioridad de calidad y soporte multimodal
  const preferredModels = [
    'gemini-3.5-flash',
    'gemini-3.1-flash-image',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-3.1-flash-lite',
    'gemini-1.5-flash'
  ];

  // Filtrar modelos preferidos que realmente estén disponibles para esta API Key
  const candidateModels = preferredModels.filter(pref => availableModels.includes(pref));

  // Si no se detectó ningún modelo de nuestra lista, usar un fallback razonable
  if (candidateModels.length === 0) {
    const fallbackFlash = availableModels.find(m => m.includes('flash'));
    if (fallbackFlash) {
      candidateModels.push(fallbackFlash);
    } else if (availableModels.length > 0) {
      candidateModels.push(availableModels[0]);
    } else {
      candidateModels.push('gemini-2.0-flash');
    }
  }

  console.log('Modelos candidatos a intentar de forma secuencial:', candidateModels);

  let lastError: any = null;

  for (const candidateModel of candidateModels) {
    console.log(`Intentando transcripción con el modelo: ${candidateModel}`);
    
    // Intentar de forma secuencial la versión de API estable v1 y luego v1beta
    const apiVersions = ['v1', 'v1beta'];

    for (const apiVersion of apiVersions) {
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${candidateModel}:generateContent?key=${apiKey}`;

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

        console.log(`Transcripción exitosa usando el modelo: ${candidateModel} (${apiVersion})`);
        return textResult;
      } catch (error: any) {
        console.warn(`Fallo al invocar la API de Gemini usando el modelo ${candidateModel} versión ${apiVersion}:`, error.message);
        lastError = error;
      }
    }
  }

  // Si fallan todos los intentos, arrojar un error descriptivo con la lista de modelos detectados
  const modelListStr = availableModels.length > 0 ? availableModels.join(', ') : 'Ninguno detectado';
  throw new Error(`Error en la extracción por IA: ${lastError?.message || 'Error desconocido'}. [Modelos disponibles para tu clave: ${modelListStr}]`);
};
