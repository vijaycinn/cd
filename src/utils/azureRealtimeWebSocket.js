const { LLMService } = require('./llm.js');
const { BrowserWindow, ipcMain } = require('electron');
const WebSocket = require('ws');
const { loadAzureRealtimeSettings } = require('../config/azureRealtimeSettings.js');

class AzureRealtimeWebSocketService extends LLMService {
    constructor(apiKey, endpoint, deployment, region, customPrompt, profile, language) {
        super(apiKey, customPrompt, profile, language);

        console.log('[AzureWebSocket] Initializing Azure OpenAI WebSocket Service (manual implementation)');

        // Extract hostname from endpoint URL for WebSocket URL construction
        let hostname = endpoint;
        if (endpoint.startsWith('http')) {
            try {
                const url = new URL(endpoint);
                hostname = url.hostname;
                console.log('[AzureWebSocket] Extracted hostname from endpoint:', hostname);
            } catch (error) {
                console.warn('[AzureWebSocket] Failed to parse endpoint URL, using as-is:', endpoint);
                hostname = endpoint.replace(/^https?:\/\//, '');
            }
        }

        const isServicesAiEndpoint = hostname.includes('.services.ai.azure.com');
        const isCognitiveServicesEndpoint = hostname.includes('.cognitiveservices.azure.com');

        const apiVersion = '2025-04-01-preview';
        let websocketHost = hostname;

        if (isCognitiveServicesEndpoint) {
            websocketHost = hostname.replace('.cognitiveservices.azure.com', '.openai.azure.com');
        }

        const websocketQuery = new URLSearchParams({
            'api-version': apiVersion
        });

        if (deployment) {
            websocketQuery.set('deployment', deployment);
        }

        this.websocketUrl = `wss://${websocketHost}/openai/realtime?${websocketQuery.toString()}`;

        if (!isServicesAiEndpoint && !websocketHost.endsWith('.openai.azure.com')) {
            console.warn('[AzureWebSocket] Endpoint host is not an Azure OpenAI domain:', hostname);
        }

        console.log('[AzureWebSocket] Manual WebSocket URL constructed (api key hidden)');

        this.deployment = deployment;
        this.region = region || null;
        this.customPrompt = customPrompt;
        this.language = language || 'en-US';
        this.apiKey = apiKey;

    this.azureRealtimeSettings = loadAzureRealtimeSettings();
    const streamingSettings = this.azureRealtimeSettings.streaming || {};
    const silenceSettings = this.azureRealtimeSettings.silenceGate || {};
    const commitSettings = this.azureRealtimeSettings.commits || {};

        this.isConnected = false;
        this.isInitialized = false;
        this.socket = null;
        this.textBuffer = '';
        this.lastPublishedLength = 0;
        this.lastLoggedLength = 0;
        this.minPublishChars = 32; // avoid flooding UI with tiny deltas
        this.responseDelivered = false;
        this.debugEnabled = !!this.azureRealtimeSettings.debug;
        this.minAudioChunkBytes = streamingSettings.minChunkBytes;
        this.speechActive = false; // Server VAD speech flag
        this.silenceLogPrefix = '[AzureWebSocket] Dropping near-silent audio chunk';

        this.silenceGateEnabled = silenceSettings.enabled;
        this.silenceRmsThreshold = silenceSettings.rmsThreshold;
        this.silenceSkipLogThrottleMs = 4000; // Reduce log spam when skipping silence
        this.lastSilenceLogTs = 0;
        this.metrics = {
            audioChunksQueued: 0,
            audioChunksSkipped: 0,
            audioFlushes: 0,
            audioBytesSent: 0,
            audioCommits: 0
        };

        this.silenceRmsFloor = silenceSettings.floor;
        if (this.silenceRmsThreshold < this.silenceRmsFloor) {
            this.silenceRmsThreshold = this.silenceRmsFloor;
        }
        this.autoSilenceAdjustmentEnabled = silenceSettings.autoAdjust;
        this.silenceGateWarmupDrops = silenceSettings.warmupDrops;
        this.consecutiveSilentDrops = 0;
        this.hasSentAudio = false;
    this.expectedSampleRate = this.azureRealtimeSettings.sampleRate || 16000;
    this.minCommitMs = commitSettings.minCommitMs;
    this.minCommitBytes = commitSettings.minCommitBytes;
    this.commitPaddingEnabled = commitSettings.padSilence;
    this.commitTailSilenceMs = commitSettings.tailSilenceMs ?? 0;
    this.commitTailSilenceBytes = Math.max(0, Math.round((this.expectedSampleRate / 1000) * this.commitTailSilenceMs) * 2);
        this.bytesSinceLastCommit = 0;

        this.pendingChunkAccumulator = [];
        this.pendingChunkBytes = 0;
        this.pendingAudioForCommit = false;
        this.chunkFlushIntervalMs = streamingSettings.chunkFlushIntervalMs;
        this.lastChunkFlushTs = Date.now();
        this.flushTimer = null;

        // Event callbacks
        this.callbacks = {
            onMessage: null,
            onError: null,
            onComplete: null,
            onStatus: null,
            onTranscription: null,
            onAudio: null
        };

        this.debugLog = (...args) => {
            if (this.debugEnabled) {
                console.log(...args);
            }
        };
    }

    getTurnDetectionConfig() {
        const serverVad = this.azureRealtimeSettings.serverVad;
        return {
            type: 'server_vad',
            create_response: serverVad.createResponse,
            threshold: serverVad.threshold,
            prefix_padding_ms: serverVad.prefixPaddingMs,
            silence_duration_ms: serverVad.silenceDurationMs
        };
    }

    async init() {
        console.log('[AzureWebSocket] Initializing Azure WebSocket Realtime service (manual implementation)');

        try {
            return new Promise((resolve, reject) => {
                this.debugLog('[AzureWebSocket] Creating manual WebSocket connection...');
                this.debugLog('[AzureWebSocket] WebSocket URL:', this.websocketUrl.replace(/api-key=[^&]*/, 'api-key=***'));

                this.socket = new WebSocket(this.websocketUrl, 'realtime', {
                    headers: {
                        'User-Agent': 'Azure-OpenAI-Node/1.0',
                        'api-key': this.apiKey
                    }
                });

                this.socket.on('open', () => {
                    console.log('[AzureWebSocket] WebSocket connection opened!');
                });

                this.socket.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        this.debugLog('[AzureWebSocket] Received WebSocket message:', message.type);
                        this.handleWebSocketMessage(message);
                    } catch (error) {
                        console.error('[AzureWebSocket] Error parsing WebSocket message:', error);
                    }
                });

                this.socket.on('error', (error) => {
                    console.error('[AzureWebSocket] WebSocket error:', error);
                    if (this.callbacks.onError) {
                        this.callbacks.onError(error);
                    }
                    if (!this.isInitialized) {
                        reject(error);
                    }
                });

                this.socket.on('close', (code, reason) => {
                    console.log(`[AzureWebSocket] WebSocket closed: code=${code}, reason=${reason.toString()}`);
                    this.isConnected = false;
                    this.isInitialized = false;
                    this.pendingChunkAccumulator = [];
                    this.pendingChunkBytes = 0;
                    this.clearFlushTimer();
                    this.lastChunkFlushTs = Date.now();
                    this.speechActive = false;
                    if (this.callbacks.onStatus) {
                        this.callbacks.onStatus('Disconnected');
                    }
                });

                // Give connection time to establish, then send session config
                setTimeout(() => {
                    if (this.socket.readyState === WebSocket.OPEN) {
                        this.debugLog('[AzureWebSocket] Sending initial session configuration...');
                        this.send({
                            type: "session.update",
                            session: {
                                model: this.deployment,
                                voice: "alloy",
                                instructions: this.customPrompt || "",
                                input_audio_format: "pcm16",
                                output_audio_format: "pcm16",
                                input_audio_transcription: {
                                    model: "whisper-1"
                                },
                                turn_detection: this.getTurnDetectionConfig(),
                                tools: [],
                                modalities: ["text", "audio"]
                            }
                        });

                        this.isInitialized = true;
                        this.isConnected = true;
                        console.log('[AzureWebSocket] Azure WebSocket Realtime service initialized successfully');

                        if (this.callbacks.onStatus) {
                            this.callbacks.onStatus('Connected');
                        }

                        resolve(true);
                    } else {
                        reject(new Error('WebSocket connection failed to open'));
                    }
                }, 3000);
            });
        } catch (error) {
            console.error('[AzureWebSocket] Failed to initialize Azure WebSocket Realtime service:', error);
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
            throw error;
        }
    }

    send(message) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            const messageStr = JSON.stringify(message);
            this.debugLog('[AzureWebSocket] Sending message:', message.type);
            this.socket.send(messageStr);
            return true;
        } else {
            console.error('[AzureWebSocket] Cannot send message - socket not ready');
            return false;
        }
    }



    sanitizeForLog(value, depth = 0) {
        if (depth > 3) {
            return '[Object]';
        }

        if (value === null || value === undefined) {
            return value;
        }

        if (typeof value === 'string') {
            const base64Like = /^[A-Za-z0-9+/=]+$/.test(value);
            if (base64Like && value.length > 80) {
                return `<base64 ${value.length} chars>`;
            }
            if (value.length > 200) {
                return `${value.slice(0, 200)}... (+${value.length - 200} chars)`;
            }
            return value;
        }

        if (Array.isArray(value)) {
            return value.map(entry => this.sanitizeForLog(entry, depth + 1));
        }

        if (typeof value === 'object') {
            const clone = {};
            for (const [key, val] of Object.entries(value)) {
                clone[key] = this.sanitizeForLog(val, depth + 1);
            }
            return clone;
        }

        return value;
    }

    logIncomingMessage(message) {
        if (!this.debugEnabled) {
            return;
        }
        try {
            console.log('---------------- AzureServerMessage', this.sanitizeForLog(message));
        } catch (error) {
            console.log('---------------- AzureServerMessage (raw)', message);
        }
    }

    calculateRms(buffer) {
        if (!buffer || buffer.length < 2) {
            return 0;
        }

        let sumSquares = 0;
        const sampleCount = buffer.length / 2;
        for (let offset = 0; offset < buffer.length; offset += 2) {
            const sample = buffer.readInt16LE(offset) / 32768;
            sumSquares += sample * sample;
        }
        return Math.sqrt(sumSquares / Math.max(sampleCount, 1));
    }

    analyzeAudioFrame(buffer) {
        if (!buffer || buffer.length === 0) {
            return { rms: 0, isSilent: true };
        }

        const rms = this.calculateRms(buffer);
        const threshold = this.silenceGateEnabled ? this.silenceRmsThreshold : 0;
        return {
            rms,
            isSilent: this.silenceGateEnabled ? rms < threshold : false
        };
    }

    logMetrics(context) {
        this.debugLog('[AzureWebSocket] Metrics update (%s): %o', context, {
            queuedChunks: this.metrics.audioChunksQueued,
            skippedChunks: this.metrics.audioChunksSkipped,
            flushes: this.metrics.audioFlushes,
            bytesSent: this.metrics.audioBytesSent,
            commits: this.metrics.audioCommits
        });
    }

    publishTextUpdate(force = false) {
        if (!this.textBuffer) {
            return;
        }

        const additionalChars = this.textBuffer.length - this.lastLoggedLength;
        if (additionalChars > 0) {
            const deltaPreview = this.textBuffer.slice(this.lastLoggedLength);
            const snippet = deltaPreview.length > 200 ? `${deltaPreview.slice(0, 200)}...` : deltaPreview;
            console.log('[AzureWebSocket] Partial response delta:', snippet);
            this.lastLoggedLength = this.textBuffer.length;
        }

        if (!force) {
            return;
        }

        if (this.responseDelivered && this.textBuffer.length === this.lastPublishedLength) {
            return;
        }

        this.lastPublishedLength = this.textBuffer.length;
        this.responseDelivered = true;
        if (this.callbacks.onMessage) {
            this.callbacks.onMessage(this.textBuffer);
        }
    }

    handleWebSocketMessage(message) {
        this.logIncomingMessage(message);
        switch (message.type) {
            case 'session.created':
                this.debugLog('[AzureWebSocket] Session created:', message.session?.id);
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Connected');
                }
                break;

            case 'session.updated':
                this.debugLog('[AzureWebSocket] Session updated');
                break;

            case 'conversation.item.created':
                this.debugLog('[AzureWebSocket] Conversation item created:', message.item?.id);
                break;

            case 'response.created':
                this.debugLog('[AzureWebSocket] Response created');
                this.textBuffer = '';
                this.lastPublishedLength = 0;
                this.lastLoggedLength = 0;
                this.responseDelivered = false;
                this.hasSentAudio = false;
                this.consecutiveSilentDrops = 0;
                this.bytesSinceLastCommit = 0;
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Responding...');
                }
                break;

            case 'response.output_item.added':
                this.debugLog('[AzureWebSocket] Response output item added');
                break;

            case 'response.content_part.added':
                if (typeof message.part?.transcript === 'string') {
                    this.textBuffer += message.part.transcript;
                    this.publishTextUpdate();
                } else if (typeof message.part?.text === 'string') {
                    this.textBuffer += message.part.text;
                    this.publishTextUpdate();
                }
                break;

            case 'response.text.delta':
                if (message.delta) {
                    const deltaText = typeof message.delta === 'string'
                        ? message.delta
                        : message.delta?.text;
                    if (deltaText) {
                        this.textBuffer += deltaText;
                        this.publishTextUpdate();
                    }
                }
                break;

            case 'response.text.done':
                if (typeof message.text === 'string') {
                    this.textBuffer = message.text;
                } else if (Array.isArray(message.content)) {
                    const part = message.content.find(entry => typeof entry.text === 'string');
                    if (part) {
                        this.textBuffer = part.text;
                    }
                }
                this.publishTextUpdate(true);
                break;

            case 'response.output_item.done':
                this.debugLog('[AzureWebSocket] Response output item done');
                break;

            case 'response.audio.delta':
                if (message.delta && this.callbacks.onAudio) {
                    this.callbacks.onAudio(message.delta);
                }
                break;

            case 'response.audio.done':
                this.debugLog('[AzureWebSocket] Response audio stream completed');
                break;

            case 'response.audio_transcript.delta':
                if (typeof message.delta === 'string') {
                    this.textBuffer += message.delta;
                    this.publishTextUpdate();
                }
                break;

            case 'response.audio_transcript.done':
                if (typeof message.transcript === 'string') {
                    this.textBuffer = message.transcript;
                    this.publishTextUpdate();
                }
                break;

            case 'response.content_part.done':
                if (typeof message.part?.transcript === 'string') {
                    this.textBuffer = message.part.transcript;
                    this.publishTextUpdate();
                } else if (typeof message.content?.transcript === 'string') {
                    this.textBuffer = message.content.transcript;
                    this.publishTextUpdate();
                }
                break;

            case 'input_audio_buffer.speech_started':
                process.stdout.write('.');
                this.speechActive = true;
                this.debugLog('[AzureWebSocket] Speech started (server VAD)');
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Listening...');
                }
                break;

            case 'input_audio_buffer.speech_stopped':
                this.speechActive = false;
                this.debugLog('[AzureWebSocket] Speech stopped (server VAD)');
                {
                    const flushed = this.flushAudioAccumulator({ force: true, context: 'speech_stopped' });
                    if (flushed !== false) {
                        this.commitAudioBuffer('speech_stopped');
                    }
                }
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Processing...');
                }
                break;

            case 'input_audio_buffer.committed':
                this.debugLog('[AzureWebSocket] Server acknowledged audio commit');
                this.pendingAudioForCommit = false;
                 this.bytesSinceLastCommit = 0;
                break;

            case 'input_audio_buffer.commit_failed':
                console.warn('[AzureWebSocket] Server reported commit failure:', message.error || message.reason);
                this.pendingAudioForCommit = false;
                this.bytesSinceLastCommit = 0;
                break;

            case 'input_audio_buffer.commit_no_audio':
                this.debugLog('[AzureWebSocket] Commit skipped by server (no audio)');
                this.pendingAudioForCommit = false;
                this.bytesSinceLastCommit = 0;
                break;

            case 'input_audio_buffer.commit_empty':
            case 'input_audio_buffer_commit_empty':
                console.warn('[AzureWebSocket] Server reported empty commit');
                this.pendingAudioForCommit = false;
                this.bytesSinceLastCommit = 0;
                break;

            case 'conversation.item.input_audio_transcription.completed':
                if (message.transcript) {
                    const transcriptText = typeof message.transcript === 'string'
                        ? message.transcript
                        : message.transcript?.text || message.transcript?.transcript;
                    const cleanedTranscript = (transcriptText || '').trim();
                    this.debugLog('[AzureWebSocket] Transcription:', cleanedTranscript);
                    if (cleanedTranscript && this.callbacks.onTranscription) {
                        this.callbacks.onTranscription(cleanedTranscript);
                    }
                }
                break;

            case 'response.done':
                this.debugLog('[AzureWebSocket] Response completed');
                if (this.textBuffer) {
                    this.publishTextUpdate(true);
                }
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Ready');
                }
                if (this.callbacks.onComplete) {
                    this.callbacks.onComplete();
                }
                this.textBuffer = '';
                this.lastPublishedLength = 0;
                this.lastLoggedLength = 0;
                this.responseDelivered = false;
                this.hasSentAudio = false;
                this.consecutiveSilentDrops = 0;
                this.bytesSinceLastCommit = 0;
                this.logMetrics('response.done');
                break;

            case 'response.error':
                console.error('[AzureWebSocket] Response error:', message.error);
                if (this.callbacks.onError) {
                    this.callbacks.onError(new Error(message.error?.message || 'Response error'));
                }
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Ready');
                }
                break;

            case 'error':
                {
                    const errorPayload = message.error || message;
                    if (errorPayload?.code === 'input_audio_buffer_commit_empty') {
                        console.warn('[AzureWebSocket] Server rejected commit (buffer too small); padding requirement not met');
                        this.pendingAudioForCommit = true;
                        this.bytesSinceLastCommit = 0;
                        this.hasSentAudio = false;
                        this.consecutiveSilentDrops = 0;
                        if (this.commitPaddingEnabled) {
                            this.commitAudioBuffer('retry_after_commit_empty', { forceTailPadding: true });
                        } else {
                            this.pendingAudioForCommit = false;
                        }
                        break;
                    }
                    console.error('[AzureWebSocket] WebSocket error:', errorPayload);
                    if (this.callbacks.onError) {
                        this.callbacks.onError(new Error(errorPayload?.message || 'WebSocket error'));
                    }
                }
                break;

            default:
                this.debugLog('[AzureWebSocket] Unhandled WebSocket message type:', message.type);
        }
    }

    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    async sendText(text) {
        if (!this.isInitialized || !this.socket) {
            throw new Error('Azure WebSocket not initialized');
        }

        this.debugLog('[AzureWebSocket] Sending text message:', text.substring(0, 100) + '...');

        // Send conversation item create
        this.send({
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: text }]
            }
        });

        // Create response
        this.send({ type: "response.create" });

        return true;
    }

    async sendAudio(audioData) {
        if (!this.isInitialized || !this.socket) {
            throw new Error('Azure WebSocket not initialized');
        }

        if (!Buffer.isBuffer(audioData)) {
            throw new Error('Audio data must be a Buffer');
        }

        const { rms, isSilent: initialSilent } = this.analyzeAudioFrame(audioData);
        let isSilent = initialSilent;

        if (isSilent) {
            this.consecutiveSilentDrops += 1;
        } else {
            this.consecutiveSilentDrops = 0;
        }

        if (isSilent && !this.hasSentAudio && this.consecutiveSilentDrops <= this.silenceGateWarmupDrops) {
            this.debugLog('[AzureWebSocket] Bypassing silence gate during warmup (drops=%d, rms=%s)', this.consecutiveSilentDrops, rms.toFixed(5));
            isSilent = false;
        }

        if (isSilent && this.autoSilenceAdjustmentEnabled && this.consecutiveSilentDrops >= 12 && this.silenceRmsThreshold > this.silenceRmsFloor) {
            const previousThreshold = this.silenceRmsThreshold;
            this.silenceRmsThreshold = Math.max(this.silenceRmsThreshold * 0.75, this.silenceRmsFloor);
            console.log('[AzureWebSocket] Lowered silence RMS threshold to %s (was %s) after %d consecutive silent frames', this.silenceRmsThreshold.toFixed(5), previousThreshold.toFixed(5), this.consecutiveSilentDrops);
            isSilent = rms < this.silenceRmsThreshold;
        }

        if (isSilent) {
            this.metrics.audioChunksSkipped += 1;
            const now = Date.now();
            if (now - this.lastSilenceLogTs >= this.silenceSkipLogThrottleMs) {
                this.lastSilenceLogTs = now;
                console.log('%s (rms=%s)', this.silenceLogPrefix, rms.toFixed(5));
            }
            process.stdout.write('-');
            if (this.pendingChunkAccumulator.length > 0) {
                const flushed = this.flushAudioAccumulator({ force: true, context: 'silence_gap' });
                if (flushed !== false) {
                    this.commitAudioBuffer('silence_gap');
                }
            }
            return true;
        }

        this.pendingChunkAccumulator.push(audioData);
        this.pendingChunkBytes += audioData.length;
        this.metrics.audioChunksQueued += 1;
        process.stdout.write('+');

        this.scheduleFlush();

        const now = Date.now();
        const sizeThresholdReached = this.pendingChunkBytes >= this.minAudioChunkBytes;
        const intervalElapsed = now - this.lastChunkFlushTs >= this.chunkFlushIntervalMs;

        if (sizeThresholdReached || intervalElapsed) {
            const context = sizeThresholdReached ? 'size_threshold' : 'interval';
            if (!this.flushAudioAccumulator({ force: true, context })) {
                return false;
            }
        }

        return true;
    }

    flushAudioAccumulator({ force = false, context = 'unspecified' } = {}) {
        this.clearFlushTimer();

        if (this.pendingChunkAccumulator.length === 0 || this.pendingChunkBytes === 0) {
            return true;
        }

        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.warn('[AzureWebSocket] Unable to flush audio - socket not open');
            return false;
        }

        if (!force) {
            const elapsed = Date.now() - this.lastChunkFlushTs;
            if (elapsed < this.chunkFlushIntervalMs && this.pendingChunkBytes < this.minAudioChunkBytes) {
                return true;
            }
        }

        const payloadBuffer = this.pendingChunkAccumulator.length === 1
            ? this.pendingChunkAccumulator[0]
            : Buffer.concat(this.pendingChunkAccumulator);

        if (!payloadBuffer || payloadBuffer.length === 0) {
            this.pendingChunkAccumulator = [];
            this.pendingChunkBytes = 0;
            return true;
        }

        const appendMessage = {
            type: "input_audio_buffer.append",
            audio: payloadBuffer.toString('base64')
        };

        if (!this.send(appendMessage)) {
            console.warn('[AzureWebSocket] Failed to append audio buffer');
            return false;
        }

        this.hasSentAudio = true;
        this.bytesSinceLastCommit += payloadBuffer.length;
        this.metrics.audioFlushes += 1;
        this.metrics.audioBytesSent += payloadBuffer.length;
        this.pendingChunkAccumulator = [];
        this.pendingChunkBytes = 0;
        this.lastChunkFlushTs = Date.now();
        this.pendingAudioForCommit = true;
        this.logMetrics(context);
        return true;
    }

    commitAudioBuffer(context = 'unspecified', options = {}) {
        const { forceTailPadding = false } = options;
        if (!this.pendingAudioForCommit) {
            this.debugLog('[AzureWebSocket] Commit skipped (%s) - no pending audio', context);
            return true;
        }

        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.warn('[AzureWebSocket] Unable to commit audio - socket not open');
            return false;
        }

        let requiredPadding = 0;
        const missingBytes = Math.max(0, this.minCommitBytes - this.bytesSinceLastCommit);

        if (missingBytes > 0) {
            if (!this.commitPaddingEnabled) {
                this.debugLog('[AzureWebSocket] Commit deferred (%s) - only %d bytes since last commit', context, this.bytesSinceLastCommit);
                return true;
            }
            requiredPadding = missingBytes;
        }

        const shouldTailPad = this.commitPaddingEnabled
            && this.commitTailSilenceBytes > 0
            && (forceTailPadding || context === 'speech_stopped' || context === 'silence_gap');

        if (shouldTailPad) {
            requiredPadding = Math.max(requiredPadding, this.commitTailSilenceBytes);
        }

        if (requiredPadding > 0) {
            const paddingBuffer = Buffer.alloc(requiredPadding);
            this.debugLog('[AzureWebSocket] Padding audio buffer with %d bytes of silence before commit (%s)', requiredPadding, context);
            if (!this.send({ type: 'input_audio_buffer.append', audio: paddingBuffer.toString('base64') })) {
                console.warn('[AzureWebSocket] Failed to send silence padding before commit');
                return false;
            }
            this.metrics.audioFlushes += 1;
            this.metrics.audioBytesSent += requiredPadding;
            this.bytesSinceLastCommit += requiredPadding;
        }

        if (this.bytesSinceLastCommit <= 0) {
            this.debugLog('[AzureWebSocket] Commit skipped (%s) - no audio available after padding', context);
            return true;
        }

        if (!this.send({ type: 'input_audio_buffer.commit' })) {
            console.warn('[AzureWebSocket] Failed to commit audio buffer');
            return false;
        }

        this.pendingAudioForCommit = false;
        this.metrics.audioCommits += 1;
        this.hasSentAudio = false;
        this.consecutiveSilentDrops = 0;
        this.logMetrics(`commit:${context}`);
        return true;
    }

    clearFlushTimer() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
    }

    scheduleFlush() {
        if (this.chunkFlushIntervalMs <= 0) {
            return;
        }

        if (this.pendingChunkAccumulator.length === 0 || this.pendingChunkBytes === 0) {
            return;
        }

        this.clearFlushTimer();
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            const flushed = this.flushAudioAccumulator({ force: true, context: 'idle_timer' });
            if (flushed === false && this.pendingChunkAccumulator.length > 0) {
                this.scheduleFlush();
            } else if (flushed !== false && !this.speechActive) {
                this.commitAudioBuffer('idle_timer');
            }
        }, this.chunkFlushIntervalMs);
    }

    async sendImage(imageData) {
        // Azure Realtime doesn't support images yet
        console.log('[AzureWebSocket] Image processing not supported in realtime mode');
        throw new Error('Image processing not supported in Azure realtime mode');
    }

    async sendRealtimeInput(input) {
        if (!input || typeof input !== 'object') {
            throw new Error('Invalid realtime input payload');
        }

        if (input.text) {
            return this.sendText(input.text);
        }

        if (input.audio) {
            const audioPayload = Buffer.isBuffer(input.audio)
                ? input.audio
                : Buffer.from(input.audio.data || input.audio, input.audio?.data ? 'base64' : undefined);
            return this.sendAudio(audioPayload);
        }

        if (input.media || input.image) {
            return this.sendImage(input.media || input.image);
        }

        throw new Error('Unsupported realtime input payload');
    }

    async close() {
        console.log('[AzureWebSocket] Closing Azure WebSocket connection');

        try {
            this.clearFlushTimer();
            this.flushAudioAccumulator({ force: true, context: 'close' });
            if (this.socket) {
                this.socket.close();
                this.socket = null;
            }

            this.isConnected = false;
            this.isInitialized = false;
            this.pendingChunkAccumulator = [];
            this.pendingChunkBytes = 0;
            this.pendingAudioForCommit = false;
            this.lastChunkFlushTs = Date.now();
            this.speechActive = false;
            this.lastPublishedLength = 0;
            this.lastLoggedLength = 0;
            this.textBuffer = '';
            this.hasSentAudio = false;
            this.consecutiveSilentDrops = 0;
            this.bytesSinceLastCommit = 0;

            console.log('[AzureWebSocket] Azure WebSocket service closed successfully');
        } catch (error) {
            console.error('[AzureWebSocket] Error closing WebSocket service:', error);
        }
    }

    isActive() {
        return this.isInitialized;
    }
}

module.exports = { AzureRealtimeWebSocketService };
