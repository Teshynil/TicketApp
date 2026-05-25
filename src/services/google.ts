import type { TicketData } from "../types";

let tokenClient: any = null;

export const initTokenClient = (clientId: string, callback: (resp: any) => void) => {
  const tryInit = () => {
    if (typeof (window as any).google !== 'undefined' && (window as any).google.accounts) {
      tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets',
        callback: callback,
      });
      console.log('Google Token Client initialized');
      return true;
    }
    return false;
  };

  if (!tryInit()) {
    console.warn('Google GSI library not ready, retrying in 500ms...');
    const interval = setInterval(() => {
      if (tryInit()) clearInterval(interval);
    }, 500);
    // Timeout after 10 seconds
    setTimeout(() => clearInterval(interval), 10000);
  }
};

export const requestToken = () => {
  if (tokenClient) {
    tokenClient.requestAccessToken();
  } else {
    console.error('Token client not initialized');
  }
};

export const uploadToDrive = async (token: string, webpBase64: string, filename: string, folderId?: string) => {
  const metadata: any = {
    name: filename,
    mimeType: 'image/webp',
  };

  if (folderId) {
    metadata.parents = [folderId];
  }

  const base64Data = webpBase64.split(',')[1];
  const responseBlob = await fetch("data:image/webp;base64," + base64Data);
  const blob = await responseBlob.blob();

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: "Bearer " + token },
    body: form,
  });

  return await response.json();
};

export const getSpreadsheet = async (token: string, spreadsheetId: string) => {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
    headers: { Authorization: "Bearer " + token },
  });
  return await response.json();
};

export const addSheet = async (token: string, spreadsheetId: string, title: string) => {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: "Bearer " + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [{
        addSheet: {
          properties: { title }
        }
      }]
    }),
  });
  return await response.json();
};

export const appendToSheet = async (token: string, spreadsheetId: string, data: TicketData) => {
  const targetSheet = 'TicketsForm';
  
  try {
    // 1. Check if 'TicketsForm' sheet exists
    const metadata = await getSpreadsheet(token, spreadsheetId);
    if (metadata.error) {
      throw new Error(`Google Sheets Error: ${metadata.error.message}`);
    }
    
    const exists = metadata.sheets?.some((s: any) => s.properties.title === targetSheet);
    
    if (!exists) {
      console.log(`Sheet ${targetSheet} not found, creating it...`);
      // 2. Create the sheet if it doesn't exist
      const addResp = await addSheet(token, spreadsheetId, targetSheet);
      if (addResp.error) throw new Error(addResp.error.message);
      
      // 3. Add headers matching the NEW schema
      const headers = [[
        "Marca Temporal",           // 1
        "Fecha de Compra",         // 2 (ISO)
        "Categoria",                // 3
        "Proveedor",                // 4
        "Cantidad",                 // 5
        "Metodo de Pago",          // 6
        "Detalle de Pago",         // 7
        "Cuenta de Pago",          // 8 (Quien)
        "Imagen del Ticket",        // 9
        "TxnID"                     // 10
      ]];
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${targetSheet}!A1?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: {
          Authorization: "Bearer " + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: headers }),
      });
    }
    
    const range = `${targetSheet}!A1`;
    const now = new Date();
    const timestamp = now.toLocaleString('es-MX'); 
    
    // Deterministic TxnID: Hash of core fields
    const rawId = `${data.purchaseDate}-${data.amount}-${data.storeName}-${data.category}`;
    // Simple hex-like ID from string
    const txnId = `TXN-${btoa(unescape(encodeURIComponent(rawId))).substring(0, 16).toUpperCase()}`;

    const values = [[
      timestamp,                    // 1. Marca Temporal
      data.purchaseDate,            // 2. Fecha de Compra (ISO)
      data.category,                // 3. Categoria
      data.storeName,               // 4. Proveedor
      data.amount,                  // 5. Cantidad
      data.paymentMethod,           // 6. Metodo de Pago
      data.paymentDetail || '',     // 7. Detalle de Pago
      data.paymentAccount || '',    // 8. Cuenta de Pago
      data.driveLink || '',         // 9. Imagen del Ticket
      txnId                         // 10. TxnID
    ]];

    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: {
        Authorization: "Bearer " + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error.message);
    }
    return result;
  } catch (err: any) {
    console.error('Error in appendToSheet:', err);
    throw new Error(`Error al guardar en Sheets: ${err.message}`);
  }
};

export const createSheet = async (token: string, title: string) => {
    const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
            Authorization: "Bearer " + token,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            properties: { title }
        }),
    });
    const spreadsheet = await response.json();
    
    // Add headers to the new sheet
    const sheetName = spreadsheet.sheets?.[0]?.properties?.title || 'Sheet1';
    const headers = [["Fecha", "Hora", "Comercio", "Total", "Moneda", "Pago", "Link Drive", "Items"]];
    
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet.spreadsheetId}/values/${sheetName}!A1?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: {
        Authorization: "Bearer " + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: headers }),
    });

    return spreadsheet;
};

export const getSheetValues = async (token: string, spreadsheetId: string, range: string) => {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`, {
    headers: { Authorization: "Bearer " + token },
  });
  return await response.json();
};

export const ensureSysLists = async (token: string, spreadsheetId: string) => {
  const targetSheet = 'SYS_LISTS';
  const metadata = await getSpreadsheet(token, spreadsheetId);
  const exists = metadata.sheets?.some((s: any) => s.properties.title === targetSheet);

  if (!exists) {
    await addSheet(token, spreadsheetId, targetSheet);
    const headers = [["Categorías", "Comercios"]];
    await updateSheetValues(token, spreadsheetId, 'SYS_LISTS!A1', headers);
  }
};

export const getCustomInstructions = async (token: string, spreadsheetId: string): Promise<string> => {
  try {
    const data = await getSheetValues(token, spreadsheetId, 'SYS_PROMPT!A2');
    return data.values?.[0]?.[0] || "";
  } catch {
    return "";
  }
};

const EXPECTED_SCHEMA = [
  { title: 'TicketsForm', headers: ["Marca Temporal", "Fecha de Compra", "Categoria", "Proveedor", "Cantidad", "Metodo de Pago", "Detalle de Pago", "Cuenta de Pago", "Imagen del Ticket", "TxnID"] },
  { title: 'SYS_LISTS', headers: ["Categorías", "Comercios", "Personas"], initial: [["=UNIQUE(TicketsForm!C2:C)", "=UNIQUE(TicketsForm!D2:D)", "Principal"]] },
  { title: 'SYS_PROMPT', headers: ["Instrucciones Adicionales IA"], initial: [[""]] },
  { title: 'Accounts', headers: ["Dígitos", "Nombre Tarjeta", "Persona"] },
  { title: 'SYS_ALIASES', headers: ["Nombre Legal", "Alias Comercial"] }
];

export const ensureSchema = async (token: string, spreadsheetId: string) => {
  try {
    const metadata = await getSpreadsheet(token, spreadsheetId);
    const existingSheets = metadata.sheets?.map((s: any) => s.properties.title) || [];

    for (const sheet of EXPECTED_SCHEMA) {
      if (!existingSheets.includes(sheet.title)) {
        await addSheet(token, spreadsheetId, sheet.title);
      }
      // Always ensure headers are correct in the first row
      await updateSheetValues(token, spreadsheetId, `${sheet.title}!A1`, [sheet.headers]);
      
      // If it's a new sheet and has initial data, add it
      if (!existingSheets.includes(sheet.title) && sheet.initial) {
        await updateSheetValues(token, spreadsheetId, `${sheet.title}!A2`, sheet.initial);
      }
    }
    return { success: true, message: "Schema verificado y encabezados actualizados." };
  } catch (err: any) {
    throw new Error(`Error al asegurar schema: ${err.message}`);
  }
};

export const validateSchema = async (token: string, spreadsheetId: string) => {
  try {
    const metadata = await getSpreadsheet(token, spreadsheetId);
    if (metadata.error) throw new Error(metadata.error.message);
    
    const existingSheets = metadata.sheets?.map((s: any) => s.properties.title) || [];
    
    for (const sheet of EXPECTED_SCHEMA) {
      if (!existingSheets.includes(sheet.title)) {
        return { success: false, message: `Falta la hoja: ${sheet.title}` };
      }
      
      // Check headers
      const data = await getSheetValues(token, spreadsheetId, `${sheet.title}!1:1`);
      const actualHeaders = data.values?.[0] || [];
      const missingHeaders = sheet.headers.filter((h, i) => actualHeaders[i] !== h);
      
      if (missingHeaders.length > 0) {
        return { success: false, message: `Encabezados incorrectos en ${sheet.title}. Faltan o difieren: ${missingHeaders.join(', ')}` };
      }
    }
    
    return { success: true, message: "Hojas y encabezados validados correctamente." };
  } catch (err: any) {
    return { success: false, message: `Error de validación: ${err.message}` };
  }
};

export const updateSheetValues = async (token: string, spreadsheetId: string, range: string, values: any[][]) => {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: {
      Authorization: "Bearer " + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });
  return await response.json();
};
