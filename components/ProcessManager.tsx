import React from 'react';
import { Layers, X, Play, Square, Activity, Cpu, HardDrive, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

export interface AppProcessInfo {
    id: string;
    name: string;
    description: string;
    type: 'core' | 'ui_app' | 'sensor';
    isOpen: boolean;
    estimatedMemMB: number;
    estimatedCpuPct: number;
}

interface ProcessManagerProps {
    onClose: () => void;
    activeApps: Record<string, boolean>;
    onToggleApp: (appId: string, open: boolean) => void;
}

export const ProcessManager: React.FC<ProcessManagerProps> = ({ onClose, activeApps, onToggleApp }) => {
    const processes: AppProcessInfo[] = [
        {
            id: 'telemetry',
            name: 'Monitor de Telemetría (Hardware Core)',
            description: 'Gráficos Recharts en tiempo real de CPU, RAM y red',
            type: 'ui_app',
            isOpen: !!activeApps.telemetry,
            estimatedMemMB: activeApps.telemetry ? 45 : 0,
            estimatedCpuPct: activeApps.telemetry ? 2.5 : 0
        },
        {
            id: 'terminal',
            name: 'Terminal de Comandos (Nexus Bash)',
            description: 'Consola interactiva del sistema operativo y comandos',
            type: 'ui_app',
            isOpen: !!activeApps.terminal,
            estimatedMemMB: activeApps.terminal ? 25 : 0,
            estimatedCpuPct: activeApps.terminal ? 0.8 : 0
        },
        {
            id: 'notes',
            name: 'Bloc de Notas del Sistema',
            description: 'Editor de notas rápidas persistente',
            type: 'ui_app',
            isOpen: !!activeApps.notes,
            estimatedMemMB: activeApps.notes ? 15 : 0,
            estimatedCpuPct: activeApps.notes ? 0.2 : 0
        },
        {
            id: 'canvas',
            name: 'Pizarra Gráfica Interactiva',
            description: 'Lienzo de dibujo para esquemas y bocetos',
            type: 'ui_app',
            isOpen: !!activeApps.canvas,
            estimatedMemMB: activeApps.canvas ? 30 : 0,
            estimatedCpuPct: activeApps.canvas ? 1.0 : 0
        },
        {
            id: 'camera',
            name: 'Sensor Óptico / Cámara',
            description: 'Flujo de vídeo y visión artificial de Nexus',
            type: 'sensor',
            isOpen: !!activeApps.camera,
            estimatedMemMB: activeApps.camera ? 65 : 0,
            estimatedCpuPct: activeApps.camera ? 4.2 : 0
        },
        {
            id: 'screen',
            name: 'Captura y Compartición de Pantalla',
            description: 'Monitorización de pantallas y ventanas del sistema',
            type: 'sensor',
            isOpen: !!activeApps.screen,
            estimatedMemMB: activeApps.screen ? 80 : 0,
            estimatedCpuPct: activeApps.screen ? 5.5 : 0
        },
        {
            id: 'gemini_core',
            name: 'Motor Neural Gemini Live',
            description: 'Inteligencia y procesamiento conversacional en tiempo real',
            type: 'core',
            isOpen: true,
            estimatedMemMB: 120,
            estimatedCpuPct: 3.8
        },
        {
            id: 'hardware_socket',
            name: 'Enlace WebSocket de Hardware',
            description: 'Sincronizador continuo de kernel /proc a 1000ms',
            type: 'core',
            isOpen: true,
            estimatedMemMB: 28,
            estimatedCpuPct: 1.1
        }
    ];

    const totalActive = processes.filter(p => p.isOpen).length;
    const totalMemUsed = processes.reduce((acc, p) => acc + p.estimatedMemMB, 0);
    const totalCpuUsed = Math.round(processes.reduce((acc, p) => acc + p.estimatedCpuPct, 0) * 10) / 10;

    return (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-3xl h-[65vh] max-h-[600px] bg-zinc-950/98 border border-zinc-700/80 rounded-xl shadow-[0_0_50px_rgba(56,189,248,0.2)] backdrop-blur-xl z-50 flex flex-col pointer-events-auto overflow-hidden font-mono">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-zinc-900 via-zinc-850 to-zinc-900 border-b border-zinc-800 select-none">
                <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-sky-400" />
                    <span className="text-xs font-bold text-zinc-200">
                        Administrador de Procesos y Aplicaciones
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">
                        {totalActive} Activos
                    </span>
                </div>

                <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <button
                        onClick={onClose}
                        className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                        title="Cerrar"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-3 gap-2 p-3 bg-zinc-900/50 border-b border-zinc-800 text-xs">
                <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800 flex items-center justify-between">
                    <span className="text-zinc-500 flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-sky-400" />
                        CPU Ecosistema:
                    </span>
                    <span className="text-sky-400 font-bold">{totalCpuUsed}%</span>
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800 flex items-center justify-between">
                    <span className="text-zinc-500 flex items-center gap-1.5">
                        <HardDrive className="w-3.5 h-3.5 text-fuchsia-400" />
                        RAM Estimada:
                    </span>
                    <span className="text-fuchsia-400 font-bold">{totalMemUsed} MB</span>
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800 flex items-center justify-between">
                    <span className="text-zinc-500 flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-emerald-400" />
                        Procesos:
                    </span>
                    <span className="text-emerald-400 font-bold">{totalActive} / {processes.length}</span>
                </div>
            </div>

            {/* Process List Table */}
            <div className="flex-1 p-3 overflow-y-auto custom-scrollbar space-y-2">
                <div className="grid grid-cols-12 px-3 py-1.5 text-[10px] text-zinc-500 font-semibold border-b border-zinc-800">
                    <span className="col-span-6">NOMBRE DE LA APLICACIÓN / SERVICIO</span>
                    <span className="col-span-2 text-center">ESTADO</span>
                    <span className="col-span-2 text-right">MEM / CPU</span>
                    <span className="col-span-2 text-right">ACCIÓN</span>
                </div>

                {processes.map((proc) => (
                    <div 
                        key={proc.id} 
                        className={`grid grid-cols-12 items-center px-3 py-2.5 rounded-lg border transition-colors text-xs ${
                            proc.isOpen 
                                ? 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700' 
                                : 'bg-zinc-950/40 border-zinc-900 text-zinc-500'
                        }`}
                    >
                        <div className="col-span-6 flex flex-col pr-2">
                            <span className={`font-semibold truncate ${proc.isOpen ? 'text-zinc-200' : 'text-zinc-500'}`}>
                                {proc.name}
                            </span>
                            <span className="text-[10px] text-zinc-500 truncate">
                                {proc.description}
                            </span>
                        </div>

                        <div className="col-span-2 flex items-center justify-center">
                            {proc.isOpen ? (
                                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                    En Ejecución
                                </span>
                            ) : (
                                <span className="text-[10px] text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded-full">
                                    Detenido
                                </span>
                            )}
                        </div>

                        <div className="col-span-2 text-right text-[11px] font-mono">
                            {proc.isOpen ? (
                                <>
                                    <span className="text-zinc-300 block">{proc.estimatedMemMB} MB</span>
                                    <span className="text-sky-400 text-[10px]">{proc.estimatedCpuPct}%</span>
                                </>
                            ) : (
                                <span className="text-zinc-600">-</span>
                            )}
                        </div>

                        <div className="col-span-2 flex justify-end">
                            {proc.type === 'core' ? (
                                <span className="text-[10px] text-zinc-500 italic px-2">Núcleo</span>
                            ) : proc.isOpen ? (
                                <button
                                    onClick={() => onToggleApp(proc.id, false)}
                                    className="px-2.5 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 text-[10px] font-bold transition-colors flex items-center gap-1"
                                    title="Finalizar tarea"
                                >
                                    <Square className="w-2.5 h-2.5 fill-current" />
                                    <span>Cerrar</span>
                                </button>
                            ) : (
                                <button
                                    onClick={() => onToggleApp(proc.id, true)}
                                    className="px-2.5 py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 text-[10px] font-bold transition-colors flex items-center gap-1"
                                    title="Iniciar aplicación"
                                >
                                    <Play className="w-2.5 h-2.5 fill-current" />
                                    <span>Abrir</span>
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 bg-zinc-900 border-t border-zinc-800 text-[10px] text-zinc-500 flex justify-between items-center select-none">
                <span>Gestiona aplicaciones mediante voz: "Nexus, abre la terminal" o "Nexus, cierra el panel"</span>
                <button
                    onClick={onClose}
                    className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs transition-colors"
                >
                    Aceptar
                </button>
            </div>
        </div>
    );
};
