import React, { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, CheckCircle2, AlertCircle, ExternalLink, Trash2, Loader2, X, ShieldCheck, Save, Check } from 'lucide-react';
import { getStoredApiKey, setStoredApiKey, removeStoredApiKey } from '../lib/apiKeyStorage';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  hasServerApiKey?: boolean;
}

export function ApiKeyModal({ isOpen, onClose, hasServerApiKey = false }: ApiKeyModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [persistOnDisk, setPersistOnDisk] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [testState, setTestState] = useState<{ status: 'idle' | 'testing' | 'success' | 'error', message: string }>({
    status: 'idle',
    message: ''
  });
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setApiKey(getStoredApiKey());
      setTestState({ status: 'idle', message: '' });
      setFeedbackMessage(null);
      setIsSaving(false);
      setIsRemoving(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      handleRemove();
      return;
    }

    setIsSaving(true);
    try {
      await setStoredApiKey(trimmed, persistOnDisk);
      setFeedbackMessage({ type: 'success', text: 'API anahtarı başarıyla kaydedildi ve bu cihazda hatırlandı!' });
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (e: any) {
      setFeedbackMessage({ type: 'error', text: 'Kaydedilirken hata: ' + e.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    setIsRemoving(true);
    try {
      await removeStoredApiKey();
      setApiKey('');
      setTestState({ status: 'idle', message: '' });
      setFeedbackMessage({ type: 'success', text: 'Kayıtlı API anahtarı bu cihazdan ve hafızadan tamamen silindi.' });
      setTimeout(() => {
        setFeedbackMessage(null);
      }, 2500);
    } catch (e: any) {
      setFeedbackMessage({ type: 'error', text: 'Kaldırılırken hata: ' + e.message });
    } finally {
      setIsRemoving(false);
    }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden relative text-slate-200 flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Key size={20} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Gemini API Anahtarı & Bellek Ayarları</h2>
              <p className="text-[11px] text-slate-400">Yapay zeka analizleri için API anahtarınızı tanımlayın</p>
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
          <div className={`p-3.5 rounded-xl border text-xs flex items-start gap-3 ${
            hasStoredKey 
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : hasServerApiKey
              ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
          }`}>
            <ShieldCheck size={20} className="shrink-0 mt-0.5" />
            <div className="text-[11px] leading-relaxed">
              {hasStoredKey ? (
                <div>
                  <strong>Kişisel API Anahtarınız Kayıtlı ve Aktif.</strong>
                  <p className="text-emerald-300/80 mt-0.5">Programı tekrar açtığınızda otomatik olarak kullanılacaktır.</p>
                </div>
              ) : hasServerApiKey ? (
                <div>
                  <strong>Sunucu Anahtarı Hazır.</strong>
                  <p className="text-indigo-300/80 mt-0.5">Sistemde önceden tanımlanmış bir anahtar var. İsterseniz kendi anahtarınızı girerek değiştirebilirsiniz.</p>
                </div>
              ) : (
                <div>
                  <strong>API Anahtarı Tanımlanmamış.</strong>
                  <p className="text-amber-300/80 mt-0.5">Belgelerle sohbet, özetleme ve çeviri için lütfen bir Gemini API anahtarı girin.</p>
                </div>
              )}
            </div>
          </div>

          {/* API Key Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300">Google Gemini API Key</label>
              <a 
                href="https://aistudio.google.com/app/apikey" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 hover:underline"
              >
                Ücretsiz Anahtar Al (Google AI Studio) <ExternalLink size={11} />
              </a>
            </div>
            
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 pr-10 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/50 transition-colors font-mono tracking-wider"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                title={showKey ? 'Gizle' : 'Göster'}
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Remember / Cache Options */}
          <div className="bg-white/5 border border-white/5 rounded-xl p-3 flex items-center justify-between">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={persistOnDisk}
                onChange={(e) => setPersistOnDisk(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-black/40 text-indigo-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-xs text-slate-300 font-medium">
                Bu cihazda hatırla (Kalıcı olarak kaydet)
              </span>
            </label>
            <span className="text-[10px] text-slate-500">Program tekrar açıldığında hazır olur</span>
          </div>

          {/* Test Status Feedback */}
          {testState.status !== 'idle' && (
            <div className={`p-3 rounded-xl text-xs flex items-center gap-2.5 border ${
              testState.status === 'testing' 
                ? 'bg-slate-800 text-slate-300 border-white/10'
                : testState.status === 'success'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                : 'bg-red-500/10 text-red-300 border-red-500/20'
            }`}>
              {testState.status === 'testing' && <Loader2 size={15} className="animate-spin text-indigo-400 shrink-0" />}
              {testState.status === 'success' && <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />}
              {testState.status === 'error' && <AlertCircle size={15} className="text-red-400 shrink-0" />}
              <span className="text-[11px] leading-tight">{testState.message}</span>
            </div>
          )}

          {feedbackMessage && (
            <div className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
              feedbackMessage.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                : 'bg-red-500/10 text-red-300 border-red-500/20'
            }`}>
              {feedbackMessage.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
              <span className="text-[11px]">{feedbackMessage.text}</span>
            </div>
          )}

          {/* Privacy Note */}
          <p className="text-[10px] text-slate-500 leading-relaxed">
            🔒 <strong>Güvenlik:</strong> API anahtarınız yalnızca sizin bilgisayarınızda saklanır ve yalnızca doğrudan Gemini API isteklerinde kullanılır. Üçüncü taraflarla kesinlikle paylaşılmaz.
          </p>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-white/10 bg-slate-900/90 flex items-center justify-between gap-2">
          <div>
            {hasStoredKey && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={isRemoving}
                className="px-3 py-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition-colors flex items-center gap-1.5 font-medium disabled:opacity-50"
                title="Kayıtlı anahtarı bu cihazdan tamamen kaldır"
              >
                {isRemoving ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                <span>Anahtarı Kaldır (Sil)</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTestKey}
              disabled={testState.status === 'testing'}
              className="px-3.5 py-2 text-xs text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors disabled:opacity-50"
            >
              {testState.status === 'testing' ? 'Test Ediliyor...' : 'Test Et'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-500 hover:bg-indigo-600 rounded-xl transition-colors shadow-lg shadow-indigo-500/20 flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              <span>Kaydet & Hatırla</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
