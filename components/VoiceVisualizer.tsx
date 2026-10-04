
import React, { useRef, useEffect } from 'react';
import type { NexusStatus } from '../types';

interface VoiceVisualizerProps {
    status: NexusStatus;
    inputAnalyser: AnalyserNode | null;
    outputAnalyser: AnalyserNode | null;
}

const DAMPING_FACTOR = 0.85;

export const VoiceVisualizer: React.FC<VoiceVisualizerProps> = ({ status, inputAnalyser, outputAnalyser }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const smoothedData = useRef<number[] | null>(null);
    const particlesRef = useRef<{x: number, y: number, r: number, vx: number, vy: number, opacity: number}[]>([]);
    const statusRef = useRef(status);

    useEffect(() => {
        statusRef.current = status;
    }, [status]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;
        
        // Initialize particles if empty
        if (particlesRef.current.length === 0) {
            for (let i = 0; i < 50; i++) {
                particlesRef.current.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    r: Math.random() * 2 + 1,
                    vx: (Math.random() - 0.5) * 1,
                    vy: (Math.random() - 0.5) * 1,
                    opacity: Math.random() * 0.5 + 0.2
                });
            }
        }

        const resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                canvas.width = width;
                canvas.height = height;
            }
        });
        resizeObserver.observe(canvas);

        const renderFrame = () => {
            const currentStatus = statusRef.current;
            const width = canvas.width;
            const height = canvas.height;

            ctx.clearRect(0, 0, width, height);

            let analyser = currentStatus === 'SPEAKING' && outputAnalyser ? outputAnalyser : inputAnalyser;

            // Draw Thinking Particles
            if (currentStatus === 'THINKING') {
                ctx.fillStyle = '#a855f7'; // Purple
                particlesRef.current.forEach(p => {
                    p.x += p.vx;
                    p.y += p.vy;

                    // Bounce
                    if (p.x < 0 || p.x > width) p.vx *= -1;
                    if (p.y < 0 || p.y > height) p.vy *= -1;

                    ctx.globalAlpha = p.opacity;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                    ctx.fill();
                });
                ctx.globalAlpha = 1.0;
            } 
            else if (analyser && (currentStatus === 'LISTENING' || currentStatus === 'SPEAKING')) {
                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                analyser.getByteFrequencyData(dataArray);

                if (!smoothedData.current || smoothedData.current.length !== bufferLength) {
                    smoothedData.current = Array.from(dataArray);
                } else {
                    for (let i = 0; i < bufferLength; i++) {
                        smoothedData.current[i] = smoothedData.current[i] * DAMPING_FACTOR + dataArray[i] * (1 - DAMPING_FACTOR);
                    }
                }

                const waveData = smoothedData.current;
                const sliceWidth = width / bufferLength;
                
                // Draw Koko (Blue) or Nexus (Purple) waves
                const isNexus = currentStatus === 'SPEAKING';
                const color = isNexus ? '217, 70, 239' : '14, 165, 233'; // Purple or Sky Blue
                
                ctx.lineWidth = 2;
                ctx.strokeStyle = `rgb(${color})`;
                ctx.fillStyle = `rgba(${color}, 0.2)`;

                ctx.beginPath();
                ctx.moveTo(0, height / 2);

                let x = 0;
                for (let i = 0; i < bufferLength; i++) {
                    const v = waveData[i] / 128.0;
                    const y_amp = v * height * 0.25;
                    
                    // Mirror effect
                    const y = height / 2 - y_amp;
                    
                    if (i === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }

                    x += sliceWidth;
                }

                ctx.lineTo(width, height / 2);
                
                // Draw bottom half (mirror)
                x = width;
                for (let i = bufferLength - 1; i >= 0; i--) {
                    const v = waveData[i] / 128.0;
                    const y_amp = v * height * 0.25;
                    const y = height / 2 + y_amp;
                    ctx.lineTo(x, y);
                    x -= sliceWidth;
                }
                
                ctx.closePath();
                ctx.stroke();
                ctx.fill();
            }

            animationFrameId = requestAnimationFrame(renderFrame);
        };

        renderFrame();

        return () => {
            cancelAnimationFrame(animationFrameId);
            resizeObserver.disconnect();
        };
    }, [inputAnalyser, outputAnalyser]); // Removed status from dependency

    return (
        <canvas 
            ref={canvasRef} 
            className="absolute inset-0 w-full h-full"
        />
    );
};
