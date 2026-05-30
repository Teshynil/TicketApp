import Sqids from 'sqids';
import type { TicketData } from "../types";

let tokenClient: any = null;
const sqids = new Sqids();

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
    const interval = setInterval(() => {
      if (tryInit()) clearInterval(interval);
    }, 500);
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

export const createSpreadsheet = async (token: string, title: string) => {
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
  return await response.json();
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

export const getSheetValues = async (token: string, spreadsheetId: string, range: string) => {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`, {
    headers: { Authorization: "Bearer " + token },
  });
  return await response.json();
};

const V2_SCHEMA = [
  { 
    title: 'DBTABLE_TICKETS', 
    headers: ["ID", "Timestamp_Created", "Purchase_Date", "Store_ID", "Category_ID", "Account_ID", "Amount", "Image_URL", "Description", "TxnID"],
    format: { frozenRowCount: 1 }
  },
  { 
    title: 'DBTABLE_CATEGORIES', 
    headers: ["ID", "Name"], 
    initial: [["1", "Alimentos"], ["2", "Transporte"], ["3", "Salud"], ["4", "Hogar"], ["5", "Entretenimiento"]],
    format: { frozenRowCount: 1 }
  },
  { 
    title: 'DBTABLE_STORES', 
    headers: ["ID", "Legal_Name"], 
    initial: [["1", "General"]],
    format: { frozenRowCount: 1 }
  },
  { 
    title: 'DBTABLE_ALIASES', 
    headers: ["ID", "Store_ID", "Alias_Name"],
    format: { frozenRowCount: 1 }
  },
  { 
    title: 'DBTABLE_PEOPLE', 
    headers: ["ID", "Name"], 
    initial: [["1", "Principal"]],
    format: { frozenRowCount: 1 }
  },
  { 
    title: 'DBTABLE_ACCOUNTS', 
    headers: ["ID", "Person_ID", "Type", "Digits_Identifier", "Alias_Name"],
    format: { frozenRowCount: 1 }
  },
  { 
    title: 'DBTABLE_CONFIG', 
    headers: ["Key", "Value"], 
    initial: [["AI_PROMPT", ""]],
    format: { frozenRowCount: 1 },
    hidden: true
  }
];

export const isDatabaseInitialized = async (token: string, spreadsheetId: string): Promise<boolean> => {
  try {
    const metadata = await getSpreadsheet(token, spreadsheetId);
    if (metadata.error) return false;
    const existingSheets = metadata.sheets?.map((s: any) => s.properties.title) || [];
    return V2_SCHEMA.every(s => existingSheets.includes(s.title));
  } catch {
    return false;
  }
};

export const validateSchemaV2 = async (token: string, spreadsheetId: string) => {
  try {
    const metadata = await getSpreadsheet(token, spreadsheetId);
    if (metadata.error) throw new Error(metadata.error.message);
    
    const existingSheets = metadata.sheets?.map((s: any) => s.properties.title) || [];
    for (const table of V2_SCHEMA) {
      if (!existingSheets.includes(table.title)) {
        return { success: false, message: `Falta la tabla: ${table.title}` };
      }
      const data = await getSheetValues(token, spreadsheetId, `${table.title}!1:1`);
      const actualHeaders = data.values?.[0] || [];
      const missingHeaders = table.headers.filter((h, i) => actualHeaders[i] !== h);
      if (missingHeaders.length > 0) {
        return { success: false, message: `Encabezados incorrectos en ${table.title}` };
      }
    }
    return { success: true, message: "Esquema V2 validado correctamente." };
  } catch (err: any) {
    return { success: false, message: `Error de validación: ${err.message}` };
  }
};

export const initializeDatabaseV2 = async (token: string, spreadsheetId: string | null) => {
  try {
    let targetId = spreadsheetId;
    let existingSheets: any[] = [];

    if (!targetId) {
      const newSheet = await createSpreadsheet(token, 'TicketApp Database V2');
      targetId = newSheet.spreadsheetId;
    } 
    
    const metadata = await getSpreadsheet(token, targetId as string);
    if (metadata.error) throw new Error(metadata.error.message);
    existingSheets = metadata.sheets || [];
    const existingTitles = existingSheets.map((s: any) => s.properties.title);

    const requests: any[] = [];
    
    // 1. Add missing tables
    for (const table of V2_SCHEMA) {
      if (!existingTitles.includes(table.title)) {
        requests.push({
          addSheet: {
            properties: { 
              title: table.title,
              gridProperties: { frozenRowCount: table.format.frozenRowCount },
              hidden: table.hidden || false
            }
          }
        });
      }
    }

    if (requests.length > 0) {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: "Bearer " + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      });
    }

    // 2. Set headers and initial values
    for (const table of V2_SCHEMA) {
      await updateSheetValues(token, targetId as string, `${table.title}!A1`, [table.headers]);
      if (table.initial) {
        const current = await getSheetValues(token, targetId as string, `${table.title}!A2:A2`);
        if (!current.values || current.values.length === 0) {
          await updateSheetValues(token, targetId as string, `${table.title}!A2`, table.initial);
        }
      }
    }

    // 3. CLEANUP: Delete default sheets (Sheet1, etc.) that are NOT part of our DBTABLE schema
    const finalMetadata = await getSpreadsheet(token, targetId as string);
    const finalSheets = finalMetadata.sheets || [];
    const deleteRequests: any[] = [];

    for (const s of finalSheets) {
      const title = s.properties.title;
      // If the sheet doesn't start with DBTABLE_ and there are at least our tables created, delete it
      if (!title.startsWith('DBTABLE_')) {
        deleteRequests.push({ deleteSheet: { sheetId: s.properties.sheetId } });
      }
    }

    if (deleteRequests.length > 0 && finalSheets.length > deleteRequests.length) {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${targetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: "Bearer " + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: deleteRequests }),
      });
    }

    return { success: true, message: "Base de datos V2 inicializada con éxito.", spreadsheetId: targetId };
  } catch (err: any) {
    throw new Error(`Error al inicializar DB: ${err.message}`);
  }
};

export const appendToSheetV2 = async (
  token: string, 
  spreadsheetId: string, 
  data: TicketData, 
  options?: { saveAsAlias?: boolean; originalDetectedStore?: string }
) => {
  try {
    const categories = await getSheetValues(token, spreadsheetId, 'DBTABLE_CATEGORIES!A2:B500');
    const stores = await getSheetValues(token, spreadsheetId, 'DBTABLE_STORES!A2:B500');
    const accounts = await getSheetValues(token, spreadsheetId, 'DBTABLE_ACCOUNTS!A2:E500');
    const aliases = await getSheetValues(token, spreadsheetId, 'DBTABLE_ALIASES!A2:C500');

    const catRows = categories.values || [];
    const storeRows = stores.values || [];
    const accountRows = accounts.values || [];
    const aliasRows = aliases.values || [];

    // 1. Resolve Category ID (Case Insensitive)
    let catId = parseInt(catRows.find((r: any) => String(r[1]).toLowerCase() === data.category.toLowerCase())?.[0] || "0");
    if (!catId) {
      catId = catRows.reduce((max: number, r: any) => Math.max(max, parseInt(r[0]) || 0), 0) + 1;
      await updateSheetValues(token, spreadsheetId, `DBTABLE_CATEGORIES!A${catId + 1}`, [[catId, data.category]]);
    }

    // 2. Resolve Store ID (Case Insensitive)
    let storeId = parseInt(storeRows.find((r: any) => String(r[1]).toLowerCase() === data.storeName.toLowerCase())?.[0] || "0");
    if (!storeId) {
      storeId = storeRows.reduce((max: number, r: any) => Math.max(max, parseInt(r[0]) || 0), 0) + 1;
      await updateSheetValues(token, spreadsheetId, `DBTABLE_STORES!A${storeId + 1}`, [[storeId, data.storeName]]);
    }

    // 3. Save Alias if requested
    if (options?.saveAsAlias && options.originalDetectedStore && options.originalDetectedStore !== data.storeName) {
      const aliasExists = aliasRows.some((r: any) => r[2] === options.originalDetectedStore);
      if (!aliasExists) {
        const nextAliasId = aliasRows.reduce((max: number, r: any) => Math.max(max, parseInt(r[0]) || 0), 0) + 1;
        await updateSheetValues(token, spreadsheetId, `DBTABLE_ALIASES!A${nextAliasId + 1}`, [[nextAliasId, storeId, options.originalDetectedStore]]);
      }
    }

    // 4. Resolve Account ID (or Create New)
    let accountId = 0;
    const cleanDetail = data.paymentDetail.replace(/\D/g, '');
    const matchedAccount = accountRows.find((r: any) => {
      const rDigits = String(r[3]).replace(/\D/g, '');
      return cleanDetail && rDigits && (cleanDetail.includes(rDigits) || rDigits.includes(cleanDetail));
    });

    if (matchedAccount) {
      accountId = parseInt(matchedAccount[0]);
    } else if (data.paymentMethod === 'Tarjeta' || data.paymentMethod === 'Transferencia') {
      // Create new account for this person (default to Person 1 if not specified)
      accountId = accountRows.reduce((max: number, r: any) => Math.max(max, parseInt(r[0]) || 0), 0) + 1;
      await updateSheetValues(token, spreadsheetId, `DBTABLE_ACCOUNTS!A${accountId + 1}`, [[accountId, 1, data.paymentMethod, data.paymentDetail, 'Nueva Tarjeta/Transf']]);
    } else {
      accountId = 1; // Default fallback (Cash usually matches id 1 in many systems or we can refine)
    }

    // 5. Generate Sqid TxnID
    const dateNum = parseInt(data.purchaseDate.split('T')[0].replace(/-/g, ''));
    const amountCents = Math.round(data.amount * 100);
    const txnId = `TXN-${sqids.encode([dateNum, amountCents, storeId, catId])}`;

    const now = new Date().toLocaleString('es-MX');
    const values = [[ `T-${Date.now()}`, now, data.purchaseDate, storeId, catId, accountId, data.amount, data.driveLink || '', data.description || '', txnId ]];
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/DBTABLE_TICKETS!A1:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: { Authorization: "Bearer " + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    });

    return { success: true, txnId };
  } catch (err: any) {
    throw new Error(`Error al guardar V2: ${err.message}`);
  }
};

export const getV2CustomInstructions = async (token: string, spreadsheetId: string): Promise<string> => {
  try {
    const data = await getSheetValues(token, spreadsheetId, 'DBTABLE_CONFIG!A2:B10');
    const row = data.values?.find((r: any) => r[0] === 'AI_PROMPT');
    return row?.[1] || "";
  } catch {
    return "";
  }
};
