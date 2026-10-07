import express from 'express';
import { createServer as createViteServer } from 'vite';
import { Server } from 'socket.io';
import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { startHardwareMonitor, getHardwareSnapshot } from './services/hardwareMonitor';

function isPlaceholderOrProxyKey(key: string | undefined | null, forExternalInstaller = false): boolean {
  if (!key) return true;
  const clean = key.trim().replace(/^["']|["']$/g, '');
  if (!clean || clean === 'TU_CLAVE_GEMINI_AQUI' || clean === 'TU_CLAVE_AQUI' || clean === 'undefined' || clean === 'null') {
    return true;
  }
  if (forExternalInstaller && clean.startsWith('AQ.')) {
    return true;
  }
  return false;
}

function getResolvedGeminiApiKey(forExternalInstaller = false): string {
  const candidatePaths = [
    '/opt/nexus/.env',
    path.resolve(process.cwd(), '.env'),
  ];
  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        const match = content.match(/^GEMINI_API_KEY=["']?([^"'\r\n]+)["']?/m);
        if (match && match[1] && !isPlaceholderOrProxyKey(match[1], forExternalInstaller)) {
          return match[1].trim();
        }
      }
    } catch {}
  }

  const envKey = process.env.GEMINI_API_KEY;
  if (envKey && !isPlaceholderOrProxyKey(envKey, forExternalInstaller)) {
    return envKey.trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

function saveResolvedGeminiApiKey(newKey: string): boolean {
  const clean = newKey.trim().replace(/^["']|["']$/g, '');
  if (!clean) return false;
  process.env.GEMINI_API_KEY = clean;

  const targetPaths = fs.existsSync('/opt/nexus')
    ? ['/opt/nexus/.env', path.resolve(process.cwd(), '.env')]
    : [path.resolve(process.cwd(), '.env')];

  for (const p of targetPaths) {
    try {
      let content = '';
      if (fs.existsSync(p)) {
        content = fs.readFileSync(p, 'utf8');
      }
      if (/^GEMINI_API_KEY=/m.test(content)) {
        content = content.replace(/^GEMINI_API_KEY=.*$/m, `GEMINI_API_KEY="${clean}"`);
      } else {
        content = (content ? content.trimEnd() + '\n' : '') + `GEMINI_API_KEY="${clean}"\n`;
      }
      fs.writeFileSync(p, content, { encoding: 'utf8', mode: 0o600 });
    } catch (e) {
      console.warn(`Could not write .env at ${p}:`, e);
    }
  }
  return true;
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: process.env.NODE_ENV === 'production' 
        ? false // Disable completely, serving from same origin
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
      methods: ["GET", "POST"]
    }
  });

  const PORT = Number(process.env.PORT) || 3000;

  // Track connected users
  const users = new Map<string, string>(); // socketId -> username
  const activeCalls = new Map<string, string>(); // callerId -> calleeId

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('register', (username: string) => {
      users.set(socket.id, username);
      console.log(`User registered: ${username} (${socket.id})`);
      io.emit('users_update', Array.from(users.values()));
    });

    socket.on('start_call', ({ targetUser }: { targetUser: string }) => {
      const callerName = users.get(socket.id);
      if (!callerName) return;

      // Find target socket
      let targetSocketId = null;
      for (const [id, name] of users.entries()) {
        if (name === targetUser) {
          targetSocketId = id;
          break;
        }
      }

      if (targetSocketId) {
        activeCalls.set(socket.id, targetSocketId);
        activeCalls.set(targetSocketId, socket.id);
        io.to(targetSocketId).emit('incoming_call', { caller: callerName });
        socket.emit('call_started', { target: targetUser });
      } else {
        socket.emit('call_error', { message: `Usuario ${targetUser} no encontrado.` });
      }
    });

    socket.on('send_translated_message', ({ message }: { message: string }) => {
      const targetSocketId = activeCalls.get(socket.id);
      if (targetSocketId) {
        const senderName = users.get(socket.id);
        io.to(targetSocketId).emit('receive_translated_message', { sender: senderName, message });
      } else {
        socket.emit('call_error', { message: 'No estás en una llamada activa.' });
      }
    });

    socket.on('end_call', () => {
      const targetSocketId = activeCalls.get(socket.id);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call_ended');
        activeCalls.delete(targetSocketId);
      }
      activeCalls.delete(socket.id);
      socket.emit('call_ended');
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      const targetSocketId = activeCalls.get(socket.id);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call_ended');
        activeCalls.delete(targetSocketId);
      }
      activeCalls.delete(socket.id);
      users.delete(socket.id);
      io.emit('users_update', Array.from(users.values()));
    });
  });

  // Initialize hardware monitoring engine and real-time Socket.io broadcaster
  startHardwareMonitor(io, 1000);

  // API routes FIRST
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Runtime configuration endpoint so compiled production builds on Debian/Kali always receive GEMINI_API_KEY
  app.get('/api/runtime-config', (_req, res) => {
    const apiKey = getResolvedGeminiApiKey(false);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      apiKey,
      hasStandaloneKey: Boolean(apiKey && !apiKey.startsWith('AQ.')),
    });
  });

  app.post('/api/runtime-config', (req, res) => {
    const rawKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    if (!rawKey) {
      res.status(400).json({ error: 'API key vacía.' });
      return;
    }
    saveResolvedGeminiApiKey(rawKey);
    io.emit('api_key_updated', { updatedAt: Date.now() });
    res.json({ ok: true });
  });

  // Built-in local conversational engine for Debian/Kali Linux when running in Local Mode
  app.post('/api/local-assistant', (req, res) => {
    const query = String(req.body?.query || '').trim();
    const lower = query.toLowerCase();
    const snap = getHardwareSnapshot();
    const cpuUsage = snap.cpu?.usagePercent ?? 0;
    const cpuSpeed = snap.cpu?.speedMHz ?? 0;
    const memPct = snap.memory?.systemPercent ?? 0;
    const memUsedGb = ((snap.memory?.usedSystemMB ?? 0) / 1024).toFixed(1);
    const memTotalGb = ((snap.memory?.totalSystemMB ?? 0) / 1024).toFixed(1);
    const host = os.hostname();
    const kernel = `${os.type()} ${os.release()} (${os.arch()})`;

    let reply = '';
    if (/(hola|buenas|qu[eé] pasa|me escuchas|est[aá]s ah[ií]|oye nexus)/i.test(lower)) {
      reply = `¡Qué pasa, Koko! Te escucho alto y claro desde tu Linux (${host}). Tengo la CPU al ${cpuUsage}% y la RAM al ${memPct}%. Dime qué necesitas o qué módulo quieres que abra.`;
    } else if (/(cpu|procesador|memoria|ram|temperatura|consumo|rendimiento|estado|sistema|hardware)/i.test(lower)) {
      reply = `Aquí tienes el parte de tu máquina, Koko: en ${host} (${kernel}) la CPU va al ${cpuUsage}% (${cpuSpeed} MHz), y la memoria RAM está al ${memPct}% (${memUsedGb} GB de ${memTotalGb} GB en uso). Todo fino.`;
    } else if (/(hora|fecha|d[ií]a es)/i.test(lower)) {
      reply = `Ahora mismo son las ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} del ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}, Koko.`;
    } else if (/(ip|red|interfaz|conectad)/i.test(lower)) {
      const nets = os.networkInterfaces();
      const ips: string[] = [];
      for (const [name, list] of Object.entries(nets)) {
        for (const net of list || []) {
          if (net.family === 'IPv4' && !net.internal) {
            ips.push(`${name}: ${net.address}`);
          }
        }
      }
      reply = ips.length > 0
        ? `Tus interfaces de red activas son ${ips.join(', ')}, Koko.`
        : `Estoy corriendo en local sobre ${host} en el puerto ${PORT}, Koko.`;
    } else if (/(clave|api|key|gemini|nube|conectar)/i.test(lower)) {
      reply = `Ahora mismo estoy operando en modo local en tu Linux sin fallos, Koko. Si quieres enchufarme el motor Gemini Live de la nube, abre tu terminal y pon: nexus apikey seguido de tu clave AIza, o abre mi terminal interna y escribe apikey y tu clave.`;
    } else {
      reply = `Te he escuchado, Koko: "${query}". Estoy activa en modo local sobre tu Linux (${host}, CPU al ${cpuUsage}%, RAM al ${memPct}%). Puedes pedirme abrir la terminal, la telemetría, las notas o los procesos, o activar Gemini Live con el comando nexus apikey.`;
    }

    res.json({
      reply,
      hasStandaloneKey: Boolean(getResolvedGeminiApiKey(true)),
    });
  });

  app.get('/api/system-metrics', (req, res) => {
    const snapshot = getHardwareSnapshot();

    res.json({
      ...snapshot,
      serverReceivedAt: Date.now(),
      clientPingId: req.query.pingId || null,
      uptime: snapshot.serverUptimeSec,
    });
  });

  // Stream live Nexus source code bundle (.tar.gz) for automated Debian/Kali .deb package installer
  app.get('/api/source-bundle.tar.gz', (_req, res) => {
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="nexus-source.tar.gz"');
    const tarProc = spawn('tar', [
      '-czf', '-',
      '--exclude=node_modules',
      '--exclude=.git',
      '--exclude=dist',
      '--exclude=package-lock.json',
      '--exclude=bun.lock',
      '.'
    ], { cwd: process.cwd() });

    tarProc.stdout.pipe(res);
    tarProc.stderr.on('data', (data) => {
      console.error('tar stderr:', data.toString());
    });
    tarProc.on('error', (err) => {
      console.error('Failed to spawn tar:', err);
      if (!res.headersSent) {
        res.status(500).send('Failed to create source bundle');
      }
    });
  });

  // Self-contained Debian & Kali Linux .deb package installer with embedded Base64 source code
  // Avoids Cloud Run cookie proxy ("<!doctype html>") when executing from an external terminal
  app.get('/api/installer-payload', (req, res) => {
    const userParam = (req.query.user as string) || 'koko';
    const portParam = (req.query.port as string) || '3000';

    const chunks: Buffer[] = [];
    const tarProc = spawn('tar', [
      '-czf', '-',
      '--exclude=node_modules',
      '--exclude=.git',
      '--exclude=dist',
      '--exclude=package-lock.json',
      '--exclude=bun.lock',
      '.'
    ], { cwd: process.cwd() });

    tarProc.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    tarProc.on('error', (err) => {
      console.error('tar error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to package source' });
    });

    tarProc.on('close', (code) => {
      if (code !== 0) {
        if (!res.headersSent) res.status(500).json({ error: 'tar exited with code ' + code });
        return;
      }
      const tarBuffer = Buffer.concat(chunks);
      const b64Wrapped = (tarBuffer.toString('base64').match(/.{1,76}/g) || []).join('\n');
      const activeApiKey = getResolvedGeminiApiKey(true);

      const buildCoreScript = (user: string, port: string) => `#!/usr/bin/env bash
# ==============================================================================
# NEXUS AI - INSTALADOR AUTO-CONTENIDO DE PAQUETE NATIVO (.deb)
# Compatible con: Debian 12/13 (Bookworm/Trixie) y Kali Linux (Rolling / Purple)
# No requiere descargas externas del proxy web (Código fuente embebido en Base64)
# ==============================================================================
set -e

NEXUS_USER="\${NEXUS_USER:-${user}}"
if [ "\$NEXUS_USER" = "root" ] && [ -n "\$SUDO_USER" ]; then
  NEXUS_USER="\$SUDO_USER"
fi
NEXUS_PORT="\${NEXUS_PORT:-${port}}"
NEXUS_API_KEY="\${NEXUS_API_KEY:-\${GEMINI_API_KEY:-${activeApiKey}}}"

# Preservar clave previa si ya existía en /opt/nexus/.env
if [ -z "\$NEXUS_API_KEY" ] && [ -f /opt/nexus/.env ]; then
  EXISTING_KEY=\$(grep -E '^GEMINI_API_KEY=' /opt/nexus/.env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
  if [ -n "\$EXISTING_KEY" ] && [ "\$EXISTING_KEY" != "TU_CLAVE_GEMINI_AQUI" ] && [[ "\$EXISTING_KEY" != AQ.* ]]; then
    NEXUS_API_KEY="\$EXISTING_KEY"
  fi
fi

PKG_VERSION="1.0.0"
PKG_ARCH="\$(dpkg --print-architecture 2>/dev/null || echo 'amd64')"
BUILD_ROOT="/tmp/nexus-deb-build-\$\$"
PKG_DIR="\${BUILD_ROOT}/nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}"

echo "=============================================================================="
echo "  NEXUS OS - INSTALACIÓN DE PAQUETE NATIVO (.deb) EN DEBIAN / KALI LINUX"
echo "  Usuario: \${NEXUS_USER} | Puerto: \${NEXUS_PORT} | Arquitectura: \${PKG_ARCH}"
echo "=============================================================================="

if [ "\$(id -u)" -ne 0 ]; then
  echo "[!] Elevando privilegios con sudo..."
  exec sudo NEXUS_USER="\$NEXUS_USER" NEXUS_PORT="\$NEXUS_PORT" NEXUS_API_KEY="\$NEXUS_API_KEY" bash "\$0" "\$@"
fi

if [ -z "\$NEXUS_API_KEY" ] && [ -c /dev/tty ]; then
  echo ""
  echo "------------------------------------------------------------------------------"
  echo "  [Opcional] Si tienes una clave GEMINI_API_KEY (empieza por AIza...),"
  echo "  pégala ahora. Si pulsas ENTER, Nexus funcionará en Modo Local"
  echo "  y podrás configurarla en cualquier momento con: nexus apikey TU_CLAVE"
  echo "------------------------------------------------------------------------------"
  printf "  GEMINI_API_KEY [ENTER para Modo Local]: " > /dev/tty
  read -t 25 -r INPUT_KEY < /dev/tty || true
  echo "" > /dev/tty
  if [ -n "\$INPUT_KEY" ]; then
    NEXUS_API_KEY="\$INPUT_KEY"
  fi
fi

if [ -f /etc/os-release ]; then
  . /etc/os-release
  echo "[1/6] Sistema detectado: \${PRETTY_NAME:-Debian/Kali Linux}"
fi

echo "[2/6] Instalando dependencias del sistema, audio/vídeo y empaquetado dpkg..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl wget git build-essential ca-certificates gnupg lsb-release \\
  dpkg-dev alsa-utils pulseaudio v4l-utils xdg-utils \\
  nmap dnsutils whois iproute2 net-tools

if ! command -v chromium >/dev/null 2>&1 && ! command -v google-chrome >/dev/null 2>&1; then
  apt-get install -y chromium || true
fi

echo "[3/6] Verificando Node.js 22 LTS (Repositorio NodeSource nodistro para Debian/Kali)..."
NEED_NODE=0
if ! command -v node >/dev/null 2>&1; then
  NEED_NODE=1
else
  NODE_MAJOR=\$(node -v | cut -d. -f1 | tr -d 'v')
  if [ "\${NODE_MAJOR}" -lt 20 ]; then
    NEED_NODE=1
  fi
fi

if [ "\${NEED_NODE}" -eq 1 ]; then
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi

echo "[4/6] Extrayendo código fuente embebido de Nexus y compilando producción..."
rm -rf "\${BUILD_ROOT}"
mkdir -p "\${PKG_DIR}/opt/nexus"
mkdir -p "\${PKG_DIR}/DEBIAN"
mkdir -p "\${PKG_DIR}/usr/bin"
mkdir -p "\${PKG_DIR}/etc/systemd/system"
mkdir -p "\${PKG_DIR}/usr/share/applications"

base64 -d << 'NEXUS_B64_PAYLOAD_EOF' | tar -xzf - -C "\${PKG_DIR}/opt/nexus"
${b64Wrapped}
NEXUS_B64_PAYLOAD_EOF

cd "\${PKG_DIR}/opt/nexus"
cat << ENVEOF > "\${PKG_DIR}/opt/nexus/.env"
PORT=\${NEXUS_PORT}
NODE_ENV=production
GEMINI_API_KEY="\${NEXUS_API_KEY}"
ENVEOF
chmod 600 "\${PKG_DIR}/opt/nexus/.env"

npm install --no-audit --no-fund
GEMINI_API_KEY="\${NEXUS_API_KEY}" npm run build

echo "[5/6] Construyendo paquete oficial nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb..."
cat << EOF > "\${PKG_DIR}/DEBIAN/control"
Package: nexus-ai
Version: \${PKG_VERSION}
Section: utils
Priority: optional
Architecture: \${PKG_ARCH}
Maintainer: Koko <koko@nexus.local>
Depends: nodejs (>= 20), alsa-utils, v4l-utils, xdg-utils
Description: Nexus AI - Sistema Operativo Cognitivo y Agente para Debian y Kali Linux
EOF

cat << 'EOF' > "\${PKG_DIR}/usr/bin/nexus"
#!/usr/bin/env bash
SERVICE="nexus.service"
ENV_FILE="/opt/nexus/.env"
PORT=\$(grep -E '^PORT=' "\$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo "3000")

case "\$1" in
  start)
    sudo systemctl start "\$SERVICE"
    echo "Nexus iniciado en http://localhost:\$PORT"
    ;;
  stop)
    sudo systemctl stop "\$SERVICE"
    echo "Nexus detenido."
    ;;
  restart)
    sudo systemctl restart "\$SERVICE"
    echo "Nexus reiniciado."
    ;;
  status)
    systemctl status "\$SERVICE" --no-pager
    ;;
  logs)
    journalctl -u "\$SERVICE" -f
    ;;
  apikey)
    if [ -z "\$2" ]; then
      echo "Uso: nexus apikey <TU_GEMINI_API_KEY>"
      exit 1
    fi
    if [ -f "\$ENV_FILE" ] && grep -q '^GEMINI_API_KEY=' "\$ENV_FILE"; then
      sudo sed -i "s|^GEMINI_API_KEY=.*|GEMINI_API_KEY=\"\$2\"|" "\$ENV_FILE"
    else
      echo "GEMINI_API_KEY=\"\$2\"" | sudo tee -a "\$ENV_FILE" >/dev/null
    fi
    curl -s -X POST "http://localhost:\$PORT/api/runtime-config" -H "Content-Type: application/json" -d "{\"apiKey\":\"\$2\"}" >/dev/null 2>&1 || true
    sudo systemctl restart "\$SERVICE"
    echo "Clave GEMINI_API_KEY actualizada en tiempo real y servicio Nexus reiniciado."
    ;;
  app|"")
    BROWSER_BIN=\$(command -v chromium || command -v google-chrome || command -v firefox-esr || echo "xdg-open")
    if [[ "\$BROWSER_BIN" == *"chromium"* ]] || [[ "\$BROWSER_BIN" == *"chrome"* ]]; then
      "\$BROWSER_BIN" --app="http://localhost:\$PORT" --use-fake-ui-for-media-stream --enable-features=WebRTCPipeWireCapturer --start-maximized >/dev/null 2>&1 &
    else
      "\$BROWSER_BIN" "http://localhost:\$PORT" >/dev/null 2>&1 &
    fi
    ;;
  *)
    echo "Comandos de Nexus CLI (Debian / Kali Linux):"
    echo "  nexus              - Abre la interfaz gráfica de Nexus en modo App"
    echo "  nexus status       - Muestra el estado del servicio systemd"
    echo "  nexus start|stop   - Inicia o detiene el servicio"
    echo "  nexus restart      - Reinicia Nexus"
    echo "  nexus logs         - Muestra logs en vivo"
    echo "  nexus apikey <KEY> - Configura tu GEMINI_API_KEY al instante"
    ;;
esac
EOF
chmod 755 "\${PKG_DIR}/usr/bin/nexus"

cat << EOF > "\${PKG_DIR}/etc/systemd/system/nexus.service"
[Unit]
Description=Nexus AI - Nucleo del Sistema para Debian y Kali Linux
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
User=\${NEXUS_USER}
WorkingDirectory=/opt/nexus
EnvironmentFile=/opt/nexus/.env
ExecStart=/usr/bin/node /opt/nexus/dist/server.cjs
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

cat << EOF > "\${PKG_DIR}/usr/share/applications/nexus-ai.desktop"
[Desktop Entry]
Name=Nexus AI
Comment=Compañera de IA y Agente de Sistema para Debian y Kali Linux
Exec=/usr/bin/nexus app
Icon=utilities-terminal
Terminal=false
Type=Application
Categories=System;Security;Utility;
StartupNotify=true
EOF

cat << EOF > "\${PKG_DIR}/DEBIAN/postinst"
#!/usr/bin/env bash
set -e
for grp in audio video plugdev netdev adm dialout wireshark kaboxer; do
  if getent group "\\\$grp" >/dev/null 2>&1 && id "\${NEXUS_USER}" >/dev/null 2>&1; then
    usermod -aG "\\\$grp" "\${NEXUS_USER}" || true
  fi
done
cat << ENVEOF > /opt/nexus/.env
PORT=\${NEXUS_PORT}
NODE_ENV=production
GEMINI_API_KEY="\${NEXUS_API_KEY}"
ENVEOF
chmod 600 /opt/nexus/.env
if id "\${NEXUS_USER}" >/dev/null 2>&1; then
  chown -R "\${NEXUS_USER}:\${NEXUS_USER}" /opt/nexus
fi
systemctl daemon-reload || true
systemctl enable --now nexus.service || true
update-desktop-database /usr/share/applications 2>/dev/null || true
EOF
chmod 755 "\${PKG_DIR}/DEBIAN/postinst"

cat << 'EOF' > "\${PKG_DIR}/DEBIAN/prerm"
#!/usr/bin/env bash
set -e
systemctl stop nexus.service 2>/dev/null || true
systemctl disable nexus.service 2>/dev/null || true
EOF
chmod 755 "\${PKG_DIR}/DEBIAN/prerm"

dpkg-deb --build --root-owner-group "\${PKG_DIR}" "\${BUILD_ROOT}/nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb"

echo "[6/6] Instalando paquete nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb con dpkg..."
dpkg -i "\${BUILD_ROOT}/nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb" || apt-get install -f -y
cp "\${BUILD_ROOT}/nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb" "/opt/nexus/nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb" || true
rm -rf "\${BUILD_ROOT}"

echo "=============================================================================="
echo "  ¡PAQUETE 'nexus-ai' INSTALADO CON ÉXITO EN DEBIAN / KALI LINUX!"
echo "  1. Abre Nexus en App:     nexus"
echo "  2. Configurar API Key:    nexus apikey TU_CLAVE_GEMINI"
echo "  3. Ver estado servicio:   nexus status"
echo "=============================================================================="
`;

      const scriptContent = buildCoreScript(userParam, portParam);
      const pasteCommand = `cat << 'NEXUS_INSTALLER_EOF' > /tmp/nexus-installer.sh\n${scriptContent}\nNEXUS_INSTALLER_EOF\nsudo NEXUS_USER="${userParam}" NEXUS_PORT="${portParam}" bash /tmp/nexus-installer.sh`;

      res.json({
        selfExtractingScript: scriptContent,
        pasteCommand,
        sizeKB: Math.round(Buffer.byteLength(scriptContent, 'utf8') / 1024)
      });
    });
  });


  // One-command native .deb package builder & installer for Debian 12/13 and Kali Linux
  app.get('/api/install.sh', (req, res) => {
    const protoHeader = req.headers['x-forwarded-proto'];
    const hostHeader = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';
    const protocol = Array.isArray(protoHeader) ? protoHeader[0] : (protoHeader || req.protocol || 'http');
    const origin = `${protocol}://${hostHeader}`;

    const userParam = (req.query.user as string) || '';
    const portParam = (req.query.port as string) || '3000';
    const activeApiKey = getResolvedGeminiApiKey(true);

    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.send(`#!/usr/bin/env bash
# ==============================================================================
# NEXUS AI - INSTALADOR DE PAQUETE NATIVO (.deb) EN 1 COMANDO
# Sistemas soportados: Debian 12/13 (Bookworm/Trixie) y Kali Linux (Rolling)
# ==============================================================================
set -e

NEXUS_USER="\${NEXUS_USER:-${userParam || '${SUDO_USER:-$(whoami)}'}}"
if [ "\$NEXUS_USER" = "root" ] && [ -n "\$SUDO_USER" ]; then
  NEXUS_USER="\$SUDO_USER"
fi
NEXUS_PORT="\${NEXUS_PORT:-${portParam}}"
NEXUS_ORIGIN="\${NEXUS_ORIGIN:-${origin}}"
NEXUS_API_KEY="\${NEXUS_API_KEY:-\${GEMINI_API_KEY:-${activeApiKey}}}"

if [ -z "\$NEXUS_API_KEY" ] && [ -f /opt/nexus/.env ]; then
  EXISTING_KEY=\$(grep -E '^GEMINI_API_KEY=' /opt/nexus/.env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
  if [ -n "\$EXISTING_KEY" ] && [ "\$EXISTING_KEY" != "TU_CLAVE_GEMINI_AQUI" ] && [[ "\$EXISTING_KEY" != AQ.* ]]; then
    NEXUS_API_KEY="\$EXISTING_KEY"
  fi
fi

PKG_VERSION="1.0.0"
PKG_ARCH="\$(dpkg --print-architecture 2>/dev/null || echo 'amd64')"
BUILD_ROOT="/tmp/nexus-deb-build-\$\$"
PKG_DIR="\${BUILD_ROOT}/nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}"

echo "=============================================================================="
echo "  NEXUS OS - EMPAQUETADO E INSTALACIÓN NATIVA (.deb) PARA DEBIAN / KALI LINUX"
echo "  Usuario: \${NEXUS_USER} | Puerto: \${NEXUS_PORT} | Arquitectura: \${PKG_ARCH}"
echo "=============================================================================="

if [ "\$(id -u)" -ne 0 ]; then
  echo "[!] Ejecuta este comando con sudo: curl -fsSL \${NEXUS_ORIGIN}/api/install.sh | sudo bash"
  exit 1
fi

# 1. Detectar Debian o Kali Linux
if [ -f /etc/os-release ]; then
  . /etc/os-release
  echo "[1/6] Sistema detectado: \${PRETTY_NAME:-Debian/Kali Linux}"
fi

# 2. Instalar dependencias del sistema, audio/video PipeWire/ALSA y herramientas Kali/Debian
echo "[2/6] Instalando dependencias de sistema, multimedia y empaquetado dpkg..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl wget git build-essential ca-certificates gnupg lsb-release \\
  dpkg-dev alsa-utils pulseaudio v4l-utils xdg-utils \\
  nmap dnsutils whois iproute2 net-tools

# Instalar navegador para modo App nativo (Chromium en Debian/Kali)
if ! command -v chromium >/dev/null 2>&1 && ! command -v google-chrome >/dev/null 2>&1; then
  apt-get install -y chromium || apt-get install -y chromium-bsu || true
fi

# 3. Instalar Node.js 22 LTS (compatible con Debian y Kali Rolling via NodeSource nodistro)
echo "[3/6] Verificando Node.js 22 LTS..."
NEED_NODE=0
if ! command -v node >/dev/null 2>&1; then
  NEED_NODE=1
else
  NODE_MAJOR=\$(node -v | cut -d. -f1 | tr -d 'v')
  if [ "\${NODE_MAJOR}" -lt 20 ]; then
    NEED_NODE=1
  fi
fi

if [ "\${NEED_NODE}" -eq 1 ]; then
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi

# 4. Descargar código fuente de Nexus y compilar producción
echo "[4/6] Descargando y compilando el núcleo de Nexus..."
rm -rf "\${BUILD_ROOT}"
mkdir -p "\${PKG_DIR}/opt/nexus"
mkdir -p "\${PKG_DIR}/DEBIAN"
mkdir -p "\${PKG_DIR}/usr/bin"
mkdir -p "\${PKG_DIR}/etc/systemd/system"
mkdir -p "\${PKG_DIR}/usr/share/applications"

if [ -f "./package.json" ] && [ -f "./server.ts" ]; then
  echo "    -> Usando código fuente del directorio local..."
  tar -cf - --exclude=node_modules --exclude=.git --exclude=dist . | tar -xf - -C "\${PKG_DIR}/opt/nexus"
else
  echo "    -> Descargando paquete fuente desde \${NEXUS_ORIGIN}/api/source-bundle.tar.gz ..."
  curl -fsSL "\${NEXUS_ORIGIN}/api/source-bundle.tar.gz" | tar -xzf - -C "\${PKG_DIR}/opt/nexus"
fi

cd "\${PKG_DIR}/opt/nexus"
cat << ENVEOF > "\${PKG_DIR}/opt/nexus/.env"
PORT=\${NEXUS_PORT}
NODE_ENV=production
GEMINI_API_KEY="\${NEXUS_API_KEY}"
ENVEOF
chmod 600 "\${PKG_DIR}/opt/nexus/.env"

npm install --no-audit --no-fund
GEMINI_API_KEY="\${NEXUS_API_KEY}" npm run build

# 5. Construir estructura del paquete oficial Debian/Kali (.deb)
echo "[5/6] Generando paquete nativo nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb..."

cat << EOF > "\${PKG_DIR}/DEBIAN/control"
Package: nexus-ai
Version: \${PKG_VERSION}
Section: utils
Priority: optional
Architecture: \${PKG_ARCH}
Maintainer: Koko <koko@nexus.local>
Depends: nodejs (>= 20), alsa-utils, v4l-utils, xdg-utils
Description: Nexus AI - Sistema Operativo Cognitivo y Agente de Ciberseguridad para Debian y Kali Linux
 Incluye servidor en tiempo real, telemetria de hardware /proc, integracion con escritorio,
 demonios systemd y herramientas de ciberseguridad para Koko.
EOF

# CLI global /usr/bin/nexus
cat << 'EOF' > "\${PKG_DIR}/usr/bin/nexus"
#!/usr/bin/env bash
SERVICE="nexus.service"
INSTALL_DIR="/opt/nexus"
ENV_FILE="/opt/nexus/.env"

PORT=\$(grep -E '^PORT=' "\$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo "3000")

case "\$1" in
  start)
    sudo systemctl start "\$SERVICE"
    echo "Nexus iniciado en http://localhost:\$PORT"
    ;;
  stop)
    sudo systemctl stop "\$SERVICE"
    echo "Nexus detenido."
    ;;
  restart)
    sudo systemctl restart "\$SERVICE"
    echo "Nexus reiniciado."
    ;;
  status)
    systemctl status "\$SERVICE" --no-pager
    ;;
  logs)
    journalctl -u "\$SERVICE" -f
    ;;
  apikey)
    if [ -z "\$2" ]; then
      echo "Uso: nexus apikey <TU_GEMINI_API_KEY>"
      exit 1
    fi
    if [ -f "\$ENV_FILE" ] && grep -q '^GEMINI_API_KEY=' "\$ENV_FILE"; then
      sudo sed -i "s|^GEMINI_API_KEY=.*|GEMINI_API_KEY=\"\$2\"|" "\$ENV_FILE"
    else
      echo "GEMINI_API_KEY=\"\$2\"" | sudo tee -a "\$ENV_FILE" >/dev/null
    fi
    curl -s -X POST "http://localhost:\$PORT/api/runtime-config" -H "Content-Type: application/json" -d "{\"apiKey\":\"\$2\"}" >/dev/null 2>&1 || true
    sudo systemctl restart "\$SERVICE"
    echo "Clave GEMINI_API_KEY actualizada en tiempo real y servicio Nexus reiniciado."
    ;;
  app|"")
    BROWSER_BIN=\$(command -v chromium || command -v google-chrome || command -v firefox-esr || echo "xdg-open")
    if [[ "\$BROWSER_BIN" == *"chromium"* ]] || [[ "\$BROWSER_BIN" == *"chrome"* ]]; then
      "\$BROWSER_BIN" --app="http://localhost:\$PORT" --use-fake-ui-for-media-stream --enable-features=WebRTCPipeWireCapturer --start-maximized >/dev/null 2>&1 &
    else
      "\$BROWSER_BIN" "http://localhost:\$PORT" >/dev/null 2>&1 &
    fi
    ;;
  *)
    echo "Comandos de Nexus CLI (Debian / Kali Linux):"
    echo "  nexus              - Abre la interfaz gráfica de Nexus en modo App"
    echo "  nexus status       - Muestra el estado del demonio systemd"
    echo "  nexus start|stop   - Inicia o detiene el servicio en segundo plano"
    echo "  nexus restart      - Reinicia el núcleo de Nexus"
    echo "  nexus logs         - Muestra los logs en tiempo real"
    echo "  nexus apikey <KEY> - Configura tu GEMINI_API_KEY y reinicia Nexus"
    ;;
esac
EOF
chmod 755 "\${PKG_DIR}/usr/bin/nexus"

# Servicio systemd
cat << EOF > "\${PKG_DIR}/etc/systemd/system/nexus.service"
[Unit]
Description=Nexus AI - Nucleo del Sistema para Debian y Kali Linux
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
User=\${NEXUS_USER}
WorkingDirectory=/opt/nexus
EnvironmentFile=/opt/nexus/.env
ExecStart=/usr/bin/node /opt/nexus/dist/server.cjs
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

# Lanzador Desktop para GNOME / Kali XFCE / KDE
cat << EOF > "\${PKG_DIR}/usr/share/applications/nexus-ai.desktop"
[Desktop Entry]
Name=Nexus AI
Comment=Compañera de IA y Agente de Sistema para Debian y Kali Linux
Exec=/usr/bin/nexus app
Icon=utilities-terminal
Terminal=false
Type=Application
Categories=System;Security;Utility;ArtificialIntelligence;
StartupNotify=true
EOF

# Script postinst del paquete .deb
cat << EOF > "\${PKG_DIR}/DEBIAN/postinst"
#!/usr/bin/env bash
set -e
NEXUS_USER="\${NEXUS_USER}"
NEXUS_PORT="\${NEXUS_PORT}"

# Permisos de grupos de hardware en Debian y Kali Linux
for grp in audio video plugdev netdev adm dialout wireshark kaboxer; do
  if getent group "\\\$grp" >/dev/null 2>&1 && id "\$NEXUS_USER" >/dev/null 2>&1; then
    usermod -aG "\\\$grp" "\$NEXUS_USER" || true
  fi
done

cat << ENVEOF > /opt/nexus/.env
PORT=\${NEXUS_PORT}
NODE_ENV=production
GEMINI_API_KEY="\${NEXUS_API_KEY}"
ENVEOF
chmod 600 /opt/nexus/.env

if id "\$NEXUS_USER" >/dev/null 2>&1; then
  chown -R "\$NEXUS_USER:\$NEXUS_USER" /opt/nexus
fi

systemctl daemon-reload || true
systemctl enable --now nexus.service || true
update-desktop-database /usr/share/applications 2>/dev/null || true
EOF
chmod 755 "\${PKG_DIR}/DEBIAN/postinst"

# Script prerm del paquete .deb
cat << 'EOF' > "\${PKG_DIR}/DEBIAN/prerm"
#!/usr/bin/env bash
set -e
systemctl stop nexus.service 2>/dev/null || true
systemctl disable nexus.service 2>/dev/null || true
EOF
chmod 755 "\${PKG_DIR}/DEBIAN/prerm"

dpkg-deb --build --root-owner-group "\${PKG_DIR}" "\${BUILD_ROOT}/nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb"

# 6. Instalar el paquete .deb generado
echo "[6/6] Instalando paquete nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb en el sistema..."
dpkg -i "\${BUILD_ROOT}/nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb" || apt-get install -f -y
cp "\${BUILD_ROOT}/nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb" "/opt/nexus/nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb" || true
rm -rf "\${BUILD_ROOT}"

echo "=============================================================================="
echo "  PAQUETE 'nexus-ai' INSTALADO CORRECTAMENTE EN DEBIAN / KALI LINUX"
echo "  • Paquete copia guardado en: /opt/nexus/nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb"
echo "  • Configurar API Key:        nexus apikey TU_CLAVE_GEMINI"
echo "  • Abrir aplicación:          nexus"
echo "  • Estado del servicio:       nexus status"
echo "  • Desinstalar paquete:       sudo apt remove nexus-ai"
echo "=============================================================================="
`);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist', { index: false }));
    app.get('*all', (_req, res) => {
      const indexPath = path.resolve(process.cwd(), 'dist', 'index.html');
      try {
        let html = fs.readFileSync(indexPath, 'utf8');
        const runtimeScript = `<script>window.__NEXUS_RUNTIME_CONFIG__ = ${JSON.stringify({ apiKey: getResolvedGeminiApiKey(false) })};</script>`;
        html = html.replace('<head>', `<head>${runtimeScript}`);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(html);
      } catch {
        res.sendFile(indexPath);
      }
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
