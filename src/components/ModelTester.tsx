import React, { useState } from 'react';
import { Play, Check, X, Loader2, Zap, Eye } from 'lucide-react';
import { analyzeTicket } from '../services/gemini';
import type { TicketData } from '../types';

interface BenchResult {
  model: string;
  time: number;
  success: boolean;
  error?: string;
  data?: TicketData;
}

interface ModelTesterProps {
  apiKey: string;
  imageBase64: string | null;
  onClose: () => void;
  knownCategories: string[];
  knownStores: string[];
  customInstructions: string;
  aliases: [string, string][];
}

const MODELS = [
  { id: 'gemini-flash-latest', name: 'Gemini Flash Latest' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
  { id: 'gemma-4-26b-a4b-it', name: 'Gemma 4 26B IT' },
  { id: 'gemma-4-31b-it', name: 'Gemma 4 31B IT' }
];

export const ModelTester: React.FC<ModelTesterProps> = ({ 
  apiKey, imageBase64, onClose, knownCategories, knownStores, customInstructions, aliases 
}) => {
  const [results, setResults] = useState<BenchResult[]>([]);
  const [runningModel, setRunningModel] = useState<string | null>(null);
  const [viewingData, setViewingData] = useState<TicketData | null>(null);

  const runBenchmark = async () => {
    if (!imageBase64) {
      alert("Toma una foto primero en la pantalla principal");
      return;
    }

    setResults([]);
    
    for (const model of MODELS) {
      setRunningModel(model.id);
      const startTime = Date.now();
      
      try {
        const data = await analyzeTicket(
          apiKey, 
          imageBase64, 
          model.id, 
          knownCategories, 
          knownStores, 
          customInstructions,
          aliases
        );
        
        const endTime = Date.now();
        setResults(prev => [...prev, {
          model: model.name,
          time: (endTime - startTime) / 1000,
          success: true,
          data
        }]);
      } catch (err: any) {
        setResults(prev => [...prev, {
          model: model.name,
          time: (Date.now() - startTime) / 1000,
          success: false,
          error: err.message
        }]);
      }
    }
    setRunningModel(null);
  };

  return (
    <div className="card" style={{ width: '100%', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <Zap size={24} color="var(--primary)" /> Benchmark de Modelos
        </h2>
        <button onClick={onClose} style={{ background: 'transparent' }}><X size={24} /></button>
      </div>

      <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
        Esta pantalla compara la velocidad de respuesta de todos los modelos disponibles usando la última imagen capturada.
      </p>

      {viewingData ? (
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h3 style={{ fontSize: '0.9rem', color: 'var(--primary)' }}>Vista Previa de Extracción:</h3>
            <button onClick={() => setViewingData(null)} style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>Cerrar Vista</button>
          </div>
          <pre style={{ 
            background: 'rgba(0,0,0,0.3)', 
            padding: '1rem', 
            borderRadius: '8px', 
            fontSize: '0.75rem', 
            overflowX: 'auto',
            maxHeight: '200px',
            border: '1px solid rgba(255,255,255,0.1)'
          }}>
            {JSON.stringify(viewingData, null, 2)}
          </pre>
        </div>
      ) : (
        <div style={{ background: 'rgba(56, 189, 248, 0.05)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid rgba(56, 189, 248, 0.1)' }}>
          <h3 style={{ fontSize: '0.85rem', color: 'var(--primary)', marginBottom: '0.5rem' }}>Detalles de la Imagen Enviada:</h3>
          <ul style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, paddingLeft: '1.2rem' }}>
            <li><strong>Formato:</strong> WebP (Lossy)</li>
            <li><strong>Dimensiones:</strong> Máx 1600px (Lado más largo), manteniendo proporción.</li>
            <li><strong>Calidad:</strong> 80% (Balance óptimo entre peso y OCR).</li>
            <li><strong>Codificación:</strong> Base64 (Data URL).</li>
          </ul>
        </div>
      )}

      {imageBase64 && (
        <button 
          className="primary" 
          onClick={runBenchmark} 
          disabled={!!runningModel}
          style={{ width: '100%', marginBottom: '2rem' }}
        >
          {runningModel ? <><Loader2 className="animate-spin" size={18} /> Probando {runningModel}...</> : <><Play size={18} /> Iniciar Prueba de Velocidad</>}
        </button>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {MODELS.map(m => {
          const res = results.find(r => r.model === m.name);
          const isRunning = runningModel === m.id;

          return (
            <div key={m.id} style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              padding: '1rem', 
              background: 'rgba(255,255,255,0.03)', 
              borderRadius: '8px',
              border: isRunning ? '1px solid var(--primary)' : '1px solid transparent'
            }}>
              <div>
                <div style={{ fontWeight: 'bold' }}>{m.name}</div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{m.id}</div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                {isRunning && <Loader2 className="animate-spin" size={18} color="var(--primary)" />}
                {res && (
                  <>
                    <button 
                      onClick={() => setViewingData(res.data || null)}
                      style={{ background: 'rgba(255,255,255,0.05)', padding: '0.4rem', border: '1px solid rgba(255,255,255,0.1)' }}
                      title="Ver Resultado"
                      disabled={!res.success}
                    >
                      <Eye size={16} />
                    </button>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: res.success ? '#4ade80' : '#f87171' }}>
                        {res.time.toFixed(2)}s
                      </div>
                    </div>
                    {res.success ? <Check size={20} color="#4ade80" /> : <X size={20} color="#f87171" />}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
