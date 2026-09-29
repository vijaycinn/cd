/**
 * Tests for Voice Live interim responses, transcription model selection,
 * and per-turn latency instrumentation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function createService(deployment, options = {}) {
    const { AzureRealtimeWebSocketService } = require('../utils/azureRealtimeWebSocket.js');
    return new AzureRealtimeWebSocketService(
        'test-key',
        'https://test.services.ai.azure.com',
        deployment,
        'eastus2',
        'test prompt',
        'interview',
        'en-US',
        options
    );
}

function createVoiceLiveService(deployment, interimOverride) {
    const service = createService(deployment, { voiceProvider: 'voice-live' });
    service.azureRealtimeSettings.voiceLive = {
        ...service.azureRealtimeSettings.voiceLive,
        interimResponse: {
            enabled: true,
            mode: 'static',
            triggers: ['tool', 'latency'],
            latencyThresholdMs: 600,
            texts: ['One moment.'],
            ...interimOverride
        }
    };
    return service;
}

describe('Voice Live interim responses', () => {
    let originalLocalStorage;

    beforeEach(() => {
        originalLocalStorage = global.localStorage;
        global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
    });

    afterEach(() => {
        global.localStorage = originalLocalStorage;
        vi.restoreAllMocks();
    });

    it('includes static interim_response for a cascaded model', () => {
        const service = createVoiceLiveService('gpt-5-nano');
        const { session } = service.createSessionConfig([]);

        expect(session.interim_response).toEqual({
            type: 'static_interim_response',
            triggers: ['tool', 'latency'],
            latency_threshold_ms: 600,
            texts: ['One moment.']
        });
    });

    it('omits interim_response for realtime audio models, which do not support it', () => {
        const service = createVoiceLiveService('gpt-realtime-mini');
        const { session } = service.createSessionConfig([]);

        expect(session.interim_response).toBeUndefined();
    });

    it('emits llm_interim_response shape when mode is llm', () => {
        const service = createVoiceLiveService('gpt-5.4', {
            mode: 'llm',
            model: 'gpt-4.1-mini',
            instructions: 'Short filler only.',
            maxCompletionTokens: 40
        });
        const { session } = service.createSessionConfig([]);

        expect(session.interim_response).toEqual({
            type: 'llm_interim_response',
            triggers: ['tool', 'latency'],
            latency_threshold_ms: 600,
            model: 'gpt-4.1-mini',
            instructions: 'Short filler only.',
            max_completion_tokens: 40
        });
    });

    it('omits interim_response when disabled', () => {
        const service = createVoiceLiveService('gpt-5-nano', { enabled: false });
        const { session } = service.createSessionConfig([]);

        expect(session.interim_response).toBeUndefined();
    });

    it('omits static interim_response when no texts are configured', () => {
        const service = createVoiceLiveService('gpt-5-nano', { texts: [] });
        const { session } = service.createSessionConfig([]);

        expect(session.interim_response).toBeUndefined();
    });
});

describe('Voice Live transcription model selection', () => {    let originalLocalStorage;

    beforeEach(() => {
        originalLocalStorage = global.localStorage;
        global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
    });

    afterEach(() => {
        global.localStorage = originalLocalStorage;
        vi.restoreAllMocks();
    });

    it('uses azure-speech for cascaded models', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = {};
        expect(service.getInputTranscriptionConfig()).toEqual({ model: 'azure-speech', language: 'en' });
    });

    it('defaults realtime models to gpt-4o-mini-transcribe when unconfigured', () => {
        const service = createService('gpt-realtime-mini', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = {};
        expect(service.getInputTranscriptionConfig()).toEqual({ model: 'gpt-4o-mini-transcribe', language: 'en' });
    });

    it('honors a configured realtime fallback over the default', () => {
        const service = createService('gpt-realtime-mini', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = { realtimeTranscriptionFallback: 'whisper-1' };
        expect(service.getInputTranscriptionConfig()).toEqual({ model: 'whisper-1', language: 'en' });
    });

    it('always uses whisper-1 on the azure-realtime provider', () => {
        const service = createService('gpt-realtime-mini', { voiceProvider: 'azure-realtime' });
        expect(service.getInputTranscriptionConfig()).toEqual({ model: 'whisper-1', language: 'en' });
    });
});

describe('Voice Live pre-deployed model guardrail', () => {
    let originalLocalStorage;

    beforeEach(() => {
        originalLocalStorage = global.localStorage;
        global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
    });

    afterEach(() => {
        global.localStorage = originalLocalStorage;
        vi.restoreAllMocks();
    });

    it('warns about a model that requires BYOM', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        createService('gpt-5.4-nano', { voiceProvider: 'voice-live' });

        const messages = warn.mock.calls.map(args => String(args[0]));
        expect(messages.some(m => m.includes('gpt-5.4-nano') && m.includes('BYOM'))).toBe(true);
    });

    it('does not warn about a pre-deployed model', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        createService('gpt-5-nano', { voiceProvider: 'voice-live' });

        const messages = warn.mock.calls.map(args => String(args[0]));
        expect(messages.some(m => m.includes('BYOM'))).toBe(false);
    });
});

describe('Per-turn latency instrumentation', () => {
    let originalLocalStorage;

    beforeEach(() => {
        originalLocalStorage = global.localStorage;
        global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
    });

    afterEach(() => {
        global.localStorage = originalLocalStorage;
        vi.restoreAllMocks();
    });

    it('markTurn keeps the first timestamp for a mark', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.resetTurnMarks();

        vi.spyOn(Date, 'now').mockReturnValue(1000);
        service.markTurn('firstAudioDelta');
        Date.now.mockReturnValue(5000);
        service.markTurn('firstAudioDelta');

        expect(service.turnMarks.firstAudioDelta).toBe(1000);
    });

    it('reports perceived latency from speech stop to first output', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});

        service.turnMarks = {
            lastAudioFlush: 900,
            speechStopped: 1000,
            transcriptionDone: 1400,
            responseCreated: 1300,
            firstAudioDelta: 1900,
            responseDone: 2600
        };
        service.logTurnLatency();

        const entry = log.mock.calls.find(args => String(args[0]).includes('Turn latency'));
        expect(entry).toBeDefined();
        expect(entry[1]).toMatchObject({
            vadLag: 100,
            stt: 400,
            responseQueue: 300,
            llmTtft: 600,
            perceived: 900,
            total: 1600,
            firstOutput: 'audio'
        });
    });

    it('falls back to the first text delta when there is no audio output', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});

        service.turnMarks = { speechStopped: 1000, firstTextDelta: 1750 };
        service.logTurnLatency();

        const entry = log.mock.calls.find(args => String(args[0]).includes('Turn latency'));
        expect(entry[1]).toMatchObject({ perceived: 750, firstOutput: 'text' });
    });

    it('logs nothing when the turn never started', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});

        service.turnMarks = {};
        service.logTurnLatency();

        expect(log.mock.calls.some(args => String(args[0]).includes('Turn latency'))).toBe(false);
    });
});

describe('Model temperature compatibility', () => {
    let originalLocalStorage;

    beforeEach(() => {
        originalLocalStorage = global.localStorage;
        global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
    });

    afterEach(() => {
        global.localStorage = originalLocalStorage;
        vi.restoreAllMocks();
    });

    // gpt-5-nano rejects any temperature but its default, which failed every response.
    it('omits temperature when it is null', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = { temperature: null };
        const { session } = service.createSessionConfig([]);

        expect(session.temperature).toBeUndefined();
    });

    it('includes temperature when configured as a number', () => {
        const service = createService('gpt-4.1', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = { temperature: 0.6 };
        const { session } = service.createSessionConfig([]);

        expect(session.temperature).toBe(0.6);
    });

    it('strips temperature and retries once when the model rejects it', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.lastSessionConfig = { type: 'session.update', session: { temperature: 0.6 } };
        const sent = [];
        service.send = msg => { sent.push(msg); return true; };
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const retried = service.handleFailedResponse({
            status: 'failed',
            status_details: { error: { message: "Unsupported value: 'temperature' does not support 0.6 with this model." } }
        });

        expect(retried).toBe(true);
        expect(service.temperatureUnsupported).toBe(true);
        expect(service.lastSessionConfig.session.temperature).toBeUndefined();
        expect(sent.map(m => m.type)).toEqual(['session.update', 'response.create']);
    });

    it('does not retry the same failure twice', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.temperatureUnsupported = true;
        service.lastSessionConfig = { type: 'session.update', session: {} };
        service.send = () => true;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const onError = vi.fn();
        service.callbacks.onError = onError;

        const retried = service.handleFailedResponse({
            status: 'failed',
            status_details: { error: { message: "Unsupported value: 'temperature' does not support 0.6" } }
        });

        expect(retried).toBe(false);
        expect(onError).toHaveBeenCalled();
    });

    it('surfaces unrelated response failures through onError', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const onError = vi.fn();
        service.callbacks.onError = onError;

        const retried = service.handleFailedResponse({
            status: 'failed',
            status_details: { error: { message: 'content filter triggered' } }
        });

        expect(retried).toBe(false);
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('content filter triggered')
        }));
    });
});

describe('Output language pinning', () => {
    let originalLocalStorage;

    beforeEach(() => {
        originalLocalStorage = global.localStorage;
        global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
    });

    afterEach(() => {
        global.localStorage = originalLocalStorage;
        vi.restoreAllMocks();
    });

    // Without an explicit language, Azure Speech auto-detects and a mis-detect flips the whole turn.
    it('pins the transcription language instead of letting it auto-detect', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        expect(service.getInputTranscriptionConfig()).toEqual({ model: 'azure-speech', language: 'en' });
    });

    it('derives the primary subtag from a full locale', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.language = 'de-DE';
        expect(service.getPrimaryLanguage()).toBe('de');
        expect(service.getInputTranscriptionConfig().language).toBe('de');
    });

    it('scopes VAD filler-word removal to the configured language', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        expect(service.getVoiceLiveTurnDetectionConfig().languages).toEqual(['en']);
    });

    // The multilingual variant is overhead when output is pinned to one language.
    it('uses the English-focused semantic VAD by default', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = { semanticVad: { enabled: true } };
        expect(service.getVoiceLiveTurnDetectionConfig().type).toBe('azure_semantic_vad');
    });

    it('still honors an explicitly configured VAD type', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = {
            semanticVad: { enabled: true, type: 'azure_semantic_vad_multilingual' }
        };
        expect(service.getVoiceLiveTurnDetectionConfig().type).toBe('azure_semantic_vad_multilingual');
    });

    it('leads the instructions with an absolute output-language directive', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        const instructions = service.buildSessionInstructions('');

        expect(instructions.startsWith('## OUTPUT LANGUAGE (ABSOLUTE)')).toBe(true);
        expect(instructions).toContain('en-US');
    });

    // The directive must survive the 2000-char tail truncation.
    it('keeps the language directive when instructions are truncated', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        const instructions = service.buildSessionInstructions('x'.repeat(5000));

        expect(instructions.length).toBeLessThanOrEqual(2000);
        expect(instructions.startsWith('## OUTPUT LANGUAGE (ABSOLUTE)')).toBe(true);
    });
});

describe('Voice Live voice selection', () => {
    let originalLocalStorage;

    beforeEach(() => {
        originalLocalStorage = global.localStorage;
        global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
    });

    afterEach(() => {
        global.localStorage = originalLocalStorage;
        vi.restoreAllMocks();
    });

    // MS Learn scopes voice.temperature to Azure HD voices.
    it('keeps voice.temperature for an Azure HD voice', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = {
            voice: { name: 'en-US-Ava:DragonHDLatestNeural', type: 'azure-standard', temperature: 0.8 }
        };

        expect(service.getVoiceLiveVoiceConfig()).toEqual({
            name: 'en-US-Ava:DragonHDLatestNeural',
            type: 'azure-standard',
            temperature: 0.8
        });
    });

    it('drops voice.temperature for a non-HD voice', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = {
            voice: { name: 'en-US-Harper:MAI-Voice-2-Flash', type: 'azure-standard', temperature: 0.8 }
        };

        expect(service.getVoiceLiveVoiceConfig()).toEqual({
            name: 'en-US-Harper:MAI-Voice-2-Flash',
            type: 'azure-standard'
        });
    });

    it('leaves an OpenAI native string voice untouched', () => {
        const service = createService('gpt-realtime-mini', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = { voice: 'alloy' };

        expect(service.getVoiceLiveVoiceConfig()).toBe('alloy');
    });

    // 'azure-realtime'.includes('realtime') is true, so ordering matters here.
    it('uses the native voice type for the azure-realtime model', () => {
        const service = createService('azure-realtime', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = {};

        expect(service.getVoiceLiveVoiceConfig()).toEqual({ type: 'azure-realtime-native', name: 'ava' });
    });

    it('falls back to an OpenAI native voice for realtime models', () => {
        const service = createService('gpt-realtime-mini', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = {};

        expect(service.getVoiceLiveVoiceConfig()).toBe('alloy');
    });

    it('falls back to an HD voice with temperature for cascaded models', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = {};

        expect(service.getVoiceLiveVoiceConfig()).toEqual({
            name: 'en-US-Ava:DragonHDLatestNeural',
            type: 'azure-standard',
            temperature: 0.8
        });
    });
});

describe('Voice Live turn-end latency configuration', () => {
    let originalLocalStorage;

    beforeEach(() => {
        originalLocalStorage = global.localStorage;
        global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
    });

    afterEach(() => {
        global.localStorage = originalLocalStorage;
        vi.restoreAllMocks();
    });

    // Without EOU the turn ends only on the silence timer.
    it('sends semantic end-of-utterance detection by default', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        const turnDetection = service.getVoiceLiveTurnDetectionConfig();

        expect(turnDetection.end_of_utterance_detection).toEqual({
            model: 'semantic_detection_v1',
            timeout_ms: 1200
        });
    });

    // The docs contradict themselves on which direction thresholdLevel moves, so we ship neither end.
    it('omits threshold_level so the service default applies', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        const eou = service.getVoiceLiveTurnDetectionConfig().end_of_utterance_detection;

        expect('threshold_level' in eou).toBe(false);
    });

    it('forwards an explicitly configured threshold level', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = {
            semanticVad: { enabled: true, endOfUtterance: { enabled: true, thresholdLevel: 'high' } }
        };
        const eou = service.getVoiceLiveTurnDetectionConfig().end_of_utterance_detection;

        expect(eou.threshold_level).toBe('high');
    });

    it('pairs the multilingual EOU model with the multilingual VAD type', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = {
            semanticVad: {
                enabled: true,
                type: 'azure_semantic_vad_multilingual',
                endOfUtterance: { enabled: true }
            }
        };

        expect(service.getVoiceLiveTurnDetectionConfig().end_of_utterance_detection)
            .toEqual({ model: 'semantic_detection_v1_multilingual' });
    });

    it('omits EOU detection when it is explicitly disabled', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = {
            semanticVad: { enabled: true, endOfUtterance: { enabled: false } }
        };

        expect(service.getVoiceLiveTurnDetectionConfig().end_of_utterance_detection).toBeUndefined();
    });

    // Deliberately above the service default of 500 so a mid-question pause survives.
    it('keeps the fallback silence timer patient enough for a mid-question pause', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        const turnDetection = service.getVoiceLiveTurnDetectionConfig();

        expect(turnDetection.silence_duration_ms).toBeGreaterThanOrEqual(500);
        expect(turnDetection.speech_duration_ms).toBe(80);
        expect(turnDetection.create_response).toBe(true);
    });

    // Filler words must not be read as the end of a question.
    it('removes filler words so "um" does not end the turn', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });

        expect(service.getVoiceLiveTurnDetectionConfig().remove_filler_words).toBe(true);
    });

    // Omitting a timer means the service default applies, which is not the same as sending 0.
    it('omits timers that are not configured as finite numbers', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.voiceLive = {
            semanticVad: { enabled: true, silenceDurationMs: null, speechDurationMs: undefined }
        };
        const turnDetection = service.getVoiceLiveTurnDetectionConfig();

        expect('silence_duration_ms' in turnDetection).toBe(false);
        expect('speech_duration_ms' in turnDetection).toBe(false);
    });

    // The utterance tail cannot be detected on audio that is still sitting in the client buffer.
    it('keeps client-side audio buffering well under the turn-end timer', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });

        expect(service.chunkFlushIntervalMs).toBeLessThanOrEqual(60);
        expect(service.minAudioChunkBytes).toBeLessThanOrEqual(1920);
    });
});

// The model only requests a lookup when it does not know; denying that trades slow-and-right
// for fast-and-wrong, which is how "Agent365 is not a Microsoft product" happens.
describe('Server-side MCP approval', () => {
    let originalLocalStorage;

    function gatedService() {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.send = vi.fn(() => true);
        return service;
    }

    function approvalsFrom(service) {
        return service.send.mock.calls
            .filter(([msg]) => msg?.item?.type === 'mcp_approval_response')
            .map(([msg]) => msg.item.approve);
    }

    function requestLookup(service, id) {
        service.handleMCPApprovalRequest({ id, server_label: 'microsoftLearn', name: 'search' });
    }

    beforeEach(() => {
        originalLocalStorage = global.localStorage;
        global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
    });

    afterEach(() => {
        global.localStorage = originalLocalStorage;
        vi.restoreAllMocks();
    });

    // Approval costs a client round-trip and an extra turn; inline lookup is what keeps answers grounded.
    it('lets Azure run the lookup inline by default', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        const learn = service.getVoiceLiveNativeMCPTools().find(t => t.server_label === 'microsoftLearn');

        expect(learn.require_approval).toBe('never');
    });

    it('honours an explicit opt-in to approval gating', () => {
        const service = createService('gpt-5-nano', { voiceProvider: 'voice-live' });
        service.azureRealtimeSettings.mcp = {
            microsoftLearn: { enabled: true, requireApproval: 'always' }
        };
        const learn = service.getVoiceLiveNativeMCPTools().find(t => t.server_label === 'microsoftLearn');

        expect(learn.require_approval).toBe('always');
    });

    // Grounding beats latency: a denied lookup produces a confident wrong answer.
    it('approves a lookup the model asked for, with no trigger phrase needed', () => {
        const service = gatedService();
        requestLookup(service, 'appr_1');

        expect(approvalsFrom(service)).toEqual([true]);
    });

    // Azure names the carrier event differently across API versions; any of them must work, once.
    it.each([
        'conversation.item.created',
        'conversation.item.added',
        'conversation.item.done',
        'response.output_item.added',
        'response.output_item.done'
    ])('answers an approval request delivered via %s', eventType => {
        const service = gatedService();
        service.handleWebSocketMessage({
            type: eventType,
            item: { id: 'appr_1', type: 'mcp_approval_request', server_label: 'microsoftLearn', name: 'search' }
        });

        expect(approvalsFrom(service)).toEqual([true]);
    });

    it('answers a repeated approval request only once', () => {
        const service = gatedService();
        const item = { id: 'appr_1', type: 'mcp_approval_request', server_label: 'microsoftLearn', name: 'search' };
        service.handleWebSocketMessage({ type: 'response.output_item.added', item });
        service.handleWebSocketMessage({ type: 'response.output_item.done', item });

        expect(approvalsFrom(service)).toEqual([true]);
    });

    // The response that raised the request ends with it; without a restart the lookup never runs.
    it('restarts the turn after approving so the lookup actually runs', () => {
        const service = gatedService();
        service.handleWebSocketMessage({
            type: 'response.output_item.done',
            item: { id: 'appr_1', type: 'mcp_approval_request', server_label: 'microsoftLearn', name: 'search' }
        });
        service.handleWebSocketMessage({ type: 'response.done', response: { status: 'completed' } });

        expect(service.send.mock.calls.some(([msg]) => msg?.type === 'response.create')).toBe(true);
    });

    it('caps runaway tool chains within a single turn', () => {
        const service = gatedService();
        requestLookup(service, 'appr_1');
        requestLookup(service, 'appr_2');
        requestLookup(service, 'appr_3');

        expect(approvalsFrom(service)).toEqual([true, true, false]);
    });

    it('resets the cap when the user starts a new turn', () => {
        const service = gatedService();
        requestLookup(service, 'appr_1');
        requestLookup(service, 'appr_2');
        service.handleWebSocketMessage({ type: 'input_audio_buffer.speech_started' });
        requestLookup(service, 'appr_3');

        expect(approvalsFrom(service)).toEqual([true, true, true]);
    });

    it('lifts the cap entirely when gating is disabled', () => {
        const service = gatedService();
        service.azureRealtimeSettings.mcp = { gating: { enabled: false } };
        requestLookup(service, 'appr_1');
        requestLookup(service, 'appr_2');
        requestLookup(service, 'appr_3');

        expect(approvalsFrom(service)).toEqual([true, true, true]);
    });

    // An unanswered approval request hangs the turn, so a malformed config must still respond.
    it('fails open so a broken config cannot silently strip grounding', () => {
        const service = gatedService();
        Object.defineProperty(service, 'azureRealtimeSettings', {
            get() { throw new Error('config exploded'); }
        });
        requestLookup(service, 'appr_1');

        expect(approvalsFrom(service)).toEqual([true]);
    });

    it('does not send a response when the request has no id', () => {
        const service = gatedService();
        service.handleMCPApprovalRequest({ server_label: 'microsoftLearn', name: 'search' });

        expect(approvalsFrom(service)).toEqual([]);
    });
});

// A model that does not recognise a name must not conclude the name is fictional.
describe('Grounding instructions', () => {
    it('forbids asserting that an unrecognised product does not exist', () => {
        const { TALKING_POINT_PROMPT } = require('../utils/talkingPointPrompt.js');

        expect(TALKING_POINT_PROMPT).toMatch(/does not exist/i);
        expect(TALKING_POINT_PROMPT).toMatch(/cutoff/i);
    });
});

// The connect path gates audio: anything awaited here is paid for by the user's first utterance.
describe('MCP warm-up', () => {
    let originalLocalStorage;

    function registryService() {
        const service = createService('gpt-4.1', { voiceProvider: 'azure-realtime' });
        service.send = vi.fn(() => true);
        service.mcpRegistry = {
            reset: vi.fn(),
            registerServer: vi.fn(),
            connectAll: vi.fn(async () => []),
            getTools: vi.fn(() => [{ type: 'function', name: 'microsoft_docs_search' }]),
            resolveTool: vi.fn(() => ({ serverId: 'microsoftLearn', originalToolName: 'microsoft_docs_search' }))
        };
        return service;
    }

    beforeEach(() => {
        originalLocalStorage = global.localStorage;
        global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
    });

    afterEach(() => {
        global.localStorage = originalLocalStorage;
        vi.restoreAllMocks();
    });

    it('does not touch the network while assembling the initial session', async () => {
        const service = registryService();

        await service.getAzureToolsAsync(true);

        expect(service.mcpRegistry.connectAll).not.toHaveBeenCalled();
        expect(service.mcpRegistry.registerServer).toHaveBeenCalled();
    });

    it('attaches the tools with a follow-up session.update once MCP is ready', async () => {
        const service = registryService();
        service.lastSessionConfig = { type: 'session.update', session: { tools: [] } };

        await service.warmUpMCPTools();

        expect(service.lastSessionConfig.session.tools).toHaveLength(1);
        expect(service.send).toHaveBeenCalledWith(service.lastSessionConfig);
    });

    it('attaches the tools only once', async () => {
        const service = registryService();
        service.lastSessionConfig = { type: 'session.update', session: { tools: [] } };

        await service.warmUpMCPTools();
        await service.warmUpMCPTools();

        expect(service.lastSessionConfig.session.tools).toHaveLength(1);
    });

    it('leaves the live session alone when warm-up fails', async () => {
        const service = registryService();
        service.lastSessionConfig = { type: 'session.update', session: { tools: [] } };
        service.mcpRegistry.connectAll = vi.fn(async () => { throw new Error('offline'); });

        await service.warmUpMCPTools();

        expect(service.lastSessionConfig.session.tools).toEqual([]);
        expect(service.send).not.toHaveBeenCalled();
    });

    // Voice Live declares its servers inline, so there is no client handshake to defer.
    it('skips warm-up on the Voice Live path', async () => {
        const service = registryService();
        service.voiceProvider = 'voice-live';

        await service.warmUpMCPTools();

        expect(service.mcpRegistry.connectAll).not.toHaveBeenCalled();
    });
});

// Microsoft Learn is documented at 3-60s; the old shared 2s budget timed out every lookup.
describe('MCP tool timeout budget', () => {
    function serviceForServer(serverId) {
        const service = createService('gpt-4.1', { voiceProvider: 'azure-realtime' });
        service.mcpRegistry = { resolveTool: () => ({ serverId, originalToolName: 'x' }) };
        return service;
    }

    it('uses each server\'s own budget', () => {
        const service = serviceForServer('microsoftLearn');
        service.azureRealtimeSettings.mcp = {
            microsoftLearn: { timeoutMs: 9000 },
            webiq: { timeoutMs: 1000 }
        };

        expect(service.getMCPToolTimeout('microsoft_docs_search')).toBe(9000);
    });

    it('falls back to a budget Microsoft Learn can actually meet', () => {
        const service = serviceForServer('microsoftLearn');
        service.azureRealtimeSettings.mcp = {};

        expect(service.getMCPToolTimeout('microsoft_docs_search')).toBe(8000);
    });

    it('does not borrow another server\'s budget for an unknown tool', () => {
        const service = createService('gpt-4.1', { voiceProvider: 'azure-realtime' });
        service.mcpRegistry = { resolveTool: () => null };
        service.azureRealtimeSettings.mcp = { webiq: { timeoutMs: 1000 } };

        expect(service.getMCPToolTimeout('mystery_tool')).toBe(8000);
    });
});

// A stale on-disk value silently defeats any change to a shipped default; this makes it visible.
describe('Settings drift detection', () => {    const { collectSettingsDrift } = require('../config/azureRealtimeSettings.js');

    it('reports nested values that differ from the shipped default', () => {
        const shipped = { sampleRate: 24000, voiceLive: { temperature: null, transcriptionModel: 'azure-speech' } };
        const effective = { sampleRate: 24000, voiceLive: { temperature: 0.6, transcriptionModel: 'azure-speech' } };

        expect(collectSettingsDrift(shipped, effective)).toEqual([
            { key: 'voiceLive.temperature', live: 0.6, shipped: null }
        ]);
    });

    it('compares arrays by value rather than identity', () => {
        const shipped = { voiceLive: { texts: ['One moment.'] } };

        expect(collectSettingsDrift(shipped, { voiceLive: { texts: ['One moment.'] } })).toEqual([]);
        expect(collectSettingsDrift(shipped, { voiceLive: { texts: ['Hold on.'] } })).toEqual([
            { key: 'voiceLive.texts', live: ['Hold on.'], shipped: ['One moment.'] }
        ]);
    });

    it('ignores comment keys and keys absent from the shipped defaults', () => {
        const shipped = { sampleRate: 24000 };
        const effective = { sampleRate: 24000, _comment: ['note'], legacyKey: 'stale' };

        expect(collectSettingsDrift(shipped, effective)).toEqual([]);
    });

    it('reports nothing when the effective config matches the defaults', () => {
        const { DEFAULT_SETTINGS } = require('../config/azureRealtimeSettings.js');

        expect(collectSettingsDrift(DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toEqual([]);
    });

    // The warning prints values, so a configured API key must never reach the console.
    it('never prints a secret value in the drift warning', () => {
        const { loadAzureRealtimeSettings } = require('../config/azureRealtimeSettings.js');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        loadAzureRealtimeSettings();

        const printed = warn.mock.calls.flat().join('\n');
        expect(printed).not.toMatch(/apiKey: live="\w/);
        warn.mockRestore();
    });
});
