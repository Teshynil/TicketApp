import { useState, useEffect, useRef } from 'react';
import { Camera, Settings as SettingsIcon, Check, Loader2, AlertCircle, Save, X, Upload, History as HistoryIcon, Users, Plus, Trash2, Share2, Pencil, BookMarked, Zap, AlertTriangle } from 'lucide-react';
import { useConfig } from './hooks/useConfig';
import { Settings } from './components/Settings';
import { ModelTester } from './components/ModelTester';
import { convertToLosslessWebP, fileToDataUrl } from './utils/image';
import { copyToClipboard } from './utils/clipboard';
import { analyzeTicket } from './services/gemini';
import { initTokenClient, requestToken, uploadToDrive, appendToSheet, createSheet, getSheetValues, updateSheetValues, ensureSysLists, validateSchema, ensureSchema, getCustomInstructions } from './services/google';
import { APP_VERSION } from './version';
import type { TicketData } from './types';
import './index.css';

const PAYMENT_METHODS = ['Efectivo', 'Tarjeta', 'Transferencia', 'Otros'];

function App() {
  const { config, saveConfig, isConfigured, getShareUrl } = useConfig();
  const [showSettings, setShowSettings] = useState(!isConfigured);
  const [status, setStatus] = useState<'idle' | 'confirm_capture' | 'processing' | 'reviewing' | 'saving' | 'success' | 'error' | 'history' | 'accounts' | 'aliases' | 'benchmark'>(() => {
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
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  // Cache-aware initial states
  const [accounts, setAccounts] = useState<[string, string, string][]>(() => JSON.parse(localStorage.getItem('ticketapp_cache_accounts') || '[]'));
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [newAccount, setNewAccount] = useState({ digits: '', cardName: '', person: '' });
  const [people, setPeople] = useState<string[]>(() => JSON.parse(localStorage.getItem('ticketapp_cache_people') || '["Principal"]'));
  const [newPersonName, setNewPersonName] = useState('');
  const [editingPersonIdx, setEditingPersonIdx] = useState<number | null>(null);
  const [editPersonValue, setEditPersonName] = useState('');
  const [editingAccountIdx, setEditingAccountIdx] = useState<number | null>(null);
  const [editAccountData, setEditAccountData] = useState({ cardName: '', person: '' });
  const [editingField, setEditingField] = useState<string | null>(null);

  const [knownCategories, setKnownCategories] = useState<string[]>(() => JSON.parse(localStorage.getItem('ticketapp_cache_categories') || '[]'));
  const [knownStores, setKnownStores] = useState<string[]>(() => JSON.parse(localStorage.getItem('ticketapp_cache_stores') || '[]'));
  const [customInstructions, setCustomInstructions] = useState("");
  
  const [aliases, setAliases] = useState<[string, string][]>(() => JSON.parse(localStorage.getItem('ticketapp_cache_aliases') || '[]'));
  const [loadingAliases, setLoadingAliases] = useState(false);
  const [newAlias, setNewAlias] = useState({ legal: '', commercial: '' });
  const [saveAsAlias, setSaveAsAlias] = useState(false);
  const [originalDetectedStore, setOriginalDetectedStore] = useState(() => localStorage.getItem('ticketapp_original_store') || "");
  const [isViewingFullImage, setIsViewingFullImage] = useState(false);

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
    }
  }, [status, ticketData, webpPhoto, originalDetectedStore]);

  useEffect(() => {
    if (googleToken && isConfigured) {
      loadSysLists();
    }
  }, [googleToken, isConfigured]);

  const fetchAccounts = async (token: string) => {
    try {
      setLoadingAccounts(true);
      const data = await getSheetValues(token, config.googleSheetId!, 'Accounts!A2:C50');
      if (data.values) {
        setAccounts(data.values);
        localStorage.setItem('ticketapp_cache_accounts', JSON.stringify(data.values));
      } else {
        setAccounts([]);
      }
    } catch (err: any) { console.error('Error fetching accounts:', err); } finally { setLoadingAccounts(false); }
  };

  const fetchAliases = async (token: string) => {
    try {
      setLoadingAliases(true);
      const data = await getSheetValues(token, config.googleSheetId!, 'SYS_ALIASES!A2:B100');
      if (data.values) {
        setAliases(data.values);
        localStorage.setItem('ticketapp_cache_aliases', JSON.stringify(data.values));
      } else {
        setAliases([]);
      }
    } catch (err) { console.error('Error fetching aliases:', err); } finally { setLoadingAliases(false); }
  };

  const loadSysLists = async () => {
    try {
      if (!config.googleSheetId || !googleToken) return;
      await ensureSysLists(googleToken, config.googleSheetId);
      const data = await getSheetValues(googleToken, config.googleSheetId, 'SYS_LISTS!A2:C100');
      if (data.values) {
        const cats = data.values.map((row: any) => row[0]).filter(Boolean);
        const strs = data.values.map((row: any) => row[1]).filter(Boolean);
        const peopleList = data.values.map((row: any) => row[2]).filter(Boolean);
        
        setKnownCategories(cats);
        setKnownStores(strs);
        if (peopleList.length > 0) setPeople(peopleList);
        
        localStorage.setItem('ticketapp_cache_categories', JSON.stringify(cats));
        localStorage.setItem('ticketapp_cache_stores', JSON.stringify(strs));
        localStorage.setItem('ticketapp_cache_people', JSON.stringify(peopleList.length > 0 ? peopleList : people));
      }
      await fetchAccounts(googleToken);
      await fetchAliases(googleToken);
      const instructions = await getCustomInstructions(googleToken, config.googleSheetId);
      setCustomInstructions(instructions);
    } catch (err) { console.error('Failed to load SYS_LISTS:', err); }
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

  const handleAnalyze = async () => {
    try {
      if (!webpPhoto) return;
      setStatus('processing');
      const data = await analyzeTicket(config.geminiApiKey, webpPhoto, config.geminiModel, knownCategories, knownStores, customInstructions, aliases);
      setOriginalDetectedStore(data.storeName);
      setSaveAsAlias(false);
      if (data.paymentMethod === 'Efectivo') {
        data.paymentAccount = 'Principal';
      } else if (data.paymentMethod === 'Tarjeta' || data.paymentMethod === 'Transferencia') {
        const cleanDetail = data.paymentDetail.replace(/\D/g, '');
        const mapping = accounts.find(([digits]) => {
          const cleanMapDigits = String(digits).replace("'", "");
          return cleanDetail.includes(cleanMapDigits) || cleanMapDigits.includes(cleanDetail);
        });
        data.paymentAccount = mapping ? mapping[2] : '';
      }
      setTicketData(data);
      setStatus('reviewing');
    } catch (err: any) {
      setError(err.message || 'Error al procesar');
      setStatus('error');
    }
  };

  const loadAccountsView = async () => {
    setStatus('accounts');
    if (!googleToken) requestToken(); else await fetchAccounts(googleToken);
  };

  const loadAliasesView = async () => {
    setStatus('aliases');
    if (!googleToken) requestToken(); else await fetchAliases(googleToken);
  };

  const handleAddPerson = async () => {
    if (!newPersonName || people.includes(newPersonName)) return;
    const updated = [...people, newPersonName];
    try {
      setLoadingAccounts(true);
      const current = await getSheetValues(googleToken!, config.googleSheetId!, 'SYS_LISTS!A2:B100');
      const finalValues = updated.map((p, i) => [
        current.values?.[i]?.[0] || "",
        current.values?.[i]?.[1] || "",
        p
      ]);
      await updateSheetValues(googleToken!, config.googleSheetId!, `SYS_LISTS!A2:C${finalValues.length + 1}`, finalValues);
      setPeople(updated);
      setNewPersonName('');
    } catch (err) { setError('Error al añadir persona'); } finally { setLoadingAccounts(false); }
  };

  const handleRenamePerson = async (index: number) => {
    const oldName = people[index];
    const newName = editPersonValue;
    if (!newName || oldName === newName) { setEditingPersonIdx(null); return; }
    
    const updatedPeople = people.map((p, i) => i === index ? newName : p);
    const updatedAccounts = accounts.map(acc => [acc[0], acc[1], acc[2] === oldName ? newName : acc[2]]);
    
    try {
      setLoadingAccounts(true);
      const current = await getSheetValues(googleToken!, config.googleSheetId!, 'SYS_LISTS!A2:B100');
      const finalPeopleValues = updatedPeople.map((p, i) => [ current.values?.[i]?.[0] || "", current.values?.[i]?.[1] || "", p ]);
      await updateSheetValues(googleToken!, config.googleSheetId!, `SYS_LISTS!A2:C${finalPeopleValues.length + 1}`, finalPeopleValues);
      await updateSheetValues(googleToken!, config.googleSheetId!, `Accounts!A2:C${updatedAccounts.length + 1}`, updatedAccounts);
      setPeople(updatedPeople); setAccounts(updatedAccounts as any); setEditingPersonIdx(null);
    } catch (err) { setError('Error al renombrar persona'); } finally { setLoadingAccounts(false); }
  };

  const handleDeletePerson = async (index: number) => {
    if (people.length <= 1) return;
    const updated = people.filter((_, i) => i !== index);
    try {
      setLoadingAccounts(true);
      const current = await getSheetValues(googleToken!, config.googleSheetId!, 'SYS_LISTS!A2:B100');
      await updateSheetValues(googleToken!, config.googleSheetId!, 'SYS_LISTS!C2:C100', Array(99).fill(['']));
      const finalValues = updated.map((p, i) => [ current.values?.[i]?.[0] || "", current.values?.[i]?.[1] || "", p ]);
      await updateSheetValues(googleToken!, config.googleSheetId!, `SYS_LISTS!A2:C${finalValues.length + 1}`, finalValues);
      setPeople(updated);
    } catch (err) { setError('Error al eliminar persona'); } finally { setLoadingAccounts(false); }
  };

  const handleAddAccount = async () => {
    if (!newAccount.digits || !newAccount.cardName || !newAccount.person) return;
    const formattedDigits = `'${newAccount.digits}`;
    const updated = [...accounts, [formattedDigits, newAccount.cardName, newAccount.person]];
    try {
      setLoadingAccounts(true);
      await updateSheetValues(googleToken!, config.googleSheetId!, `Accounts!A2:C${updated.length + 1}`, updated);
      setAccounts(updated as any);
      setNewAccount({ digits: '', cardName: '', person: '' });
    } catch (err) { setError('Error al guardar cuenta'); } finally { setLoadingAccounts(false); }
  };

  const handleUpdateAccount = async (index: number) => {
    if (!editAccountData.cardName || !editAccountData.person) return;
    const updated = accounts.map((acc, i) => i === index ? [acc[0], editAccountData.cardName, editAccountData.person] : acc);
    try {
      setLoadingAccounts(true);
      await updateSheetValues(googleToken!, config.googleSheetId!, `Accounts!A2:C${updated.length + 1}`, updated);
      setAccounts(updated as any);
      setEditingAccountIdx(null);
    } catch (err) { setError('Error al actualizar cuenta'); } finally { setLoadingAccounts(false); }
  };

  const handleDeleteAccount = async (index: number) => {
    const updated = accounts.filter((_, i) => i !== index);
    try {
      setLoadingAccounts(true);
      await updateSheetValues(googleToken!, config.googleSheetId!, 'Accounts!A2:C50', Array(49).fill(['', '', ''])); 
      if (updated.length > 0) await updateSheetValues(googleToken!, config.googleSheetId!, `Accounts!A2:C${updated.length + 1}`, updated);
      setAccounts(updated);
    } catch (err) { setError('Error al eliminar cuenta'); } finally { setLoadingAccounts(false); }
  };

  const handleAddAlias = async () => {
    if (!newAlias.legal || !newAlias.commercial) return;
    const updated = [...aliases, [newAlias.legal, newAlias.commercial]];
    try {
      setLoadingAliases(true);
      await updateSheetValues(googleToken!, config.googleSheetId!, `SYS_ALIASES!A2:B${updated.length + 1}`, updated);
      setAliases(updated as any);
      setNewAlias({ legal: '', commercial: '' });
    } catch (err) { setError('Error al guardar alias'); } finally { setLoadingAliases(false); }
  };

  const handleDeleteAlias = async (index: number) => {
    const updated = aliases.filter((_, i) => i !== index);
    try {
      setLoadingAliases(true);
      await updateSheetValues(googleToken!, config.googleSheetId!, 'SYS_ALIASES!A2:B100', Array(99).fill(['', '']));
      if (updated.length > 0) await updateSheetValues(googleToken!, config.googleSheetId!, `SYS_ALIASES!A2:B${updated.length + 1}`, updated);
      setAliases(updated);
    } catch (err) { setError('Error al eliminar alias'); } finally { setLoadingAliases(false); }
  };

  const performSave = async (token: string) => {
    try {
      setStatus('saving');
      if (saveAsAlias && ticketData && originalDetectedStore && ticketData.storeName !== originalDetectedStore) {
        const updated = [...aliases, [originalDetectedStore, ticketData.storeName]];
        await updateSheetValues(token, config.googleSheetId!, `SYS_ALIASES!A2:B${updated.length + 1}`, updated);
        setAliases(updated as any);
      }
      if (ticketData?.paymentAccount && (ticketData.paymentMethod === 'Tarjeta' || ticketData.paymentMethod === 'Transferencia')) {
        const cleanDetail = ticketData.paymentDetail.replace(/\D/g, '');
        const exists = accounts.some(([digits]) => String(digits).replace("'", "") === cleanDetail);
        if (!exists && cleanDetail.length >= 4) {
          const updated = [...accounts, [`'${cleanDetail}`, ticketData.paymentMethod === 'Tarjeta' ? 'Nueva Tarjeta' : 'Nueva Transferencia', ticketData.paymentAccount]];
          await updateSheetValues(token, config.googleSheetId!, `Accounts!A2:C${updated.length + 1}`, updated);
          setAccounts(updated as any);
        }
      }
      const filename = `ticket_${ticketData?.storeName}_${new Date().getTime()}.webp`.replace(/\s+/g, '_');
      const driveResp = await uploadToDrive(token, webpPhoto!, filename, config.googleDriveFolderId);
      const updatedTicket = { ...ticketData!, driveLink: driveResp.webViewLink };
      if (!config.googleSheetId) {
        const newSheet = await createSheet(token, 'TicketApp Data');
        saveConfig({ ...config, googleSheetId: newSheet.spreadsheetId });
        await appendToSheet(token, newSheet.spreadsheetId, updatedTicket);
      } else {
        await appendToSheet(token, config.googleSheetId, updatedTicket);
      }
      setStatus('success');
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

  const loadHistory = async () => {
    if (!config.googleSheetId) { setError('Configura el Sheet ID'); return; }
    const fetchHistory = async (token: string) => {
      try {
        setLoadingHistory(true); setStatus('history');
        const data = await getSheetValues(token, config.googleSheetId!, 'TicketsForm!A2:J100');
        if (data.values) setHistory(data.values); else setHistory([]);
      } catch (err: any) { setError('Error al cargar historial'); } finally { setLoadingHistory(false); }
    };
    if (!googleToken) requestToken(); else fetchHistory(googleToken);
  };

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
    try { return await validateSchema(googleToken, sheetId); } catch (e: any) { return { success: false, message: e.message }; }
  };

  const handleCreateSchema = async (sheetId: string) => {
    if (!googleToken) return { success: false, message: "Inicia sesión primero" };
    try { return await ensureSchema(googleToken, sheetId); } catch (e: any) { return { success: false, message: e.message }; }
  };

  const isDuplicate = () => {
    if (!ticketData) return false;
    const rawId = `${ticketData.purchaseDate}-${ticketData.amount}-${ticketData.storeName}-${ticketData.category}`;
    const currentTxnId = `TXN-${btoa(unescape(encodeURIComponent(rawId))).substring(0, 16).toUpperCase()}`;
    return history.some(row => row[9] === currentTxnId);
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
    
    // Selectors logic
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
                  <select
                    style={{ flex: 1, height: '42px', borderRadius: '8px', border: '1px solid var(--primary)', background: '#1e293b', color: 'white' }}
                    value={list.some(item => String(value).startsWith(item)) ? list.find(item => String(value).startsWith(item)) : ''}
                    onChange={(e) => { 
                      const val = e.target.value;
                      if (val === 'Otros') {
                        setTicketData({ ...ticketData, [field]: 'Otros ()' });
                      } else {
                        setTicketData({ ...ticketData, [field]: val });
                        setEditingField(null);
                      }
                    }}
                  >
                    <option value="">Seleccionar...</option>
                    {list.map(item => <option key={item} value={item}>{item}</option>)}
                    {(field !== 'paymentAccount' && field !== 'paymentMethod') && <option value="NEW">+ Nuevo...</option>}
                  </select>

                  {/* Contextual secondary input */}
                  {field === 'paymentMethod' && String(value).startsWith('Otros') && (
                    <input 
                      autoFocus
                      placeholder="¿Qué método?"
                      type="text"
                      value={String(value).match(/\((.*)\)/)?.[1] || ''}
                      onChange={(e) => setTicketData({ ...ticketData, [field]: `Otros (${e.target.value})` })}
                      style={{ flex: 1.5, border: '1px solid var(--primary)' }}
                    />
                  )}

                  {field !== 'paymentAccount' && field !== 'paymentMethod' && (
                    <input autoFocus placeholder="Nuevo..." type="text" value={list.includes(value as string) ? '' : value as string} onChange={(e) => { setTicketData({ ...ticketData, [field]: e.target.value }); if (field === 'storeName') setSaveAsAlias(true); }} style={{ flex: 1.5, border: '1px solid var(--primary)' }} />
                  )}
                  <button onClick={() => setEditingField(null)} style={{ background: 'var(--primary)', padding: '0.5rem' }}> <Check size={18} /> </button>
                </div>
              ) : field === 'description' ? (
                <div style={{ flex: 1, display: 'flex', gap: '0.5rem' }}>
                  <textarea autoFocus value={value as string} onChange={(e) => setTicketData({ ...ticketData, [field]: e.target.value })} onBlur={() => setEditingField(null)} style={{ width: '100%', minHeight: '60px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--primary)', borderRadius: '8px', color: 'white', padding: '0.5rem' }} />
                  <button onClick={() => setEditingField(null)} style={{ background: 'var(--primary)', padding: '0.5rem' }}> <Check size={18} /> </button>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', gap: '0.5rem' }}>
                  <input autoFocus type={field === 'purchaseDate' ? 'datetime-local' : type} value={value as any} onChange={(e) => setTicketData({ ...ticketData, [field]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value })} onBlur={() => setEditingField(null)} onKeyDown={(e) => e.key === 'Enter' && setEditingField(null)} style={{ flex: 1, border: '1px solid var(--primary)' }} />
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
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem', color: 'var(--primary)', marginTop: '0.25rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={saveAsAlias} onChange={e => setSaveAsAlias(e.target.checked)} />
                  Tratar "{value as string}" como alias de "{originalDetectedStore}"
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
          {config.analysisMode && <button onClick={() => setStatus('benchmark')} title="Benchmark"><Zap size={20} color="var(--primary)" /></button>}
          <button onClick={loadAliasesView} title="Alias"><BookMarked size={20} /></button>
          <button onClick={loadAccountsView} title="Cuentas"><Users size={20} /></button>
          <button onClick={loadHistory} title="Historial"><HistoryIcon size={20} /></button>
          <button onClick={() => { const url = getShareUrl(); if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(url).then(() => alert('Copiado!')).catch(() => copyToClipboard(url) && alert('Copiado!')); } else { copyToClipboard(url) && alert('Copiado!'); } }} title="Compartir"><Share2 size={20} /></button>
          <button onClick={() => setShowSettings(true)}><SettingsIcon size={20} /></button>
        </div>
      </header>
      <main style={{ marginTop: '2rem' }}>
        {status === 'idle' && (
          <div className="card" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
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
        {status === 'accounts' && (
          <div className="card" style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}><h3>Gestionar Personas y Tarjetas</h3><button onClick={() => setStatus('idle')}><X size={20} /></button></div>
            <div style={{ marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <h4 style={{ fontSize: '0.85rem', color: 'var(--primary)', marginBottom: '0.75rem' }}>Personas</h4>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                <input type="text" placeholder="Nueva Persona" style={{ flex: 1 }} value={newPersonName} onChange={e => setNewPersonName(e.target.value)} />
                <button className="primary" onClick={handleAddPerson} disabled={loadingAccounts}><Plus size={20} /></button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {people.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'rgba(255,255,255,0.05)', padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    {editingPersonIdx === i ? (
                      <>
                        <input autoFocus type="text" value={editPersonValue} onChange={e => setEditPersonName(e.target.value)} style={{ width: '80px', fontSize: '0.85rem', padding: '0.1rem' }} />
                        <button onClick={() => handleRenamePerson(i)} style={{ padding: '0.1rem', background: 'transparent' }}><Check size={14} color="var(--primary)"/></button>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: '0.85rem' }}>{p}</span>
                        <button onClick={() => { setEditingPersonIdx(i); setEditPersonName(p); }} style={{ padding: '0.1rem', background: 'transparent' }}><Pencil size={12} /></button>
                        {p !== 'Principal' && <button onClick={() => handleDeletePerson(i)} style={{ padding: '0.1rem', background: 'transparent' }}><X size={12} color="var(--error)"/></button>}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <h4 style={{ fontSize: '0.85rem', color: 'var(--primary)', marginBottom: '0.75rem' }}>Vincular Tarjeta / Transferencia</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input type="text" placeholder="Dígitos" style={{ flex: 1 }} value={newAccount.digits} onChange={e => setNewAccount({...newAccount, digits: e.target.value})} />
                <input type="text" placeholder="Alias" style={{ flex: 2 }} value={newAccount.cardName} onChange={e => setNewAccount({...newAccount, cardName: e.target.value})} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select style={{ flex: 1, background: '#1e293b', color: 'white' }} value={newAccount.person} onChange={e => setNewAccount({...newAccount, person: e.target.value})}>
                  <option value="">¿A quién?</option>{people.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <button className="primary" onClick={handleAddAccount} disabled={loadingAccounts}>Vincular</button>
              </div>
            </div>
            {loadingAccounts ? <Loader2 size={24} className="animate-spin" /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}> 
                {accounts.map((acc, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}> 
                    {editingAccountIdx === i ? (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--primary)' }}>*{String(acc[0]).replace("'", "")}</div>
                        <input type="text" value={editAccountData.cardName} onChange={e => setEditAccountData({...editAccountData, cardName: e.target.value})} placeholder="Alias" />
                        <select style={{ background: '#1e293b', color: 'white' }} value={editAccountData.person} onChange={e => setEditAccountData({...editAccountData, person: e.target.value})}>{people.map(p => <option key={p} value={p}>{p}</option>)}</select>
                        <div style={{ display: 'flex', gap: '0.5rem' }}><button className="primary" onClick={() => handleUpdateAccount(i)} style={{ flex: 1, padding: '0.25rem' }}><Check size={16} /></button><button onClick={() => setEditingAccountIdx(null)} style={{ flex: 1, padding: '0.25rem' }}><X size={16} /></button></div>
                      </div>
                    ) : (
                      <><div><strong>*{String(acc[0]).replace("'", "")}</strong> {acc[1]} <br/><span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{acc[2]}</span></div> <div style={{ display: 'flex', gap: '0.25rem' }}><button onClick={() => { setEditingAccountIdx(i); setEditAccountData({ cardName: acc[1], person: acc[2] }); }} style={{ background: 'transparent', padding: '0.5rem' }}><Pencil size={16} /></button><button onClick={() => handleDeleteAccount(i)} style={{ background: 'transparent', padding: '0.5rem' }}><Trash2 size={16} color="var(--error)" /></button></div></>
                    )}
                  </div>
                ))} 
              </div>
            )}
          </div>
        )}
        {status === 'aliases' && (
          <div className="card" style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}><h3>Gestionar Alias</h3><button onClick={() => setStatus('idle')}><X size={20} /></button></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <input type="text" placeholder="Nombre Legal" value={newAlias.legal} onChange={e => setNewAlias({...newAlias, legal: e.target.value})} />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input type="text" placeholder="Alias Comercial" style={{ flex: 1 }} value={newAlias.commercial} onChange={e => setNewAlias({...newAlias, commercial: e.target.value})} />
                <button className="primary" onClick={handleAddAlias} disabled={loadingAliases}><Plus size={20} /></button>
              </div>
            </div>
            {loadingAliases ? <Loader2 size={24} className="animate-spin" /> : <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}> {aliases.map((al, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: 'rgba(255,255,255,0.03)' }}> <div><div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{al[0]}</div><strong>{al[1]}</strong></div> <button onClick={() => handleDeleteAlias(i)}><Trash2 size={18} /></button> </div>)} </div>}
          </div>
        )}
        {status === 'benchmark' && (
          <div style={{ marginTop: '2rem' }}>
            <ModelTester apiKey={config.geminiApiKey} imageBase64={webpPhoto} onClose={() => setStatus('idle')} knownCategories={knownCategories} knownStores={knownStores} customInstructions={customInstructions} aliases={aliases} />
          </div>
        )}
        {status === 'history' && (
          <div className="card" style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}><h3>Historial</h3><button onClick={() => setStatus('idle')}><X size={20} /></button></div>
            {loadingHistory ? <Loader2 size={32} className="animate-spin" /> : history.length === 0 ? <p>Sin tickets.</p> : <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}> {history.map((row, i) => <div key={i} className="card" style={{ padding: '1rem' }}> <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>{row[3]}</strong> <span>${row[4]}</span></div> <div>{row[1].replace('T', ' ')} | {row[7]}</div> </div>)} </div>}
          </div>
        )}
        {status === 'confirm_capture' && webpPhoto && (
          <div className="card" style={{ padding: '0' }}><img src={webpPhoto} alt="Preview" style={{ width: '100%' }} /><div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}><button className="primary" onClick={handleAnalyze}><Check size={20} /> Analizar Ticket</button><button onClick={() => setStatus('idle')}><Camera size={20} /> Repetir</button><button onClick={() => setStatus('idle')}>Cancelar</button></div></div>
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

              {isDuplicate() && (
                <div style={{ marginBottom: '1.5rem', padding: '0.75rem', borderRadius: '8px', background: 'rgba(234, 179, 8, 0.1)', color: '#eab308', border: '1px solid rgba(234, 179, 8, 0.2)', fontSize: '0.8rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <AlertTriangle size={16} /> 
                  <span><strong>Atención:</strong> Ya existe un registro igual en tu historial.</span>
                </div>
              )}
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {renderEditableField('Proveedor', 'storeName')}
                {renderEditableField('Fecha y Hora', 'purchaseDate')}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>{renderEditableField('Método', 'paymentMethod')}</div>
                  <div style={{ flex: 1 }}>{renderEditableField('Detalle', 'paymentDetail')}</div>
                </div>
                {renderEditableField('¿Quién pagó?', 'paymentAccount')}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>{renderEditableField('Monto', 'amount', 'number')}</div>
                  <div style={{ flex: 1.2 }}>{renderEditableField('Categoría', 'category')}</div>
                </div>
                {renderEditableField('Descripción', 'description')}
              </div>
              <button className="primary" style={{ width: '100%', marginTop: '1.5rem' }} onClick={handleSave}><Save size={20} /> Confirmar y Guardar</button>
            </div>
          </div>
        )}
        {status === 'success' && (
          <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem' }}><Check size={32} style={{ color: '#22c55e' }} /><h2>¡Guardado!</h2><button className="primary" onClick={() => setStatus('idle')}>Capturar otro</button>{config.googleSheetId && <a href={`https://docs.google.com/spreadsheets/d/${config.googleSheetId}`} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginTop: '1rem' }}>Abrir Sheet</a>}</div>
        )}
        {status === 'error' && (
          <div className="card" style={{ border: '1px solid var(--error)' }}><AlertCircle size={48} style={{ color: 'var(--error)', margin: '0 auto 1.5rem', display: 'block' }} /><h2>Error</h2><p>{error}</p><button className="primary" style={{ width: '100%', marginTop: '1.5rem' }} onClick={handleRetryAfterError}>{error?.includes('sesión de Google ha caducado') ? 'Volver a Intentar' : 'Ir al Inicio'}</button></div>
        )}
      </main>

      {/* Full Image Modal */}
      {isViewingFullImage && webpPhoto && (
        <div 
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.95)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={() => setIsViewingFullImage(false)}
        >
          <button onClick={() => setIsViewingFullImage(false)} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'rgba(255,255,255,0.2)', color: 'white', borderRadius: '50%', padding: '0.5rem', zIndex: 1001, border: 'none', cursor: 'pointer' }}>
            <X size={32} />
          </button>
          <img 
            src={webpPhoto} 
            alt="Ticket Full" 
            style={{ maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 0 40px rgba(0,0,0,0.5)' }} 
          />
        </div>
      )}

      <footer style={{ marginTop: 'auto', padding: '2rem 0', textAlign: 'center', fontSize: '0.875rem', color: '#64748b' }}>
        Hecho por <a href="https://github.com/teshynil/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 'bold' }}>Teshynil</a> | versión ({APP_VERSION})
      </footer>
    </div>
  );
}

export default App;
