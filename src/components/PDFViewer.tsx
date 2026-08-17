import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { useInView } from 'react-intersection-observer';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { 
  ChevronLeft, 
  ChevronRight, 
  ZoomIn, 
  ZoomOut, 
  ScanText, 
  Loader2, 
  LayoutGrid, 
  LayoutList, 
  FileText, 
  Search, 
  Save, 
  SaveAll, 
  MessageSquarePlus,
  Upload,
  BookOpen,
  Sparkles,
  FileCode,
  Type,
  Maximize2
} from 'lucide-react';
import { createWorker } from 'tesseract.js';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { cn } from '../lib/utils';
import { HighlightRect } from '../types';

// Setup pdf.js worker using unpkg to avoid bundler/MIME issues
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export interface OcrWord {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PDFViewerProps {
  file: File | null;
  setFile?: (file: File | null) => void;
  fileHandle?: any;
  setFileHandle?: (handle: any) => void;
  pageNumber: number;
  setPageNumber: (page: number) => void;
  highlights?: HighlightRect[];
  ocrLanguage: string;
  documentDetails?: any;
  onSelectFile?: () => void;
  isUploading?: boolean;
}

type ViewMode = 'single' | 'continuous' | 'two-page';

function VirtualizedPage({ pageNumber, scale, highlights, onVisible, renderOcrLayer }: { pageNumber: number, scale: number, highlights: HighlightRect[], onVisible: (page: number) => void, renderOcrLayer: (p: number) => React.ReactNode }) {
  const { ref, inView } = useInView({
    threshold: 0.1,
    onChange: (inView) => {
      if (inView) onVisible(pageNumber);
    },
  });

  return (
    <div ref={ref} className="mb-8 flex justify-center w-full min-h-[800px]">
      {inView ? (
        <Page 
          pageNumber={pageNumber} 
          scale={scale} 
          className="shadow-2xl bg-white text-slate-800 relative"
          renderTextLayer={true}
          renderAnnotationLayer={true}
        >
          {highlights.map((rect, idx) => (
            <div 
              key={idx} 
              className="absolute bg-yellow-400/30 mix-blend-multiply pointer-events-none z-10"
              style={{
                top: `${rect.top}%`,
                left: `${rect.left}%`,
                width: `${rect.width}%`,
                height: `${rect.height}%`,
              }}
            />
          ))}
          {renderOcrLayer(pageNumber)}
        </Page>
      ) : (
        <div className="w-[595px] h-[842px] bg-white/5 animate-pulse rounded flex items-center justify-center border border-white/10 text-slate-500 text-xs">
          Sayfa {pageNumber}
        </div>
      )}
    </div>
  );
}

export function PDFViewer({
  file,
  setFile,
  fileHandle,
  setFileHandle,
  pageNumber,
  setPageNumber,
  highlights = [],
  ocrLanguage,
  documentDetails,
  onSelectFile,
  isUploading = false
}: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [scale, setScale] = useState(1.1);
  const [viewMode, setViewMode] = useState<ViewMode>('single');
  const [pdfProxy, setPdfProxy] = useState<any>(null);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ current: number, total: number } | null>(null);
  const [ocrPagesData, setOcrPagesData] = useState<{ [page: number]: OcrWord[] }>({});
  const [textContent, setTextContent] = useState<string | null>(null);
  const [readerFontSize, setReaderFontSize] = useState<number>(16);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (file && (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.csv') || file.name.endsWith('.txt'))) {
      const reader = new FileReader();
      reader.onload = (e) => setTextContent(e.target?.result as string);
      reader.readAsText(file);
    } else {
      setTextContent(null);
    }
  }, [file]);

  function onDocumentLoadSuccess(pdf: any) {
    setNumPages(pdf.numPages);
    setPageNumber(1);
    setPdfProxy(pdf);
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pdfProxy || !searchQuery.trim()) {
       setSearchResults([]);
       return;
    }
    
    setIsSearching(true);
    const results: number[] = [];
    const query = searchQuery.toLowerCase();
    
    try {
      for (let i = 1; i <= pdfProxy.numPages; i++) {
        const page = await pdfProxy.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items.map((s: any) => s.str).join(' ');
        
        if (text.toLowerCase().includes(query)) {
          results.push(i);
        }
      }
      
      setSearchResults(results);
      setCurrentSearchIndex(0);
      if (results.length > 0) {
        setPageNumber(results[0]);
        setTimeout(() => {
          const pages = viewerRef.current?.querySelectorAll('.react-pdf__Page');
          if (pages && viewMode === 'continuous') {
             const targetPage = results[0];
             pages[targetPage - 1]?.scrollIntoView({ behavior: 'smooth' });
          }
        }, 100);
      }
    } catch (e) {
      console.error("Search error:", e);
    } finally {
      setIsSearching(false);
    }
  };

  const nextSearchResult = () => {
    if (searchResults.length === 0) return;
    const nextIdx = (currentSearchIndex + 1) % searchResults.length;
    setCurrentSearchIndex(nextIdx);
    setPageNumber(searchResults[nextIdx]);
  };

  const prevSearchResult = () => {
    if (searchResults.length === 0) return;
    const prevIdx = (currentSearchIndex - 1 + searchResults.length) % searchResults.length;
    setCurrentSearchIndex(prevIdx);
    setPageNumber(searchResults[prevIdx]);
  };

  const handleOcr = async () => {
    if (!pdfProxy || !file || isOcrRunning) return;
    setIsOcrRunning(true);
    setOcrProgress({ current: 0, total: pdfProxy.numPages });

    try {
      const worker = await createWorker(ocrLanguage);
      const newOcrData: { [page: number]: OcrWord[] } = {};

      for (let i = 1; i <= pdfProxy.numPages; i++) {
        setOcrProgress({ current: i, total: pdfProxy.numPages });
        const page = await pdfProxy.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');

        if (ctx) {
          await page.render({ canvasContext: ctx, viewport }).promise;
          const ret = await worker.recognize(canvas);
          
          const words: OcrWord[] = (ret.data as any).words?.map((w: any) => ({
            text: w.text,
            left: (w.bbox.x0 / canvas.width) * 100,
            top: (w.bbox.y0 / canvas.height) * 100,
            width: ((w.bbox.x1 - w.bbox.x0) / canvas.width) * 100,
            height: ((w.bbox.y1 - w.bbox.y0) / canvas.height) * 100,
          })) || [];

          newOcrData[i] = words;
        }
      }

      await worker.terminate();
      setOcrPagesData(newOcrData);
    } catch (e) {
      console.error('OCR Error:', e);
      alert('OCR işlemi sırasında bir hata meydana geldi.');
    } finally {
      setIsOcrRunning(false);
      setOcrProgress(null);
    }
  };

  const savePdfWithAnnotations = async (saveAsNew = false) => {
    if (!file) return;
    setIsSaving(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      pdfDoc.registerFontkit(fontkit);

      // Add comments / highlights if any
      for (const [pageNumStr, words] of Object.entries(ocrPagesData)) {
        const pNum = parseInt(pageNumStr, 10);
        if (pNum <= pdfDoc.getPageCount()) {
          const page = pdfDoc.getPage(pNum - 1);
          const { width, height } = page.getSize();
          for (const w of words) {
            const boxX = (w.left / 100) * width;
            const boxY = height - ((w.top / 100) * height) - ((w.height / 100) * height);
            const boxW = (w.width / 100) * width;
            const boxH = (w.height / 100) * height;

            page.drawRectangle({
              x: boxX,
              y: boxY,
              width: boxW,
              height: boxH,
              color: rgb(1, 1, 0),
              opacity: 0.15,
            });
          }
        }
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });

      if (saveAsNew || !fileHandle) {
        if ('showSaveFilePicker' in window) {
          try {
            const handle = await (window as any).showSaveFilePicker({
              suggestedName: `annotated_${file.name}`,
              types: [{
                description: 'PDF Document',
                accept: { 'application/pdf': ['.pdf'] }
              }]
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            if (setFileHandle) setFileHandle(handle);
            if (setFile) {
              const newFile = await handle.getFile();
              setFile(newFile);
            }
            alert('Belge başarıyla kaydedildi!');
            return;
          } catch (e: any) {
            if (e.name === 'AbortError') return;
          }
        }
        
        // Fallback download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `annotated_${file.name}`;
        a.click();
        URL.revokeObjectURL(url);
        alert('Belge indirildi!');
      } else {
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        if (setFile) {
          const updatedFile = await fileHandle.getFile();
          setFile(updatedFile);
        }
        alert('Değişiklikler mevcut dosyaya kaydedildi!');
      }
    } catch (e: any) {
      console.error('Save error:', e);
      alert('Kaydedilirken hata oluştu: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const renderOcrLayer = (pageNum: number) => {
    const lines = ocrPagesData[pageNum];
    if (!lines || lines.length === 0) return null;
    return (
      <div className="absolute inset-0 z-20 overflow-hidden pointer-events-none" style={{ color: 'transparent', containerType: 'size' }}>
        {lines.map((line, idx) => (
          <span key={idx} className="absolute select-text cursor-text pointer-events-auto" style={{
            left: `${line.left}%`, top: `${line.top}%`, width: `${line.width}%`, height: `${line.height}%`,
            fontSize: `${line.height}cqh`, whiteSpace: 'pre', lineHeight: 1, padding: 0, margin: 0,
            transformOrigin: 'top left', display: 'block'
          }}>
            {line.text}
          </span>
        ))}
      </div>
    );
  };

  // ==========================================
  // EMPTY STATE: HERO DROPZONE & UPLOAD BUTTON
  // ==========================================
  if (!file) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 text-center select-none relative overflow-auto">
        <div 
          onClick={onSelectFile}
          className="w-full max-w-2xl p-10 md:p-14 rounded-3xl border-2 border-dashed border-white/15 hover:border-indigo-500/60 bg-gradient-to-b from-white/[0.04] to-transparent hover:bg-indigo-500/[0.04] transition-all duration-300 flex flex-col items-center cursor-pointer group shadow-2xl relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/5 via-transparent to-emerald-500/5 pointer-events-none" />

          <div className="w-24 h-24 mb-6 rounded-3xl bg-indigo-500/10 group-hover:bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 group-hover:scale-110 group-hover:text-indigo-300 transition-all duration-300 shadow-xl shadow-indigo-500/10">
            {isUploading ? (
              <Loader2 className="animate-spin text-indigo-400" size={44} />
            ) : (
              <Upload size={44} className="group-hover:-translate-y-1 transition-transform" />
            )}
          </div>

          <h3 className="text-xl md:text-2xl font-bold text-white mb-2 group-hover:text-indigo-200 transition-colors">
            {isUploading ? 'Belge Yükleniyor ve Analiz Ediliyor...' : 'Belgenizi Buraya Sürükleyin'}
          </h3>
          <p className="text-xs md:text-sm text-slate-400 max-w-lg mb-8 leading-relaxed">
            veya bilgisayarınızdan bir dosya seçmek için bu alana tıklayın. Google Gemini 2.5 Flash ile anında akıllı soru-cevap, özet ve sayfa referanslı analizler yapın.
          </p>

          <button
            type="button"
            disabled={isUploading}
            onClick={(e) => { e.stopPropagation(); onSelectFile?.(); }}
            className="px-8 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold shadow-lg shadow-indigo-500/25 flex items-center gap-2.5 transition-all transform active:scale-95 disabled:opacity-50"
          >
            {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            <span>{isUploading ? 'Yükleniyor...' : 'Belge Yükle / Dosya Seç'}</span>
          </button>

          {/* Supported Format Badges */}
          <div className="w-full mt-10 pt-6 border-t border-white/10 flex flex-wrap items-center justify-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500 mr-2 uppercase tracking-wider">Desteklenen:</span>
            <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/15 text-red-300 border border-red-500/30 flex items-center gap-1.5">
              📕 PDF
            </span>
            <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
              📖 EPUB (E-Kitap)
            </span>
            <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30 flex items-center gap-1.5">
              📘 Word (.docx, .doc)
            </span>
            <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1.5">
              📝 Markdown / TXT
            </span>
            <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30 flex items-center gap-1.5">
              🖼️ Görseller
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // IMAGE PREVIEW
  // ==========================================
  const isImage = file.type.startsWith('image/');
  if (isImage) {
    return (
      <div className="flex-1 flex flex-col h-full relative bg-slate-900/60 p-4">
        <div className="h-12 bg-black/30 border-b border-white/10 flex items-center justify-between px-4 shrink-0 rounded-t-xl">
          <span className="text-xs font-medium text-slate-300 flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30">Görsel</span>
            {file.name}
          </span>
          <button onClick={onSelectFile} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
            <Upload size={13} /> Farklı Belge Yükle
          </button>
        </div>
        <div className="flex-1 overflow-auto p-6 flex justify-center items-center rounded-b-xl bg-black/40 border border-white/5 custom-scrollbar">
          <img src={URL.createObjectURL(file)} alt="Preview" className="max-w-full max-h-full rounded-lg shadow-2xl object-contain" />
        </div>
      </div>
    );
  }

  // ==========================================
  // PLAIN TEXT & MARKDOWN PREVIEW
  // ==========================================
  if (textContent !== null) {
    return (
      <div className="flex-1 flex flex-col h-full relative bg-slate-900/60">
        <div className="h-12 bg-black/30 border-b border-white/10 flex items-center justify-between px-4 shrink-0">
          <span className="text-xs font-medium text-slate-300 flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30">Metin</span>
            {file.name}
          </span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-slate-400 text-xs">
              <button onClick={() => setReaderFontSize(f => Math.max(12, f - 2))} className="px-2 py-1 bg-white/5 hover:bg-white/10 rounded border border-white/10 text-[10px]">A-</button>
              <button onClick={() => setReaderFontSize(f => Math.min(24, f + 2))} className="px-2 py-1 bg-white/5 hover:bg-white/10 rounded border border-white/10 text-[10px]">A+</button>
            </div>
            <button onClick={onSelectFile} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              <Upload size={13} /> Değiştir
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6 md:p-12 custom-scrollbar select-text">
          <div className="max-w-4xl mx-auto bg-white/5 border border-white/10 rounded-2xl p-8 md:p-12 shadow-2xl backdrop-blur-sm">
            <pre 
              className="text-slate-300 font-mono whitespace-pre-wrap break-words leading-relaxed select-text"
              style={{ fontSize: `${readerFontSize}px` }}
            >
              {textContent}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // EPUB, WORD & EXTRACTED DOCUMENT READER
  // ==========================================
  const isEpubOrWord = file.type !== 'application/pdf';
  if (isEpubOrWord && documentDetails && (documentDetails.extractedHtml || documentDetails.extractedText)) {
    const isEpub = file.name.toLowerCase().endsWith('.epub');
    const badgeLabel = isEpub ? 'EPUB E-Kitap' : 'Word Belgesi';
    const badgeColor = isEpub ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-blue-500/20 text-blue-300 border-blue-500/30';

    return (
      <div className="flex-1 flex flex-col h-full bg-slate-900 border-r border-white/5">
        <div className="h-12 bg-black/30 border-b border-white/10 flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-2 truncate">
            <span className={`px-2 py-0.5 rounded text-[10px] border font-medium ${badgeColor}`}>
              {badgeLabel}
            </span>
            <span className="text-xs font-semibold text-slate-200 truncate max-w-sm">{file.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-slate-400 text-xs">
              <button onClick={() => setReaderFontSize(f => Math.max(12, f - 2))} className="px-2 py-1 bg-white/5 hover:bg-white/10 rounded border border-white/10 text-[10px]" title="Yazıyı Küçült">A-</button>
              <button onClick={() => setReaderFontSize(f => Math.min(26, f + 2))} className="px-2 py-1 bg-white/5 hover:bg-white/10 rounded border border-white/10 text-[10px]" title="Yazıyı Büyüt">A+</button>
            </div>
            <button onClick={onSelectFile} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              <Upload size={13} /> Değiştir
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 md:p-10 custom-scrollbar select-text">
          <div 
            className="max-w-4xl mx-auto bg-slate-950/80 text-slate-200 p-8 md:p-14 rounded-2xl border border-white/10 shadow-2xl min-h-[800px] leading-relaxed select-text"
            style={{ fontSize: `${readerFontSize}px` }}
          >
            {documentDetails.extractedHtml ? (
              <div 
                className="prose prose-invert max-w-none prose-headings:text-indigo-300 prose-a:text-indigo-400 prose-p:leading-relaxed select-text"
                dangerouslySetInnerHTML={{ __html: documentDetails.extractedHtml }} 
              />
            ) : (
              <pre className="font-sans whitespace-pre-wrap break-words leading-relaxed select-text">
                {documentDetails.extractedText}
              </pre>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // PDF DOCUMENT VIEWER
  // ==========================================
  return (
    <div className="flex-1 flex flex-col h-full relative">
      {/* Top Controls Toolbar */}
      <div className="h-12 bg-black/30 border-b border-white/10 flex items-center justify-between px-3 shrink-0 select-none z-20">
        
        {/* Left: View Mode & Pagination */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-white/5 rounded-lg p-0.5 border border-white/10">
            <button
              onClick={() => setViewMode('single')}
              className={cn("p-1 rounded text-slate-400 hover:text-white transition-colors", viewMode === 'single' && "bg-white/10 text-white")}
              title="Tek Sayfa Modu"
            >
              <LayoutList size={15} />
            </button>
            <button
              onClick={() => setViewMode('continuous')}
              className={cn("p-1 rounded text-slate-400 hover:text-white transition-colors", viewMode === 'continuous' && "bg-white/10 text-white")}
              title="Sürekli Kaydırma Modu"
            >
              <LayoutGrid size={15} />
            </button>
          </div>

          <div className="h-4 w-px bg-white/10 mx-1" />

          {/* Page Controls */}
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setPageNumber(Math.max(1, pageNumber - 1))}
              disabled={pageNumber <= 1}
              className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30 hover:bg-white/5 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-slate-300 font-mono px-1">
              {pageNumber} / {numPages || '--'}
            </span>
            <button
              onClick={() => setPageNumber(Math.min(numPages || 1, pageNumber + 1))}
              disabled={numPages ? pageNumber >= numPages : true}
              className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30 hover:bg-white/5 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Center: Search inside PDF */}
        <form onSubmit={handleSearch} className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg px-2 py-0.5 max-w-[200px] md:max-w-[280px]">
          <Search size={13} className="text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder="Belgede ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent text-xs text-slate-200 outline-none w-full placeholder:text-slate-500"
          />
          {searchResults.length > 0 && (
            <span className="text-[10px] text-indigo-400 font-mono shrink-0">
              {currentSearchIndex + 1}/{searchResults.length}
            </span>
          )}
          {searchResults.length > 0 && (
            <div className="flex items-center">
              <button type="button" onClick={prevSearchResult} className="p-0.5 text-slate-400 hover:text-white">
                <ChevronLeft size={12} />
              </button>
              <button type="button" onClick={nextSearchResult} className="p-0.5 text-slate-400 hover:text-white">
                <ChevronRight size={12} />
              </button>
            </div>
          )}
        </form>

        {/* Right: Zoom & OCR */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-white/5 rounded-lg p-0.5 border border-white/10">
            <button
              onClick={() => setScale(s => Math.max(0.6, s - 0.15))}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
              title="Küçült"
            >
              <ZoomOut size={15} />
            </button>
            <span className="text-[11px] font-mono px-1.5 text-slate-300">{Math.round(scale * 100)}%</span>
            <button
              onClick={() => setScale(s => Math.min(2.5, s + 0.15))}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
              title="Büyüt"
            >
              <ZoomIn size={15} />
            </button>
          </div>

          <button 
            onClick={handleOcr} 
            disabled={isOcrRunning}
            className="flex items-center space-x-1.5 px-2.5 py-1 bg-white/5 border border-white/10 text-slate-300 hover:bg-indigo-500 hover:border-indigo-500 hover:text-white rounded-lg transition-colors disabled:opacity-50 text-[10px] font-medium"
            title="Taranmış sayfalar için OCR ile metin çıkar"
          >
            {isOcrRunning ? <Loader2 size={13} className="animate-spin" /> : <ScanText size={13} />}
            <span className="whitespace-nowrap">{ocrProgress ? `OCR (${ocrProgress.current}/${ocrProgress.total})` : 'Tümünü OCR\'la'}</span>
          </button>
        </div>
      </div>

      {/* Viewer Area */}
      <div className="flex-1 overflow-auto p-4 md:p-8 flex justify-center custom-scrollbar relative select-text" ref={viewerRef}>
        <Document
          file={file}
          onLoadSuccess={onDocumentLoadSuccess}
          className="flex flex-col items-center"
          loading={
            <div className="flex flex-col items-center justify-center mt-20 text-slate-400">
              <Loader2 className="animate-spin mb-2" size={24} />
              <p className="text-sm">Belge yükleniyor...</p>
            </div>
          }
        >
          {viewMode === 'single' && (
            <Page 
              pageNumber={pageNumber} 
              scale={scale} 
              className="shadow-2xl bg-white text-slate-800 relative mb-4"
              renderTextLayer={true}
              renderAnnotationLayer={true}
            >
              {highlights.map((rect, idx) => (
                <div 
                  key={idx} 
                  className="absolute bg-yellow-400/30 mix-blend-multiply pointer-events-none z-10"
                  style={{
                    top: `${rect.top}%`,
                    left: `${rect.left}%`,
                    width: `${rect.width}%`,
                    height: `${rect.height}%`,
                  }}
                />
              ))}
              {renderOcrLayer(pageNumber)}
            </Page>
          )}

          {viewMode === 'continuous' && (
            Array.from(new Array(numPages), (el, index) => (
              <VirtualizedPage
                key={`page_${index + 1}`}
                pageNumber={index + 1}
                scale={scale}
                highlights={pageNumber === index + 1 ? highlights : []}
                renderOcrLayer={renderOcrLayer}
                onVisible={(page) => {
                  setPageNumber(page);
                }}
              />
            ))
          )}

          {viewMode === 'two-page' && (
            <div className="flex gap-4">
              <Page 
                pageNumber={pageNumber} 
                scale={scale} 
                className="shadow-2xl bg-white text-slate-800 relative"
                renderTextLayer={true}
                renderAnnotationLayer={true}
              >
                {highlights.map((rect, idx) => (
                  <div 
                    key={idx} 
                    className="absolute bg-yellow-400/30 mix-blend-multiply pointer-events-none z-10"
                    style={{
                      top: `${rect.top}%`,
                      left: `${rect.left}%`,
                      width: `${rect.width}%`,
                      height: `${rect.height}%`,
                    }}
                  />
                ))}
                {renderOcrLayer(pageNumber)}
              </Page>
              {pageNumber + 1 <= numPages && (
                <Page 
                  pageNumber={pageNumber + 1} 
                  scale={scale} 
                  className="shadow-2xl bg-white text-slate-800 relative"
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                >
                  {renderOcrLayer(pageNumber + 1)}
                </Page>
              )}
            </div>
          )}
        </Document>
      </div>
    </div>
  );
}
