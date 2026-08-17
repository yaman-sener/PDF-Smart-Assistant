import React, { useState, useEffect } from 'react';
import { 
  Lock, 
  ShieldCheck, 
  Key, 
  Check, 
  X, 
  Loader2, 
  AlertCircle, 
  Eye, 
  EyeOff, 
  ArrowUp, 
  ArrowDown, 
  Sparkles, 
  Server, 
  RefreshCw, 
  LogOut, 
  Save, 
  Sliders,
  Cpu
} from 'lucide-react';
import { ProviderConfig, ProviderType } from '../types/admin';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    enabled: true,
    apiKey: '',
    model: 'gemini-2.5-flash',
    priority: 1,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek AI',
    enabled: false,
    apiKey: '',
    model: 'deepseek-chat',
    priority: 2,
    baseUrl: 'https://api.deepseek.com/v1',
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot AI)',
    enabled: false,
    apiKey: '',
    model: 'moonshot-v1-8k',
    priority: 3,
    baseUrl: 'https://api.moonshot.cn/v1',
  }
];

export function AdminModal({ isOpen, onClose }: AdminModalProps) {
  const [isSetup, setIsSetup] = useState<boolean>(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [adminToken, setAdminToken] = useState<string>(() => sessionStorage.getItem('admin_token') || '');
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);

  const [providers, setProviders] = useState<ProviderConfig[]>(DEFAULT_PROVIDERS);
  const [showKeys, setShowKeys] = useState<{ [key: string]: boolean }>({});
  const [testResults, setTestResults] = useState<{ [key: string]: { status: 'loading' | 'success' | 'error', message: string, latency?: number } }>({});
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Check admin setup & auth status
  useEffect(() => {
    if (!isOpen) return;

    setIsCheckingStatus(true);
    fetch('/api/admin/status', {
      headers: adminToken ? { 'x-admin-token': adminToken } : {}
    })
      .then(res => res.json())
      .then(data => {
        setIsSetup(Boolean(data.isSetup));
        if (data.isAuthenticated) {
          setIsAuthenticated(true);
          loadProviders(adminToken);
        } else {
          setIsAuthenticated(false);
        }
      })
      .catch(err => console.error('Admin status error:', err))
      .finally(() => setIsCheckingStatus(false));
  }, [isOpen, adminToken]);

  const loadProviders = (token: string) => {
    fetch('/api/admin/providers', {
      headers: { 'x-admin-token': token }
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data.providers)) {
          setProviders(data.providers.sort((a: ProviderConfig, b: ProviderConfig) => a.priority - b.priority));
        }
      })
      .catch(err => console.error('Failed to load providers:', err));
  };

  const handleSetupOrLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    if (!isSetup && password !== confirmPassword) {
      setLoginError('Şifreler eşleşmiyor!');
      return;
    }

    if (password.length < 4) {
      setLoginError('Şifre en az 4 karakter olmalıdır.');
      return;
    }

    const endpoint = isSetup ? '/api/admin/login' : '/api/admin/setup';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Giriş yapılamadı.');
      }

      setAdminToken(data.token);
      sessionStorage.setItem('admin_token', data.token);
      setIsAuthenticated(true);
      setIsSetup(true);
      setPassword('');
      setConfirmPassword('');
      loadProviders(data.token);
    } catch (err: any) {
      setLoginError(err.message || 'Bir hata oluştu.');
    }
  };

  const handleLogout = () => {
    setAdminToken('');
    sessionStorage.removeItem('admin_token');
    setIsAuthenticated(false);
    setPassword('');
  };

  const toggleShowKey = (id: string) => {
    setShowKeys(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const updateProviderField = (id: ProviderType, field: keyof ProviderConfig, value: any) => {
    setProviders(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const movePriority = (index: number, direction: 'up' | 'down') => {
    const newIdx = direction === 'up' ? index - 1 : index + 1;
    if (newIdx < 0 || newIdx >= providers.length) return;

    const list = [...providers];
    const temp = list[index];
    list[index] = list[newIdx];
    list[newIdx] = temp;

    const updated = list.map((p, idx) => ({ ...p, priority: idx + 1 }));
    setProviders(updated);
  };

  const testProvider = async (provider: ProviderConfig) => {
    setTestResults(prev => ({ ...prev, [provider.id]: { status: 'loading', message: 'Test ediliyor...' } }));
    const startTime = Date.now();

    try {
      const res = await fetch('/api/admin/test-provider', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken
        },
        body: JSON.stringify({
          providerId: provider.id,
          apiKey: provider.apiKey,
          model: provider.model,
          baseUrl: provider.baseUrl
        })
      });

      const latency = Date.now() - startTime;
      const data = await res.json();

      if (res.ok && data.success) {
        setTestResults(prev => ({
          ...prev,
          [provider.id]: { status: 'success', message: `Bağlantı Başarılı (${latency}ms)`, latency }
        }));
      } else {
        setTestResults(prev => ({
          ...prev,
          [provider.id]: { status: 'error', message: data.error || 'Bağlantı kurulamadı' }
        }));
      }
    } catch (err: any) {
      setTestResults(prev => ({
        ...prev,
        [provider.id]: { status: 'error', message: err.message || 'Ağ hatası' }
      }));
    }
  };

  const handleSaveProviders = async () => {
    setIsSaving(true);
    setSaveStatus(null);

    try {
      const res = await fetch('/api/admin/providers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken
        },
        body: JSON.stringify({ providers })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Kaydedilemedi');

      setSaveStatus('Tüm yapay zeka modelleri ve öncelik ayarları başarıyla kaydedildi!');
      setTimeout(() => setSaveStatus(null), 3500);
      
      // Dispatch event to notify other components
      window.dispatchEvent(new CustomEvent('gemini_api_key_changed'));
    } catch (err: any) {
      setSaveStatus('Hata: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-indigo-500/30 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                YÖNETİCİ PANELİ
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Model & API Havuzu
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">Çoklu Yapay Zeka Sağlayıcıları ve Otomatik Token Yedekleme</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isAuthenticated && (
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-300 hover:bg-red-500/10 transition-colors text-xs flex items-center gap-1"
                title="Oturumu Kapat"
              >
                <LogOut size={15} />
                <span className="text-[11px] hidden sm:inline">Çıkış</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
          {isCheckingStatus ? (
            <div className="py-16 flex flex-col items-center justify-center text-slate-400">
              <Loader2 className="animate-spin text-indigo-400 mb-3" size={32} />
              <p className="text-xs">Güvenlik durumu kontrol ediliyor...</p>
            </div>
          ) : !isAuthenticated ? (
            
            // ==========================================
            // AUTHENTICATION / SETUP SCREEN
            // ==========================================
            <form onSubmit={handleSetupOrLogin} className="max-w-md mx-auto py-8 space-y-6">
              <div className="text-center space-y-2">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-xl">
                  <Lock size={28} />
                </div>
                <h4 className="text-lg font-bold text-white">
                  {isSetup ? 'Yönetici Girişi' : 'Yönetici Şifresi Belirleyin'}
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {isSetup 
                    ? 'API anahtarlarını ve model havuzunu yönetmek için ana şifrenizi girin.'
                    : 'Yönetici paneline yalnızca sizin erişebilmeniz için ilk açılışta güvenli bir şifre tanımlayın.'}
                </p>
              </div>

              {loginError && (
                <div className="bg-red-500/15 border border-red-500/30 rounded-xl p-3 text-xs text-red-200 flex items-center gap-2">
                  <AlertCircle size={15} className="shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1.5">
                    {isSetup ? 'Yönetici Şifresi' : 'Yeni Yönetici Şifresi'}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full bg-black/40 border border-white/10 focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none transition-colors"
                  />
                </div>

                {!isSetup && (
                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1.5">
                      Şifreyi Tekrar Girin
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="w-full bg-black/40 border border-white/10 focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none transition-colors"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 transition-all transform active:scale-98"
                >
                  <ShieldCheck size={16} />
                  <span>{isSetup ? 'Giriş Yap' : 'Şifreyi Kaydet ve Devam Et'}</span>
                </button>
              </div>
            </form>
          ) : (

            // ==========================================
            // PROVIDER & FAILOVER MANAGEMENT DASHBOARD
            // ==========================================
            <div className="space-y-6">
              
              {/* Failover Info Banner */}
              <div className="bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-emerald-500/10 border border-white/10 rounded-2xl p-4 flex items-start gap-3 shadow-inner">
                <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-300 shrink-0 mt-0.5">
                  <Sparkles size={18} />
                </div>
                <div className="space-y-1 text-xs">
                  <h4 className="font-semibold text-slate-200 flex items-center gap-2">
                    Akıllı Otomatik Model Yedekleme (Auto-Failover)
                  </h4>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Sistem ilk olarak 1. sıradaki modeli kullanır. İstek limiti (429), token tükenmesi veya kota hatası yaşanırsa, 
                    <strong>kullanıcıya hata hissettirmeden</strong> otomatik olarak sıradaki aktif modele (DeepSeek / Kimi) geçiş yapar.
                  </p>
                </div>
              </div>

              {saveStatus && (
                <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                  saveStatus.startsWith('Hata') 
                    ? 'bg-red-500/15 border border-red-500/30 text-red-200' 
                    : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-200'
                }`}>
                  <Check size={15} />
                  <span>{saveStatus}</span>
                </div>
              )}

              {/* Provider Cards */}
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs font-bold text-slate-300 uppercase tracking-wider px-1">
                  <span>Modeller & Öncelik Sıralaması</span>
                  <span className="text-[10px] font-normal text-slate-400 lowercase">Yukarı/Aşağı butonlarıyla sırayı belirleyin</span>
                </div>

                {providers.map((p, idx) => {
                  const test = testResults[p.id];
                  const isFirst = idx === 0;
                  const isLast = idx === providers.length - 1;

                  return (
                    <div 
                      key={p.id}
                      className={`p-4 rounded-2xl border transition-all duration-200 ${
                        p.enabled 
                          ? 'bg-white/[0.03] border-white/10 hover:border-indigo-500/40 shadow-lg' 
                          : 'bg-black/30 border-white/5 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3.5">
                        <div className="flex items-center gap-3">
                          {/* Priority Order Pill */}
                          <span className={`w-6 h-6 rounded-lg text-xs font-bold flex items-center justify-center ${
                            p.enabled ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-500'
                          }`}>
                            {idx + 1}
                          </span>

                          <div>
                            <h4 className="text-xs font-bold text-white flex items-center gap-2">
                              {p.name}
                              {p.enabled && idx === 0 && (
                                <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                  Ana Model
                                </span>
                              )}
                              {p.enabled && idx > 0 && (
                                <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  Yedek Model {idx}
                                </span>
                              )}
                            </h4>
                          </div>
                        </div>

                        {/* Priority Reordering & Enable Switch */}
                        <div className="flex items-center gap-2">
                          <div className="flex items-center bg-white/5 rounded-lg p-0.5 border border-white/10">
                            <button
                              type="button"
                              onClick={() => movePriority(idx, 'up')}
                              disabled={isFirst}
                              className="p-1 text-slate-400 hover:text-white disabled:opacity-20 hover:bg-white/10 rounded transition-colors"
                              title="Önceliği Yükselt"
                            >
                              <ArrowUp size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => movePriority(idx, 'down')}
                              disabled={isLast}
                              className="p-1 text-slate-400 hover:text-white disabled:opacity-20 hover:bg-white/10 rounded transition-colors"
                              title="Önceliği Düşür"
                            >
                              <ArrowDown size={13} />
                            </button>
                          </div>

                          <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={p.enabled} 
                              onChange={(e) => updateProviderField(p.id, 'enabled', e.target.checked)}
                              className="sr-only peer" 
                            />
                            <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                          </label>
                        </div>
                      </div>

                      {/* Inputs */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {/* API Key */}
                        <div className="md:col-span-2 relative">
                          <label className="text-[10px] font-semibold text-slate-400 block mb-1">
                            API Anahtarı {p.id === 'gemini' ? '(Google AI Studio)' : (p.id === 'deepseek' ? '(platform.deepseek.com)' : '(platform.moonshot.cn)')}
                          </label>
                          <div className="relative">
                            <input
                              type={showKeys[p.id] ? 'text' : 'password'}
                              value={p.apiKey}
                              onChange={(e) => updateProviderField(p.id, 'apiKey', e.target.value)}
                              placeholder={`${p.name} API Key...`}
                              className="w-full bg-black/50 border border-white/10 focus:border-indigo-500/50 rounded-xl px-3 py-2 pr-9 text-xs text-slate-200 outline-none placeholder:text-slate-600 font-mono"
                            />
                            <button
                              type="button"
                              onClick={() => toggleShowKey(p.id)}
                              className="absolute right-2.5 top-2.5 text-slate-500 hover:text-slate-300"
                            >
                              {showKeys[p.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          </div>
                        </div>

                        {/* Model Dropdown */}
                        <div>
                          <label className="text-[10px] font-semibold text-slate-400 block mb-1">Model</label>
                          <select
                            value={p.model}
                            onChange={(e) => updateProviderField(p.id, 'model', e.target.value)}
                            className="w-full bg-black/50 border border-white/10 focus:border-indigo-500/50 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none"
                          >
                            {p.id === 'gemini' && (
                              <>
                                <option value="gemini-2.5-flash">Gemini 2.5 Flash (Hızlı)</option>
                                <option value="gemini-1.5-pro">Gemini 1.5 Pro (Gelişmiş)</option>
                              </>
                            )}
                            {p.id === 'deepseek' && (
                              <>
                                <option value="deepseek-chat">deepseek-chat (V3)</option>
                                <option value="deepseek-reasoner">deepseek-reasoner (R1 Mantık)</option>
                              </>
                            )}
                            {p.id === 'kimi' && (
                              <>
                                <option value="moonshot-v1-8k">moonshot-v1-8k</option>
                                <option value="moonshot-v1-32k">moonshot-v1-32k (Geniş Bağlam)</option>
                                <option value="moonshot-v1-128k">moonshot-v1-128k (Dev Bağlam)</option>
                              </>
                            )}
                          </select>
                        </div>
                      </div>

                      {/* Test Connection Button & Status */}
                      <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => testProvider(p)}
                          disabled={!p.apiKey || test?.status === 'loading'}
                          className="px-3 py-1 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg text-[10px] font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40"
                        >
                          {test?.status === 'loading' ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                          <span>Bağlantıyı Test Et</span>
                        </button>

                        {test && (
                          <div className={`text-[10px] font-medium flex items-center gap-1 ${
                            test.status === 'success' 
                              ? 'text-emerald-400' 
                              : (test.status === 'error' ? 'text-red-400' : 'text-slate-400')
                          }`}>
                            {test.status === 'success' && <Check size={12} />}
                            {test.status === 'error' && <AlertCircle size={12} />}
                            <span>{test.message}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {isAuthenticated && (
          <div className="p-4 border-t border-white/10 bg-white/[0.02] flex items-center justify-between">
            <span className="text-[11px] text-slate-500">
              Değişiklikler anında havuz önceliğine uygulanır.
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                Kapat
              </button>
              <button
                type="button"
                onClick={handleSaveProviders}
                disabled={isSaving}
                className="px-6 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-500/25 flex items-center gap-2 transition-all transform active:scale-95 disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                <span>Ayarları Kaydet</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
