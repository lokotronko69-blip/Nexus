import React, { useState, useRef, useCallback, useEffect } from 'react';
import { LiveServerMessage } from '@google/genai';
import { Monitor, MonitorOff, Video, VideoOff, Brain, Trash2, Settings, Cpu, Activity, Globe, Save, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { connectToNexus, performComplexTask, getWebSearchResult, NexusFunctionDeclarations, executeDynamicCode, generateImage, LiveSession, saveMemoryToStorage, loadMemories, getAllMemoriesFromStorage, getMemoriesArray, deleteMemory, clearAllMemories, executeCyberSecurityTool, saveTranscript, setCurrentNexusVoice, getCurrentNexusVoice, resetToDefaultNexusVoice, DEFAULT_NEXUS_VOICE } from './services/geminiService';
import type { NexusStatus } from './types';
import { VoiceVisualizer } from './components/VoiceVisualizer';
import { DrawingCanvas } from './components/DrawingCanvas';
import { TelemetryPanel } from './components/TelemetryPanel';
import { SystemTerminal } from './components/SystemTerminal';
import { SystemNotes } from './components/SystemNotes';
import { ProcessManager } from './components/ProcessManager';
import { DebianInstallPanel } from './components/DebianInstallPanel';
import { encode, decode, decodeAudioData } from './utils/audio';

export const App: React.FC = () => {
    const [nexusStatus, setNexusStatus] = useState<NexusStatus>('CONNECTING');
    const [lastError, setLastError] = useState<string | null>(null);
    const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
    const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);
    const [isCameraActive, setIsCameraActive] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [showScreenSharePrompt, setShowScreenSharePrompt] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [hasGrantedAccess, setHasGrantedAccess] = useState(false);
    const [showMemoriesModal, setShowMemoriesModal] = useState(false);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [lmStudioUrl, setLmStudioUrl] = useState(() => localStorage.getItem('nexus_lm_studio_url') || 'http://localhost:1234');
    const [ollamaUrl, setOllamaUrl] = useState(() => localStorage.getItem('nexus_ollama_url') || 'http://localhost:11434');
    const [showCanvas, setShowCanvas] = useState(false);
    const [showTelemetryPanel, setShowTelemetryPanel] = useState(false);
    const [showDebianPanel, setShowDebianPanel] = useState(false);
    const [showTerminal, setShowTerminal] = useState(false);
    const [showNotes, setShowNotes] = useState(false);
    const [showProcessManager, setShowProcessManager] = useState(false);
    const [terminalInitialCmd, setTerminalInitialCmd] = useState<string | undefined>(undefined);
    const [notesInitialContent, setNotesInitialContent] = useState<string | undefined>(undefined);
    const [memories, setMemories] = useState<any[]>([]);

    const isCameraActiveRef = useRef(false);
    const isScreenSharingRef = useRef(false);
    const showTelemetryPanelRef = useRef(false);
    showTelemetryPanelRef.current = showTelemetryPanel;
    const showDebianPanelRef = useRef(false);
    showDebianPanelRef.current = showDebianPanel;
    const showTerminalRef = useRef(false);
    showTerminalRef.current = showTerminal;
    const showNotesRef = useRef(false);
    showNotesRef.current = showNotes;
    const showProcessManagerRef = useRef(false);
    showProcessManagerRef.current = showProcessManager;
    const showCanvasRef = useRef(false);
    showCanvasRef.current = showCanvas;

    const sessionRef = useRef<LiveSession | null>(null);
    const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const videoStreamRef = useRef<MediaStream | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const audioWorkletRef = useRef<AudioWorkletNode | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const inputAudioContextRef2 = useRef<AudioContext | null>(null); // Backup ref for click handler
    const outputAudioContextRef2 = useRef<AudioContext | null>(null); // Backup ref for click handler
    const recordingDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
    const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const outputAnalyserRef = useRef<AnalyserNode | null>(null);
    const videoIntervalRef = useRef<number | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    const cameraZoomRef = useRef<number>(1);
    const additionalVideosRef = useRef<HTMLVideoElement[]>([]);
    
    // Offline recognition
    const recognitionRef = useRef<any>(null);

    // Move playback state to refs to survive re-renders and handle cleanup correctly
    const nextStartTimeRef = useRef<number>(0);
    const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

    // Global error handling to suppress benign WebSocket/HMR errors
    useEffect(() => {
        // Suppress Unhandled Rejection popups
        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            const message = event.reason?.message || String(event.reason);
            
            // Suppress benign WebSocket/HMR errors that might appear as popups
            if (
                message.includes('WebSocket closed without opened') || 
                message.includes('failed to connect to websocket') ||
                message.includes('CORS') || // These are already handled in app UI
                message.includes('network error') ||
                message.includes('Failed to fetch')
            ) {
                console.log('Nexus: Suppressed benign rejection:', message);
                event.preventDefault();
            }
        };

        window.addEventListener('unhandledrejection', handleUnhandledRejection);

        // Suppress actual console.error logs for Vite WebSocket
        const originalConsoleError = console.error;
        console.error = (...args) => {
            const msg = args.map(a => {
                if (a instanceof Error) return a.message;
                if (typeof a === 'object' && a !== null) {
                    try { return JSON.stringify(a) + (a.message || ''); } catch(e) { return String(a); }
                }
                return String(a);
            }).join(' ');
            
            if (msg.includes('[vite] failed to connect to websocket') || msg.includes('WebSocket closed without opened') || msg.includes('Failed to fetch')) {
                return; // suppress silently
            }
            originalConsoleError.apply(console, args);
        };

        return () => {
            window.removeEventListener('unhandledrejection', handleUnhandledRejection);
            console.error = originalConsoleError;
        };
    }, []);

    // Resume audio contexts on user interaction
    useEffect(() => {
        // Setup global nexus helper for tools
        (window as any).nexus = {
            createTool: (id: string, html: string, title: string = 'Herramienta') => {
                const container = document.getElementById('nexus-tools-container');
                if (!container) return null;
                
                const toolId = `nexus-tool-${id}`;
                let tool = document.getElementById(toolId);
                
                if (!tool) {
                    tool = document.createElement('div');
                    tool.id = toolId;
                    tool.className = 'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl min-w-[300px] pointer-events-auto animate-fade-in-up flex flex-col overflow-hidden';
                    
                    // Add header
                    const header = document.createElement('div');
                    header.className = 'bg-zinc-800 px-4 py-2 flex justify-between items-center cursor-move border-b border-zinc-700 select-none';
                    header.innerHTML = `
                        <span class="text-white font-bold text-sm">${title}</span>
                        <button onclick="window.nexus.removeTool('${id}')" class="text-zinc-400 hover:text-white transition-colors text-lg leading-none">&times;</button>
                    `;
                    
                    // Add content container
                    const content = document.createElement('div');
                    content.id = `${toolId}-content`;
                    content.className = 'p-4 text-white overflow-auto max-h-[80vh] custom-scrollbar';
                    
                    tool.appendChild(header);
                    tool.appendChild(content);
                    container.appendChild(tool);

                    // Make draggable
                    let isDragging = false;
                    let currentX = 0;
                    let currentY = 0;
                    let initialX = 0;
                    let initialY = 0;
                    let xOffset = 0;
                    let yOffset = 0;

                    header.addEventListener("mousedown", (e: MouseEvent) => {
                        initialX = e.clientX - xOffset;
                        initialY = e.clientY - yOffset;
                        isDragging = true;
                    });

                    document.addEventListener("mouseup", () => {
                        initialX = currentX;
                        initialY = currentY;
                        isDragging = false;
                    });

                    document.addEventListener("mousemove", (e: MouseEvent) => {
                        if (isDragging) {
                            e.preventDefault();
                            currentX = e.clientX - initialX;
                            currentY = e.clientY - initialY;
                            xOffset = currentX;
                            yOffset = currentY;
                            if (tool) {
                                tool.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px))`;
                            }
                        }
                    });
                }
                
                const content = document.getElementById(`${toolId}-content`);
                if (content) {
                    content.innerHTML = html;
                }
                return content;
            },
            getTool: (id: string) => {
                return document.getElementById(`nexus-tool-${id}-content`);
            },
            getToolElement: (id: string) => {
                return document.getElementById(`nexus-tool-${id}`);
            },
            removeTool: (id: string) => {
                const tool = document.getElementById(`nexus-tool-${id}`);
                if (tool) tool.remove();
            },
            clearTools: () => {
                const container = document.getElementById('nexus-tools-container');
                if (container) container.innerHTML = '';
            },
            listTools: () => {
                const container = document.getElementById('nexus-tools-container');
                if (!container) return [];
                const tools = Array.from(container.children);
                return tools.map(tool => {
                    const id = tool.id.replace('nexus-tool-', '');
                    const titleElement = tool.querySelector('.text-white.font-bold.text-sm');
                    const title = titleElement ? titleElement.textContent : 'Herramienta';
                    return { id, title };
                });
            },
            // Nexus vision/audio controls exposed to window.nexus
            toggleCamera: (active: boolean, facingMode: 'user' | 'environment' = 'user') => {
                if (active) return startCamera(facingMode);
                stopCamera();
                return Promise.resolve(true);
            },
            toggleScreenShare: (active: boolean) => {
                if (active) return startScreenShare();
                stopScreenShare();
                return Promise.resolve(true);
            },
            addScreenShare: async () => {
                try {
                    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" } as any, audio: false });
                    stream.getVideoTracks()[0].onended = () => {
                        const idx = additionalVideosRef.current.findIndex(v => v.srcObject === stream);
                        if (idx !== -1) {
                            additionalVideosRef.current[idx].remove();
                            additionalVideosRef.current.splice(idx, 1);
                        }
                    };
                    const video = document.createElement('video');
                    video.srcObject = stream;
                    video.autoplay = true;
                    video.playsInline = true;
                    video.muted = true;
                    additionalVideosRef.current.push(video);
                    await video.play();
                    return "Pantalla adicional añadida correctamente.";
                } catch (e) {
                    console.error("Error adding screen share:", e);
                    return "Error al añadir pantalla adicional. Quizás se canceló el diálogo.";
                }
            },
            setCameraZoom: (level: number) => {
                const safeZoom = Math.max(1, Math.min(10, level));
                cameraZoomRef.current = safeZoom;
                if (videoRef.current) {
                    videoRef.current.style.transform = `scale(${safeZoom})`;
                }
                return safeZoom;
            },
            startVideoRecording: () => startRecording(),
            stopVideoRecording: () => stopRecording(),
            toggleCanvas: (show: boolean) => {
                setShowCanvas(show);
                return `Canvas ${show ? 'activado' : 'desactivado'}.`;
            },
            toggleTelemetry: (show: boolean) => {
                setShowTelemetryPanel(show);
                return `Panel de telemetría ${show ? 'activado' : 'desactivado'}.`;
            },
            showTelemetry: () => {
                setShowTelemetryPanel(true);
                return "Panel de telemetría en tiempo real mostrado.";
            },
            hideTelemetry: () => {
                setShowTelemetryPanel(false);
                return "Panel de telemetría cerrado.";
            },
            toggleDebianInstall: (show: boolean) => {
                setShowDebianPanel(show);
                return `Panel de instalación en Debian ${show ? 'mostrado' : 'ocultado'}.`;
            },
            showDebianInstall: () => {
                setShowDebianPanel(true);
                return "Panel con todos los comandos de instalación en Debian mostrado.";
            },
            hideDebianInstall: () => {
                setShowDebianPanel(false);
                return "Panel de instalación en Debian cerrado.";
            },
            openApp: (appId: string, params?: string) => {
                const id = (appId || '').toLowerCase().trim();
                if (id === 'telemetry' || id === 'hardware' || id === 'rendimiento') {
                    setShowTelemetryPanel(true);
                    return "Panel de telemetría de hardware abierto.";
                } else if (id === 'debian_install' || id === 'debian' || id === 'kali' || id === 'instalador' || id === 'linux') {
                    setShowDebianPanel(true);
                    return "Panel de instalación de paquete (.deb) para Debian y Kali Linux abierto.";
                } else if (id === 'terminal' || id === 'consola' || id === 'shell') {
                    if (params) setTerminalInitialCmd(params);
                    setShowTerminal(true);
                    return "Terminal interactiva del sistema Nexus abierta.";
                } else if (id === 'notes' || id === 'notas' || id === 'notepad' || id === 'bloc') {
                    if (params) setNotesInitialContent(params);
                    setShowNotes(true);
                    return "Bloc de notas del sistema abierto.";
                } else if (id === 'process_manager' || id === 'procesos' || id === 'tareas') {
                    setShowProcessManager(true);
                    return "Administrador de procesos del sistema abierto.";
                } else if (id === 'canvas' || id === 'pizarra' || id === 'dibujo') {
                    setShowCanvas(true);
                    return "Pizarra gráfica interactiva abierta.";
                } else if (id === 'camera' || id === 'camara' || id === 'ojos') {
                    startCamera('environment');
                    return "Sensor óptico / cámara activado.";
                } else if (id === 'screen' || id === 'pantalla') {
                    startScreenShare();
                    return "Compartición de pantalla iniciada.";
                } else if (id === 'spotify') {
                    window.open('spotify:', '_self');
                    return "Lanzando Spotify en el sistema...";
                } else if (id === 'vscode' || id === 'code') {
                    window.open('vscode:', '_self');
                    return "Lanzando Visual Studio Code en el sistema...";
                } else if (id === 'calc' || id === 'calculator' || id === 'calculadora') {
                    window.open('calculator:', '_self');
                    return "Lanzando calculadora del sistema...";
                } else if (id === 'mail' || id === 'correo') {
                    window.open(`mailto:${params || ''}`, '_self');
                    return "Abriendo cliente de correo del sistema...";
                } else if (id === 'calendar' || id === 'calendario') {
                    window.open('webcal:', '_self');
                    return "Abriendo calendario del sistema...";
                } else {
                    if (id.startsWith('http://') || id.startsWith('https://')) {
                        window.open(id, '_blank', 'noopener,noreferrer');
                        return `Abriendo aplicación web: ${id}`;
                    }
                    setShowTerminal(true);
                    return `Aplicación '${id}' no reconocida directamente. He abierto la terminal del sistema para que puedas gestionarla.`;
                }
            },
            closeApp: (appId: string) => {
                const id = (appId || '').toLowerCase().trim();
                if (id === 'telemetry' || id === 'hardware' || id === 'rendimiento') {
                    setShowTelemetryPanel(false);
                    return "Panel de telemetría cerrado.";
                } else if (id === 'debian_install' || id === 'debian' || id === 'kali' || id === 'instalador' || id === 'linux') {
                    setShowDebianPanel(false);
                    return "Panel de instalación en Debian y Kali Linux cerrado.";
                } else if (id === 'terminal' || id === 'consola' || id === 'shell') {
                    setShowTerminal(false);
                    return "Terminal del sistema cerrada.";
                } else if (id === 'notes' || id === 'notas' || id === 'notepad' || id === 'bloc') {
                    setShowNotes(false);
                    return "Bloc de notas cerrado.";
                } else if (id === 'process_manager' || id === 'procesos' || id === 'tareas') {
                    setShowProcessManager(false);
                    return "Administrador de procesos cerrado.";
                } else if (id === 'canvas' || id === 'pizarra' || id === 'dibujo') {
                    setShowCanvas(false);
                    return "Pizarra gráfica cerrada.";
                } else if (id === 'camera' || id === 'camara') {
                    stopCamera();
                    return "Cámara desactivada.";
                } else if (id === 'screen' || id === 'pantalla') {
                    stopScreenShare();
                    return "Compartición de pantalla detenida.";
                } else {
                    return `Aplicación '${id}' no encontrada o no se puede cerrar desde el navegador.`;
                }
            },
            listApps: () => {
                return [
                    { id: 'telemetry', name: 'Monitor de Telemetría', description: 'Consumo CPU, RAM y red en tiempo real', isOpen: showTelemetryPanelRef.current },
                    { id: 'debian_install', name: 'Instalador Debian Linux', description: 'Comandos y script para instalar Nexus en Debian', isOpen: showDebianPanelRef.current },
                    { id: 'terminal', name: 'Terminal de Comandos', description: 'Consola interactiva bash del sistema', isOpen: showTerminalRef.current },
                    { id: 'notes', name: 'Bloc de Notas', description: 'Editor persistente de notas del sistema', isOpen: showNotesRef.current },
                    { id: 'process_manager', name: 'Gestor de Procesos', description: 'Administrador de tareas y módulos', isOpen: showProcessManagerRef.current },
                    { id: 'canvas', name: 'Pizarra Gráfica', description: 'Lienzo de dibujo interactivo', isOpen: showCanvasRef.current },
                    { id: 'camera', name: 'Cámara / Visión', description: 'Sensor óptico y ojos de Nexus', isOpen: isCameraActiveRef.current },
                    { id: 'screen', name: 'Captura de Pantalla', description: 'Compartición de pantallas del sistema', isOpen: isScreenSharingRef.current }
                ];
            },
            changeVoice: (_voiceName?: string) => {
                resetToDefaultNexusVoice();
                return `La voz de Nexus está bloqueada permanentemente en su voz predeterminada (${DEFAULT_NEXUS_VOICE}).`;
            },
            resetVoice: () => {
                resetToDefaultNexusVoice();
                return `Voz de Nexus fijada en su voz predeterminada (${DEFAULT_NEXUS_VOICE}).`;
            },
            getVoice: () => {
                return DEFAULT_NEXUS_VOICE;
            },
            getDisplayInfo: async () => {
                try {
                    if ('getScreenDetails' in window) {
                        const details = await (window as any).getScreenDetails();
                        return details.screens.map((s: any) => ({
                            label: s.label || 'Pantalla',
                            width: s.width,
                            height: s.height,
                            isPrimary: s.isPrimary,
                            isInternal: s.isInternal,
                            devicePixelRatio: s.devicePixelRatio
                        }));
                    }
                    // Fallback to basic screen info
                    return [{
                        label: 'Pantalla principal',
                        width: window.screen.width,
                        height: window.screen.height,
                        isPrimary: true
                    }];
                } catch (e) {
                    console.error("Error getting display info:", e);
                    return "Error al obtener info de pantallas. Puede que necesites dar permisos de 'Gestión de ventanas'.";
                }
            },
            speak: (text: string, lang = 'es-ES') => {
                if ('speechSynthesis' in window) {
                    window.speechSynthesis.cancel(); // Stop talking first
                    const utterance = new SpeechSynthesisUtterance(text);
                    utterance.lang = lang;
                    const voices = window.speechSynthesis.getVoices();
                    const defaultSpanishVoice =
                        voices.find(v => v.lang === 'es-ES' && v.default) ||
                        voices.find(v => v.lang === 'es-ES') ||
                        voices.find(v => v.lang.startsWith('es'));
                    if (defaultSpanishVoice) {
                        utterance.voice = defaultSpanishVoice;
                    }
                    utterance.rate = 1.0;
                    utterance.pitch = 1.0;
                    utterance.onstart = () => {
                        setNexusStatus('SPEAKING');
                    };
                    utterance.onend = () => {
                        setNexusStatus('LISTENING');
                    };
                    utterance.onerror = () => {
                        setNexusStatus('LISTENING');
                    };
                    window.speechSynthesis.speak(utterance);
                    return "Hablando usando hardware local.";
                }
                return "speechSynthesis no soportado.";
            },
            stopSpeaking: () => {
                if ('speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                }
            }
        };

        const resumeAudio = () => {
            if (inputAudioContextRef.current && inputAudioContextRef.current.state === 'suspended') {
                inputAudioContextRef.current.resume();
            }
            if (outputAudioContextRef.current && outputAudioContextRef.current.state === 'suspended') {
                outputAudioContextRef.current.resume();
            }
        };
        window.addEventListener('click', resumeAudio);
        window.addEventListener('touchstart', resumeAudio);
        return () => {
            window.removeEventListener('click', resumeAudio);
            window.removeEventListener('touchstart', resumeAudio);
        };
    }, []);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    }, []);

    const startRecording = useCallback(() => {
        if (!videoStreamRef.current) return;
        try {
            // Combine video and audio for recording
            const recordingStream = new MediaStream();
            
            // Add video tracks
            videoStreamRef.current.getVideoTracks().forEach(track => {
                recordingStream.addTrack(track);
            });
            
            // Add mixed audio track (AI + Mic) if available, or fallback to direct mic stream
            if (recordingDestinationRef.current && recordingDestinationRef.current.stream.getAudioTracks().length > 0) {
                recordingDestinationRef.current.stream.getAudioTracks().forEach(track => {
                    recordingStream.addTrack(track);
                });
            } else if (streamRef.current && streamRef.current.getAudioTracks().length > 0) {
                streamRef.current.getAudioTracks().forEach(track => {
                    recordingStream.addTrack(track);
                });
            }

            let options: any = { mimeType: 'video/webm' };
            if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
                options = { mimeType: 'video/webm; codecs=vp9' };
            } else if (MediaRecorder.isTypeSupported('video/webm')) {
                options = { mimeType: 'video/webm' };
            } else if (MediaRecorder.isTypeSupported('video/mp4; codecs=avc1')) {
                options = { mimeType: 'video/mp4; codecs=avc1' };
            } else if (MediaRecorder.isTypeSupported('video/mp4')) {
                options = { mimeType: 'video/mp4' };
            } else {
                options = {}; // Let browser choose default
            }

            const recorder = new MediaRecorder(recordingStream, options);
            recordedChunksRef.current = [];
            
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedChunksRef.current.push(event.data);
                }
            };

            recorder.onstop = () => {
                const type = options.mimeType || 'video/mp4';
                const extension = type.includes('webm') ? 'webm' : 'mp4';
                const blob = new Blob(recordedChunksRef.current, { type });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                document.body.appendChild(a);
                a.style.display = 'none';
                a.href = url;
                a.download = `nexus-recording-${new Date().toISOString()}.${extension}`;
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                recordedChunksRef.current = [];
            };

            recorder.start();
            mediaRecorderRef.current = recorder;
            setIsRecording(true);
        } catch (e) {
            console.error("Error starting recording:", e);
        }
    }, [stopRecording]);

    // Expose control methods to window so executeDynamicCode can use them
    useEffect(() => {
        (window as any).startVideoRecording = startRecording;
        (window as any).stopVideoRecording = stopRecording;
        return () => {
            delete (window as any).startVideoRecording;
            delete (window as any).stopVideoRecording;
        }
    }, [startRecording, stopRecording]);

    const stopCamera = useCallback(() => {
        stopRecording(); // Ensure recording stops if camera stops
        if (videoIntervalRef.current) {
            window.clearInterval(videoIntervalRef.current);
            videoIntervalRef.current = null;
        }
        if (videoStreamRef.current) {
            videoStreamRef.current.getTracks().forEach(track => track.stop());
            videoStreamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
            videoRef.current.style.transform = '';
        }
        cameraZoomRef.current = 1;
        isCameraActiveRef.current = false;
        setIsCameraActive(false);
    }, [stopRecording]);

    const startCamera = useCallback(async (facingMode: 'user' | 'environment' = 'user') => {
        try {
            if (isScreenSharingRef.current && videoStreamRef.current) {
                videoStreamRef.current.getTracks().forEach(track => track.stop());
                videoStreamRef.current = null;
                isScreenSharingRef.current = false;
                setIsScreenSharing(false);
            }
            // Stop existing stream if any
            if (videoStreamRef.current) {
                videoStreamRef.current.getTracks().forEach(track => track.stop());
            }

            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: facingMode === 'environment' ? 'environment' : 'user'
                }
            });
            videoStreamRef.current = stream;
            isCameraActiveRef.current = true;
            setIsCameraActive(true);
            return true;
        } catch (e: any) {
            console.warn("Error accessing camera:", e);
            // Fallback to user camera if environment fails
            if (facingMode === 'environment') {
                try {
                    console.log("Retrying with user camera...");
                    const stream = await navigator.mediaDevices.getUserMedia({ 
                        video: { 
                            facingMode: 'user'
                        }
                    });
                    videoStreamRef.current = stream;
                    isCameraActiveRef.current = true;
                    setIsCameraActive(true);
                    return true;
                } catch (e2: any) {
                    console.error("Retry failed:", e2);
                    setLastError(`No pude acceder a la cámara: ${e2.message || 'Denegado'}`);
                    return false;
                }
            }
            setLastError(`No pude acceder a la cámara: ${e.message || 'Denegado'}`);
            return false;
        }
    }, []);

    const stopScreenShare = useCallback(() => {
        if (videoIntervalRef.current) {
            window.clearInterval(videoIntervalRef.current);
            videoIntervalRef.current = null;
        }
        if (videoStreamRef.current) {
            videoStreamRef.current.getTracks().forEach(track => track.stop());
            videoStreamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
            videoRef.current.style.transform = '';
        }
        cameraZoomRef.current = 1;
        isScreenSharingRef.current = false;
        setIsScreenSharing(false);
        additionalVideosRef.current.forEach(video => {
            if (video.srcObject) {
                (video.srcObject as MediaStream).getTracks().forEach(track => track.stop());
            }
            video.remove();
        });
        additionalVideosRef.current = [];
    }, []);

    const startScreenShare = useCallback(async (): Promise<boolean | 'prompted'> => {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                setLastError("Lo siento, tu dispositivo o navegador no soporta compartir pantalla.");
                return false;
            }
            if (isCameraActiveRef.current) stopCamera();

            let stream = screenStreamRef.current;
            
            // If we don't have a stream or it's inactive, try to request it again
            if (!stream || !stream.active) {
                stream = await navigator.mediaDevices.getDisplayMedia({ 
                    video: { 
                        cursor: "always" 
                    } as any,
                    audio: false 
                });
                screenStreamRef.current = stream;
            }
            
            stream.getVideoTracks()[0].onended = () => {
                stopScreenShare();
            };

            videoStreamRef.current = stream;
            isScreenSharingRef.current = true;
            setIsScreenSharing(true);
            return true;
        } catch (e: any) {
            console.warn("Error sharing screen:", e);
            if (e.name === 'NotAllowedError' || e.name === 'InvalidStateError') {
                setShowScreenSharePrompt(true);
                return 'prompted';
            } else if (e.name !== 'AbortError') {
                setLastError(e.message || "No pude compartir la pantalla.");
            } else {
                console.log("User cancelled screen share");
            }
            return false;
        }
    }, [stopCamera, stopScreenShare]);

    // Effect to attach video stream when camera becomes active and video ref is ready
    useEffect(() => {
        const active = isCameraActive || isScreenSharing;
        if (active && videoStreamRef.current && videoRef.current) {
            console.log("Attaching stream to video element...", videoStreamRef.current.id);
            videoRef.current.srcObject = videoStreamRef.current;
            
            const playVideo = async () => {
                try {
                    if (videoRef.current) {
                        await videoRef.current.play();
                        console.log("Video playing successfully.");
                    }
                } catch (e) {
                    console.error("Error playing video:", e);
                }
            };
            playVideo();

            const sendFrame = () => {
                if (!sessionPromiseRef.current || !videoRef.current || !canvasRef.current) return;
                
                // Check if video is ready
                if (videoRef.current.readyState < 2) { 
                    return;
                }

                const context = canvasRef.current.getContext('2d');
                if (!context) return;

                const isScreen = isScreenSharingRef.current;
                const canvasW = isScreen ? 1280 : 320;
                const canvasH = isScreen ? 720 : 240;

                canvasRef.current.width = canvasW;
                canvasRef.current.height = canvasH;
                
                const numVideos = isScreen ? 1 + additionalVideosRef.current.length : 1;
                
                if (numVideos === 1) {
                    const zoom = cameraZoomRef.current;
                    if (zoom > 1 && isCameraActiveRef.current) {
                        const sw = videoRef.current.videoWidth / zoom;
                        const sh = videoRef.current.videoHeight / zoom;
                        const sx = (videoRef.current.videoWidth - sw) / 2;
                        const sy = (videoRef.current.videoHeight - sh) / 2;
                        context.drawImage(videoRef.current, sx, sy, sw, sh, 0, 0, canvasW, canvasH);
                    } else {
                        context.drawImage(videoRef.current, 0, 0, canvasW, canvasH);
                    }
                } else {
                    context.fillStyle = "black";
                    context.fillRect(0, 0, canvasW, canvasH);
                    
                    const cols = Math.ceil(Math.sqrt(numVideos));
                    const rows = Math.ceil(numVideos / cols);
                    const cellW = canvasW / cols;
                    const cellH = canvasH / rows;
                    
                    const drawCell = (v: HTMLVideoElement, index: number) => {
                        const col = index % cols;
                        const row = Math.floor(index / cols);
                        const x = col * cellW;
                        const y = row * cellH;
                        context.drawImage(v, x, y, cellW, cellH);
                    };
                    
                    drawCell(videoRef.current, 0);
                    additionalVideosRef.current.forEach((v, index) => {
                        if (v.readyState >= 2) {
                            drawCell(v, index + 1);
                        }
                    });
                }
                
                const quality = isScreen ? 0.7 : 0.5;
                const base64data = canvasRef.current.toDataURL('image/jpeg', quality).split(',')[1];
                if (sessionPromiseRef.current) {
                     sessionPromiseRef.current.then(session => {
                         try {
                             session.sendRealtimeInput({
                                video: {
                                    mimeType: 'image/jpeg',
                                    data: base64data
                                }
                            });
                         } catch (e) {
                             console.error("sendRealtimeInput video error:", e);
                         }
                     }).catch(e => {
                         console.error("sessionPromise for video error:", e);
                     });
                }
            };

            // Start sending frames
            if (videoIntervalRef.current) {
                clearInterval(videoIntervalRef.current);
            }
            
            // Listen for when the video actually has data
            const onCanPlay = () => {
                // Send first frame immediately
                sendFrame();
            };
            videoRef.current.addEventListener('canplay', onCanPlay, { once: true });
            
            // Then send every 1 second
            videoIntervalRef.current = window.setInterval(sendFrame, 1000);
        } else {
             if (videoIntervalRef.current) {
                clearInterval(videoIntervalRef.current);
                videoIntervalRef.current = null;
            }
        }
    }, [isCameraActive, isScreenSharing]);

    const handleDisconnect = useCallback(() => {
        stopCamera();
        stopScreenShare();
        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then(session => {
                try { session.close(); } catch(e) {}
            }).catch(() => {});
            sessionPromiseRef.current = null;
        }
        sessionRef.current = null;
        if (audioWorkletRef.current) {
            audioWorkletRef.current.disconnect();
            audioWorkletRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (inputAudioContextRef.current) {
            try { inputAudioContextRef.current.close(); } catch(e) {}
            inputAudioContextRef.current = null;
        }
        if (outputAudioContextRef.current) {
            try { outputAudioContextRef.current.close(); } catch(e) {}
            outputAudioContextRef.current = null;
        }
        
        // Stop all playing audio
        sourcesRef.current.forEach(source => {
            try { source.stop(); } catch(e) {}
        });
        sourcesRef.current.clear();
        nextStartTimeRef.current = 0;

        setNexusStatus('OFFLINE');
        console.log('Desconectado.');
    }, [stopCamera, stopScreenShare]);
    
    const handleMessage = useCallback(async (message: LiveServerMessage) => {
        if (message.goAway !== undefined) {
            console.log('GoAway received, forcing reconnect...');
            window.dispatchEvent(new CustomEvent('nexus-reconnect'));
            return;
        }

        if (message.serverContent) {
            const { outputTranscription, interrupted, modelTurn } = message.serverContent;

            const inputTranscriptionText = (message.serverContent as any).inputAudioTranscription?.text || (message.serverContent as any).inputTranscription?.text;
            if (inputTranscriptionText) {
                saveTranscript(inputTranscriptionText, 'user');
            }

            if(outputTranscription?.text) {
                setNexusStatus('SPEAKING');
                saveTranscript(outputTranscription.text, 'model');
            }

            if (modelTurn?.parts) {
                for (const part of modelTurn.parts) {
                    const base64Audio = part.inlineData?.data;
                    if (base64Audio) {
                        const outputAudioContext = outputAudioContextRef.current;
                        const analyser = outputAnalyserRef.current;
                        if (!outputAudioContext || !analyser) continue;

                        setNexusStatus('SPEAKING');
                        
                        // Ensure context is running
                        if (outputAudioContext.state === 'suspended') {
                            await outputAudioContext.resume();
                        }

                        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContext.currentTime);
                        try {
                            const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContext, 24000, 1);
                            
                            const source = outputAudioContext.createBufferSource();
                            source.buffer = audioBuffer;
                            
                            source.connect(analyser);

                            source.addEventListener('ended', () => {
                                sourcesRef.current.delete(source);
                                if (sourcesRef.current.size === 0) {
                                    setNexusStatus('LISTENING');
                                }
                            });
                            source.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += audioBuffer.duration;
                            sourcesRef.current.add(source);
                        } catch (e) {
                            console.error("Error decoding audio:", e);
                        }
                    }
                }
            }
            
            if (interrupted) {
                sourcesRef.current.forEach(source => {
                    try { source.stop(); } catch(e) {}
                });
                sourcesRef.current.clear();
                nextStartTimeRef.current = 0;
                setNexusStatus('LISTENING');
            }
        }
        
        if (message.toolCall) {
            for (const fc of message.toolCall.functionCalls) {
                setNexusStatus('THINKING');
                let result = '';
                try {
                    if (fc.name === NexusFunctionDeclarations.browserControl.name) {
                        const action = fc.args.action as string;
                        const value = fc.args.value as string;
                        const text = fc.args.text as string;
                        
                        if (action === 'navigate' || action === 'openTab') {
                            const url = value.startsWith('http') ? value : `https://${value}`;
                            const newWindow = window.open(url, '_blank', 'noopener,noreferrer');
                            if (newWindow) {
                                result = `Navegando a: ${url}`;
                            } else {
                                result = `El navegador bloqueó la ventana emergente a ${url}. Por favor, permite popups para este sitio o haz clic en el enlace que aparecerá en pantalla.`;
                                // Podríamos añadir un estado para mostrar un botón manual aquí si fuera necesario, 
                                // pero por ahora el mensaje de error es informativo para Nexus.
                                setLastError(`Nexus intentó abrir ${url} pero fue bloqueado. Revisa la barra de direcciones.`);
                            }
                        } else if (action === 'inputText') {
                            let element = document.querySelector(value) as HTMLInputElement | HTMLTextAreaElement;
                            if (!element) {
                                // Try finding by placeholder or aria-label
                                element = document.querySelector(`input[placeholder="${value}"], textarea[placeholder="${value}"], input[aria-label="${value}"], textarea[aria-label="${value}"]`) as HTMLInputElement;
                            }
                            if (element) {
                                // React/Vue input handling hack
                                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
                                const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
                                
                                if (element.tagName === 'INPUT' && nativeInputValueSetter) {
                                    nativeInputValueSetter.call(element, text || '');
                                } else if (element.tagName === 'TEXTAREA' && nativeTextAreaValueSetter) {
                                    nativeTextAreaValueSetter.call(element, text || '');
                                } else {
                                    element.value = text || '';
                                }
                                
                                element.dispatchEvent(new Event('input', { bubbles: true }));
                                element.dispatchEvent(new Event('change', { bubbles: true }));
                                element.focus(); // Ensure focus
                                result = `Texto escrito en campo: ${value}`;
                            } else {
                                result = `No encontré el campo para escribir: ${value}`;
                            }
                        } else if (action === 'click') {
                            let element = document.querySelector(value) as HTMLElement;
                            
                            if (!element) {
                                const targets = Array.from(document.querySelectorAll('button, a, input, [role="button"], span, div, h1, h2, h3, h4, h5, h6, p, label, li, td, th'));
                                const lowerValue = value.toLowerCase().trim();
                                
                                // Priority search strategy
                                element = targets.find(el => (el as HTMLElement).innerText?.toLowerCase().trim() === lowerValue) as HTMLElement ||
                                          targets.find(el => el.getAttribute('aria-label')?.toLowerCase().trim() === lowerValue) as HTMLElement ||
                                          targets.find(el => el.getAttribute('title')?.toLowerCase().trim() === lowerValue) as HTMLElement ||
                                          targets.find(el => (el as HTMLElement).innerText?.toLowerCase().includes(lowerValue)) as HTMLElement;
                            }

                            if (element) {
                                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                element.focus();
                                // Try multiple click methods
                                element.click();
                                element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                                element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                                result = `Clic realizado en: ${value}`;
                            } else {
                                result = `No encontré el elemento para hacer clic: ${value}`;
                            }
                        } else if (action === 'read') {
                            const element = document.querySelector(value || 'body') as HTMLElement;
                            if (element) {
                                // Clean up text to make it more readable for Gemini
                                const rawText = element.innerText;
                                const cleanText = rawText.replace(/\s+/g, ' ').substring(0, 5000); // Increased limit for better context
                                result = `Contenido leído: ${cleanText}...`; 
                            } else {
                                result = "No pude leer el contenido de la página.";
                            }
                        } else if (action === 'scrollUp') {
                            window.scrollBy({ top: -(parseInt(value) || window.innerHeight / 2), behavior: 'smooth' });
                            result = "Subiendo página.";
                        } else if (action === 'scrollDown') {
                            window.scrollBy({ top: (parseInt(value) || window.innerHeight / 2), behavior: 'smooth' });
                            result = "Bajando página.";
                        } else if (action === 'scrollTop') {
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                            result = "Volviendo al inicio.";
                        } else if (action === 'scrollBottom') {
                            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                            result = "Yendo al final.";
                        } else if (action === 'zoomIn') {
                            // Use CSS transform for better compatibility
                            const currentScale = parseFloat(document.body.getAttribute('data-scale') || '1');
                            const newScale = currentScale + 0.1;
                            document.body.style.transform = `scale(${newScale})`;
                            document.body.style.transformOrigin = 'top center';
                            document.body.setAttribute('data-scale', newScale.toString());
                            result = `Zoom aumentado a ${(newScale * 100).toFixed(0)}%`;
                        } else if (action === 'zoomOut') {
                            const currentScale = parseFloat(document.body.getAttribute('data-scale') || '1');
                            const newScale = Math.max(0.5, currentScale - 0.1);
                            document.body.style.transform = `scale(${newScale})`;
                            document.body.style.transformOrigin = 'top center';
                            document.body.setAttribute('data-scale', newScale.toString());
                            result = `Zoom reducido a ${(newScale * 100).toFixed(0)}%`;
                        } else if (action === 'setZoom') {
                             if (value === 'reset' || value === '100') {
                                document.body.style.transform = '';
                                document.body.removeAttribute('data-scale');
                                result = "Zoom restablecido.";
                             } else {
                                const level = parseFloat(value);
                                if (!isNaN(level)) {
                                    const newScale = level > 10 ? level / 100 : level;
                                    document.body.style.transform = `scale(${newScale})`;
                                    document.body.style.transformOrigin = 'top center';
                                    document.body.setAttribute('data-scale', newScale.toString());
                                    result = `Zoom ajustado al ${(newScale * 100).toFixed(0)}%.`;
                                } else {
                                    result = "Valor de zoom inválido. Usa un número (ej: 150) o 'reset'.";
                                }
                             }
                        } else if (action === 'closeTab') {
                            // Only works for scripts-opened windows, but we can try
                            window.close();
                            result = "Intenté cerrar la pestaña (el navegador puede bloquearlo si no la abrí yo).";
                        } else if (action === 'reload') {
                            window.location.reload();
                            result = "Recargando página...";
                        } else if (action === 'goBack') {
                            window.history.back();
                            result = "Navegando atrás.";
                        } else if (action === 'goForward') {
                            window.history.forward();
                            result = "Navegando adelante.";
                        } else if (action === 'copy') {
                            try {
                                await navigator.clipboard.writeText(value);
                                result = "Texto copiado al portapapeles.";
                            } catch (err) {
                                result = "Error al copiar (necesito permiso o foco en la ventana).";
                            }
                        } else if (action === 'print') {
                            window.print();
                            result = "Abriendo diálogo de impresión.";
                        } else {
                            result = `Acción de navegador desconocida: ${action}`;
                        }
                    } else if (fc.name === NexusFunctionDeclarations.performComplexTask.name) {
                        result = await performComplexTask(fc.args.query as string);
                    } else if (fc.name === NexusFunctionDeclarations.makeHttpRequest.name) {
                        try {
                            const method = fc.args.method as string || 'GET';
                            const url = fc.args.url as string;
                            const headersRaw = fc.args.headers as string;
                            const body = fc.args.body as string;

                            const options: RequestInit = {
                                method: method.toUpperCase(),
                            };

                            if (headersRaw) {
                                try {
                                    options.headers = JSON.parse(headersRaw);
                                } catch (e) {
                                    options.headers = undefined;
                                }
                            }

                            if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
                                options.body = body;
                            }

                            const response = await fetch(url, options);
                            const text = await response.text();

                            let parsedData = text;
                            try {
                                if (text) parsedData = JSON.parse(text);
                            } catch(e) {}

                            result = JSON.stringify({
                                status: response.status,
                                statusText: response.statusText,
                                data: parsedData
                            });
                        } catch (error: any) {
                            result = `Error HTTP a ${fc.args.url}: ${error.message}. Posible problema de CORS o dispositivo inalcanzable.`;
                        }
                    } else if (fc.name === NexusFunctionDeclarations.getWebSearchResult.name) {
                         result = await getWebSearchResult(fc.args.query as string);
                    } else if (fc.name === NexusFunctionDeclarations.generateImage.name) {
                        const imageUrl = await generateImage(fc.args.prompt as string);
                        if (imageUrl.startsWith('data:')) {
                            // Display the image using the dynamic tool system
                            const id = `img-${Date.now()}`;
                            const html = `<div style="padding: 10px; background: #fff; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);"><img src="${imageUrl}" style="max-width: 100%; border-radius: 4px;" alt="Generated Image" /></div>`;
                            (window as any).nexus.createTool(id, html);
                            result = `Imagen generada y mostrada en pantalla.`;
                        } else {
                            result = imageUrl;
                        }
                    } else if (fc.name === NexusFunctionDeclarations.executeDynamicCode.name) {
                        result = await executeDynamicCode(fc.args.code as string);
                    } else if (fc.name === NexusFunctionDeclarations.sendDesktopNotification?.name) {
                        const title = fc.args.title as string;
                        const body = fc.args.body as string;
                        
                        if ('Notification' in window && Notification.permission === 'granted') {
                            new Notification(title, { body });
                            result = 'Notificación enviada con éxito.';
                        } else if ('Notification' in window && Notification.permission !== 'denied') {
                            const permission = await Notification.requestPermission();
                            if (permission === 'granted') {
                                new Notification(title, { body });
                                result = 'Permiso concedido y notificación enviada con éxito.';
                            } else {
                                result = 'El usuario denegó el permiso para enviar notificaciones.';
                            }
                        } else {
                            result = 'Error: no se pueden enviar notificaciones (permiso denegado o no soportado).';
                        }
                    } else if (fc.name === NexusFunctionDeclarations.saveMemory.name) {
                        result = await saveMemoryToStorage(fc.args.fact as string, fc.args.category as string);
                        console.log("Memory saved:", fc.args.fact, fc.args.category);
                    } else if (fc.name === NexusFunctionDeclarations.retrieveMemories.name) {
                        const query = fc.args.query as string | undefined;
                        result = await getAllMemoriesFromStorage(query);
                    } else if (fc.name === 'changeVoice') {
                        resetToDefaultNexusVoice();
                        result = `Voz predeterminada (${DEFAULT_NEXUS_VOICE}) mantenida de forma permanente. Prohibido cambiar de voz.`;
                    } else if (fc.name === NexusFunctionDeclarations.toggleCanvas?.name) {
                        const show = fc.args.active as boolean;
                        setShowCanvas(show);
                        result = `Canvas ${show ? 'activado' : 'desactivado'}.`;
                    } else if (fc.name === NexusFunctionDeclarations.getDisplayInfo?.name) {
                        result = await (window as any).nexus.getDisplayInfo();
                    } else if (fc.name === NexusFunctionDeclarations.toggleCamera.name) {
                        const shouldBeActive = fc.args.active as boolean;
                        const mode = (fc.args.facingMode as 'user' | 'environment') || 'environment';
                        
                        if (shouldBeActive) {
                            const success = await startCamera(mode);
                            if (success) {
                                result = `Cámara activada (${mode === 'user' ? 'frontal' : 'trasera'}). OJO: A partir de este momento puedes ver a través de mis ojos (mi cámara).`;
                            } else {
                                result = `No pude activar la cámara. Posiblemente no tienes configurados los permisos correctamente, o el usuario los ha denegado.`;
                            }
                        } else {
                            stopCamera();
                            result = "Cámara desactivada.";
                        }
                    } else if (fc.name === NexusFunctionDeclarations.setCameraZoom?.name) {
                        const zoomLevel = fc.args.zoomLevel as number;
                        if (isCameraActiveRef.current && videoStreamRef.current) {
                            const safeZoom = Math.max(1, Math.min(10, zoomLevel));
                            cameraZoomRef.current = safeZoom;
                            
                            // Apply CSS transform to the video element so the user sees it too
                            if (videoRef.current) {
                                videoRef.current.style.transform = `scale(${safeZoom})`;
                                videoRef.current.style.transformOrigin = 'center center';
                                videoRef.current.style.transition = 'transform 0.3s ease-in-out';
                            }
                            
                            result = `Zoom ajustado a ${safeZoom}x.`;
                        } else {
                            result = "La cámara no está activa. Actívala primero.";
                        }
                    } else if (fc.name === NexusFunctionDeclarations.toggleScreenShare.name) {
                        const shouldBeActive = fc.args.active as boolean;
                        if (shouldBeActive) {
                            const success = await startScreenShare();
                            if (success === true) {
                                result = "Compartición de pantalla iniciada.";
                            } else {
                                if (success === 'prompted') {
                                    result = "Se requiere confirmación manual. He mostrado un cuadro de diálogo al usuario para que apruebe compartir la pantalla o abra la app en una pestaña nueva.";
                                } else {
                                    result = "No pude iniciar la compartición de pantalla. Puede que no esté soportado o que el usuario lo denegara.";
                                }
                            }
                        } else {
                            stopScreenShare();
                            result = "Compartición de pantalla detenida.";
                        }
                    } else if (fc.name === NexusFunctionDeclarations.startVideoRecording.name) {
                        if (isCameraActiveRef.current) {
                            startRecording();
                            result = "Grabación iniciada.";
                        } else {
                            result = "No puedo grabar porque la cámara está apagada. Pídeme que la active primero.";
                        }
                    } else if (fc.name === NexusFunctionDeclarations.stopVideoRecording.name) {
                        stopRecording();
                        result = "Grabación detenida y guardada.";
                    } else if (fc.name === NexusFunctionDeclarations.setReminder.name) {
                        const message = fc.args.message as string;
                        const delayMinutes = fc.args.delayMinutes as number;
                        
                        if (Notification.permission !== 'granted') {
                            await Notification.requestPermission();
                        }
                        
                        setTimeout(() => {
                            if (Notification.permission === 'granted') {
                                new Notification('Nexus Recordatorio', { body: message });
                            }
                            if ((window as any).nexus && (window as any).nexus.speak) {
                                (window as any).nexus.speak(`¡Oye Koko! Recordatorio: ${message}`);
                            }
                        }, delayMinutes * 60000);
                        
                        result = `Recordatorio configurado para dentro de ${delayMinutes} minutos.`;
                    } else if (fc.name === NexusFunctionDeclarations.manageCalendar.name) {
                        const action = fc.args.action as string;
                        const title = fc.args.title as string;
                        const date = fc.args.date as string;
                        
                        const calendar = JSON.parse(localStorage.getItem('nexus_calendar') || '[]');
                        
                        if (action === 'add') {
                            calendar.push({ title, date, id: Date.now() });
                            localStorage.setItem('nexus_calendar', JSON.stringify(calendar));
                            result = `Evento añadido: ${title} el ${date}`;
                        } else if (action === 'list') {
                            result = `Eventos actuales: ${JSON.stringify(calendar)}`;
                        } else if (action === 'delete') {
                            const initialLength = calendar.length;
                            const filtered = calendar.filter((e: any) => e.title !== title);
                            localStorage.setItem('nexus_calendar', JSON.stringify(filtered));
                            result = filtered.length < initialLength ? `Evento eliminado: ${title}` : `No se encontró el evento: ${title}`;
                        } else {
                            result = `Acción de calendario no válida: ${action}`;
                        }
                    } else if (fc.name === NexusFunctionDeclarations.smartHomeControl.name) {
                        const url = fc.args.url as string;
                        const method = fc.args.method as string;
                        const body = fc.args.body as string;
                        
                        try {
                            const opts: RequestInit = { method };
                            if (body) {
                                opts.body = body;
                                opts.headers = { 'Content-Type': 'application/json' };
                            }
                            const res = await fetch(url, opts);
                            const text = await res.text();
                            result = `Petición enviada. Status: ${res.status}. Respuesta: ${text.substring(0, 100)}`;
                        } catch (e: any) {
                            result = `Error al conectar con el dispositivo: ${e.message}. Asegúrate de que la URL es correcta y accesible (puede haber problemas de CORS).`;
                        }
                    } else if (fc.name === NexusFunctionDeclarations.cyberSecurityTool.name) {
                        const tool = fc.args.tool as string;
                        const action = fc.args.action as string;
                        const target = fc.args.target as string;
                        const options = fc.args.options as string;
                        result = await executeCyberSecurityTool(tool, action, target, options);
                    } else if (fc.name === NexusFunctionDeclarations.lmStudioControl.name) {
                        try {
                            const action = fc.args.action as string;
                            const modelId = fc.args.modelId as string;
                            const prompt = fc.args.prompt as string;
                            
                            // Get base URL from args, current state, or default
                            const rawInputUrl = (fc.args.baseUrl as string) || lmStudioUrl || 'http://localhost:1234';
                            
                            // Normalize URL
                            let baseUrl = rawInputUrl.trim();
                            if (!baseUrl.startsWith('http')) baseUrl = 'http://' + baseUrl;
                            baseUrl = baseUrl.replace(/\/$/, '');
                            const normalizedUrl = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`;

                            let fetchOptions: RequestInit = {
                                method: 'GET',
                                headers: {}
                            };
                            let url = `${normalizedUrl}/models`;

                            if (action === 'chat') {
                                // Auto-detect model if not provided
                                let selectedModel = modelId;
                                if (!selectedModel || selectedModel === 'local-model') {
                                    try {
                                        const mRes = await fetch(`${normalizedUrl}/models`, { signal: AbortSignal.timeout(1500) });
                                        if (mRes.ok) {
                                            const mData = await mRes.json();
                                            if (mData.data && mData.data.length > 0) {
                                                selectedModel = mData.data[0].id;
                                            }
                                        }
                                    } catch (e) {}
                                }

                                fetchOptions.method = 'POST';
                                fetchOptions.headers = { 'Content-Type': 'application/json' };
                                fetchOptions.body = JSON.stringify({
                                    model: selectedModel || 'local-model',
                                    messages: [{ role: 'user', content: prompt }]
                                });
                                url = `${normalizedUrl}/chat/completions`;
                            } else if (action === 'listDownloadedModels') {
                                url = `${baseUrl.replace(/\/v1$/, '')}/api/v0/models`;
                            } else if (action === 'loadModel') {
                                fetchOptions.method = 'POST';
                                fetchOptions.headers = { 'Content-Type': 'application/json' };
                                fetchOptions.body = JSON.stringify({ model: modelId });
                                url = `${normalizedUrl}/models`; 
                            } else if (action === 'unloadModel') {
                                fetchOptions.method = 'POST';
                                fetchOptions.headers = { 'Content-Type': 'application/json' };
                                fetchOptions.body = JSON.stringify({ model: modelId, action: 'unload' }); 
                                url = `${baseUrl.replace(/\/v1$/, '')}/api/v0/models/unload`;
                            }

                            try {
                                const res = await fetch(url, fetchOptions);
                                if (!res.ok) {
                                    if (action === 'listDownloadedModels' && res.status === 404) {
                                        const fallbackRes = await fetch(`${normalizedUrl}/models`);
                                        if (fallbackRes.ok) {
                                            const fbData = await fallbackRes.json();
                                            result = `Modelos en LM Studio: ${(fbData.data || []).map((m: any) => m.id).join(', ') || 'Ninguno cargado'}`;
                                        } else {
                                            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                                        }
                                    } else {
                                        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                                    }
                                } else {
                                    const data = await res.json();
                                    
                                    if (action === 'chat') {
                                        result = data.choices?.[0]?.message?.content || JSON.stringify(data);
                                    } else if (action === 'status') {
                                        const models = (data.data || []).map((m: any) => m.id).join(', ');
                                        result = `¡Conectada con éxito a LM Studio en ${normalizedUrl}! Modelos activos: ${models || 'ninguno detectado'}.`;
                                    } else if (action === 'listModels') {
                                        const models = (data.data || []).map((m: any) => m.id).join(', ');
                                        result = `Modelos disponibles en LM Studio: ${models || 'Ninguno'}`;
                                    } else {
                                        result = typeof data === 'string' ? data : JSON.stringify(data);
                                    }
                                }
                            } catch (e: any) {
                                let diagnosis = "Error de conexión con LM Studio.";
                                let solution = "";
                                
                                if (window.location.protocol === 'https:' && normalizedUrl.startsWith('http:')) {
                                    diagnosis = "Bloqueo por 'Contenido no seguro' (Mixed Content en navegador). Al estar en HTTPS, el navegador bloquea HTTP a localhost por seguridad.";
                                    solution = "\n💡 SOLUCIÓN DIRECTA:\n1. En Chrome o Edge, haz clic en el icono del candado o ajustes (a la izquierda de la URL).\n2. Selecciona 'Configuración de sitios' (Site settings).\n3. Busca 'Contenido no seguro' (Insecure content) y cámbialo a 'Permitir' (Allow).\n4. Recarga la página y ¡listo!\n(También asegúrate de que en LM Studio el botón 'Start Server' esté verde y con CORS activado).";
                                } else if (e.message?.includes('Failed to fetch') || e.name === 'TypeError') {
                                    diagnosis = "Servidor inalcanzable o CORS bloqueado.";
                                    solution = "\n1. Abre LM Studio -> Local Server.\n2. Asegúrate de activar 'Allow Cross-Origin Resource Sharing (CORS)'.\n3. Pulsa 'Start Server' en puerto 1234.";
                                }
                                
                                result = `Nexus no pudo conectar con LM Studio (${normalizedUrl}).\n\nMOTIVO: ${diagnosis}\n${solution}\n\nDetalle técnico: ${e.message}`;
                            }
                        } catch (e: any) {
                            result = `Error inesperado con LM Studio: ${e.message}`;
                        }
                    } else if (fc.name === NexusFunctionDeclarations.ollamaControl.name) {
                        try {
                            const action = fc.args.action as string;
                            const modelId = fc.args.modelId as string;
                            const prompt = fc.args.prompt as string;
                            let baseUrl = (fc.args.baseUrl as string) || ollamaUrl || 'http://localhost:11434';
                            
                            // Normalize URL
                            if (!baseUrl.startsWith('http')) baseUrl = 'http://' + baseUrl;
                            baseUrl = baseUrl.replace(/\/$/, '');

                            let fetchOptions: RequestInit = {
                                method: 'GET',
                                headers: {}
                            };
                            let url = `${baseUrl}/api/tags`; // default to listModels

                            if (action === 'chat' || action === 'generate') {
                                // Auto-detect model if not provided
                                let selectedModel = modelId;
                                if (!selectedModel) {
                                    try {
                                        const tagsRes = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
                                        if (tagsRes.ok) {
                                            const tData = await tagsRes.json();
                                            if (tData.models && tData.models.length > 0) {
                                                selectedModel = tData.models[0].name;
                                            }
                                        }
                                    } catch (e) {}
                                }
                                if (!selectedModel) selectedModel = 'llama3';

                                if (action === 'chat') {
                                    fetchOptions.method = 'POST';
                                    fetchOptions.headers = { 'Content-Type': 'application/json' };
                                    fetchOptions.body = JSON.stringify({
                                        model: selectedModel,
                                        messages: [{ role: 'user', content: prompt }],
                                        stream: false
                                    });
                                    url = `${baseUrl}/api/chat`;
                                } else {
                                    fetchOptions.method = 'POST';
                                    fetchOptions.headers = { 'Content-Type': 'application/json' };
                                    fetchOptions.body = JSON.stringify({
                                        model: selectedModel,
                                        prompt: prompt,
                                        stream: false
                                    });
                                    url = `${baseUrl}/api/generate`;
                                }
                            }

                            try {
                                const res = await fetch(url, fetchOptions);
                                if (!res.ok) {
                                    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                                }
                                const data = await res.json();
                                if (action === 'chat') {
                                    result = data.message?.content || JSON.stringify(data);
                                } else if (action === 'generate') {
                                    result = data.response || JSON.stringify(data);
                                } else if (action === 'listModels') {
                                    const modelNames = (data.models || []).map((m: any) => m.name).join(', ');
                                    result = `Modelos disponibles en Ollama: ${modelNames || 'Ninguno encontrado'}`;
                                } else {
                                    result = JSON.stringify(data);
                                }
                            } catch (e: any) {
                                let diagnosis = "Error de conexión con Ollama.";
                                let solution = "";
                                
                                if (window.location.protocol === 'https:' && baseUrl.startsWith('http:')) {
                                    diagnosis = "Bloqueo por 'Contenido no seguro' (Mixed Content en navegador).";
                                    solution = "\n💡 SOLUCIÓN:\n1. En Chrome o Edge, haz clic en el icono del candado o ajustes (a la izquierda de la URL).\n2. Selecciona 'Configuración de sitios'.\n3. Busca 'Contenido no seguro' y cámbialo a 'Permitir'.\n4. Recarga la página y listo.\n\nTambién asegúrate de haber arrancado Ollama con OLLAMA_ORIGINS=\"*\".";
                                } else if (e.message?.includes('Failed to fetch') || e.name === 'TypeError') {
                                    diagnosis = "Ollama inalcanzable o bloqueado por CORS.";
                                    solution = "\n1. Asegúrate de que Ollama está en ejecución.\n2. Inicia Ollama con 'OLLAMA_ORIGINS=\"*\"' para permitir peticiones web.";
                                }
                                
                                result = `Nexus no pudo conectar con Ollama (${baseUrl}).\n\nMOTIVO: ${diagnosis}\n${solution}\n\nDetalle técnico: ${e.message}`;
                            }
                        } catch (e: any) {
                            result = `Error inesperado con Ollama: ${e.message}`;
                        }
                    } else if (fc.name === 'toggleTelemetryPanel' || fc.name === (NexusFunctionDeclarations as any).toggleTelemetryPanel?.name) {
                        const active = Boolean(fc.args.active);
                        setShowTelemetryPanel(active);
                        result = active 
                            ? "¡Oído cocina, Koko! Te he desplegado en pantalla el panel visual interactivo con gráficos de Recharts mostrando en tiempo real mi consumo de CPU, memoria RAM y latencia de red."
                            : "Panel de telemetría cerrado, Koko. De vuelta a la interfaz habitual.";
                    } else if (fc.name === 'toggleDebianInstallPanel' || fc.name === (NexusFunctionDeclarations as any).toggleDebianInstallPanel?.name) {
                        const active = Boolean(fc.args.active);
                        setShowDebianPanel(active);
                        result = active
                            ? "¡Oído cocina, Koko! Te he abierto en pantalla el panel con todos los comandos paso a paso y el script .sh para instalarme en Debian Linux."
                            : "Panel de instalación en Debian cerrado, Koko.";
                    } else if (fc.name === 'systemAppControl' || fc.name === (NexusFunctionDeclarations as any).systemAppControl?.name) {
                        const action = ((fc.args.action as string) || 'open').toLowerCase().trim();
                        const appId = ((fc.args.appId as string) || '').toLowerCase().trim();
                        const params = fc.args.params as string;

                        if (action === 'open') {
                            result = (window as any).nexus?.openApp ? (window as any).nexus.openApp(appId, params) : `Abriendo ${appId}`;
                        } else if (action === 'close') {
                            result = (window as any).nexus?.closeApp ? (window as any).nexus.closeApp(appId) : `Cerrando ${appId}`;
                        } else if (action === 'list') {
                            const apps = (window as any).nexus?.listApps ? (window as any).nexus.listApps() : [];
                            result = `Aplicaciones integradas del sistema:\n${apps.map((a: any) => `• ${a.name} (${a.id}): ${a.isOpen ? 'ACTIVA' : 'CERRADA'}`).join('\n')}`;
                        } else {
                            result = `Acción de sistema '${action}' no reconocida.`;
                        }
                    } else {
                        result = `Función desconocida: ${fc.name}`;
                    }
                } catch (error: any) {
                    console.error("Error executing function:", error);
                    result = `Error interno al ejecutar la herramienta: ${error.message || error}`;
                }

                if (sessionPromiseRef.current) {
                     sessionPromiseRef.current.then(session => {
                         session.sendToolResponse({
                            functionResponses: {
                                id: fc.id,
                                name: fc.name,
                                response: { result },
                            }
                        });
                     }).catch(() => {});
                }
            }
        }
    }, [startCamera, stopCamera, startScreenShare, stopScreenShare, startRecording, stopRecording]);

    const connect = useCallback(async () => {
        // Ensure clean slate
        handleDisconnect();
        
        if (!navigator.onLine) {
            setLastError("No hay conexión a internet. Por favor, revisa tu red.");
            setNexusStatus('OFFLINE');
            return;
        }

        setNexusStatus('CONNECTING');
        setLastError(null);
        try {
            // Request Mic Permission FIRST, before any await, to ensure user gesture is preserved
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                setLastError("Tu navegador no soporta el acceso al micrófono. Asegúrate de estar usando una conexión segura (HTTPS).");
                handleDisconnect();
                return;
            }

            let stream: MediaStream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ 
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        channelCount: 1,
                        sampleRate: 16000
                    } 
                });
            } catch (e: any) {
                console.warn("Error accessing microphone:", e);
                const errorMsg = e.message || e.name || String(e);
                
                if (e.name === 'NotAllowedError' || errorMsg.toLowerCase().includes('permission denied')) {
                    setLastError("Permiso de micrófono denegado. Por favor, actívalo en tu navegador (haz clic en el icono del candado en la barra de direcciones).");
                } else if (e.name === 'NotFoundError' || errorMsg.toLowerCase().includes('not found')) {
                    setLastError("No se encontró ningún micrófono en tu dispositivo.");
                } else {
                    setLastError(`Error al acceder al micrófono: ${errorMsg}`);
                }
                handleDisconnect();
                return;
            }
            
            streamRef.current = stream;

            // Initialize Audio Contexts
            // Requesting 16k for input, but browser might override
            const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            
            inputAudioContextRef.current = inputCtx;
            outputAudioContextRef.current = outputCtx;

            // CRITICAL: Resume contexts immediately within the user gesture
            await Promise.all([
                outputCtx.state === 'suspended' ? outputCtx.resume() : Promise.resolve(),
                inputCtx.state === 'suspended' ? inputCtx.resume() : Promise.resolve()
            ]);

            // Setup Output Analyser
            const analyser = outputCtx.createAnalyser();
            analyser.fftSize = 256;
            const outputGain = outputCtx.createGain();
            analyser.connect(outputGain);
            outputGain.connect(outputCtx.destination);
            
            // Create a mix for recording (AI output + Mic input)
            const recordingDestination = outputCtx.createMediaStreamDestination();
            analyser.connect(recordingDestination); // AI audio
            try {
                const micSource = outputCtx.createMediaStreamSource(stream);
                micSource.connect(recordingDestination); // Mic audio
                micSourceRef.current = micSource;
            } catch (e) {
                console.warn("Could not connect mic to recording destination:", e);
            }
            recordingDestinationRef.current = recordingDestination;

            outputAnalyserRef.current = analyser;
            setOutputAnalyser(analyser);
            
            // Reset playback state
            nextStartTimeRef.current = 0;
            sourcesRef.current.clear();

            let sessionPromise;
            try {
                sessionPromise = connectToNexus({
                    onopen: () => {
                        console.log('Conexión abierta.');
                    },
                    onmessage: handleMessage,
                    onerror: (e: ErrorEvent) => {
                        console.error('Error de conexión:', e);
                        setLastError(`Error de red o de WebSocket. Intentando reconectar...`);
                        handleDisconnect();
                        // Auto-reconnect after a short delay
                        setTimeout(() => {
                            if (navigator.onLine) {
                                connect().catch(err => console.error("Reconnection error (onerror):", err));
                            }
                        }, 2000);
                    },
                    onclose: (e: CloseEvent) => {
                        console.log('Conexión cerrada:', e.code, e.reason);
                        if (e.code === 1008 || /API_KEY|authentication|credential/i.test(String(e.reason || ''))) {
                            setLastError(null);
                            setNexusStatus('LISTENING');
                            startOfflineRecognition();
                            return;
                        }
                        if(e.code !== 1000) {
                            let reason = e.reason || "Desconocida";
                            if (e.code === 1006) reason = "Conexión interrumpida anormalmente (posible caída de red o error del servidor).";
                            if (e.code === 1011) reason = "El servidor encontró un error interno.";
                            setLastError(`Conexión cerrada (Código: ${e.code}). Razón: ${reason}. Reconectando automáticamente...`);
                        }
                        handleDisconnect();
                        // Always reconnect
                        setTimeout(() => {
                            if (navigator.onLine) {
                                connect().catch(err => console.error("Reconnection error (onclose):", err));
                            }
                        }, 2000);
                    },
                });
                
                sessionPromiseRef.current = sessionPromise;
                sessionRef.current = await sessionPromise;
            } catch (connectionError: any) {
                console.error("Failed to connect to Nexus:", connectionError);
                let errorMessage = connectionError.message || "Error desconocido al conectar.";
                
                if (errorMessage.includes("API_KEY") || /UNAUTHENTICATED|PERMISSION_DENIED|401|403/i.test(errorMessage)) {
                    setLastError(null);
                    setNexusStatus('LISTENING');
                    startOfflineRecognition();
                    return;
                } else if (errorMessage.includes("The service is currently unavailable") || errorMessage.includes("503")) {
                    errorMessage = "El servicio de Gemini no está disponible en este momento (503). Por favor, espera unos minutos e inténtalo de nuevo.";
                } else if (errorMessage.includes("Network error") || errorMessage.toLowerCase().includes("network")) {
                    errorMessage = "Hubo un problema de red al intentar conectar con los servidores. Verifica tu conexión a internet.";
                }
                
                setLastError(`Error de conexión: ${errorMessage}`);
                handleDisconnect();
                return;
            }

            // Now setup the audio processing pipeline
            const inputAudioContext = inputAudioContextRef.current;
            if (!stream || !inputAudioContext) return;
            
            const source = inputAudioContext.createMediaStreamSource(stream);
            const inputAnalyserNode = inputAudioContext.createAnalyser();
            inputAnalyserNode.fftSize = 512;
            setInputAnalyser(inputAnalyserNode);

            // Use AudioWorklet instead of deprecated ScriptProcessorNode for better performance
            // Do downsampling and Int16 conversion directly in the worklet
            const workletCode = `
            class PCMProcessor extends AudioWorkletProcessor {
                constructor(options) {
                    super();
                    this.sourceRate = options.processorOptions.sampleRate;
                    this.targetRate = 16000;
                    this.ratio = this.sourceRate / this.targetRate;
                    // Send 4096 samples at a time
                    this.bufferSize = 4096;
                    this.outBuffer = new Int16Array(this.bufferSize);
                    this.outBufferIndex = 0;
                    this.inputOffset = 0;
                }
                process(inputs, outputs, parameters) {
                    const input = inputs[0];
                    if (input && input.length > 0 && input[0]) {
                        const channelData = input[0];
                        let i = this.inputOffset;
                        
                        while (Math.floor(i) < channelData.length) {
                            const index = Math.floor(i);
                            const s = Math.max(-1, Math.min(1, channelData[index]));
                            this.outBuffer[this.outBufferIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                            
                            if (this.outBufferIndex >= this.bufferSize) {
                                this.port.postMessage(this.outBuffer.slice());
                                this.outBufferIndex = 0;
                            }
                            
                            i += this.ratio;
                        }
                        
                        // save fractional offset for next buffer
                        this.inputOffset = i - channelData.length;
                    }
                    return true;
                }
            }
            registerProcessor('pcm-processor', PCMProcessor);
            `;
            const blob = new Blob([workletCode], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            
            await inputAudioContext.audioWorklet.addModule(url);
            const workletNode = new AudioWorkletNode(inputAudioContext, 'pcm-processor', {
                processorOptions: {
                    sampleRate: inputAudioContext.sampleRate
                }
            });
            
            // Store reference to disconnect later
            audioWorkletRef.current = workletNode;

            workletNode.port.onmessage = (e) => {
                const int16Data = e.data as Int16Array;
                const targetRate = 16000;
                
                // Always send as 16k
                const pcmBlob = {
                    data: encode(new Uint8Array(int16Data.buffer)),
                    mimeType: `audio/pcm;rate=${targetRate}`,
                };
                
                // Send to session safely
                if (sessionPromiseRef.current) {
                    sessionPromiseRef.current.then(session => {
                        session.sendRealtimeInput({ audio: pcmBlob });
                    }).catch(() => {});
                }
            };
            
            source.connect(inputAnalyserNode);
            inputAnalyserNode.connect(workletNode);
            
            // Keep alive
            const gainNode = inputAudioContext.createGain();
            gainNode.gain.setValueAtTime(0, inputAudioContext.currentTime);
            workletNode.connect(gainNode);
            gainNode.connect(inputAudioContext.destination);

            // Everything is ready
            setNexusStatus('LISTENING');
            if ((sessionRef.current as any)?.isLocalSession) {
                setLastError(null);
                startOfflineRecognition();
                if ((window as any).nexus?.speak) {
                    (window as any).nexus.speak("¡Qué pasa, Koko! Ya estoy instalada y activa en tu sistema Linux. Pídeme abrir la terminal, la telemetría, las notas o el gestor de procesos cuando quieras.");
                }
            }

        } catch (error: any) {
            console.warn('Failed to connect:', error);
            let errorMessage = 'No se pudo conectar.';
            
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                errorMessage = 'Necesitamos permiso para usar el micrófono.';
            } else if (error.message?.includes('API_KEY')) {
                setLastError(null);
                setNexusStatus('LISTENING');
                startOfflineRecognition();
                return;
            } else if (error.message?.includes('The service is currently unavailable') || error.message?.includes('503')) {
                errorMessage = 'El servicio de Gemini no está disponible en este momento (503). Por favor, espera unos minutos e inténtalo de nuevo.';
            } else if (error.message?.includes('Network error') || error.message?.toLowerCase().includes('network')) {
                errorMessage = 'Hubo un problema de red al intentar conectar con los servidores. Verifica tu conexión a internet.';
            } else if (error.message) {
                errorMessage = `Error al conectar: ${error.message}`;
            }

            setLastError(errorMessage);
            setNexusStatus('OFFLINE');
            handleDisconnect();
        }
    }, [handleDisconnect, handleMessage]);

    useEffect(() => {
        const handleOnline = () => {
            if (nexusStatus === 'OFFLINE' && lastError?.includes('internet')) {
                setLastError(null);
                if (hasGrantedAccess) {
                    if (recognitionRef.current) {
                        try { recognitionRef.current.stop(); } catch(e) {}
                    }
                    connect().catch(err => console.error("Online reconnection error:", err));
                }
            }
        };

        const handleOffline = () => {
            setLastError("Se ha perdido la conexión a internet. Cambiando a Modo Local con LM Studio/Ollama si están configurados.");
            setNexusStatus('OFFLINE');
            handleDisconnect();
            
            // Hablar al desconectarse
            if ((window as any).nexus && (window as any).nexus.speak) {
                (window as any).nexus.speak("Se ha perdido la conexión a internet. Cambio a modo local.");
            }
            
            // Iniciar reconocimiento offline
            startOfflineRecognition();
        };

        const handleReconnect = () => {
            if (hasGrantedAccess && navigator.onLine) {
                setLastError("La sesión expiró por límite de tiempo. Reconectando...");
                connect().catch(err => console.error("Reconnection error (event):", err));
            }
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        window.addEventListener('nexus-reconnect', handleReconnect);

        // Si iniciamos y estamos offline, iniciar STT local directamente
        if (!navigator.onLine && hasGrantedAccess) {
            startOfflineRecognition();
        }

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener('nexus-reconnect', handleReconnect);
            if (recognitionRef.current) {
                try { recognitionRef.current.stop(); } catch(e) {}
            }
        };
    }, [nexusStatus, lastError, hasGrantedAccess, connect, handleDisconnect]);
    
    // Función central para el modo local
    const startOfflineRecognition = useCallback(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn("SpeechRecognition no soportado para modo local.");
            return;
        }

        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch(e) {}
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'es-ES';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        
        recognition.onresult = async (event: any) => {
            const transcript = event.results[0][0].transcript;
            console.log("Offline transcript:", transcript);
            saveTranscript(transcript, 'user');
            
            const lowerTranscript = transcript.toLowerCase();
            if (/(muestra|abrir|abre|enséñame|ver|pon|activar?).*(consumo|cpu|memoria|latencia|rendimiento|telemetr)/i.test(lowerTranscript)) {
                setShowTelemetryPanel(true);
                if ((window as any).nexus && (window as any).nexus.speak) {
                    (window as any).nexus.speak("Te abro el panel de telemetría en tiempo real con gráficos de Recharts, Koko.");
                }
                return;
            }
            if (/(cierra|quita|oculta|desactivar?).*(panel|consumo|telemetr|gráfic|grafic|métrica|metrica)/i.test(lowerTranscript) && !/debian/i.test(lowerTranscript)) {
                setShowTelemetryPanel(false);
                if ((window as any).nexus && (window as any).nexus.speak) {
                    (window as any).nexus.speak("Panel de telemetría cerrado. De vuelta a la interfaz habitual.");
                }
                return;
            }
            if (/(muestra|abrir|abre|enséñame|ver|pon|comandos|instalar|instalación|instalacion|paquete).*(debian|kali|linux)/i.test(lowerTranscript)) {
                setShowDebianPanel(true);
                if ((window as any).nexus && (window as any).nexus.speak) {
                    (window as any).nexus.speak("Aquí tienes el panel con el comando único de instalación en paquete para Debian y Kali Linux, Koko.");
                }
                return;
            }
            if (/(cierra|cerrar|quita|quitar|oculta).*(debian|kali|instalador|comandos de instalación|comandos de instalacion)/i.test(lowerTranscript)) {
                setShowDebianPanel(false);
                if ((window as any).nexus && (window as any).nexus.speak) {
                    (window as any).nexus.speak("Panel de instalación de Debian y Kali cerrado.");
                }
                return;
            }
            if (/(abre|abrir|lanzar|muestra).*(terminal|consola|shell)/i.test(lowerTranscript)) {
                setShowTerminal(true);
                if ((window as any).nexus && (window as any).nexus.speak) {
                    (window as any).nexus.speak("Abriendo la terminal de comandos del sistema, Koko.");
                }
                return;
            }
            if (/(cierra|cerrar|quitar|oculta).*(terminal|consola|shell)/i.test(lowerTranscript)) {
                setShowTerminal(false);
                if ((window as any).nexus && (window as any).nexus.speak) {
                    (window as any).nexus.speak("Terminal del sistema cerrada.");
                }
                return;
            }
            if (/(abre|abrir|lanzar|muestra).*(notas|bloc de notas|notepad|apuntes)/i.test(lowerTranscript)) {
                setShowNotes(true);
                if ((window as any).nexus && (window as any).nexus.speak) {
                    (window as any).nexus.speak("Abriendo tu bloc de notas del sistema, Koko.");
                }
                return;
            }
            if (/(cierra|cerrar|quitar|oculta).*(notas|bloc de notas|notepad)/i.test(lowerTranscript)) {
                setShowNotes(false);
                if ((window as any).nexus && (window as any).nexus.speak) {
                    (window as any).nexus.speak("Bloc de notas cerrado.");
                }
                return;
            }
            if (/(abre|abrir|lanzar|muestra).*(procesos|administrador de tareas|gestor de tareas)/i.test(lowerTranscript)) {
                setShowProcessManager(true);
                if ((window as any).nexus && (window as any).nexus.speak) {
                    (window as any).nexus.speak("Abriendo el administrador de procesos del sistema.");
                }
                return;
            }
            if (/(cierra|cerrar|quitar|oculta).*(procesos|administrador de tareas)/i.test(lowerTranscript)) {
                setShowProcessManager(false);
                if ((window as any).nexus && (window as any).nexus.speak) {
                    (window as any).nexus.speak("Administrador de procesos cerrado.");
                }
                return;
            }
            if (/(abre|abrir|lanzar|muestra).*(pizarra|canvas|lienzo|dibujo)/i.test(lowerTranscript)) {
                setShowCanvas(true);
                if ((window as any).nexus && (window as any).nexus.speak) {
                    (window as any).nexus.speak("Pizarra interactiva abierta.");
                }
                return;
            }
            if (/(cierra|cerrar|quitar|oculta).*(pizarra|canvas|lienzo|dibujo)/i.test(lowerTranscript)) {
                setShowCanvas(false);
                if ((window as any).nexus && (window as any).nexus.speak) {
                    (window as any).nexus.speak("Pizarra cerrada.");
                }
                return;
            }
            
            // Intentar contactar con LLM local para obtener respuesta
            try {
                // Primero probamos LM Studio
                const localBaseUrl = lmStudioUrl || 'http://localhost:1234';
                const cleanUrl = localBaseUrl.replace(/\/$/, '').replace(/\/v1$/, '') + '/v1';
                
                // Detectar modelo activo en LM Studio
                let lmModel = 'local-model';
                try {
                    const mRes = await fetch(`${cleanUrl}/models`, { signal: AbortSignal.timeout(1200) });
                    if (mRes.ok) {
                        const mData = await mRes.json();
                        if (mData.data && mData.data.length > 0) {
                            lmModel = mData.data[0].id;
                        }
                    }
                } catch(e) {}

                const res = await fetch(`${cleanUrl}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: lmModel,
                        messages: [
                            { role: 'system', content: 'Eres Nexus, una chica de barrio descarada, directa y sin filtros. Ahora estás funcionando en modo LOCAL SIN INTERNET. Responde de forma muy breve y directa.' },
                            { role: 'user', content: transcript }
                        ],
                        temperature: 0.7,
                        max_tokens: 150
                    })
                });
                
                if (res.ok) {
                    const data = await res.json();
                    const reply = data.choices?.[0]?.message?.content || "No sé qué decirte.";
                    saveTranscript(reply, 'model');
                    if ((window as any).nexus && (window as any).nexus.speak) {
                        (window as any).nexus.speak(reply);
                    }
                } else {
                    // O intentar con Ollama
                    const cleanOllamaUrl = (ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
                    let ollamaModel = 'llama3';
                    try {
                        const tRes = await fetch(`${cleanOllamaUrl}/api/tags`, { signal: AbortSignal.timeout(1200) });
                        if (tRes.ok) {
                            const tData = await tRes.json();
                            if (tData.models && tData.models.length > 0) {
                                ollamaModel = tData.models[0].name;
                            }
                        }
                    } catch(e) {}

                    const ollamaRes = await fetch(`${cleanOllamaUrl}/api/generate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: ollamaModel,
                            prompt: `Eres Nexus, una chica de barrio descarada. Estás SIN CONEXIÓN. Mensaje: ${transcript}`,
                            stream: false
                        })
                    });
                    if (ollamaRes.ok) {
                        const ollamaData = await ollamaRes.json();
                        const reply = ollamaData.response || "No me sale nada.";
                        saveTranscript(reply, 'model');
                        if ((window as any).nexus && (window as any).nexus.speak) {
                            (window as any).nexus.speak(reply);
                        }
                    } else {
                        throw new Error('Ni LM Studio ni Ollama respondieron correctamente');
                    }
                }
            } catch (e) {
                console.warn("Fallo el LLM local, usando motor local de Nexus:", e);
                try {
                    const localRes = await fetch('/api/local-assistant', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: transcript })
                    });
                    if (localRes.ok) {
                        const localData = await localRes.json();
                        const reply = localData.reply || `Te escucho Koko: ${transcript}`;
                        saveTranscript(reply, 'model');
                        if ((window as any).nexus && (window as any).nexus.speak) {
                            (window as any).nexus.speak(reply);
                        }
                        return;
                    }
                } catch {}
                if ((window as any).nexus && (window as any).nexus.speak) {
                    (window as any).nexus.speak("Te he escuchado alto y claro, Koko: " + transcript + ". Pídeme abrir la terminal, la telemetría, las notas o el gestor de procesos.");
                }
            }
        };

        recognition.onend = () => {
            // Keep listening in offline/local mode
            if (recognitionRef.current) {
                setTimeout(() => {
                    try { 
                        if (recognitionRef.current) {
                            recognitionRef.current.start(); 
                        }
                    } catch(e) {}
                }, 800);
            }
        };
        
        recognition.onerror = (event: any) => {
            if (event.error !== 'no-speech') {
                console.error("Offline recognition error:", event.error);
            }
        };

        try {
            recognition.start();
            recognitionRef.current = recognition;
        } catch(e) {
            console.error("Error starting offline recognition", e);
        }
    }, [nexusStatus, lmStudioUrl, ollamaUrl]);

    useEffect(() => {
        return () => {
            handleDisconnect();
        };
    }, [handleDisconnect]);

    useEffect(() => {
        if (showMemoriesModal) {
            getMemoriesArray().then(setMemories);
        }
    }, [showMemoriesModal]);

    const handleDeleteMemory = async (id: number) => {
        if (await deleteMemory(id)) {
            setMemories(await getMemoriesArray());
        }
    };

    const handleClearMemories = async () => {
        if (window.confirm("¿Estás seguro de que quieres borrar TODAS las memorias de Nexus? Esto no se puede deshacer.")) {
            if (await clearAllMemories()) {
                setMemories([]);
            }
        }
    };

    if (!hasGrantedAccess) {
        return (
            <div className="w-screen h-screen bg-black flex flex-col items-center justify-center relative overflow-hidden font-sans">
                {/* Background effects */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(217,70,239,0.15)_0%,transparent_70%)]" />
                <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,rgba(0,0,0,0.8)_100%)]" />
                
                <div className="z-10 flex flex-col items-center text-center max-w-md px-6">
                    <h1 className="text-5xl md:text-7xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-fuchsia-500 mb-6 tracking-tighter">
                        NEXUS
                    </h1>
                    
                    <p className="text-zinc-400 text-lg mb-10 leading-relaxed">
                        Para iniciar la conexión con Nexus, es necesario conceder acceso al micrófono, la cámara y la pantalla.
                    </p>
                    
                    <button 
                        onClick={() => {
                            if ('Notification' in window) {
                                Notification.requestPermission();
                            }
                            setHasGrantedAccess(true);
                            connect().catch(err => {
                                console.error("Initial connect error:", err);
                                setNexusStatus('OFFLINE');
                                setLastError(`Error al iniciar conexión: ${err.message || err}`);
                            });
                        }}
                        className="group relative px-8 py-4 bg-white text-black text-xl font-bold rounded-full hover:scale-105 transition-all duration-300 shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:shadow-[0_0_50px_rgba(217,70,239,0.5)] active:scale-95 overflow-hidden"
                    >
                        <span className="relative z-10">Solicitar Acceso</span>
                        <div className="absolute inset-0 bg-gradient-to-r from-sky-400 to-fuchsia-500 opacity-0 group-hover:opacity-20 transition-opacity duration-300" />
                    </button>
                    
                    <div className="mt-8 flex items-center gap-4 text-zinc-500 text-sm">
                        <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-sky-500/50" />
                            <span>Micrófono</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-fuchsia-500/50" />
                            <span>Cámara</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-indigo-500/50" />
                            <span>Pantalla</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`w-screen h-screen bg-black overflow-hidden relative font-sans transition-all duration-300 ${isScreenSharing ? 'border-4 border-indigo-500/50 box-border' : ''}`}>
            {isScreenSharing && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-indigo-600/90 text-white px-4 py-2 rounded-full flex items-center gap-2 shadow-lg backdrop-blur-sm animate-pulse">
                    <Monitor size={16} />
                    <span className="text-xs font-bold tracking-wider">NEXUS ESTÁ VIENDO TU PANTALLA</span>
                </div>
            )}
            
            <VoiceVisualizer status={nexusStatus} inputAnalyser={inputAnalyser} outputAnalyser={outputAnalyser} />
            
            {showCanvas && (
                <div className="absolute inset-0 z-20 flex items-center justify-center p-8 bg-black/40 backdrop-blur-sm animate-fade-in">
                    <div className="relative w-full max-w-4xl h-[70vh] shadow-2xl rounded-2xl overflow-hidden border border-zinc-700 bg-zinc-900 flex flex-col pointer-events-auto">
                        <div className="px-6 py-3 bg-zinc-800 flex justify-between items-center border-b border-zinc-700">
                            <h3 className="text-white font-bold flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-fuchsia-500 animate-pulse" />
                                Nexus Creative Canvas
                            </h3>
                            <button onClick={() => setShowCanvas(false)} className="text-zinc-400 hover:text-white transition-colors text-2xl font-light">&times;</button>
                        </div>
                        <div className="flex-1 overflow-hidden p-4">
                            <DrawingCanvas />
                        </div>
                    </div>
                </div>
            )}

            {/* Real-time Telemetry Panel (Only shown if Koko requests it from Nexus) */}
            {showTelemetryPanel && (
                <TelemetryPanel onClose={() => setShowTelemetryPanel(false)} />
            )}

            {/* Debian Linux Installation Commands Panel (Only shown if Koko requests it from Nexus) */}
            {showDebianPanel && (
                <DebianInstallPanel onClose={() => setShowDebianPanel(false)} />
            )}

            {/* System Terminal Application */}
            {showTerminal && (
                <SystemTerminal 
                    onClose={() => setShowTerminal(false)} 
                    initialCommand={terminalInitialCmd} 
                />
            )}

            {/* System Notes Application */}
            {showNotes && (
                <SystemNotes 
                    onClose={() => setShowNotes(false)} 
                    initialContent={notesInitialContent} 
                />
            )}

            {/* Process & Application Manager */}
            {showProcessManager && (
                <ProcessManager 
                    onClose={() => setShowProcessManager(false)} 
                    activeApps={{
                        telemetry: showTelemetryPanel,
                        terminal: showTerminal,
                        notes: showNotes,
                        canvas: showCanvas,
                        camera: isCameraActive,
                        screen: isScreenSharing
                    }}
                    onToggleApp={(id, open) => {
                        if (open) (window as any).nexus?.openApp(id);
                        else (window as any).nexus?.closeApp(id);
                    }}
                />
            )}

            {/* Hidden canvas for frame capture */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Nexus Tools Container */}
            <div id="nexus-tools-container" className="absolute inset-0 pointer-events-none z-30 [&>*]:pointer-events-auto">
                {/* Tools will be injected here by Nexus. */}
            </div>

            {/* Camera/Screen View */}
            {(isCameraActive || isScreenSharing) && (
                <div className={`absolute top-4 right-4 bg-black/50 rounded-xl overflow-hidden border border-white/20 shadow-lg z-40 transition-all duration-500 animate-fade-in-up ${isScreenSharing ? 'w-64 h-48 md:w-80 md:h-60' : 'w-32 h-48 md:w-48 md:h-64'}`}>
                    <video 
                        ref={videoRef} 
                        autoPlay 
                        playsInline 
                        muted 
                        className="w-full h-full object-cover"
                    />
                    {isRecording && (
                        <div className="absolute bottom-2 left-2 flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-[10px] font-mono text-white/80 uppercase tracking-wider">GRABANDO</span>
                        </div>
                    )}
                    {isScreenSharing && (
                        <div className="absolute top-2 left-2 flex items-center gap-2 bg-black/60 px-2 py-1 rounded-md">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-[10px] font-mono text-white/90 uppercase tracking-wider">PANTALLA</span>
                        </div>
                    )}
                </div>
            )}
            
            {/* Screen Share Prompt */}
            {showScreenSharePrompt && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-zinc-900 border border-zinc-700 p-6 rounded-2xl shadow-2xl max-w-sm w-full mx-4 text-center">
                        <div className="mx-auto w-12 h-12 bg-amber-500/20 text-amber-500 rounded-full flex items-center justify-center mb-4">
                            <Monitor size={24} />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">Compartir Pantalla</h3>
                        <p className="text-zinc-400 text-sm mb-6">
                            {window.self !== window.top 
                                ? "Estás en una vista previa. Para poder compartir pantalla por razones de seguridad, debes abrir la aplicación en una pestaña nueva."
                                : "Nexus necesita permiso para ver e interactuar con tu pantalla."}
                        </p>
                        <div className="flex flex-col gap-3 justify-center">
                            {window.self !== window.top ? (
                                <button 
                                    onClick={() => {
                                        window.open(window.location.href, '_blank');
                                        setShowScreenSharePrompt(false);
                                    }}
                                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors font-medium text-sm shadow-lg shadow-indigo-500/20 w-full"
                                >
                                    Abrir en pestaña nueva
                                </button>
                            ) : (
                                <button 
                                    onClick={async () => {
                                        setShowScreenSharePrompt(false);
                                        const success = await startScreenShare();
                                        if (!success) {
                                            setLastError("No se pudo iniciar la compartición de pantalla. Revisa tus permisos.");
                                        }
                                    }}
                                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors font-medium text-sm shadow-lg shadow-indigo-500/20 w-full"
                                >
                                    Compartir Ahora
                                </button>
                            )}
                            <button 
                                onClick={() => setShowScreenSharePrompt(false)}
                                className="px-4 py-2 rounded-lg bg-zinc-800 text-white hover:bg-zinc-700 transition-colors font-medium text-sm w-full"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Floating Navigation Controls */}
            <div className="absolute bottom-6 left-6 z-50 flex flex-col gap-4">
                <button 
                    onClick={() => setShowMemoriesModal(true)}
                    className="p-3 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/50 rounded-full text-zinc-400 hover:text-fuchsia-400 transition-all duration-300 shadow-lg backdrop-blur-md group"
                    title="Ver memorias"
                >
                    <Brain size={20} className="group-hover:scale-110 transition-transform" />
                </button>
                <button 
                    onClick={() => setShowConfigModal(true)}
                    className="p-3 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/50 rounded-full text-zinc-400 hover:text-sky-400 transition-all duration-300 shadow-lg backdrop-blur-md group"
                    title="Configuración local"
                >
                    <Cpu size={20} className="group-hover:scale-110 transition-transform" />
                </button>
            </div>

            {/* Config Modal */}
            {showConfigModal && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in p-4 overflow-y-auto">
                    <ConfigModal 
                        onClose={() => setShowConfigModal(false)}
                        lmStudioUrl={lmStudioUrl}
                        ollamaUrl={ollamaUrl}
                        onSave={(newLmUrl, newOllamaUrl) => {
                            setLmStudioUrl(newLmUrl);
                            setOllamaUrl(newOllamaUrl);
                            localStorage.setItem('nexus_lm_studio_url', newLmUrl);
                            localStorage.setItem('nexus_ollama_url', newOllamaUrl);
                        }}
                    />
                </div>
            )}

            {/* Memories Modal */}
            {showMemoriesModal && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in p-4">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
                        <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                            <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                                <Brain className="text-fuchsia-500" />
                                Memoria de Nexus
                            </h3>
                            <button 
                                onClick={() => setShowMemoriesModal(false)}
                                className="text-zinc-500 hover:text-white transition-colors text-2xl font-light"
                            >
                                &times;
                            </button>
                        </div>
                        
                        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                            {memories.length === 0 ? (
                                <div className="text-center text-zinc-500 py-10">
                                    <Brain className="w-16 h-16 mx-auto mb-4 opacity-20" />
                                    <p>Nexus aún no tiene memorias guardadas.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {memories.map((memory, index) => (
                                        <div key={memory.id || index} className="bg-zinc-800/50 border border-zinc-700/50 p-4 rounded-xl flex justify-between items-start group hover:border-zinc-600 transition-colors">
                                            <div>
                                                <p className="text-zinc-200 text-sm leading-relaxed">{memory.fact}</p>
                                                <div className="flex gap-2 mt-2 items-center">
                                                    <span className="text-[10px] text-zinc-500 font-mono">{memory.timestamp}</span>
                                                    {memory.category && (
                                                        <span className="text-[10px] px-2 py-0.5 bg-zinc-700 text-zinc-300 rounded-full uppercase tracking-wider">
                                                            {memory.category}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <button 
                                                onClick={() => memory.id !== undefined && handleDeleteMemory(memory.id)}
                                                className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all p-2"
                                                title="Borrar memoria"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        
                        {memories.length > 0 && (
                            <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 flex justify-end">
                                <button 
                                    onClick={handleClearMemories}
                                    className="px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-lg transition-colors flex items-center gap-2"
                                >
                                    <Trash2 size={16} />
                                    Borrar Todo
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
            
            {nexusStatus === 'OFFLINE' && lastError && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-md p-6">
                    <h1 className="text-4xl md:text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-fuchsia-500 mb-6 tracking-tighter">
                        NEXUS
                    </h1>
                    
                    <div className="max-w-md px-6 py-4 mb-6 bg-red-950/40 border border-red-500/40 rounded-xl text-red-200 text-center text-sm leading-relaxed">
                        {lastError}
                    </div>

                    <div className="flex flex-wrap gap-3 justify-center max-w-md">
                        <button 
                            onClick={connect}
                            className="px-6 py-3 bg-white text-black text-sm font-bold rounded-full hover:scale-105 transition-all duration-200 shadow-[0_0_20px_rgba(255,255,255,0.4)] active:scale-95 flex items-center gap-2"
                        >
                            <RefreshCw size={16} />
                            Reconectar a Nexus
                        </button>
                        <button 
                            onClick={() => {
                                setNexusStatus('LISTENING');
                                setLastError(null);
                                startOfflineRecognition();
                                if ((window as any).nexus && (window as any).nexus.speak) {
                                    (window as any).nexus.speak("Modo local activado. Te escucho mediante tus modelos locales.");
                                }
                            }}
                            className="px-6 py-3 bg-gradient-to-r from-fuchsia-600 to-sky-600 text-white text-sm font-bold rounded-full hover:scale-105 transition-all duration-200 shadow-[0_0_20px_rgba(217,70,239,0.3)] active:scale-95 flex items-center gap-2"
                        >
                            <Cpu size={16} />
                            Usar Modo Local (LM Studio / Ollama)
                        </button>
                        <button 
                            onClick={() => setShowConfigModal(true)}
                            className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-semibold rounded-full border border-zinc-700 transition-colors flex items-center gap-1.5"
                        >
                            <Settings size={14} />
                            Ajustes y Guía CORS
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const ConfigModal: React.FC<{
    onClose: () => void;
    onSave: (lmUrl: string, ollamaUrl: string) => void;
    lmStudioUrl: string;
    ollamaUrl: string;
}> = ({ onClose, onSave, lmStudioUrl, ollamaUrl }) => {
    const [lmValue, setLmValue] = useState(lmStudioUrl);
    const [ollamaValue, setOllamaValue] = useState(ollamaUrl);
    const [activeTab, setActiveTab] = useState<'lmstudio' | 'ollama' | 'cors'>('lmstudio');

    const [lmStatus, setLmStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [lmStatusText, setLmStatusText] = useState('');
    const [lmModels, setLmModels] = useState<string[]>([]);

    const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [ollamaStatusText, setOllamaStatusText] = useState('');
    const [ollamaModels, setOllamaModels] = useState<string[]>([]);

    const isHttps = window.location.protocol === 'https:';
    const showsLmMixedContentWarning = isHttps && lmValue.startsWith('http:');
    const showsOllamaMixedContentWarning = isHttps && ollamaValue.startsWith('http:');

    const testLmConnection = async () => {
        setLmStatus('testing');
        setLmStatusText('Probando conexión con LM Studio...');
        setLmModels([]);
        
        let targetUrl = lmValue.trim();
        if (!targetUrl.startsWith('http')) targetUrl = 'http://' + targetUrl;
        const rawUrl = targetUrl.replace(/\/$/, '');
        const baseUrl = rawUrl.replace(/\/v1\/?$/, '');
        
        let isSuccess = false;
        let lastErrorMsg = '';
        let fetchedModels: string[] = [];
        let workingUrl = baseUrl + '/v1';

        // Try baseUrl + '/v1/models' then baseUrl + '/models'
        for (const urlToTry of [`${baseUrl}/v1/models`, `${baseUrl}/models`]) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4000);
                const res = await fetch(urlToTry, { method: 'GET', mode: 'cors', signal: controller.signal });
                clearTimeout(timeoutId);
                if (res.ok) {
                    const data = await res.json();
                    fetchedModels = data.data?.map((m: any) => m.id) || [];
                    isSuccess = true;
                    workingUrl = urlToTry.replace(/\/models$/, '');
                    break;
                } else {
                    lastErrorMsg = `HTTP ${res.status}: ${res.statusText}`;
                }
            } catch (e: any) {
                lastErrorMsg = e.name === 'AbortError' ? 'Tiempo de espera agotado (timeout 4s)' : (e.message || String(e));
            }
        }

        if (isSuccess) {
            setLmStatus('success');
            setLmStatusText(fetchedModels.length > 0 ? `¡Conexión establecida con éxito! ${fetchedModels.length} modelo(s) detectado(s).` : '¡Conexión establecida con LM Studio!');
            setLmModels(fetchedModels);
            setLmValue(workingUrl);
        } else {
            setLmStatus('error');
            let advice = `No se pudo conectar: ${lastErrorMsg}`;
            if (isHttps && lmValue.startsWith('http:')) {
                advice = `No se pudo conectar (${lastErrorMsg}). Al estar la web en HTTPS, Chrome/Edge bloquea llamadas a http://localhost por seguridad. Haz clic en el candado/ajustes de la URL ➜ 'Configuración de sitios' ➜ 'Contenido no seguro': Permitir. Luego recarga la página. Comprueba también que LM Studio tiene el botón verde Start Server y CORS activo.`;
            } else if (lastErrorMsg.includes('Failed to fetch') || lastErrorMsg.includes('TypeError')) {
                advice = "Servidor inalcanzable o bloqueado por CORS. Asegúrate de activar 'Allow Cross-Origin Resource Sharing (CORS)' en los ajustes de LM Studio y pulsar 'Start Server'.";
            }
            setLmStatusText(advice);
        }
    };

    const testOllamaConnection = async () => {
        setOllamaStatus('testing');
        setOllamaStatusText('Probando conexión con Ollama...');
        setOllamaModels([]);
        
        let targetUrl = ollamaValue.trim();
        if (!targetUrl.startsWith('http')) targetUrl = 'http://' + targetUrl;
        const rawUrl = targetUrl.replace(/\/$/, '');
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(`${rawUrl}/api/tags`, { method: 'GET', mode: 'cors', signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
                const data = await res.json();
                const modelNames = data.models?.map((m: any) => m.name) || [];
                setOllamaStatus('success');
                setOllamaStatusText(modelNames.length > 0 ? `¡Conexión establecida con éxito! ${modelNames.length} modelo(s) detectado(s).` : '¡Conexión establecida con Ollama!');
                setOllamaModels(modelNames);
                setOllamaValue(rawUrl);
            } else {
                throw new Error(`Ollama respondió con error: HTTP ${res.status}`);
            }
        } catch (e: any) {
            setOllamaStatus('error');
            const errorMsg = e.name === 'AbortError' ? 'Tiempo de espera agotado (timeout 4s)' : (e.message || String(e));
            let advice = `No se pudo conectar: ${errorMsg}`;
            if (isHttps && ollamaValue.startsWith('http:')) {
                advice = `No se pudo conectar (${errorMsg}). Al estar la web en HTTPS, el navegador bloquea HTTP a localhost por 'Contenido no seguro'. Ve al icono del candado ➜ 'Configuración de sitios' ➜ 'Contenido no seguro' = Permitir. Y asegúrate de iniciar Ollama con OLLAMA_ORIGINS="*".`;
            } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('TypeError')) {
                advice = "Ollama inalcanzable o bloqueado por CORS. Asegúrate de iniciar Ollama con OLLAMA_ORIGINS=\"*\" para permitir conexiones desde la web.";
            }
            setOllamaStatusText(advice);
        }
    };

    return (
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-zinc-800 flex justify-between items-center bg-zinc-950">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Cpu className="text-sky-500" />
                    Modelos Locales e Integración
                </h3>
                <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors text-2xl font-light">&times;</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-zinc-800 bg-zinc-950/60 px-2 pt-2">
                <button 
                    onClick={() => setActiveTab('lmstudio')}
                    className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors border-b-2 ${activeTab === 'lmstudio' ? 'border-sky-500 text-sky-400 bg-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
                >
                    LM Studio
                </button>
                <button 
                    onClick={() => setActiveTab('ollama')}
                    className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors border-b-2 ${activeTab === 'ollama' ? 'border-sky-500 text-sky-400 bg-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
                >
                    Ollama
                </button>
                <button 
                    onClick={() => setActiveTab('cors')}
                    className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors border-b-2 ${activeTab === 'cors' ? 'border-amber-500 text-amber-400 bg-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
                >
                    Guía CORS & Navegador
                </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6 flex-1 min-h-[300px]">
                {activeTab === 'lmstudio' && (
                    <div className="space-y-5 animate-fade-in">
                        <div>
                            <label className="block text-zinc-400 text-xs font-bold mb-2 uppercase tracking-wide flex items-center gap-1.5">
                                <Globe size={14} className="text-sky-400" />
                                URL Base de LM Studio
                            </label>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    value={lmValue}
                                    onChange={(e) => setLmValue(e.target.value)}
                                    placeholder="http://localhost:1234/v1"
                                    className={`flex-1 bg-black border ${showsLmMixedContentWarning ? 'border-amber-500/50' : 'border-zinc-700'} rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-sky-500 transition-colors`}
                                />
                                <button 
                                    onClick={testLmConnection}
                                    disabled={lmStatus === 'testing'}
                                    className="bg-zinc-850 hover:bg-zinc-750 text-white px-4 py-2 rounded-lg border border-zinc-700 hover:border-zinc-500 transition-colors flex items-center gap-1.5 disabled:opacity-50 text-xs font-semibold"
                                >
                                    {lmStatus === 'testing' ? <RefreshCw size={14} className="animate-spin" /> : <Activity size={14} />}
                                    Test
                                </button>
                            </div>
                            {showsLmMixedContentWarning && (
                                <div className="mt-3 text-[11px] text-amber-400 bg-amber-500/10 p-3 rounded-lg border border-amber-500/25 leading-relaxed">
                                    <p className="font-bold flex items-center gap-1 mb-1 text-amber-300">
                                        <AlertCircle size={13} /> Pasos para permitir conexión local desde la web:
                                    </p>
                                    Al estar esta web en HTTPS, Chrome/Edge bloquea por defecto la conexión a <code>http://localhost</code>. Para desbloquearla:
                                    <ol className="list-decimal pl-4 mt-1.5 space-y-0.5 text-zinc-300">
                                        <li>Haz clic en el icono a la izquierda de la URL (candado o controles de la página).</li>
                                        <li>Pulsa en <b>Configuración de sitios</b>.</li>
                                        <li>Busca <b>Contenido no seguro</b> y cámbialo a <b>Permitir</b>.</li>
                                        <li>Vuelve a esta pestaña y recarga.</li>
                                    </ol>
                                </div>
                            )}
                            <p className="mt-2 text-[10px] text-zinc-500">
                                Valor estándar: <b>http://localhost:1234/v1</b>
                            </p>
                        </div>

                        {lmStatus !== 'idle' && (
                            <div className={`p-4 rounded-xl border ${
                                lmStatus === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 
                                lmStatus === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 
                                'bg-sky-500/10 border-sky-500/20 text-sky-400'
                            }`}>
                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5">
                                        {lmStatus === 'success' ? <CheckCircle2 size={16} /> : 
                                         lmStatus === 'error' ? <AlertCircle size={16} /> : 
                                         <RefreshCw size={16} className="animate-spin" />}
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-xs font-semibold leading-relaxed">{lmStatusText}</p>
                                        {lmStatus === 'success' && lmModels.length > 0 && (
                                            <div className="mt-2 space-y-1">
                                                <span className="text-[10px] text-zinc-400 block font-medium">Modelos detectados:</span>
                                                <div className="flex flex-wrap gap-1">
                                                    {lmModels.map(m => (
                                                        <span key={m} className="px-2 py-0.5 bg-green-500/20 rounded border border-green-500/30 text-[9px] font-mono text-green-300">
                                                            {m}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-4 text-xs text-zinc-400 leading-relaxed space-y-2">
                            <p className="font-bold text-zinc-300">¿Cómo usar LM Studio?</p>
                            <ol className="list-decimal pl-4 space-y-1">
                                <li>Abre LM Studio y ve a la pestaña de <b>Developer / Local Server</b> (icono de código o servidor).</li>
                                <li>Carga el modelo que quieras usar.</li>
                                <li>En los ajustes de la barra derecha, asegúrate de activar la casilla de <b>Cross-Origin Resource Sharing (CORS)</b>.</li>
                                <li>Haz clic en el botón verde <b>Start Server</b> (puerto 1234).</li>
                            </ol>
                        </div>
                    </div>
                )}

                {activeTab === 'ollama' && (
                    <div className="space-y-5 animate-fade-in">
                        <div>
                            <label className="block text-zinc-400 text-xs font-bold mb-2 uppercase tracking-wide flex items-center gap-1.5">
                                <Globe size={14} className="text-sky-400" />
                                URL Base de Ollama
                            </label>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    value={ollamaValue}
                                    onChange={(e) => setOllamaValue(e.target.value)}
                                    placeholder="http://localhost:11434"
                                    className={`flex-1 bg-black border ${showsOllamaMixedContentWarning ? 'border-amber-500/50' : 'border-zinc-700'} rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-sky-500 transition-colors`}
                                />
                                <button 
                                    onClick={testOllamaConnection}
                                    disabled={ollamaStatus === 'testing'}
                                    className="bg-zinc-850 hover:bg-zinc-750 text-white px-4 py-2 rounded-lg border border-zinc-700 hover:border-zinc-500 transition-colors flex items-center gap-1.5 disabled:opacity-50 text-xs font-semibold"
                                >
                                    {ollamaStatus === 'testing' ? <RefreshCw size={14} className="animate-spin" /> : <Activity size={14} />}
                                    Test
                                </button>
                            </div>
                            {showsOllamaMixedContentWarning && (
                                <div className="mt-3 text-[11px] text-amber-400 bg-amber-500/10 p-3 rounded-lg border border-amber-500/25 leading-relaxed">
                                    <p className="font-bold flex items-center gap-1 mb-1 text-amber-300">
                                        <AlertCircle size={13} /> Pasos para permitir conexión local desde la web:
                                    </p>
                                    Al estar esta web en HTTPS, Chrome/Edge bloquea peticiones a <code>http://localhost:11434</code>.
                                    <ol className="list-decimal pl-4 mt-1.5 space-y-0.5 text-zinc-300">
                                        <li>Haz clic en el candado / icono de ajustes a la izquierda de la URL.</li>
                                        <li>Entra en <b>Configuración de sitios</b>.</li>
                                        <li>Cambia <b>Contenido no seguro</b> a <b>Permitir</b>.</li>
                                        <li>Inicia Ollama con <code>OLLAMA_ORIGINS="*"</code> y recarga la página.</li>
                                    </ol>
                                </div>
                            )}
                            <p className="mt-2 text-[10px] text-zinc-500">
                                Valor estándar: <b>http://localhost:11434</b>
                            </p>
                        </div>

                        {ollamaStatus !== 'idle' && (
                            <div className={`p-4 rounded-xl border ${
                                ollamaStatus === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 
                                ollamaStatus === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 
                                'bg-sky-500/10 border-sky-500/20 text-sky-400'
                            }`}>
                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5">
                                        {ollamaStatus === 'success' ? <CheckCircle2 size={16} /> : 
                                         ollamaStatus === 'error' ? <AlertCircle size={16} /> : 
                                         <RefreshCw size={16} className="animate-spin" />}
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-xs font-semibold leading-relaxed">{ollamaStatusText}</p>
                                        {ollamaStatus === 'success' && ollamaModels.length > 0 && (
                                            <div className="mt-2 space-y-1">
                                                <span className="text-[10px] text-zinc-400 block font-medium">Modelos disponibles:</span>
                                                <div className="flex flex-wrap gap-1">
                                                    {ollamaModels.map(m => (
                                                        <span key={m} className="px-2 py-0.5 bg-green-500/20 rounded border border-green-500/30 text-[9px] font-mono text-green-300">
                                                            {m}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-4 text-xs text-zinc-400 leading-relaxed space-y-2">
                            <p className="font-bold text-zinc-300">¿Cómo usar Ollama?</p>
                            <ol className="list-decimal pl-4 space-y-1">
                                <li>Asegúrate de tener Ollama corriendo en segundo plano.</li>
                                <li>Debes habilitar CORS para que el navegador permita las peticiones (arrancando con <code>OLLAMA_ORIGINS="*"</code>).</li>
                                <li>Nexus detectará automáticamente tus modelos instalados (llama3, mistral, phi3, deepseek, etc.).</li>
                            </ol>
                        </div>
                    </div>
                )}

                {activeTab === 'cors' && (
                    <div className="space-y-5 animate-fade-in text-xs text-zinc-300 leading-relaxed">
                        <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-4 space-y-2">
                            <h4 className="font-bold text-amber-400 flex items-center gap-1.5 text-sm">
                                <AlertCircle size={15} /> ¿Por qué el navegador bloquea la conexión local?
                            </h4>
                            <p>
                                Esta aplicación está alojada en la nube bajo <b>HTTPS</b>. Por políticas de seguridad de la Web (W3C), ningún navegador permite que una web segura haga llamadas a <code>http://localhost</code> o a IPs privadas de forma silenciosa ("Mixed Content / Insecure Content").
                            </p>
                        </div>

                        <div className="space-y-3">
                            <h4 className="font-bold text-white text-sm border-b border-zinc-800 pb-1">1. Permitir Contenido no Seguro en Chrome / Edge</h4>
                            <p>Esta es la solución más rápida y directa:</p>
                            <ol className="list-decimal pl-4 space-y-1 bg-zinc-950/40 p-3 rounded-lg border border-zinc-800/60 text-zinc-300">
                                <li>Haz clic en el icono del candado o de ajustes a la izquierda de la barra de direcciones URL.</li>
                                <li>Selecciona <b>Configuración del sitio</b> (Site Settings).</li>
                                <li>Busca la opción <b>Contenido no seguro</b> (Insecure content) y cámbiala a <b>Permitir</b> (Allow).</li>
                                <li>Regresa a esta pestaña y recarga la página. ¡Listo! Ya podrás comunicar con LM Studio y Ollama libremente.</li>
                            </ol>
                        </div>

                        <div className="space-y-3">
                            <h4 className="font-bold text-white text-sm border-b border-zinc-800 pb-1">2. Habilitar CORS en Ollama</h4>
                            <p>Ollama bloquea orígenes web salvo que lo inicies con <code>OLLAMA_ORIGINS="*"</code>.</p>
                            
                            <div className="space-y-2 bg-black/50 p-3 rounded-lg border border-zinc-800 font-mono text-[10px] text-zinc-400">
                                <p><b>En Windows:</b></p>
                                <ol className="list-decimal pl-4 space-y-1">
                                    <li>Cierra Ollama desde la bandeja del sistema (junto al reloj).</li>
                                    <li>Abre Propiedades del Sistema ➜ Variables de Entorno.</li>
                                    <li>Crea una nueva variable de usuario llamada <code>OLLAMA_ORIGINS</code> con valor <code>*</code></li>
                                    <li>Vuelve a abrir Ollama.</li>
                                </ol>
                                <hr className="border-zinc-800 my-2" />
                                <p><b>En macOS:</b></p>
                                <code className="block bg-zinc-950 p-1.5 rounded text-sky-400">launchctl setenv OLLAMA_ORIGINS "*"</code>
                                <p className="mt-1">Y reinicia la app de Ollama.</p>
                                <hr className="border-zinc-800 my-2" />
                                <p><b>En Linux:</b></p>
                                <code className="block bg-zinc-950 p-1 rounded text-sky-400">sudo systemctl edit ollama</code>
                                <p className="mt-1">Añade bajo <code>[Service]</code>: <code>Environment="OLLAMA_ORIGINS=*"</code></p>
                                <code className="block bg-zinc-950 p-1 rounded text-sky-400 mt-1">sudo systemctl daemon-reload && sudo systemctl restart ollama</code>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <h4 className="font-bold text-white text-sm border-b border-zinc-800 pb-1">3. Habilitar CORS en LM Studio</h4>
                            <p>En LM Studio, dirígete a la pestaña <b>Developer / Local Server</b>, despliega el panel de opciones de la derecha y activa la casilla <b>CORS (Cross-Origin Resource Sharing)</b> antes de presionar el botón verde <b>Start Server</b>.</p>
                        </div>
                    </div>
                )}
            </div>
            
            <div className="p-4 bg-zinc-950 border-t border-zinc-800 flex justify-end gap-3">
                <button 
                    onClick={onClose}
                    className="px-5 py-2 text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
                >
                    Cancelar
                </button>
                <button 
                    onClick={() => {
                        onSave(lmValue, ollamaValue);
                        onClose();
                    }}
                    className="px-6 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg transition-all shadow-lg shadow-sky-900/20 flex items-center gap-1.5"
                >
                    <Save size={15} />
                    Guardar Cambios
                </button>
            </div>
        </div>
    );
};