import React, { useState, useMemo } from 'react';
import { 
    Terminal, 
    X, 
    Copy, 
    Check, 
    Download, 
    Server, 
    Shield, 
    Cpu, 
    Play, 
    Search,
    CheckCircle2,
    ChevronRight,
    FileCode
} from 'lucide-react';

interface DebianInstallPanelProps {
    onClose: () => void;
}

interface CommandStep {
    id: string;
    number: string;
    category: 'base' | 'node' | 'nexus' | 'systemd' | 'desktop' | 'local_ai';
    title: string;
    description: string;
    command: string;
    verifyCommand?: string;
    notes?: string;
}

export const DebianInstallPanel: React.FC<DebianInstallPanelProps> = ({ onClose }) => {
    const [installPath, setInstallPath] = useState('/opt/nexus');
    const [sysUser, setSysUser] = useState('koko');
    const [port, setPort] = useState('3000');
    const [activeCategory, setActiveCategory] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [copiedAll, setCopiedAll] = useState(false);
    const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>({});

    const steps: CommandStep[] = useMemo(() => [
        {
            id: 'step-1-apt',
            number: '01',
            category: 'base',
            title: 'Actualizar repositorios y dependencias del sistema en Debian',
            description: 'Instala las herramientas de compilación, utilidades de audio/vídeo (ALSA, PulseAudio, PipeWire, V4L2) y paquetes base requeridos por Nexus.',
            command: `sudo apt update && sudo apt full-upgrade -y
sudo apt install -y curl wget git build-essential ca-certificates gnupg lsb-release \\
  alsa-utils pulseaudio pipewire-audio-client-libraries v4l-utils xdg-utils ufw`,
            verifyCommand: 'uname -a && lsb_release -a',
            notes: 'Compatible con Debian 12 (Bookworm), Debian 13 (Trixie) y derivados.'
        },
        {
            id: 'step-2-node',
            number: '02',
            category: 'node',
            title: 'Instalar Node.js 22 LTS (Repositorio Oficial NodeSource)',
            description: 'Configura el repositorio oficial de NodeSource para Debian e instala Node.js 22 junto con npm y tsx global.',
            command: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g npm@latest tsx pm2`,
            verifyCommand: 'node -v && npm -v',
            notes: 'Nexus utiliza módulos ES modernos y esbuild para compilación de servidor.'
        },
        {
            id: 'step-3-permissions',
            number: '03',
            category: 'base',
            title: 'Permisos de Hardware (Audio, Vídeo, Sensores y Red)',
            description: `Otorga al usuario "${sysUser}" acceso directo sin bloqueos a la cámara, micrófono, interfaces de red y telemetría del kernel (/proc).`,
            command: `sudo usermod -aG audio,video,plugdev,netdev,adm,dialout ${sysUser}`,
            verifyCommand: `groups ${sysUser}`,
            notes: 'Permite a Nexus leer métricas físicas y controlar periféricos de audio y vídeo.'
        },
        {
            id: 'step-4-clone',
            number: '04',
            category: 'nexus',
            title: 'Preparar directorio e instalar el núcleo de Nexus',
            description: `Crea el directorio del sistema en ${installPath}, descarga el código fuente, instala dependencias y compila el binario de producción.`,
            command: `sudo mkdir -p ${installPath}
sudo chown -R ${sysUser}:${sysUser} ${installPath}
cd ${installPath}
# Si ya tienes el código descargado, cópialo aquí o clona tu repositorio:
# git clone https://github.com/tu-usuario/nexus.git .
npm install
npm run build`,
            verifyCommand: `ls -la ${installPath}/dist/server.cjs`,
            notes: 'El comando "npm run build" genera el cliente optimizado con Vite y el servidor compilado en dist/server.cjs.'
        },
        {
            id: 'step-5-env',
            number: '05',
            category: 'nexus',
            title: 'Configurar variables de entorno (.env)',
            description: 'Crea el archivo de configuración con la clave de Gemini y el puerto del sistema.',
            command: `cat << 'EOF' > ${installPath}/.env
PORT=${port}
NODE_ENV=production
GEMINI_API_KEY="TU_CLAVE_AQUI"
EOF
chmod 600 ${installPath}/.env`,
            verifyCommand: `cat ${installPath}/.env`,
            notes: 'El permiso 600 protege el archivo para que solo tu usuario pueda leerlo.'
        },
        {
            id: 'step-6-systemd',
            number: '06',
            category: 'systemd',
            title: 'Crear servicio nativo Systemd (Arranque automático con Debian)',
            description: 'Integra Nexus como un demonio del sistema operativo Debian que se inicia automáticamente al encender el equipo y se reinicia si ocurre algún fallo.',
            command: `sudo tee /etc/systemd/system/nexus.service > /dev/null << EOF
[Unit]
Description=Nexus OS - Nucleo de Inteligencia Artificial de Koko
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
User=${sysUser}
WorkingDirectory=${installPath}
EnvironmentFile=${installPath}/.env
ExecStart=/usr/bin/node ${installPath}/dist/server.cjs
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now nexus.service`,
            verifyCommand: 'sudo systemctl status nexus.service',
            notes: 'Usa "journalctl -u nexus.service -f" para ver los logs de Nexus en tiempo real.'
        },
        {
            id: 'step-7-desktop',
            number: '07',
            category: 'desktop',
            title: 'Integración de Escritorio (.desktop) y Lanzador con Permisos de Cámara/Voz',
            description: 'Crea el lanzador oficial de aplicación en el menú de Debian (GNOME/KDE/XFCE) con permisos automáticos de micrófono, cámara y captura de pantalla PipeWire.',
            command: `sudo apt install -y chromium
sudo tee /usr/share/applications/nexus-ai.desktop > /dev/null << EOF
[Desktop Entry]
Name=Nexus AI
Comment=Compañera e Inteligencia del Sistema de Koko
Exec=chromium --app=http://localhost:${port} --use-fake-ui-for-media-stream --enable-features=WebRTCPipeWireCapturer --start-maximized
Icon=utilities-terminal
Terminal=false
Type=Application
Categories=System;Utility;ArtificialIntelligence;
StartupNotify=true
EOF
sudo update-desktop-database`,
            verifyCommand: `gtk-launch nexus-ai.desktop || chromium --app=http://localhost:${port} &`,
            notes: 'El flag --use-fake-ui-for-media-stream concede acceso inmediato a cámara y micrófono sin pedir confirmación cada vez.'
        },
        {
            id: 'step-8-ollama',
            number: '08',
            category: 'local_ai',
            title: 'Instalar Motor Local Offline (Ollama en Debian) + CORS para Nexus',
            description: 'Opcional: Instala Ollama en Debian y habilita el acceso local para que Nexus pueda usar modelos locales cuando no haya internet.',
            command: `curl -fsSL https://ollama.com/install.sh | sh
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf > /dev/null << 'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_ORIGINS=*"
EOF
sudo systemctl daemon-reload
sudo systemctl restart ollama
ollama pull llama3.2`,
            verifyCommand: 'curl http://localhost:11434/api/tags',
            notes: 'Permite a Nexus conmutar automáticamente a IA local si se corta la conexión.'
        }
    ], [installPath, sysUser, port]);

    const filteredSteps = useMemo(() => {
        return steps.filter(step => {
            const matchesCat = activeCategory === 'all' || step.category === activeCategory;
            const q = searchQuery.toLowerCase().trim();
            const matchesQuery = !q || 
                step.title.toLowerCase().includes(q) || 
                step.description.toLowerCase().includes(q) || 
                step.command.toLowerCase().includes(q);
            return matchesCat && matchesQuery;
        });
    }, [steps, activeCategory, searchQuery]);

    const fullInstallScript = useMemo(() => {
        return `#!/usr/bin/env bash
# ==============================================================================
# INSTALADOR AUTOMÁTICO DE NEXUS OS PARA DEBIAN LINUX (12 Bookworm / 13 Trixie)
# Configurado para: ${sysUser} | Ruta: ${installPath} | Puerto: ${port}
# ==============================================================================
set -e

echo "[1/7] Actualizando paquetes de Debian e instalando dependencias base..."
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y curl wget git build-essential ca-certificates gnupg lsb-release \\
  alsa-utils pulseaudio pipewire-audio-client-libraries v4l-utils xdg-utils chromium

echo "[2/7] Instalando Node.js 22 LTS..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi
sudo npm install -g tsx pm2

echo "[3/7] Configurando grupos de hardware para ${sysUser}..."
sudo usermod -aG audio,video,plugdev,netdev,adm,dialout ${sysUser} || true

echo "[4/7] Preparando directorio ${installPath}..."
sudo mkdir -p ${installPath}
sudo chown -R ${sysUser}:${sysUser} ${installPath}

if [ -f "package.json" ]; then
  cp -r ./* ${installPath}/
fi

cd ${installPath}
if [ -f "package.json" ]; then
  npm install
  npm run build
fi

echo "[5/7] Creando archivo .env si no existe..."
if [ ! -f "${installPath}/.env" ]; then
  cat << 'EOF' > ${installPath}/.env
PORT=${port}
NODE_ENV=production
GEMINI_API_KEY="TU_CLAVE_GEMINI_AQUI"
EOF
  chmod 600 ${installPath}/.env
fi

echo "[6/7] Configurando servicio systemd nexus.service..."
sudo tee /etc/systemd/system/nexus.service > /dev/null << EOF
[Unit]
Description=Nexus OS - Nucleo de Inteligencia Artificial de Koko
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
User=${sysUser}
WorkingDirectory=${installPath}
EnvironmentFile=${installPath}/.env
ExecStart=/usr/bin/node ${installPath}/dist/server.cjs
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable nexus.service

echo "[7/7] Creando lanzador de escritorio en Debian..."
sudo tee /usr/share/applications/nexus-ai.desktop > /dev/null << EOF
[Desktop Entry]
Name=Nexus AI
Comment=Compañera e Inteligencia del Sistema de Koko
Exec=chromium --app=http://localhost:${port} --use-fake-ui-for-media-stream --enable-features=WebRTCPipeWireCapturer --start-maximized
Icon=utilities-terminal
Terminal=false
Type=Application
Categories=System;Utility;
StartupNotify=true
EOF

echo "=============================================================================="
echo " Instalación de Nexus en Debian completada."
echo " 1. Edita tu clave en: nano ${installPath}/.env"
echo " 2. Inicia el servicio: sudo systemctl start nexus.service"
echo " 3. Abre Nexus en: http://localhost:${port}"
echo "=============================================================================="
`;
    }, [installPath, sysUser, port]);

    const handleCopy = (id: string, text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleCopyAll = () => {
        navigator.clipboard.writeText(fullInstallScript);
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 2500);
    };

    const handleDownloadScript = () => {
        const blob = new Blob([fullInstallScript], { type: 'text/x-shellscript' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'install-nexus-debian.sh';
        a.click();
        URL.revokeObjectURL(url);
    };

    const toggleStepDone = (id: string) => {
        setCompletedSteps(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const completedCount = Object.values(completedSteps).filter(Boolean).length;

    return (
        <div className="fixed inset-3 md:inset-6 lg:inset-10 z-50 bg-slate-950/95 border border-slate-800 rounded-xl shadow-2xl backdrop-blur-xl flex flex-col pointer-events-auto overflow-hidden text-slate-100">
            {/* Top Bar Contract: Zone 1 (Title) - Zone 2 (Category Tabs) - Zone 3 (Primary Actions) */}
            <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-slate-900/90 border-b border-slate-800 shrink-0">
                <div className="flex items-center gap-3">
                    <Terminal className="w-5 h-5 text-rose-500 shrink-0" />
                    <h2 className="text-base font-semibold tracking-tight text-white whitespace-nowrap">
                        Instalación de Nexus en Debian Linux
                    </h2>
                </div>

                {/* Category Filter Buttons */}
                <nav className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg overflow-x-auto">
                    {[
                        { id: 'all', label: 'Todos los pasos' },
                        { id: 'base', label: 'Base y Permisos' },
                        { id: 'node', label: 'Node.js 22' },
                        { id: 'nexus', label: 'Núcleo Nexus' },
                        { id: 'systemd', label: 'Servicio Systemd' },
                        { id: 'desktop', label: 'App Escritorio' },
                        { id: 'local_ai', label: 'IA Local' },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveCategory(tab.id)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                                activeCategory === tab.id
                                    ? 'bg-rose-600 text-white'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>

                {/* Primary Actions */}
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={handleCopyAll}
                        className="px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                        title="Copiar el script bash completo de instalación"
                    >
                        {copiedAll ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedAll ? 'Script copiado' : 'Copiar script .sh'}</span>
                    </button>
                    <button
                        onClick={handleDownloadScript}
                        className="px-3.5 py-2 text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                        title="Descargar archivo install-nexus-debian.sh"
                    >
                        <Download className="w-3.5 h-3.5" />
                        <span>Descargar .sh</span>
                    </button>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors ml-1"
                        title="Cerrar panel de instalación"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
            </header>

            {/* Configuration & Search Sub-bar */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 px-6 py-3 bg-slate-900/40 border-b border-slate-800/80 text-xs shrink-0 items-center">
                <div className="md:col-span-4 relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Buscar comando, paquete o servicio (ej: systemd, audio, node)..."
                        className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500/60"
                    />
                </div>

                <div className="md:col-span-8 flex flex-wrap items-center justify-end gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-slate-400">Usuario Debian:</span>
                        <input
                            type="text"
                            value={sysUser}
                            onChange={(e) => setSysUser(e.target.value || 'koko')}
                            className="w-24 px-2.5 py-1 bg-slate-950 border border-slate-800 rounded text-slate-200 font-mono text-xs focus:outline-none focus:border-rose-500/60"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-slate-400">Ruta:</span>
                        <input
                            type="text"
                            value={installPath}
                            onChange={(e) => setInstallPath(e.target.value || '/opt/nexus')}
                            className="w-32 px-2.5 py-1 bg-slate-950 border border-slate-800 rounded text-slate-200 font-mono text-xs focus:outline-none focus:border-rose-500/60"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-slate-400">Puerto:</span>
                        <input
                            type="text"
                            value={port}
                            onChange={(e) => setPort(e.target.value || '3000')}
                            className="w-16 px-2.5 py-1 bg-slate-950 border border-slate-800 rounded text-slate-200 font-mono tabular-nums text-xs focus:outline-none focus:border-rose-500/60"
                        />
                    </div>
                    <div className="text-slate-400 font-mono tabular-nums pl-2 border-l border-slate-800">
                        Progreso: <span className="text-emerald-400 font-semibold">{completedCount}/{steps.length}</span>
                    </div>
                </div>
            </div>

            {/* Main Steps List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
                {/* Quick One-Liner Execution Banner */}
                <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-rose-400 font-medium">
                            <FileCode className="w-4 h-4" />
                            <span>Ejecución Rápida Todo-en-Uno (Debian 12 / 13)</span>
                        </div>
                        <p className="text-xs text-slate-400">
                            Si descargas el instalador con el botón superior <strong className="text-slate-200">Descargar .sh</strong>, ejecútalo en tu terminal de Debian con este comando:
                        </p>
                    </div>
                    <div className="flex items-center gap-2 bg-slate-950 px-3.5 py-2 rounded-lg border border-slate-800 font-mono text-xs text-emerald-400 shrink-0">
                        <span>chmod +x install-nexus-debian.sh && sudo ./install-nexus-debian.sh</span>
                        <button
                            onClick={() => handleCopy('oneliner', 'chmod +x install-nexus-debian.sh && sudo ./install-nexus-debian.sh')}
                            className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors ml-2"
                            title="Copiar comando"
                        >
                            {copiedId === 'oneliner' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                    </div>
                </div>

                {/* Step Cards */}
                <div className="space-y-4">
                    {filteredSteps.map((step) => {
                        const isDone = !!completedSteps[step.id];
                        return (
                            <div
                                key={step.id}
                                className={`p-5 rounded-xl border transition-colors ${
                                    isDone
                                        ? 'bg-slate-900/30 border-emerald-900/60'
                                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                                }`}
                            >
                                <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                                    <div className="flex items-start gap-3">
                                        <button
                                            onClick={() => toggleStepDone(step.id)}
                                            className={`mt-0.5 w-6 h-6 rounded-md flex items-center justify-center border text-xs font-mono tabular-nums transition-colors shrink-0 ${
                                                isDone
                                                    ? 'bg-emerald-600 border-emerald-500 text-white'
                                                    : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500'
                                            }`}
                                            title="Marcar paso como completado"
                                        >
                                            {isDone ? <Check className="w-3.5 h-3.5" /> : step.number}
                                        </button>
                                        <div>
                                            <h3 className={`text-sm font-semibold ${isDone ? 'text-emerald-300 line-through' : 'text-white'}`}>
                                                {step.number}. {step.title}
                                            </h3>
                                            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                                {step.description}
                                            </p>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => handleCopy(step.id, step.command)}
                                        className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-medium transition-colors flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                                    >
                                        {copiedId === step.id ? (
                                            <>
                                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                                <span className="text-emerald-400">Copiado</span>
                                            </>
                                        ) : (
                                            <>
                                                <Copy className="w-3.5 h-3.5 text-slate-400" />
                                                <span>Copiar comandos</span>
                                            </>
                                        )}
                                    </button>
                                </div>

                                {/* Command Block */}
                                <div className="bg-slate-950 border border-slate-800/90 rounded-lg p-3.5 font-mono text-xs text-sky-300 overflow-x-auto select-all leading-relaxed">
                                    <pre className="whitespace-pre-wrap break-words">{step.command}</pre>
                                </div>

                                {/* Footer metadata / verification */}
                                {(step.verifyCommand || step.notes) && (
                                    <div className="mt-3 pt-3 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                                        {step.notes && (
                                            <span>{step.notes}</span>
                                        )}
                                        {step.verifyCommand && (
                                            <div className="flex items-center gap-2 font-mono text-[11px] text-slate-300 bg-slate-950/80 px-2.5 py-1 rounded border border-slate-800">
                                                <span className="text-slate-500">Verificar:</span>
                                                <span className="text-emerald-400">{step.verifyCommand}</span>
                                                <button
                                                    onClick={() => handleCopy(`${step.id}-verify`, step.verifyCommand!)}
                                                    className="text-slate-500 hover:text-white ml-1"
                                                    title="Copiar comando de verificación"
                                                >
                                                    {copiedId === `${step.id}-verify` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Quiet Footer */}
            <footer className="px-6 py-3 bg-slate-900 border-t border-slate-800 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-4 shrink-0">
                <div className="flex items-center gap-2">
                    <span>Debian GNU/Linux 12 (Bookworm) · Debian 13 (Trixie)</span>
                    <span aria-hidden="true">·</span>
                    <span>Arquitectura x86_64 / ARM64</span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-slate-500">Para cerrar este panel, dile: "Nexus, cierra el panel de Debian"</span>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-medium transition-colors"
                    >
                        Cerrar
                    </button>
                </div>
            </footer>
        </div>
    );
};
