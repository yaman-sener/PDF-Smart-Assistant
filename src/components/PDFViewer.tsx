import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { useInView } from 'react-intersection-observer';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, ScanText, Loader2, LayoutGrid, LayoutList, FileText, Search, Save, SaveAll, MessageSquarePlus } from 'lucide-react';
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
        <div className="w-full flex items-center justify-center text-slate-500 bg-white/5 shadow-2xl rounded-lg" style={{ width: 600 * scale, height: 800 * scale }}>
          Sayfa {pageNumber} Yükleniyor...
        </div>
      )}
    </div>
  );
}

export function PDFViewer({ file, setFile, fileHandle, setFileHandle, pageNumber, setPageNumber, highlights = [], ocrLanguage, documentDetails }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.2);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ current: number, total: number } | null>(null);
  const [ocrPagesData, setOcrPagesData] = useState<Record<number, OcrWord[]>>({});
  const [viewMode, setViewMode] = useState<ViewMode>('continuous');
  const [textContent, setTextContent] = useState<string | null>(null);
  const [pdfProxy, setPdfProxy] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (file && (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.csv'))) {
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
             const container = viewerRef.current;
             if (container) {
                container.scrollTop = (targetPage - 1) * (800 * scale + 32); 
             }
          }
        }, 100);
      } else {
        alert('Kelime bulunamadı.');
      }
    } catch(err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleNextSearchResult = () => {
    if (searchResults.length === 0) return;
    const nextIdx = (currentSearchIndex + 1) % searchResults.length;
    setCurrentSearchIndex(nextIdx);
    setPageNumber(searchResults[nextIdx]);
    
    setTimeout(() => {
      if (viewMode === 'continuous' && viewerRef.current) {
        viewerRef.current.scrollTop = (searchResults[nextIdx] - 1) * (800 * scale + 32); 
      }
    }, 100);
  };

  const handleZoomIn = () => setScale((s) => Math.min(s + 0.2, 3));
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.2, 0.5));
  const handlePrevPage = () => {
    if (viewMode === 'two-page') setPageNumber(Math.max(pageNumber - 2, 1));
    else setPageNumber(Math.max(pageNumber - 1, 1));
  };
  const handleNextPage = () => {
    if (viewMode === 'two-page') setPageNumber(Math.min(pageNumber + 2, numPages));
    else setPageNumber(Math.min(pageNumber + 1, numPages));
  };

  // Run OCR and populate instant custom HTML layer with fixed alignment
  const handleOcr = useCallback(async () => {
    if (!pdfProxy) return;
    try {
      setIsOcrRunning(true);
      setOcrProgress({ current: 0, total: numPages });
      
      const worker = await createWorker(ocrLanguage, 1, {
        logger: m => {}
      });
      
      for (let i = 1; i <= numPages; i++) {
        setOcrProgress({ current: i, total: numPages });
        const page = await pdfProxy.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 }); 
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;
        
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        
        const result = await worker.recognize(dataUrl);
        
        const lines = (result.data.lines || []).map((l: any) => ({
          text: l.text.trim(),
          left: (l.bbox.x0 / viewport.width) * 100,
          top: (l.bbox.y0 / viewport.height) * 100,
          width: ((l.bbox.x1 - l.bbox.x0) / viewport.width) * 100,
          height: ((l.bbox.y1 - l.bbox.y0) / viewport.height) * 100,
        }));
        
        setOcrPagesData(prev => ({ ...prev, [i]: lines }));
      }
      
      await worker.terminate();
      alert("Tüm belgenin OCR işlemi tamamlandı! Metinleri şu an farenizle eksiksiz seçebilirsiniz. PDF'inizi kalıcı olarak düzenlemek için 'Kaydet' butonuna basabilirsiniz.");
    } catch (error: any) {
      console.error("Toplu OCR Error:", error);
      alert("Toplu OCR işlemi sırasında bir hata oluştu: " + (error.message || String(error)));
    } finally {
      setIsOcrRunning(false);
      setOcrProgress(null);
    }
  }, [pdfProxy, numPages, ocrLanguage]);

  // Embed the OCR text physically into the PDF on save
  const handleSave = async (saveAs = false) => {
    if (!file) return;
    setIsSaving(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      
      // Load Fontkit and font for perfect Turkish support during native embedding
      pdfDoc.registerFontkit(fontkit);
      const fontUrl = '/Roboto-Regular.ttf';
      const fontBytes = await fetch(fontUrl).then(res => res.arrayBuffer());
      const font = await pdfDoc.embedFont(fontBytes);

      const pages = pdfDoc.getPages();
      for (const [pageNumStr, lines] of Object.entries(ocrPagesData)) {
        const pageNum = parseInt(pageNumStr);
        const page = pages[pageNum - 1];
        if (!page) continue;
        const { width, height } = page.getSize();
        
        for (const line of lines) {
          if (!line.text) continue;
          const pdfX = (line.left / 100) * width;
          const pdfTopY = (line.top / 100) * height; 
          const pdfY = height - pdfTopY - (line.height / 100) * height + ((line.height / 100) * height * 0.15); 
          const fontSize = (line.height / 100) * height * 0.9; 
          
          page.drawText(line.text, {
            x: pdfX,
            y: pdfY,
            size: fontSize,
            font: font,
            color: rgb(0, 0, 0),
            opacity: 0, // Invisible text
          });
        }
      }
      
      const savedBytes = await pdfDoc.save();
      const newBlob = new Blob([savedBytes], { type: 'application/pdf' });
      
      let handleToUse = fileHandle;
      if (saveAs || !handleToUse) {
        if (!('showSaveFilePicker' in window)) {
           const url = URL.createObjectURL(newBlob);
           const a = document.createElement('a');
           a.href = url;
           a.download = file.name;
           a.click();
           setIsSaving(false);
           return;
        }
        handleToUse = await (window as any).showSaveFilePicker({
          suggestedName: file.name,
          types: [{ description: 'PDF Dosyası', accept: { 'application/pdf': ['.pdf'] } }]
        });
        if (setFileHandle) setFileHandle(handleToUse);
      }
      
      if (handleToUse) {
        const writable = await handleToUse.createWritable();
        await writable.write(newBlob);
        await writable.close();
        alert("Başarıyla kaydedildi!");
        if (setFile) {
          const updatedFile = await handleToUse.getFile();
          setFile(updatedFile);
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
         alert('Kaydetme hatası: ' + e.message);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddComment = async () => {
    if (!file) return;
    const comment = prompt("PDF'in bu sayfasına eklenecek notu girin:");
    if (!comment) return;

    setIsSaving(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      
      pdfDoc.registerFontkit(fontkit);
      const fontUrl = '/Roboto-Regular.ttf';
      const fontBytes = await fetch(fontUrl).then(res => res.arrayBuffer());
      const font = await pdfDoc.embedFont(fontBytes);
      
      const pages = pdfDoc.getPages();
      const page = pages[pageNumber - 1];
      if (page) {
        const { height } = page.getSize();
        page.drawText('Not: ' + comment, {
          x: 20,
          y: height - 40,
          size: 14,
          font: font,
          color: rgb(1, 0, 0)
        });
      }

      const savedBytes = await pdfDoc.save();
      const newBlob = new Blob([savedBytes], { type: 'application/pdf' });
      
      let handleToUse = fileHandle;
      if (!handleToUse) {
         const url = URL.createObjectURL(newBlob);
         const a = document.createElement('a');
         a.href = url;
         a.download = "Notlu_" + file.name;
         a.click();
      } else {
        const writable = await handleToUse.createWritable();
        await writable.write(newBlob);
        await writable.close();
        alert("Yorum eklendi ve kaydedildi!");
        if (setFile) {
          const updatedFile = await handleToUse.getFile();
          setFile(updatedFile);
        }
      }
    } catch (e: any) {
      alert("Hata: " + e.message);
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

  if (!file) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-transparent border-r border-white/5">
        <div className="w-16 h-16 mb-4 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10">
          <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-slate-400 font-medium text-sm">Lütfen başlamak için bir belge yükleyin.</p>
      </div>
    );
  }

  const isImage = file.type.startsWith('image/');

  if (isImage) {
    return (
      <div className="flex-1 flex flex-col h-full relative bg-slate-900/60 p-4">
        <div className="flex-1 overflow-auto p-4 flex justify-center items-center rounded-xl bg-black/40 border border-white/5 custom-scrollbar">
          <img src={URL.createObjectURL(file)} alt="Preview" className="max-w-full max-h-full rounded shadow-2xl object-contain" />
        </div>
      </div>
    );
  }

  if (textContent !== null) {
    return (
      <div className="flex-1 flex flex-col h-full relative bg-slate-900/60">
        <div className="flex-1 overflow-auto p-6 md:p-12 custom-scrollbar">
          <div className="max-w-4xl mx-auto bg-white/5 border border-white/10 rounded-xl p-8 shadow-2xl backdrop-blur-sm">
            <pre className="text-slate-300 font-mono text-xs md:text-sm whitespace-pre-wrap break-words">
              {textContent}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  // Unsupported files but we have extracted content
  if (file.type !== 'application/pdf' && documentDetails && (documentDetails.extractedHtml || documentDetails.extractedText)) {
    return (
      <div className="flex-1 flex flex-col h-full bg-slate-900 border-r border-white/5">
        <div className="h-14 bg-black/20 border-b border-white/5 flex items-center px-4 shrink-0 shadow-sm z-10">
          <span className="text-xs font-medium text-slate-400">Belge Önizlemesi (Metin Modu)</span>
        </div>
        <div className="flex-1 overflow-auto p-8 custom-scrollbar">
          <div className="max-w-3xl mx-auto bg-white text-black p-10 rounded-sm shadow-2xl min-h-[800px]">
            {documentDetails.extractedHtml ? (
              <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: documentDetails.extractedHtml }} />
            ) : (
              <pre className="font-mono text-sm whitespace-pre-wrap break-words font-sans">
                {documentDetails.extractedText}
              </pre>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Unsupported files without content
  if (file.type !== 'application/pdf') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-transparent border-r border-white/5">
        <div className="w-16 h-16 mb-4 rounded-2xl bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
          <FileText className="w-8 h-8 text-indigo-400" />
        </div>
        <p className="text-slate-200 font-medium text-sm mb-1">Dosya Yüklendi</p>
        <p className="text-slate-400 text-xs max-w-sm text-center">
          Bu dosya türü yapay zeka tarafından analiz edilebilir ancak görsel önizlemesi şu anda desteklenmemektedir. Yapay zeka ile sohbet edebilirsiniz.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full relative">
      {/* Toolbar */}
      <div className="h-14 bg-black/20 border-b border-white/5 flex items-center justify-between px-4 shrink-0 shadow-sm z-10 overflow-x-auto custom-scrollbar">
        <div className="flex items-center space-x-2">
          <button onClick={handlePrevPage} disabled={pageNumber <= 1} className="p-1.5 hover:bg-white/10 rounded-md disabled:opacity-50 transition-colors text-slate-300 hover:text-white">
            <ChevronLeft size={18} />
          </button>
          <span className="text-xs font-medium text-slate-400 px-2 whitespace-nowrap">
            Sayfa {pageNumber} / {numPages || '-'}
          </span>
          <button onClick={handleNextPage} disabled={pageNumber >= numPages} className="p-1.5 hover:bg-white/10 rounded-md disabled:opacity-50 transition-colors text-slate-300 hover:text-white">
            <ChevronRight size={18} />
          </button>
        </div>
        
        <div className="flex items-center space-x-1 shrink-0">
          <div className="flex items-center space-x-1 mr-4 bg-white/5 p-1 rounded-lg">
            <button onClick={() => setViewMode('single')} className={cn("p-1.5 rounded-md transition-colors", viewMode === 'single' ? 'bg-white/20 text-white' : 'text-slate-400 hover:text-white')} title="Tek Sayfa">
              <FileText size={16} />
            </button>
            <button onClick={() => setViewMode('continuous')} className={cn("p-1.5 rounded-md transition-colors", viewMode === 'continuous' ? 'bg-white/20 text-white' : 'text-slate-400 hover:text-white')} title="Sürekli">
              <LayoutList size={16} />
            </button>
            <button onClick={() => setViewMode('two-page')} className={cn("p-1.5 rounded-md transition-colors", viewMode === 'two-page' ? 'bg-white/20 text-white' : 'text-slate-400 hover:text-white')} title="İki Sayfa">
              <LayoutGrid size={16} />
            </button>
          </div>

          <button onClick={handleZoomOut} className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-slate-300 hover:text-white" title="Uzaklaştır">
            <ZoomOut size={16} />
          </button>
          <span className="text-[10px] font-mono text-slate-400 w-10 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={handleZoomIn} className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-slate-300 hover:text-white" title="Yakınlaştır">
            <ZoomIn size={16} />
          </button>
          <div className="w-px h-5 bg-white/10 mx-2" />
          
          <button 
            onClick={handleAddComment} 
            disabled={isSaving}
            className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-slate-300 hover:text-white mr-1" 
            title="Yorum Ekle"
          >
            <MessageSquarePlus size={16} />
          </button>
          <button 
            onClick={() => handleSave(false)} 
            disabled={isSaving}
            className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-emerald-400 hover:text-emerald-300 mr-1" 
            title="Orijinal PDF Üzerine Kaydet"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          </button>
          <button 
            onClick={() => handleSave(true)} 
            disabled={isSaving}
            className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-indigo-400 hover:text-indigo-300 mr-4" 
            title="Farklı Kaydet"
          >
            <SaveAll size={16} />
          </button>

          <form onSubmit={handleSearch} className="flex items-center relative mr-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value.trim() === '') setSearchResults([]);
              }}
              placeholder="Belgede ara..."
              className="bg-white/5 border border-white/10 text-slate-200 text-xs rounded-l-md px-3 py-1.5 focus:outline-none focus:border-indigo-500 w-28 md:w-40 placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={isSearching || !searchQuery.trim()}
              className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white px-2 py-1.5 rounded-r-md transition-colors"
              title="Ara"
            >
              {isSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            </button>
            {searchResults.length > 0 && (
              <div className="absolute right-full mr-2 whitespace-nowrap text-[10px] text-slate-400 flex items-center gap-1">
                {currentSearchIndex + 1} / {searchResults.length}
                <button type="button" onClick={handleNextSearchResult} className="ml-1 p-1 bg-white/5 hover:bg-white/10 rounded" title="Sonraki Sonuç">
                  <ChevronRight size={12} />
                </button>
              </div>
            )}
          </form>

          <button 
            onClick={handleOcr} 
            disabled={isOcrRunning}
            className="flex items-center space-x-1.5 px-2.5 py-1 bg-white/5 border border-white/10 text-slate-300 hover:bg-indigo-500 hover:border-indigo-500 hover:text-white rounded-md transition-colors disabled:opacity-50 text-[10px] font-medium"
            title="Taranmış sayfalar için OCR ile metin çıkar"
          >
            {isOcrRunning ? <Loader2 size={14} className="animate-spin" /> : <ScanText size={14} />}
            <span className="whitespace-nowrap">{ocrProgress ? `OCR (${ocrProgress.current}/${ocrProgress.total})` : 'Tümünü OCR\'la'}</span>
          </button>
        </div>
      </div>

      {/* Viewer Area */}
      <div className="flex-1 overflow-auto p-4 md:p-8 flex justify-center custom-scrollbar relative" ref={viewerRef}>
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
