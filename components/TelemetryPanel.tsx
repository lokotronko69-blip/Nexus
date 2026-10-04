import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
    ResponsiveContainer, 
    AreaChart, 
    Area, 
    LineChart, 
    Line, 
    BarChart,
    Bar,
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    ReferenceLine,
    PieChart,
    Pie,
    Cell
} from 'recharts';
import { 
    Activity, 
    Cpu, 
    HardDrive, 
    Wifi, 
    X, 
    Pause, 
    Play, 
    RotateCcw, 
    Gauge, 
    Zap, 
    Clock, 
    Server,
    Laptop,
    Radio,
    Layers,
    ArrowDown,
    ArrowUp,
    ShieldCheck,
    CheckCircle2
} from 'lucide-react';
import { SystemHardwareMetrics, ClientHardwareMetrics } from '../types';

interface MetricPoint {
    time: string;
    timestamp: number;
    cpu: number;
    memoryPercent: number;
    heapUsedMB: number;
    latency: number;
    rxSpeedKBps: number;
    txSpeedKBps: number;
    coreLoads: number[];
}

interface TelemetryPanelProps {
    onClose: () => void;
}

export const TelemetryPanel: React.FC<TelemetryPanelProps> = ({ onClose }) => {
    const [metricsHistory, setMetricsHistory] = useState<MetricPoint[]>([]);
    const [currentData, setCurrentData] = useState<SystemHardwareMetrics | null>(null);
    const [clientMetrics, setClientMetrics] = useState<ClientHardwareMetrics | null>(null);
    const [currentLatency, setCurrentLatency] = useState<number>(0);
    const [isPaused, setIsPaused] = useState<boolean>(false);
    const [streamMode, setStreamMode] = useState<'socket' | 'polling'>('socket');
    const [activeTab, setActiveTab] = useState<'all' | 'cpu_cores' | 'memory' | 'network' | 'client'>('all');
    const [lastSyncTime, setLastSyncTime] = useState<string>('');
    const [fps, setFps] = useState<number>(60);

    const isPausedRef = useRef(isPaused);
    isPausedRef.current = isPaused;
    const socketRef = useRef<Socket | null>(null);
    const pingSentTimeRef = useRef<number>(0);

    // 1. Detect Client Hardware Information (Local device running the app)
    useEffect(() => {
        let isMounted = true;

        const detectClientHardware = async () => {
            let gpuRenderer = 'Renderizador Estándar';
            let gpuVendor = 'Acelerador Gráfico';
            try {
                const canvas = document.createElement('canvas');
                const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                if (gl) {
                    const debugInfo = (gl as any).getExtension('WEBGL_debug_renderer_info');
                    if (debugInfo) {
                        gpuRenderer = (gl as any).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || gpuRenderer;
                        gpuVendor = (gl as any).getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || gpuVendor;
                    }
                }
            } catch {
                // Ignore WebGL restriction
            }

            const nav = navigator as any;
            const conn = nav.connection || nav.mozConnection || nav.webkitConnection;

            let batteryPercent: number | undefined;
            let isCharging: boolean | undefined;
            if ('getBattery' in navigator) {
                try {
                    const battery = await (navigator as any).getBattery();
                    batteryPercent = Math.round(battery.level * 100);
                    isCharging = battery.charging;
                } catch {
                    // Ignore battery errors
                }
            }

            if (!isMounted) return;

            setClientMetrics({
                logicalCores: navigator.hardwareConcurrency || 4,
                deviceMemoryGB: nav.deviceMemory || undefined,
                gpuRenderer,
                gpuVendor,
                screenResolution: `${window.screen.width} × ${window.screen.height}`,
                pixelRatio: window.devicePixelRatio || 1,
                refreshRateFPS: 60,
                connectionType: conn?.effectiveType ? conn.effectiveType.toUpperCase() : 'Banda Ancha',
                downlinkMbps: conn?.downlink || undefined,
                rttMs: conn?.rtt || undefined,
                batteryPercent,
                isCharging
            });
        };

        detectClientHardware();

        // Measure live FPS
        let frameCount = 0;
        let lastTime = performance.now();
        let animFrameId: number;

        const measureFps = () => {
            frameCount++;
            const now = performance.now();
            if (now - lastTime >= 1000) {
                const currentFps = Math.round((frameCount * 1000) / (now - lastTime));
                setFps(Math.min(144, Math.max(15, currentFps)));
                frameCount = 0;
                lastTime = now;
            }
            animFrameId = requestAnimationFrame(measureFps);
        };
        animFrameId = requestAnimationFrame(measureFps);

        return () => {
            isMounted = false;
            cancelAnimationFrame(animFrameId);
        };
    }, []);

    // 2. Hardware Data Ingestion Handler
    const handleHardwareUpdate = (data: SystemHardwareMetrics, pingMs: number) => {
        if (isPausedRef.current) return;

        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        setLastSyncTime(timeStr);

        setCurrentData(data);
        setCurrentLatency(pingMs);

        const coreLoads = data.cpu.perCore.map(c => c.usagePercent);

        const newPoint: MetricPoint = {
            time: timeStr,
            timestamp: now.getTime(),
            cpu: data.cpu.usagePercent,
            memoryPercent: data.memory.systemPercent,
            heapUsedMB: data.memory.processHeapUsedMB,
            latency: pingMs,
            rxSpeedKBps: data.network?.rxSpeedKBps || 0,
            txSpeedKBps: data.network?.txSpeedKBps || 0,
            coreLoads
        };

        setMetricsHistory(prev => {
            const next = [...prev, newPoint];
            return next.length > 25 ? next.slice(-25) : next;
        });
    };

    // 3. Setup Real-time WebSocket connection to hardware stream with fallback
    useEffect(() => {
        let isMounted = true;
        let fallbackTimer: NodeJS.Timeout | null = null;

        // HTTP Fallback fetch function
        const fetchViaHttp = async () => {
            if (isPausedRef.current) return;
            const start = performance.now();
            try {
                const res = await fetch(`/api/system-metrics?pingId=${Date.now()}`, {
                    cache: 'no-store',
                    headers: { 'Cache-Control': 'no-cache' }
                });
                const duration = Math.round(performance.now() - start);
                if (res.ok && isMounted) {
                    const data: SystemHardwareMetrics = await res.json();
                    handleHardwareUpdate(data, duration);
                }
            } catch {
                // If fetch fails, keep last known state
            }
        };

        // Try Socket.io connection for sub-second hardware synchronization
        try {
            const socket = io({
                transports: ['websocket', 'polling'],
                reconnectionDelay: 1000,
                reconnectionAttempts: 5,
                timeout: 3000
            });
            socketRef.current = socket;

            socket.on('connect', () => {
                if (!isMounted) return;
                setStreamMode('socket');
                socket.emit('request_hardware_snapshot');

                // Send first ping
                pingSentTimeRef.current = performance.now();
                socket.emit('ping_hardware', { clientTime: pingSentTimeRef.current });
            });

            socket.on('hardware_telemetry_tick', (data: SystemHardwareMetrics) => {
                if (!isMounted) return;
                // Whenever a tick arrives, also send a hardware ping to measure exact RTT
                pingSentTimeRef.current = performance.now();
                socket.emit('ping_hardware', { clientTime: pingSentTimeRef.current });

                handleHardwareUpdate(data, currentLatency || 12);
            });

            socket.on('pong_hardware', () => {
                if (!isMounted) return;
                const rtt = Math.max(1, Math.round(performance.now() - pingSentTimeRef.current));
                setCurrentLatency(rtt);
            });

            socket.on('connect_error', () => {
                if (!isMounted) return;
                setStreamMode('polling');
            });

            socket.on('disconnect', () => {
                if (!isMounted) return;
                setStreamMode('polling');
            });
        } catch {
            setStreamMode('polling');
        }

        // Set up periodic fallback or health-check timer (1200ms)
        fallbackTimer = setInterval(() => {
            if (streamMode === 'polling' || !socketRef.current?.connected) {
                fetchViaHttp();
            }
        }, 1200);

        // Fetch initial snapshot immediately
        fetchViaHttp();

        return () => {
            isMounted = false;
            if (fallbackTimer) clearInterval(fallbackTimer);
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, [streamMode]);

    // Aggregate statistics
    const cpuValues = metricsHistory.map(m => m.cpu);
    const memValues = metricsHistory.map(m => m.memoryPercent);
    const latencyValues = metricsHistory.map(m => m.latency);

    const latestPoint = metricsHistory[metricsHistory.length - 1] || {
        cpu: currentData?.cpu.usagePercent || 0,
        memoryPercent: currentData?.memory.systemPercent || 0,
        heapUsedMB: currentData?.memory.processHeapUsedMB || 0,
        latency: currentLatency || 0,
        rxSpeedKBps: currentData?.network.rxSpeedKBps || 0,
        txSpeedKBps: currentData?.network.txSpeedKBps || 0,
        time: '--:--:--',
        coreLoads: []
    };

    const avgCpu = cpuValues.length ? Math.round(cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length) : 0;
    const maxCpu = cpuValues.length ? Math.max(...cpuValues) : 0;

    const avgMem = memValues.length ? Math.round(memValues.reduce((a, b) => a + b, 0) / memValues.length) : 0;
    const maxMem = memValues.length ? Math.max(...memValues) : 0;

    const avgLatency = latencyValues.length ? Math.round(latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length) : 0;
    const maxLatency = latencyValues.length ? Math.max(...latencyValues) : 0;

    // True physical hardware memory breakdown
    const heapUsed = currentData?.memory.processHeapUsedMB || 120;
    const heapTotal = currentData?.memory.processHeapTotalMB || 180;
    const heapFree = Math.max(10, heapTotal - heapUsed);
    const cachedMem = currentData?.memory.cachedMB || 380;
    const availableMem = currentData?.memory.availableSystemMB || 3600;
    const totalMem = currentData?.memory.totalSystemMB || 4096;
    const otherUsed = Math.max(50, totalMem - availableMem - heapUsed);

    const memoryPieData = [
        { name: 'Heap Node.js', value: heapUsed, color: '#d946ef' }, // Fuchsia
        { name: 'Heap Libre', value: heapFree, color: '#c084fc' }, // Purple
        { name: 'Otros Procesos', value: otherUsed, color: '#38bdf8' }, // Sky
        { name: 'Caché / Buffers', value: cachedMem, color: '#f59e0b' }, // Amber
        { name: 'RAM Disponible', value: availableMem, color: '#10b981' } // Emerald
    ];

    // Format uptime
    const formatUptime = (sec: number) => {
        const hrs = Math.floor(sec / 3600);
        const mins = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        return `${hrs}h ${mins}m ${s}s`;
    };

    return (
        <div className="absolute inset-0 z-40 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/85 backdrop-blur-md animate-fade-in pointer-events-auto overflow-y-auto">
            <div className="relative w-full max-w-6xl max-h-[94vh] flex flex-col bg-zinc-950/98 border border-zinc-800 rounded-2xl shadow-[0_0_60px_rgba(14,165,233,0.2)] overflow-hidden">
                
                {/* Top Glowing Header with Hardware Synchronization Badges */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3.5 border-b border-zinc-800/80 bg-gradient-to-r from-zinc-900/95 via-zinc-900/60 to-zinc-900/95">
                    <div className="flex items-center gap-3">
                        <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500/20 to-fuchsia-500/20 border border-sky-500/30 text-sky-400">
                            <Radio className="w-5 h-5 text-sky-400 animate-pulse" />
                            <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                            </span>
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-base sm:text-lg md:text-xl font-bold tracking-tight text-white flex items-center gap-2">
                                    NEXUS HARDWARE CORE
                                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping"></span>
                                        Sincronizado en Vivo
                                    </span>
                                </h2>
                            </div>
                            <p className="text-xs text-zinc-400 font-mono flex flex-wrap items-center gap-2">
                                <span>Solicitado por Koko</span>
                                <span>•</span>
                                <span className="text-emerald-400 flex items-center gap-1">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    {streamMode === 'socket' ? 'Stream WebSocket Hardware (1000ms)' : 'Polling HTTP Sincronizado'}
                                </span>
                                {lastSyncTime && (
                                    <>
                                        <span>•</span>
                                        <span className="text-zinc-500 flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {lastSyncTime}
                                        </span>
                                    </>
                                )}
                            </p>
                        </div>
                    </div>

                    {/* Controls & Close */}
                    <div className="flex items-center gap-2">
                        {/* Live FPS Badge */}
                        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono">
                            <Activity className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-zinc-400">FPS:</span>
                            <span className="text-white font-bold">{fps}</span>
                        </div>

                        {/* Pause/Resume button */}
                        <button
                            onClick={() => setIsPaused(!isPaused)}
                            className={`p-2 rounded-lg border transition-colors flex items-center gap-1.5 text-xs font-mono ${
                                isPaused
                                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30'
                                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800'
                            }`}
                            title={isPaused ? 'Reanudar sincronización' : 'Pausar sincronización'}
                        >
                            {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                            <span className="hidden md:inline">{isPaused ? 'Reanudar' : 'Pausar'}</span>
                        </button>

                        {/* Reset history button */}
                        <button
                            onClick={() => setMetricsHistory([])}
                            className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                            title="Reiniciar historial"
                        >
                            <RotateCcw className="w-4 h-4" />
                        </button>

                        {/* Close button */}
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg bg-zinc-900 hover:bg-red-500/20 border border-zinc-800 hover:border-red-500/40 text-zinc-400 hover:text-red-300 transition-all flex items-center gap-1.5 text-xs font-medium ml-1"
                            title="Cerrar panel y volver a la interfaz normal"
                        >
                            <X className="w-4 h-4" />
                            <span className="hidden sm:inline">Cerrar</span>
                        </button>
                    </div>
                </div>

                {/* Hardware Synchronization Specs Bar */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 sm:px-6 py-2.5 bg-zinc-900/50 border-b border-zinc-800/60 text-[11px] font-mono">
                    <div className="flex items-center gap-2 text-zinc-400 truncate">
                        <Cpu className="w-4 h-4 text-sky-400 shrink-0" />
                        <span className="text-zinc-500">CPU Host:</span>
                        <span className="text-zinc-200 font-semibold truncate">
                            {currentData?.cpu.cores || 2} Núcleos @ {currentData?.cpu.speedMHz || 2400} MHz
                        </span>
                    </div>

                    <div className="flex items-center gap-2 text-zinc-400 truncate">
                        <HardDrive className="w-4 h-4 text-fuchsia-400 shrink-0" />
                        <span className="text-zinc-500">RAM Host:</span>
                        <span className="text-zinc-200 font-semibold truncate">
                            {((currentData?.memory.totalSystemMB || 4096) / 1024).toFixed(1)} GB Total ({((currentData?.memory.availableSystemMB || 3600) / 1024).toFixed(1)} GB Disp.)
                        </span>
                    </div>

                    <div className="flex items-center gap-2 text-zinc-400 truncate">
                        <Laptop className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span className="text-zinc-500">Hardware Cliente:</span>
                        <span className="text-zinc-200 font-semibold truncate">
                            {clientMetrics?.logicalCores || 4} Hilos • {clientMetrics?.screenResolution || 'Pantalla'}
                        </span>
                    </div>

                    <div className="flex items-center gap-2 text-zinc-400 truncate">
                        <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="text-zinc-500">Uptime:</span>
                        <span className="text-zinc-200 font-semibold truncate">
                            {currentData?.serverUptimeSec ? formatUptime(currentData.serverUptimeSec) : 'Activo'}
                        </span>
                    </div>
                </div>

                {/* KPI Overview Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 sm:px-6 sm:pt-4 sm:pb-2">
                    
                    {/* CPU KPI Card */}
                    <div className="relative overflow-hidden p-4 rounded-xl bg-zinc-900/60 border border-sky-500/20 hover:border-sky-500/40 transition-colors group">
                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Cpu className="w-16 h-16 text-sky-400" />
                        </div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs uppercase font-mono text-zinc-400 flex items-center gap-1.5">
                                <Cpu className="w-3.5 h-3.5 text-sky-400" />
                                Carga de CPU Real
                            </span>
                            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                                latestPoint.cpu > 75 
                                    ? 'bg-red-500/20 text-red-300 border border-red-500/30' 
                                    : latestPoint.cpu > 40
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                    : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                            }`}>
                                {latestPoint.cpu > 75 ? 'ALTA CARGA' : latestPoint.cpu > 40 ? 'MODERADO' : 'ÓPTIMO'}
                            </span>
                        </div>
                        <div className="flex items-baseline gap-2 mb-2">
                            <span className="text-3xl font-extrabold font-mono text-sky-400">
                                {latestPoint.cpu.toFixed(1)}%
                            </span>
                            <span className="text-xs text-zinc-500 font-mono">
                                ({currentData?.cpu.cores || 2} Cores / {currentData?.cpu.threads || 2} Threads)
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 pt-2 border-t border-zinc-800/60">
                            <span>Promedio: <strong className="text-zinc-200">{avgCpu}%</strong></span>
                            <span>Pico máx: <strong className="text-zinc-200">{maxCpu}%</strong></span>
                        </div>
                    </div>

                    {/* Memory KPI Card */}
                    <div className="relative overflow-hidden p-4 rounded-xl bg-zinc-900/60 border border-fuchsia-500/20 hover:border-fuchsia-500/40 transition-colors group">
                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <HardDrive className="w-16 h-16 text-fuchsia-400" />
                        </div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs uppercase font-mono text-zinc-400 flex items-center gap-1.5">
                                <HardDrive className="w-3.5 h-3.5 text-fuchsia-400" />
                                Memoria Hardware
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30">
                                {latestPoint.heapUsedMB} MB Heap
                            </span>
                        </div>
                        <div className="flex items-baseline gap-2 mb-2">
                            <span className="text-3xl font-extrabold font-mono text-fuchsia-400">
                                {latestPoint.memoryPercent.toFixed(1)}%
                            </span>
                            <span className="text-xs text-zinc-500 font-mono">
                                {currentData?.memory.usedSystemMB 
                                    ? `${(currentData.memory.usedSystemMB / 1024).toFixed(1)} GB / ${(currentData.memory.totalSystemMB / 1024).toFixed(1)} GB`
                                    : 'Física'
                                }
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 pt-2 border-t border-zinc-800/60">
                            <span>Promedio: <strong className="text-zinc-200">{avgMem}%</strong></span>
                            <span>Pico máx: <strong className="text-zinc-200">{maxMem}%</strong></span>
                        </div>
                    </div>

                    {/* Network & Latency KPI Card */}
                    <div className="relative overflow-hidden p-4 rounded-xl bg-zinc-900/60 border border-emerald-500/20 hover:border-emerald-500/40 transition-colors group">
                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Wifi className="w-16 h-16 text-emerald-400" />
                        </div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs uppercase font-mono text-zinc-400 flex items-center gap-1.5">
                                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                                Latencia & E/S Red
                            </span>
                            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                                latestPoint.latency > 150
                                    ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                                    : latestPoint.latency > 70
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}>
                                {latestPoint.latency > 150 ? 'LENTA' : latestPoint.latency > 70 ? 'MEDIA' : 'ULTRA-RÁPIDA'}
                            </span>
                        </div>
                        <div className="flex items-baseline justify-between mb-2">
                            <div>
                                <span className="text-3xl font-extrabold font-mono text-emerald-400">
                                    {latestPoint.latency} <span className="text-lg font-normal">ms</span>
                                </span>
                                <span className="text-xs text-zinc-500 font-mono block">
                                    RTT Hardware Ping
                                </span>
                            </div>
                            <div className="text-right text-[11px] font-mono text-zinc-400">
                                <div className="text-sky-400 flex items-center gap-1 justify-end">
                                    <ArrowDown className="w-3 h-3" />
                                    <span>{latestPoint.rxSpeedKBps} KB/s</span>
                                </div>
                                <div className="text-amber-400 flex items-center gap-1 justify-end">
                                    <ArrowUp className="w-3 h-3" />
                                    <span>{latestPoint.txSpeedKBps} KB/s</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 pt-2 border-t border-zinc-800/60">
                            <span>Promedio: <strong className="text-zinc-200">{avgLatency} ms</strong></span>
                            <span>Pico máx: <strong className="text-zinc-200">{maxLatency} ms</strong></span>
                        </div>
                    </div>
                </div>

                {/* Filter Navigation Tabs */}
                <div className="flex flex-wrap items-center gap-1.5 px-4 sm:px-6 pt-2 pb-1 border-b border-zinc-900 text-xs">
                    <span className="text-zinc-500 font-mono mr-1">Vistas:</span>
                    {[
                        { id: 'all', label: 'Cockpit Completo', icon: Layers },
                        { id: 'cpu_cores', label: 'Núcleos CPU (Por Núcleo)', icon: Cpu },
                        { id: 'memory', label: 'Memoria Física & Heap', icon: HardDrive },
                        { id: 'network', label: 'Ancho de Banda & E/S', icon: Wifi },
                        { id: 'client', label: 'Hardware de Koko (Cliente)', icon: Laptop }
                    ].map(tab => {
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`px-3 py-1.5 rounded-lg font-mono transition-colors flex items-center gap-1.5 ${
                                    activeTab === tab.id
                                        ? 'bg-zinc-800 text-white border border-zinc-700 shadow-sm'
                                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                                }`}
                            >
                                <Icon className="w-3.5 h-3.5" />
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Main Content Area */}
                <div className="flex-1 p-4 sm:px-6 overflow-y-auto space-y-4 custom-scrollbar">
                    
                    {/* TAB: CPU CORES DETAILED VIEW */}
                    {activeTab === 'cpu_cores' && (
                        <div className="space-y-4 animate-fade-in">
                            <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80">
                                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                                    <div>
                                        <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
                                            <Cpu className="w-4 h-4 text-sky-400" />
                                            CARGA EN TIEMPO REAL POR NÚCLEO FÍSICO
                                        </h3>
                                        <p className="text-xs text-zinc-400 font-mono mt-0.5">
                                            {currentData?.cpu.model || 'Procesador Virtual'} • Arquitectura: {currentData?.arch || 'x64'}
                                        </p>
                                    </div>
                                    <div className="text-xs font-mono text-zinc-400 flex items-center gap-3">
                                        <span>Load Avg: <strong className="text-zinc-200">{currentData?.cpu.loadAverage.join(', ') || '0.00, 0.00, 0.00'}</strong></span>
                                        <span>Caché: <strong className="text-zinc-200">{currentData?.cpu.cacheKB || 8192} KB</strong></span>
                                    </div>
                                </div>

                                {/* Per-Core Gauge Matrix */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                                    {(currentData?.cpu.perCore || [
                                        { id: 'cpu0', coreIndex: 0, usagePercent: latestPoint.cpu, speedMHz: 2400 },
                                        { id: 'cpu1', coreIndex: 1, usagePercent: Math.max(2, latestPoint.cpu - 5), speedMHz: 2400 }
                                    ]).map((core) => (
                                        <div key={core.id} className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800">
                                            <div className="flex items-center justify-between text-xs font-mono mb-2">
                                                <span className="text-zinc-300 font-bold">Núcleo #{core.coreIndex}</span>
                                                <span className={`font-bold ${
                                                    core.usagePercent > 75 ? 'text-red-400' :
                                                    core.usagePercent > 40 ? 'text-amber-400' :
                                                    'text-sky-400'
                                                }`}>
                                                    {core.usagePercent.toFixed(1)}%
                                                </span>
                                            </div>

                                            {/* Progress bar */}
                                            <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden mb-2">
                                                <div 
                                                    className={`h-full transition-all duration-500 rounded-full ${
                                                        core.usagePercent > 75 ? 'bg-red-500' :
                                                        core.usagePercent > 40 ? 'bg-amber-500' :
                                                        'bg-sky-500'
                                                    }`}
                                                    style={{ width: `${Math.max(3, Math.min(100, core.usagePercent))}%` }}
                                                />
                                            </div>

                                            <div className="text-[10px] font-mono text-zinc-500 flex justify-between">
                                                <span>Freq: {core.speedMHz || 2400} MHz</span>
                                                <span>ID: {core.id}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Per-core Bar Chart */}
                                <div className="w-full h-56 min-w-0">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart
                                            data={(currentData?.cpu.perCore || []).map(c => ({
                                                name: `Core ${c.coreIndex}`,
                                                uso: c.usagePercent,
                                                mhz: c.speedMHz
                                            }))}
                                            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                                            <XAxis dataKey="name" stroke="#71717a" fontSize={11} tickLine={false} />
                                            <YAxis domain={[0, 100]} stroke="#71717a" fontSize={10} tickFormatter={(val) => `${val}%`} tickLine={false} />
                                            <Tooltip
                                                content={({ active, payload }) => {
                                                    if (active && payload && payload.length) {
                                                        const p = payload[0].payload;
                                                        return (
                                                            <div className="p-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-xs font-mono">
                                                                <p className="text-white font-bold">{p.name}</p>
                                                                <p className="text-sky-400">Carga: {p.uso}%</p>
                                                                <p className="text-zinc-400">Frecuencia: {p.mhz} MHz</p>
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                }}
                                            />
                                            <Bar dataKey="uso" fill="#0ea5e9" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB: MEMORY DETAILED VIEW */}
                    {activeTab === 'memory' && (
                        <div className="space-y-4 animate-fade-in">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80 lg:col-span-2">
                                    <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono mb-4">
                                        <HardDrive className="w-4 h-4 text-fuchsia-400" />
                                        DISTRIBUCIÓN DE MEMORIA FÍSICA Y PROCESO
                                    </h3>

                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6 text-xs font-mono">
                                        <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800">
                                            <span className="text-zinc-500 block text-[10px]">RAM Total Hardware</span>
                                            <span className="text-base font-bold text-white">
                                                {((currentData?.memory.totalSystemMB || 4096) / 1024).toFixed(2)} GB
                                            </span>
                                        </div>

                                        <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800">
                                            <span className="text-zinc-500 block text-[10px]">RAM Disponible</span>
                                            <span className="text-base font-bold text-emerald-400">
                                                {((currentData?.memory.availableSystemMB || 3600) / 1024).toFixed(2)} GB
                                            </span>
                                        </div>

                                        <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800">
                                            <span className="text-zinc-500 block text-[10px]">Caché & Buffers OS</span>
                                            <span className="text-base font-bold text-amber-400">
                                                {((currentData?.memory.cachedMB || 380) / 1024).toFixed(2)} GB
                                            </span>
                                        </div>

                                        <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800">
                                            <span className="text-zinc-500 block text-[10px]">Node.js Heap Usado</span>
                                            <span className="text-base font-bold text-fuchsia-400">
                                                {currentData?.memory.processHeapUsedMB || 120} MB
                                            </span>
                                        </div>

                                        <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800">
                                            <span className="text-zinc-500 block text-[10px]">Node.js Heap Total</span>
                                            <span className="text-base font-bold text-purple-400">
                                                {currentData?.memory.processHeapTotalMB || 180} MB
                                            </span>
                                        </div>

                                        <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800">
                                            <span className="text-zinc-500 block text-[10px]">Node.js RSS Total</span>
                                            <span className="text-base font-bold text-sky-400">
                                                {currentData?.memory.processRssMB || 220} MB
                                            </span>
                                        </div>
                                    </div>

                                    {/* Timeline AreaChart of Memory */}
                                    <div className="w-full h-52 min-w-0">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={metricsHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                                                <XAxis dataKey="time" stroke="#71717a" fontSize={10} tickLine={false} />
                                                <YAxis domain={[0, 100]} stroke="#71717a" fontSize={10} tickFormatter={(val) => `${val}%`} tickLine={false} />
                                                <Tooltip />
                                                <Area type="monotone" dataKey="memoryPercent" stroke="#d946ef" fill="#d946ef" fillOpacity={0.25} strokeWidth={2} isAnimationActive={false} />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80 flex flex-col justify-between">
                                    <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono mb-2">
                                        <Server className="w-4 h-4 text-purple-400" />
                                        DESGLOSE DE MEMORIA
                                    </h3>

                                    <div className="w-full h-44 min-w-0">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={memoryPieData}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={42}
                                                    outerRadius={65}
                                                    paddingAngle={3}
                                                    dataKey="value"
                                                    isAnimationActive={false}
                                                >
                                                    {memoryPieData.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <Tooltip
                                                    content={({ active, payload }) => {
                                                        if (active && payload && payload.length) {
                                                            const p = payload[0];
                                                            return (
                                                                <div className="p-2 bg-zinc-900 border border-zinc-700 rounded text-xs font-mono">
                                                                    <span style={{ color: p.payload.color }}>
                                                                        {p.name}: {p.value} MB
                                                                    </span>
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    }}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>

                                    <div className="space-y-1.5 pt-2 text-[10px] font-mono border-t border-zinc-800">
                                        {memoryPieData.map((d, i) => (
                                            <div key={i} className="flex items-center justify-between text-zinc-300">
                                                <div className="flex items-center gap-1.5 truncate">
                                                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                                                    <span className="truncate">{d.name}</span>
                                                </div>
                                                <span className="font-bold">{d.value} MB</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB: NETWORK DETAILED VIEW */}
                    {activeTab === 'network' && (
                        <div className="space-y-4 animate-fade-in">
                            <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80">
                                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                                    <div>
                                        <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
                                            <Wifi className="w-4 h-4 text-emerald-400" />
                                            TRÁFICO DE RED Y ANCHO DE BANDA DE HARDWARE
                                        </h3>
                                        <p className="text-xs text-zinc-400 font-mono mt-0.5">
                                            Interfaz Activa: <strong className="text-zinc-200">{currentData?.network.activeInterface || 'eth0'}</strong>
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs font-mono">
                                        <div className="flex items-center gap-1 text-sky-400">
                                            <ArrowDown className="w-3.5 h-3.5" />
                                            <span>Descarga: {latestPoint.rxSpeedKBps} KB/s (Total: {currentData?.network.totalRxMB || 0} MB)</span>
                                        </div>
                                        <div className="flex items-center gap-1 text-amber-400">
                                            <ArrowUp className="w-3.5 h-3.5" />
                                            <span>Subida: {latestPoint.txSpeedKBps} KB/s (Total: {currentData?.network.totalTxMB || 0} MB)</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="w-full h-64 min-w-0">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={metricsHistory} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="rxGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4}/>
                                                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.0}/>
                                                </linearGradient>
                                                <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4}/>
                                                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0}/>
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                                            <XAxis dataKey="time" stroke="#71717a" fontSize={10} tickLine={false} />
                                            <YAxis stroke="#71717a" fontSize={10} tickFormatter={(val) => `${val} KB/s`} tickLine={false} />
                                            <Tooltip />
                                            <Area type="monotone" dataKey="rxSpeedKBps" name="Descarga (RX)" stroke="#38bdf8" fill="url(#rxGrad)" strokeWidth={2} isAnimationActive={false} />
                                            <Area type="monotone" dataKey="txSpeedKBps" name="Subida (TX)" stroke="#f59e0b" fill="url(#txGrad)" strokeWidth={2} isAnimationActive={false} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB: CLIENT HARDWARE (KOKO'S DEVICE) */}
                    {activeTab === 'client' && (
                        <div className="space-y-4 animate-fade-in">
                            <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80">
                                <div className="flex items-center gap-2 mb-4">
                                    <Laptop className="w-5 h-5 text-emerald-400" />
                                    <h3 className="text-sm font-bold text-white font-mono">
                                        HARDWARE LOCAL DEL DISPOSITIVO DE KOKO
                                    </h3>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs font-mono">
                                    <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800">
                                        <span className="text-zinc-500 block text-[10px] mb-1">PROCESADOR Y HILOS</span>
                                        <p className="text-white text-base font-bold flex items-center gap-2">
                                            <Cpu className="w-4 h-4 text-sky-400" />
                                            {clientMetrics?.logicalCores || 4} Hilos Lógicos
                                        </p>
                                        <p className="text-zinc-400 text-[11px] mt-1">
                                            Capacidad concurrente del cliente web detectada directamente del hardware.
                                        </p>
                                    </div>

                                    <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800">
                                        <span className="text-zinc-500 block text-[10px] mb-1">GPU & ACELERACIÓN GRÁFICA</span>
                                        <p className="text-white text-xs font-bold truncate">
                                            {clientMetrics?.gpuRenderer || 'WebGL Renderer'}
                                        </p>
                                        <p className="text-zinc-400 text-[11px] mt-1">
                                            Fabricante: {clientMetrics?.gpuVendor || 'Acelerador de hardware'}
                                        </p>
                                    </div>

                                    <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800">
                                        <span className="text-zinc-500 block text-[10px] mb-1">PANTALLA Y RENDIMIENTO</span>
                                        <p className="text-white text-base font-bold">
                                            {clientMetrics?.screenResolution} @ {fps} FPS
                                        </p>
                                        <p className="text-zinc-400 text-[11px] mt-1">
                                            Escala DPR: {clientMetrics?.pixelRatio}x • Refresco estable
                                        </p>
                                    </div>

                                    <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800">
                                        <span className="text-zinc-500 block text-[10px] mb-1">MEMORIA DISPOSITIVO ESTIMADA</span>
                                        <p className="text-white text-base font-bold">
                                            {clientMetrics?.deviceMemoryGB ? `${clientMetrics.deviceMemoryGB} GB RAM` : 'Navegador Seguro'}
                                        </p>
                                        <p className="text-zinc-400 text-[11px] mt-1">
                                            Reportada por API navigator.deviceMemory.
                                        </p>
                                    </div>

                                    <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800">
                                        <span className="text-zinc-500 block text-[10px] mb-1">CONEXIÓN DEL CLIENTE</span>
                                        <p className="text-white text-base font-bold text-emerald-400">
                                            {clientMetrics?.connectionType || 'Banda Ancha'}
                                        </p>
                                        <p className="text-zinc-400 text-[11px] mt-1">
                                            {clientMetrics?.downlinkMbps ? `Velocidad: ~${clientMetrics.downlinkMbps} Mbps` : 'Conexión activa'}
                                        </p>
                                    </div>

                                    {clientMetrics?.batteryPercent !== undefined && (
                                        <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800">
                                            <span className="text-zinc-500 block text-[10px] mb-1">BATERÍA DISPOSITIVO</span>
                                            <p className="text-white text-base font-bold flex items-center gap-1.5">
                                                <span>{clientMetrics.batteryPercent}%</span>
                                                {clientMetrics.isCharging && <span className="text-[10px] text-amber-400">(Cargando)</span>}
                                            </p>
                                            <p className="text-zinc-400 text-[11px] mt-1">
                                                Estado de alimentación del equipo.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB: ALL / FULL COCKPIT VIEW */}
                    {activeTab === 'all' && (
                        <div className="space-y-4 animate-fade-in">
                            {/* CPU & Memory Charts */}
                            <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80">
                                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                                    <div className="flex items-center gap-3">
                                        <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
                                            <Gauge className="w-4 h-4 text-sky-400" />
                                            CONSUMO DE HARDWARE EN TIEMPO REAL (CPU & MEMORIA %)
                                        </h3>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs font-mono">
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-3 h-3 rounded-sm bg-sky-400" />
                                            <span className="text-sky-300">CPU ({latestPoint.cpu}%)</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-3 h-3 rounded-sm bg-fuchsia-400" />
                                            <span className="text-fuchsia-300">RAM ({latestPoint.memoryPercent}%)</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="w-full h-56 min-w-0">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={metricsHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4}/>
                                                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.0}/>
                                                </linearGradient>
                                                <linearGradient id="memoryGradient" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#d946ef" stopOpacity={0.35}/>
                                                    <stop offset="95%" stopColor="#d946ef" stopOpacity={0.0}/>
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                                            <XAxis dataKey="time" stroke="#71717a" fontSize={10} tickLine={false} />
                                            <YAxis domain={[0, 100]} stroke="#71717a" fontSize={10} tickFormatter={(val) => `${val}%`} tickLine={false} />
                                            <Tooltip 
                                                content={({ active, payload }) => {
                                                    if (active && payload && payload.length) {
                                                        const p = payload[0].payload as MetricPoint;
                                                        return (
                                                            <div className="p-3 bg-zinc-900/95 border border-zinc-700 rounded-lg shadow-xl backdrop-blur-md text-xs font-mono space-y-1">
                                                                <p className="text-zinc-400 text-[10px] pb-1 border-b border-zinc-800">{p.time}</p>
                                                                <p className="text-sky-400 flex items-center justify-between gap-4">
                                                                    <span>CPU Hardware:</span> <strong>{p.cpu}%</strong>
                                                                </p>
                                                                <p className="text-fuchsia-400 flex items-center justify-between gap-4">
                                                                    <span>Memoria RAM:</span> <strong>{p.memoryPercent}%</strong>
                                                                </p>
                                                                <p className="text-purple-300 flex items-center justify-between gap-4">
                                                                    <span>Heap Proceso:</span> <strong>{p.heapUsedMB} MB</strong>
                                                                </p>
                                                                <p className="text-emerald-400 flex items-center justify-between gap-4">
                                                                    <span>Latencia Ping:</span> <strong>{p.latency} ms</strong>
                                                                </p>
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                }}
                                            />
                                            <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Alerta 80%', fill: '#ef4444', fontSize: 10, position: 'right' }} />
                                            <Area 
                                                type="monotone" 
                                                dataKey="cpu" 
                                                stroke="#0ea5e9" 
                                                strokeWidth={2} 
                                                fillOpacity={1} 
                                                fill="url(#cpuGradient)" 
                                                isAnimationActive={false} 
                                            />
                                            <Area 
                                                type="monotone" 
                                                dataKey="memoryPercent" 
                                                stroke="#d946ef" 
                                                strokeWidth={2} 
                                                fillOpacity={1} 
                                                fill="url(#memoryGradient)" 
                                                isAnimationActive={false} 
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Network Latency & Resource Distribution */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                
                                {/* Latency Time Series Chart */}
                                <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80 lg:col-span-2">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
                                            <Zap className="w-4 h-4 text-emerald-400" />
                                            LATENCIA DE ENLACE DE RED (RTT EN MS)
                                        </h3>
                                        <div className="text-xs font-mono text-emerald-400 flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                                            Actual: {latestPoint.latency} ms
                                        </div>
                                    </div>

                                    <div className="w-full h-44 min-w-0">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={metricsHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                                                <XAxis dataKey="time" stroke="#71717a" fontSize={10} tickLine={false} />
                                                <YAxis stroke="#71717a" fontSize={10} tickFormatter={(val) => `${val}ms`} tickLine={false} />
                                                <Tooltip 
                                                    content={({ active, payload }) => {
                                                        if (active && payload && payload.length) {
                                                            const p = payload[0].payload as MetricPoint;
                                                            return (
                                                                <div className="p-3 bg-zinc-900/95 border border-zinc-700 rounded-lg shadow-xl backdrop-blur-md text-xs font-mono">
                                                                    <p className="text-zinc-400 text-[10px] pb-1 border-b border-zinc-800">{p.time}</p>
                                                                    <p className="text-emerald-400 pt-1 flex items-center justify-between gap-4">
                                                                        <span>Latencia Ping:</span> <strong>{p.latency} ms</strong>
                                                                    </p>
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    }}
                                                />
                                                <ReferenceLine y={100} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: '100ms', fill: '#f59e0b', fontSize: 10 }} />
                                                <Line 
                                                    type="monotone" 
                                                    dataKey="latency" 
                                                    stroke="#10b981" 
                                                    strokeWidth={2} 
                                                    dot={{ r: 2, fill: '#10b981' }} 
                                                    activeDot={{ r: 5, fill: '#34d399' }} 
                                                    isAnimationActive={false} 
                                                />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Memory Breakdown Donut */}
                                <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80 flex flex-col justify-between">
                                    <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono mb-2">
                                        <Server className="w-4 h-4 text-purple-400" />
                                        DISTRIBUCIÓN MEMORIA
                                    </h3>

                                    <div className="w-full h-36 min-w-0">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={memoryPieData}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={38}
                                                    outerRadius={56}
                                                    paddingAngle={3}
                                                    dataKey="value"
                                                    isAnimationActive={false}
                                                >
                                                    {memoryPieData.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <Tooltip
                                                    content={({ active, payload }) => {
                                                        if (active && payload && payload.length) {
                                                            const p = payload[0];
                                                            return (
                                                                <div className="p-2 bg-zinc-900 border border-zinc-700 rounded text-xs font-mono">
                                                                    <span style={{ color: p.payload.color }}>
                                                                        {p.name}: {p.value} MB
                                                                    </span>
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    }}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>

                                    <div className="grid grid-cols-2 gap-1.5 pt-2 text-[10px] font-mono border-t border-zinc-800">
                                        {memoryPieData.slice(0, 4).map((d, i) => (
                                            <div key={i} className="flex items-center gap-1.5 text-zinc-300">
                                                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                                                <span className="truncate">{d.name} ({d.value}MB)</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Status Bar & Voice Hint */}
                <div className="px-4 sm:px-6 py-3 border-t border-zinc-800/80 bg-zinc-900/60 flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-zinc-400">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span className="text-zinc-300">Hardware Sincronizado:</span>
                        <span className="text-zinc-400">
                            Pídele a Nexus <strong className="text-fuchsia-300">"Cierra el panel"</strong> o <strong className="text-sky-300">"Muestra el consumo"</strong> en cualquier momento.
                        </span>
                    </div>

                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 bg-white text-black font-bold text-xs rounded-full hover:bg-zinc-200 transition-colors shadow-md flex items-center gap-1.5 cursor-pointer"
                    >
                        <span>Volver a la interfaz habitual</span>
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>

            </div>
        </div>
    );
};
