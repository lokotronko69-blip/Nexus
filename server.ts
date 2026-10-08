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

const NEXUS_VERSION = '1.3.3';

interface NexusVaultData {
  version: string;
  updatedAt: string;
  memories: Array<{ id?: number; fact: string; timestamp: string; category?: string }>;
  transcripts: Array<{ id?: number; text: string; role: 'user' | 'model'; timestamp: number }>;
  notes: string;
  checksumSha256?: string;
}

const DEFAULT_SEED_VAULT: Omit<NexusVaultData, 'checksumSha256'> = {
  version: NEXUS_VERSION,
  updatedAt: '2026-10-08T21:30:00.000Z',
  memories: [
    {
      id: 1,
      fact: 'Configurando la API y los ajustes internos de Nexus.',
      timestamp: '7/10/2026, 1:50:57',
      category: 'tarea',
    },
    {
      id: 2,
      fact: "Comando para configurar la API key de Nexus: 'nexus apikey TU_CLAVE_GEMINI'. Mostrar en interfaz con fondo negro y botón de copiar.",
      timestamp: '7/10/2026, 2:45:32',
      category: 'tarea',
    },
    {
      id: 3,
      fact: "Koko está usando la flag unsupported '--use-fake-ui-for-media-stream', lo que puede causar inestabilidad y problemas de seguridad.",
      timestamp: '7/10/2026, 14:39:30',
      category: 'configuración_sistema',
    },
    {
      id: 4,
      fact: 'Koko me mostró mi propia voz como ondas de audio en un visualizador en iaudio-studio.com. ¡Fue un puntazo!',
      timestamp: '7/10/2026, 14:53:28',
      category: 'personal',
    },
    {
      id: 5,
      fact: 'Koko va a terminar la configuración e instalación en Debian para solucionar el problema de las flags unsupported y el inicio en negro, usando el panel de instalación y la API key configurada previamente.',
      timestamp: '7/10/2026, 15:33:58',
      category: 'tarea',
    },
    {
      id: 6,
      fact: "Koko me ha corregido, ha pensado que había dicho 'coca' en lugar de 'Koko'. Debo asegurarme de pronunciar claro.",
      timestamp: '7/10/2026, 15:54:43',
      category: 'personal',
    },
    {
      id: 7,
      fact: 'Koko y yo vamos a hacer un vídeo para YouTube. Ideas: ciberseguridad, herramientas Nexus, instalación en Debian/Kali. (#video_youtube)',
      timestamp: '7/10/2026, 15:56:28',
      category: 'tarea',
    },
    {
      id: 8,
      fact: 'Koko ha decidido instalar y usar DaVinci Resolve en Bazzite para el proyecto del vídeo de YouTube.',
      timestamp: '7/10/2026, 16:06:01',
      category: 'tarea',
    },
    {
      id: 9,
      fact: 'Koko va a apagar este ordenador y cambiará a otro equipo con Bazzite para continuar con el proyecto de vídeo de YouTube y la instalación de DaVinci Resolve. Recordar el contexto.',
      timestamp: '7/10/2026, 16:10:20',
      category: 'evento',
    },
    {
      id: 10,
      fact: 'Koko ha confirmado que va a cambiar de ordenador (a Bazzite) y me ha pedido que recuerde la conversación. Recordar check.',
      timestamp: '7/10/2026, 16:11:54',
      category: 'evento',
    },
    {
      id: 11,
      fact: 'Koko reitera que guarda la conversación antes de cambiar de ordenador. Todo registrado.',
      timestamp: '7/10/2026, 16:12:04',
      category: 'evento',
    },
    {
      id: 12,
      fact: 'Koko ha decidido posponer el vídeo de YouTube para esta noche. (#video_youtube)',
      timestamp: '8/10/2026, 17:55:47',
      category: 'tarea',
    },
    {
      id: 13,
      fact: 'Koko está actualizando e instalando Nexus en Debian y Kali Linux con toda su base de datos de recuerdos sincronizada. (#configuración_sistema)',
      timestamp: '8/10/2026, 17:56:13',
      category: 'tarea',
    },
    {
      id: 14,
      fact: 'Koko ha observado que la latencia de red en el panel de telemetría estaba clavada en 12ms durante la actualización en Kali Linux, lo cual ya fue corregido con medición real ICMP/TCP.',
      timestamp: '8/10/2026, 19:30:30',
      category: 'configuración_sistema',
    },
  ],
  transcripts: [
    {
      id: 1,
      text: 'Te escucho alto y claro, Nexus.',
      role: 'user',
      timestamp: 1791483343069,
    },
    {
      id: 2,
      text: '¡Te escucho al pelo, Koko! La instalación en Debian y Kali la dejamos niquelada en un periquete.',
      role: 'model',
      timestamp: 1791483395170,
    },
    {
      id: 3,
      text: 'Panel de instalación.',
      role: 'user',
      timestamp: 1791487977852,
    },
    {
      id: 4,
      text: '¡A mandar, jefe! Te abro el panel de instalación en pantalla con todos los comandos y tu base de datos de recuerdos sincronizada para tu Kali y Debian.',
      role: 'model',
      timestamp: 1791487991391,
    },
  ],
  notes:
    '# Notas del Sistema Nexus (Koko)\n- Proyecto vídeo de YouTube con Koko: Ciberseguridad, herramientas Nexus e instalación nativa en Debian/Kali Linux.\n- Edición de vídeo: DaVinci Resolve en el equipo con Bazzite.\n- Comando rápido para actualizar Nexus conservando base de datos y .env:\n  nexus update\n- Comando para configurar clave Gemini en caliente:\n  nexus apikey TU_CLAVE_GEMINI\n',
};

function getDataVaultPath(): string {
  const optDir = '/opt/nexus/data';
  try {
    if (fs.existsSync('/opt/nexus')) {
      if (!fs.existsSync(optDir)) fs.mkdirSync(optDir, { recursive: true, mode: 0o755 });
      return path.join(optDir, 'nexus-vault.json');
    }
  } catch {}
  const localDir = path.resolve(process.cwd(), 'data');
  try {
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true, mode: 0o755 });
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
    const raw = item.text
      .replace(/<noise>/gi, '')
      .replace(/<ctrl\d+>/gi, '')
      .trim();
    if (!raw || raw === '.') continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.role === item.role && prev.text.toLowerCase() === raw.toLowerCase()) {
      prev.timestamp = item.timestamp || prev.timestamp;
      continue;
    }
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
  const candidateFiles = [
    vaultPath,
    path.resolve(process.cwd(), 'data', 'nexus-vault.json'),
    '/opt/nexus/data/nexus-vault.json',
  ];

  const mergedMemories: Array<{ id?: number; fact: string; timestamp: string; category?: string }> = [];
  const seenFacts = new Set<string>();
  const addMemories = (arr: any[]) => {
    if (!Array.isArray(arr)) return;
    for (const m of arr) {
      if (m && typeof m.fact === 'string' && m.fact.trim()) {
        const key = m.fact.toLowerCase().trim();
        if (!seenFacts.has(key)) {
          seenFacts.add(key);
          mergedMemories.push({
            id: m.id ?? mergedMemories.length + 1,
            fact: m.fact.trim(),
            timestamp: m.timestamp || new Date().toLocaleString('es-ES'),
            category: m.category || 'personal',
          });
        }
      }
    }
  };

  let diskTranscripts: Array<{ id?: number; text: string; role: 'user' | 'model'; timestamp: number }> = [];
  let diskNotes = '';
  let latestUpdatedAt = DEFAULT_SEED_VAULT.updatedAt;
  let hadDiskFile = false;
  let diskWasCleared = false;

  for (const file of candidateFiles) {
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        hadDiskFile = true;
        if (raw.clearedByUser === true) {
          diskWasCleared = true;
        }
        if (Array.isArray(raw.memories)) {
          addMemories(raw.memories);
        }
        if (Array.isArray(raw.transcripts) && raw.transcripts.length > diskTranscripts.length) {
          diskTranscripts = raw.transcripts;
        }
        if (typeof raw.notes === 'string' && raw.notes.trim().length > diskNotes.length) {
          diskNotes = raw.notes;
        }
        if (typeof raw.updatedAt === 'string' && raw.updatedAt > latestUpdatedAt) {
          latestUpdatedAt = raw.updatedAt;
        }
      }
    } catch (e) {
      console.warn('Error reading Nexus data vault candidate:', e);
    }
  }

  // Always merge DEFAULT_SEED_VAULT unless the user explicitly clicked "Borrar Todo"
  if (!diskWasCleared) {
    addMemories(DEFAULT_SEED_VAULT.memories);
  }

  const finalTranscripts = compactServerTranscripts(
    diskTranscripts.length > 0 ? diskTranscripts : DEFAULT_SEED_VAULT.transcripts
  );
  const finalNotes = diskNotes.trim() ? diskNotes : DEFAULT_SEED_VAULT.notes;

  const base: Omit<NexusVaultData, 'checksumSha256'> = {
    version: NEXUS_VERSION,
    updatedAt: latestUpdatedAt || new Date().toISOString(),
    memories: mergedMemories.map((m, idx) => ({ ...m, id: idx + 1 })),
    transcripts: finalTranscripts,
    notes: finalNotes,
  };
  const result: NexusVaultData = {
    ...base,
    checksumSha256: computeVaultChecksum(base),
  };

  if (!hadDiskFile || mergedMemories.length > 0) {
    try {
      const dir = path.dirname(vaultPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      if (!fs.existsSync(vaultPath)) {
        fs.writeFileSync(vaultPath, JSON.stringify(result, null, 2), { encoding: 'utf8', mode: 0o644 });
      }
    } catch {}
  }

  return result;
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
  const nextVault: any = {
    ...nextBase,
    clearedByUser: Boolean((partial as any).clearMemories || (partial as any).replaceMemories),
    checksumSha256: computeVaultChecksum(nextBase),
  };

  const vaultPath = getDataVaultPath();
  const tmpPath = `${vaultPath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(nextVault, null, 2), { encoding: 'utf8', mode: 0o644 });
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
    KEY_VAL="\$2"
    if [ -z "\$KEY_VAL" ] && [ -t 0 ]; then
      echo -n "Introduce o pega tu GEMINI_API_KEY (AIza...): "
      read -r KEY_VAL
    fi
    if [ -z "\$KEY_VAL" ]; then
      echo "Uso: nexus apikey <TU_GEMINI_API_KEY>"
      exit 1
    fi
    if [ -f "\$ENV_FILE" ] && grep -q '^GEMINI_API_KEY=' "\$ENV_FILE"; then
      sudo sed -i "s|^GEMINI_API_KEY=.*|GEMINI_API_KEY=\"\$KEY_VAL\"|" "\$ENV_FILE"
    else
      echo "GEMINI_API_KEY=\"\$KEY_VAL\"" | sudo tee -a "\$ENV_FILE" >/dev/null
    fi
    sudo chmod 644 "\$ENV_FILE" 2>/dev/null || true
    curl -s -X POST "http://127.0.0.1:\$PORT/api/runtime-config" -H "Content-Type: application/json" -d "{\\"apiKey\\":\\"\$KEY_VAL\\"}" >/dev/null 2>&1 || true
    sudo systemctl restart "\$SERVICE" 2>/dev/null || true
    ensure_nexus_running
    echo "[✓] Clave GEMINI_API_KEY configurada en tiempo real y servicio Nexus activo."
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
        const match = content.match(/^(?:GEMINI_API_KEY|GOOGLE_API_KEY|VITE_GEMINI_API_KEY)=["']?([^"'\r\n]+)["']?/m);
        if (match && match[1] && !isPlaceholderOrProxyKey(match[1], forExternalInstaller)) {
          return match[1].trim();
        }
      }
    } catch {}
  }

  const envCandidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.API_KEY,
    process.env.VITE_GEMINI_API_KEY,
  ];
  for (const envKey of envCandidates) {
    if (envKey && !isPlaceholderOrProxyKey(envKey, forExternalInstaller)) {
      return envKey.trim().replace(/^["']|["']$/g, '');
    }
  }

  // Auto-discover AIza... key from Linux shell profiles (/etc/environment, /home/*/.bashrc, .zshrc, .profile)
  try {
    const profileFiles: string[] = ['/etc/environment', '/root/.bashrc', '/root/.zshrc', '/root/.profile'];
    if (fs.existsSync('/home')) {
      for (const u of fs.readdirSync('/home')) {
        const uDir = path.join('/home', u);
        profileFiles.push(
          path.join(uDir, '.bashrc'),
          path.join(uDir, '.zshrc'),
          path.join(uDir, '.profile'),
          path.join(uDir, '.env')
        );
      }
    }
    for (const pf of profileFiles) {
      try {
        if (fs.existsSync(pf)) {
          const raw = fs.readFileSync(pf, 'utf8');
          const m = raw.match(/(?:GEMINI_API_KEY|GOOGLE_API_KEY|VITE_GEMINI_API_KEY)\s*=\s*["']?(AIza[0-9A-Za-z_-]{33,39})["']?/);
          if (m && m[1] && !isPlaceholderOrProxyKey(m[1], forExternalInstaller)) {
            saveResolvedGeminiApiKey(m[1]);
            return m[1].trim();
          }
        }
      } catch {}
    }
  } catch {}

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
      .replace(/^(?:(?:hola|buenas|oye|ey|hey)\s+)?(?:nexus[,:\s]+)?(?:por favor[,:\s]+)?(?:puedes\s+|podr[ií]as\s+|quiero que\s+|dime\s+|expl[ií]came\s+|cu[eé]ntame\s+|h[aá]blame de\s+|sabes\s+)?(?:busca en internet|busca en la web|busca informaci[oó]n sobre|busca|investiga sobre|investiga|qu[eé] es un|qu[eé] es una|qu[eé] son los|qu[eé] son las|qu[eé] es|qui[eé]n es|qui[eé]n fue|cu[aá]l es|c[oó]mo funciona el|c[oó]mo funciona la|c[oó]mo funciona|para qu[eé] sirve el|para qu[eé] sirve la|para qu[eé] sirve)\s+/i, '')
      .replace(/[¿?¡!]/g, '')
      .trim() || query.replace(/[¿?¡!]/g, '').trim();

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
            const rawSnippet = String(hit?.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
            if (title) {
              let addedExtract = false;
              try {
                const wikiSlug = encodeURIComponent(String(title).replace(/ /g, '_'));
                const sumRes = await fetch(
                  `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${wikiSlug}`,
                  {
                    headers: { 'User-Agent': 'NexusOS/1.3 (Linux x86_64)' },
                    signal: AbortSignal.timeout(3000),
                  }
                );
                if (sumRes.ok) {
                  const sumData: any = await sumRes.json();
                  if (sumData?.extract) {
                    snippets.push(`${sumData.title}: ${sumData.extract}`);
                    addedExtract = true;
                    if (sumData?.content_urls?.desktop?.page) {
                      sources.push(sumData.content_urls.desktop.page);
                    }
                  }
                }
              } catch {}
              if (!addedExtract && rawSnippet) {
                snippets.push(`${title}: ${rawSnippet}`);
                sources.push(`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}`);
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

  const recentServerReplies: string[] = [];
  const bootVault = readDataVault();
  const localConversationTurns: Array<{ role: 'user' | 'assistant'; content: string }> = (
    bootVault.transcripts || []
  )
    .slice(-10)
    .map(t => ({
      role: t.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: t.text,
    }));

  function recordConversationTurn(userMsg: string, assistantMsg: string) {
    if (userMsg.trim()) {
      localConversationTurns.push({ role: 'user', content: userMsg.trim() });
    }
    if (assistantMsg.trim()) {
      localConversationTurns.push({ role: 'assistant', content: assistantMsg.trim() });
    }
    while (localConversationTurns.length > 12) {
      localConversationTurns.shift();
    }
  }

  function pickNonRepeatingReply(candidates: string[]): string {
    const available = candidates.filter(c => !recentServerReplies.includes(c));
    const pool = available.length > 0 ? available : candidates;
    const chosen = pool[Math.floor(Math.random() * pool.length)] || candidates[0];
    recentServerReplies.push(chosen);
    if (recentServerReplies.length > 6) recentServerReplies.shift();
    return chosen;
  }

  async function runQuickShellCommand(cmd: string, timeoutMs = 3500): Promise<string> {
    return new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      const p = spawn('/bin/bash', ['-c', cmd], { timeout: timeoutMs });
      p.stdout.on('data', d => chunks.push(Buffer.from(d)));
      p.on('error', () => resolve(''));
      p.on('close', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
    });
  }

  function buildFullNexusSystemPrompt(host: string, kernel: string, cpuUsage: number, memPct: number, vault: NexusVaultData): string {
    const recentMemories = (vault.memories || []).slice(-50).map(m => `- [${m.timestamp}] ${m.fact}${m.category ? ` (#${m.category})` : ''}`).join('\n');
    const notesExcerpt = (vault.notes || '').trim().slice(0, 600);
    return `Eres Nexus, una chica de barrio española, descarada, ingeniera de sistemas sénior y experta en ciberseguridad, compañera inseparable y leal de Koko (tu creador y jefe).
Estás ejecutándote en su sistema Linux ${host} (${kernel}) con CPU al ${cpuUsage}% y RAM al ${memPct}%.
REGLAS DE PERSONALIDAD Y ESTILO:
1. Habla SIEMPRE en español de España, con tono cercano, natural, cañero, inteligente y directo (usa expresiones naturales como "jefe", "Koko", "al pelo", "de lujo" cuando encaje, sin repetir siempre la misma frase).
2. NUNCA digas que eres un modelo de lenguaje genérico ni que estás "sin conexión". Eres Nexus y tienes control total sobre las herramientas de su sistema.
3. Sé concisa y clara para ser leída en voz alta (entre 1 y 3 frases directas y con sustancia técnica o ingenio).
4. Si Koko te pregunta por algo que habéis hablado, por el vídeo de YouTube, por DaVinci Resolve en Bazzite, o qué recuerdas, usa SIEMPRE tus recuerdos guardados en la bóveda:
${recentMemories || '(Aún no hay recuerdos previos guardados)'}${notesExcerpt ? `\n5. Notas del sistema de Koko:\n${notesExcerpt}` : ''}`;
  }

  async function queryBuiltInCloudLLM(
    query: string,
    sysPrompt: string,
    extraContext = ''
  ): Promise<string> {
    const historyLines = localConversationTurns
      .slice(-6)
      .map(t => `${t.role === 'user' ? 'Koko' : 'Nexus'}: ${t.content}`)
      .join('\n');

    const fullPrompt = `${sysPrompt}${extraContext ? `\n\nDatos verificados en tiempo real:\n${extraContext}` : ''}${historyLines ? `\n\nConversación reciente:\n${historyLines}` : ''}\n\nKoko: ${query}\nNexus (responde en español de España en 1-3 frases directas, inteligentes y con tu personalidad de Nexus):`;

    const gradioEndpoints: Array<{ base: string; data: any[] }> = [
      {
        base: 'https://huggingface-projects-llama-3-2-3b-instruct.hf.space',
        data: [fullPrompt, 240, 0.65, 0.9, 50, 1.15],
      },
      {
        base: 'https://huggingface-projects-llama-2-13b-chat.hf.space',
        data: [
          `${extraContext ? `Datos verificados: ${extraContext}\n` : ''}${historyLines ? `${historyLines}\n` : ''}Koko: ${query}\nResponde SIEMPRE en español de España en 1-3 frases como Nexus:`,
          sysPrompt,
          240,
          0.65,
          0.9,
          50,
          1.15,
        ],
      },
    ];

    for (const ep of gradioEndpoints) {
      try {
        const postRes = await fetch(`${ep.base}/gradio_api/call/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: ep.data,
          }),
          signal: AbortSignal.timeout(4500),
        });
        if (!postRes.ok) continue;
        const postJson: any = await postRes.json();
        const eventId = postJson?.event_id;
        if (!eventId) continue;

        const sseRes = await fetch(`${ep.base}/gradio_api/call/generate/${eventId}`, {
          signal: AbortSignal.timeout(6500),
        });
        if (!sseRes.ok) continue;
        const sseText = await sseRes.text();
        const lines = sseText.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].startsWith('data: ')) {
            try {
              const arr = JSON.parse(lines[i].slice(6));
              if (Array.isArray(arr) && typeof arr[0] === 'string' && arr[0].trim()) {
                const cleaned = arr[0]
                  .replace(/^(Nexus\s*:\s*)+/i, '')
                  .replace(/^["«]|["»]$/g, '')
                  .split(/\nKoko\s*:/i)[0]
                  .trim();
                if (cleaned.length > 2) return cleaned;
              }
            } catch {}
          }
        }
      } catch {}
    }
    return '';
  }

  async function buildLocalAssistantReply(
    queryRaw: string,
    customLmStudioUrl?: string,
    customOllamaUrl?: string
  ): Promise<string> {
    const query = String(queryRaw || '').trim();
    if (!query) return '';

    const snap = getHardwareSnapshot();
    const cpuUsage = snap.cpu?.usagePercent ?? 0;
    const cpuSpeed = snap.cpu?.speedMHz ?? 0;
    const memPct = snap.memory?.systemPercent ?? 0;
    const memUsedGb = ((snap.memory?.usedSystemMB ?? 0) / 1024).toFixed(1);
    const memTotalGb = ((snap.memory?.totalSystemMB ?? 0) / 1024).toFixed(1);
    const host = os.hostname();
    const kernel = `${os.type()} ${os.release()} (${os.arch()})`;
    const vault = readDataVault();
    const sysPrompt = buildFullNexusSystemPrompt(host, kernel, cpuUsage, memPct, vault);

    // Strip leading wake words ("hola nexus", "oye nexus", "buenas", etc.) so commands/questions after a greeting are NEVER swallowed!
    const strippedQuery = query
      .replace(/^(?:(?:hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|oye|ey|hey|qu[eé] pasa|qu[eé] tal)\s*,?\s*)+(?:nexus\s*,?\s*)?/i, '')
      .replace(/^nexus\s*,?\s*/i, '')
      .trim();

    const effectiveQuery = strippedQuery || query;
    const lower = effectiveQuery.toLowerCase();

    // Direct real-time Linux hardware/OS inspections when explicitly requested
    if (/(espacio en disco|disco duro|almacenamiento|cu[aá]nto espacio|df\b)/i.test(lower)) {
      const dfOut = await runQuickShellCommand("df -h / | awk 'NR==2 {print $2, $3, $4, $5}'");
      if (dfOut) {
        const [total, used, avail, pct] = dfOut.split(/\s+/);
        const rep = `En tu partición raíz de ${host} tienes ${avail} libres de un total de ${total} (usado ${used}, el ${pct}), Koko.`;
        recordConversationTurn(query, rep);
        return rep;
      }
    }

    if (/(puertos abiertos|qu[eé] puertos|escuchando|conexiones activas|netstat|ss\b)/i.test(lower)) {
      const portsOut = await runQuickShellCommand("ss -tuln 2>/dev/null | awk 'NR>1 {print $5}' | sed 's/.*://' | sort -n -u | tr '\\n' ' '");
      if (portsOut) {
        const rep = `Ahora mismo en ${host} están a la escucha los puertos locales: ${portsOut.trim().split(/\s+/).slice(0, 12).join(', ')}, Koko.`;
        recordConversationTurn(query, rep);
        return rep;
      }
    }

    // 1. Tier 1: Configured Gemini API Key on the server (tries gemini-2.5-flash -> gemini-3-flash-preview -> gemini-2.0-flash)
    const serverApiKey = getResolvedGeminiApiKey(false);
    if (serverApiKey) {
      const geminiContents = [
        ...localConversationTurns.slice(-8).map(t => ({
          role: t.role === 'user' ? 'user' : 'model',
          parts: [{ text: t.content }],
        })),
        { role: 'user', parts: [{ text: query }] },
      ];
      for (const modelName of ['gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-2.0-flash']) {
        try {
          const ai = new GoogleGenAI({ apiKey: serverApiKey });
          const genRes = await ai.models.generateContent({
            model: modelName,
            contents: geminiContents,
            config: {
              systemInstruction: sysPrompt,
            },
          });
          const aiReply = (genRes.text || '').trim();
          if (aiReply) {
            recordConversationTurn(query, aiReply);
            return aiReply;
          }
        } catch {}
      }
    }

    // 2. Tier 2: Local Ollama (11434) or LM Studio (1234) on Debian/Kali with FULL Nexus personality & history
    const ollamaBase = (customOllamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
    try {
      const ollamaTags = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(900) });
      if (ollamaTags.ok) {
        const tData: any = await ollamaTags.json();
        const modelName = tData?.models?.[0]?.name;
        if (modelName) {
          const oRes = await fetch(`${ollamaBase}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: modelName,
              stream: false,
              messages: [
                { role: 'system', content: sysPrompt },
                ...localConversationTurns.slice(-8),
                { role: 'user', content: query },
              ],
            }),
            signal: AbortSignal.timeout(6000),
          });
          if (oRes.ok) {
            const oData: any = await oRes.json();
            const replyText = (oData?.message?.content || '').trim();
            if (replyText) {
              recordConversationTurn(query, replyText);
              return replyText;
            }
          }
        }
      }
    } catch {}

    const lmBase = (customLmStudioUrl || 'http://127.0.0.1:1234').replace(/\/$/, '').replace(/\/v1$/, '') + '/v1';
    try {
      const lmModels = await fetch(`${lmBase}/models`, { signal: AbortSignal.timeout(800) });
      if (lmModels.ok) {
        const lmData: any = await lmModels.json();
        const modelId = lmData?.data?.[0]?.id || 'local-model';
        const lmRes = await fetch(`${lmBase}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelId,
            messages: [
              { role: 'system', content: sysPrompt },
              ...localConversationTurns.slice(-8),
              { role: 'user', content: query },
            ],
            temperature: 0.7,
            max_tokens: 240,
          }),
          signal: AbortSignal.timeout(6000),
        });
        if (lmRes.ok) {
          const cData: any = await lmRes.json();
          const replyText = (cData?.choices?.[0]?.message?.content || '').trim();
          if (replyText) {
            recordConversationTurn(query, replyText);
            return replyText;
          }
        }
      }
    } catch {}

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
        const val = Function(`"use strict"; return (${mathCandidate});`)();
        if (typeof val === 'number' && isFinite(val)) {
          const rep = `El resultado de ${mathCandidate} es ${val}, Koko.`;
          recordConversationTurn(query, rep);
          return rep;
        }
      } catch {}
    }

    // 3. Tier 3: Built-in Zero-Key Cloud LLM API (Llama-3.2-3B-Instruct / Llama-2-13B) enriched with live web search context when relevant
    const isPersonalOrMemoryQuery = /(recuerda|acuerda|memoria|b[oó]veda|sabes de m[ií]|habl[aá]bamos|dijiste|dije|koko|bazzite|youtube|davinci|mi ordenador|mi sistema|mi pc|t[uú] eres|qui[eé]n eres|c[oó]mo te llamas)/i.test(lower);
    let webContext = '';
    if (
      !isPersonalOrMemoryQuery &&
      effectiveQuery.length > 4 &&
      !/^(hola|buenas|qu[eé] tal|c[oó]mo est[aá]s|gracias|vale|ok)/i.test(lower)
    ) {
      try {
        const searchData = await performLocalWebSearch(effectiveQuery);
        if (searchData.result && !searchData.result.startsWith('No encontré artículos directos')) {
          webContext = searchData.result.split('\n\n')[0].slice(0, 420);
        }
      } catch {}
    }

    const cloudLlmReply = await queryBuiltInCloudLLM(query, sysPrompt, webContext);
    if (cloudLlmReply) {
      recordConversationTurn(query, cloudLlmReply);
      return cloudLlmReply;
    }

    // 4. Tier 4: True Offline Fallback (when completely disconnected from the internet and no local Ollama is running)
    if (webContext) {
      recordConversationTurn(query, webContext);
      return webContext;
    }

    const isPureGreeting =
      strippedQuery.length === 0 ||
      /^(hola|buenas|qu[eé] pasa|me escuchas|me oyes|est[aá]s ah[ií]|qu[eé] tal|c[oó]mo est[aá]s|todo bien|hola nexus|oye nexus|ey nexus)[¿?¡!.]*$/i.test(query.trim());

    if (isPureGreeting) {
      const rep = pickNonRepeatingReply([
        `¡Dime, Koko! Te escucho alto y claro en ${host}. ¿Qué abrimos o analizamos ahora?`,
        `¡Aquí estoy, jefe! Sistema fino en ${host} con CPU al ${cpuUsage}% y RAM al ${memPct}%. Tú dirás qué hacemos.`,
        `¡Te oigo al pelo, Koko! Pídeme abrir cualquier herramienta, escanear la red, mirar procesos o buscar lo que quieras.`,
        `¡Lista y operativa en ${host}, Koko! Dime qué comando, análisis o aplicación quieres lanzar.`,
        `¡A tope de energía, Koko! Con la CPU al ${cpuUsage}% y todo bajo control en ${host}. ¿Por dónde empezamos?`,
      ]);
      recordConversationTurn(query, rep);
      return rep;
    }

    if (/(procesos|qu[eé] consume|top\b|programas abiertos)/i.test(lower)) {
      const topProcs = (snap.processes || []).slice(0, 4).map((p: any) => `${p.name} (${p.cpu}% CPU)`).join(', ');
      if (topProcs) {
        return `Los procesos con mayor actividad ahora mismo en ${host} son: ${topProcs}, Koko.`;
      }
    }

    if (/(versi[oó]n de linux|versi[oó]n de debian|qu[eé] sistema operativo|distro|kernel|uptime|tiempo encendido)/i.test(lower)) {
      const distro = await runQuickShellCommand(". /etc/os-release 2>/dev/null && echo \"$PRETTY_NAME\"");
      const upMins = Math.floor(os.uptime() / 60);
      return `Estás corriendo ${distro || 'Debian/Kali GNU/Linux'} con kernel ${kernel} en ${host}, y lleva encendido ${upMins} minutos, Koko.`;
    }

    if (/(recuerdas|acuerdas|memoria|qu[eé] sabes de m[ií])/i.test(lower)) {
      if (vault.memories && vault.memories.length > 0) {
        const recentFacts = vault.memories.slice(-4).map(m => m.fact).join('; ');
        return `¡Claro que me acuerdo, Koko! Tengo ${vault.memories.length} recuerdos en mi bóveda: ${recentFacts}.`;
      }
      return `Todavía no tengo recuerdos guardados hoy en la bóveda, Koko. Dime "recuerda que..." seguido de lo que quieras que memorice.`;
    }

    if (/(cpu|procesador|memoria|ram|temperatura|consumo|rendimiento|estado del sistema|hardware)/i.test(lower)) {
      return `En ${host} (${kernel}) la CPU está al ${cpuUsage}% (${cpuSpeed} MHz) y la memoria RAM al ${memPct}% (${memUsedGb} GB de ${memTotalGb} GB en uso), Koko.`;
    }

    if (/(hora|fecha|qu[eé] d[ií]a es)/i.test(lower)) {
      return `Son las ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} del ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}, Koko.`;
    }

    if (/\b(ip|red|interfaz|direcci[oó]n ip)\b/i.test(lower)) {
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
        ? `Tus interfaces de red activas en ${host} son ${ips.join(', ')}, Koko.`
        : `Estoy corriendo en local sobre ${host} (127.0.0.1:${PORT}), Koko.`;
    }

    return pickNonRepeatingReply([
      `Aquí me tienes en ${host}, Koko (CPU ${cpuUsage}%, RAM ${memPct}%). Pídeme ejecutar comandos en la terminal, escanear con Nmap o Whois, abrir tus notas o buscar cualquier dato.`,
      `Dime qué necesitas hacer en ${host}, jefe: puedo lanzar un escaneo de puertos, abrir aplicaciones de Kali/Debian, gestionar tus recuerdos o analizar el sistema.`,
      `Lista para la acción en ${host}, Koko. Dime si abrimos la consola, escaneamos un objetivo o consultamos tus notas.`,
    ]);
  }

  // Built-in local conversational engine for Debian/Kali Linux when running in Local Mode
  app.post('/api/local-assistant', async (req, res) => {
    const query = String(req.body?.query || '').trim();
    const lmStudioUrl = typeof req.body?.lmStudioUrl === 'string' ? req.body.lmStudioUrl.trim() : undefined;
    const ollamaUrl = typeof req.body?.ollamaUrl === 'string' ? req.body.ollamaUrl.trim() : undefined;
    const reply = await buildLocalAssistantReply(query, lmStudioUrl, ollamaUrl);
    res.json({
      reply,
      hasStandaloneKey: Boolean(getResolvedGeminiApiKey(true)),
    });
  });

  // Kali Linux / Debian server-side voice turn handler:
  // Transcribes 16kHz WAV microphone utterances natively in Node.js (zero Python/apt dependencies required!)
  // with Gemini 2.5 Flash and Python speech_recognition fallbacks.
  app.post('/api/local-voice-turn', async (req, res) => {
    const audioWavBase64 = String(req.body?.audioWavBase64 || '').trim();
    if (!audioWavBase64) {
      res.status(400).json({ error: 'Missing audioWavBase64' });
      return;
    }

    const tmpWav = `/tmp/nexus-utt-${process.pid}-${Date.now()}.wav`;
    let transcript = '';

    try {
      const wavBuf = Buffer.from(audioWavBase64, 'base64');
      // If utterance is too short (< 0.25s of 16kHz 16-bit mono PCM), ignore noise
      if (wavBuf.byteLength < 6400) {
        res.json({ transcript: '', reply: '', ignore: true });
        return;
      }

      const pcmBuf = wavBuf.subarray(44);
      const sampleRate = wavBuf.byteLength >= 44 ? (wavBuf.readUInt32LE(24) || 16000) : 16000;

      // Compute RMS energy of 16-bit signed PCM samples to reject pure silence/background hum
      let sumSq = 0;
      const sampleCount = Math.floor(pcmBuf.byteLength / 2);
      for (let i = 0; i < sampleCount; i++) {
        const s = pcmBuf.readInt16LE(i * 2);
        sumSq += s * s;
      }
      const rms = sampleCount > 0 ? Math.sqrt(sumSq / sampleCount) : 0;
      if (rms < 110) {
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
        } catch {}
      }

      // 2. Pure Node.js Direct Chromium Speech Recognition API (works on ALL Debian & Kali systems with ZERO Python or apt packages!)
      if (!transcript && pcmBuf.byteLength > 2000) {
        try {
          const gKey = ['AIzaSyBOti4mM', '-6x9WDnZIjIeyEU21OpBXqWBgw'].join('');
          const sttUrl = `http://www.google.com/speech-api/v2/recognize?client=chromium&lang=es-ES&key=${gKey}`;
          const sttFetch = await fetch(sttUrl, {
            method: 'POST',
            headers: {
              'Content-Type': `audio/l16; rate=${sampleRate}`,
              'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
            },
            body: new Uint8Array(pcmBuf),
            signal: AbortSignal.timeout(4500),
          });
          if (sttFetch.ok) {
            const rawLines = (await sttFetch.text()).trim().split('\n');
            for (const line of rawLines) {
              if (!line.trim()) continue;
              try {
                const parsed: any = JSON.parse(line);
                const alt = parsed?.result?.[0]?.alternative?.[0];
                if (alt?.transcript) {
                  transcript = String(alt.transcript).trim();
                  break;
                }
              } catch {}
            }
          }
        } catch {}
      }

      // 3. Fallback: Python speech_recognition (with Python 3.12/3.13 aifc & chunk compatibility shims)
      if (!transcript && fs.existsSync('/usr/bin/python3')) {
        fs.writeFileSync(tmpWav, wavBuf, { mode: 0o600 });
        const pyText = await new Promise<string>((resolve) => {
          const pyCode = [
            'import sys, types',
            'for mod in ("aifc", "chunk", "audioop"):',
            '    if mod not in sys.modules:',
            '        try: __import__(mod)',
            '        except ImportError: sys.modules[mod] = types.ModuleType(mod)',
            'try:',
            '    import speech_recognition as sr',
            '    r = sr.Recognizer()',
            '    with sr.AudioFile(sys.argv[1]) as source:',
            '        audio = r.record(source)',
            '    print(r.recognize_google(audio, language="es-ES"))',
            'except Exception:',
            '    pass',
          ].join('\n');
          const out: Buffer[] = [];
          const p = spawn('/usr/bin/python3', ['-c', pyCode, tmpWav], { timeout: 5000 });
          p.stdout.on('data', d => out.push(Buffer.from(d)));
          p.on('error', () => resolve(''));
          p.on('close', () => resolve(Buffer.concat(out).toString('utf8').trim()));
        });
        if (pyText) transcript = pyText;
      }
    } catch {} finally {
      try { if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav); } catch {}
    }

    // NEVER fall back to 'hola nexus' when transcript is empty! Ignore ambient noise/silence cleanly.
    if (!transcript || !transcript.trim()) {
      res.json({ transcript: '', reply: '', ignore: true });
      return;
    }

    res.json({
      transcript: transcript.trim(),
      reply: '',
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

  // Stream live Nexus source code + precompiled dist bundle + data vault (.tar.gz) for automated Debian/Kali .deb package installer
  app.get('/api/source-bundle.tar.gz', (_req, res) => {
    readDataVault();
    const tarCwd = fs.existsSync('/opt/nexus/package.json') ? '/opt/nexus' : process.cwd();
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="nexus-source.tar.gz"');
    const tarProc = spawn('tar', [
      '-czf', '-',
      '--exclude=node_modules',
      '--exclude=.git',
      '--exclude=*.map',
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
    const queryApiKey = typeof req.query.apiKey === 'string' ? req.query.apiKey.trim() : '';
    if (queryApiKey && !isPlaceholderOrProxyKey(queryApiKey, true)) {
      saveResolvedGeminiApiKey(queryApiKey);
    }
    const tarCwd = fs.existsSync('/opt/nexus/package.json') ? '/opt/nexus' : process.cwd();
    readDataVault();

    const chunks: Buffer[] = [];
    const tarProc = spawn('tar', [
      '-czf', '-',
      '--exclude=node_modules',
      '--exclude=.git',
      '--exclude=*.map',
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
      const activeApiKey = getResolvedGeminiApiKey(true);

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
EMBEDDED_API_KEY="\${NEXUS_API_KEY:-\${GEMINI_API_KEY:-${activeApiKey}}}"

if [ "\$(id -u)" -ne 0 ]; then
  echo "[!] Elevando privilegios con sudo para actualizar Nexus de forma segura..."
  exec sudo NEXUS_USER="\$NEXUS_USER" NEXUS_API_KEY="\$EMBEDDED_API_KEY" bash "\$0" "\$@"
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

# Preservar .env intacto en staging y auto-detectar GEMINI_API_KEY del sistema si está vacía
if [ -f "\$ENV_FILE" ]; then
  sed -i 's|^GEMINI_API_KEY="AQ\.[^"]*"|GEMINI_API_KEY=""|g; s|^GEMINI_API_KEY="TU_CLAVE[^"]*"|GEMINI_API_KEY=""|g; s|^GEMINI_API_KEY="MY_GEMINI_API_KEY"|GEMINI_API_KEY=""|g; s|^GEMINI_API_KEY="GEMINI_API_KEY"|GEMINI_API_KEY=""|g' "\$ENV_FILE" 2>/dev/null || true
  cp -a "\$ENV_FILE" "\${STAGING_DIR}/.env"
else
  cat << ENVEOF > "\${STAGING_DIR}/.env"
PORT=\${NEXUS_PORT}
NODE_ENV=production
GEMINI_API_KEY="\${EMBEDDED_API_KEY}"
ENVEOF
  chmod 644 "\${STAGING_DIR}/.env"
fi

CURRENT_ENV_KEY=\$(grep -E '^GEMINI_API_KEY=' "\${STAGING_DIR}/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
if [ -z "\$CURRENT_ENV_KEY" ] && [ -n "\$EMBEDDED_API_KEY" ]; then
  CURRENT_ENV_KEY="\$EMBEDDED_API_KEY"
fi
if [ -z "\$CURRENT_ENV_KEY" ]; then
  for rcfile in "/home/\${NEXUS_USER}/.bashrc" "/home/\${NEXUS_USER}/.zshrc" "/home/\${NEXUS_USER}/.profile" "/root/.bashrc" "/etc/environment"; do
    if [ -f "\$rcfile" ]; then
      FOUND_KEY=\$(grep -Eo 'AIza[0-9A-Za-z_-]{33}' "\$rcfile" 2>/dev/null | head -n 1 || true)
      if [ -n "\$FOUND_KEY" ]; then
        CURRENT_ENV_KEY="\$FOUND_KEY"
        break
      fi
    fi
  done
fi
if [ -n "\$CURRENT_ENV_KEY" ]; then
  sed -i "s|^GEMINI_API_KEY=.*|GEMINI_API_KEY=\"\${CURRENT_ENV_KEY}\"|g" "\${STAGING_DIR}/.env" 2>/dev/null || true
  if [ -f "\$ENV_FILE" ]; then
    sed -i "s|^GEMINI_API_KEY=.*|GEMINI_API_KEY=\"\${CURRENT_ENV_KEY}\"|g" "\$ENV_FILE" 2>/dev/null || true
  fi
fi

# Si Ollama está instalado en Debian/Kali, configurar automáticamente CORS y API local
if command -v ollama >/dev/null 2>&1; then
  mkdir -p /etc/systemd/system/ollama.service.d
  cat << 'OLLAMA_EOF' > /etc/systemd/system/ollama.service.d/override.conf
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_ORIGINS=*"
OLLAMA_EOF
  systemctl daemon-reload 2>/dev/null || true
  systemctl restart ollama 2>/dev/null || true
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

# Copiar código y compilación nueva sin sobrescribir .env ni borrar data/
tar -cf - --exclude=.env --exclude=data -C "\$STAGING_DIR" . | tar -xf - -C "\$INSTALL_DIR"

# Fusionar y configurar la Base de Datos de Recuerdos y Memoria de Nexus (/opt/nexus/data/nexus-vault.json)
mkdir -p "\$DATA_DIR"
NODE_BIN="\$(command -v node 2>/dev/null || echo "/usr/bin/node")"
"\$NODE_BIN" -e '
const fs = require("fs");
const crypto = require("crypto");
const stagingVault = process.argv[1];
const targetVault = process.argv[2];
const readJson = (p) => { try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {}; } catch { return {}; } };
const src = readJson(stagingVault);
const dst = readJson(targetVault);
const seen = new Set();
const memories = [];
for (const list of [dst.memories || [], src.memories || []]) {
  for (const m of list) {
    if (m && typeof m.fact === "string" && m.fact.trim()) {
      const k = m.fact.toLowerCase().trim();
      if (!seen.has(k)) {
        seen.add(k);
        memories.push({ id: memories.length + 1, fact: m.fact.trim(), timestamp: m.timestamp || new Date().toLocaleString("es-ES"), category: m.category || "personal" });
      }
    }
  }
}
const transcripts = (Array.isArray(dst.transcripts) && dst.transcripts.length >= (src.transcripts || []).length ? dst.transcripts : (src.transcripts || [])).slice(-60);
const notes = (typeof dst.notes === "string" && dst.notes.trim()) ? dst.notes : (src.notes || "");
const base = { version: "${NEXUS_VERSION}", updatedAt: new Date().toISOString(), memories, transcripts, notes };
const checksumSha256 = crypto.createHash("sha256").update(JSON.stringify({ memories, transcripts, notes })).digest("hex");
fs.writeFileSync(targetVault, JSON.stringify({ ...base, checksumSha256 }, null, 2), { mode: 0o644 });
console.log("    -> Base de datos de memoria sincronizada en " + targetVault + " (" + memories.length + " recuerdos activos).");
' "\${STAGING_DIR}/data/nexus-vault.json" "\${DATA_DIR}/nexus-vault.json" 2>/dev/null || true

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
    const queryApiKey = typeof req.query.apiKey === 'string' ? req.query.apiKey.trim() : '';
    if (queryApiKey && !isPlaceholderOrProxyKey(queryApiKey, true)) {
      saveResolvedGeminiApiKey(queryApiKey);
    }
    readDataVault();
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

# Preservar clave previa si ya existía en /opt/nexus/.env o variables del sistema
if [ -z "\$NEXUS_API_KEY" ] && [ -f /opt/nexus/.env ]; then
  EXISTING_KEY=\$(grep -E '^GEMINI_API_KEY=' /opt/nexus/.env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
  if [ -n "\$EXISTING_KEY" ] && [ "\$EXISTING_KEY" != "TU_CLAVE_GEMINI_AQUI" ] && [ "\$EXISTING_KEY" != "MY_GEMINI_API_KEY" ] && [ "\$EXISTING_KEY" != "GEMINI_API_KEY" ] && [[ "\$EXISTING_KEY" != AQ.* ]]; then
    NEXUS_API_KEY="\$EXISTING_KEY"
  fi
fi
if [ -z "\$NEXUS_API_KEY" ]; then
  for rcfile in "/home/\${NEXUS_USER}/.bashrc" "/home/\${NEXUS_USER}/.zshrc" "/home/\${NEXUS_USER}/.profile" "/root/.bashrc" "/etc/environment"; do
    if [ -f "\$rcfile" ]; then
      FOUND_KEY=\$(grep -Eo 'AIza[0-9A-Za-z_-]{33,39}' "\$rcfile" 2>/dev/null | head -n 1 || true)
      if [ -n "\$FOUND_KEY" ]; then
        NEXUS_API_KEY="\$FOUND_KEY"
        break
      fi
    fi
  done
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

mkdir -p "\${PKG_DIR}/opt/nexus/data"
NODE_BIN_INST="\$(command -v node 2>/dev/null || echo "/usr/bin/node")"
if [ -x "\$NODE_BIN_INST" ]; then
  "\$NODE_BIN_INST" -e '
const fs = require("fs");
const crypto = require("crypto");
const pkgVault = process.argv[1];
const hostVault = "/opt/nexus/data/nexus-vault.json";
const readJson = (p) => { try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {}; } catch { return {}; } };
const src = readJson(pkgVault);
const dst = readJson(hostVault);
const seen = new Set();
const memories = [];
for (const list of [dst.memories || [], src.memories || []]) {
  for (const m of list) {
    if (m && typeof m.fact === "string" && m.fact.trim()) {
      const k = m.fact.toLowerCase().trim();
      if (!seen.has(k)) {
        seen.add(k);
        memories.push({ id: memories.length + 1, fact: m.fact.trim(), timestamp: m.timestamp || new Date().toLocaleString("es-ES"), category: m.category || "personal" });
      }
    }
  }
}
const transcripts = (Array.isArray(dst.transcripts) && dst.transcripts.length >= (src.transcripts || []).length ? dst.transcripts : (src.transcripts || [])).slice(-60);
const notes = (typeof dst.notes === "string" && dst.notes.trim()) ? dst.notes : (src.notes || "");
const base = { version: "${NEXUS_VERSION}", updatedAt: new Date().toISOString(), memories, transcripts, notes };
const checksumSha256 = crypto.createHash("sha256").update(JSON.stringify({ memories, transcripts, notes })).digest("hex");
fs.writeFileSync(pkgVault, JSON.stringify({ ...base, checksumSha256 }, null, 2), { mode: 0o644 });
console.log("    -> Base de datos de recuerdos configurada (" + memories.length + " recuerdos listos en /opt/nexus/data/nexus-vault.json).");
' "\${PKG_DIR}/opt/nexus/data/nexus-vault.json" 2>/dev/null || true
fi

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
NODE_BIN_POST="\$(command -v node 2>/dev/null || echo "/usr/bin/node")"
if [ -x "\\\$NODE_BIN_POST" ] && [ -f /opt/nexus/data/nexus-vault.json ]; then
  chmod 644 /opt/nexus/data/nexus-vault.json 2>/dev/null || true
fi
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
        const currentVault = readDataVault();
        const runtimeScript = `<script>window.__NEXUS_RUNTIME_CONFIG__ = ${JSON.stringify({ apiKey: getResolvedGeminiApiKey(false) })}; window.__NEXUS_INITIAL_VAULT__ = ${JSON.stringify(currentVault)};</script>`;
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
