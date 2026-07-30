const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR_NAME = 'sound-board-config';
const SETTINGS_FILENAME = 'azure-realtime-settings.json';

function stripCommentKeys(value) {
    if (Array.isArray(value)) {
        return value.map(stripCommentKeys);
    }

    if (value && typeof value === 'object') {
        const result = {};
        for (const [key, entry] of Object.entries(value)) {
            if (key.startsWith('_')) {
                continue;
            }
            result[key] = stripCommentKeys(entry);
        }
        return result;
    }

    return value;
}

const DEFAULT_TEMPLATE = {
    _comment: [
        'Azure Realtime streaming settings.',
        'Edit the values below to fine-tune microphone handling, buffering, and server VAD.',
        'Restart the application after making changes so the new values are applied.'
    ],
    debug: false,
    sampleRate: 24000,
    auth: {
        _comment: [
            'Entra ID (keyless) authentication settings.',
            'tenantId: set this when the Foundry resource lives in a DIFFERENT tenant than the one',
            '  your az login / azd login currently targets. Symptom of a mismatch is a 400 handshake',
            '  failure with "Token tenant <guid> does not match resource tenant".',
            'Leave blank to use the credential chain default. Env AZURE_TENANT_ID is used when blank.'
        ],
        tenantId: ''
    },
    streaming: {
        _comment: [
            'How frequently audio chunks are flushed to Azure (in bytes/ms).',
            'This is a direct tax on turn-end latency: the tail of an utterance sits in this buffer,',
            'and the server cannot detect end-of-speech on audio it has not received yet.',
            'Flush happens on whichever comes first - the interval or the byte count.',
            'minChunkBytes 1920 = 40ms at 24kHz 16-bit mono.'
        ],
        minChunkBytes: 1920,
        chunkFlushIntervalMs: 60
    },
    silenceGate: {
        _comment: 'Client-side silence detection before audio is sent to Azure.',
        enabled: true,
        rmsThreshold: 0.008,
        floor: 0.001,
        autoAdjust: true,
        warmupDrops: 3
    },
    commits: {
        _comment: [
            'Client-side commit controls (only used when server VAD is disabled).',
            'When serverVad.enabled is true, the server automatically commits audio.',
            'Manual commits are NOT needed and will cause buffer size errors.'
        ],
        minCommitMs: 100,
        minCommitBytes: null,
        padSilence: true,
        tailSilenceMs: 120
    },
    serverVad: {
        _comment: [
            'Server-side Voice Activity Detection settings.',
            'When enabled, server detects speech start/stop and auto-commits audio.',
            'Supported types: server_vad (silence), semantic_vad (utterance-based)',
            'createResponse: true = auto-generate response, false = manual control',
            'semantic_vad + eagerness=low is recommended for interview/sales calls to reduce interruptions.'
        ],
        enabled: true,
        type: 'semantic_vad',
        threshold: 0.5,
        prefixPaddingMs: 300,
        silenceDurationMs: 500,
        createResponse: true,
        interruptResponse: true,
        eagerness: 'low'
    },
    pauseButton: {
        _comment: [
            'Pause button feature settings (Step 0).',
            'Allows user to pause audio transmission and process captured audio.',
            'Only available when using Azure provider.'
        ],
        forceCommitOnPause: true,
        autoResumeAfterResponse: false,
        showInUI: true
    },
    model: {
        _comment: [
            'Model parameters for response generation.',
            'temperature: Controls randomness (0.0-2.0). Lower = more focused/deterministic.',
            '  - Recommended for grounded conversations: 0.6-0.8 (balanced, not too creative)',
            '  - For factual/precise responses: 0.3-0.5',
            '  - For creative tasks: 0.9-1.2',
            'max_response_output_tokens: Max tokens in model response (null = default 4096)',
            'max_input_tokens: Max tokens in conversation history (null = unlimited)'
        ],
        temperature: 0.6,
        max_response_output_tokens: 4096,
        max_input_tokens: null
    },
    voiceProvider: 'azure-realtime',
    voiceLive: {
        _comment: [
            'Optional Voice Live WebSocket mode. Supported values use WebSocket only; WebRTC remains deprecated.',
            'Enable by setting voiceProvider to voice-live here or choosing Voice Live in the Azure advanced UI.',
            'apiVersion: Voice Live API version used in the WebSocket URL.',
            'outputModalities: ["text"] for fastest response (no TTS). ["text","audio"] for voice output.',
            'maxResponseOutputTokens: cap output tokens for speed (default 200). Set "inf" for unlimited.',
            'temperature: null omits the field so the model default applies. REQUIRED for gpt-5-nano and',
            '  other models that reject any value except the default — sending one fails EVERY response.',
            'transcriptionModel: primary transcription model for non-multimodal models (azure-speech default, mai-transcribe is preview).',
            'realtimeTranscriptionFallback: used only for gpt-realtime/gpt-realtime-mini, which cannot use azure-speech.',
            'modelAssistedSummary: enable model-assisted summarization of transcripts.',
            'interimResponse: spoken filler that bridges dead air. CASCADED MODELS ONLY — not supported by realtime audio models.',
            'agent: optional Foundry Agent mode config for server-managed memory/context.'
        ],
        apiVersion: '2026-04-10',
        voice: {
            name: 'en-US-Ava:DragonHDLatestNeural',
            type: 'azure-standard',
            temperature: 0.8
        },
        semanticVad: {
            _comment: [
                'type: azure_semantic_vad is English-focused; azure_semantic_vad_multilingual covers',
                '  en, es, fr, it, de, ja, pt, zh, ko, hi. This app pins output to English (auth.* / language),',
                '  so the multilingual variant is pure overhead. Switch it back only if you accept non-English input.',
                'Both types accept the languages[] hint, which is set from the session language.',
                'silenceDurationMs is the FALLBACK turn-end timer (service default 500). Set ABOVE the',
                '  default on purpose: a mid-question thinking pause runs 300-800ms, and endOfUtterance',
                '  below is what keeps this from costing latency on turns that are genuinely finished.',
                'speechDurationMs is the minimum speech length before a turn starts (service default 80).',
                'removeFillerWords stops "um"/"uh" from ending a turn - keep it on for question capture.'
            ],
            enabled: true,
            type: 'azure_semantic_vad',
            removeFillerWords: true,
            interruptResponse: true,
            autoTruncate: true,
            createResponse: true,
            silenceDurationMs: 600,
            speechDurationMs: 80,
            endOfUtterance: {
                _comment: [
                    'Semantic end-of-utterance detection. Without it the turn ends ONLY on the silence timer,',
                    'so every natural mid-question pause either cuts the user off or costs the full timer.',
                    'MS Learn: "significantly reduce premature end-of-turn signals without adding',
                    '  user-perceivable latency". This is what buys speed WITHOUT truncating questions.',
                    'thresholdLevel: DELIBERATELY BLANK -> service default (medium).',
                    '  The docs are self-contradictory on direction: the `threshold` field says "a higher',
                    '  threshold requires a higher confidence signal", but `threshold_level` says "with a',
                    '  lower setting the probability the sentence is complete will be higher".',
                    '  Do not guess. To tune, change ONE step and listen for truncated questions:',
                    '  if questions get cut off, try the opposite end from whichever you tried first.',
                    'timeoutMs caps how long the detector may deliberate before the silence timer takes over.',
                    'https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-api-reference-2026-04-10'
                ],
                enabled: true,
                thresholdLevel: '',
                timeoutMs: 1200
            }
        },
        noiseSuppression: true,
        echoCancellation: true,
        outputModalities: ['text', 'audio'],
        maxResponseOutputTokens: 200,
        temperature: null,
        transcriptionModel: 'azure-speech',
        realtimeTranscriptionFallback: 'gpt-4o-mini-transcribe',
        modelAssistedSummary: true,
        interimResponse: {
            _comment: [
                'Bridges wait time with short spoken filler so the user does not hear silence.',
                'Attacks PERCEIVED latency, which is what matters for live meeting assistance.',
                'HARD CONSTRAINT (MS Learn): model mode supports interim responses only with text LLMs',
                'in cascaded mode plus azure-speech voice output. Realtime audio models do NOT support it.',
                'mode: static (no extra inference cost, deterministic) or llm (context-aware, costs tokens).',
                'triggers: latency (response slower than threshold) and/or tool (tool call running).',
                'https://learn.microsoft.com/azure/ai-services/speech-service/how-to-voice-live-interim-response'
            ],
            enabled: true,
            mode: 'static',
            triggers: ['tool', 'latency'],
            latencyThresholdMs: 600,
            texts: [
                'One moment.',
                'Let me pull that up.',
                'Checking on that now.'
            ],
            model: 'gpt-4.1-mini',
            instructions: 'Produce a very short, natural filler acknowledging a brief wait. Do not answer the question.',
            maxCompletionTokens: 50
        },
        agent: {
            _comment: 'Foundry Agent mode: provides server-managed conversation memory via conversation_id.',
            enabled: false,
            agentName: '',
            projectName: '',
            agentVersion: null,
            conversationId: null,
            foundryResourceOverride: null
        }
    },
    mcp: {
        _comment: [
            'Remote MCP servers exposed as tools to the Azure Realtime session.',
            'WebIQ requires an API key via the x-apikey header.',
            'Set the key via env WEBIQ_API_KEY (preferred) or apiKey below.',
            'On the Voice Live path these are SERVER-side MCP (type: mcp): Azure calls the endpoint',
            '  itself, inline in the turn. The client never sees the HTTP request, so the 2s timeout',
            '  used for client-side tools does NOT apply. MS Learn measures these at 3-60+ seconds.',
            'requireApproval defaults to "never" so Azure runs the lookup inline. Setting it to',
            '  "always" adds a client round-trip per call and costs an extra turn; use it only when',
            '  you need the maxCallsPerTurn cap below, and expect slower answers.',
            'timeoutMs applies to the CLIENT-side path only (voiceProvider azure-realtime). Learn is',
            '  documented at 3-60s, so a short budget here just converts every lookup into a timeout.'
        ],
        // The model only requests a lookup when it does NOT know; denying those turns is backwards.
        gating: {
            _comment: [
                'Loop guard for server-side MCP calls, applied only when requireApproval is "always".',
                'Approval is granted by default: a tool request IS the signal that the answer is not',
                'in the model\'s training data, so denying it produces a confident wrong answer',
                'instead of a grounded one.',
                'maxCallsPerTurn caps runaway tool chains, which is where the multi-second turns come',
                'from - a single lookup is usually fine, three in a row is not.',
                'The counter resets when the user starts a new turn.'
            ],
            enabled: true,
            maxCallsPerTurn: 2
        },
        microsoftLearn: {
            enabled: true,
            requireApproval: 'never',
            url: 'https://learn.microsoft.com/api/mcp',
            timeoutMs: 8000
        },
        webiq: {
            enabled: true,
            requireApproval: 'never',
            url: 'https://api.microsoft.ai/v3/mcp',
            apiKey: '',
            apiKeyEnv: 'WEBIQ_API_KEY',
            toolPrefix: 'webiq',
            allowedTools: ['web', 'browse', 'news'],
            timeoutMs: 8000
        }
    },
    vision: {
        _comment: [
            'Vision/screenshot analysis settings for Azure OpenAI.',
            'Uses Chat Completions API with GPT-4.1 or similar vision-capable model.',
            'Separate from realtime voice deployment.',
            'detailLevel: low (faster, less detail), high (slower, more detail), auto (balanced)'
        ],
        enabled: true,
        deployment: 'gpt-4.1',
        detailLevel: 'auto',
        maxTokens: 1000,
        systemPrompt: 'You are analyzing a screenshot. Provide clear, concise insights about what you see.'
    }
};

const DEFAULT_SETTINGS = stripCommentKeys(DEFAULT_TEMPLATE);

function deepMerge(base, override) {
    if (Array.isArray(base) || Array.isArray(override)) {
        return override ?? base;
    }

    if (base && typeof base === 'object') {
        const merged = { ...base };
        if (override && typeof override === 'object') {
            for (const [key, value] of Object.entries(override)) {
                if (value === undefined) {
                    continue;
                }
                if (merged[key] && typeof merged[key] === 'object' && !Array.isArray(merged[key])) {
                    merged[key] = deepMerge(merged[key], value);
                } else {
                    merged[key] = value;
                }
            }
        }
        return merged;
    }

    return override ?? base;
}

function applyValuesToTemplate(template, values) {
    if (Array.isArray(template)) {
        return template.slice();
    }

    const result = {};
    for (const [key, templateValue] of Object.entries(template)) {
        if (key.startsWith('_')) {
            result[key] = templateValue;
            continue;
        }

        const value = values?.[key];
        if (templateValue && typeof templateValue === 'object' && !Array.isArray(templateValue)) {
            result[key] = applyValuesToTemplate(templateValue, value ?? {});
        } else {
            result[key] = value !== undefined ? value : templateValue;
        }
    }
    return result;
}

function getConfigDir() {
    const platform = os.platform();
    if (platform === 'win32') {
        return path.join(os.homedir(), 'AppData', 'Roaming', CONFIG_DIR_NAME);
    }
    if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', CONFIG_DIR_NAME);
    }
    return path.join(os.homedir(), '.config', CONFIG_DIR_NAME);
}

function ensureConfigDir() {
    const configDir = getConfigDir();
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    return configDir;
}

function getSettingsFilePath() {
    return path.join(getConfigDir(), SETTINGS_FILENAME);
}

function ensureSettingsFileExists() {
    const settingsPath = getSettingsFilePath();
    if (!fs.existsSync(settingsPath)) {
        ensureConfigDir();
        const template = JSON.stringify(DEFAULT_TEMPLATE, null, 2);
        fs.writeFileSync(settingsPath, template, 'utf8');
    }
}

function readSettingsFromFile() {
    const settingsPath = getSettingsFilePath();
    if (!fs.existsSync(settingsPath)) {
        return {};
    }

    try {
        const raw = fs.readFileSync(settingsPath, 'utf8');
        const parsed = JSON.parse(raw);
        return stripCommentKeys(parsed);
    } catch (error) {
        console.warn('[AzureRealtimeSettings] Failed to parse settings file, using defaults:', error.message);
        return {};
    }
}

function maybeUpdateSettingsFile(currentValues) {
    const templateWithValues = applyValuesToTemplate(DEFAULT_TEMPLATE, currentValues);
    const targetContent = JSON.stringify(templateWithValues, null, 2);
    const settingsPath = getSettingsFilePath();

    try {
        const existing = fs.readFileSync(settingsPath, 'utf8');
        if (existing === targetContent) {
            return;
        }
    } catch (error) {
        // Ignore and rewrite below.
    }

    try {
        fs.writeFileSync(settingsPath, targetContent, 'utf8');
    } catch (error) {
        console.warn('[AzureRealtimeSettings] Unable to update settings file:', error.message);
    }
}

function normalizeBoolean(value, fallback) {
    if (value === undefined || value === null) {
        return fallback;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) {
            return true;
        }
        if (['0', 'false', 'no', 'off'].includes(normalized)) {
            return false;
        }
    }
    return fallback;
}

function normalizeNumber(value, fallback) {
    if (value === undefined || value === null) {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function applyEnvOverrides(settings) {
    const overrides = { ...settings };

    overrides.debug = normalizeBoolean(process.env.AZURE_REALTIME_DEBUG, overrides.debug);

    overrides.sampleRate = normalizeNumber(process.env.AZURE_REALTIME_SAMPLE_RATE, overrides.sampleRate);

    overrides.streaming = {
        ...overrides.streaming,
        minChunkBytes: normalizeNumber(process.env.AZURE_REALTIME_MIN_CHUNK_BYTES, overrides.streaming.minChunkBytes),
        chunkFlushIntervalMs: normalizeNumber(process.env.AZURE_REALTIME_CHUNK_FLUSH_INTERVAL_MS, overrides.streaming.chunkFlushIntervalMs)
    };

    const disableGateEnv = process.env.AZURE_REALTIME_DISABLE_SILENCE_GATE;
    const silenceGateEnabled = disableGateEnv === '1'
        ? false
        : disableGateEnv === '0'
            ? true
            : overrides.silenceGate.enabled;

    overrides.silenceGate = {
        ...overrides.silenceGate,
        enabled: silenceGateEnabled,
        rmsThreshold: normalizeNumber(process.env.AZURE_REALTIME_SILENCE_RMS, overrides.silenceGate.rmsThreshold),
        floor: normalizeNumber(process.env.AZURE_REALTIME_SILENCE_RMS_FLOOR, overrides.silenceGate.floor),
        autoAdjust: normalizeBoolean(process.env.AZURE_REALTIME_SILENCE_AUTO_ADJUST, overrides.silenceGate.autoAdjust),
        warmupDrops: normalizeNumber(process.env.AZURE_REALTIME_SILENCE_WARMUP_DROPS, overrides.silenceGate.warmupDrops)
    };

    overrides.commits = {
        ...overrides.commits,
        minCommitMs: normalizeNumber(process.env.AZURE_REALTIME_MIN_COMMIT_MS, overrides.commits.minCommitMs),
        minCommitBytes: normalizeNumber(process.env.AZURE_REALTIME_MIN_COMMIT_BYTES, overrides.commits.minCommitBytes ?? undefined),
        padSilence: normalizeBoolean(process.env.AZURE_REALTIME_COMMIT_PAD_SILENCE, overrides.commits.padSilence),
        tailSilenceMs: normalizeNumber(process.env.AZURE_REALTIME_COMMIT_TAIL_SILENCE_MS, overrides.commits.tailSilenceMs)
    };

    overrides.serverVad = {
        ...overrides.serverVad,
        threshold: normalizeNumber(process.env.AZURE_REALTIME_VAD_THRESHOLD, overrides.serverVad.threshold),
        prefixPaddingMs: normalizeNumber(process.env.AZURE_REALTIME_VAD_PREFIX_PADDING_MS, overrides.serverVad.prefixPaddingMs),
        silenceDurationMs: normalizeNumber(process.env.AZURE_REALTIME_VAD_SILENCE_MS, overrides.serverVad.silenceDurationMs),
        createResponse: normalizeBoolean(process.env.AZURE_REALTIME_VAD_CREATE_RESPONSE, overrides.serverVad.createResponse),
        interruptResponse: normalizeBoolean(process.env.AZURE_REALTIME_VAD_INTERRUPT_RESPONSE, overrides.serverVad.interruptResponse),
        eagerness: process.env.AZURE_REALTIME_VAD_EAGERNESS || overrides.serverVad.eagerness
    };

    const configuredProvider = process.env.AZURE_VOICE_PROVIDER || overrides.voiceProvider;
    overrides.voiceProvider = ['azure-realtime', 'voice-live'].includes(configuredProvider)
        ? configuredProvider
        : 'azure-realtime';

    if (process.env.AZURE_VOICELIVE_TRANSCRIPTION_MODEL) {
        overrides.voiceLive = {
            ...overrides.voiceLive,
            transcriptionModel: process.env.AZURE_VOICELIVE_TRANSCRIPTION_MODEL
        };
    }

    if (process.env.AZURE_VOICELIVE_OUTPUT_MODALITIES) {
        overrides.voiceLive = {
            ...(overrides.voiceLive || {}),
            outputModalities: process.env.AZURE_VOICELIVE_OUTPUT_MODALITIES.split(',').map((s) => s.trim()).filter(Boolean)
        };
    }

    overrides.mcp = {
        ...overrides.mcp,
        microsoftLearn: {
            ...overrides.mcp.microsoftLearn
        },
        webiq: {
            ...overrides.mcp.webiq
        }
    };

    const webiqApiKeyEnv = overrides.mcp.webiq.apiKeyEnv || 'WEBIQ_API_KEY';
    const webiqEnvKey = process.env[webiqApiKeyEnv];
    const webiqSettingsKey = overrides.mcp.webiq.apiKey;
    overrides.mcp.webiq._resolvedKey = (webiqEnvKey || webiqSettingsKey || '').trim();

    return overrides;
}

function getMergedFileSettings() {
    ensureSettingsFileExists();
    const fileSettings = readSettingsFromFile();
    return deepMerge(DEFAULT_SETTINGS, fileSettings);
}

function getStoredWebIQApiKey() {
    const mergedSettings = getMergedFileSettings();
    const webiqApiKey = mergedSettings?.mcp?.webiq?.apiKey;
    return typeof webiqApiKey === 'string' ? webiqApiKey.trim() : '';
}

function setStoredWebIQApiKey(apiKey) {
    const mergedSettings = getMergedFileSettings();
    if (!mergedSettings.mcp || typeof mergedSettings.mcp !== 'object') {
        mergedSettings.mcp = {};
    }
    if (!mergedSettings.mcp.webiq || typeof mergedSettings.mcp.webiq !== 'object') {
        mergedSettings.mcp.webiq = {};
    }

    mergedSettings.mcp.webiq.apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    maybeUpdateSettingsFile(mergedSettings);
    return mergedSettings.mcp.webiq.apiKey;
}

let _driftReported = false;

// Computed at load time and then persisted, so they always differ from the shipped placeholder.
const DERIVED_SETTING_KEYS = new Set(['commits.minCommitBytes']);

// The drift warning prints values, so anything secret-shaped must never reach the console.
const SECRET_KEY_PATTERN = /key|secret|token|password|credential|authorization/i;

function describeDriftValue(keyPath, value) {
    if (!SECRET_KEY_PATTERN.test(keyPath)) {
        return JSON.stringify(value);
    }
    if (value === '' || value === null || value === undefined) {
        return '(empty)';
    }
    return `(set, ${String(value).length} chars)`;
}

/**
 * Values in the user's settings file win over DEFAULT_TEMPLATE, so a stale entry silently
 * defeats any change to a shipped default. Surface the differences instead.
 *
 * @returns {Array<{ key: string, live: unknown, shipped: unknown }>}
 */
function collectSettingsDrift(shipped, effective, prefix = '') {
    const drift = [];
    if (!effective || typeof effective !== 'object' || Array.isArray(effective)) {
        return drift;
    }

    for (const [key, liveValue] of Object.entries(effective)) {
        if (key.startsWith('_') || !shipped || !(key in shipped)) {
            continue;
        }
        const shippedValue = shipped[key];
        const bothObjects = shippedValue && typeof shippedValue === 'object' && !Array.isArray(shippedValue)
            && liveValue && typeof liveValue === 'object' && !Array.isArray(liveValue);

        const path = `${prefix}${key}`;
        if (bothObjects) {
            drift.push(...collectSettingsDrift(shippedValue, liveValue, `${path}.`));
        } else if (!DERIVED_SETTING_KEYS.has(path) && JSON.stringify(shippedValue) !== JSON.stringify(liveValue)) {
            drift.push({ key: path, live: liveValue, shipped: shippedValue });
        }
    }
    return drift;
}

function logSettingsDrift(effective) {
    if (_driftReported) {
        return;
    }
    _driftReported = true;

    const drift = collectSettingsDrift(DEFAULT_SETTINGS, effective);
    if (drift.length === 0) {
        return;
    }

    console.warn(
        `[AzureRealtimeSettings] ${drift.length} setting(s) override the shipped defaults ` +
        `(${getSettingsFilePath()}). Delete a line there to pick up the default:`
    );
    for (const entry of drift) {
        console.warn(
            `  ${entry.key}: live=${describeDriftValue(entry.key, entry.live)} ` +
            `shipped=${describeDriftValue(entry.key, entry.shipped)}`
        );
    }
}

function loadAzureRealtimeSettings() {
    const merged = getMergedFileSettings();
    maybeUpdateSettingsFile(merged);
    const withEnvOverrides = applyEnvOverrides(merged);

    // Derive minCommitBytes when not provided
    if (!withEnvOverrides.commits.minCommitBytes || withEnvOverrides.commits.minCommitBytes <= 0) {
        const samplesPerMs = withEnvOverrides.sampleRate / 1000;
        const commitBytes = Math.max(1, Math.round(samplesPerMs * withEnvOverrides.commits.minCommitMs) * 2);
        withEnvOverrides.commits.minCommitBytes = commitBytes;
    }

    // Enforce Azure's minimum temperature requirement (0.6)
    if (withEnvOverrides.model && withEnvOverrides.model.temperature < 0.6) {
        console.warn('[AzureRealtimeSettings] Temperature below Azure minimum (0.6), adjusting from', withEnvOverrides.model.temperature, 'to 0.6');
        withEnvOverrides.model.temperature = 0.6;
    }

    logSettingsDrift(withEnvOverrides);

    return withEnvOverrides;
}

module.exports = {
    loadAzureRealtimeSettings,
    collectSettingsDrift,
    DEFAULT_SETTINGS,
    getStoredWebIQApiKey,
    setStoredWebIQApiKey
};
