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
    sampleRate: 16000,
    streaming: {
        _comment: 'How frequently audio chunks are flushed to Azure (in bytes/ms).',
        minChunkBytes: 4800,
        chunkFlushIntervalMs: 200
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
        _comment: 'Controls how and when audio commits are issued to Azure.',
        minCommitMs: 100,
        minCommitBytes: null,
        padSilence: true
    },
    serverVad: {
        _comment: 'Server VAD parameters used when turn detection is enabled.',
        threshold: 0.5,
        prefixPaddingMs: 300,
        silenceDurationMs: 200,
        createResponse: true
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
        padSilence: normalizeBoolean(process.env.AZURE_REALTIME_COMMIT_PAD_SILENCE, overrides.commits.padSilence)
    };

    overrides.serverVad = {
        ...overrides.serverVad,
        threshold: normalizeNumber(process.env.AZURE_REALTIME_VAD_THRESHOLD, overrides.serverVad.threshold),
        prefixPaddingMs: normalizeNumber(process.env.AZURE_REALTIME_VAD_PREFIX_PADDING_MS, overrides.serverVad.prefixPaddingMs),
        silenceDurationMs: normalizeNumber(process.env.AZURE_REALTIME_VAD_SILENCE_MS, overrides.serverVad.silenceDurationMs),
        createResponse: normalizeBoolean(process.env.AZURE_REALTIME_VAD_CREATE_RESPONSE, overrides.serverVad.createResponse)
    };

    return overrides;
}

function loadAzureRealtimeSettings() {
    ensureSettingsFileExists();
    const fileSettings = readSettingsFromFile();
    const merged = deepMerge(DEFAULT_SETTINGS, fileSettings);
    maybeUpdateSettingsFile(merged);
    const withEnvOverrides = applyEnvOverrides(merged);

    // Derive minCommitBytes when not provided
    if (!withEnvOverrides.commits.minCommitBytes || withEnvOverrides.commits.minCommitBytes <= 0) {
        const samplesPerMs = withEnvOverrides.sampleRate / 1000;
        const commitBytes = Math.max(1, Math.round(samplesPerMs * withEnvOverrides.commits.minCommitMs) * 2);
        withEnvOverrides.commits.minCommitBytes = commitBytes;
    }

    return withEnvOverrides;
}

module.exports = {
    loadAzureRealtimeSettings,
    DEFAULT_SETTINGS
};
