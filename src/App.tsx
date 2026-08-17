import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, FileText, Loader2, Key, ShieldCheck, AlertCircle, Sparkles, BookOpen } from 'lucide-react';
import { PDFViewer } from './components/PDFViewer';
import { ChatPanel } from './components/ChatPanel';
import { FloatingToolbar } from './components/FloatingToolbar';
import { ApiKeyModal } from './components/ApiKeyModal';
import { DocumentDetails, HighlightRect } from './types';
import { getStoredApiKey, getApiHeaders, syncApiKeyWithBackend, isValidApiKey } from './lib/apiKeyStorage';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [documentDetails, setDocumentDetails] = useState<DocumentDetails | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isAiSyncing, setIsAiSyncing] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [actionState, setActionState] = useState<{ isRunning: boolean, result: string | null, error: string | null } | null>(null);
  const [highlights, setHighlights] = useState<HighlightRect[]>([]);
  const [fileHandle, setFileHandle] = useState<any>(null);

  const [ocrLanguage, setOcrLanguage] = useState('tur');
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [hasServerApiKey, setHasServerApiKey] = useState(false);
  const [hasUserApiKey, setHasUserApiKey] = useState(Boolean(getStoredApiKey()));
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const currentFileRef = useRef<File | null>(null);

  // Keep currentFileRef updated
  useEffect(() => {
    currentFileRef.current = file;
  }, [file]);

  // Check server configuration, sync cached keys & listen to key changes
  useEffect(() => {
    syncApiKeyWithBackend()
      .then((activeKey) => {
        setHasUserApiKey(isValidApiKey(activeKey));
      })
      .catch(() => {});

    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        setHasServerApiKey(Boolean(data?.hasServerApiKey));
        if (data?.hasCachedDiskKey || (data?.cachedKey && isValidApiKey(data.cachedKey))) {
          setHasUserApiKey(true);
        }
      })
      .catch(() => {});

    const updateKeyState = () => {
      const valid = isValidApiKey(getStoredApiKey());
      setHasUserApiKey(valid);
      // If a document is currently loaded but not synced with AI, try syncing now
      if (valid && currentFileRef.current && (!documentDetails || !documentDetails.uri)) {
        syncFileWithGemini(currentFileRef.current);
      }
    };

    window.addEventListener('gemini_api_key_changed', updateKeyState);
    return () => window.removeEventListener('gemini_api_key_changed', updateKeyState);
  }, [documentDetails]);

  const isKeyConfigured = hasUserApiKey || hasServerApiKey;

  // Sync document with Gemini File API in background for AI Chat & Actions
  const syncFileWithGemini = async (selectedFile: File) => {
    setIsAiSyncing(true);
    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const headers = getApiHeaders();
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers,
        body: formData,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401 || data.error === 'GEMINI_API_KEY_REQUIRED' || data.error === 'GEMINI_API_KEY_INVALID') {
          setIsApiKeyModalOpen(true);
        }
        console.warn('Gemini AI Sync Notice:', data.message || data.error || 'AI senkronizasyonu tamamlanamadı.');
        return;
      }

      setDocumentDetails(prev => ({
        ...prev,
        ...data,
        displayName: data.displayName || selectedFile.name
      }));
    } catch (err) {
      console.warn('AI Sync Background Error:', err);
    } finally {
      setIsAiSyncing(false);
    }
  };

  const processSelectedFile = async (selectedFile: File) => {
    // 1. Immediately set file so viewer renders it without blocking!
    setFile(selectedFile);
    setIsUploading(true);
    setDocumentDetails(null);
    setPageNumber(1);
    setHighlights([]);

    const lowerName = selectedFile.name.toLowerCase();
    const isEpubOrWord = lowerName.endsWith('.epub') || lowerName.endsWith('.docx') || lowerName.endsWith('.doc');

    // 2. If EPUB or Word, parse content locally via /api/parse-document so user can read immediately
    if (isEpubOrWord) {
      try {
        const parseFormData = new FormData();
        parseFormData.append('file', selectedFile);
        const parseRes = await fetch('/api/parse-document', {
          method: 'POST',
          body: parseFormData
        });
        if (parseRes.ok) {
          const parsedData = await parseRes.json();
          setDocumentDetails({
            name: selectedFile.name,
            displayName: selectedFile.name,
            mimeType: parsedData.mimeType,
            extractedText: parsedData.extractedText,
            extractedHtml: parsedData.extractedHtml
          });
        }
      } catch (parseErr) {
        console.error('Local Document Parsing error:', parseErr);
      }
    }

    setIsUploading(false);

    // 3. Connect & sync with Gemini for AI features
    await syncFileWithGemini(selectedFile);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFileHandle(null);
      await processSelectedFile(selectedFile);
    }
    if (e.target) e.target.value = '';
  };

  const handleFilePicker = async () => {
    try {
      if ('showOpenFilePicker' in window) {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{
            description: 'Tüm Desteklenen Belgeler (PDF, EPUB, Word, Metin)',
            accept: {
              'application/pdf': ['.pdf'],
              'application/epub+zip': ['.epub'],
              'application/msword': ['.doc'],
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
              'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
              'text/*': ['.txt', '.md', '.csv', '.html', '.htm', '.rtf']
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
      if (err.name !== 'AbortError') {
        fileInputRef.current?.click();
      }
    }
  };

  // Drag & Drop event handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingFile(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDraggingFile(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    dragCounter.current = 0;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const droppedFile = files[0];
      setFileHandle(null);
      await processSelectedFile(droppedFile);
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
        if (response.status === 401 || errData.error === 'GEMINI_API_KEY_REQUIRED' || errData.error === 'GEMINI_API_KEY_INVALID') {
          setIsApiKeyModalOpen(true);
          throw new Error('Bu özelliği kullanmak için lütfen geçerli bir Gemini API anahtarı girin.');
        }
        throw new Error(errData.message || errData.error || 'İşlem gerçekleştirilemedi');
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
    <div 
      className="h-screen w-full bg-slate-950 flex font-sans text-slate-200 overflow-hidden relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-slate-950 to-emerald-950/40 pointer-events-none opacity-50 z-0"></div>

      {/* Global Drag & Drop Overlay */}
      {isDraggingFile && (
        <div className="fixed inset-0 z-50 bg-indigo-950/85 backdrop-blur-md border-4 border-dashed border-indigo-400 flex flex-col items-center justify-center p-8 pointer-events-none animate-in fade-in zoom-in-95 duration-150">
          <div className="w-24 h-24 rounded-3xl bg-indigo-500/20 border-2 border-indigo-400/50 flex items-center justify-center text-indigo-300 mb-6 shadow-2xl animate-bounce">
            <Upload size={48} />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Belgenizi Buraya Bırakın</h2>
          <p className="text-sm text-indigo-200">PDF, EPUB, Word (.docx, .doc), Markdown, CSV ve Görseller desteklenir</p>
        </div>
      )}

      {/* Left Sidebar (Minimal & Functional) */}
      <div className="w-16 bg-white/5 backdrop-blur-xl border-r border-white/10 flex flex-col items-center py-6 shrink-0 z-20">
        <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-8" title="PDF Smart Assistant">
          <FileText size={22} className="text-white" />
        </div>
        
        <div className="flex flex-col gap-4 items-center">
          <button 
            onClick={handleFilePicker} 
            disabled={isUploading} 
            className="p-2.5 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-colors" 
            title="Yeni Belge Yükle (PDF, EPUB, Word, vb.)"
          >
            {isUploading ? <Loader2 size={20} className="animate-spin text-indigo-400" /> : <Upload size={20} />}
          </button>
          <input 
            type="file" 
            accept=".pdf,.epub,.doc,.docx,.png,.jpg,.jpeg,.webp,.txt,.md,.csv,.html,.htm,.rtf" 
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
              className={`absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-slate-950 ${
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
            title={isKeyConfigured ? 'Gemini API Bağlantısı Hazır' : 'API Anahtarı Eksik veya Geçersiz'}
          >
            {isKeyConfigured ? <ShieldCheck size={18} className="text-emerald-400/80" /> : <AlertCircle size={18} className="text-amber-400/80" />}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col p-4 z-10 h-full overflow-hidden">
        <div className="flex-1 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden flex relative shadow-inner">
          
          {/* PDF & Document Viewer Section */}
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
              onSelectFile={handleFilePicker}
              isUploading={isUploading}
            />
            <FloatingToolbar onAction={handleTextAction} />
          </div>

          {/* Chat Panel Section */}
          <ChatPanel 
            document={documentDetails} 
            onPageClick={setPageNumber} 
            actionState={actionState}
            onCloseAction={() => { setActionState(null); setHighlights([]); }}
            isUploading={isUploading || isAiSyncing}
            ocrLanguage={ocrLanguage}
            setOcrLanguage={setOcrLanguage}
            onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
            isKeyConfigured={isKeyConfigured}
            hasDocument={Boolean(file)}
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
