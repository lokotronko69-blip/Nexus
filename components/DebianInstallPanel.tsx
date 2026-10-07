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
    RefreshCw,
    ShieldCheck,
    Loader2
} from 'lucide-react';
import { syncVaultWithServer } from '../services/geminiService';

interface DebianInstallPanelProps {
    onClose: () => void;
}

interface CommandStep {
    id: string;
    number: string;
    category: 'update' | 'deb_package' | 'base' | 'node' | 'nexus' | 'local_ai';
    title: string;
    description: string;
    command: string;
    verifyCommand?: string;
    notes?: string;
}

export const DebianInstallPanel: React.FC<DebianInstallPanelProps> = ({ onClose }) => {
    const [sysUser, setSysUser] = useState('koko');
    const [port, setPort] = useState('3000');
    const [distroMode, setDistroMode] = useState<'universal' | 'kali' | 'debian'>('universal');
    const [activeCategory, setActiveCategory] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [copiedShortCmd, setCopiedShortCmd] = useState(false);
    const [copiedFullPayload, setCopiedFullPayload] = useState(false);
    const [downloadedInstaller, setDownloadedInstaller] = useState(false);

    // Atomic Updater states
    const [copiedUpdateShortCmd, setCopiedUpdateShortCmd] = useState(false);
    const [copiedUpdateFullPayload, setCopiedUpdateFullPayload] = useState(false);
    const [downloadedUpdater, setDownloadedUpdater] = useState(false);
    const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>({});

    const [payloadData, setPayloadData] = useState<{
        selfExtractingScript: string;
        pasteCommand: string;
        sizeKB: number;
    } | null>(null);
    const [updaterData, setUpdaterData] = useState<{
        version: string;
        payloadSha256: string;
        updaterScript: string;
        pasteUpdateCommand: string;
        sizeKB: number;
    } | null>(null);
    const [versionInfo, setVersionInfo] = useState<{
        version: string;
        vaultChecksum?: string;
        memoriesCount?: number;
    } | null>(null);
    const [loadingPayload, setLoadingPayload] = useState(true);

    useEffect(() => {
        let active = true;
        setLoadingPayload(true);
        syncVaultWithServer().catch(() => {});

        Promise.all([
            fetch(`/api/installer-payload?user=${encodeURIComponent(sysUser)}&port=${encodeURIComponent(port)}&t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()),
            fetch(`/api/updater-payload?user=${encodeURIComponent(sysUser)}&port=${encodeURIComponent(port)}&t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()),
            fetch(`/api/version?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        ])
            .then(([instData, updData, verData]) => {
                if (!active) return;
                if (instData?.selfExtractingScript) setPayloadData(instData);
                if (updData?.updaterScript) setUpdaterData(updData);
                if (verData) setVersionInfo(verData);
            })
            .catch(err => console.error('Error loading installer/updater payloads:', err))
            .finally(() => {
                if (active) setLoadingPayload(false);
            });
        return () => { active = false; };
    }, [sysUser, port]);

    // Short 1-line command for initial .deb installation
    const runDownloadedOneLiner = useMemo(() => {
        return `sudo NEXUS_USER="${sysUser}" NEXUS_PORT="${port}" bash "$(ls -t ~/Descargas/nexus-installer*.sh ~/Downloads/nexus-installer*.sh ./nexus-installer*.sh 2>/dev/null | head -n 1)"`;
    }, [sysUser, port]);

    // Short 1-line command for zero-reinstall Atomic Update
    const runDownloadedUpdaterOneLiner = useMemo(() => {
        return `sudo NEXUS_USER="${sysUser}" bash "$(ls -t ~/Descargas/nexus-updater*.sh ~/Downloads/nexus-updater*.sh ./nexus-updater*.sh 2>/dev/null | head -n 1)"`;
    }, [sysUser]);

    const handleDownloadSelfContainedInstaller = async () => {
        await syncVaultWithServer().catch(() => {});
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

    const handleDownloadAtomicUpdater = async () => {
        await syncVaultWithServer().catch(() => {});
        if (!updaterData?.updaterScript) return;
        const blob = new Blob([updaterData.updaterScript], { type: 'text/x-shellscript;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'nexus-updater.sh';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setDownloadedUpdater(true);
        setTimeout(() => setDownloadedUpdater(false), 4000);
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

    const handleCopyUpdateShortOneLiner = () => {
        navigator.clipboard.writeText(runDownloadedUpdaterOneLiner);
        setCopiedUpdateShortCmd(true);
        setTimeout(() => setCopiedUpdateShortCmd(false), 2500);
    };

    const handleCopyUpdateFullPayload = () => {
        if (!updaterData?.pasteUpdateCommand) return;
        navigator.clipboard.writeText(updaterData.pasteUpdateCommand);
        setCopiedUpdateFullPayload(true);
        setTimeout(() => setCopiedUpdateFullPayload(false), 3000);
    };

    const steps: CommandStep[] = useMemo(() => [
        {
            id: 'step-0-atomic-update',
            number: '01',
            category: 'update',
            title: 'Actualización Atómica Delta sin Reinstalar (nexus-updater.sh / nexus update)',
            description: 'Si ya tienes Nexus instalado en /opt/nexus, este método actualiza el sistema en ~10 segundos sin reinstalar paquetes APT ni tocar tu clave GEMINI_API_KEY (.env) ni tu bóveda de memorias y notas (/opt/nexus/data/nexus-vault.json). Reutiliza node_modules mediante hardlinks (cp -al), verifica SHA-256 y aplica Rollback Automático si falla el health-check:',
            command: `# Opción 1: Descarga nexus-updater.sh con el botón verde superior y ejecuta:
${runDownloadedUpdaterOneLiner}

# Opción 2 (Si ya tienes el CLI actualizado): Simplemente ejecuta en tu terminal:
nexus update`,
            verifyCommand: 'nexus version && curl -s http://localhost:3000/api/health',
            notes: `Hash SHA-256 verificado del paquete actual: ${updaterData?.payloadSha256?.slice(0, 24) || 'verificando'}...`
        },
        {
            id: 'step-1-backup-rollback',
            number: '02',
            category: 'update',
            title: 'Snapshots Criptográficos SHA-256 y Rollback Instantáneo (nexus backup / rollback)',
            description: 'Cada vez que actualizas Nexus, se crea automáticamente un snapshot firmado con SHA-256 en /var/backups/nexus/ (conservando las últimas 5 versiones). También puedes crear un backup manual o volver a la versión anterior en 2 segundos:',
            command: `# Crear un backup manual firmado (SHA-256) de .env, bóveda de datos y binarios:
nexus backup

# Ver versión instalada, hash SHA-256 de la bóveda de memorias y snapshots disponibles:
nexus version

# Restaurar instantáneamente la versión anterior verificando su firma SHA-256:
nexus rollback`,
            verifyCommand: 'ls -lh /var/backups/nexus/',
            notes: 'Garantiza cero pérdida de datos incluso ante cortes eléctricos o fallos de compilación.'
        },
        {
            id: 'step-2-deb-pkg',
            number: '03',
            category: 'deb_package',
            title: 'Primera Instalación de Paquete Nativo (.deb) en 1 Comando (Debian y Kali Linux)',
            description: 'Para instalar Nexus por primera vez en un sistema limpio, descarga "nexus-installer.sh" con el botón superior y ejecuta este comando único en tu terminal:',
            command: runDownloadedOneLiner,
            verifyCommand: 'dpkg -l | grep nexus-ai && nexus status',
            notes: 'Detecta automáticamente ~/Descargas o ~/Downloads y construye e instala nexus-ai_1.0.0_amd64.deb.'
        },
        {
            id: 'step-3-apt',
            number: '04',
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
            id: 'step-4-node',
            number: '05',
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
            id: 'step-5-cli',
            number: '06',
            category: 'nexus',
            title: 'Comandos del Paquete Instalado (CLI /usr/bin/nexus)',
            description: 'Una vez instalado el paquete nexus-ai, dispones del comando global "nexus" desde cualquier terminal de Debian o Kali Linux.',
            command: `# 1. Actualizar Nexus a la última versión conservando datos y .env:
nexus update

# 2. Configurar tu clave de API de Gemini en caliente (sin recompilar):
nexus apikey "TU_CLAVE_GEMINI_AQUI"

# 3. Crear backup o restaurar versión previa (Rollback):
nexus backup
nexus rollback

# 4. Abrir Nexus en modo App o ver estado/versión:
nexus
nexus version
nexus status`,
            verifyCommand: 'which nexus && systemctl is-active nexus.service',
            notes: 'Para desinstalar el paquete en cualquier momento: sudo apt remove nexus-ai'
        },
        {
            id: 'step-6-ollama',
            number: '07',
            category: 'local_ai',
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
    ], [runDownloadedOneLiner, runDownloadedUpdaterOneLiner, updaterData?.payloadSha256]);

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
                    <div>
                        <h2 className="text-base font-semibold tracking-tight text-white whitespace-nowrap">
                            Instalador y Actualizador Atómico para Debian / Kali Linux
                        </h2>
                        <p className="text-[11px] text-slate-400 font-mono">
                            v{versionInfo?.version || updaterData?.version || '1.2.0'} · Bóveda de Datos Protegida ({versionInfo?.memoriesCount ?? 0} memorias sincronizadas)
                        </p>
                    </div>
                </div>

                {/* Category Filter Buttons */}
                <nav className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg overflow-x-auto">
                    {[
                        { id: 'all', label: 'Todo' },
                        { id: 'update', label: 'Actualizar sin Reinstalar' },
                        { id: 'deb_package', label: 'Primera Instalación (.deb)' },
                        { id: 'nexus', label: 'CLI & Rollback' },
                        { id: 'base', label: 'Dependencias' },
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
                        onClick={handleDownloadAtomicUpdater}
                        disabled={loadingPayload || !updaterData}
                        className="px-3.5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                        title="Descarga el actualizador atómico que conserva tus datos y .env sin reinstalar"
                    >
                        {loadingPayload ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : downloadedUpdater ? (
                            <Check className="w-3.5 h-3.5" />
                        ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        <span>
                            {loadingPayload
                                ? 'Empaquetando...'
                                : downloadedUpdater
                                ? 'nexus-updater.sh descargado'
                                : `Descargar Actualizador (${updaterData?.sizeKB || 138} KB)`}
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
                        placeholder="Filtrar comando (ej: update, rollback, backup, dpkg, kali)..."
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
                {/* HERO 1: ATOMIC ZERO-REINSTALL UPDATER (Preserves .env + Data Vault + Rollback) */}
                <div className="p-5 rounded-xl bg-slate-900/90 border border-emerald-500/40 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-2 text-xs text-emerald-400 font-semibold">
                                <ShieldCheck className="w-4 h-4" />
                                <span>Actualización Atómica Segura (Sin Reinstalación Completa · 100% Integridad de Datos y .env)</span>
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed max-w-4xl">
                                Actualiza tu Nexus ya instalado en <code className="text-slate-200 font-mono">/opt/nexus</code> en <strong>~10 segundos</strong> sin reinstalar paquetes APT ni perder tu <code className="text-emerald-300 font-mono">GEMINI_API_KEY</code> (<code className="text-slate-300 font-mono">/opt/nexus/.env</code>) ni tus memorias y notas (<code className="text-emerald-300 font-mono">/opt/nexus/data/nexus-vault.json</code>). Incluye <strong>verificación SHA-256</strong>, <strong>snapshot automático en /var/backups/nexus</strong>, compilación aislada con hardlinks (<code className="text-slate-300 font-mono">cp -al node_modules</code>) y <strong>Rollback Automático</strong> si falla el health-check.
                            </p>
                        </div>
                    </div>

                    <div className="p-4 rounded-lg bg-slate-950/90 border border-slate-800 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-xs font-semibold text-white">
                                Actualizar Nexus instalado: 1. Descarga nexus-updater.sh y 2. Ejecuta este comando (o &quot;nexus update&quot;)
                            </span>
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    onClick={handleDownloadAtomicUpdater}
                                    disabled={loadingPayload || !updaterData}
                                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    <span>1. Descargar nexus-updater.sh</span>
                                </button>
                                <button
                                    onClick={handleCopyUpdateShortOneLiner}
                                    className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap"
                                >
                                    {copiedUpdateShortCmd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                    <span>{copiedUpdateShortCmd ? '¡Comando Copiado!' : '2. Copiar Comando de Actualización'}</span>
                                </button>
                                <button
                                    onClick={handleCopyUpdateFullPayload}
                                    disabled={loadingPayload || !updaterData}
                                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
                                >
                                    {copiedUpdateFullPayload ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <FileCode className="w-3.5 h-3.5 text-sky-400" />}
                                    <span>{copiedUpdateFullPayload ? '¡Auto-Actualizador Copiado!' : 'Copiar Auto-Actualizador sin Descargar'}</span>
                                </button>
                            </div>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 rounded-md p-3 font-mono text-xs text-emerald-400 overflow-x-auto select-all">
                            <code className="whitespace-nowrap">{runDownloadedUpdaterOneLiner}</code>
                        </div>
                    </div>
                </div>

                {/* HERO 2: INITIAL .DEB PACKAGE INSTALLER */}
                <div className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 text-xs text-rose-400 font-semibold">
                                <Terminal className="w-4 h-4" />
                                <span>Primera Instalación Completa de Paquete (.deb) — Solo si aún no has instalado Nexus</span>
                            </div>
                            <p className="text-xs text-slate-400">
                                Instala dependencias APT de Debian/Kali, Node.js 22 LTS, construye <code className="text-slate-300 font-mono">nexus-ai_1.0.0.deb</code> y registra el demonio <code className="text-slate-300 font-mono">systemd</code>.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                onClick={handleDownloadSelfContainedInstaller}
                                disabled={loadingPayload || !payloadData}
                                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap"
                            >
                                <Download className="w-3.5 h-3.5" />
                                <span>{downloadedInstaller ? 'nexus-installer.sh descargado' : '1. Descargar nexus-installer.sh'}</span>
                            </button>
                            <button
                                onClick={handleCopyShortOneLiner}
                                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap"
                            >
                                {copiedShortCmd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                <span>{copiedShortCmd ? '¡Copiado!' : '2. Copiar Comando Instalador'}</span>
                            </button>
                            <button
                                onClick={handleCopyFullEmbeddedCommand}
                                disabled={loadingPayload || !payloadData}
                                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
                            >
                                {copiedFullPayload ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <FileCode className="w-3.5 h-3.5 text-slate-400" />}
                                <span>{copiedFullPayload ? '¡Copiado!' : 'Copiar Instalador Completo'}</span>
                            </button>
                        </div>
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
                    <span>Nexus v{versionInfo?.version || '1.2.0'}</span>
                    <span aria-hidden="true">·</span>
                    <span>Actualizador Delta Atómico + Rollback SHA-256</span>
                    <span aria-hidden="true">·</span>
                    <span>Bóveda: /opt/nexus/data/nexus-vault.json</span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-slate-500">Para cerrar por voz: &quot;Nexus, cierra el panel de Debian&quot;</span>
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
