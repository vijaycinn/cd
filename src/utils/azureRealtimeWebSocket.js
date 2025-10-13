const { LLMService } = require('./llm.js');
const { BrowserWindow, ipcMain } = require('electron');
const WebSocket = require('ws');

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

        this.isConnected = false;
        this.isInitialized = false;
        this.socket = null;
        this.textBuffer = '';
        this.lastPublishedLength = 0;
        this.lastLoggedLength = 0;
        this.minPublishChars = 32; // avoid flooding UI with tiny deltas
        this.responseDelivered = false;
        this.debugEnabled = process.env.AZURE_REALTIME_DEBUG === '1';
        this.minCommitBytes = 6400; // ~0.2s of 16 kHz 16-bit audio
        this.forceCommitBytes = 48000; // auto-flush after ~1.5s

        // Audio buffering for proper Azure realtime streaming
        this.audioBuffer = []; // Store audio chunks
        this.minAudioChunkBytes = 16000; // send audio in ~0.5s chunks
        this.commitTimeoutMs = 500; // Commit delay for silence detection
        this.isCommitting = false; // Prevent concurrent commits
        this.responseInProgress = false; // Track active responses
        this.commitTimer = null; // Timer for delayed commits
        this.speechActive = false; // Server VAD speech flag
        this.commitGracePeriodMs = 80; // server VAD tail window before committing
        this.hasNewAudioSinceLastCommit = false; // Track if audio arrived post-commit
        this.pauseForEmptyCommit = false; // Block commits after server empty warnings
        this.pendingCommitRequest = null; // Defer commits while response.active
        this.pendingAudioBytes = 0; // Bytes accrued since last commit
        this.silenceRmsThreshold = parseFloat(process.env.AZURE_REALTIME_SILENCE_RMS || '0.008');
        this.disableSilenceGate = process.env.AZURE_REALTIME_DISABLE_SILENCE_GATE === '1';
        this.silenceSkipLogThrottleMs = 4000; // Reduce log spam when skipping silence
        this.lastSilenceLogTs = 0;
        this.metrics = {
            audioChunksAccepted: 0,
            audioChunksSkipped: 0,
            commitsAttempted: 0,
            responsesRequested: 0,
            emptyCommitWarnings: 0
        };

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
                    this.responseInProgress = false;
                    this.isCommitting = false;
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
                    this.clearCommitTimer();
                    this.audioBuffer = [];
                    this.speechActive = false;
                    this.isCommitting = false;
                    this.responseInProgress = false;
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
                                turn_detection: {
                                    type: "server_vad"
                                },
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

    isAudioSilent(buffer) {
        if (this.disableSilenceGate) {
            return false;
        }

        const rms = this.calculateRms(buffer);
        const isSilent = rms < this.silenceRmsThreshold;
        if (isSilent) {
            const now = Date.now();
            if (now - this.lastSilenceLogTs >= this.silenceSkipLogThrottleMs) {
                this.lastSilenceLogTs = now;
                console.log('[AzureWebSocket] Dropping near-silent audio chunk (rms=%s)', rms.toFixed(5));
            }
            this.metrics.audioChunksSkipped += 1;
        }
        return isSilent;
    }

    logCommitMetrics(context) {
        this.debugLog('[AzureWebSocket] Metrics update (%s): %o', context, {
            acceptedChunks: this.metrics.audioChunksAccepted,
            skippedChunks: this.metrics.audioChunksSkipped,
            commitsAttempted: this.metrics.commitsAttempted,
            responsesRequested: this.metrics.responsesRequested,
            emptyCommitWarnings: this.metrics.emptyCommitWarnings
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
                this.debugLog('[AzureWebSocket] Conversation item created');
                break;

            case 'response.created':
                this.debugLog('[AzureWebSocket] Response created');
                this.textBuffer = '';
                this.lastPublishedLength = 0;
                this.lastLoggedLength = 0;
                this.responseDelivered = false;
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

            case 'response.audio.delta':
                if (message.delta && this.callbacks.onAudio) {
                    this.callbacks.onAudio(message.delta);
                }
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
                this.clearCommitTimer();
                this.debugLog('[AzureWebSocket] Speech started (server VAD)');
                this.pauseForEmptyCommit = false;
                this.pendingCommitRequest = null;
                this.hasNewAudioSinceLastCommit = this.audioBuffer.length > 0;
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Listening...');
                }
                break;

            case 'input_audio_buffer.speech_stopped':
                this.speechActive = false;
                this.debugLog('[AzureWebSocket] Speech stopped (server VAD)');
                if (this.hasNewAudioSinceLastCommit) {
                    this.scheduleCommit({ delay: this.commitGracePeriodMs, force: true, reason: 'speech_stopped' });
                } else {
                    this.debugLog('[AzureWebSocket] No new audio since last commit - skipping speech_stopped commit');
                }
                break;

            case 'input_audio_buffer.committed':
                this.debugLog('[AzureWebSocket] Server acknowledged audio commit');
                break;

            case 'input_audio_buffer.commit_failed':
                console.warn('[AzureWebSocket] Server reported commit failure:', message.error || message.reason);
                this.responseInProgress = false;
                this.pauseForEmptyCommit = true;
                this.hasNewAudioSinceLastCommit = false;
                this.pendingCommitRequest = null;
                this.audioBuffer = [];
                this.pendingAudioBytes = 0;
                break;

            case 'input_audio_buffer.commit_no_audio':
                this.debugLog('[AzureWebSocket] Commit skipped by server (no audio)');
                this.responseInProgress = false;
                this.pauseForEmptyCommit = true;
                this.metrics.emptyCommitWarnings += 1;
                this.hasNewAudioSinceLastCommit = false;
                this.pendingCommitRequest = null;
                this.audioBuffer = [];
                this.pendingAudioBytes = 0;
                break;

            case 'input_audio_buffer.commit_empty':
            case 'input_audio_buffer_commit_empty':
                console.warn('[AzureWebSocket] Server reported empty commit');
                this.pauseForEmptyCommit = true;
                this.metrics.emptyCommitWarnings += 1;
                this.hasNewAudioSinceLastCommit = false;
                this.pendingCommitRequest = null;
                this.audioBuffer = [];
                this.pendingAudioBytes = 0;
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
                this.responseInProgress = false; // Reset response flag
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
                if (this.pendingCommitRequest && this.hasNewAudioSinceLastCommit && this.audioBuffer.length > 0) {
                    const { force, reason } = this.pendingCommitRequest;
                    this.pendingCommitRequest = null;
                    this.commitAudioBufferAndCreateResponse({ force, reason: `${reason || 'deferred'}_post_response` });
                } else {
                    this.pendingCommitRequest = null;
                }
                this.logCommitMetrics('response.done');
                break;

            case 'response.error':
                console.error('[AzureWebSocket] Response error:', message.error);
                this.responseInProgress = false;
                this.pendingCommitRequest = null;
                break;

            case 'error':
                console.error('[AzureWebSocket] WebSocket error:', message.error);
                if (message.error?.code === 'conversation_already_has_active_response') {
                    this.responseInProgress = true;
                    this.pendingCommitRequest = { force: true, reason: 'server_active_response' };
                } else {
                    this.responseInProgress = false;
                }
                if (this.callbacks.onError) {
                    this.callbacks.onError(new Error(message.error?.message || 'WebSocket error'));
                }
                break;

            default:
                console.log('[AzureWebSocket] Unhandled WebSocket message type:', message.type);
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

        if (this.isAudioSilent(audioData)) {
            return true;
        }

        this.debugLog(`[AzureWebSocket] Buffering audio chunk: ${audioData.length} bytes`);

        // Add audio chunk to buffer
        this.audioBuffer.push(audioData);
        this.metrics.audioChunksAccepted += 1;
        this.hasNewAudioSinceLastCommit = true;
        this.pauseForEmptyCommit = false;
        this.pendingAudioBytes += audioData.length;
        process.stdout.write('+');

        // If we already have enough buffered audio, flush immediately
        const bufferedBytes = this.getBufferedAudioBytes();
        if (bufferedBytes >= this.forceCommitBytes && !this.isCommitting && !this.responseInProgress) {
            this.commitAudioBufferAndCreateResponse({ reason: 'buffer_threshold' });
            return true;
        }

        this.scheduleCommit();

        return true;
    }

    getBufferedAudioBytes() {
        if (this.audioBuffer.length === 1) {
            return this.audioBuffer[0].length;
        }
        return this.audioBuffer.reduce((total, chunk) => total + chunk.length, 0);
    }

    clearCommitTimer() {
        if (this.commitTimer) {
            clearTimeout(this.commitTimer);
            this.commitTimer = null;
        }
    }

    scheduleCommit(options = {}) {
        const config = typeof options === 'number' ? { delay: options } : options;
        const {
            delay = this.commitTimeoutMs,
            force = false,
            reason = 'timer'
        } = config || {};

        if (!this.hasNewAudioSinceLastCommit && !force) {
            return;
        }

        this.clearCommitTimer();

        this.commitTimer = setTimeout(() => {
            this.commitTimer = null;

            if (!this.hasNewAudioSinceLastCommit) {
                this.debugLog('[AzureWebSocket] Commit timer skipped (%s) - no new audio', reason);
                return;
            }

            if (this.pauseForEmptyCommit && !force) {
                this.debugLog('[AzureWebSocket] Commit paused due to empty warning (%s)', reason);
                return;
            }

            if (this.speechActive && !force) {
                this.debugLog('[AzureWebSocket] Speech still active - delaying commit (%s)', reason);
                this.scheduleCommit({ delay: this.commitTimeoutMs, force, reason });
                return;
            }

            if (this.responseInProgress || this.isCommitting) {
                this.debugLog('[AzureWebSocket] Commit deferred (%s) - response active or committing', reason);
                if (!this.pendingCommitRequest) {
                    this.pendingCommitRequest = { force, reason };
                }
                return;
            }

            this.commitAudioBufferAndCreateResponse({ force, reason });
        }, delay);
    }

    sendBufferedAudioChunks() {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.warn('[AzureWebSocket] Dropping audio buffer - socket not open');
            return false;
        }

        if (this.audioBuffer.length === 0) {
            return true;
        }

        let chunkAccumulator = [];
        let chunkBytes = 0;

        for (const buffer of this.audioBuffer) {
            chunkAccumulator.push(buffer);
            chunkBytes += buffer.length;

            if (chunkBytes >= this.minAudioChunkBytes) {
                const payload = chunkAccumulator.length === 1 ? chunkAccumulator[0] : Buffer.concat(chunkAccumulator);
                if (!this.send({
                    type: "input_audio_buffer.append",
                    audio: payload.toString('base64')
                })) {
                    return false;
                }
                chunkAccumulator = [];
                chunkBytes = 0;
            }
        }

        if (chunkAccumulator.length > 0) {
            const payload = chunkAccumulator.length === 1 ? chunkAccumulator[0] : Buffer.concat(chunkAccumulator);
            if (!this.send({
                type: "input_audio_buffer.append",
                audio: payload.toString('base64')
            })) {
                return false;
            }
        }

        return true;
    }

    async commitAudioBufferAndCreateResponse({ force = false, reason = 'unspecified' } = {}) {
        if (this.responseInProgress) {
            this.debugLog(`[AzureWebSocket] Commit deferred (${reason}) - active response`);
            if (!this.pendingCommitRequest) {
                this.pendingCommitRequest = { force, reason };
            }
            return;
        }

        if (this.isCommitting) {
            this.debugLog(`[AzureWebSocket] Commit skipped (${reason}) - already committing`);
            return;
        }

        if (this.pauseForEmptyCommit && !force) {
            this.debugLog(`[AzureWebSocket] Commit paused (${reason}) - awaiting new audio after empty warning`);
            return;
        }

        if (!this.hasNewAudioSinceLastCommit) {
            this.debugLog(`[AzureWebSocket] Commit skipped (${reason}) - no new audio`);
            return;
        }

        const totalBytes = this.getBufferedAudioBytes();
        if (totalBytes === 0) {
            this.debugLog(`[AzureWebSocket] Commit skipped (${reason}) - buffer empty`);
            return;
        }

        if (!force && totalBytes < this.minCommitBytes) {
            this.debugLog(`[AzureWebSocket] Buffered ${totalBytes} bytes (< ${this.minCommitBytes}); waiting for more audio (${reason})`);
            this.scheduleCommit({ delay: this.commitTimeoutMs, force, reason });
            return;
        }

        this.isCommitting = true;
        this.clearCommitTimer();
        this.metrics.commitsAttempted += 1;
        this.debugLog(`[AzureWebSocket] Committing buffered audio: ${this.audioBuffer.length} chunks (${totalBytes} bytes) via ${reason}`);

        try {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                console.warn('[AzureWebSocket] Skipping commit - socket not open');
                return;
            }

            if (!this.sendBufferedAudioChunks()) {
                console.warn('[AzureWebSocket] Failed sending buffered audio');
                return;
            }

            if (!this.send({ type: "input_audio_buffer.commit" })) {
                console.warn('[AzureWebSocket] Failed to commit audio buffer');
                return;
            }

            this.debugLog('[AzureWebSocket] Audio buffer committed');

            const conversationItemPayload = {
                type: "conversation.item.create",
                item: {
                    type: "message",
                    role: "user",
                    content: [
                        {
                            type: "input_audio",
                            audio: {
                                format: "pcm16"
                            }
                        }
                    ]
                }
            };
            // Azure associates the most recent committed audio buffer with the item; no explicit audio_id needed.

            if (!this.send(conversationItemPayload)) {
                this.debugLog('[AzureWebSocket] Failed to enqueue conversation item for audio turn');
            }

            if (!this.responseInProgress) {
                const responsePayload = {
                    type: "response.create",
                    response: {
                        modalities: ["text"]
                    }
                };

                this.responseInProgress = true;
                if (!this.send(responsePayload)) {
                    console.warn('[AzureWebSocket] Failed to request response creation');
                    this.responseInProgress = false;
                } else {
                    this.metrics.responsesRequested += 1;
                    this.debugLog('[AzureWebSocket] Requested response.create');
                }
            }

            this.logCommitMetrics(reason);
        } catch (error) {
            console.error('[AzureWebSocket] Error committing audio buffer:', error);
        } finally {
            this.audioBuffer = [];
            this.isCommitting = false;
            this.hasNewAudioSinceLastCommit = false;
            this.pendingAudioBytes = 0;
        }
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
            if (this.commitTimer) {
                clearTimeout(this.commitTimer);
                this.commitTimer = null;
            }
            if (this.socket) {
                this.socket.close();
                this.socket = null;
            }

            this.isConnected = false;
            this.isInitialized = false;
            this.audioBuffer = [];
            this.responseInProgress = false;
            this.isCommitting = false;
            this.lastPublishedLength = 0;
            this.textBuffer = '';

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
