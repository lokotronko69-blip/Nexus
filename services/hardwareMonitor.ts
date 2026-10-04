import fs from 'fs';
import os from 'os';
import { Server as SocketIOServer } from 'socket.io';
import { SystemHardwareMetrics, CoreUsage } from '../types';

interface CpuSample {
    idle: number;
    total: number;
}

interface CoreSample {
    id: string;
    coreIndex: number;
    idle: number;
    total: number;
}

interface NetSample {
    time: number;
    rxBytes: number;
    txBytes: number;
}

// Previous state tracking for differential calculations
let lastTotalCpu: CpuSample | null = null;
let lastCoreSamples: Map<string, CoreSample> = new Map();
let lastNetSample: NetSample | null = null;
let latestSnapshot: SystemHardwareMetrics | null = null;
let lastNodeCpuTimes = os.cpus().map(c => c.times);

/**
 * Reads and parses Linux /proc/stat for total CPU and per-core CPU jiffies.
 */
function readProcStat(): { total: CpuSample; cores: CoreSample[] } | null {
    try {
        if (!fs.existsSync('/proc/stat')) return null;
        const stat = fs.readFileSync('/proc/stat', 'utf8');
        const lines = stat.split('\n');
        let total: CpuSample | null = null;
        const cores: CoreSample[] = [];

        for (const line of lines) {
            if (line.startsWith('cpu ')) {
                const parts = line.trim().split(/\s+/).slice(1).map(Number);
                if (parts.length >= 4) {
                    const idle = parts[3] + (parts[4] || 0); // idle + iowait
                    const totalJiffies = parts.reduce((acc, v) => acc + v, 0);
                    total = { idle, total: totalJiffies };
                }
            } else if (line.match(/^cpu\d+/)) {
                const parts = line.trim().split(/\s+/);
                const id = parts[0];
                const coreIndex = parseInt(id.replace('cpu', ''), 10) || 0;
                const numbers = parts.slice(1).map(Number);
                if (numbers.length >= 4) {
                    const idle = numbers[3] + (numbers[4] || 0);
                    const totalJiffies = numbers.reduce((acc, v) => acc + v, 0);
                    cores.push({ id, coreIndex, idle, total: totalJiffies });
                }
            }
        }

        if (total && cores.length > 0) {
            return { total, cores };
        }
    } catch {
        // Fallback to standard Node.js os module
    }
    return null;
}

/**
 * Calculates CPU metrics: aggregate percent and per-core usage.
 */
function calculateCpuMetrics(speedMHz: number): {
    usagePercent: number;
    cores: number;
    threads: number;
    perCore: CoreUsage[];
} {
    const procStat = readProcStat();
    const osCpus = os.cpus();
    const threads = osCpus.length || 1;

    if (procStat) {
        let usagePercent = 0;
        if (lastTotalCpu) {
            const deltaTotal = procStat.total.total - lastTotalCpu.total;
            const deltaIdle = procStat.total.idle - lastTotalCpu.idle;
            if (deltaTotal > 0) {
                usagePercent = Math.max(0, Math.min(100, Math.round((1 - deltaIdle / deltaTotal) * 1000) / 10));
            }
        }
        lastTotalCpu = procStat.total;

        const perCore: CoreUsage[] = [];
        for (const core of procStat.cores) {
            const prev = lastCoreSamples.get(core.id);
            let coreUsage = usagePercent;
            if (prev) {
                const dTotal = core.total - prev.total;
                const dIdle = core.idle - prev.idle;
                if (dTotal > 0) {
                    coreUsage = Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 1000) / 10));
                }
            }
            lastCoreSamples.set(core.id, core);
            perCore.push({
                id: core.id,
                coreIndex: core.coreIndex,
                usagePercent: coreUsage,
                speedMHz: osCpus[core.coreIndex]?.speed || speedMHz
            });
        }

        return {
            usagePercent,
            cores: perCore.length,
            threads,
            perCore
        };
    }

    // Node.js fallback using os.cpus()
    const currentCpuTimes = osCpus.map(c => c.times);
    let totalDelta = 0;
    let idleDelta = 0;
    const perCore: CoreUsage[] = [];

    for (let i = 0; i < currentCpuTimes.length; i++) {
        const prev = lastNodeCpuTimes[i] || currentCpuTimes[i];
        const curr = currentCpuTimes[i];

        const prevTotal = Object.values(prev).reduce((acc, v) => acc + v, 0);
        const currTotal = Object.values(curr).reduce((acc, v) => acc + v, 0);

        const dTotal = Math.max(0, currTotal - prevTotal);
        const dIdle = Math.max(0, curr.idle - prev.idle);

        totalDelta += dTotal;
        idleDelta += dIdle;

        const coreUsage = dTotal > 0 ? Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 1000) / 10)) : 10;
        perCore.push({
            id: `cpu${i}`,
            coreIndex: i,
            usagePercent: coreUsage,
            speedMHz: osCpus[i]?.speed || speedMHz
        });
    }

    lastNodeCpuTimes = currentCpuTimes;
    let usagePercent = 5;
    if (totalDelta > 0) {
        usagePercent = Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 1000) / 10));
    } else {
        const load = os.loadavg()[0];
        usagePercent = Math.min(100, Math.max(2, Math.round((load / threads) * 1000) / 10));
    }

    return {
        usagePercent,
        cores: perCore.length,
        threads,
        perCore
    };
}

/**
 * Reads memory info from /proc/meminfo or os.
 */
function readMemoryMetrics(): {
    totalSystemMB: number;
    usedSystemMB: number;
    freeSystemMB: number;
    availableSystemMB: number;
    cachedMB: number;
    buffersMB: number;
    systemPercent: number;
    processRssMB: number;
    processHeapUsedMB: number;
    processHeapTotalMB: number;
    processExternalMB: number;
} {
    const memUsage = process.memoryUsage();
    let totalMB = Math.round(os.totalmem() / (1024 * 1024));
    let freeMB = Math.round(os.freemem() / (1024 * 1024));
    let availableMB = freeMB;
    let cachedMB = 0;
    let buffersMB = 0;

    try {
        if (fs.existsSync('/proc/meminfo')) {
            const content = fs.readFileSync('/proc/meminfo', 'utf8');
            const lines = content.split('\n');
            const map: Record<string, number> = {};
            for (const l of lines) {
                const match = l.match(/^([a-zA-Z_()]+):\s+(\d+)\s*kB/);
                if (match) {
                    map[match[1]] = parseInt(match[2], 10);
                }
            }

            if (map.MemTotal) totalMB = Math.round(map.MemTotal / 1024);
            if (map.MemFree) freeMB = Math.round(map.MemFree / 1024);
            if (map.MemAvailable) availableMB = Math.round(map.MemAvailable / 1024);
            else availableMB = freeMB;
            if (map.Cached) cachedMB = Math.round(map.Cached / 1024);
            if (map.Buffers) buffersMB = Math.round(map.Buffers / 1024);
        }
    } catch {
        // use os fallback
    }

    const usedMB = Math.max(0, totalMB - availableMB);
    const systemPercent = totalMB > 0 ? Math.round((usedMB / totalMB) * 1000) / 10 : 0;

    return {
        totalSystemMB: totalMB,
        usedSystemMB: usedMB,
        freeSystemMB: freeMB,
        availableSystemMB: availableMB,
        cachedMB,
        buffersMB,
        systemPercent,
        processRssMB: Math.round(memUsage.rss / (1024 * 1024)),
        processHeapUsedMB: Math.round(memUsage.heapUsed / (1024 * 1024)),
        processHeapTotalMB: Math.round(memUsage.heapTotal / (1024 * 1024)),
        processExternalMB: Math.round((memUsage.external || 0) / (1024 * 1024))
    };
}

/**
 * Reads network hardware bandwidth from /proc/net/dev.
 */
function readNetworkMetrics(): {
    rxSpeedKBps: number;
    txSpeedKBps: number;
    totalRxMB: number;
    totalTxMB: number;
    activeInterface: string;
    interfaces: { name: string; rxBytes: number; txBytes: number }[];
} {
    const interfaces: { name: string; rxBytes: number; txBytes: number }[] = [];
    let sumRx = 0;
    let sumTx = 0;
    let activeIf = 'eth0';

    try {
        if (fs.existsSync('/proc/net/dev')) {
            const content = fs.readFileSync('/proc/net/dev', 'utf8');
            const lines = content.trim().split('\n').slice(2);
            for (const line of lines) {
                const parts = line.trim().split(/[:\s]+/);
                if (parts.length >= 10) {
                    const name = parts[0];
                    const rx = parseInt(parts[1], 10) || 0;
                    const tx = parseInt(parts[9], 10) || 0;
                    interfaces.push({ name, rxBytes: rx, txBytes: tx });

                    // Exclude loopback for aggregate internet/intranet throughput
                    if (name !== 'lo') {
                        sumRx += rx;
                        sumTx += tx;
                        if (!activeIf || activeIf === 'lo') activeIf = name;
                    }
                }
            }
        }
    } catch {
        // fallback
    }

    if (interfaces.length === 0) {
        activeIf = 'virtual';
    }

    const now = Date.now();
    let rxSpeedKBps = 0;
    let txSpeedKBps = 0;

    if (lastNetSample) {
        const deltaSec = Math.max(0.2, (now - lastNetSample.time) / 1000);
        const dRx = Math.max(0, sumRx - lastNetSample.rxBytes);
        const dTx = Math.max(0, sumTx - lastNetSample.txBytes);
        rxSpeedKBps = Math.round((dRx / deltaSec / 1024) * 10) / 10;
        txSpeedKBps = Math.round((dTx / deltaSec / 1024) * 10) / 10;
    }

    lastNetSample = { time: now, rxBytes: sumRx, txBytes: sumTx };

    return {
        rxSpeedKBps,
        txSpeedKBps,
        totalRxMB: Math.round((sumRx / (1024 * 1024)) * 10) / 10,
        totalTxMB: Math.round((sumTx / (1024 * 1024)) * 10) / 10,
        activeInterface: activeIf,
        interfaces
    };
}

/**
 * Extracts CPU hardware specs from /proc/cpuinfo or os.cpus().
 */
function readCpuSpecs(): { model: string; vendor: string; speedMHz: number; cacheKB: number } {
    let model = os.cpus()[0]?.model || 'Nexus Virtual Core';
    let vendor = 'Hardware Host';
    let speedMHz = os.cpus()[0]?.speed || 2400;
    let cacheKB = 8192;

    try {
        if (fs.existsSync('/proc/cpuinfo')) {
            const content = fs.readFileSync('/proc/cpuinfo', 'utf8');
            for (const line of content.split('\n')) {
                const [key, val] = line.split(':').map(s => s.trim());
                if (!key || !val) continue;
                if (key === 'model name' && val !== 'unknown') model = val;
                if (key === 'vendor_id') vendor = val;
                if (key === 'cpu MHz') {
                    const parsed = parseFloat(val);
                    if (!isNaN(parsed) && parsed > 0) speedMHz = Math.round(parsed);
                }
                if (key === 'cache size') {
                    const match = val.match(/(\d+)\s*KB/i);
                    if (match) cacheKB = parseInt(match[1], 10);
                }
            }
        }
    } catch {
        // ignore
    }

    return { model, vendor, speedMHz, cacheKB };
}

/**
 * Takes a fresh snapshot of the hardware metrics.
 */
export function getHardwareSnapshot(): SystemHardwareMetrics {
    const specs = readCpuSpecs();
    const cpu = calculateCpuMetrics(specs.speedMHz);
    const memory = readMemoryMetrics();
    const network = readNetworkMetrics();

    latestSnapshot = {
        timestamp: Date.now(),
        serverUptimeSec: Math.round(process.uptime()),
        systemUptimeSec: Math.round(os.uptime()),
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        cpu: {
            ...cpu,
            model: specs.model,
            vendor: specs.vendor,
            speedMHz: specs.speedMHz,
            cacheKB: specs.cacheKB,
            loadAverage: os.loadavg().map(v => Math.round(v * 100) / 100)
        },
        memory,
        network
    };

    return latestSnapshot;
}

/**
 * Starts continuous hardware polling and Socket.io broadcasts.
 */
export function startHardwareMonitor(io: SocketIOServer, intervalMs: number = 1000) {
    // Initial snapshot to populate baseline counters
    getHardwareSnapshot();

    // High frequency interval
    setInterval(() => {
        const snapshot = getHardwareSnapshot();
        // Broadcast hardware tick to all connected clients
        io.emit('hardware_telemetry_tick', snapshot);
    }, intervalMs);

    // Setup socket-level handlers
    io.on('connection', (socket) => {
        // Send initial state immediately upon request or connect
        socket.on('request_hardware_snapshot', () => {
            const snapshot = latestSnapshot || getHardwareSnapshot();
            socket.emit('hardware_telemetry_tick', snapshot);
        });

        // Ultra low latency ping pong for hardware RTT calculation
        socket.on('ping_hardware', (data: { clientTime: number }) => {
            socket.emit('pong_hardware', {
                clientTime: data?.clientTime || 0,
                serverTime: Date.now()
            });
        });
    });
}
