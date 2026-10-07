
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
        canvas.width = canvas.clientWidth || window.innerWidth || 1280;
        canvas.height = canvas.clientHeight || window.innerHeight || 720;

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
                if (width > 0 && height > 0) {
                    canvas.width = width;
                    canvas.height = height;
                }
            }
        });
        resizeObserver.observe(canvas);

        let phase = 0;

        const renderFrame = () => {
            const currentStatus = statusRef.current;
            const width = Math.max(canvas.width || window.innerWidth || 800, 320);
            const height = Math.max(canvas.height || window.innerHeight || 600, 240);
            const centerX = width / 2;
            const centerY = height / 2;
            phase += 0.045;

            ctx.clearRect(0, 0, width, height);

            // 1. Always render subtle ambient background glow so the screen is never pitch black
            const isSpeaking = currentStatus === 'SPEAKING';
            const isThinking = currentStatus === 'THINKING';
            const isConnecting = currentStatus === 'CONNECTING';
            const primaryRgb = isSpeaking
                ? '217, 70, 239'
                : isThinking
                ? '168, 85, 247'
                : isConnecting
                ? '56, 189, 248'
                : '14, 165, 233';

            const outerRadius = Math.max(Math.min(width, height) * 0.45, 50);
            const bgGlow = ctx.createRadialGradient(
                centerX,
                centerY,
                10,
                centerX,
                centerY,
                outerRadius
            );
            bgGlow.addColorStop(0, `rgba(${primaryRgb}, 0.22)`);
            bgGlow.addColorStop(0.5, `rgba(${primaryRgb}, 0.07)`);
            bgGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = bgGlow;
            ctx.fillRect(0, 0, width, height);

            // 2. Ambient floating particles in all active states
            particlesRef.current.forEach(p => {
                p.x += p.vx * (isThinking ? 2.2 : 0.8);
                p.y += p.vy * (isThinking ? 2.2 : 0.8);

                if (p.x < 0) p.x = width;
                if (p.x > width) p.x = 0;
                if (p.y < 0) p.y = height;
                if (p.y > height) p.y = 0;

                ctx.globalAlpha = isThinking ? p.opacity : p.opacity * 0.55;
                ctx.fillStyle = `rgb(${primaryRgb})`;
                ctx.beginPath();
                ctx.arc(p.x, p.y, isThinking ? p.r * 1.3 : p.r, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.globalAlpha = 1.0;

            // 3. Central Nexus Core Orb (always visible & breathing)
            const pulseRadius = 46 + Math.sin(phase * 1.4) * 8 + (isSpeaking ? 12 : 0);
            ctx.save();
            ctx.beginPath();
            ctx.arc(centerX, centerY, pulseRadius * 1.45, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${primaryRgb}, ${0.25 + Math.sin(phase) * 0.1})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
            const coreGrad = ctx.createRadialGradient(centerX, centerY, 4, centerX, centerY, pulseRadius);
            coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
            coreGrad.addColorStop(0.35, `rgba(${primaryRgb}, 0.65)`);
            coreGrad.addColorStop(1, `rgba(${primaryRgb}, 0.05)`);
            ctx.fillStyle = coreGrad;
            ctx.fill();
            ctx.restore();

            // 4. Audio-reactive or Synthetic Ambient Waveform
            const analyser = currentStatus === 'SPEAKING' && outputAnalyser ? outputAnalyser : inputAnalyser;
            const bufferLength = analyser ? analyser.frequencyBinCount : 128;

            if (analyser && (currentStatus === 'LISTENING' || currentStatus === 'SPEAKING')) {
                const dataArray = new Uint8Array(bufferLength);
                analyser.getByteFrequencyData(dataArray);

                if (!smoothedData.current || smoothedData.current.length !== bufferLength) {
                    smoothedData.current = Array.from(dataArray);
                } else {
                    for (let i = 0; i < bufferLength; i++) {
                        smoothedData.current[i] =
                            smoothedData.current[i] * DAMPING_FACTOR + dataArray[i] * (1 - DAMPING_FACTOR);
                    }
                }
            } else if (!smoothedData.current || smoothedData.current.length !== bufferLength) {
                smoothedData.current = new Array(bufferLength).fill(0);
            }

            const waveData = smoothedData.current;
            const sliceWidth = width / bufferLength;

            ctx.lineWidth = 2;
            ctx.strokeStyle = `rgb(${primaryRgb})`;
            ctx.fillStyle = `rgba(${primaryRgb}, 0.18)`;

            ctx.beginPath();
            ctx.moveTo(0, centerY);

            let x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const rawVal = (waveData[i] || 0) / 128.0;
                // Add gentle breathing baseline wave so silence never collapses to a 0px invisible line
                const normX = i / bufferLength;
                const envelope = Math.sin(normX * Math.PI);
                const idleBreath =
                    Math.sin(normX * 10 + phase * 1.6) *
                    Math.cos(normX * 4 - phase) *
                    envelope *
                    (isConnecting ? 18 : isSpeaking ? 26 : 10);
                const y_amp = rawVal * height * 0.25 + Math.abs(idleBreath);
                const y = centerY - y_amp;

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                x += sliceWidth;
            }

            ctx.lineTo(width, centerY);

            x = width;
            for (let i = bufferLength - 1; i >= 0; i--) {
                const rawVal = (waveData[i] || 0) / 128.0;
                const normX = i / bufferLength;
                const envelope = Math.sin(normX * Math.PI);
                const idleBreath =
                    Math.sin(normX * 10 + phase * 1.6) *
                    Math.cos(normX * 4 - phase) *
                    envelope *
                    (isConnecting ? 18 : isSpeaking ? 26 : 10);
                const y_amp = rawVal * height * 0.25 + Math.abs(idleBreath);
                const y = centerY + y_amp;
                ctx.lineTo(x, y);
                x -= sliceWidth;
            }

            ctx.closePath();
            ctx.stroke();
            ctx.fill();

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
