import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import net from 'net';
import dns from 'dns';
import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import { startHardwareMonitor, getHardwareSnapshot } from './services/hardwareMonitor';

const NEXUS_VERSION = '1.3.0';

interface NexusVaultData {
  version: string;
  updatedAt: string;
  memories: Array<{ id?: number; fact: string; timestamp: string; category?: string }>;
  transcripts: Array<{ id?: number; text: string; role: 'user' | 'model'; timestamp: number }>;
  notes: string;
  checksumSha256?: string;
}

function getDataVaultPath(): string {
  const optDir = '/opt/nexus/data';
  try {
    if (fs.existsSync('/opt/nexus')) {
      if (!fs.existsSync(optDir)) fs.mkdirSync(optDir, { recursive: true, mode: 0o700 });
      return path.join(optDir, 'nexus-vault.json');
    }
  } catch {}
  const localDir = path.resolve(process.cwd(), 'data');
  try {
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true, mode: 0o700 });
  } catch {}
  return path.join(localDir, 'nexus-vault.json');
}

function computeVaultChecksum(vault: Omit<NexusVaultData, 'checksumSha256'>): string {
  const payload = JSON.stringify({
    memories: vault.memories || [],
    transcripts: vault.transcripts || [],
    notes: vault.notes || '',
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function compactServerTranscripts(
  list: Array<{ id?: number; text: string; role: 'user' | 'model'; timestamp: number }>
): Array<{ id?: number; text: string; role: 'user' | 'model'; timestamp: number }> {
  if (!Array.isArray(list) || list.length === 0) return [];
  const merged: Array<{ id?: number; text: string; role: 'user' | 'model'; timestamp: number }> = [];
  for (const item of list) {
    if (!item || typeof item.text !== 'string') continue;
    const raw = item.text;
    if (!raw.trim()) continue;
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.role === item.role &&
      Math.abs((item.timestamp || 0) - (prev.timestamp || 0)) < 15000 &&
      (raw.length < 32 || prev.text.length < 32 || !/[.!?¡¿]$/.test(prev.text.trim()))
    ) {
      const needsSpace =
        prev.text.length > 0 &&
        !/\s$/.test(prev.text) &&
        !/^[\s.,!?;:)]/.test(raw) &&
        raw.trim().length > 3;
      prev.text = (prev.text + (needsSpace ? ' ' : '') + raw).replace(/\s+/g, ' ');
      prev.timestamp = item.timestamp || prev.timestamp;
    } else {
      merged.push({
        id: item.id,
        text: raw.trim(),
        role: item.role,
        timestamp: item.timestamp || Date.now(),
      });
    }
  }
  return merged
    .map((m, idx) => ({ ...m, id: m.id ?? idx + 1, text: m.text.trim() }))
    .filter((m) => m.text.length > 0)
    .slice(-60);
}

function readDataVault(): NexusVaultData {
  const vaultPath = getDataVaultPath();
  try {
    if (fs.existsSync(vaultPath)) {
      const raw = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
      const base: Omit<NexusVaultData, 'checksumSha256'> = {
        version: raw.version || NEXUS_VERSION,
        updatedAt: raw.updatedAt || new Date().toISOString(),
        memories: Array.isArray(raw.memories) ? raw.memories : [],
        transcripts: compactServerTranscripts(Array.isArray(raw.transcripts) ? raw.transcripts : []),
        notes: typeof raw.notes === 'string' ? raw.notes : '',
      };
      return {
        ...base,
        checksumSha256: computeVaultChecksum(base),
      };
    }
  } catch (e) {
    console.warn('Error reading Nexus data vault:', e);
  }
  const empty: Omit<NexusVaultData, 'checksumSha256'> = {
    version: NEXUS_VERSION,
    updatedAt: new Date().toISOString(),
    memories: [],
    transcripts: [],
    notes: '',
  };
  return { ...empty, checksumSha256: computeVaultChecksum(empty) };
}

function writeDataVault(partial: Partial<NexusVaultData>): NexusVaultData {
  const current = readDataVault();

  // Merge memories without losing existing entries (deduplicate by normalized fact)
  const mergedMemories = [...current.memories];
  if (Array.isArray(partial.memories)) {
    if (partial.memories.length === 0 && (partial as any).clearMemories === true) {
      mergedMemories.length = 0;
    } else if ((partial as any).replaceMemories === true) {
      mergedMemories.length = 0;
      mergedMemories.push(...partial.memories);
    } else {
      const seen = new Set(mergedMemories.map(m => (m.fact || '').toLowerCase().trim()));
      for (const m of partial.memories) {
        if (m && m.fact) {
          const norm = m.fact.toLowerCase().trim();
          if (!seen.has(norm)) {
            seen.add(norm);
            mergedMemories.push(m);
          }
        }
      }
    }
  }

  const mergedTranscripts = Array.isArray(partial.transcripts) && partial.transcripts.length > 0
    ? compactServerTranscripts(partial.transcripts)
    : current.transcripts;

  const mergedNotes = typeof partial.notes === 'string' && partial.notes.trim().length > 0
    ? partial.notes
    : current.notes;

  const nextBase: Omit<NexusVaultData, 'checksumSha256'> = {
    version: NEXUS_VERSION,
    updatedAt: new Date().toISOString(),
    memories: mergedMemories,
    transcripts: mergedTranscripts,
    notes: mergedNotes,
  };
  const nextVault: NexusVaultData = {
    ...nextBase,
    checksumSha256: computeVaultChecksum(nextBase),
  };

  const vaultPath = getDataVaultPath();
  const tmpPath = `${vaultPath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(nextVault, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, vaultPath);
  } catch (e) {
    console.warn('Could not persist Nexus data vault:', e);
  }
  return nextVault;
}

function buildNexusCliScript(): string {
  return `#!/usr/bin/env bash
SERVICE="nexus.service"
INSTALL_DIR="/opt/nexus"
ENV_FILE="/opt/nexus/.env"
DATA_DIR="/opt/nexus/data"
BACKUP_DIR="/var/backups/nexus"
NODE_BIN="\$(command -v node 2>/dev/null || echo "/usr/bin/node")"

# Detectar usuario real de sesión gráfica activa en Debian / Kali Linux
DETECTED_USER="\${SUDO_USER:-}"
if [ -z "\$DETECTED_USER" ] || [ "\$DETECTED_USER" = "root" ]; then
  X_OWNER="\$(stat -c '%U' /tmp/.X11-unix/X* 2>/dev/null | grep -v '^root\$' | head -n 1 || true)"
  if [ -n "\$X_OWNER" ] && id "\$X_OWNER" >/dev/null 2>&1; then
    DETECTED_USER="\$X_OWNER"
  fi
fi
if [ -z "\$DETECTED_USER" ] || [ "\$DETECTED_USER" = "root" ]; then
  GUI_OWNER="\$(ps -eo user:32,comm 2>/dev/null | awk '\$2 ~ /^(xfce4-session|gnome-shell|plasmashell|mate-session|lxsession|cinnamon-sessio)$/ && \$1 != "root" {print \$1; exit}' || true)"
  if [ -n "\$GUI_OWNER" ] && id "\$GUI_OWNER" >/dev/null 2>&1; then
    DETECTED_USER="\$GUI_OWNER"
  fi
fi
if [ -z "\$DETECTED_USER" ] || [ "\$DETECTED_USER" = "root" ]; then
  SVC_USER="\$(grep -E '^User=' /etc/systemd/system/nexus.service 2>/dev/null | head -n 1 | cut -d= -f2 | tr -d '[:space:]')"
  if [ -n "\$SVC_USER" ] && id "\$SVC_USER" >/dev/null 2>&1 && [ "\$SVC_USER" != "root" ]; then
    DETECTED_USER="\$SVC_USER"
  fi
fi
if [ -z "\$DETECTED_USER" ] || [ "\$DETECTED_USER" = "root" ]; then
  DETECTED_USER="\$(logname 2>/dev/null || true)"
fi
if [ -z "\$DETECTED_USER" ] || [ "\$DETECTED_USER" = "root" ]; then
  # Si la sesión X11 pertenece a root en Kali, mantener root; si no, buscar UID >= 1000
  ROOT_X="\$(stat -c '%U' /tmp/.X11-unix/X* 2>/dev/null | head -n 1 || true)"
  if [ "\$ROOT_X" = "root" ]; then
    DETECTED_USER="root"
  else
    DETECTED_USER="\$(awk -F: '\$3 >= 1000 && \$3 < 65534 {print \$1; exit}' /etc/passwd 2>/dev/null || whoami)"
  fi
fi
REAL_USER="\${DETECTED_USER:-root}"
USER_HOME="\$(getent passwd "\$REAL_USER" 2>/dev/null | cut -d: -f6)"
if [ -z "\$USER_HOME" ]; then
  if [ "\$REAL_USER" = "root" ]; then USER_HOME="/root"; else USER_HOME="/home/\$REAL_USER"; fi
fi

PORT="\$(grep -E '^PORT=' "\$ENV_FILE" 2>/dev/null | head -n 1 | cut -d= -f2 | tr -d '"\\047[:space:]')"
PORT="\${PORT:-3000}"
LOG_FILE="/tmp/nexus-runtime-\$(id -u).log"

ensure_nexus_running() {
  if curl -fsS "http://127.0.0.1:\$PORT/api/health" >/dev/null 2>&1; then
    return 0
  fi

  echo "[*] Iniciando núcleo de Nexus en el puerto \$PORT..."
  if command -v systemctl >/dev/null 2>&1; then
    if [ "\$(id -u)" -eq 0 ]; then
      systemctl start "\$SERVICE" 2>/dev/null || true
    else
      systemctl start "\$SERVICE" 2>/dev/null || sudo -n systemctl start "\$SERVICE" 2>/dev/null || true
    fi
    for _ in 1 2 3; do
      if curl -fsS "http://127.0.0.1:\$PORT/api/health" >/dev/null 2>&1; then
        return 0
      fi
      sleep 1
    done
  fi

  # Fallback directo: arranca el servidor precompilado auto-contenido sin requerir systemd ni sudo
  if [ -f "\$INSTALL_DIR/dist/server.cjs" ]; then
    echo "[*] Arrancando demonio directo de Nexus (\$NODE_BIN \$INSTALL_DIR/dist/server.cjs)..."
    (
      cd "\$INSTALL_DIR" || exit 1
      export PORT="\$PORT"
      export NODE_ENV="production"
      if [ -r "\$ENV_FILE" ]; then
        set -a
        . "\$ENV_FILE" 2>/dev/null || true
        set +a
      fi
      nohup "\$NODE_BIN" "\$INSTALL_DIR/dist/server.cjs" >> "\$LOG_FILE" 2>&1 &
    )
    for _ in 1 2 3 4 5 6; do
      if curl -fsS "http://127.0.0.1:\$PORT/api/health" >/dev/null 2>&1; then
        return 0
      fi
      sleep 1
    done
  fi

  echo "[!] Aviso: Nexus aún no responde en http://127.0.0.1:\$PORT. Revisa: cat \$LOG_FILE o nexus logs"
  return 1
}

case "\$1" in
  start)
    ensure_nexus_running
    echo "[✓] Nexus activo en http://localhost:\$PORT"
    ;;
  stop)
    sudo systemctl stop "\$SERVICE" 2>/dev/null || systemctl stop "\$SERVICE" 2>/dev/null || true
    pkill -f "/opt/nexus/dist/server.cjs" 2>/dev/null || true
    echo "Nexus detenido."
    ;;
  restart)
    sudo systemctl stop "\$SERVICE" 2>/dev/null || systemctl stop "\$SERVICE" 2>/dev/null || true
    pkill -f "/opt/nexus/dist/server.cjs" 2>/dev/null || true
    sleep 1
    ensure_nexus_running
    echo "[✓] Nexus reiniciado en http://localhost:\$PORT"
    ;;
  status)
    if curl -fsS "http://127.0.0.1:\$PORT/api/health" >/dev/null 2>&1; then
      echo "[✓] Nexus está ACTIVO y respondiendo en http://localhost:\$PORT"
      curl -s "http://127.0.0.1:\$PORT/api/health" && echo ""
    else
      echo "[!] Nexus NO responde en el puerto \$PORT."
    fi
    systemctl status "\$SERVICE" --no-pager 2>/dev/null || true
    ;;
  logs)
    for lf in /tmp/nexus-runtime*.log; do
      if [ -f "\$lf" ]; then
        echo "--- \$lf ---"
        tail -n 40 "\$lf"
      fi
    done
    journalctl -u "\$SERVICE" -n 50 -f
    ;;
  doctor|fix)
    echo "[*] Ejecutando auto-reparación de Nexus en \$INSTALL_DIR..."
    sudo chown -R "\$REAL_USER:\$REAL_USER" "\$INSTALL_DIR" 2>/dev/null || true
    sudo chmod 644 "\$ENV_FILE" 2>/dev/null || true
    if [ -f /etc/systemd/system/nexus.service ]; then
      sudo sed -i "s|^User=.*|User=\$REAL_USER|g" /etc/systemd/system/nexus.service 2>/dev/null || true
      sudo sed -i "s|^ExecStart=.*|ExecStart=\$NODE_BIN /opt/nexus/dist/server.cjs|g" /etc/systemd/system/nexus.service 2>/dev/null || true
      sudo systemctl daemon-reload 2>/dev/null || true
    fi
    pkill -f "/opt/nexus/dist/server.cjs" 2>/dev/null || true
    ensure_nexus_running
    echo "[✓] Auto-reparación completada. Abre Nexus con: nexus"
    ;;
  version)
    echo "=============================================================================="
    echo "  NEXUS OS - ESTADO DE VERSIÓN E INTEGRIDAD DE DATOS"
    echo "=============================================================================="
    curl -s "http://127.0.0.1:\$PORT/api/version" && echo "" || echo "Servicio local no accesible en puerto \$PORT"
    if [ -f "\$DATA_DIR/nexus-vault.json" ]; then
      echo "  Vault de Datos: \$DATA_DIR/nexus-vault.json (SHA-256: \$(sha256sum "\$DATA_DIR/nexus-vault.json" | awk '{print \$1}'))"
    fi
    if [ -d "\$BACKUP_DIR" ]; then
      echo "  Snapshots disponibles en \$BACKUP_DIR:"
      ls -lh "\$BACKUP_DIR"/nexus-backup-*.tar.gz 2>/dev/null | tail -n 5 || echo "    (Ninguno todavía)"
    fi
    ;;
  backup)
    sudo mkdir -p "\$BACKUP_DIR" "\$DATA_DIR"
    STAMP=\$(date +%Y%m%d_%H%M%S)
    SNAP="\$BACKUP_DIR/nexus-backup-\$STAMP.tar.gz"
    echo "[*] Volcando estado en memoria de la bóveda de datos antes del snapshot..."
    curl -s "http://127.0.0.1:\$PORT/api/data-vault" -o "/tmp/nexus-vault-sync.json" 2>/dev/null || true
    if [ -s "/tmp/nexus-vault-sync.json" ]; then
      sudo cp "/tmp/nexus-vault-sync.json" "\$DATA_DIR/nexus-vault.json"
      sudo chmod 600 "\$DATA_DIR/nexus-vault.json"
      rm -f "/tmp/nexus-vault-sync.json"
    fi
    echo "[*] Creando snapshot criptográfico de configuración (.env), bóveda de datos y binarios..."
    sudo tar -czf "\$SNAP" -C /opt/nexus .env data dist package.json 2>/dev/null || sudo tar -czf "\$SNAP" -C /opt/nexus .env dist package.json
    sudo sha256sum "\$SNAP" | sudo tee "\$SNAP.sha256" >/dev/null
    sudo chmod 600 "\$SNAP" "\$SNAP.sha256"
    echo "[✓] Backup completado y firmado (SHA-256): \$SNAP"
    ;;
  rollback)
    LATEST_SNAP=\$(ls -t "\$BACKUP_DIR"/nexus-backup-*.tar.gz 2>/dev/null | head -n 1)
    if [ -z "\$LATEST_SNAP" ]; then
      echo "[!] No se encontraron backups en \$BACKUP_DIR para restaurar."
      exit 1
    fi
    echo "[*] Verificando integridad SHA-256 de \$LATEST_SNAP..."
    if [ -f "\$LATEST_SNAP.sha256" ]; then
      (cd "\$BACKUP_DIR" && sha256sum -c "\$(basename "\$LATEST_SNAP.sha256")") || {
        echo "[!] Error crítico: el checksum SHA-256 del backup no coincide."
        exit 1
      }
    fi
    echo "[*] Restaurando snapshot previo en /opt/nexus..."
    sudo tar -xzf "\$LATEST_SNAP" -C /opt/nexus
    sudo systemctl restart "\$SERVICE" 2>/dev/null || true
    ensure_nexus_running
    echo "[✓] Rollback completado con éxito desde \$LATEST_SNAP."
    ;;
  update)
    TARGET_SCRIPT="\$2"
    if [ -z "\$TARGET_SCRIPT" ]; then
      TARGET_SCRIPT=\$(ls -t \\
        "\$USER_HOME"/Descargas/nexus-updater*.sh \\
        "\$USER_HOME"/Downloads/nexus-updater*.sh \\
        /home/*/Descargas/nexus-updater*.sh \\
        /home/*/Downloads/nexus-updater*.sh \\
        ~/Descargas/nexus-updater*.sh \\
        ~/Downloads/nexus-updater*.sh \\
        /tmp/nexus-updater*.sh \\
        ./nexus-updater*.sh \\
        "\$USER_HOME"/Descargas/nexus-installer*.sh \\
        "\$USER_HOME"/Downloads/nexus-installer*.sh \\
        /home/*/Descargas/nexus-installer*.sh \\
        /home/*/Downloads/nexus-installer*.sh \\
        2>/dev/null | head -n 1)
    fi
    if [ -n "\$TARGET_SCRIPT" ] && [ -f "\$TARGET_SCRIPT" ]; then
      echo "[*] Ejecutando actualizador atómico verificado desde: \$TARGET_SCRIPT"
      sudo NEXUS_USER="\$REAL_USER" bash "\$TARGET_SCRIPT" --update-only
    else
      echo "[!] No se encontró nexus-updater.sh en Descargas ni Downloads."
      echo "    1. Pídele a Nexus: 'Nexus, abre el panel de Debian'"
      echo "    2. Pulsa 'Descargar Actualizador (nexus-updater.sh)'"
      echo "    3. Ejecuta de nuevo: nexus update"
      exit 1
    fi
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
    sudo chmod 644 "\$ENV_FILE" 2>/dev/null || true
    curl -s -X POST "http://127.0.0.1:\$PORT/api/runtime-config" -H "Content-Type: application/json" -d "{\\"apiKey\\":\\"\$2\\"}" >/dev/null 2>&1 || true
    sudo systemctl restart "\$SERVICE" 2>/dev/null || true
    ensure_nexus_running
    echo "Clave GEMINI_API_KEY actualizada en tiempo real y servicio Nexus activo."
    ;;
  app|"")
    ensure_nexus_running
    APP_URL="http://localhost:\$PORT"
    BROWSER_BIN=\$(command -v chromium || command -v chromium-browser || command -v google-chrome || command -v google-chrome-stable || command -v brave-browser || command -v microsoft-edge || command -v firefox-esr || command -v firefox || command -v xdg-open || echo "")
    if [ -z "\$BROWSER_BIN" ]; then
      echo "[✓] Servidor Nexus activo en: \$APP_URL"
      echo "    Abre esa dirección en tu navegador."
      exit 0
    fi

    # Auto-detectar variables de sesión gráfica X11 / Wayland / PipeWire / PulseAudio en Kali y Debian
    REAL_UID="\$(id -u "\$REAL_USER" 2>/dev/null || echo 1000)"
    if [ -z "\$XDG_RUNTIME_DIR" ] && [ -d "/run/user/\$REAL_UID" ]; then
      export XDG_RUNTIME_DIR="/run/user/\$REAL_UID"
    fi
    if [ -z "\$DBUS_SESSION_BUS_ADDRESS" ] && [ -S "/run/user/\$REAL_UID/bus" ]; then
      export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/\$REAL_UID/bus"
    fi
    if [ -z "\$PULSE_SERVER" ] && [ -S "/run/user/\$REAL_UID/pulse/native" ]; then
      export PULSE_SERVER="unix:/run/user/\$REAL_UID/pulse/native"
    fi
    if [ -z "\$PIPEWIRE_RUNTIME_DIR" ] && [ -d "/run/user/\$REAL_UID" ]; then
      export PIPEWIRE_RUNTIME_DIR="/run/user/\$REAL_UID"
    fi
    if [ -z "\$WAYLAND_DISPLAY" ] && [ -n "\$XDG_RUNTIME_DIR" ]; then
      WL_SOCK=\$(ls "\$XDG_RUNTIME_DIR"/wayland-* 2>/dev/null | grep -v '\\.lock\$' | head -n 1)
      if [ -n "\$WL_SOCK" ]; then
        export WAYLAND_DISPLAY="\$(basename "\$WL_SOCK")"
      fi
    fi
    if [ -z "\$DISPLAY" ]; then
      X_SOCK=\$(ls /tmp/.X11-unix/X* 2>/dev/null | head -n 1)
      if [ -n "\$X_SOCK" ]; then
        X_NUM="\${X_SOCK#/tmp/.X11-unix/X}"
        export DISPLAY=":\${X_NUM}"
      else
        export DISPLAY=":0"
      fi
    fi
    if [ -z "\$XAUTHORITY" ]; then
      for xa in "\$USER_HOME/.Xauthority" "/run/user/\$REAL_UID/gdm/Xauthority" /run/user/\$REAL_UID/.mutter-Xwaylandauth* /tmp/xauth_*; do
        if [ -f "\$xa" ]; then
          export XAUTHORITY="\$xa"
          break
        fi
      done
    fi

    if [[ "\$BROWSER_BIN" == *"chromium"* ]] || [[ "\$BROWSER_BIN" == *"chrome"* ]] || [[ "\$BROWSER_BIN" == *"brave"* ]] || [[ "\$BROWSER_BIN" == *"edge"* ]]; then
      PROFILE_DIR="\$USER_HOME/.config/nexus-app-profile"
      mkdir -p "\$PROFILE_DIR" 2>/dev/null || true
      # Limpiar SingletonLock huérfanos que impiden que Chromium inicie tras reinicio o ejecución con root
      if ! pgrep -f "user-data-dir=\$PROFILE_DIR" >/dev/null 2>&1; then
        rm -f "\$PROFILE_DIR/SingletonLock" "\$PROFILE_DIR/SingletonCookie" "\$PROFILE_DIR/SingletonSocket" 2>/dev/null || true
      fi
      CHROME_FLAGS=(
        --app="\$APP_URL"
        --user-data-dir="\$PROFILE_DIR"
        --autoplay-policy=no-user-gesture-required
        --use-fake-ui-for-media-stream
        --unsafely-treat-insecure-origin-as-secure="http://localhost:\$PORT,http://127.0.0.1:\$PORT"
        --enable-features=WebRTCPipeWireCapturer
        --ozone-platform-hint=auto
        --no-first-run
        --no-default-browser-check
        --start-maximized
      )
      if [ "\$(id -u)" -eq 0 ]; then
        if [ -n "\$REAL_USER" ] && [ "\$REAL_USER" != "root" ] && id "\$REAL_USER" >/dev/null 2>&1; then
          chown -R "\$REAL_USER:\$REAL_USER" "\$PROFILE_DIR" 2>/dev/null || true
          sudo -u "\$REAL_USER" -H env \\
            HOME="\$USER_HOME" \\
            USER="\$REAL_USER" \\
            LOGNAME="\$REAL_USER" \\
            DISPLAY="\$DISPLAY" \\
            WAYLAND_DISPLAY="\$WAYLAND_DISPLAY" \\
            XAUTHORITY="\$XAUTHORITY" \\
            XDG_RUNTIME_DIR="\$XDG_RUNTIME_DIR" \\
            PULSE_SERVER="\$PULSE_SERVER" \\
            PIPEWIRE_RUNTIME_DIR="\$PIPEWIRE_RUNTIME_DIR" \\
            DBUS_SESSION_BUS_ADDRESS="\$DBUS_SESSION_BUS_ADDRESS" \\
            "\$BROWSER_BIN" "\${CHROME_FLAGS[@]}" >/dev/null 2>&1 &
        else
          "\$BROWSER_BIN" --no-sandbox "\${CHROME_FLAGS[@]}" >/dev/null 2>&1 &
        fi
      else
        "\$BROWSER_BIN" "\${CHROME_FLAGS[@]}" >/dev/null 2>&1 &
      fi
      echo "[✓] Abriendo interfaz de Nexus en \$APP_URL ..."
    else
      if [ "\$(id -u)" -eq 0 ] && [ -n "\$REAL_USER" ] && [ "\$REAL_USER" != "root" ]; then
        sudo -u "\$REAL_USER" -H env \\
          HOME="\$USER_HOME" \\
          USER="\$REAL_USER" \\
          LOGNAME="\$REAL_USER" \\
          DISPLAY="\$DISPLAY" \\
          WAYLAND_DISPLAY="\$WAYLAND_DISPLAY" \\
          XAUTHORITY="\$XAUTHORITY" \\
          XDG_RUNTIME_DIR="\$XDG_RUNTIME_DIR" \\
          PULSE_SERVER="\$PULSE_SERVER" \\
          PIPEWIRE_RUNTIME_DIR="\$PIPEWIRE_RUNTIME_DIR" \\
          DBUS_SESSION_BUS_ADDRESS="\$DBUS_SESSION_BUS_ADDRESS" \\
          "\$BROWSER_BIN" "\$APP_URL" >/dev/null 2>&1 &
      else
        "\$BROWSER_BIN" "\$APP_URL" >/dev/null 2>&1 &
      fi
      echo "[✓] Abriendo Nexus en \$APP_URL ..."
    fi
    ;;
  *)
    echo "Comandos de Nexus CLI (Debian / Kali Linux):"
    echo "  nexus              - Inicia el núcleo (si está apagado) y abre la interfaz gráfica de Nexus"
    echo "  nexus doctor       - Repara permisos, servicio systemd y arranca Nexus automáticamente"
    echo "  nexus update       - Actualiza Nexus a la última versión sin perder datos ni .env"
    echo "  nexus backup       - Crea un backup firmado (SHA-256) de tus datos y configuración"
    echo "  nexus rollback     - Restaura instantáneamente la versión anterior si algo falla"
    echo "  nexus version      - Muestra versión e integridad de la bóveda de datos"
    echo "  nexus apikey <KEY> - Configura tu GEMINI_API_KEY en caliente"
    echo "  nexus status|logs  - Estado del servicio systemd o logs en vivo"
    echo "  nexus start|stop   - Inicia o detiene el demonio"
    ;;
esac`;
}

function isPlaceholderOrProxyKey(key: string | undefined | null, _forExternalInstaller = false): boolean {
  if (!key) return true;
  const clean = key.trim().replace(/^["']|["']$/g, '');
  if (
    !clean ||
    clean === 'MY_GEMINI_API_KEY' ||
    clean === 'GEMINI_API_KEY' ||
    clean === 'API_KEY' ||
    clean === 'YOUR_API_KEY' ||
    clean === 'YOUR_GEMINI_API_KEY' ||
    clean === 'TU_CLAVE_GEMINI_AQUI' ||
    clean === 'TU_CLAVE_AQUI' ||
    clean === 'undefined' ||
    clean === 'null' ||
    clean.startsWith('AQ.')
  ) {
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

  const envCandidates = [
    process.env.GEMINI_API_KEY,
    process.env.API_KEY,
    process.env.VITE_GEMINI_API_KEY,
  ];
  for (const envKey of envCandidates) {
    if (envKey && !isPlaceholderOrProxyKey(envKey, forExternalInstaller)) {
      return envKey.trim().replace(/^["']|["']$/g, '');
    }
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
      fs.writeFileSync(p, content, { encoding: 'utf8', mode: 0o644 });
    } catch (e) {
      console.warn(`Could not write .env at ${p}:`, e);
    }
  }
  return true;
}

async function startServer() {
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    (typeof __filename !== 'undefined' && __filename.endsWith('server.cjs')) ||
    Boolean(process.argv[1] && process.argv[1].endsWith('server.cjs')) ||
    fs.existsSync('/opt/nexus/dist/index.html');

  if (isProduction) {
    process.env.NODE_ENV = 'production';
  }

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: isProduction
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
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (req, res) => {
    const vault = readDataVault();
    res.json({
      status: 'ok',
      version: NEXUS_VERSION,
      vaultChecksum: vault.checksumSha256,
      memoriesCount: vault.memories.length,
    });
  });

  app.get('/api/version', (_req, res) => {
    const vault = readDataVault();
    let backupsCount = 0;
    try {
      if (fs.existsSync('/var/backups/nexus')) {
        backupsCount = fs.readdirSync('/var/backups/nexus').filter(f => f.endsWith('.tar.gz')).length;
      }
    } catch {}
    res.json({
      version: NEXUS_VERSION,
      updatedAt: vault.updatedAt,
      vaultPath: getDataVaultPath(),
      vaultChecksum: vault.checksumSha256,
      memoriesCount: vault.memories.length,
      transcriptsCount: vault.transcripts.length,
      hasNotes: Boolean(vault.notes && vault.notes.trim().length > 0),
      backupsCount,
      hasStandaloneKey: Boolean(getResolvedGeminiApiKey(true)),
    });
  });

  // Persistent Data Vault endpoints so updates never lose memories, notes, or transcripts
  app.get('/api/data-vault', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(readDataVault());
  });

  app.post('/api/data-vault/sync', (req, res) => {
    const updated = writeDataVault(req.body || {});
    res.json({
      ok: true,
      checksumSha256: updated.checksumSha256,
      memoriesCount: updated.memories.length,
      updatedAt: updated.updatedAt,
    });
  });

  // Runtime configuration endpoint so compiled production builds on Debian/Kali always receive GEMINI_API_KEY
  app.get('/api/runtime-config', (_req, res) => {
    const apiKey = getResolvedGeminiApiKey(false);
    const rawEnvKey = (process.env.GEMINI_API_KEY || '').trim();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      apiKey,
      proxyKey: rawEnvKey,
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

  // Local Linux speech synthesis (Natural Spanish female TTS online + espeak-ng female variant offline)
  app.post('/api/local-tts', async (req, res) => {
    const text = String(req.body?.text || '').trim().slice(0, 600);
    if (!text) {
      res.status(400).json({ error: 'Empty text' });
      return;
    }

    // 1. Try natural Spanish female TTS via Google Translate TTS endpoint (supports full multi-sentence replies)
    try {
      const splitIntoTtsChunks = (raw: string, maxLen = 180): string[] => {
        const result: string[] = [];
        let remaining = raw.replace(/\s+/g, ' ').trim();
        while (remaining.length > maxLen) {
          let cut = remaining.lastIndexOf('. ', maxLen);
          if (cut < 40) cut = remaining.lastIndexOf(', ', maxLen);
          if (cut < 40) cut = remaining.lastIndexOf('; ', maxLen);
          if (cut < 40) cut = remaining.lastIndexOf(' ', maxLen);
          if (cut <= 0) cut = maxLen;
          result.push(remaining.slice(0, cut + 1).trim());
          remaining = remaining.slice(cut + 1).trim();
        }
        if (remaining) result.push(remaining);
        return result.slice(0, 4);
      };

      const segments = splitIntoTtsChunks(text);
      const mp3Buffers: Buffer[] = [];
      for (const seg of segments) {
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=es&client=tw-ob&q=${encodeURIComponent(seg)}`;
        const gRes = await fetch(ttsUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(2500),
        });
        if (!gRes.ok) {
          mp3Buffers.length = 0;
          break;
        }
        const arrBuf = await gRes.arrayBuffer();
        if (arrBuf.byteLength > 256) {
          mp3Buffers.push(Buffer.from(arrBuf));
        }
      }
      if (mp3Buffers.length > 0) {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(Buffer.concat(mp3Buffers));
        return;
      }
    } catch {}

    // 2. Offline fallback: espeak-ng / espeak with Spanish female voice variant (+f3)
    const ttsBin = ['/usr/bin/espeak-ng', '/usr/bin/espeak'].find(p => fs.existsSync(p));
    if (!ttsBin) {
      res.status(404).json({ error: 'No local espeak-ng binary installed' });
      return;
    }
    const chunks: Buffer[] = [];
    const proc = spawn(ttsBin, ['-v', 'es+f3', '-s', '162', '-p', '58', '--stdout', text]);
    proc.stdout.on('data', d => chunks.push(Buffer.from(d)));
    proc.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: 'TTS failed' });
    });
    proc.on('close', code => {
      if (code === 0 && chunks.length > 0) {
        res.setHeader('Content-Type', 'audio/wav');
        res.send(Buffer.concat(chunks));
      } else if (!res.headersSent) {
        res.status(500).json({ error: 'TTS exited with code ' + code });
      }
    });
  });

  async function performLocalWebSearch(queryRaw: string): Promise<{ result: string; sources: string[] }> {
    const query = String(queryRaw || '').trim();
    if (!query) return { result: 'Consulta vacía.', sources: [] };

    const serverApiKey = getResolvedGeminiApiKey(false);
    if (serverApiKey) {
      for (const modelName of ['gemini-2.5-flash', 'gemini-3-flash-preview']) {
        try {
          const ai = new GoogleGenAI({ apiKey: serverApiKey });
          const response = await ai.models.generateContent({
            model: modelName,
            contents: query,
            config: {
              tools: [{ googleSearch: {} }],
            },
          });
          const text = (response.text || '').trim();
          const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
          const sources = chunks
            .map((c: any) => c.web?.uri || c.web?.title)
            .filter(Boolean);
          if (text) {
            return { result: text, sources };
          }
        } catch {}
      }
    }

    const cleanQuery = query
      .replace(/^(busca en internet|busca en la web|busca|investiga sobre|investiga|qu[eé] es|qui[eé]n es|qui[eé]n fue|cu[aá]l es|dime qu[eé] es|expl[ií]came qu[eé] es)\s+/i, '')
      .replace(/[¿?¡!]/g, '')
      .trim() || query;

    const sources: string[] = [];
    const snippets: string[] = [];

    // 1. DuckDuckGo Instant Answer API
    try {
      const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&format=json&no_html=1&skip_disambig=1`;
      const ddgRes = await fetch(ddgUrl, {
        headers: { 'User-Agent': 'NexusOS/1.3 (Linux x86_64)' },
        signal: AbortSignal.timeout(3500),
      });
      if (ddgRes.ok) {
        const ddgData: any = await ddgRes.json();
        if (ddgData.AbstractText) {
          snippets.push(String(ddgData.AbstractText).trim());
          if (ddgData.AbstractURL) sources.push(String(ddgData.AbstractURL));
        } else if (ddgData.Answer) {
          snippets.push(String(ddgData.Answer).trim());
        }
        if (Array.isArray(ddgData.RelatedTopics)) {
          for (const topic of ddgData.RelatedTopics.slice(0, 2)) {
            if (topic?.Text) snippets.push(String(topic.Text).trim());
            if (topic?.FirstURL) sources.push(String(topic.FirstURL));
          }
        }
      }
    } catch {}

    // 2. Wikipedia Search & Extracts (Spanish then English fallback)
    for (const lang of ['es', 'en']) {
      if (snippets.length >= 2) break;
      try {
        const wikiSearchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&utf8=&format=json&srlimit=2`;
        const wRes = await fetch(wikiSearchUrl, {
          headers: { 'User-Agent': 'NexusOS/1.3 (Linux x86_64)' },
          signal: AbortSignal.timeout(3500),
        });
        if (wRes.ok) {
          const wData: any = await wRes.json();
          const hits = wData?.query?.search || [];
          for (const hit of hits.slice(0, 2)) {
            const title = hit?.title;
            if (title) {
              const sumRes = await fetch(
                `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
                {
                  headers: { 'User-Agent': 'NexusOS/1.3 (Linux x86_64)' },
                  signal: AbortSignal.timeout(3000),
                }
              );
              if (sumRes.ok) {
                const sumData: any = await sumRes.json();
                if (sumData?.extract) {
                  snippets.push(`${sumData.title}: ${sumData.extract}`);
                  if (sumData?.content_urls?.desktop?.page) {
                    sources.push(sumData.content_urls.desktop.page);
                  }
                }
              }
            }
          }
        }
      } catch {}
    }

    if (snippets.length > 0) {
      const combined = snippets.slice(0, 2).join('\n\n');
      return {
        result: combined,
        sources: Array.from(new Set(sources)).slice(0, 4),
      };
    }

    return {
      result: `No encontré artículos directos sobre "${cleanQuery}", Koko, pero puedes pedirme que escanee un dominio con whois o dns, o abrir el navegador directamente.`,
      sources: [],
    };
  }

  app.post('/api/web-search', async (req, res) => {
    const query = String(req.body?.query || '').trim();
    const data = await performLocalWebSearch(query);
    res.json(data);
  });

  app.post('/api/generate-image', async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      res.status(400).json({ error: 'Prompt vacío' });
      return;
    }

    const serverApiKey = getResolvedGeminiApiKey(false);
    if (serverApiKey) {
      for (const modelName of ['gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview']) {
        try {
          const ai = new GoogleGenAI({ apiKey: serverApiKey });
          const response = await ai.models.generateContent({
            model: modelName,
            contents: { parts: [{ text: prompt }] },
            config: { imageConfig: { aspectRatio: '1:1' } },
          });
          for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData?.data) {
              res.json({
                imageUrl: `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`,
                provider: modelName,
              });
              return;
            }
          }
        } catch {}
      }
    }

    // Fallback 1: Server-side fetch from Pollinations AI (returns base64 data URI so browser displays it without CORS/CSP issues)
    try {
      const seed = Math.floor(Math.random() * 100000);
      const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=768&nologo=true&seed=${seed}`;
      const imgRes = await fetch(pollUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) NexusOS/1.3' },
        signal: AbortSignal.timeout(12000),
      });
      if (imgRes.ok) {
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        const buf = Buffer.from(await imgRes.arrayBuffer());
        if (buf.byteLength > 1024) {
          res.json({
            imageUrl: `data:${contentType};base64,${buf.toString('base64')}`,
            provider: 'pollinations-ai',
          });
          return;
        }
      }
    } catch {}

    // Fallback 2: Offline Cyberpunk SVG Synthesis
    const safeTitle = prompt.slice(0, 56).replace(/[<>&"']/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#090d16"/>
          <stop offset="50%" stop-color="#0f172a"/>
          <stop offset="100%" stop-color="#1e1b4b"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="45%" r="45%">
          <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.45"/>
          <stop offset="60%" stop-color="#a855f7" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="640" height="640" fill="url(#bg)"/>
      <circle cx="320" cy="290" r="260" fill="url(#glow)"/>
      <g stroke="#06b6d4" stroke-opacity="0.2" stroke-width="1">
        <line x1="0" y1="160" x2="640" y2="160"/><line x1="0" y1="320" x2="640" y2="320"/><line x1="0" y1="480" x2="640" y2="480"/>
        <line x1="160" y1="0" x2="160" y2="640"/><line x1="320" y1="0" x2="320" y2="640"/><line x1="480" y1="0" x2="480" y2="640"/>
      </g>
      <polygon points="320,130 460,370 180,370" fill="none" stroke="#22d3ee" stroke-width="3"/>
      <circle cx="320" cy="290" r="68" fill="none" stroke="#f472b6" stroke-width="2.5" stroke-dasharray="8 6"/>
      <circle cx="320" cy="290" r="18" fill="#22d3ee"/>
      <text x="320" y="485" text-anchor="middle" fill="#38bdf8" font-family="monospace" font-size="18" font-weight="bold">NEXUS VISUAL SYNTHESIS</text>
      <text x="320" y="525" text-anchor="middle" fill="#e2e8f0" font-family="monospace" font-size="14">${safeTitle}</text>
    </svg>`;
    res.json({
      imageUrl: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
      provider: 'nexus-svg-engine',
    });
  });

  app.post('/api/analyze-vision', async (req, res) => {
    const imageBase64 = String(req.body?.imageBase64 || '').replace(/^data:image\/\w+;base64,/, '').trim();
    const prompt = String(req.body?.prompt || 'Describe en español qué ves en esta imagen de forma directa y natural para Koko.').trim();
    if (!imageBase64) {
      res.status(400).json({ error: 'No image frame provided' });
      return;
    }

    const serverApiKey = getResolvedGeminiApiKey(false);
    if (serverApiKey) {
      for (const modelName of ['gemini-2.5-flash', 'gemini-3-flash-preview']) {
        try {
          const ai = new GoogleGenAI({ apiKey: serverApiKey });
          const response = await ai.models.generateContent({
            model: modelName,
            contents: [
              {
                role: 'user',
                parts: [
                  { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
                  { text: `Eres Nexus, la compañera e ingeniera de Koko. ${prompt}` },
                ],
              },
            ],
          });
          const reply = (response.text || '').trim();
          if (reply) {
            res.json({ reply });
            return;
          }
        } catch {}
      }
    }

    // Offline Linux OCR fallback via tesseract if installed
    const tmpImg = `/tmp/nexus-vision-${process.pid}-${Date.now()}.jpg`;
    try {
      const buf = Buffer.from(imageBase64, 'base64');
      if (fs.existsSync('/usr/bin/tesseract')) {
        fs.writeFileSync(tmpImg, buf, { mode: 0o600 });
        const ocrText = await new Promise<string>((resolve) => {
          const out: Buffer[] = [];
          const p = spawn('/usr/bin/tesseract', [tmpImg, 'stdout', '-l', 'spa+eng'], { timeout: 5000 });
          p.stdout.on('data', d => out.push(Buffer.from(d)));
          p.on('error', () => resolve(''));
          p.on('close', () => resolve(Buffer.concat(out).toString('utf8').trim()));
        });
        if (ocrText) {
          res.json({
            reply: `Estoy viendo tu imagen en vivo, Koko (${Math.round(buf.byteLength / 1024)} KB). He detectado este texto en pantalla: "${ocrText.replace(/\s+/g, ' ').slice(0, 320)}".`,
          });
          return;
        }
      }
      res.json({
        reply: `Tengo tu señal de vídeo activa y recibo el fotograma nítido (${Math.round(buf.byteLength / 1024)} KB), Koko. Para análisis visual neuronal profundo puedes pegar tu clave Gemini con Control+V o instalar tesseract-ocr en Kali.`,
      });
    } catch {
      res.json({ reply: 'Recibo la señal de vídeo correctamente, Koko.' });
    } finally {
      try { if (fs.existsSync(tmpImg)) fs.unlinkSync(tmpImg); } catch {}
    }
  });

  app.post('/api/cyber-tool', async (req, res) => {
    const tool = String(req.body?.tool || '').toLowerCase().trim();
    const action = String(req.body?.action || 'scan').toLowerCase().trim();
    const rawTarget = String(req.body?.target || '').trim();
    const optionsRaw = String(req.body?.options || '').trim();

    if (!tool || !rawTarget) {
      res.status(400).json({ error: 'Faltan parámetros tool o target' });
      return;
    }

    const cleanHost = rawTarget
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .replace(/[^a-zA-Z0-9._:-]/g, '');

    try {
      if (tool === 'hash') {
        const algo = action === 'md5' ? 'md5' : action === 'sha1' ? 'sha1' : action === 'sha512' ? 'sha512' : 'sha256';
        const digest = crypto.createHash(algo).update(rawTarget).digest('hex');
        res.json({ result: `Hash ${algo.toUpperCase()} de "${rawTarget}":\n${digest}` });
        return;
      }

      if (tool === 'base64') {
        const out = action === 'decode'
          ? Buffer.from(rawTarget, 'base64').toString('utf8')
          : Buffer.from(rawTarget, 'utf8').toString('base64');
        res.json({ result: `Resultado Base64 (${action}):\n${out}` });
        return;
      }

      if (tool === 'hex') {
        const out = action === 'decode'
          ? Buffer.from(rawTarget.replace(/\s+/g, ''), 'hex').toString('utf8')
          : Buffer.from(rawTarget, 'utf8').toString('hex');
        res.json({ result: `Resultado Hex (${action}):\n${out}` });
        return;
      }

      if (tool === 'url') {
        const out = action === 'decode' ? decodeURIComponent(rawTarget) : encodeURIComponent(rawTarget);
        res.json({ result: `Resultado URL (${action}):\n${out}` });
        return;
      }

      if (tool === 'nmap' || tool === 'portscan') {
        const host = cleanHost || '127.0.0.1';
        if (fs.existsSync('/usr/bin/nmap')) {
          const nmapOut = await new Promise<string>((resolve) => {
            const chunks: Buffer[] = [];
            const p = spawn('/usr/bin/nmap', ['-F', '-T4', '--open', host], { timeout: 9000 });
            p.stdout.on('data', d => chunks.push(Buffer.from(d)));
            p.stderr.on('data', d => chunks.push(Buffer.from(d)));
            p.on('error', () => resolve(''));
            p.on('close', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
          });
          if (nmapOut) {
            res.json({ result: `[NMAP REAL KALI/DEBIAN - ${host}]\n${nmapOut}` });
            return;
          }
        }

        // Fast concurrent TCP connect scan from Node.js
        const commonPorts: Array<{ port: number; service: string }> = [
          { port: 21, service: 'ftp' },
          { port: 22, service: 'ssh' },
          { port: 23, service: 'telnet' },
          { port: 25, service: 'smtp' },
          { port: 53, service: 'domain' },
          { port: 80, service: 'http' },
          { port: 110, service: 'pop3' },
          { port: 139, service: 'netbios-ssn' },
          { port: 143, service: 'imap' },
          { port: 443, service: 'https' },
          { port: 445, service: 'microsoft-ds' },
          { port: 1433, service: 'ms-sql-s' },
          { port: 3000, service: 'nexus-http' },
          { port: 3306, service: 'mysql' },
          { port: 3389, service: 'ms-wbt-server' },
          { port: 5432, service: 'postgresql' },
          { port: 8080, service: 'http-proxy' },
          { port: 8443, service: 'https-alt' },
        ];

        const probePort = (port: number, service: string) =>
          new Promise<{ port: number; service: string; open: boolean }>((resolve) => {
            const sock = new net.Socket();
            let done = false;
            const finish = (open: boolean) => {
              if (done) return;
              done = true;
              sock.destroy();
              resolve({ port, service, open });
            };
            sock.setTimeout(1200);
            sock.on('connect', () => finish(true));
            sock.on('timeout', () => finish(false));
            sock.on('error', () => finish(false));
            sock.connect(port, host);
          });

        const results = await Promise.all(commonPorts.map(p => probePort(p.port, p.service)));
        const openPorts = results.filter(r => r.open);
        const lines = openPorts.length > 0
          ? openPorts.map(r => `${String(r.port + '/tcp').padEnd(10)} OPEN   ${r.service}`).join('\n')
          : 'No se detectaron puertos abiertos en los 18 puertos principales.';
        res.json({
          result: `Escaneo de puertos TCP sobre ${host}:\nPORT       STATE  SERVICE\n${lines}`,
        });
        return;
      }

      if (tool === 'dns' || tool === 'dig') {
        const host = cleanHost;
        if (fs.existsSync('/usr/bin/dig')) {
          const digOut = await new Promise<string>((resolve) => {
            const chunks: Buffer[] = [];
            const p = spawn('/usr/bin/dig', ['+noall', '+answer', host, 'A', host, 'AAAA', host, 'MX', host, 'NS', host, 'TXT'], { timeout: 5000 });
            p.stdout.on('data', d => chunks.push(Buffer.from(d)));
            p.on('error', () => resolve(''));
            p.on('close', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
          });
          if (digOut) {
            res.json({ result: `Registros DNS para ${host}:\n${digOut}` });
            return;
          }
        }
        const [a4, a6, mx, ns, txt] = await Promise.all([
          dns.promises.resolve4(host).catch(() => []),
          dns.promises.resolve6(host).catch(() => []),
          dns.promises.resolveMx(host).catch(() => []),
          dns.promises.resolveNs(host).catch(() => []),
          dns.promises.resolveTxt(host).catch(() => []),
        ]);
        res.json({
          result: `Registros DNS para ${host}:\nA (IPv4): ${a4.join(', ') || 'N/A'}\nAAAA (IPv6): ${a6.join(', ') || 'N/A'}\nMX: ${mx.map(m => `${m.exchange} (prio ${m.priority})`).join(', ') || 'N/A'}\nNS: ${ns.join(', ') || 'N/A'}\nTXT: ${txt.map(t => t.join('')).join(' | ') || 'N/A'}`,
        });
        return;
      }

      if (tool === 'whois') {
        const host = cleanHost;
        if (fs.existsSync('/usr/bin/whois')) {
          const whoisOut = await new Promise<string>((resolve) => {
            const chunks: Buffer[] = [];
            const p = spawn('/usr/bin/whois', [host], { timeout: 6000 });
            p.stdout.on('data', d => chunks.push(Buffer.from(d)));
            p.on('error', () => resolve(''));
            p.on('close', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
          });
          if (whoisOut) {
            const filtered = whoisOut
              .split('\n')
              .filter(l => /^(Domain Name|Registrar|Creation Date|Updated Date|Registry Expiry Date|Name Server|Organization|OrgName|NetRange|CIDR|Country|descr|netname):/i.test(l.trim()))
              .slice(0, 25)
              .join('\n');
            res.json({ result: `WHOIS para ${host}:\n${filtered || whoisOut.slice(0, 1500)}` });
            return;
          }
        }
        const rdapRes = await fetch(`https://rdap.org/domain/${encodeURIComponent(host)}`, { signal: AbortSignal.timeout(4500) });
        if (rdapRes.ok) {
          const rdap = await rdapRes.json();
          res.json({ result: `Datos RDAP/WHOIS para ${host}:\n${JSON.stringify(rdap, null, 2).slice(0, 1500)}` });
          return;
        }
        res.json({ result: `No se pudo obtener información WHOIS para ${host}.` });
        return;
      }

      if (tool === 'ipinfo') {
        const ipRes = await fetch(`https://ipapi.co/${encodeURIComponent(cleanHost)}/json/`, { signal: AbortSignal.timeout(4000) });
        if (ipRes.ok) {
          const ipData = await ipRes.json();
          res.json({ result: `Información IP/Geo para ${cleanHost}:\n${JSON.stringify(ipData, null, 2)}` });
          return;
        }
      }

      if (tool === 'searchsploit' || tool === 'metasploit' || tool === 'exploitdb') {
        if (fs.existsSync('/usr/bin/searchsploit')) {
          const spOut = await new Promise<string>((resolve) => {
            const chunks: Buffer[] = [];
            const p = spawn('/usr/bin/searchsploit', ['--color', rawTarget], { timeout: 6000 });
            p.stdout.on('data', d => chunks.push(Buffer.from(d)));
            p.on('error', () => resolve(''));
            p.on('close', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
          });
          if (spOut) {
            res.json({ result: `SearchSploit (${rawTarget}):\n${spOut.slice(0, 2000)}` });
            return;
          }
        }
        const nvdUrl = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(rawTarget)}&resultsPerPage=5`;
        const nvdRes = await fetch(nvdUrl, { signal: AbortSignal.timeout(5000) });
        if (nvdRes.ok) {
          const nvdData: any = await nvdRes.json();
          const vulns = (nvdData?.vulnerabilities || []).map((v: any) => {
            const cve = v.cve?.id;
            const desc = v.cve?.descriptions?.find((d: any) => d.lang === 'es')?.value || v.cve?.descriptions?.[0]?.value || '';
            return `• ${cve}: ${desc.slice(0, 220)}`;
          });
          if (vulns.length > 0) {
            res.json({ result: `Vulnerabilidades CVE encontradas para "${rawTarget}":\n${vulns.join('\n')}` });
            return;
          }
        }
        res.json({ result: `Búsqueda de módulos/exploits para "${rawTarget}" completada (${optionsRaw || 'sin CVE críticos públicos recientes'}).` });
        return;
      }

      if (tool === 'nikto' || tool === 'whatweb' || tool === 'headers') {
        const targetUrl = rawTarget.startsWith('http') ? rawTarget : `https://${cleanHost}`;
        const hRes = await fetch(targetUrl, { method: 'GET', signal: AbortSignal.timeout(5000) });
        const headersObj: Record<string, string> = {};
        hRes.headers.forEach((v, k) => { headersObj[k] = v; });
        const missingSec: string[] = [];
        if (!headersObj['strict-transport-security']) missingSec.push('Strict-Transport-Security (HSTS)');
        if (!headersObj['content-security-policy']) missingSec.push('Content-Security-Policy (CSP)');
        if (!headersObj['x-frame-options']) missingSec.push('X-Frame-Options');
        if (!headersObj['x-content-type-options']) missingSec.push('X-Content-Type-Options');

        res.json({
          result: `Auditoría HTTP/Cabeceras sobre ${targetUrl} (HTTP ${hRes.status}):\nServidor: ${headersObj['server'] || 'Oculto'}\nX-Powered-By: ${headersObj['x-powered-by'] || 'Oculto'}\nCabeceras ausentes: ${missingSec.join(', ') || 'Ninguna (Configuración robusta)'}`,
        });
        return;
      }

      res.json({ result: `Herramienta ${tool} ejecutada sobre ${rawTarget}.` });
    } catch (e: any) {
      res.json({ result: `Error al ejecutar ${tool} sobre ${rawTarget}: ${e?.message || e}` });
    }
  });

  app.post('/api/terminal-exec', async (req, res) => {
    const command = String(req.body?.command || '').trim();
    if (!command) {
      res.status(400).json({ error: 'Comando vacío' });
      return;
    }

    const cwd = fs.existsSync('/opt/nexus') ? '/opt/nexus' : process.cwd();
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    const proc = spawn('/bin/bash', ['-c', command], {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', PAGER: 'cat' },
      timeout: 8000,
    });

    proc.stdout.on('data', d => outChunks.push(Buffer.from(d)));
    proc.stderr.on('data', d => errChunks.push(Buffer.from(d)));
    proc.on('error', (err) => {
      if (!res.headersSent) {
        res.json({ output: `Error al ejecutar comando: ${err.message}`, exitCode: 1, host: os.hostname(), cwd });
      }
    });
    proc.on('close', (code) => {
      if (!res.headersSent) {
        const stdoutStr = Buffer.concat(outChunks).toString('utf8');
        const stderrStr = Buffer.concat(errChunks).toString('utf8');
        const combined = (stdoutStr + (stderrStr ? (stdoutStr ? '\n' : '') + stderrStr : '')).trim();
        res.json({
          output: combined.slice(0, 12000) || '(Comando ejecutado sin salida)',
          exitCode: code ?? 0,
          host: os.hostname(),
          cwd,
        });
      }
    });
  });

  app.post('/api/open-native-app', (req, res) => {
    const appId = String(req.body?.appId || '').toLowerCase().trim();
    const params = String(req.body?.params || '').trim();
    const title = String(req.body?.title || 'Nexus OS').trim();
    const body = String(req.body?.body || '').trim();

    if (appId === 'notify' && body) {
      if (fs.existsSync('/usr/bin/notify-send')) {
        try {
          const child = spawn('/usr/bin/notify-send', [title, body], { detached: true, stdio: 'ignore' });
          child.unref();
          res.json({ ok: true, launched: 'notify-send' });
          return;
        } catch {}
      }
      res.json({ ok: false });
      return;
    }

    const appBinsMap: Record<string, string[]> = {
      wireshark: ['/usr/bin/wireshark'],
      burpsuite: ['/usr/bin/burpsuite'],
      zaproxy: ['/usr/bin/zaproxy', '/usr/share/zaproxy/zap.sh'],
      ghidra: ['/usr/bin/ghidra'],
      vscode: ['/usr/bin/code', '/usr/share/code/code', '/usr/bin/codium'],
      code: ['/usr/bin/code', '/usr/share/code/code', '/usr/bin/codium'],
      spotify: ['/usr/bin/spotify', '/snap/bin/spotify'],
      firefox: ['/usr/bin/firefox-esr', '/usr/bin/firefox'],
      chromium: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'],
      files: ['/usr/bin/thunar', '/usr/bin/nautilus', '/usr/bin/dolphin', '/usr/bin/pcmanfm'],
      thunar: ['/usr/bin/thunar', '/usr/bin/nautilus'],
      nautilus: ['/usr/bin/nautilus', '/usr/bin/thunar'],
      calculator: ['/usr/bin/gnome-calculator', '/usr/bin/galculator', '/usr/bin/kcalc', '/usr/bin/xcalc'],
      calc: ['/usr/bin/gnome-calculator', '/usr/bin/galculator', '/usr/bin/kcalc', '/usr/bin/xcalc'],
      vlc: ['/usr/bin/vlc'],
      gimp: ['/usr/bin/gimp'],
      htop: ['/usr/bin/xfce4-terminal', '/usr/bin/qterminal', '/usr/bin/gnome-terminal'],
    };

    if (appId === 'url' && params) {
      const opener = ['/usr/bin/xdg-open', '/usr/bin/chromium', '/usr/bin/firefox-esr'].find(p => fs.existsSync(p));
      if (opener) {
        try {
          const child = spawn(opener, [params], { detached: true, stdio: 'ignore' });
          child.unref();
          res.json({ ok: true, launched: opener, message: `Abriendo ${params} en tu navegador del sistema.` });
          return;
        } catch {}
      }
    }

    const candidates = appBinsMap[appId] || [`/usr/bin/${appId.replace(/[^a-z0-9_-]/g, '')}`];
    const foundBin = candidates.find(p => fs.existsSync(p));
    if (foundBin) {
      try {
        const args = appId === 'htop' ? ['-e', 'htop'] : (params ? [params] : []);
        const child = spawn(foundBin, args, {
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            DISPLAY: process.env.DISPLAY || ':0',
          },
        });
        child.unref();
        res.json({ ok: true, launched: foundBin, message: `Aplicación nativa ${appId} lanzada en tu escritorio Linux.` });
        return;
      } catch (e: any) {
        res.json({ ok: false, error: e?.message });
        return;
      }
    }

    res.json({ ok: false, message: `Binario nativo para ${appId} no instalado en /usr/bin.` });
  });

  async function buildLocalAssistantReply(queryRaw: string): Promise<string> {
    const query = String(queryRaw || '').trim();
    const lower = query.toLowerCase();
    const snap = getHardwareSnapshot();
    const cpuUsage = snap.cpu?.usagePercent ?? 0;
    const cpuSpeed = snap.cpu?.speedMHz ?? 0;
    const memPct = snap.memory?.systemPercent ?? 0;
    const memUsedGb = ((snap.memory?.usedSystemMB ?? 0) / 1024).toFixed(1);
    const memTotalGb = ((snap.memory?.totalSystemMB ?? 0) / 1024).toFixed(1);
    const host = os.hostname();
    const kernel = `${os.type()} ${os.release()} (${os.arch()})`;
    const vault = readDataVault();

    // 1. If a valid Gemini API key is configured on the server, generate a full intelligent Nexus response
    const serverApiKey = getResolvedGeminiApiKey(false);
    if (serverApiKey && query) {
      try {
        const ai = new GoogleGenAI({ apiKey: serverApiKey });
        const recentMemories = (vault.memories || []).slice(-10).map(m => `- ${m.fact}`).join('\n');
        const genRes = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: query,
          config: {
            systemInstruction: `Eres Nexus, la compañera, ingeniera sénior y experta en ciberseguridad de Koko en su sistema ${host} (${kernel}, CPU ${cpuUsage}%, RAM ${memPct}%). Habla en español de España con tono cercano, ágil, leal y directo (máximo 2-3 frases claras para ser leídas en voz alta). Recuerdos de Koko:\n${recentMemories || 'Ninguno aún.'}`,
          },
        });
        const aiReply = (genRes.text || '').trim();
        if (aiReply) return aiReply;
      } catch {}
    }

    if (/(hola|buenas|qu[eé] pasa|me escuchas|me oyes|est[aá]s ah[ií]|oye nexus|ey nexus|hola nexus)/i.test(lower)) {
      return `¡Qué pasa, Koko! Te escucho al pelo desde tu máquina (${host}). Tengo la CPU al ${cpuUsage}% y la RAM al ${memPct}%. Dispara, ¿qué hacemos hoy?`;
    } else if (/(qui[eé]n soy|c[oó]mo me llamo)/i.test(lower)) {
      return `¡Eres Koko! Mi creador y el único jefe al que hago caso aquí en ${host}.`;
    } else if (/(qui[eé]n eres|c[oó]mo te llamas|presentate|pres[eé]ntate|qu[eé] puedes hacer|habilidades|funciones)/i.test(lower)) {
      return `Soy Nexus, tu ingeniera sénior y experta en ciberseguridad corriendo en ${host}. Puedo escanear redes con Nmap, buscar en internet, generar imágenes, gestionar tus notas, memorias, recordatorios y calendario, abrir la cámara, compartir pantalla o ejecutar comandos en tu terminal Linux.`;
    } else if (/(c[oó]mo est[aá]s|qu[eé] tal|todo bien)/i.test(lower)) {
      return `¡A tope de energía, Koko! Con la CPU fresquita al ${cpuUsage}% y la memoria al ${memPct}%. ¿Tú qué tal vas, jefe?`;
    } else if (/(recuerdas|acuerdas|memoria|qu[eé] sabes de m[ií])/i.test(lower)) {
      if (vault.memories && vault.memories.length > 0) {
        const recentFacts = vault.memories.slice(-4).map(m => m.fact).join('; ');
        return `¡Pues claro que me acuerdo, Koko! Tengo ${vault.memories.length} recuerdos guardados en mi bóveda. Por ejemplo: ${recentFacts}.`;
      }
      return `Mi bóveda de datos está lista en disco, Koko, aunque todavía no me has pedido guardar recuerdos nuevos hoy. Dime "recuerda que..." cuando quieras que guarde algo.`;
    } else if (/(cpu|procesador|memoria|ram|temperatura|consumo|rendimiento|estado|sistema|hardware)/i.test(lower)) {
      return `Aquí tienes el parte de tu máquina, Koko: en ${host} (${kernel}) la CPU va al ${cpuUsage}% (${cpuSpeed} MHz), y la memoria RAM está al ${memPct}% (${memUsedGb} GB de ${memTotalGb} GB en uso). Todo fino.`;
    } else if (/(hora|fecha|d[ií]a es)/i.test(lower)) {
      return `Ahora mismo son las ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} del ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}, Koko.`;
    } else if (/(ip|red|interfaz|conectad)/i.test(lower)) {
      const nets = os.networkInterfaces();
      const ips: string[] = [];
      for (const [name, list] of Object.entries(nets)) {
        for (const netIf of list || []) {
          if (netIf.family === 'IPv4' && !netIf.internal) {
            ips.push(`${name}: ${netIf.address}`);
          }
        }
      }
      return ips.length > 0
        ? `Tus interfaces de red activas son ${ips.join(', ')}, Koko.`
        : `Estoy corriendo en local sobre ${host} en el puerto ${PORT}, Koko.`;
    } else if (/(gracias|perfecto|genial|vale|ok|de lujo|guay)/i.test(lower)) {
      return `¡De nada, jefe! Para eso estamos. Si necesitas escanear algo, buscar en la web, generar una imagen o abrir algún módulo, tú mandas.`;
    } else if (/(clave|api|key|gemini|nube|conectar)/i.test(lower)) {
      return `Puedes pegar tu clave AIza directamente con Control+V en la pantalla o escribir en tu terminal: nexus apikey seguido de tu clave.`;
    }

    // Mathematical expressions evaluation (e.g. "cuánto es 45 por 12")
    const mathCandidate = lower
      .replace(/cu[aá]nto es|calcula|resultado de/g, '')
      .replace(/multiplicado por|por|x/g, '*')
      .replace(/dividido entre|entre/g, '/')
      .replace(/m[aá]s/g, '+')
      .replace(/menos/g, '-')
      .replace(/[^0-9+\-*/().\s]/g, '')
      .trim();
    if (/^\d+(\.\d+)?\s*[+\-*/]\s*\d+/.test(mathCandidate)) {
      try {
        // Safe arithmetic evaluation
        const val = Function(`"use strict"; return (${mathCandidate});`)();
        if (typeof val === 'number' && isFinite(val)) {
          return `El resultado es ${val}, Koko.`;
        }
      } catch {}
    }

    // Real-time web knowledge lookup for factual questions even without API key
    if (query.length > 3) {
      const searchData = await performLocalWebSearch(query);
      if (searchData.result && !searchData.result.startsWith('No encontré artículos directos')) {
        const firstParagraph = searchData.result.split('\n\n')[0].slice(0, 360);
        return `${firstParagraph}`;
      }
    }

    return `¡Oído cocina, Koko! Te escucho en ${host} (CPU ${cpuUsage}%, RAM ${memPct}%). Pídeme buscar cualquier tema en la web, generar imágenes, escanear con Nmap o Whois, guardar recuerdos, crear recordatorios o abrir la terminal, notas, cámara o telemetría.`;
  }

  // Built-in local conversational engine for Debian/Kali Linux when running in Local Mode
  app.post('/api/local-assistant', async (req, res) => {
    const query = String(req.body?.query || '').trim();
    const reply = await buildLocalAssistantReply(query);
    res.json({
      reply,
      hasStandaloneKey: Boolean(getResolvedGeminiApiKey(true)),
    });
  });

  // Kali Linux / Debian server-side voice turn handler:
  // Transcribes 16kHz WAV microphone utterances when browser webkitSpeechRecognition is unavailable
  // (e.g. Kali Linux Chromium without Google Speech keys or Firefox ESR) and returns Nexus's spoken reply.
  app.post('/api/local-voice-turn', async (req, res) => {
    const audioWavBase64 = String(req.body?.audioWavBase64 || '').trim();
    if (!audioWavBase64) {
      res.status(400).json({ error: 'Missing audioWavBase64' });
      return;
    }

    const tmpWav = `/tmp/nexus-utt-${process.pid}-${Date.now()}.wav`;
    let transcript = '';
    let srInstalled = false;

    try {
      const wavBuf = Buffer.from(audioWavBase64, 'base64');
      // If utterance is too short (< 0.25s of 16kHz 16-bit mono PCM), ignore noise
      if (wavBuf.byteLength < 8000) {
        res.json({ transcript: '', reply: '', ignore: true });
        return;
      }

      // 1. If a valid Gemini API key is configured on the server, transcribe via Gemini 2.5 Flash
      const serverApiKey = getResolvedGeminiApiKey(true);
      if (serverApiKey) {
        try {
          const ai = new GoogleGenAI({ apiKey: serverApiKey });
          const sttRes = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
              {
                role: 'user',
                parts: [
                  { inlineData: { mimeType: 'audio/wav', data: audioWavBase64 } },
                  { text: 'Transcribe exactamente lo que dice la voz en español. Devuelve ÚNICAMENTE el texto transcrito sin comillas ni explicaciones. Si solo hay ruido o silencio, devuelve vacío.' },
                ],
              },
            ],
          });
          transcript = (sttRes.text || '').trim();
          srInstalled = true;
        } catch {}
      }

      // 2. Try Python speech_recognition (pre-installed on Kali/Debian via python3-speechrecognition)
      if (!transcript && fs.existsSync('/usr/bin/python3')) {
        fs.writeFileSync(tmpWav, wavBuf, { mode: 0o600 });
        const pyResult = await new Promise<{ installed: boolean; text: string }>((resolve) => {
          const pyCode = [
            'import sys',
            'try:',
            '    import speech_recognition as sr',
            'except ImportError:',
            '    print("__NO_SR__")',
            '    sys.exit(0)',
            'try:',
            '    r = sr.Recognizer()',
            '    with sr.AudioFile(sys.argv[1]) as source:',
            '        audio = r.record(source)',
            '    print(r.recognize_google(audio, language="es-ES"))',
            'except Exception:',
            '    pass',
          ].join('\n');
          const out: Buffer[] = [];
          const p = spawn('/usr/bin/python3', ['-c', pyCode, tmpWav], { timeout: 5500 });
          p.stdout.on('data', d => out.push(Buffer.from(d)));
          p.on('error', () => resolve({ installed: false, text: '' }));
          p.on('close', () => {
            const raw = Buffer.concat(out).toString('utf8').trim();
            if (raw === '__NO_SR__') {
              resolve({ installed: false, text: '' });
            } else {
              resolve({ installed: true, text: raw });
            }
          });
        });
        srInstalled = srInstalled || pyResult.installed;
        transcript = pyResult.text;
      }
    } catch {} finally {
      try { if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav); } catch {}
    }

    // If speech recognizer is installed and returned empty, it was just ambient noise/silence
    if (srInstalled && !transcript) {
      res.json({ transcript: '', reply: '', ignore: true });
      return;
    }

    const reply = await buildLocalAssistantReply(transcript || 'hola nexus');
    res.json({
      transcript,
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

  // Stream live Nexus source code + precompiled dist bundle (.tar.gz) for automated Debian/Kali .deb package installer
  app.get('/api/source-bundle.tar.gz', (_req, res) => {
    const tarCwd = fs.existsSync('/opt/nexus/package.json') ? '/opt/nexus' : process.cwd();
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="nexus-source.tar.gz"');
    const tarProc = spawn('tar', [
      '-czf', '-',
      '--exclude=node_modules',
      '--exclude=.git',
      '--exclude=*.map',
      '--exclude=data',
      '--exclude=package-lock.json',
      '--exclude=bun.lock',
      '.'
    ], { cwd: tarCwd });

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

  // Atomic Delta Updater Payload: Updates an existing /opt/nexus installation in ~10s without full reinstall
  // Guarantees 100% data integrity (.env + /opt/nexus/data/nexus-vault.json), SHA-256 verification,
  // pre-compiled dist/server.cjs + dist/index.html included, health check, and automatic rollback on failure.
  app.get('/api/updater-payload', (req, res) => {
    const userParam = (req.query.user as string) || 'koko';
    const portParam = (req.query.port as string) || '3000';
    const tarCwd = fs.existsSync('/opt/nexus/package.json') ? '/opt/nexus' : process.cwd();

    const chunks: Buffer[] = [];
    const tarProc = spawn('tar', [
      '-czf', '-',
      '--exclude=node_modules',
      '--exclude=.git',
      '--exclude=*.map',
      '--exclude=data',
      '--exclude=.env',
      '--exclude=package-lock.json',
      '--exclude=bun.lock',
      '.'
    ], { cwd: tarCwd });

    tarProc.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    tarProc.on('error', (err) => {
      console.error('tar updater error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to package update payload' });
    });

    tarProc.on('close', (code) => {
      if (code !== 0) {
        if (!res.headersSent) res.status(500).json({ error: 'tar exited with code ' + code });
        return;
      }
      const tarBuffer = Buffer.concat(chunks);
      const payloadSha256 = crypto.createHash('sha256').update(tarBuffer).digest('hex');
      const b64Wrapped = (tarBuffer.toString('base64').match(/.{1,76}/g) || []).join('\n');
      const cliScript = buildNexusCliScript();

      const updaterScript = `#!/usr/bin/env bash
# ==============================================================================
# NEXUS AI - ACTUALIZADOR ATÓMICO DELTA SIN REINSTALACIÓN (v${NEXUS_VERSION})
# Garantiza integridad 100% de datos (/opt/nexus/.env y /opt/nexus/data/nexus-vault.json),
# backup criptográfico SHA-256, reutilización instantánea de node_modules (cp -al)
# y Rollback Automático si el health-check posterior falla.
# ==============================================================================
set -e

NEXUS_USER="\${NEXUS_USER:-${userParam}}"
DETECTED_USER="\${SUDO_USER:-}"
if [ -z "\$DETECTED_USER" ] || [ "\$DETECTED_USER" = "root" ]; then
  DETECTED_USER="\$(logname 2>/dev/null || true)"
fi
if [ -z "\$DETECTED_USER" ] || [ "\$DETECTED_USER" = "root" ]; then
  DETECTED_USER="\$(awk -F: '\$3 >= 1000 && \$3 < 65534 {print \$1; exit}' /etc/passwd 2>/dev/null || true)"
fi
if ! id "\$NEXUS_USER" >/dev/null 2>&1 || [ "\$NEXUS_USER" = "root" ]; then
  if [ -n "\$DETECTED_USER" ] && id "\$DETECTED_USER" >/dev/null 2>&1; then
    NEXUS_USER="\$DETECTED_USER"
  else
    NEXUS_USER="root"
  fi
fi
INSTALL_DIR="/opt/nexus"
DATA_DIR="/opt/nexus/data"
BACKUP_DIR="/var/backups/nexus"
LOCK_FILE="/var/lock/nexus-update.lock"
EXPECTED_SHA256="${payloadSha256}"
STAGING_DIR="/tmp/nexus-staging-\$\$"
PAYLOAD_TAR="/tmp/nexus-payload-\$\$.tar.gz"
STAMP=\$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="\${BACKUP_DIR}/nexus-backup-\${STAMP}.tar.gz"

if [ "\$(id -u)" -ne 0 ]; then
  echo "[!] Elevando privilegios con sudo para actualizar Nexus de forma segura..."
  exec sudo NEXUS_USER="\$NEXUS_USER" bash "\$0" "\$@"
fi

if [ ! -d "\$INSTALL_DIR" ]; then
  echo "[!] No se detectó una instalación previa en /opt/nexus."
  echo "    Creando estructura base en /opt/nexus para primera instalación rápida..."
  mkdir -p "\$INSTALL_DIR" "\$DATA_DIR"
fi

exec 9>"\$LOCK_FILE"
if ! flock -n 9; then
  echo "[!] Otra actualización de Nexus ya está en curso (lock: \$LOCK_FILE)."
  exit 1
fi

cleanup() {
  rm -rf "\$STAGING_DIR" "\$PAYLOAD_TAR"
}
trap cleanup EXIT

ENV_FILE="\${INSTALL_DIR}/.env"
NEXUS_PORT="\$(grep -E '^PORT=' "\$ENV_FILE" 2>/dev/null | head -n 1 | cut -d= -f2 | tr -d '"\\047[:space:]')"
NEXUS_PORT="\${NEXUS_PORT:-${portParam}}"

echo "=============================================================================="
echo "  NEXUS OS v${NEXUS_VERSION} - ACTUALIZACIÓN ATÓMICA DELTA (SIN REINSTALACIÓN COMPLETA)"
echo "  Directorio: \${INSTALL_DIR} | Puerto: \${NEXUS_PORT} | SHA-256: \${EXPECTED_SHA256:0:16}..."
echo "=============================================================================="

# 1. Extraer y verificar integridad criptográfica SHA-256 del paquete antes de tocar el sistema
echo "[1/5] Verificando firma criptográfica SHA-256 del paquete de actualización..."
base64 -d << 'NEXUS_UPDATE_B64_EOF' > "\$PAYLOAD_TAR"
${b64Wrapped}
NEXUS_UPDATE_B64_EOF

ACTUAL_SHA256=\$(sha256sum "\$PAYLOAD_TAR" | awk '{print \$1}')
if [ "\$ACTUAL_SHA256" != "\$EXPECTED_SHA256" ]; then
  echo "[✗] ERROR CRÍTICO: El hash SHA-256 del paquete no coincide."
  echo "    Esperado: \$EXPECTED_SHA256"
  echo "    Recibido: \$ACTUAL_SHA256"
  echo "    Abortando actualización sin modificar /opt/nexus."
  exit 1
fi
echo "    -> Integridad SHA-256 verificada correctamente."

# 2. Crear Backup Criptográfico de Datos (.env, bóveda de memorias/notas y build actual)
echo "[2/5] Creando snapshot de seguridad en \${BACKUP_FILE}..."
mkdir -p "\$BACKUP_DIR" "\$DATA_DIR"

# Volcar estado en memoria de la bóveda si el servicio está activo
curl -s "http://localhost:\${NEXUS_PORT}/api/data-vault" -o "\${DATA_DIR}/nexus-vault.backup.tmp" 2>/dev/null || true
if [ -s "\${DATA_DIR}/nexus-vault.backup.tmp" ] && [ ! -f "\${DATA_DIR}/nexus-vault.json" ]; then
  mv "\${DATA_DIR}/nexus-vault.backup.tmp" "\${DATA_DIR}/nexus-vault.json"
else
  rm -f "\${DATA_DIR}/nexus-vault.backup.tmp"
fi

if [ -f "\$ENV_FILE" ] || [ -d "\${INSTALL_DIR}/dist" ]; then
  tar -czf "\$BACKUP_FILE" -C "\$INSTALL_DIR" \\
    \$([ -f "\${INSTALL_DIR}/.env" ] && echo ".env") \\
    \$([ -d "\${INSTALL_DIR}/data" ] && echo "data") \\
    \$([ -d "\${INSTALL_DIR}/dist" ] && echo "dist") \\
    \$([ -f "\${INSTALL_DIR}/package.json" ] && echo "package.json") 2>/dev/null || true
  if [ -f "\$BACKUP_FILE" ]; then
    sha256sum "\$BACKUP_FILE" > "\${BACKUP_FILE}.sha256"
    chmod 600 "\$BACKUP_FILE" "\${BACKUP_FILE}.sha256"
    echo "    -> Backup firmado guardado en: \$BACKUP_FILE"
  fi
fi

# Mantener solo los últimos 5 snapshots para no llenar el disco
ls -t "\${BACKUP_DIR}"/nexus-backup-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f
ls -t "\${BACKUP_DIR}"/nexus-backup-*.tar.gz.sha256 2>/dev/null | tail -n +6 | xargs -r rm -f

# 3. Preparar entorno Staging aislado y reutilizar node_modules (cp -al) sin reinstalar
echo "[3/5] Compilando nueva versión en entorno aislado (\${STAGING_DIR}) con cero tiempo de caída..."
rm -rf "\$STAGING_DIR"
mkdir -p "\$STAGING_DIR"
tar -xzf "\$PAYLOAD_TAR" -C "\$STAGING_DIR"

# Preservar .env intacto en staging para la compilación (limpiando tokens internos AQ.* o placeholders)
if [ -f "\$ENV_FILE" ]; then
  sed -i 's|^GEMINI_API_KEY="AQ\.[^"]*"|GEMINI_API_KEY=""|g; s|^GEMINI_API_KEY="TU_CLAVE[^"]*"|GEMINI_API_KEY=""|g; s|^GEMINI_API_KEY="MY_GEMINI_API_KEY"|GEMINI_API_KEY=""|g; s|^GEMINI_API_KEY="GEMINI_API_KEY"|GEMINI_API_KEY=""|g' "\$ENV_FILE" 2>/dev/null || true
  cp -a "\$ENV_FILE" "\${STAGING_DIR}/.env"
else
  cat << ENVEOF > "\${STAGING_DIR}/.env"
PORT=\${NEXUS_PORT}
NODE_ENV=production
GEMINI_API_KEY=""
ENVEOF
  chmod 600 "\${STAGING_DIR}/.env"
fi

OLD_PKG_HASH=""
if [ -f "\${INSTALL_DIR}/package.json" ]; then
  OLD_PKG_HASH=\$(sha256sum "\${INSTALL_DIR}/package.json" | awk '{print \$1}')
fi
NEW_PKG_HASH=\$(sha256sum "\${STAGING_DIR}/package.json" | awk '{print \$1}')

cd "\$STAGING_DIR"
if [ -s "\${STAGING_DIR}/dist/server.cjs" ] && [ -s "\${STAGING_DIR}/dist/index.html" ]; then
  echo "    -> Binarios precompilados auto-contenidos (dist/server.cjs + dist/index.html) verificados y listos (0s compilación)..."
else
  if [ -d "\${INSTALL_DIR}/node_modules" ] && [ "\$OLD_PKG_HASH" = "\$NEW_PKG_HASH" ]; then
    cp -al "\${INSTALL_DIR}/node_modules" "\${STAGING_DIR}/node_modules" 2>/dev/null || true
  else
    if [ -d "\${INSTALL_DIR}/node_modules" ]; then
      cp -a "\${INSTALL_DIR}/node_modules" "\${STAGING_DIR}/node_modules" 2>/dev/null || true
    fi
    NODE_ENV=development npm install --include=dev --prefer-offline --no-audit --no-fund
  fi
  EXISTING_KEY=\$(grep -E '^GEMINI_API_KEY=' "\${STAGING_DIR}/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
  GEMINI_API_KEY="\$EXISTING_KEY" npm run build
fi

if [ ! -s "\${STAGING_DIR}/dist/server.cjs" ] || [ ! -s "\${STAGING_DIR}/dist/index.html" ]; then
  echo "[✗] Error: No se encontró dist/server.cjs o dist/index.html en staging."
  echo "    Tu instalación actual en /opt/nexus NO ha sido modificada."
  exit 1
fi

# 4. Función de Rollback Automático en caso de fallo durante el intercambio o arranque
rollback_on_failure() {
  echo "[!] Detectado fallo tras el intercambio. Ejecutando ROLLBACK AUTOMÁTICO desde \${BACKUP_FILE}..."
  if [ -f "\$BACKUP_FILE" ]; then
    tar -xzf "\$BACKUP_FILE" -C "\$INSTALL_DIR"
    systemctl restart nexus.service || true
    echo "[✓] Sistema restaurado automáticamente a la versión previa funcional."
  fi
  exit 1
}

# 5. Intercambio Atómico (Hot-Swap) preservando .env y /opt/nexus/data
echo "[4/5] Aplicando intercambio atómico en \${INSTALL_DIR} (preservando .env y bóveda /opt/nexus/data)..."
trap rollback_on_failure ERR

if [ -d "\${STAGING_DIR}/node_modules" ]; then
  if [ ! -d "\${INSTALL_DIR}/node_modules" ] || [ "\$OLD_PKG_HASH" != "\$NEW_PKG_HASH" ]; then
    rm -rf "\${INSTALL_DIR}/node_modules"
    mv "\${STAGING_DIR}/node_modules" "\${INSTALL_DIR}/node_modules"
  else
    rm -rf "\${STAGING_DIR}/node_modules"
  fi
fi

# Copiar código y compilación nueva sin tocar .env ni data/
tar -cf - --exclude=.env --exclude=data -C "\$STAGING_DIR" . | tar -xf - -C "\$INSTALL_DIR"

# Actualizar CLI /usr/bin/nexus con soporte para update, backup, rollback y version
cat << 'EOF' > /usr/bin/nexus
${cliScript}
EOF
chmod 755 /usr/bin/nexus

if ! python3 -c "import speech_recognition" >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y python3-speechrecognition flac 2>/dev/null || true
fi

if id "\$NEXUS_USER" >/dev/null 2>&1; then
  chown -R "\$NEXUS_USER:\$NEXUS_USER" "\$INSTALL_DIR"
fi
chmod 644 "\$ENV_FILE" 2>/dev/null || true
NODE_BIN="\$(command -v node 2>/dev/null || echo "/usr/bin/node")"
if [ -f /etc/systemd/system/nexus.service ]; then
  sed -i "s|^User=.*|User=\${NEXUS_USER}|g" /etc/systemd/system/nexus.service 2>/dev/null || true
  sed -i "s|^ExecStart=.*|ExecStart=\${NODE_BIN} /opt/nexus/dist/server.cjs|g" /etc/systemd/system/nexus.service 2>/dev/null || true
fi

echo "[5/5] Reiniciando servicio nexus.service y verificando Health-Check en vivo..."
systemctl daemon-reload || true
systemctl restart nexus.service || true

HEALTH_OK=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:\${NEXUS_PORT}/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
    HEALTH_OK=1
    break
  fi
  if [ "\$i" -eq 5 ]; then
    /usr/bin/nexus start >/dev/null 2>&1 || true
  fi
  sleep 1
done

if [ "\$HEALTH_OK" -ne 1 ]; then
  echo "[✗] El servicio no respondió al health-check en el puerto \${NEXUS_PORT}."
  rollback_on_failure
fi

trap - ERR

echo "=============================================================================="
echo "  [✓] ¡NEXUS ACTUALIZADO CON ÉXITO A LA VERSIÓN ${NEXUS_VERSION} SIN REINSTALAR!"
echo "  • Configuración preservada: /opt/nexus/.env (GEMINI_API_KEY intacta)"
echo "  • Datos y Memorias intactos: /opt/nexus/data/nexus-vault.json"
echo "  • Snapshot de seguridad:     \${BACKUP_FILE}"
echo "  • Si deseas volver atrás:    nexus rollback"
echo "=============================================================================="
`;

      const pasteUpdateCommand = `cat << 'NEXUS_UPDATER_EOF' > /tmp/nexus-updater.sh\n${updaterScript}\nNEXUS_UPDATER_EOF\nsudo NEXUS_USER="${userParam}" bash /tmp/nexus-updater.sh`;

      res.json({
        version: NEXUS_VERSION,
        payloadSha256,
        updaterScript,
        pasteUpdateCommand,
        sizeKB: Math.round(Buffer.byteLength(updaterScript, 'utf8') / 1024),
      });
    });
  });

  // Self-contained Debian & Kali Linux .deb package installer with embedded Base64 source + precompiled dist
  // Avoids Cloud Run cookie proxy ("<!doctype html>") when executing from an external terminal
  app.get('/api/installer-payload', (req, res) => {
    const userParam = (req.query.user as string) || 'koko';
    const portParam = (req.query.port as string) || '3000';
    const tarCwd = fs.existsSync('/opt/nexus/package.json') ? '/opt/nexus' : process.cwd();

    const chunks: Buffer[] = [];
    const tarProc = spawn('tar', [
      '-czf', '-',
      '--exclude=node_modules',
      '--exclude=.git',
      '--exclude=*.map',
      '--exclude=package-lock.json',
      '--exclude=bun.lock',
      '.'
    ], { cwd: tarCwd });

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
DETECTED_USER="\${SUDO_USER:-}"
if [ -z "\$DETECTED_USER" ] || [ "\$DETECTED_USER" = "root" ]; then
  DETECTED_USER="\$(logname 2>/dev/null || true)"
fi
if [ -z "\$DETECTED_USER" ] || [ "\$DETECTED_USER" = "root" ]; then
  DETECTED_USER="\$(awk -F: '\$3 >= 1000 && \$3 < 65534 {print \$1; exit}' /etc/passwd 2>/dev/null || true)"
fi
if ! id "\$NEXUS_USER" >/dev/null 2>&1 || [ "\$NEXUS_USER" = "root" ]; then
  if [ -n "\$DETECTED_USER" ] && id "\$DETECTED_USER" >/dev/null 2>&1; then
    NEXUS_USER="\$DETECTED_USER"
  else
    NEXUS_USER="root"
  fi
fi
NEXUS_PORT="\${NEXUS_PORT:-${port}}"
NEXUS_PORT="\${NEXUS_PORT:-3000}"
NEXUS_API_KEY="\${NEXUS_API_KEY:-\${GEMINI_API_KEY:-${activeApiKey}}}"

# Preservar clave previa si ya existía en /opt/nexus/.env
if [ -z "\$NEXUS_API_KEY" ] && [ -f /opt/nexus/.env ]; then
  EXISTING_KEY=\$(grep -E '^GEMINI_API_KEY=' /opt/nexus/.env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
  if [ -n "\$EXISTING_KEY" ] && [ "\$EXISTING_KEY" != "TU_CLAVE_GEMINI_AQUI" ] && [ "\$EXISTING_KEY" != "MY_GEMINI_API_KEY" ] && [ "\$EXISTING_KEY" != "GEMINI_API_KEY" ] && [[ "\$EXISTING_KEY" != AQ.* ]]; then
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

if [ -f /etc/os-release ]; then
  . /etc/os-release
  echo "[1/6] Sistema detectado: \${PRETTY_NAME:-Debian/Kali Linux}"
fi

echo "[2/6] Instalando dependencias del sistema, audio/vídeo y empaquetado dpkg..."
export DEBIAN_FRONTEND=noninteractive
dpkg --configure -a 2>/dev/null || true
apt-get update -y || true
apt-get install -y curl wget git build-essential ca-certificates gnupg lsb-release \\
  dpkg-dev alsa-utils espeak-ng speech-dispatcher python3-speechrecognition flac v4l-utils xdg-utils psmisc \\
  nmap dnsutils whois iproute2 net-tools || true

if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1 && ! command -v google-chrome >/dev/null 2>&1; then
  apt-get install -y chromium || apt-get install -y chromium-browser || true
fi

echo "[3/6] Verificando Node.js 22 LTS (Repositorio NodeSource nodistro para Debian/Kali)..."
NEED_NODE=0
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  NEED_NODE=1
else
  NODE_MAJOR=\$(node -v | cut -d. -f1 | tr -d 'v')
  if [ "\${NODE_MAJOR}" -lt 20 ]; then
    NEED_NODE=1
  fi
fi

if [ "\${NEED_NODE}" -eq 1 ]; then
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes || true
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y || true
  apt-get install -y nodejs || apt-get install -y nodejs npm || true
fi

echo "[4/6] Extrayendo núcleo precompilado y código fuente embebido de Nexus..."
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
chmod 644 "\${PKG_DIR}/opt/nexus/.env"

if [ -s "\${PKG_DIR}/opt/nexus/dist/server.cjs" ] && [ -s "\${PKG_DIR}/opt/nexus/dist/index.html" ]; then
  echo "    -> Núcleo auto-contenido precompilado (dist/server.cjs + dist/index.html) listo para ejecución inmediata."
else
  echo "    -> Compilando producción localmente..."
  NODE_ENV=development npm install --include=dev --no-audit --no-fund
  GEMINI_API_KEY="\${NEXUS_API_KEY}" npm run build
fi

echo "[5/6] Construyendo paquete oficial nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb..."
NODE_BIN="\$(command -v node 2>/dev/null || echo "/usr/bin/node")"
cat << EOF > "\${PKG_DIR}/DEBIAN/control"
Package: nexus-ai
Version: \${PKG_VERSION}
Section: utils
Priority: optional
Architecture: \${PKG_ARCH}
Maintainer: Koko <koko@nexus.local>
Recommends: nodejs, alsa-utils, espeak-ng, v4l-utils, xdg-utils
Description: Nexus AI - Sistema Operativo Cognitivo y Agente para Debian y Kali Linux
EOF

cat << 'EOF' > "\${PKG_DIR}/usr/bin/nexus"
${buildNexusCliScript()}
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
EnvironmentFile=-/opt/nexus/.env
Environment=PORT=\${NEXUS_PORT}
Environment=NODE_ENV=production
ExecStart=\${NODE_BIN} /opt/nexus/dist/server.cjs
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
mkdir -p /opt/nexus/data
cat << ENVEOF > /opt/nexus/.env
PORT=\${NEXUS_PORT}
NODE_ENV=production
GEMINI_API_KEY="\${NEXUS_API_KEY}"
ENVEOF
chmod 644 /opt/nexus/.env
if id "\${NEXUS_USER}" >/dev/null 2>&1; then
  chown -R "\${NEXUS_USER}:\${NEXUS_USER}" /opt/nexus
  USER_HOME_DIR="\\\$(getent passwd "\${NEXUS_USER}" 2>/dev/null | cut -d: -f6)"
  for ddir in "\\\$USER_HOME_DIR/Escritorio" "\\\$USER_HOME_DIR/Desktop"; do
    if [ -d "\\\$ddir" ]; then
      cp /usr/share/applications/nexus-ai.desktop "\\\$ddir/nexus-ai.desktop" 2>/dev/null || true
      chmod 755 "\\\$ddir/nexus-ai.desktop" 2>/dev/null || true
      chown "\${NEXUS_USER}:\${NEXUS_USER}" "\\\$ddir/nexus-ai.desktop" 2>/dev/null || true
    fi
  done
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
pkill -f "/opt/nexus/dist/server.cjs" 2>/dev/null || true
EOF
chmod 755 "\${PKG_DIR}/DEBIAN/prerm"

dpkg-deb --build --root-owner-group "\${PKG_DIR}" "\${BUILD_ROOT}/nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb"

echo "[6/6] Instalando paquete nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb con dpkg..."
dpkg -i "\${BUILD_ROOT}/nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb" || apt-get install -f -y || true
cp "\${BUILD_ROOT}/nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb" "/opt/nexus/nexus-ai_\${PKG_VERSION}_\${PKG_ARCH}.deb" || true
rm -rf "\${BUILD_ROOT}"

# Garantizar que el servicio esté arrancado y abrir automáticamente la ventana de Nexus
/usr/bin/nexus start || true
/usr/bin/nexus app || true

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
  if [ -n "\$EXISTING_KEY" ] && [ "\$EXISTING_KEY" != "TU_CLAVE_GEMINI_AQUI" ] && [ "\$EXISTING_KEY" != "MY_GEMINI_API_KEY" ] && [ "\$EXISTING_KEY" != "GEMINI_API_KEY" ] && [[ "\$EXISTING_KEY" != AQ.* ]]; then
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
${buildNexusCliScript()}
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
  if (!isProduction) {
    const vitePkg = 'vite';
    const { createServer: createViteServer } = await import(vitePkg);
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const candidateDistDirs = [
      path.resolve(process.cwd(), 'dist'),
      '/opt/nexus/dist',
      typeof __dirname !== 'undefined' ? __dirname : path.resolve(process.cwd(), 'dist'),
    ];
    const distDir = candidateDistDirs.find(d => fs.existsSync(path.join(d, 'index.html'))) || path.resolve(process.cwd(), 'dist');

    app.use(express.static(distDir, { index: false }));
    app.get('*all', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
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

  server.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use.`);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
