import React, { useState, useEffect } from 'react';
import { Upload, FileText, Loader2, Key, ShieldCheck, AlertCircle } from 'lucide-react';
import { PDFViewer } from './components/PDFViewer';
import { ChatPanel } from './components/ChatPanel';
import { FloatingToolbar } from './components/FloatingToolbar';
import { ApiKeyModal } from './components/ApiKeyModal';
import { DocumentDetails, HighlightRect } from './types';
import { getStoredApiKey, getApiHeaders, syncApiKeyWithBackend } from './lib/apiKeyStorage';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [documentDetails, setDocumentDetails] = useState<DocumentDetails | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [actionState, setActionState] = useState<{ isRunning: boolean, result: string | null, error: string | null } | null>(null);
  const [highlights, setHighlights] = useState<HighlightRect[]>([]);
  const [fileHandle, setFileHandle] = useState<any>(null);

  const [ocrLanguage, setOcrLanguage] = useState('tur');
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [hasServerApiKey, setHasServerApiKey] = useState(false);
  const [hasUserApiKey, setHasUserApiKey] = useState(Boolean(getStoredApiKey()));

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Check server configuration, sync cached keys & listen to key changes
  useEffect(() => {
    syncApiKeyWithBackend()
      .then((activeKey) => {
        setHasUserApiKey(Boolean(activeKey));
      })
      .catch(() => {});

    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data && typeof data.hasServerApiKey === 'boolean') {
          setHasServerApiKey(data.hasServerApiKey);
        }
        if (data?.hasCachedDiskKey || data?.cachedKey) {
          setHasUserApiKey(true);
        }
      })
      .catch(() => {});

    const updateKeyState = () => {
      setHasUserApiKey(Boolean(getStoredApiKey()));
    };

    window.addEventListener('gemini_api_key_changed', updateKeyState);
    return () => window.removeEventListener('gemini_api_key_changed', updateKeyState);
  }, []);

  const isKeyConfigured = hasUserApiKey || hasServerApiKey;

  const processSelectedFile = async (selectedFile: File) => {
    setFile(selectedFile);
    setIsUploading(true);
    setDocumentDetails(null);
    setPageNumber(1);
    setHighlights([]);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const headers = getApiHeaders();
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401 || err.error === 'GEMINI_API_KEY_REQUIRED') {
          setIsApiKeyModalOpen(true);
          throw new Error('Yapay zeka analizini başlatmak için lütfen Gemini API anahtarınızı girin.');
        }
        throw new Error(err.error || err.message || 'Yükleme başarısız oldu');
      }

      const data = await res.json();
      setDocumentDetails(data);
    } catch (error: any) {
      console.error('File Upload Error:', error);
      alert(error.message || 'Dosya yüklenirken bir hata oluştu.');
      setFile(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFileHandle(null);
      await processSelectedFile(selectedFile);
    }
  };

  const handleFilePicker = async () => {
    try {
      if ('showOpenFilePicker' in window) {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{
            description: 'Supported Documents',
            accept: {
              'application/pdf': ['.pdf'],
              'application/msword': ['.doc'],
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
              'image/*': ['.png', '.jpg', '.jpeg'],
              'text/*': ['.txt', '.md', '.csv']
            }
          }]
        });
        const selectedFile = await handle.getFile();
        setFileHandle(handle);
        await processSelectedFile(selectedFile);
      } else {
        fileInputRef.current?.click();
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error(err);
    }
  };

  const handleTextAction = async (action: 'summarize' | 'translate' | 'rephrase', text: string, rects: HighlightRect[]) => {
    setActionState({ isRunning: true, result: null, error: null });
    setHighlights(rects);

    try {
      const headers = getApiHeaders({ 'Content-Type': 'application/json' });
      const response = await fetch('/api/action', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, text, pageNumber })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        if (response.status === 401 || errData.error === 'GEMINI_API_KEY_REQUIRED') {
          setIsApiKeyModalOpen(true);
          throw new Error('Bu özelliği kullanmak için Gemini API anahtarınızı girmeniz gerekmektedir.');
        }
        throw new Error(errData.error || errData.message || 'İşlem gerçekleştirilemedi');
      }

      if (!response.body) throw new Error('Sunucudan yanıt akışı alınamadı');

      setActionState({ isRunning: false, result: '', error: null });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let fullResult = '';

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunkValue = decoder.decode(value, { stream: true });
          fullResult += chunkValue;
          setActionState({ isRunning: false, result: fullResult, error: null });
        }
      }
    } catch (error: any) {
      console.error('Action error:', error);
      setActionState({ isRunning: false, result: null, error: error.message || 'İşlem sırasında bir hata oluştu.' });
    }
  };

  return (
    <div className="h-screen w-full bg-slate-950 flex font-sans text-slate-200 overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-slate-950 to-emerald-950/40 pointer-events-none opacity-50 z-0"></div>

      {/* Left Sidebar (Minimal & Functional) */}
      <div className="w-16 bg-white/5 backdrop-blur-xl border-r border-white/10 flex flex-col items-center py-6 shrink-0 z-20">
        <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-8">
          <FileText size={22} className="text-white" />
        </div>
        
        <div className="flex flex-col gap-4 items-center">
          <button 
            onClick={handleFilePicker} 
            disabled={isUploading} 
            className="p-2.5 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-colors" 
            title="Yeni Belge Yükle"
          >
            {isUploading ? <Loader2 size={20} className="animate-spin text-indigo-400" /> : <Upload size={20} />}
          </button>
          <input 
            type="file" 
            accept=".pdf,.png,.jpg,.jpeg,.txt,.md,.csv,.doc,.docx" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            disabled={isUploading} 
          />

          <button
            onClick={() => setIsApiKeyModalOpen(true)}
            className="p-2.5 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-colors relative"
            title="Gemini API Anahtarı Ayarları"
          >
            <Key size={20} className={isKeyConfigured ? 'text-emerald-400' : 'text-amber-400'} />
            <span 
              className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ring-2 ring-slate-950 ${
                isKeyConfigured ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
              }`}
            />
          </button>
        </div>

        {/* Bottom Status */}
        <div className="mt-auto">
          <button 
            onClick={() => setIsApiKeyModalOpen(true)}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-300 transition-colors"
            title={isKeyConfigured ? 'Gemini API Bağlantısı Hazır' : 'API Anahtarı Eksik'}
          >
            {isKeyConfigured ? <ShieldCheck size={18} className="text-emerald-400/80" /> : <AlertCircle size={18} className="text-amber-400/80" />}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col p-4 z-10 h-full overflow-hidden">
        <div className="flex-1 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden flex relative shadow-inner">
          
          {/* PDF Viewer Section */}
          <div className="flex-1 flex flex-col relative bg-slate-900/40">
            <PDFViewer 
              file={file} 
              setFile={setFile}
              fileHandle={fileHandle}
              setFileHandle={setFileHandle}
              pageNumber={pageNumber} 
              setPageNumber={setPageNumber}
              highlights={highlights}
              ocrLanguage={ocrLanguage}
              documentDetails={documentDetails}
            />
            <FloatingToolbar onAction={handleTextAction} />
          </div>

          {/* Chat Panel Section */}
          <ChatPanel 
            document={documentDetails} 
            onPageClick={setPageNumber} 
            actionState={actionState}
            onCloseAction={() => { setActionState(null); setHighlights([]); }}
            isUploading={isUploading}
            ocrLanguage={ocrLanguage}
            setOcrLanguage={setOcrLanguage}
            onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
            isKeyConfigured={isKeyConfigured}
          />
        </div>
      </div>

      {/* API Key Modal */}
      <ApiKeyModal 
        isOpen={isApiKeyModalOpen} 
        onClose={() => setIsApiKeyModalOpen(false)} 
        hasServerApiKey={hasServerApiKey}
      />
    </div>
  );
}
