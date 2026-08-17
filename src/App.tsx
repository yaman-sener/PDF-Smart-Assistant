import React, { useState } from 'react';
import { Upload, FileText, Loader2 } from 'lucide-react';
import { PDFViewer } from './components/PDFViewer';
import { ChatPanel } from './components/ChatPanel';
import { FloatingToolbar } from './components/FloatingToolbar';
import { DocumentDetails, HighlightRect } from './types';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [documentDetails, setDocumentDetails] = useState<DocumentDetails | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [actionState, setActionState] = useState<{ isRunning: boolean, result: string | null, error: string | null } | null>(null);
  const [highlights, setHighlights] = useState<HighlightRect[]>([]);
  const [fileHandle, setFileHandle] = useState<any>(null); // FileSystemFileHandle

  const [ocrLanguage, setOcrLanguage] = useState('tur');

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const processSelectedFile = async (selectedFile: File) => {
    const allowedTypes = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'text/plain',
      'text/markdown',
      'text/csv'
    ];
    
    if (!allowedTypes.includes(selectedFile.type)) {
      // Just warn them but we'll try anyway if they force it
      console.warn('Yüklenen dosya desteklenen standart formatlardan biri olmayabilir, ancak yine de işlemeye çalışacağız.');
    }

    setFile(selectedFile);
    setIsUploading(true);
    setDocumentDetails(null);
    setPageNumber(1);
    setHighlights([]);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Yükleme başarısız oldu');
      }
      const data = await res.json();
      setDocumentDetails(data);
    } catch (error: any) {
      console.error(error);
      alert('Dosya yüklenirken bir hata oluştu: ' + error.message);
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
          types: [{ description: 'Supported Files', accept: { 'application/pdf': ['.pdf'], 'image/*': ['.png', '.jpg', '.jpeg'], 'text/*': ['.txt', '.md', '.csv'] } }]
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
      const response = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, text, pageNumber })
      });

      if (!response.ok) throw new Error('Network response was not ok');
      if (!response.body) throw new Error('No readable stream');

      setActionState({ isRunning: false, result: '', error: null });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let fullResult = '';

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        const chunkValue = decoder.decode(value, { stream: true });
        fullResult += chunkValue;
        setActionState({ isRunning: false, result: fullResult, error: null });
      }
    } catch (error) {
      console.error('Action error:', error);
      setActionState({ isRunning: false, result: null, error: 'İşlem sırasında bir hata oluştu.' });
    }
  };

  return (
    <div className="h-screen w-full bg-slate-950 flex font-sans text-slate-200 overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-slate-950 to-emerald-950/40 pointer-events-none opacity-50 z-0"></div>

      {/* Left Sidebar (Minimal) */}
      <div className="w-16 bg-white/5 backdrop-blur-xl border-r border-white/10 flex flex-col items-center py-6 shrink-0 z-20">
        <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-8">
          <FileText size={24} className="text-white" />
        </div>
        
        <button onClick={handleFilePicker} disabled={isUploading} className="p-2 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-colors" title="Yeni Belge Yükle">
          {isUploading ? <Loader2 size={20} className="animate-spin text-indigo-400" /> : <Upload size={20} />}
        </button>
        <input type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.md,.csv,.doc,.docx" className="hidden" ref={fileInputRef} onChange={handleFileUpload} disabled={isUploading} />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col p-4 z-10 h-full overflow-hidden">
        <div className="flex-1 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 overflow-hidden flex relative shadow-inner">
          
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
          />
        </div>
      </div>
    </div>
  );
}
