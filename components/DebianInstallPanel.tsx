import React, { useState, useMemo, useEffect } from 'react';
import { 
    Terminal, 
    X, 
    Copy, 
    Check, 
    Download, 
    Search,
    FileCode,
    Package,
    CheckCircle2,
    Loader2
} from 'lucide-react';

interface DebianInstallPanelProps {
    onClose: () => void;
}

interface CommandStep {
    id: string;
    number: string;
    category: 'deb_package' | 'base' | 'node' | 'nexus' | ' local_ai';
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
    const [distroMode, setDistroMode] = useState<'universal' | 'kali' | 'debian'>('universal');
    const [activeCategory, setActiveCategory] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [copiedShortCmd, setCopiedShortCmd] = useState(false);
    const [copiedFullPayload, setCopiedFullPayload] = useState(false);
    const [downloadedInstaller, setDownloadedInstaller] = useState(false);
    const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>({});

    const [payloadData, setPayloadData] = useState<{
        selfExtractingScript: string;
        pasteCommand: string;
        sizeKB: number;
    } | null>(null);
    const [loadingPayload, setLoadingPayload] = useState(true);

    useEffect(() => {
        let active = true;
        setLoadingPayload(true);
        fetch(`/api/installer-payload?user=${encodeURIComponent(sysUser)}&port=${encodeURIComponent(port)}&t=${Date.now()}`, { cache: 'no-store' })
            .then(r => r.json())
            .then(data => {
                if (active && data?.selfExtractingScript) {
                    setPayloadData(data);
                }
            })
            .catch(err => console.error('Error loading self-contained payload:', err))
            .finally(() => {
                if (active) setLoadingPayload(false);
            });
        return () => { active = false; };
    }, [sysUser, port]);

    // Short 1-line command that automatically locates nexus-installer.sh in ~/Descargas, ~/Downloads or current dir
    const runDownloadedOneLiner = useMemo(() => {
        return `sudo NEXUS_USER="${sysUser}" NEXUS_PORT="${port}" bash "$(ls -t ~/Descargas/nexus-installer*.sh ~/Downloads/nexus-installer*.sh ./nexus-installer*.sh 2>/dev/null | head -n 1)"`;
    }, [sysUser, port]);

    const handleDownloadSelfContainedInstaller = () => {
        if (!payloadData?.selfExtractingScript) return;
        const blob = new Blob([payloadData.selfExtractingScript], { type: 'text/x-shellscript;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'nexus-installer.sh';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setDownloadedInstaller(true);
        setTimeout(() => setDownloadedInstaller(false), 4000);
    };

    const handleCopyShortOneLiner = () => {
        navigator.clipboard.writeText(runDownloadedOneLiner);
        setCopiedShortCmd(true);
        setTimeout(() => setCopiedShortCmd(false), 2500);
    };

    const handleCopyFullEmbeddedCommand = () => {
        if (!payloadData?.pasteCommand) return;
        navigator.clipboard.writeText(payloadData.pasteCommand);
        setCopiedFullPayload(true);
        setTimeout(() => setCopiedFullPayload(false), 3000);
    };

    const steps: CommandStep[] = useMemo(() => [
        {
            id: 'step-0-deb-pkg',
            number: '01',
            category: 'deb_package',
            title: 'Ejecutar el Auto-Instalador de Paquete (.deb) en 1 Comando (Debian y Kali Linux)',
            description: 'Una vez descargado el archivo auto-contenido "nexus-installer.sh" con el botón superior (que ya incluye todo el código fuente de Nexus en Base64 sin pasar por el bloqueo HTML del navegador), ejecuta este comando único en tu terminal:',
            command: runDownloadedOneLiner,
            verifyCommand: 'dpkg -l | grep nexus-ai && nexus status',
            notes: 'Detecta automáticamente si tu carpeta se llama ~/Descargas o ~/Downloads y construye e instala nexus-ai_1.0.0_amd64.deb.'
        },
        {
            id: 'step-1-apt',
            number: '02',
            category: 'base',
            title: 'Dependencias Base, Multimedia y Herramientas de Kali / Debian',
            description: 'Instala compiladores, soporte de empaquetado dpkg-dev, audio/vídeo (ALSA, PulseAudio, V4L2) y utilidades de red/ciberseguridad para Nexus.',
            command: `sudo apt update && sudo apt full-upgrade -y
sudo apt install -y curl wget git build-essential ca-certificates gnupg lsb-release dpkg-dev \\
  alsa-utils pulseaudio v4l-utils xdg-utils chromium \\
  nmap dnsutils whois iproute2 net-tools`,
            verifyCommand: 'uname -a && grep PRETTY_NAME /etc/os-release',
            notes: 'Compatible con Kali Linux Rolling, Kali Purple, Debian 12 (Bookworm) y Debian 13 (Trixie).'
        },
        {
            id: 'step-2-node',
            number: '03',
            category: 'node',
            title: 'Instalar Node.js 22 LTS (Repositorio NodeSource "nodistro" para Debian y Kali)',
            description: 'Usa la rama "nodistro" firmada por GPG para que APT en Kali Rolling y Debian instale Node.js 22 LTS sin errores de codename.',
            command: `sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
sudo apt update && sudo apt install -y nodejs
sudo npm install -g npm@latest tsx pm2`,
            verifyCommand: 'node -v && npm -v',
            notes: 'Al usar "nodistro", Kali Linux no falla al comprobar la versión de la distribución.'
        },
        {
            id: 'step-3-permissions',
            number: '04',
            category: 'base',
            title: 'Permisos de Hardware y Grupos de Kali / Debian',
            description: `Otorga al usuario "${sysUser}" acceso directo a cámara, micrófono, interfaces de red, captura de paquetes y telemetría (/proc).`,
            command: `for grp in audio video plugdev netdev adm dialout wireshark kaboxer; do
  getent group "$grp" >/dev/null && sudo usermod -aG "$grp" ${sysUser}
done`,
            verifyCommand: `groups ${sysUser}`,
            notes: 'Detecta automáticamente grupos específicos de Kali Linux (wireshark, kaboxer) y de Debian.'
        },
        {
            id: 'step-4-cli',
            number: '05',
            category: 'nexus',
            title: 'Comandos del Paquete Instalado (CLI /usr/bin/nexus)',
            description: 'Una vez instalado el paquete nexus-ai, tienes el comando global "nexus" disponible desde cualquier terminal de Debian o Kali Linux.',
            command: `# 1. Configurar tu clave de API de Gemini y reiniciar el demonio automáticamente:
nexus apikey "TU_CLAVE_GEMINI_AQUI"

# 2. Abrir la interfaz de Nexus en modo App nativa (con permisos de micro y cámara):
nexus

# 3. Ver estado del servicio systemd o seguir los logs en vivo:
nexus status
nexus logs`,
            verifyCommand: 'which nexus && systemctl is-active nexus.service',
            notes: 'Para desinstalar el paquete en cualquier momento: sudo apt remove nexus-ai'
        },
        {
            id: 'step-5-ollama',
            number: '06',
            category: ' local_ai',
            title: 'Motor de IA Local Offline (Ollama en Debian / Kali Linux)',
            description: 'Opcional: Instala Ollama con soporte CORS para que Nexus conmute automáticamente a modelos locales si trabajas sin conexión.',
            command: `curl -fsSL https://ollama.com/install.sh | sh
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf > /dev/null << 'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_ORIGINS=*"
EOF
sudo systemctl daemon-reload && sudo systemctl restart ollama
ollama pull llama3.2`,
            verifyCommand: 'curl http://localhost:11434/api/tags',
            notes: 'Compatible con aceleración GPU en Debian y Kali Linux.'
        }
    ], [runDownloadedOneLiner, sysUser]);

    const filteredSteps = useMemo(() => {
        return steps.filter(step => {
            const matchesCat = activeCategory === 'all' || step.category.trim() === activeCategory;
            const q = searchQuery.toLowerCase().trim();
            const matchesQuery = !q || 
                step.title.toLowerCase().includes(q) || 
                step.description.toLowerCase().includes(q) || 
                step.command.toLowerCase().includes(q);
            return matchesCat && matchesQuery;
        });
    }, [steps, activeCategory, searchQuery]);

    const handleCopy = (id: string, text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const toggleStepDone = (id: string) => {
        setCompletedSteps(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const completedCount = Object.values(completedSteps).filter(Boolean).length;

    return (
        <div className="fixed inset-3 md:inset-6 lg:inset-8 z-50 bg-slate-950/95 border border-slate-800 rounded-xl shadow-2xl backdrop-blur-xl flex flex-col pointer-events-auto overflow-hidden text-slate-100">
            {/* Top Bar Contract: Zone 1 (Title) - Zone 2 (Category Tabs) - Zone 3 (Primary Actions) */}
            <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-slate-900/90 border-b border-slate-800 shrink-0">
                <div className="flex items-center gap-3">
                    <Package className="w-5 h-5 text-rose-500 shrink-0" />
                    <h2 className="text-base font-semibold tracking-tight text-white whitespace-nowrap">
                        Instalador de Paquete (.deb) para Debian y Kali Linux
                    </h2>
                </div>

                {/* Category Filter Buttons */}
                <nav className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg overflow-x-auto">
                    {[
                        { id: 'all', label: 'Todo' },
                        { id: 'deb_package', label: 'Paquete .deb (1 Comando)' },
                        { id: 'base', label: 'Dependencias Kali/Debian' },
                        { id: 'node', label: 'Node.js 22' },
                        { id: 'nexus', label: 'CLI Nexus' },
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
                        onClick={handleDownloadSelfContainedInstaller}
                        disabled={loadingPayload || !payloadData}
                        className="px-3.5 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                        title="Descarga el instalador auto-contenido con el código fuente embebido en Base64"
                    >
                        {loadingPayload ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : downloadedInstaller ? (
                            <Check className="w-3.5 h-3.5" />
                        ) : (
                            <Download className="w-3.5 h-3.5" />
                        )}
                        <span>
                            {loadingPayload
                                ? 'Empaquetando...'
                                : downloadedInstaller
                                ? 'nexus-installer.sh descargado'
                                : `Descargar nexus-installer.sh (${payloadData?.sizeKB || 128} KB)`}
                        </span>
                    </button>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors ml-1"
                        title="Cerrar panel"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
            </header>

            {/* Configuration & OS Selector Sub-bar */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 px-6 py-3 bg-slate-900/40 border-b border-slate-800/80 text-xs shrink-0 items-center">
                <div className="lg:col-span-4 relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Filtrar comando (ej: dpkg, kali, node, systemd)..."
                        className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500/60"
                    />
                </div>

                <div className="lg:col-span-8 flex flex-wrap items-center justify-end gap-3">
                    <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                        {[
                            { id: 'universal', label: 'Debian + Kali (Auto)' },
                            { id: 'kali', label: 'Kali Linux' },
                            { id: 'debian', label: 'Debian 12/13' }
                        ].map(d => (
                            <button
                                key={d.id}
                                onClick={() => setDistroMode(d.id as any)}
                                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                                    distroMode === d.id
                                        ? 'bg-slate-800 text-white'
                                        : 'text-slate-400 hover:text-slate-200'
                                }`}
                            >
                                {d.label}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-slate-400">Usuario:</span>
                        <input
                            type="text"
                            value={sysUser}
                            onChange={(e) => setSysUser(e.target.value || 'koko')}
                            className="w-20 px-2 py-1 bg-slate-950 border border-slate-800 rounded text-slate-200 font-mono text-xs focus:outline-none focus:border-rose-500/60"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-slate-400">Puerto:</span>
                        <input
                            type="text"
                            value={port}
                            onChange={(e) => setPort(e.target.value || '3000')}
                            className="w-16 px-2 py-1 bg-slate-950 border border-slate-800 rounded text-slate-200 font-mono tabular-nums text-xs focus:outline-none focus:border-rose-500/60"
                        />
                    </div>
                    <div className="text-slate-400 font-mono tabular-nums pl-2 border-l border-slate-800">
                        Pasos: <span className="text-emerald-400 font-semibold">{completedCount}/{steps.length}</span>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
                {/* HERO FOCAL ANCHOR: Proxy-Proof Self-Contained .deb Installer */}
                <div className="p-5 rounded-xl bg-slate-900/90 border border-rose-500/40 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-2 text-xs text-rose-400 font-semibold">
                                <Terminal className="w-4 h-4" />
                                <span>Instalación en Paquete (.deb) Todo-en-Uno — Sin error &quot;&lt;!doctype html&gt;&quot; (Código Fuente Embebido)</span>
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
                                Las URLs de previsualización de Cloud Run (<code className="text-slate-400">ais-dev-*.run.app</code>) bloquean <code className="text-slate-400">curl</code> externo devolviendo HTML (<code className="text-rose-300">&lt;!doctype html&gt;</code>) porque requieren la cookie de tu navegador. Para solucionarlo al 100%, este panel empaqueta <strong>todo el código fuente de Nexus en Base64 dentro del instalador</strong>. Elige cualquiera de estas 2 formas directas:
                            </p>
                        </div>
                    </div>

                    {/* Option A: 1-Click Download + 1 Short Command */}
                    <div className="p-4 rounded-lg bg-slate-950/90 border border-slate-800 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-xs font-semibold text-white">
                                Opción A (Más limpia): 1. Descarga el auto-instalador y 2. Ejecuta este comando en tu terminal
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleDownloadSelfContainedInstaller}
                                    disabled={loadingPayload || !payloadData}
                                    className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    <span>1. Descargar nexus-installer.sh</span>
                                </button>
                                <button
                                    onClick={handleCopyShortOneLiner}
                                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap"
                                >
                                    {copiedShortCmd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                    <span>{copiedShortCmd ? '¡Copiado!' : '2. Copiar Comando'}</span>
                                </button>
                            </div>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 rounded-md p-3 font-mono text-xs text-emerald-400 overflow-x-auto select-all">
                            <code className="whitespace-nowrap">{runDownloadedOneLiner}</code>
                        </div>
                    </div>

                    {/* Option B: Copy & Paste Self-Contained Command directly without downloading any file */}
                    <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="space-y-0.5">
                            <span className="text-slate-200 font-medium block">
                                Opción B (Sin descargar archivos): Copiar y pegar el comando auto-contenido directamente en la terminal
                            </span>
                            <span className="text-slate-400 block">
                                Copia el script completo con el código fuente de Nexus incrustado en Base64 ({payloadData?.sizeKB || 128} KB), construye <code className="font-mono text-sky-300">nexus-ai_1.0.0.deb</code> y lo instala con <code className="font-mono text-sky-300">dpkg -i</code>.
                            </span>
                        </div>
                        <button
                            onClick={handleCopyFullEmbeddedCommand}
                            disabled={loadingPayload || !payloadData}
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white border border-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 self-start sm:self-auto shrink-0 whitespace-nowrap"
                        >
                            {copiedFullPayload ? (
                                <>
                                    <Check className="w-4 h-4 text-emerald-400" />
                                    <span className="text-emerald-400">¡Comando Auto-Contenido Copiado! Pégalo en tu terminal</span>
                                </>
                            ) : (
                                <>
                                    <FileCode className="w-4 h-4 text-sky-400" />
                                    <span>Copiar Comando Auto-Contenido Completo ({payloadData?.sizeKB || 128} KB)</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Step-by-Step Breakdown Cards */}
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
                                                <span>Copiar comando</span>
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
                    <span>Paquete DPKG/APT: nexus-ai (1.0.0)</span>
                    <span aria-hidden="true">·</span>
                    <span>Debian 12/13 · Kali Linux Rolling</span>
                    <span aria-hidden="true">·</span>
                    <span>Código Fuente Embebido en Base64</span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-slate-500">Para cerrar por voz: "Nexus, cierra el panel de Debian"</span>
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
