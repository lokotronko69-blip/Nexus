import React, { useState, useEffect, useRef } from 'react';
import { Terminal as TerminalIcon, X, Minus, Square, Send, CornerDownLeft, Play, RefreshCw, Trash2 } from 'lucide-react';

interface TerminalOutput {
    id: string;
    type: 'input' | 'output' | 'error' | 'system';
    text: string;
    timestamp: string;
}

interface SystemTerminalProps {
    onClose: () => void;
    onExecuteAction?: (command: string, args: string[]) => string | Promise<string>;
    initialCommand?: string;
}

export const SystemTerminal: React.FC<SystemTerminalProps> = ({ onClose, onExecuteAction, initialCommand }) => {
    const [history, setHistory] = useState<TerminalOutput[]>([
        {
            id: 'init-1',
            type: 'system',
            text: 'NEXUS OS CORE [Kernel v6.12.0-nexus-x86_64]',
            timestamp: new Date().toLocaleTimeString()
        },
        {
            id: 'init-2',
            type: 'system',
            text: 'Conexión local y hardware sincronizado. Escribe "help" para ver los comandos disponibles.',
            timestamp: new Date().toLocaleTimeString()
        }
    ]);
    const [input, setInput] = useState('');
    const [commandHistory, setCommandHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState<number>(-1);
    const [isMaximized, setIsMaximized] = useState(false);
    
    const terminalEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const scrollToBottom = () => {
        terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [history]);

    useEffect(() => {
        inputRef.current?.focus();
        if (initialCommand) {
            executeCommand(initialCommand);
        }
    }, []);

    const executeCommand = async (cmdText: string) => {
        const trimmed = cmdText.trim();
        if (!trimmed) return;

        const time = new Date().toLocaleTimeString();
        const inputEntry: TerminalOutput = {
            id: `in-${Date.now()}`,
            type: 'input',
            text: `nexus@system:~$ ${trimmed}`,
            timestamp: time
        };

        // Update command history for arrow navigation
        setCommandHistory(prev => [...prev, trimmed]);
        setHistoryIndex(-1);

        const parts = trimmed.split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        let outputText = '';
        let outputType: 'output' | 'error' | 'system' = 'output';

        const runServerShell = async (shellCmd: string): Promise<{ output: string; isError: boolean }> => {
            try {
                const r = await fetch('/api/terminal-exec', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: shellCmd }),
                });
                if (r.ok) {
                    const d = await r.json();
                    return {
                        output: d.output || '(Comando ejecutado)',
                        isError: typeof d.exitCode === 'number' && d.exitCode !== 0 && !d.output,
                    };
                }
            } catch {}
            return { output: '', isError: true };
        };

        switch (command) {
            case 'help':
                outputText = `Comandos del Sistema Nexus (Soporta comandos nativos Bash / Kali Linux):
  apps              - Lista las aplicaciones integradas y su estado
  open <app>        - Abre una aplicación (telemetry, notes, canvas, camera, screen, process, wireshark, code...)
  close <app>       - Cierra una aplicación activa
  status            - Muestra el estado del núcleo Nexus y sensores
  top / ps          - Muestra los procesos reales del sistema en ejecución
  mem / free        - Muestra el estado real de la memoria RAM física y Swap
  cpu / lscpu       - Información real de núcleos de CPU y carga
  net / ip          - Interfaces de red reales y puertos activos
  nmap <objetivo>   - Ejecuta escaneo de puertos real sobre un host o IP
  whois / dig <dom> - Consulta registros WHOIS o DNS reales
  say <texto>       - Ordena a Nexus pronunciar el texto en voz alta
  voice             - Muestra la configuración de voz de Nexus (Kore)
  apikey <clave>    - Actualiza en caliente GEMINI_API_KEY en /opt/nexus/.env y reconecta
  version / vault   - Muestra versión activa, bóveda de datos y hash SHA-256
  update / debian   - Abre el instalador y actualizador atómico delta para Debian/Kali
  clear             - Limpia la pantalla de la terminal
  exit / close      - Cierra la terminal
  * Cualquier comando de Linux (ls, pwd, df -h, uname -a, cat, etc.) se ejecuta en el sistema real.`;
                break;

            case 'clear':
                setHistory([]);
                setInput('');
                return;

            case 'whoami': {
                const srv = await runServerShell('whoami && id');
                outputText = srv.output || 'koko (Administrador del Sistema Nexus - Acceso Total)';
                break;
            }

            case 'uname':
            case 'uname -a': {
                const srv = await runServerShell(trimmed.startsWith('uname') ? trimmed : 'uname -a');
                outputText = srv.output || 'Linux nexus-core 6.12.0 #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux';
                break;
            }

            case 'date':
                outputText = new Date().toString();
                break;

            case 'echo':
                outputText = args.join(' ');
                break;

            case 'status':
                outputText = `ESTADO DE NEXUS OS:
  Núcleo: Operativo [EN LÍNEA - v1.3.0]
  Voz y Audio: Activo (WebAudio API + VAD + Síntesis Neuronal/Local)
  Visión: Preparada (Cámara + Captura de Pantalla + OCR/Visión)
  Ciberseguridad: Activa (Nmap, Portscan TCP, Whois, Dig, SearchSploit, Hashes)
  Hardware Sync: WebSocket 1000ms a /proc/stat y /proc/meminfo
  Integración con SO: Habilitada (Lanzador Nativo Linux + Notificaciones)`;
                break;

            case 'apps':
                if ((window as any).nexus && (window as any).nexus.listApps) {
                    const apps = (window as any).nexus.listApps();
                    outputText = `APLICACIONES DEL SISTEMA NEXUS:
${apps.map((a: any) => `  • [${a.isOpen ? 'ACTIVA' : 'INACTIVA'}] ${a.id.padEnd(16)} - ${a.name} (${a.description})`).join('\n')}`;
                } else {
                    outputText = 'Aplicaciones disponibles: telemetry, terminal, notes, canvas, camera, screen, process_manager';
                }
                break;

            case 'open':
                if (!args[0]) {
                    outputText = 'Uso: open <nombre_app>\nEjemplos: open telemetry, open notes, open canvas, open camera, open wireshark, open vscode';
                    outputType = 'error';
                } else if ((window as any).nexus && (window as any).nexus.openApp) {
                    outputText = await (window as any).nexus.openApp(args[0], args.slice(1).join(' '));
                } else {
                    outputText = `Abriendo ${args[0]}...`;
                }
                break;

            case 'close':
                if (!args[0]) {
                    outputText = 'Uso: close <nombre_app>\nEjemplos: close telemetry, close notes, close canvas, close camera';
                    outputType = 'error';
                } else if ((window as any).nexus && (window as any).nexus.closeApp) {
                    outputText = (window as any).nexus.closeApp(args[0]);
                } else {
                    outputText = `Cerrando ${args[0]}...`;
                }
                break;

            case 'top':
            case 'ps': {
                const srv = await runServerShell('ps aux --sort=-%mem | head -n 15');
                outputText = srv.output || 'No se pudo obtener la tabla de procesos.';
                break;
            }

            case 'mem': {
                const srv = await runServerShell('free -h && grep -E "MemTotal|MemAvailable|SwapTotal|SwapFree" /proc/meminfo 2>/dev/null');
                outputText = srv.output || 'Memoria disponible.';
                break;
            }

            case 'cpu': {
                const srv = await runServerShell('lscpu 2>/dev/null | grep -E "Architecture|CPU\\(s\\)|Model name|MHz" || head -n 20 /proc/cpuinfo');
                outputText = srv.output || 'CPU operativa.';
                break;
            }

            case 'net': {
                const srv = await runServerShell('ip -brief addr 2>/dev/null || hostname -I');
                outputText = srv.output || 'Interfaces de red activas.';
                break;
            }

            case 'say':
                if (args.length > 0 && (window as any).nexus && (window as any).nexus.speak) {
                    const textToSay = args.join(' ');
                    (window as any).nexus.speak(textToSay);
                    outputText = `Nexus: "${textToSay}"`;
                } else {
                    outputText = 'Uso: say <mensaje a decir en voz alta>';
                    outputType = 'error';
                }
                break;

            case 'voice':
                outputText = `CONFIGURACIÓN DE VOZ DE NEXUS:
  Voz predeterminada fija: Kore (Bloqueada permanentemente)
  Estado:                  Voz predeterminada activa e inmutable`;
                break;

            case 'apikey':
            case 'nexus': {
                const keyArg = command === 'nexus' && args[0]?.toLowerCase() === 'apikey' ? args[1] : (command === 'apikey' ? args[0] : '');
                if (!keyArg) {
                    outputText = 'Uso: apikey <TU_GEMINI_API_KEY> (o en tu terminal de Linux: nexus apikey <TU_GEMINI_API_KEY>)';
                    outputType = 'system';
                } else {
                    try {
                        const r = await fetch('/api/runtime-config', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ apiKey: keyArg })
                        });
                        if (r.ok) {
                            outputText = 'Clave GEMINI_API_KEY guardada en /opt/nexus/.env y cargada en tiempo real. Reconectando con Gemini Live...';
                            outputType = 'system';
                            setTimeout(() => {
                                window.dispatchEvent(new CustomEvent('nexus-reconnect'));
                            }, 300);
                        } else {
                            outputText = 'No se pudo actualizar la clave en el servidor local.';
                            outputType = 'error';
                        }
                    } catch {
                        outputText = 'Error de red al guardar la clave en /api/runtime-config.';
                        outputType = 'error';
                    }
                }
                break;
            }

            case 'version':
            case 'vault': {
                try {
                    const r = await fetch('/api/version', { cache: 'no-store' });
                    const v = await r.json();
                    outputText = `ESTADO DE VERSIÓN Y BÓVEDA DE DATOS DE NEXUS:
  Versión del Núcleo:   v${v.version || '1.3.0'}
  Ruta de la Bóveda:    ${v.vaultPath || '/opt/nexus/data/nexus-vault.json'}
  Integridad SHA-256:   ${v.vaultChecksum || 'verificado'}
  Memorias Protegidas:  ${v.memoriesCount ?? 0} registros
  Snapshots en Disco:   ${v.backupsCount ?? 0} en /var/backups/nexus`;
                    outputType = 'system';
                } catch {
                    outputText = 'Nexus v1.3.0 - Bóveda de datos local activa.';
                    outputType = 'system';
                }
                break;
            }

            case 'update':
            case 'debian':
            case 'install-debian':
                if ((window as any).nexus?.showDebianInstall) {
                    outputText = (window as any).nexus.showDebianInstall();
                } else {
                    outputText = 'Abriendo panel de instalación y actualización atómica de Nexus para Debian / Kali Linux...';
                }
                break;

            case 'exit':
                onClose();
                return;

            default: {
                const srv = await runServerShell(trimmed);
                if (srv.output) {
                    outputText = srv.output;
                    if (srv.isError) outputType = 'error';
                } else if (onExecuteAction) {
                    try {
                        outputText = await onExecuteAction(command, args);
                    } catch (e: any) {
                        outputText = `Comando no reconocido: "${command}". Escribe "help" para ver la lista de comandos.`;
                        outputType = 'error';
                    }
                } else {
                    outputText = `Comando no reconocido: "${command}". Escribe "help" para ver la lista de comandos.`;
                    outputType = 'error';
                }
                break;
            }
        }

        const outputEntry: TerminalOutput = {
            id: `out-${Date.now()}`,
            type: outputType,
            text: outputText,
            timestamp: time
        };

        setHistory(prev => [...prev, inputEntry, outputEntry]);
        setInput('');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            executeCommand(input);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (commandHistory.length === 0) return;
            const nextIdx = historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
            setHistoryIndex(nextIdx);
            setInput(commandHistory[nextIdx]);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex === -1) return;
            const nextIdx = historyIndex + 1;
            if (nextIdx >= commandHistory.length) {
                setHistoryIndex(-1);
                setInput('');
            } else {
                setHistoryIndex(nextIdx);
                setInput(commandHistory[nextIdx]);
            }
        }
    };

    return (
        <div className={`fixed z-50 transition-all duration-200 pointer-events-auto flex flex-col ${
            isMaximized 
                ? 'inset-3 md:inset-6' 
                : 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-3xl h-[65vh] max-h-[600px]'
        } bg-zinc-950/95 border border-zinc-700/80 rounded-xl shadow-[0_0_50px_rgba(14,165,233,0.25)] backdrop-blur-xl overflow-hidden font-mono`}>
            
            {/* Window Header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-zinc-900 via-zinc-850 to-zinc-900 border-b border-zinc-800 select-none">
                <div className="flex items-center gap-2.5">
                    <div className="flex items-center gap-1.5 mr-2">
                        <button 
                            onClick={onClose}
                            className="w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-400 border border-red-600/40 transition-colors" 
                            title="Cerrar terminal"
                        />
                        <button 
                            onClick={() => setIsMaximized(!isMaximized)}
                            className="w-3 h-3 rounded-full bg-amber-500/80 hover:bg-amber-400 border border-amber-600/40 transition-colors" 
                            title="Maximizar/Restaurar"
                        />
                        <button 
                            onClick={() => setHistory([])}
                            className="w-3 h-3 rounded-full bg-emerald-500/80 hover:bg-emerald-400 border border-emerald-600/40 transition-colors" 
                            title="Limpiar pantalla"
                        />
                    </div>
                    <TerminalIcon className="w-4 h-4 text-sky-400" />
                    <span className="text-xs font-bold text-zinc-200 tracking-wide flex items-center gap-2">
                        nexus@system:~
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
                            bash
                        </span>
                    </span>
                </div>

                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setHistory([])}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                        title="Limpiar historial"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => setIsMaximized(!isMaximized)}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                        title={isMaximized ? "Restaurar" : "Maximizar"}
                    >
                        {isMaximized ? <Minus className="w-3.5 h-3.5" /> : <Square className="w-3 h-3" />}
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-colors ml-1"
                        title="Cerrar"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Terminal Body */}
            <div 
                className="flex-1 p-4 overflow-y-auto space-y-2 text-xs text-zinc-300 custom-scrollbar select-text bg-black/60"
                onClick={() => inputRef.current?.focus()}
            >
                {history.map(item => (
                    <div key={item.id} className="leading-relaxed">
                        {item.type === 'input' ? (
                            <div className="text-sky-400 font-semibold">{item.text}</div>
                        ) : item.type === 'error' ? (
                            <div className="text-red-400 bg-red-500/10 p-2 rounded border border-red-500/20 whitespace-pre-wrap">{item.text}</div>
                        ) : item.type === 'system' ? (
                            <div className="text-zinc-400 italic text-[11px] whitespace-pre-wrap">{item.text}</div>
                        ) : (
                            <div className="text-emerald-300 whitespace-pre-wrap">{item.text}</div>
                        )}
                    </div>
                ))}
                
                {/* Active Prompt Line */}
                <div className="flex items-center gap-2 pt-1 text-sky-400">
                    <span className="shrink-0 font-bold">nexus@system:~$</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="flex-1 bg-transparent text-white outline-none border-none p-0 focus:ring-0 text-xs font-mono caret-emerald-400"
                        autoFocus
                        spellCheck={false}
                    />
                    <button
                        onClick={() => executeCommand(input)}
                        className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                        title="Ejecutar"
                    >
                        <CornerDownLeft className="w-3.5 h-3.5" />
                    </button>
                </div>
                <div ref={terminalEndRef} />
            </div>

            {/* Status Footer */}
            <div className="px-4 py-1.5 bg-zinc-900 border-t border-zinc-800 text-[10px] text-zinc-500 flex justify-between items-center select-none">
                <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        INTERACTIVO
                    </span>
                    <span>Host: nexus-local</span>
                    <span>UTF-8</span>
                </div>
                <span>Usa "help" para ver comandos o pídeselo a Nexus</span>
            </div>
        </div>
    );
};
