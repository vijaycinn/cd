import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createdServices = [];

function createService() {
    const { AzureRealtimeWebSocketService } = require('../utils/azureRealtimeWebSocket.js');
    const service = new AzureRealtimeWebSocketService(
        'test-key',
        'https://test.openai.azure.com',
        'gpt-5-mini',
        'eastus2',
        'test prompt',
        'interview',
        'en-US'
    );

    service.isInitialized = true;
    service.socket = { readyState: 1, send: vi.fn() };
    service.chunkFlushIntervalMs = Number.MAX_SAFE_INTEGER;
    service.lastChunkFlushTs = Date.now();
    service.scheduleFlush = vi.fn();
    createdServices.push(service);
    return service;
}

describe('Azure Realtime VAD activity and trailing silence handling', () => {
    let originalLocalStorage;

    beforeEach(() => {
        originalLocalStorage = global.localStorage;
        global.localStorage = {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
            clear: () => {}
        };
    });

    afterEach(() => {
        for (const service of createdServices.splice(0, createdServices.length)) {
            if (typeof service.clearFlushTimer === 'function') {
                service.clearFlushTimer();
            }
        }
        global.localStorage = originalLocalStorage;
        vi.restoreAllMocks();
    });

    it('isServerVadActive follows turn-detection builders for azure-realtime and voice-live', () => {
        const service = createService();

        service.voiceProvider = 'azure-realtime';
        service.azureRealtimeSettings.serverVad = { enabled: true, type: 'server_vad', createResponse: true };
        expect(service.isServerVadActive()).toBe(true);

        service.azureRealtimeSettings.serverVad = { enabled: false, type: 'server_vad' };
        expect(service.isServerVadActive()).toBe(false);

        service.azureRealtimeSettings.serverVad = { enabled: true, type: 'none' };
        expect(service.isServerVadActive()).toBe(false);

        service.voiceProvider = 'voice-live';
        service.azureRealtimeSettings.voiceLive = {
            ...(service.azureRealtimeSettings.voiceLive || {}),
            semanticVad: { enabled: true, type: 'azure_semantic_vad' }
        };
        expect(service.isServerVadActive()).toBe(true);

        service.azureRealtimeSettings.voiceLive.semanticVad = { enabled: false };
        service.azureRealtimeSettings.serverVad = { enabled: false, type: 'server_vad' };
        expect(service.isServerVadActive()).toBe(false);

        service.azureRealtimeSettings.serverVad = { enabled: true, type: 'server_vad', createResponse: true };
        expect(service.isServerVadActive()).toBe(true);
    });

    it('sendAudio drops silent chunks when speech is inactive and preserves them when speech is active', async () => {
        const service = createService();
        service.analyzeAudioFrame = vi.fn(() => ({ rms: 0, isSilent: true }));
        service.hasSentAudio = true;

        const silentChunk = Buffer.alloc(320);

        service.speechActive = false;
        const dropped = await service.sendAudio(silentChunk);
        expect(dropped).toBe(true);
        expect(service.metrics.audioChunksSkipped).toBe(1);
        expect(service.pendingChunkAccumulator).toHaveLength(0);

        service.speechActive = true;
        service.trailingSilenceBytes = 0;
        service.maxTrailingSilenceBytes = 1000;

        const preserved = await service.sendAudio(silentChunk);
        expect(preserved).toBe(true);
        expect(service.pendingChunkAccumulator).toHaveLength(1);
        expect(service.pendingChunkAccumulator[0]).toBe(silentChunk);
        expect(service.trailingSilenceBytes).toBe(silentChunk.length);
    });

    it('sendAudio trailing silence watchdog clears speechActive when speech_stopped is delayed', async () => {
        const service = createService();
        service.analyzeAudioFrame = vi.fn(() => ({ rms: 0, isSilent: true }));
        service.hasSentAudio = true;
        service.speechActive = true;
        service.trailingSilenceBytes = 0;
        service.maxTrailingSilenceBytes = 100;

        const staleSilenceChunk = Buffer.alloc(120);
        const handled = await service.sendAudio(staleSilenceChunk);

        expect(handled).toBe(true);
        expect(service.speechActive).toBe(false);
        expect(service.trailingSilenceBytes).toBe(0);
        expect(service.pendingChunkAccumulator).toHaveLength(0);
        expect(service.metrics.audioChunksQueued).toBe(0);
    });
});
