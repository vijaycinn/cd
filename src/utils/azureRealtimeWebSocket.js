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
        this.pendingResponse = false; // Awaiting transcript confirmation
        this.commitTimer = null; // Timer for delayed commits
        this.lastTranscript = '';
        this.lastTranscriptId = null;

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
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Listening...');
                }
                break;

            case 'input_audio_buffer.speech_stopped':
                this.debugLog('[AzureWebSocket] Speech stopped');
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

                    if (this.pendingResponse) {
                        if (cleanedTranscript.length === 0) {
                            this.debugLog('[AzureWebSocket] Transcript empty after commit, skipping response');
                            this.pendingResponse = false;
                            break;
                        }

                        const transcriptId = message.item?.id || message.item_id || null;
                        const isDuplicate = transcriptId && this.lastTranscriptId === transcriptId && this.lastTranscript === cleanedTranscript;
                        const isDuplicateText = !transcriptId && this.lastTranscript === cleanedTranscript;

                        if (isDuplicate || isDuplicateText) {
                            this.debugLog('[AzureWebSocket] Duplicate transcript detected, ignoring');
                            this.pendingResponse = false;
                            break;
                        }

                        this.lastTranscript = cleanedTranscript;
                        this.lastTranscriptId = transcriptId;
                        this.pendingResponse = false;
                        this.responseInProgress = true;

                        if (!this.send({ type: "response.create" })) {
                            console.warn('[AzureWebSocket] Failed to request response creation from transcript');
                            this.responseInProgress = false;
                        } else {
                            this.debugLog('[AzureWebSocket] Triggered response.create for transcript');
                        }
                    }
                }
                break;

            case 'response.done':
                this.debugLog('[AzureWebSocket] Response completed');
                this.responseInProgress = false; // Reset response flag
                this.pendingResponse = false;
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
                break;

            case 'error':
                console.error('[AzureWebSocket] WebSocket error:', message.error);
                this.pendingResponse = false;
                this.responseInProgress = false;
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

        this.debugLog(`[AzureWebSocket] Buffering audio chunk: ${audioData.length} bytes`);

        // Add audio chunk to buffer
        this.audioBuffer.push(audioData);
        process.stdout.write('+');

        // If we already have enough buffered audio, flush immediately
        const bufferedBytes = this.getBufferedAudioBytes();
        if (bufferedBytes >= this.forceCommitBytes && !this.isCommitting && !this.responseInProgress && !this.pendingResponse) {
            this.commitAudioBufferAndCreateResponse();
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

    scheduleCommit(delay = this.commitTimeoutMs) {
        if (this.commitTimer) {
            clearTimeout(this.commitTimer);
        }

        this.commitTimer = setTimeout(() => {
            this.commitTimer = null;
            if (this.audioBuffer.length === 0) {
                return;
            }
            if (this.responseInProgress || this.isCommitting || this.pendingResponse) {
                // Try again shortly once current response finishes
                this.scheduleCommit(this.commitTimeoutMs);
                return;
            }
            this.commitAudioBufferAndCreateResponse();
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

    async commitAudioBufferAndCreateResponse() {
        if (this.isCommitting || this.responseInProgress || this.pendingResponse || this.audioBuffer.length === 0) {
            return;
        }

        const totalBytes = this.getBufferedAudioBytes();
        if (totalBytes < this.minCommitBytes) {
            this.debugLog(`[AzureWebSocket] Buffered ${totalBytes} bytes (< ${this.minCommitBytes}); waiting for more audio`);
            this.scheduleCommit(this.commitTimeoutMs);
            return;
        }

        this.isCommitting = true;
        this.debugLog(`[AzureWebSocket] Committing buffered audio: ${this.audioBuffer.length} chunks (${totalBytes} bytes)`);

        try {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                console.warn('[AzureWebSocket] Skipping commit - socket not open');
                this.audioBuffer = [];
                return;
            }

            if (!this.sendBufferedAudioChunks()) {
                console.warn('[AzureWebSocket] Failed sending buffered audio');
                this.pendingResponse = false;
                return;
            }

            // Commit the audio buffer
            if (!this.send({ type: "input_audio_buffer.commit" })) {
                console.warn('[AzureWebSocket] Failed to commit audio buffer');
                this.pendingResponse = false;
                return;
            }

            this.pendingResponse = true;
            this.debugLog('[AzureWebSocket] Audio buffer committed, awaiting transcript');
        } catch (error) {
            console.error('[AzureWebSocket] Error committing audio buffer:', error);
            this.pendingResponse = false;
        } finally {
            // Clear buffer and flags
            this.audioBuffer = [];
            this.isCommitting = false;
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
