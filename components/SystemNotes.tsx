import React, { useState, useEffect } from 'react';
import { FileText, X, Save, Copy, Check, Trash2, Download } from 'lucide-react';

interface SystemNotesProps {
    onClose: () => void;
    initialContent?: string;
}

export const SystemNotes: React.FC<SystemNotesProps> = ({ onClose, initialContent }) => {
    const [content, setContent] = useState<string>(() => {
        return initialContent || localStorage.getItem('nexus_system_notes') || '# Notas del Sistema Nexus\n\n- Escribe aquí tus apuntes, tareas o código.\n- Nexus puede leer y editar estas notas por ti.';
    });
    const [copied, setCopied] = useState(false);
    const [saved, setSaved] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);

    useEffect(() => {
        if (initialContent) {
            setContent(prev => `${prev}\n\n${initialContent}`);
        }
    }, [initialContent]);

    const handleSave = () => {
        localStorage.setItem('nexus_system_notes', content);
        fetch('/api/data-vault/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: content }),
        }).catch(() => {});
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownload = () => {
        const blob = new Blob([content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nexus-notas-${new Date().toISOString().slice(0, 10)}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
    const charCount = content.length;

    return (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-2xl h-[60vh] max-h-[550px] bg-zinc-950/95 border border-zinc-700/80 rounded-xl shadow-[0_0_50px_rgba(217,70,239,0.2)] backdrop-blur-xl z-50 flex flex-col pointer-events-auto overflow-hidden font-mono">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-zinc-900 via-zinc-850 to-zinc-900 border-b border-zinc-800 select-none">
                <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-fuchsia-400" />
                    <span className="text-xs font-bold text-zinc-200">
                        Bloc de Notas del Sistema
                    </span>
                    <span className="text-[10px] text-zinc-500">
                        (Autoguardado)
                    </span>
                </div>

                <div className="flex items-center gap-1.5">
                    <button
                        onClick={handleCopy}
                        className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors text-xs flex items-center gap-1"
                        title="Copiar contenido"
                    >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span className="text-[10px] hidden sm:inline">{copied ? 'Copiado' : 'Copiar'}</span>
                    </button>
                    <button
                        onClick={handleDownload}
                        className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors text-xs flex items-center gap-1"
                        title="Descargar archivo"
                    >
                        <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={handleSave}
                        className="p-1.5 rounded-lg bg-fuchsia-600/30 hover:bg-fuchsia-600/50 text-fuchsia-300 border border-fuchsia-500/30 transition-colors text-xs flex items-center gap-1"
                        title="Guardar notas"
                    >
                        <Save className="w-3.5 h-3.5" />
                        <span className="text-[10px] hidden sm:inline">{saved ? 'Guardado!' : 'Guardar'}</span>
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-zinc-400 hover:text-red-400 transition-colors ml-1"
                        title="Cerrar notas"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Editor Area */}
            <div className="flex-1 p-3 bg-black/50">
                <textarea
                    value={content}
                    onChange={(e) => {
                        setContent(e.target.value);
                        localStorage.setItem('nexus_system_notes', e.target.value);
                    }}
                    placeholder="Escribe tus notas aquí..."
                    className="w-full h-full bg-transparent text-zinc-200 text-xs font-mono outline-none resize-none custom-scrollbar p-2 leading-relaxed selection:bg-fuchsia-500/30 selection:text-white"
                    spellCheck={false}
                    autoFocus
                />
            </div>

            {/* Footer */}
            <div className="px-4 py-1.5 bg-zinc-900 border-t border-zinc-800 text-[10px] text-zinc-500 flex justify-between items-center select-none">
                <div className="flex items-center gap-3">
                    <span>{wordCount} palabras</span>
                    <span>•</span>
                    <span>{charCount} caracteres</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => {
                            if (!confirmClear) {
                                setConfirmClear(true);
                                setTimeout(() => setConfirmClear(false), 3000);
                                return;
                            }
                            setConfirmClear(false);
                            setContent('');
                            localStorage.removeItem('nexus_system_notes');
                        }}
                        className={`flex items-center gap-1 transition-colors ${confirmClear ? 'text-red-400 font-bold' : 'text-zinc-500 hover:text-red-400'}`}
                    >
                        <Trash2 className="w-3 h-3" />
                        <span>{confirmClear ? '¿Confirmar limpiar?' : 'Limpiar'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};
