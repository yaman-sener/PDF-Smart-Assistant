import React, { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, CheckCircle2, AlertCircle, ExternalLink, Trash2, Loader2, X, ShieldCheck } from 'lucide-react';
import { getStoredApiKey, setStoredApiKey, removeStoredApiKey } from '../lib/apiKeyStorage';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  hasServerApiKey?: boolean;
}

export function ApiKeyModal({ isOpen, onClose, hasServerApiKey = false }: ApiKeyModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState<{ status: 'idle' | 'testing' | 'success' | 'error', message: string }>({
    status: 'idle',
    message: ''
  });
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setApiKey(getStoredApiKey());
      setTestState({ status: 'idle', message: '' });
      setSaveSuccess(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    const trimmed = apiKey.trim();
    if (trimmed) {
      setStoredApiKey(trimmed);
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 1000);
    } else {
      removeStoredApiKey();
      setApiKey('');
      onClose();
    }
  };

  const handleRemove = () => {
    removeStoredApiKey();
    setApiKey('');
    setTestState({ status: 'idle', message: '' });
  };

  const handleTestKey = async () => {
    const keyToTest = apiKey.trim() || getStoredApiKey();
    if (!keyToTest && !hasServerApiKey) {
      setTestState({ status: 'error', message: 'Test etmek için bir API anahtarı giriniz.' });
      return;
    }

    setTestState({ status: 'testing', message: 'Gemini 2.5 Flash ile bağlantı test ediliyor...' });

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (keyToTest) {
        headers['x-gemini-api-key'] = keyToTest;
      }

      const res = await fetch('/api/test-key', {
        method: 'POST',
        headers
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setTestState({ status: 'success', message: 'Bağlantı Başarılı! Gemini API anahtarınız aktif ve çalışıyor.' });
      } else {
        setTestState({ status: 'error', message: data.error || data.message || 'API anahtarı doğrulanamadı.' });
      }
    } catch (e: any) {
      setTestState({ status: 'error', message: 'Sunucuya bağlanılamadı: ' + e.message });
    }
  };

  const hasStoredKey = Boolean(getStoredApiKey());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden relative text-slate-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Key size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Gemini API Anahtarı</h2>
              <p className="text-[11px] text-slate-400">Yapay zeka analizlerini etkinleştirin</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Status Badge */}
          <div className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
            hasStoredKey 
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : hasServerApiKey
              ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
          }`}>
            <ShieldCheck size={18} className="shrink-0 mt-0.5" />
            <div className="text-[11px] leading-relaxed">
              {hasStoredKey ? (
                <span><strong>Kişisel Anahtar Aktif:</strong> Tarayıcınızda kayıtlı anahtar tüm AI işlemlerinde öncelikli kullanılır.</span>
              ) : hasServerApiKey ? (
                <span><strong>Sunucu Anahtarı Hazır:</strong> Arka planda tanımlı bir Gemini anahtarı var. Dilerseniz kendi anahtarınızı girerek değiştirebilirsiniz.</span>
              ) : (
                <span><strong>API Anahtarı Gerekli:</strong> Belge analizi, özetleme ve sohbet için geçerli bir Google Gemini API anahtarı yapıştırın.</span>
              )}
            </div>
          </div>

          {/* API Key Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
              <span>Google Gemini API Key</span>
              <a 
                href="https://aistudio.google.com/app/apikey" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 hover:underline"
              >
                Ücretsiz Anahtar Al <ExternalLink size={10} />
              </a>
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 pr-10 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/50 transition-colors font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                title={showKey ? 'Gizle' : 'Göster'}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* Test Status Feedback */}
          {testState.status !== 'idle' && (
            <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 border ${
              testState.status === 'testing' 
                ? 'bg-slate-800 text-slate-300 border-white/10'
                : testState.status === 'success'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                : 'bg-red-500/10 text-red-300 border-red-500/20'
            }`}>
              {testState.status === 'testing' && <Loader2 size={14} className="animate-spin text-indigo-400 shrink-0" />}
              {testState.status === 'success' && <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />}
              {testState.status === 'error' && <AlertCircle size={14} className="text-red-400 shrink-0" />}
              <span className="text-[11px] leading-tight">{testState.message}</span>
            </div>
          )}

          {saveSuccess && (
            <div className="p-2 bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 rounded-lg text-xs flex items-center gap-2">
              <CheckCircle2 size={14} /> API Anahtarı başarıyla kaydedildi!
            </div>
          )}

          {/* Privacy Note */}
          <p className="text-[10px] text-slate-500 leading-relaxed">
            🔒 <strong>Güvenlik:</strong> API anahtarınız yalnızca bu tarayıcıda (<code className="text-indigo-400">localStorage</code>) tutulur ve yalnızca doğrudan Gemini API istekleri için kullanılır.
          </p>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-white/10 bg-slate-900/80 flex items-center justify-between gap-2">
          <div>
            {hasStoredKey && (
              <button
                type="button"
                onClick={handleRemove}
                className="px-3 py-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition-colors flex items-center gap-1.5"
              >
                <Trash2 size={13} /> Anahtarı Sil
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTestKey}
              disabled={testState.status === 'testing'}
              className="px-3 py-2 text-xs text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors disabled:opacity-50"
            >
              {testState.status === 'testing' ? 'Test Ediliyor...' : 'Test Et'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-500 hover:bg-indigo-600 rounded-xl transition-colors shadow-lg shadow-indigo-500/20"
            >
              Kaydet & Kullan
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
