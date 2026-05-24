import React, { useState } from 'react';
import { Save, X, Key, Globe, Settings as SettingsIcon, Brain, ShieldCheck, AlertTriangle, FileCode } from 'lucide-react';
import type { AppConfig } from '../types';

interface SettingsProps {
  config: AppConfig;
  googleToken: string | null;
  onLogin: () => void;
  onSave: (config: AppConfig) => void;
  onClose: () => void;
  onValidateSchema: (sheetId: string) => Promise<{ success: boolean; message: string }>;
  onCreateSchema: (sheetId: string) => Promise<{ success: boolean; message: string }>;
}

export const Settings: React.FC<SettingsProps> = ({ config, googleToken, onLogin, onSave, onClose, onValidateSchema, onCreateSchema }) => {
  const [localConfig, setLocalConfig] = useState<AppConfig>(config);
  const [validationResult, setValidationResult] = useState<{ success: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSave = () => {
    onSave(localConfig);
  };

  const handleValidate = async () => {
    if (!localConfig.googleSheetId) {
      setValidationResult({ success: false, message: "Escribe un Sheet ID primero" });
      return;
    }
    setLoading(true);
    const res = await onValidateSchema(localConfig.googleSheetId);
    setValidationResult(res);
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!localConfig.googleSheetId) {
      setValidationResult({ success: false, message: "Escribe un Sheet ID primero" });
      return;
    }
    setLoading(true);
    const res = await onCreateSchema(localConfig.googleSheetId);
    setValidationResult(res);
    setLoading(false);
  };

  const isInitialSetup = !config.geminiApiKey || !config.googleClientId;

  return (
    <div className="card" style={{ maxWidth: '500px', margin: '2rem auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: 0 }}>
          <SettingsIcon size={24} /> {isInitialSetup ? 'Configuración Inicial' : 'Configuración'}
        </h2>
        {!isInitialSetup && (
          <button onClick={onClose} style={{ padding: '0.5rem', background: 'transparent' }}>
            <X size={20} />
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* STEP 1: MINIMUM REQUIRED */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ fontSize: '0.9rem', color: 'var(--primary)', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>Básico (Requerido)</h3>
          
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Gemini API Key</label>
            <div style={{ position: 'relative' }}>
              <Key size={18} style={{ position: 'absolute', left: '0.75rem', top: '0.75rem', color: '#64748b' }} />
              <input
                type="password"
                style={{ paddingLeft: '2.5rem' }}
                value={localConfig.geminiApiKey}
                onChange={(e) => setLocalConfig({ ...localConfig, geminiApiKey: e.target.value })}
                placeholder="AIza..."
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Google Client ID</label>
            <div style={{ position: 'relative' }}>
              <Globe size={18} style={{ position: 'absolute', left: '0.75rem', top: '0.75rem', color: '#64748b' }} />
              <input
                type="text"
                style={{ paddingLeft: '2.5rem' }}
                value={localConfig.googleClientId}
                onChange={(e) => setLocalConfig({ ...localConfig, googleClientId: e.target.value })}
                placeholder="821722..."
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Sheet ID (Opcional)</label>
              <input
                type="text"
                value={localConfig.googleSheetId || ''}
                onChange={(e) => setLocalConfig({ ...localConfig, googleSheetId: e.target.value })}
                placeholder="1abc..."
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Folder ID (Opcional)</label>
              <input
                type="text"
                value={localConfig.googleDriveFolderId || ''}
                onChange={(e) => setLocalConfig({ ...localConfig, googleDriveFolderId: e.target.value })}
                placeholder="1xyz..."
              />
            </div>
          </div>
        </section>

        {/* STEP 2: ADVANCED (Only if basic is done) */}
        {!isInitialSetup && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            <h3 style={{ fontSize: '0.9rem', color: 'var(--primary)', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>Avanzado & Schema</h3>
            
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Modelo de IA</label>
              <div style={{ position: 'relative' }}>
                <Brain size={18} style={{ position: 'absolute', left: '0.75rem', top: '0.75rem', color: '#64748b' }} />
                <select
                  style={{ paddingLeft: '2.5rem', width: '100%', height: '42px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: '#1e293b', color: 'white' }}
                  value={localConfig.geminiModel || 'gemini-flash-latest'}
                  onChange={(e) => setLocalConfig({ ...localConfig, geminiModel: e.target.value })}
                >
                  <option value="gemini-flash-latest">Gemini Flash (Recomendado)</option>
                  <option value="gemini-3-flash-preview">Gemini 3 Flash Preview</option>
                  <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite</option>
                  <option value="gemma-4-26b-a4b-it">Gemma 4 26B IT</option>
                  <option value="gemma-4-31b-it">Gemma 4 31B IT</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div>
                <div style={{ fontSize: '0.875rem', fontWeight: 'bold' }}>Modo de Análisis</div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Habilita la comparación de modelos</div>
              </div>
              <input 
                type="checkbox" 
                style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                checked={localConfig.analysisMode || false}
                onChange={e => setLocalConfig({ ...localConfig, analysisMode: e.target.checked })}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {!googleToken ? (
                <button onClick={onLogin} style={{ flex: 1, background: '#4285f4', color: 'white', fontSize: '0.75rem', height: 'auto', padding: '0.5rem' }}>
                   Conectar con Google
                </button>
              ) : (
                <>
                  <button onClick={handleValidate} disabled={loading} style={{ flex: 1, fontSize: '0.75rem', height: 'auto', padding: '0.5rem' }}>
                    <ShieldCheck size={14} /> Validar Schema
                  </button>
                  <button onClick={handleCreate} disabled={loading} style={{ flex: 1, fontSize: '0.75rem', height: 'auto', padding: '0.5rem' }}>
                    <FileCode size={14} /> Reparar/Crear
                  </button>
                </>
              )}
            </div>

            {validationResult && (
              <div style={{ 
                padding: '0.75rem', 
                borderRadius: '8px', 
                fontSize: '0.8rem',
                background: validationResult.success ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                color: validationResult.success ? '#4ade80' : '#f87171',
                border: `1px solid ${validationResult.success ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'start'
              }}>
                {validationResult.success ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}
                {validationResult.message}
              </div>
            )}
          </section>
        )}
      </div>

      <button className="primary" onClick={handleSave} style={{ width: '100%', marginTop: '2rem' }}>
        <Save size={20} /> Guardar Configuración
      </button>
    </div>
  );
};
