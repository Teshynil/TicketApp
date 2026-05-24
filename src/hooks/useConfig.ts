import { useState } from 'react';
import type { AppConfig } from '../types';

export const useConfig = () => {
  const [config, setConfig] = useState<AppConfig>(() => {
    // 1. Try to load from URL first
    const params = new URLSearchParams(window.location.search);
    const configParam = params.get('c');
    if (configParam) {
      try {
        const decoded = JSON.parse(atob(configParam));
        // Save to localStorage so it persists
        localStorage.setItem('ticketapp_config', JSON.stringify(decoded));
        // Clear URL to avoid re-importing on reload
        window.history.replaceState({}, '', window.location.pathname);
        return decoded;
      } catch (e) {
        console.error('Failed to parse config from URL');
      }
    }

    // 2. Load from localStorage
    const saved = localStorage.getItem('ticketapp_config');
    return saved ? JSON.parse(saved) : {
      geminiApiKey: '',
      geminiModel: 'gemini-flash-latest',
      googleClientId: '',
      googleSheetId: '',
      googleDriveFolderId: '',
      analysisMode: false,
    };
  });

  const saveConfig = (newConfig: AppConfig) => {
    setConfig(newConfig);
    localStorage.setItem('ticketapp_config', JSON.stringify(newConfig));
  };

  const isConfigured = !!(config.geminiApiKey && config.googleClientId);

  const getShareUrl = () => {
    const encoded = btoa(JSON.stringify(config));
    const url = new URL(window.location.href);
    url.searchParams.set('c', encoded);
    return url.toString();
  };

  return { config, saveConfig, isConfigured, getShareUrl };
};
