import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Languages, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import { HighlightRect } from '../types';

interface FloatingToolbarProps {
  onAction: (action: 'summarize' | 'translate' | 'rephrase', text: string, rects: HighlightRect[]) => void;
}

export function FloatingToolbar({ onAction }: FloatingToolbarProps) {
  const [position, setPosition] = useState<{ x: number, y: number } | null>(null);
  const [selectedText, setSelectedText] = useState<string>('');
  const [selectedRects, setSelectedRects] = useState<HighlightRect[]>([]);

  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection();
      
      // Allow selection inside the whole window, but typically users select inside the viewer.
      if (selection && selection.toString().trim().length > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        // Don't show if the selection is inside our own floating toolbar
        if (selection.anchorNode?.parentElement?.closest('.floating-toolbar')) {
            return;
        }

        // Calculate relative rects
        const pageNode = selection.anchorNode?.parentElement?.closest('.react-pdf__Page');
        const rects: HighlightRect[] = [];
        if (pageNode) {
          const pageRect = pageNode.getBoundingClientRect();
          const clientRects = Array.from(range.getClientRects());
          
          clientRects.forEach(r => {
             // Filter out tiny artifacts
             if (r.width > 2 && r.height > 2) {
                 rects.push({
                   top: ((r.top - pageRect.top) / pageRect.height) * 100,
                   left: ((r.left - pageRect.left) / pageRect.width) * 100,
                   width: (r.width / pageRect.width) * 100,
                   height: (r.height / pageRect.height) * 100,
                 });
             }
          });
        }

        setSelectedText(selection.toString().trim());
        setSelectedRects(rects);
        setPosition({
          x: rect.left + rect.width / 2,
          y: rect.top - 10, // 10px above the selection
        });
      } else {
        setPosition(null);
        setSelectedText('');
        setSelectedRects([]);
      }
    };

    document.addEventListener('mouseup', handleSelection);
    
    return () => {
      document.removeEventListener('mouseup', handleSelection);
    };
  }, []);

  if (!position) return null;

  return (
    <div 
      className="floating-toolbar fixed z-50 flex items-center space-x-1 bg-slate-900/90 backdrop-blur-xl border border-white/10 shadow-2xl rounded-lg p-1.5 transform -translate-x-1/2 -translate-y-full animate-in fade-in zoom-in-95 duration-200"
      style={{ left: position.x, top: position.y }}
      onMouseDown={(e) => {
        // Prevent losing selection when clicking buttons
        e.preventDefault();
      }}
    >
      <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-900 border-b border-r border-white/10 rotate-45" />
      
      <button 
        onClick={() => { onAction('summarize', selectedText, selectedRects); setPosition(null); }}
        className="flex flex-col items-center justify-center px-3 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-white/10 transition-colors group"
        title="Özetle"
      >
        <BookOpen size={16} className="mb-1 group-hover:-translate-y-0.5 transition-transform text-indigo-400" />
        <span className="text-[10px] font-medium leading-none">Özetle</span>
      </button>

      <div className="w-px h-8 bg-white/10 mx-1" />

      <button 
        onClick={() => { onAction('translate', selectedText, selectedRects); setPosition(null); }}
        className="flex flex-col items-center justify-center px-3 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-white/10 transition-colors group"
        title="Çevir"
      >
        <Languages size={16} className="mb-1 group-hover:-translate-y-0.5 transition-transform text-emerald-400" />
        <span className="text-[10px] font-medium leading-none">Çevir</span>
      </button>

      <div className="w-px h-8 bg-white/10 mx-1" />

      <button 
        onClick={() => { onAction('rephrase', selectedText, selectedRects); setPosition(null); }}
        className="flex flex-col items-center justify-center px-3 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-white/10 transition-colors group"
        title="Yeniden Yaz"
      >
        <Sparkles size={16} className="mb-1 group-hover:-translate-y-0.5 transition-transform text-amber-400" />
        <span className="text-[10px] font-medium leading-none">Yeniden Yaz</span>
      </button>
    </div>
  );
}
