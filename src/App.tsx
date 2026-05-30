import { useState, useEffect, useRef } from 'react';
import Cropper from 'react-cropper';
import type { ReactCropperElement } from 'react-cropper';
import 'cropperjs/dist/cropper.css';
import { Camera, Settings as SettingsIcon, Check, Loader2, AlertCircle, Save, X, Upload, Pencil, CloudOff, RefreshCw, Sparkles, Undo2, Crop, RotateCw, RotateCcw, Database, Users, BookMarked, Trash2, Plus } from 'lucide-react';
import { useConfig } from './hooks/useConfig';
import { Settings } from './components/Settings';
import { convertToLosslessWebP, fileToDataUrl, enhanceImage } from './utils/image';
import { analyzeTicket } from './services/gemini';
import { 
  initTokenClient, 
  requestToken, 
  uploadToDrive, 
  getSheetValues, 
  updateSheetValues,
  isDatabaseInitialized, 
  initializeDatabaseV2, 
  appendToSheetV2, 
  getV2CustomInstructions,
  validateSchemaV2
} from './services/google';
import { APP_VERSION } from './version';
import type { TicketData, QueueItem } from './types';
import './index.css';

const PAYMENT_METHODS = ['Efectivo', 'Tarjeta', 'Transferencia', 'Otros'];

function App() {
  const { config, saveConfig, isConfigured } = useConfig();
  const [showSettings, setShowSettings] = useState(!isConfigured);
  const [status, setStatus] = useState<'idle' | 'confirm_capture' | 'processing' | 'reviewing' | 'saving' | 'success' | 'error' | 'queue' | 'db_init' | 'accounts' | 'aliases'>(() => {
    const saved = localStorage.getItem('ticketapp_review_state');
    return saved ? JSON.parse(saved).status : 'idle';
  });
  const [ticketData, setTicketData] = useState<TicketData | null>(() => {
    const saved = localStorage.getItem('ticketapp_review_state');
    return saved ? JSON.parse(saved).ticketData : null;
  });
  const [webpPhoto, setWebpPhoto] = useState<string | null>(() => {
    const saved = localStorage.getItem('ticketapp_review_state');
    return saved ? JSON.parse(saved).webpPhoto : null;
  });
  
  const [photoHistory, setPhotoHistory] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(() => {
    const token = localStorage.getItem('google_token');
    const timestamp = localStorage.getItem('google_token_timestamp');
    if (token && timestamp) {
      const isExpired = Date.now() - parseInt(timestamp) > 50 * 60 * 1000;
      if (!isExpired) return token;
    }
    return null;
  });
  const [waitingForToken, setWaitingForToken] = useState(false);
  const [dbStatus, setDbStatus] = useState<'checking' | 'ready' | 'pending'>('checking');
  
  const [people, setPeople] = useState<string[]>(() => JSON.parse(localStorage.getItem('ticketapp_cache_people') || '["Principal"]'));
  const [knownCategories, setKnownCategories] = useState<string[]>(() => JSON.parse(localStorage.getItem('ticketapp_cache_categories') || '[]'));
  const [knownStores, setKnownStores] = useState<string[]>(() => JSON.parse(localStorage.getItem('ticketapp_cache_stores') || '[]'));
  const [customInstructions, setCustomInstructions] = useState("");
  const [aliases, setAliases] = useState<any[]>(() => JSON.parse(localStorage.getItem('ticketapp_cache_aliases_v2') || '[]'));
  
  const [editingField, setEditingField] = useState<string | null>(null);
  const [saveAsAlias, setSaveAsAlias] = useState(false);
  const [originalDetectedStore, setOriginalDetectedStore] = useState(() => localStorage.getItem('ticketapp_original_store') || "");
  const [isViewingFullImage, setIsViewingFullImage] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);

  // Management states
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [newAccount, setNewAccount] = useState({ person: 'Principal', type: 'Tarjeta', digits: '', alias: '' });
  const [newPersonName, setNewPersonName] = useState('');
  const [newAlias, setNewAlias] = useState({ legalStore: '', aliasName: '' });

  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editAccountData, setEditAccountData] = useState<any>(null);
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [editAliasData, setEditAliasData] = useState<any>(null);

  const [isCropping, setIsCropping] = useState(false);
  const cropperRef = useRef<ReactCropperElement>(null);

  const [queue, setQueue] = useState<QueueItem[]>(() => JSON.parse(localStorage.getItem('ticketapp_offline_queue') || '[]'));
  const [isSyncing, setIsSyncing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  useEffect(() => {
    if (['confirm_capture', 'processing', 'reviewing', 'saving'].includes(status) && (ticketData || webpPhoto)) {
      localStorage.setItem('ticketapp_review_state', JSON.stringify({ status, ticketData, webpPhoto }));
      if (originalDetectedStore) localStorage.setItem('ticketapp_original_store', originalDetectedStore);
    } else if (status === 'idle' || status === 'success') {
      localStorage.removeItem('ticketapp_review_state');
      localStorage.removeItem('ticketapp_original_store');
      setPhotoHistory([]);
    }
  }, [status, ticketData, webpPhoto, originalDetectedStore]);

  useEffect(() => {
    localStorage.setItem('ticketapp_offline_queue', JSON.stringify(queue));
  }, [queue]);

  useEffect(() => {
    if (googleToken && isConfigured) {
      checkDatabase();
    }
  }, [googleToken, isConfigured, config.googleSheetId]);

  const checkAuth = () => {
    const token = localStorage.getItem('google_token');
    const timestamp = localStorage.getItem('google_token_timestamp');
    const isExpired = !token || !timestamp || (Date.now() - parseInt(timestamp) > 50 * 60 * 1000);
    if (isExpired) {
      requestToken();
      return false;
    }
    return true;
  };

  const checkDatabase = async () => {
    if (!googleToken) return;
    if (!config.googleSheetId) { setDbStatus('pending'); setStatus('db_init'); return; }
    setDbStatus('checking');
    try {
      const initialized = await isDatabaseInitialized(googleToken, config.googleSheetId);
      if (initialized) {
        setDbStatus('ready');
        if (status === 'db_init') setStatus('idle');
        loadSysLists();
      } else { setDbStatus('pending'); setStatus('db_init'); }
    } catch { setDbStatus('pending'); setStatus('db_init'); }
  };

  const handleInitDb = async () => {
    if (!googleToken) return;
    try {
      setDbStatus('checking');
      const result = await initializeDatabaseV2(googleToken, config.googleSheetId || null);
      if (result.spreadsheetId && result.spreadsheetId !== config.googleSheetId) {
        saveConfig({ ...config, googleSheetId: result.spreadsheetId });
      }
      setDbStatus('ready'); setStatus('idle'); loadSysLists();
    } catch (err: any) { setError(err.message); setStatus('error'); }
  };

  const loadSysLists = async () => {
    try {
      if (!config.googleSheetId || !googleToken) return;
      const catsData = await getSheetValues(googleToken, config.googleSheetId, 'DBTABLE_CATEGORIES!A2:B500');
      const storesData = await getSheetValues(googleToken, config.googleSheetId, 'DBTABLE_STORES!A2:B500');
      const peopleData = await getSheetValues(googleToken, config.googleSheetId, 'DBTABLE_PEOPLE!A2:B50');
      const aliasesData = await getSheetValues(googleToken, config.googleSheetId, 'DBTABLE_ALIASES!A2:C500');
      
      const cats = catsData.values?.map((row: any) => row[1]).filter(Boolean) || [];
      const strs = storesData.values?.map((row: any) => row[1]).filter(Boolean) || [];
      const ppl = peopleData.values?.map((row: any) => row[1]).filter(Boolean) || ['Principal'];
      
      const storeMap = new Map(storesData.values?.map((row: any) => [row[0], row[1]]) || []);
      const als = aliasesData.values?.map((row: any) => [
        row[0], // ID
        row[2], // Alias Name
        storeMap.get(row[1]) || "" // Legal Store Name
      ]).filter((row: any) => row[2]) || [];
      
      setKnownCategories(cats); setKnownStores(strs); setPeople(ppl); setAliases(als as any);
      
      localStorage.setItem('ticketapp_cache_categories', JSON.stringify(cats));
      localStorage.setItem('ticketapp_cache_stores', JSON.stringify(strs));
      localStorage.setItem('ticketapp_cache_people', JSON.stringify(ppl));
      localStorage.setItem('ticketapp_cache_aliases_v2', JSON.stringify(als));

      const instructions = await getV2CustomInstructions(googleToken, config.googleSheetId);
      setCustomInstructions(instructions);
    } catch (err) { console.error('Failed to load SYS_LISTS:', err); }
  };

  const loadAccounts = async () => {
    if (!googleToken || !config.googleSheetId) return;
    try {
      setLoadingAccounts(true);
      const data = await getSheetValues(googleToken, config.googleSheetId, 'DBTABLE_ACCOUNTS!A2:E100');
      const peopleData = await getSheetValues(googleToken, config.googleSheetId, 'DBTABLE_PEOPLE!A2:B50');
      const pplMap = new Map(peopleData.values?.map((row: any) => [row[0], row[1]]) || []);
      
      const accs = data.values?.map((row: any) => [
        row[0], // ID
        pplMap.get(row[1]) || row[1], // Person Name
        row[2], // Type
        row[3], // Digits
        row[4]  // Alias
      ]) || [];
      setAccounts(accs);
    } catch (err) { console.error(err); } finally { setLoadingAccounts(false); }
  };

  const handleAddPerson = async () => {
    if (!newPersonName || people.includes(newPersonName) || !googleToken) return;
    try {
      setLoadingAccounts(true);
      const current = await getSheetValues(googleToken, config.googleSheetId!, 'DBTABLE_PEOPLE!A2:A50');
      const rows = current.values || [];
      const nextId = rows.reduce((max: number, r: any) => Math.max(max, parseInt(r[0]) || 0), 0) + 1;
      await updateSheetValues(googleToken, config.googleSheetId!, `DBTABLE_PEOPLE!A${rows.length + 2}`, [[nextId, newPersonName]]);
      setNewPersonName('');
      await loadSysLists();
    } catch (err) { console.error(err); } finally { setLoadingAccounts(false); }
  };

  const handleAddAccount = async () => {
    if (!newAccount.digits || !googleToken) return;
    try {
      setLoadingAccounts(true);
      const peopleData = await getSheetValues(googleToken, config.googleSheetId!, 'DBTABLE_PEOPLE!A2:B50');
      const personId = peopleData.values?.find((r: any) => r[1] === newAccount.person)?.[0] || "1";
      const current = await getSheetValues(googleToken, config.googleSheetId!, 'DBTABLE_ACCOUNTS!A2:A100');
      const rows = current.values || [];
      const nextId = rows.reduce((max: number, r: any) => Math.max(max, parseInt(r[0]) || 0), 0) + 1;
      await updateSheetValues(googleToken, config.googleSheetId!, `DBTABLE_ACCOUNTS!A${rows.length + 2}`, [[nextId, personId, newAccount.type, newAccount.digits, newAccount.alias]]);
      setNewAccount({ ...newAccount, digits: '', alias: '' });
      await loadAccounts();
    } catch (err) { console.error(err); } finally { setLoadingAccounts(false); }
  };

  const handleUpdateAccount = async () => {
    if (!editAccountData || !googleToken) return;
    try {
      setLoadingAccounts(true);
      const peopleData = await getSheetValues(googleToken, config.googleSheetId!, 'DBTABLE_PEOPLE!A2:B50');
      const personId = peopleData.values?.find((r: any) => r[1] === editAccountData.person)?.[0] || "1";
      const data = await getSheetValues(googleToken, config.googleSheetId!, 'DBTABLE_ACCOUNTS!A2:E500');
      const rows = data.values || [];
      const updated = rows.map((r: any) => (String(r[0]) === String(editingAccountId)) ? [r[0], personId, editAccountData.type, editAccountData.digits, editAccountData.alias] : r);
      await updateSheetValues(googleToken, config.googleSheetId!, 'DBTABLE_ACCOUNTS!A2', updated);
      setEditingAccountId(null); await loadAccounts();
    } catch (err) { console.error(err); } finally { setLoadingAccounts(false); }
  };

  const handleAddAlias = async () => {
    if (!newAlias.aliasName || !newAlias.legalStore || !googleToken) return;
    try {
      setLoadingAccounts(true);
      const storesData = await getSheetValues(googleToken, config.googleSheetId!, 'DBTABLE_STORES!A2:B500');
      const storeId = storesData.values?.find((r: any) => r[1] === newAlias.legalStore)?.[0] || "1";
      const current = await getSheetValues(googleToken, config.googleSheetId!, 'DBTABLE_ALIASES!A2:A500');
      const rows = current.values || [];
      const nextId = rows.reduce((max: number, r: any) => Math.max(max, parseInt(r[0]) || 0), 0) + 1;
      await updateSheetValues(googleToken, config.googleSheetId!, `DBTABLE_ALIASES!A${rows.length + 2}`, [[nextId, storeId, newAlias.aliasName]]);
      setNewAlias({ legalStore: '', aliasName: '' }); await loadSysLists();
    } catch (err) { console.error(err); } finally { setLoadingAccounts(false); }
  };

  const handleUpdateAlias = async () => {
    if (!editAliasData || !googleToken) return;
    try {
      setLoadingAccounts(true);
      const storesData = await getSheetValues(googleToken, config.googleSheetId!, 'DBTABLE_STORES!A2:B500');
      const storeId = storesData.values?.find((r: any) => r[1] === editAliasData.legalStore)?.[0] || "1";
      const data = await getSheetValues(googleToken, config.googleSheetId!, 'DBTABLE_ALIASES!A2:C500');
      const rows = data.values || [];
      const updated = rows.map((r: any) => (String(r[0]) === String(editingAliasId)) ? [r[0], storeId, editAliasData.aliasName] : r);
      await updateSheetValues(googleToken, config.googleSheetId!, 'DBTABLE_ALIASES!A2', updated);
      setEditingAliasId(null); await loadSysLists();
    } catch (err) { console.error(err); } finally { setLoadingAccounts(false); }
  };

  const handleDeleteEntry = async (table: string, id: string) => {
    if (!googleToken || !config.googleSheetId) return;
    try {
      setLoadingAccounts(true);
      const data = await getSheetValues(googleToken, config.googleSheetId, `${table}!A2:E500`);
      const rows = data.values || [];
      const filtered = rows.filter((r: any) => String(r[0]) !== String(id));
      await updateSheetValues(googleToken, config.googleSheetId, `${table}!A2:E500`, Array(499).fill(['', '', '', '', '']));
      if (filtered.length > 0) await updateSheetValues(googleToken, config.googleSheetId, `${table}!A2`, filtered);
      if (table === 'DBTABLE_ACCOUNTS') await loadAccounts(); else await loadSysLists();
    } catch (err) { console.error(err); } finally { setLoadingAccounts(false); }
  };

  useEffect(() => {
    if (config.googleClientId) {
      initTokenClient(config.googleClientId, (resp: any) => {
        if (resp.access_token) {
          setGoogleToken(resp.access_token);
          localStorage.setItem('google_token', resp.access_token);
          localStorage.setItem('google_token_timestamp', Date.now().toString());
        }
      });
    }
  }, [config.googleClientId]);

  useEffect(() => {
    if (googleToken && waitingForToken) {
      setWaitingForToken(false);
      performSave(googleToken);
    }
  }, [googleToken, waitingForToken]);

  const handleAnalyze = async (photoOverride?: string) => {
    const photoToUse = photoOverride || webpPhoto;
    if (!photoToUse) return;
    if (!checkAuth()) return;
    try {
      setStatus('processing');
      const aliasPromptList: [string, string][] = aliases.map(a => [a[1], a[2]]);
      const data = await analyzeTicket(config.geminiApiKey, photoToUse, config.geminiModel, knownCategories, knownStores, customInstructions, aliasPromptList);
      setOriginalDetectedStore(data.storeName);
      setSaveAsAlias(false);
      if (data.paymentMethod === 'Efectivo') data.paymentAccount = 'Principal';
      setTicketData(data);
      setStatus('reviewing');
    } catch (err: any) { addToQueue(photoToUse); setError('Error en análisis o conexión. El ticket se ha guardado en la cola local.'); setStatus('error'); }
  };

  const handleEnhance = async () => {
    if (!webpPhoto) return;
    try {
      setIsEnhancing(true);
      setPhotoHistory(prev => [...prev, webpPhoto]);
      const enhanced = await enhanceImage(webpPhoto);
      setWebpPhoto(enhanced);
    } catch (err) { console.error(err); alert('Fallo al mejorar la imagen'); } finally { setIsEnhancing(false); }
  };

  const handleUndo = () => {
    if (photoHistory.length === 0) return;
    const last = photoHistory[photoHistory.length - 1];
    setWebpPhoto(last); setPhotoHistory(prev => prev.slice(0, -1));
  };

  const handleCropSave = async () => {
    const cropper = cropperRef.current?.cropper;
    if (!cropper || !webpPhoto) return;
    try {
      setIsEnhancing(true);
      setPhotoHistory(prev => [...prev, webpPhoto]);
      const cropped = cropper.getCroppedCanvas().toDataURL('image/webp', 0.85);
      setWebpPhoto(cropped);
      setIsCropping(false);
    } catch (err) { console.error(err); alert('Fallo al recortar'); } finally { setIsEnhancing(false); }
  };

  const addToQueue = (photo: string) => {
    const newItem: QueueItem = { id: `Q-${Date.now()}`, photo, dateTaken: new Date().toISOString() };
    setQueue(prev => [...prev, newItem]);
  };

  const handleSyncQueue = async () => {
    if (!navigator.onLine) { alert("Sigue sin haber conexión."); return; }
    if (queue.length === 0) return;
    setIsSyncing(true);
    const item = queue[0];
    setWebpPhoto(item.photo);
    setQueue(prev => prev.slice(1));
    await handleAnalyze(item.photo);
    setIsSyncing(false);
  };

  const performSave = async (token: string) => {
    try {
      setStatus('saving');
      const filename = `ticket_${ticketData?.storeName}_${new Date().getTime()}.webp`.replace(/\s+/g, '_');
      const driveResp = await uploadToDrive(token, webpPhoto!, filename, config.googleDriveFolderId);
      const updatedTicket = { ...ticketData!, driveLink: driveResp.webViewLink };
      await appendToSheetV2(token, config.googleSheetId!, updatedTicket, { saveAsAlias, originalDetectedStore });
      setStatus('success'); loadSysLists(); 
    } catch (err: any) {
      console.error('Save error:', err);
      const isAuthError = err.message?.toLowerCase().includes('401') || err.message?.toLowerCase().includes('unauthorized') || err.message?.toLowerCase().includes('authentication credentials');
      if (isAuthError) {
        localStorage.removeItem('google_token'); localStorage.removeItem('google_token_timestamp'); setGoogleToken(null);
        setError('Tu sesión de Google ha caducado. Por favor, pulsa "Confirmar y Guardar" nuevamente para reconectar.');
      } else { setError(err.message || 'Error al guardar'); }
      setStatus('error');
    }
  };

  const handleSave = () => { if (!googleToken) { setWaitingForToken(true); requestToken(); } else { performSave(googleToken); } };

  const handleRetryAfterError = () => { if (error?.includes('sesión de Google ha caducado')) { setStatus('reviewing'); } else { setStatus('idle'); } };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setStatus('processing');
      const rawPhoto = await fileToDataUrl(file);
      const webp = await convertToLosslessWebP(rawPhoto);
      setWebpPhoto(webp); setStatus('confirm_capture');
      e.target.value = '';
    } catch (err: any) { setError('Error al procesar archivo'); setStatus('error'); }
  };

  const handleValidateSchema = async (sheetId: string) => {
    if (!googleToken) return { success: false, message: "Inicia sesión primero" };
    return await validateSchemaV2(googleToken, sheetId);
  };

  const handleCreateSchema = async (sheetId: string) => {
    if (!googleToken) return { success: false, message: "Inicia sesión primero" };
    return await initializeDatabaseV2(googleToken, sheetId);
  };

  if (showSettings) {
    return (
      <div className="container">
        <Settings config={config} googleToken={googleToken} onLogin={requestToken} onSave={(newConfig) => { saveConfig(newConfig); setShowSettings(false); }} onClose={() => isConfigured && setShowSettings(false)} onValidateSchema={handleValidateSchema} onCreateSchema={handleCreateSchema} />
      </div>
    );
  }

  const renderEditableField = (label: string, field: keyof TicketData, type: string = 'text') => {
    if (!ticketData) return null;
    const isEditing = editingField === field;
    const value = ticketData[field];
    const isSpecialSelector = field === 'category' || field === 'storeName' || field === 'paymentAccount' || field === 'paymentMethod';
    let list: string[] = [];
    if (field === 'category') list = knownCategories;
    else if (field === 'storeName') list = knownStores;
    else if (field === 'paymentAccount') list = people;
    else if (field === 'paymentMethod') list = PAYMENT_METHODS;
    let isNew = false;
    if (field === 'category' && typeof value === 'string' && !knownCategories.includes(value)) isNew = true;
    if (field === 'storeName' && typeof value === 'string' && !knownStores.includes(value)) isNew = true;

    return (
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{label}</label>
          {isNew && <span style={{ fontSize: '0.65rem', background: 'rgba(255, 215, 0, 0.1)', color: '#ffd700', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>NUEVO</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', minHeight: '40px' }}>
          {isEditing ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {isSpecialSelector ? (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <select value={list.some(item => String(value).startsWith(item)) ? list.find(item => String(value).startsWith(item)) : ''} onChange={(e) => { const val = e.target.value; if (val === 'Otros') { setTicketData({ ...ticketData, [field]: 'Otros ()' }); } else { setTicketData({ ...ticketData, [field]: val }); setEditingField(null); } }}>
                    <option value="">Seleccionar...</option>{list.map(item => <option key={item} value={item}>{item}</option>)}{(field !== 'paymentAccount' && field !== 'paymentMethod') && <option value="NEW">+ Nuevo...</option>}
                  </select>
                  {field === 'paymentMethod' && String(value).startsWith('Otros') && (
                    <input autoFocus placeholder="¿Qué método?" type="text" value={String(value).match(/\((.*)\)/)?.[1] || ''} onChange={(e) => setTicketData({ ...ticketData, [field]: `Otros (${e.target.value})` })} style={{ flex: 1.5 }} />
                  )}
                  {field !== 'paymentAccount' && field !== 'paymentMethod' && (
                    <input autoFocus placeholder="Nuevo..." type="text" value={list.includes(value as string) ? '' : value as string} onChange={(e) => { setTicketData({ ...ticketData, [field]: e.target.value }); if (field === 'storeName') setSaveAsAlias(true); }} style={{ flex: 1.5 }} />
                  )}
                  <button onClick={() => setEditingField(null)} style={{ background: 'var(--primary)', padding: '0.5rem' }}> <Check size={18} /> </button>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', gap: '0.5rem' }}>
                  <input autoFocus type={field === 'purchaseDate' ? 'datetime-local' : type} value={value as any} onChange={(e) => setTicketData({ ...ticketData, [field]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value })} onBlur={() => setEditingField(null)} onKeyDown={(e) => e.key === 'Enter' && setEditingField(null)} style={{ flex: 1 }} />
                  <button onClick={() => setEditingField(null)} style={{ background: 'var(--primary)', padding: '0.5rem' }}> <Check size={18} /> </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ flex: 1, fontSize: '1rem', fontWeight: (field === 'amount' || field === 'paymentAccount') ? 'bold' : 'normal', color: field === 'amount' ? 'var(--primary)' : 'white' }}> {field === 'amount' ? `$${value}` : field === 'purchaseDate' ? String(value).replace('T', ' ') : value as string || <em style={{color: '#64748b'}}>Sin datos</em>} </div>
                <button onClick={() => setEditingField(field)} style={{ background: 'transparent', color: '#94a3b8', padding: '0.5rem' }}> <Pencil size={16} /> </button>
              </div>
              {field === 'storeName' && originalDetectedStore && value !== originalDetectedStore && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.65rem', color: '#64748b', marginTop: '0.2rem', cursor: 'pointer', background: 'rgba(255,255,255,0.02)', padding: '0.25rem 0.5rem', borderRadius: '4px', alignSelf: 'start' }}>
                  <input type="checkbox" checked={saveAsAlias} onChange={e => setSaveAsAlias(e.target.checked)} style={{ width: '12px', height: '12px' }} />
                  Recordar como alias de "{originalDetectedStore}"
                </label>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="container">
      <header style={{ padding: '1rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '1.5rem' }}>TicketApp 🎫</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => { if (checkAuth()) setStatus('aliases'); }} title="Alias"><BookMarked size={20} /></button>
          <button onClick={() => { if (checkAuth()) { setStatus('accounts'); loadAccounts(); } }} title="Cuentas"><Users size={20} /></button>
          <button onClick={() => setStatus('idle')} title="Inicio"><Camera size={20} /></button>
          <button onClick={() => setShowSettings(true)}><SettingsIcon size={20} /></button>
        </div>
      </header>
      <main style={{ marginTop: '2rem' }}>
        {status === 'db_init' && (
          <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
            <Database size={64} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
            <h2>Inicializar Base de Datos V2</h2>
            <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>Se requiere configurar la estructura de tablas relacionales en tu Google Sheet para continuar.</p>
            <button className="primary" onClick={handleInitDb} disabled={dbStatus === 'checking'} style={{ width: '100%' }}>
              {dbStatus === 'checking' ? <Loader2 className="animate-spin" /> : 'Inicializar Ahora'}
            </button>
          </div>
        )}
        {status === 'accounts' && (
          <div className="card" style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}><h3>Gestionar Personas y Cuentas</h3><button onClick={() => setStatus('idle')}><X size={20} /></button></div>
            <div style={{ marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <h4 style={{ fontSize: '0.85rem', color: 'var(--primary)', marginBottom: '0.75rem' }}>Añadir Persona</h4>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input type="text" placeholder="Nombre" style={{ flex: 1 }} value={newPersonName} onChange={e => setNewPersonName(e.target.value)} />
                <button className="primary" onClick={handleAddPerson}><Plus size={20} /></button>
              </div>
            </div>
            <h4 style={{ fontSize: '0.85rem', color: 'var(--primary)', marginBottom: '0.75rem' }}>{editingAccountId ? 'Editar Tarjeta' : 'Vincular Tarjeta'}</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
               <select value={editingAccountId ? editAccountData.person : newAccount.person} onChange={e => editingAccountId ? setEditAccountData({...editAccountData, person: e.target.value}) : setNewAccount({...newAccount, person: e.target.value})}>
                  {people.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input type="text" placeholder="Dígitos (*1234)" style={{ flex: 1 }} value={editingAccountId ? editAccountData.digits : newAccount.digits} onChange={e => editingAccountId ? setEditAccountData({...editAccountData, digits: e.target.value}) : setNewAccount({...newAccount, digits: e.target.value})} />
                  <input type="text" placeholder="Alias (Nu, BBVA...)" style={{ flex: 1 }} value={editingAccountId ? editAccountData.alias : newAccount.alias} onChange={e => editingAccountId ? setEditAccountData({...editAccountData, alias: e.target.value}) : setNewAccount({...newAccount, alias: e.target.value})} />
                  {editingAccountId ? (
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button className="primary" onClick={handleUpdateAccount}><Check size={20} /></button>
                      <button onClick={() => setEditingAccountId(null)} style={{ background: '#334155' }}><X size={20} /></button>
                    </div>
                  ) : (
                    <button className="primary" onClick={handleAddAccount}><Plus size={20} /></button>
                  )}
                </div>
            </div>
            {loadingAccounts ? <Loader2 size={24} className="animate-spin" /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {accounts.map((acc, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', opacity: editingAccountId === acc[0] ? 0.5 : 1 }}>
                    <div>
                      <div style={{ fontSize: '0.9rem' }}><strong>{acc[4]}</strong> ({acc[3]})</div>
                      <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{acc[1]} | {acc[2]}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={() => { setEditingAccountId(acc[0]); setEditAccountData({ person: acc[1], type: acc[2], digits: acc[3], alias: acc[4] }); }} style={{ background: 'transparent', padding: '0.5rem' }}><Pencil size={16} /></button>
                      <button onClick={() => handleDeleteEntry('DBTABLE_ACCOUNTS', acc[0])} style={{ background: 'transparent' }}><Trash2 size={16} color="var(--error)" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {status === 'aliases' && (
          <div className="card" style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}><h3>Gestionar Alias</h3><button onClick={() => setStatus('idle')}><X size={20} /></button></div>
            <h4 style={{ fontSize: '0.85rem', color: 'var(--primary)', marginBottom: '0.75rem' }}>{editingAliasId ? 'Editar Alias' : 'Añadir Alias'}</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <select value={editingAliasId ? editAliasData.legalStore : newAlias.legalStore} onChange={e => editingAliasId ? setEditAliasData({...editAliasData, legalStore: e.target.value}) : setNewAlias({...newAlias, legalStore: e.target.value})}>
                <option value="">Seleccionar Tienda...</option>
                {knownStores.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input type="text" placeholder="Alias en Ticket" style={{ flex: 1 }} value={editingAliasId ? editAliasData.aliasName : newAlias.aliasName} onChange={e => editingAliasId ? setEditAliasData({...editAliasData, aliasName: e.target.value}) : setNewAlias({...newAlias, aliasName: e.target.value})} />
                {editingAliasId ? (
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button className="primary" onClick={handleUpdateAlias}><Check size={20} /></button>
                    <button onClick={() => setEditingAliasId(null)} style={{ background: '#334155' }}><X size={20} /></button>
                  </div>
                ) : (
                  <button className="primary" onClick={handleAddAlias}><Plus size={20} /></button>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {aliases.map((al, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', opacity: editingAliasId === al[0] ? 0.5 : 1 }}>
                  <div>
                    <div style={{ fontSize: '0.9rem' }}><strong>{al[1]}</strong></div>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Mapea a: {al[2]}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => { setEditingAliasId(al[0]); setEditAliasData({ legalStore: al[2], aliasName: al[1] }); }} style={{ background: 'transparent', padding: '0.5rem' }}><Pencil size={16} /></button>
                    <button onClick={() => handleDeleteEntry('DBTABLE_ALIASES', al[0])} style={{ background: 'transparent' }}><Trash2 size={16} color="var(--error)" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {status === 'idle' && (
          <div className="card" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
            {queue.length > 0 && (
              <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(56, 189, 248, 0.1)', borderRadius: '12px', border: '1px solid rgba(56, 189, 248, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#38bdf8' }}>
                  <CloudOff size={20} />
                  <span style={{ fontSize: '0.9rem', fontWeight: '500' }}>{queue.length} tickets pendientes</span>
                </div>
                <button onClick={handleSyncQueue} disabled={isSyncing} style={{ background: '#38bdf8', color: 'white', padding: '0.4rem 0.8rem', fontSize: '0.8rem', borderRadius: '6px' }}>
                  {isSyncing ? <Loader2 size={14} className="animate-spin" /> : <><RefreshCw size={14} /> Sincronizar</>}
                </button>
              </div>
            )}
            <Camera size={64} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
            <h2>Captura un nuevo ticket</h2>
            <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {isMobile ? (
                <>
                  <button className="primary" onClick={() => fileInputRef.current?.click()} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}><Camera size={18} /> Tomar Foto</button>
                  <button onClick={() => galleryInputRef.current?.click()} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}><Upload size={18} /> Elegir de Galería</button>
                </>
              ) : (
                <button className="primary" onClick={() => galleryInputRef.current?.click()} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}><Upload size={18} /> Elegir Archivo</button>
              )}
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" capture="environment" style={{ display: 'none' }} />
              <input type="file" ref={galleryInputRef} onChange={handleFileUpload} accept="image/*" style={{ display: 'none' }} />
            </div>
          </div>
        )}
        {status === 'confirm_capture' && webpPhoto && (
          <>
            {isCropping ? (
              <div 
                style={{ 
                  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
                  background: '#000', zIndex: 1100, display: 'flex', 
                  flexDirection: 'column', overflow: 'hidden'
                }}
              >
                <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                  <Cropper 
                    ref={cropperRef}
                    src={webpPhoto} 
                    style={{ height: '100%', width: '100%' }}
                    initialAspectRatio={undefined}
                    guides={true}
                    viewMode={1}
                    background={false}
                    responsive={true}
                    autoCropArea={0.8}
                  />
                </div>
                <div style={{ background: 'rgba(0,0,0,0.8)', padding: '1.5rem', display: 'flex', justifyContent: 'center', gap: '1rem', borderTop: '1px solid #334155', flexShrink: 0 }}>
                   <button onClick={() => cropperRef.current?.cropper.rotate(-90)} style={{ background: '#1e293b' }}><RotateCcw size={24} /></button>
                   <button onClick={() => cropperRef.current?.cropper.rotate(90)} style={{ background: '#1e293b' }}><RotateCw size={24} /></button>
                   <button className="primary" onClick={handleCropSave}><Check size={24} /> Aplicar</button>
                   <button onClick={() => { setIsCropping(false); }} style={{ background: '#334155' }}><X size={24} /></button>
                </div>
              </div>
            ) : (
              <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
                <div style={{ maxHeight: '350px', overflow: 'hidden', borderBottom: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }} onClick={() => setIsViewingFullImage(true)}>
                   <img src={webpPhoto} alt="Confirm" style={{ width: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {isEnhancing ? ( <button disabled style={{ flex: 1 }}><Loader2 size={18} className="animate-spin" /> ...</button> ) : ( <button onClick={handleEnhance} style={{ flex: 1, background: 'rgba(255,255,255,0.05)', color: 'white' }} title="Mejorar calidad"><Sparkles size={18} /> Mejorar</button> )}
                    <button onClick={() => setIsCropping(true)} style={{ flex: 1, background: 'rgba(255,255,255,0.05)', color: 'white' }} title="Recortar"><Crop size={18} /> Recortar</button>
                    {photoHistory.length > 0 && ( <button onClick={handleUndo} style={{ flex: 0.4 }}><Undo2 size={18} /></button> )}
                  </div>
                  <button className="primary" onClick={() => handleAnalyze()} style={{ height: '50px', fontSize: '1.1rem' }}><Check size={24} /> Analizar Ticket</button>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button onClick={() => setStatus('idle')} style={{ flex: 1 }}><Camera size={18} /> Repetir</button>
                    <button onClick={() => setStatus('idle')} style={{ flex: 1, background: 'rgba(239, 68, 68, 0.1)', color: '#f87171' }}>Cancelar</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        {(status === 'processing' || status === 'saving') && (
          <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}><Loader2 size={48} className="animate-spin" style={{ margin: '0 auto 1.5rem' }} /><h2>{status === 'processing' ? 'Analizando...' : 'Guardando...'}</h2></div>
        )}
        {status === 'reviewing' && ticketData && (
          <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ maxHeight: '200px', overflow: 'hidden', borderBottom: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }} onClick={() => setIsViewingFullImage(true)}>
              <img src={webpPhoto || ''} alt="Ticket" style={{ width: '100%', objectFit: 'cover', objectPosition: 'center' }} title="Click para ver completa" />
            </div>
            <div style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ margin: 0 }}>Revisar Ticket</h3>
                <button onClick={() => setStatus('idle')} style={{ padding: '0.5rem', background: 'transparent' }}><X size={20} /></button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {renderEditableField('Proveedor', 'storeName')}
                {renderEditableField('Fecha y Hora', 'purchaseDate')}
                {renderEditableField('Método', 'paymentMethod')}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>{renderEditableField('Detalle', 'paymentDetail')}</div>
                  <div style={{ flex: 1 }}>{renderEditableField('¿Quién pagó?', 'paymentAccount')}</div>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>{renderEditableField('Monto', 'amount', 'number')}</div>
                  <div style={{ flex: 1.2 }}>{renderEditableField('Categoría', 'category')}</div>
                </div>
              </div>
              <button className="primary" style={{ width: '100%', marginTop: '1.5rem' }} onClick={handleSave}><Save size={20} /> Confirmar y Guardar</button>
            </div>
          </div>
        )}
        {status === 'success' && (
          <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
            <Check size={32} style={{ color: '#22c55e' }} />
            <h2>¡Guardado!</h2>
            <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.5rem' }}>Se ha registrado en DBTABLE_TICKETS</p>
            <button className="primary" onClick={() => setStatus('idle')} style={{ marginTop: '1.5rem' }}>Capturar otro</button>
          </div>
        )}
        {status === 'error' && (
          <div className="card" style={{ border: '1px solid var(--error)' }}><AlertCircle size={48} style={{ color: 'var(--error)', margin: '0 auto 1.5rem', display: 'block' }} /><h2>Error</h2><p>{error}</p><button className="primary" style={{ width: '100%', marginTop: '1.5rem' }} onClick={handleRetryAfterError}>{error?.includes('sesión de Google ha caducado') ? 'Volver a Intentar' : 'Ir al Inicio'}</button></div>
        )}
      </main>
      {isViewingFullImage && webpPhoto && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.95)', zIndex: 2000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setIsViewingFullImage(false)}>
          <button onClick={() => setIsViewingFullImage(false)} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'rgba(255,255,255,0.2)', color: 'white', borderRadius: '50%', padding: '0.5rem', zIndex: 2001, border: 'none', cursor: 'pointer' }}>
            <X size={32} />
          </button>
          <img src={webpPhoto} alt="Ticket Full" style={{ maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 0 40px rgba(0,0,0,0.5)' }} />
        </div>
      )}
      <footer style={{ marginTop: 'auto', padding: '2rem 0', textAlign: 'center', fontSize: '0.875rem', color: '#64748b' }}>
        Hecho por <a href="https://github.com/teshynil/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 'bold' }}>Teshynil</a> | versión ({APP_VERSION})
      </footer>
    </div>
  );
}

export default App;
