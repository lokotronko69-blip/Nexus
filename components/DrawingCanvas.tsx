
import React, { useRef, useEffect, useState, useCallback } from 'react';

interface DrawingCanvasProps {
    onDraw?: (data: string) => void;
    id?: string;
}

export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({ onDraw, id = 'nexus-canvas' }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [color, setColor] = useState('#d946ef'); // Nexus pink
    const [brushSize, setBrushSize] = useState(5);
    const lastPos = useRef({ x: 0, y: 0 });

    const getPos = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
        
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height)
        };
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        setIsDrawing(true);
        lastPos.current = getPos(e);
    };

    const draw = useCallback((e: MouseEvent | TouchEvent) => {
        if (!isDrawing || !canvasRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        const pos = getPos(e);
        
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(lastPos.current.x, lastPos.current.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        
        lastPos.current = pos;
    }, [isDrawing, color, brushSize]);

    const stopDrawing = () => {
        setIsDrawing(false);
        if (onDraw && canvasRef.current) {
            onDraw(canvasRef.current.toDataURL());
        }
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const handleMouseMove = (e: MouseEvent) => draw(e);
        const handleTouchMove = (e: TouchEvent) => {
            e.preventDefault();
            draw(e);
        };
        const handleMouseUp = () => stopDrawing();
        const handleTouchEnd = () => stopDrawing();

        if (isDrawing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            window.addEventListener('touchmove', handleTouchMove, { passive: false });
            window.addEventListener('touchend', handleTouchEnd);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', handleTouchEnd);
        };
    }, [isDrawing, draw]);

    // Expose drawing methods to Nexus
    useEffect(() => {
        (window as any).nexusCanvas = {
            draw: (x1: number, y1: number, x2: number, y2: number, c: string = color, s: number = brushSize) => {
                const ctx = canvasRef.current?.getContext('2d');
                if (!ctx) return;
                ctx.beginPath();
                ctx.strokeStyle = c;
                ctx.lineWidth = s;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            },
            clear: () => {
                const ctx = canvasRef.current?.getContext('2d');
                if (!ctx) return;
                ctx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
            },
            save: () => canvasRef.current?.toDataURL(),
            setSize: (w: number, h: number) => {
                if (canvasRef.current) {
                    canvasRef.current.width = w;
                    canvasRef.current.height = h;
                }
            }
        };
        return () => {
            delete (window as any).nexusCanvas;
        };
    }, [color, brushSize]);

    return (
        <div className="flex flex-col gap-3 w-full h-full bg-zinc-900 rounded-lg overflow-hidden border border-zinc-700">
            <div className="flex items-center justify-between px-3 py-2 bg-zinc-800 border-b border-zinc-700">
                <div className="flex items-center gap-2">
                    <input 
                        type="color" 
                        value={color} 
                        onChange={(e) => setColor(e.target.value)}
                        className="w-6 h-6 rounded border-none bg-transparent cursor-pointer"
                    />
                    <input 
                        type="range" 
                        min="1" 
                        max="20" 
                        value={brushSize} 
                        onChange={(e) => setBrushSize(parseInt(e.target.value))}
                        className="w-20 accent-fuchsia-500"
                    />
                </div>
                <button 
                    onClick={() => (window as any).nexusCanvas.clear()} 
                    className="text-[10px] uppercase font-bold text-zinc-400 hover:text-white transition-colors"
                >
                    Limpiar
                </button>
            </div>
            <canvas 
                ref={canvasRef}
                width={800}
                height={600}
                onMouseDown={startDrawing}
                onTouchStart={startDrawing}
                className="w-full h-full bg-zinc-950 flex-1 cursor-crosshair touch-none"
            />
        </div>
    );
};
