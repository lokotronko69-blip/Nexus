
export type NexusStatus = 'OFFLINE' | 'CONNECTING' | 'LISTENING' | 'THINKING' | 'SPEAKING';

// FIX: Add the missing TranscriptMessage type definition.
export interface TranscriptMessage {
    speaker: 'Koko' | 'Nexus';
    text: string;
}

export interface CoreUsage {
    id: string;
    coreIndex: number;
    usagePercent: number;
    speedMHz?: number;
}

export interface CpuHardwareMetrics {
    usagePercent: number;
    cores: number;
    threads: number;
    perCore: CoreUsage[];
    model: string;
    vendor: string;
    speedMHz: number;
    cacheKB: number;
    loadAverage: number[];
}

export interface MemoryHardwareMetrics {
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
}

export interface NetworkHardwareMetrics {
    rxSpeedKBps: number;
    txSpeedKBps: number;
    totalRxMB: number;
    totalTxMB: number;
    activeInterface: string;
    interfaces: {
        name: string;
        rxBytes: number;
        txBytes: number;
    }[];
}

export interface SystemHardwareMetrics {
    timestamp: number;
    serverUptimeSec: number;
    systemUptimeSec: number;
    platform: string;
    arch: string;
    hostname: string;
    cpu: CpuHardwareMetrics;
    memory: MemoryHardwareMetrics;
    network: NetworkHardwareMetrics;
}

export interface ClientHardwareMetrics {
    logicalCores: number;
    deviceMemoryGB?: number;
    gpuRenderer: string;
    gpuVendor: string;
    screenResolution: string;
    pixelRatio: number;
    refreshRateFPS: number;
    connectionType?: string;
    downlinkMbps?: number;
    rttMs?: number;
    batteryPercent?: number;
    isCharging?: boolean;
}
