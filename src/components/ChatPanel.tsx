import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Bot, X, Sparkles, Download, Key, ShieldCheck, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Message, DocumentDetails } from '../types';
import { jsPDF } from 'jspdf';
import { getApiHeaders } from '../lib/apiKeyStorage';

interface ChatPanelProps {
  document: DocumentDetails | null;
  onPageClick: (page: number) => void;
  actionState: { isRunning: boolean, result: string | null, error: string | null } | null;
  onCloseAction: () => void;
  isUploading: boolean;
  ocrLanguage: string;
  setOcrLanguage: (lang: string) => void;
  onOpenApiKeyModal?: () => void;
  isKeyConfigured?: boolean;
}

export function ChatPanel({
  document,
  onPageClick,
  actionState,
  onCloseAction,
  isUploading,
  ocrLanguage,
  setOcrLanguage,
  onOpenApiKeyModal,
  isKeyConfigured = true
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'model', text: 'Merhaba! Ben PDF Asistanınız. Bana belgeyle ilgili sorular sorabilirsiniz.' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([
      { id: '1', role: 'model', text: 'Merhaba! Ben PDF Asistanınız. Bana belgeyle ilgili sorular sorabilirsiniz.' }
    ]);
  }, [document?.name]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, actionState]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !document || isLoading) return;

    const userMessage: Message = { id: Date.now().toString(), role: 'user', text: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Create a temporary model message to stream into
    const modelMessageId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: modelMessageId, role: 'model', text: '' }]);

    try {
      const headers = getApiHeaders({ 'Content-Type': 'application/json' });
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          documentUri: document.uri,
          mimeType: document.mimeType,
          messages: messages.concat(userMessage).map(m => ({ role: m.role, text: m.text }))
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 401 || errorData.error === 'GEMINI_API_KEY_REQUIRED') {
          if (onOpenApiKeyModal) onOpenApiKeyModal();
          throw new Error('Gemini API anahtarı gereklidir. Lütfen API anahtarınızı girin.');
        }
        throw new Error(errorData.error || errorData.message || `Sunucu hatası: ${response.status}`);
      }

      if (!response.body) throw new Error('Yanıt akışı bulunamadı.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunkValue = decoder.decode(value, { stream: true });
          setMessages(prev => prev.map(msg => 
            msg.id === modelMessageId ? { ...msg, text: msg.text + chunkValue } : msg
          ));
        }
      }
    } catch (error: any) {
      console.error('Chat error:', error);
      setMessages(prev => prev.map(msg => 
        msg.id === modelMessageId ? { ...msg, text: `⚠️ Hata: ${error.message}` } : msg
      ));
    } finally {
      setIsLoading(false);
    }
  };

  // Render text with clickable page links e.g. [Sayfa 5]
  const renderMessageText = (text: string) => {
    const markdownWithLinks = text.replace(/\[Sayfa (\d+)\]/g, '[Sayfa $1](#page-$1)');

    return (
      <ReactMarkdown 
        components={{
          a: ({ node, ...props }) => {
            if (props.href?.startsWith('#page-')) {
              const pageNum = parseInt(props.href.replace('#page-', ''), 10);
              return (
                <button 
                  onClick={(e) => { e.preventDefault(); onPageClick(pageNum); }}
                  className="inline-flex items-center mx-1 px-1.5 py-0.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-[10px] font-semibold hover:bg-indigo-500/20 transition-colors"
                >
                  Sayfa {pageNum}
                </button>
              );
            }
            return <a {...props} className="text-indigo-400 hover:underline" target="_blank" rel="noopener noreferrer" />;
          }
        }}
      >
        {markdownWithLinks}
      </ReactMarkdown>
    );
  };

  const exportAsMarkdown = async () => {
    if (!actionState?.result) return;
    
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: 'ai_export.md',
          types: [{
            description: 'Markdown File',
            accept: { 'text/markdown': ['.md'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(actionState.result);
        await writable.close();
        return;
      } catch (e) {
        if ((e as Error).name !== 'AbortError') console.error(e);
        return;
      }
    }

    const blob = new Blob([actionState.result], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = 'ai_export.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAsPDF = async () => {
    if (!actionState?.result) return;
    const doc = new jsPDF();
    
    doc.setFont("helvetica");
    doc.setFontSize(12);
    
    const splitText = doc.splitTextToSize(actionState.result, 180);
    doc.text(splitText, 15, 20);

    if ('showSaveFilePicker' in window) {
      try {
        const blob = doc.output('blob');
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: 'ai_export.pdf',
          types: [{
            description: 'PDF File',
            accept: { 'application/pdf': ['.pdf'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (e) {
        if ((e as Error).name !== 'AbortError') console.error(e);
        return;
      }
    }
    
    doc.save("ai_export.pdf");
  };

  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  return (
    <div className="w-80 border-l border-white/10 flex flex-col bg-slate-900/60 backdrop-blur-2xl relative z-10 shrink-0">
      <div className="p-4 border-b border-white/10 flex flex-col gap-3 shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold tracking-widest text-indigo-400 flex items-center gap-2">
            <Bot size={16} />
            AI ASİSTAN
          </h2>
          <button
            onClick={onOpenApiKeyModal}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1.5 border transition-all ${
              isKeyConfigured
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                : 'bg-amber-500/15 border-amber-500/30 text-amber-300 hover:bg-amber-500/25 animate-pulse'
            }`}
            title="Gemini API Anahtarı Ayarları"
          >
            <Key size={12} className={isKeyConfigured ? 'text-emerald-400' : 'text-amber-400'} />
            <span>{isKeyConfigured ? 'API AKTİF' : 'API KEY GEREKLİ'}</span>
          </button>
        </div>
        
        <div className="flex items-center justify-between bg-black/20 p-2 rounded-lg border border-white/5">
          <span className="text-[10px] text-slate-400 font-medium">OCR Dili:</span>
          <select 
            value={ocrLanguage}
            onChange={(e) => setOcrLanguage(e.target.value)}
            className="bg-slate-800 text-slate-200 text-[10px] rounded border border-white/10 px-2 py-1 focus:outline-none focus:border-indigo-500"
          >
            <option value="tur">Türkçe</option>
            <option value="eng">English</option>
            <option value="tur+eng">Türkçe + English</option>
            <option value="deu">Deutsch</option>
            <option value="fra">Français</option>
            <option value="spa">Español</option>
            <option value="ita">Italiano</option>
            <option value="rus">Русский</option>
            <option value="ara">Arabic</option>
            <option value="chi_sim">简体中文</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {!isKeyConfigured && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-200 space-y-2">
            <div className="flex items-center gap-1.5 font-semibold text-amber-300">
              <AlertCircle size={14} /> Gemini API Anahtarı Gerekli
            </div>
            <p className="text-[11px] text-amber-300/80 leading-tight">
              Belgeyle sohbet etmek, özetleme ve çeviri yapmak için API anahtarınızı tanımlayın.
            </p>
            <button
              onClick={onOpenApiKeyModal}
              className="w-full py-1.5 px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg text-[10px] transition-colors"
            >
              API Anahtarı Ekle
            </button>
          </div>
        )}

        {isUploading && (
          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3 flex flex-col items-center justify-center text-center shadow-inner">
            <Loader2 size={24} className="animate-spin text-indigo-400 mb-2" />
            <p className="text-xs font-medium text-slate-200">Yapay Zeka Hazırlanıyor</p>
            <p className="text-[10px] text-slate-400 mt-1">Belge okunuyor, arka planda chat için hazırlanıyor...</p>
          </div>
        )}

        {/* Quick Action Overlay (Translating, Summarizing etc.) */}
        {actionState && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 animate-in fade-in relative shadow-lg">
            <div className="absolute top-2 right-2 flex items-center gap-1">
              <div className="relative">
                <button 
                  onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                  className="p-1 text-slate-400 hover:text-slate-200 rounded-md hover:bg-white/5 transition-colors flex items-center gap-1 text-[10px] font-medium px-2"
                >
                  <Download size={12} /> Dışa Aktar
                </button>
                {isExportMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-32 bg-slate-800 border border-white/10 rounded-lg shadow-xl z-20 py-1 overflow-hidden">
                    <button 
                      onClick={() => { setIsExportMenuOpen(false); exportAsMarkdown(); }} 
                      className="w-full text-left px-3 py-1.5 text-[10px] text-slate-300 hover:bg-white/10 hover:text-white transition-colors flex items-center gap-2"
                    >
                      <Download size={10} /> Markdown
                    </button>
                    <button 
                      onClick={() => { setIsExportMenuOpen(false); exportAsPDF(); }} 
                      className="w-full text-left px-3 py-1.5 text-[10px] text-slate-300 hover:bg-white/10 hover:text-white transition-colors flex items-center gap-2"
                    >
                      <Download size={10} /> PDF
                    </button>
                  </div>
                )}
              </div>
              <button onClick={onCloseAction} className="p-1 text-slate-400 hover:text-slate-200 rounded-md hover:bg-white/5 transition-colors">
                <X size={14} />
              </button>
            </div>
            <h3 className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2 flex items-center gap-1.5 mt-1">
              <Sparkles size={14} /> Hızlı İşlem
            </h3>
            {actionState.isRunning ? (
              <div className="flex items-center text-xs text-slate-400 py-2">
                <Loader2 size={14} className="animate-spin mr-2" /> İşlem yapılıyor...
              </div>
            ) : actionState.error ? (
              <p className="text-xs text-red-400">{actionState.error}</p>
            ) : (
              <div className="space-y-3 mt-4">
                <div className="text-[11px] leading-relaxed text-slate-300 prose prose-sm prose-invert max-h-64 overflow-y-auto custom-scrollbar">
                  <ReactMarkdown>{actionState.result || ''}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )}

        {messages.map((msg) => (
          msg.role === 'user' ? (
            <div key={msg.id} className="flex justify-end">
              <div className="bg-indigo-500 text-white rounded-xl rounded-tr-sm px-3 py-2 text-xs shadow-sm max-w-[85%] whitespace-pre-wrap">
                {msg.text}
              </div>
            </div>
          ) : (
            <div key={msg.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 px-1">
                <div className="w-5 h-5 bg-indigo-500 rounded flex items-center justify-center text-[10px] text-white">
                  <Bot size={12} />
                </div>
                <span className="text-[10px] font-medium text-slate-400">Gemini Flash</span>
              </div>
              <div className="bg-white/5 rounded-xl p-3 border border-white/5 text-[11px] leading-relaxed text-slate-300 prose prose-sm prose-invert">
                {renderMessageText(msg.text)}
              </div>
            </div>
          )
        ))}
        {isLoading && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 px-1">
              <div className="w-5 h-5 bg-indigo-500 rounded flex items-center justify-center text-[10px] text-white">
                <Bot size={12} />
              </div>
              <span className="text-[10px] font-medium text-slate-400">Gemini Flash</span>
            </div>
            <div className="bg-white/5 rounded-xl px-4 py-3 border border-white/5 flex items-center gap-1.5 w-fit">
              <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
              <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
              <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce"></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 mt-auto bg-black/20 border-t border-white/5 shrink-0">
        <form onSubmit={handleSubmit} className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!document || isLoading || isUploading}
            placeholder={isUploading ? "Belge analiz ediliyor..." : (document ? "Soru sorun..." : "Lütfen bir belge yükleyin...")}
            className="w-full bg-black/40 border border-white/10 rounded-xl p-3 pr-10 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/50 resize-none h-16 placeholder:text-slate-600 custom-scrollbar disabled:opacity-50 transition-all"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as any);
              }
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || !document || isLoading || isUploading}
            className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-indigo-500 text-white hover:bg-indigo-400 disabled:bg-white/10 disabled:text-slate-500 transition-colors"
          >
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}
