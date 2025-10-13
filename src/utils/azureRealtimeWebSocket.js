const { LLMService } = require('./llm.js');
const { BrowserWindow, ipcMain } = require('electron');
const WebSocket = require('ws');

class AzureRealtimeWebSocketService extends LLMService {
    constructor(apiKey, endpoint, deployment, customPrompt, profile, language) {
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

        // Parse Azure resource URL format: {fullResourceName}.cognitiveservices.azure.com
        // The full resource name includes region: think-mfpn0e5t-eastus2
        const parts = hostname.split('.');
        let fullResourceName = null;

        if (parts.length >= 4 && parts[parts.length - 3] === 'cognitiveservices') {
            fullResourceName = parts[0]; // e.g., think-mfpn0e5t-eastus2
            console.log('[AzureWebSocket] Extracted full resource name:', fullResourceName);
        } else {
            console.warn('[AzureWebSocket] Unexpected Azure URL format, using fallback parsing');
            fullResourceName = hostname.replace(/\..*azure\.com$/, '');
            console.log('[AzureWebSocket] Fallback full resource name:', fullResourceName);
        }

        // Manual WebSocket URL construction for Azure realtime - similar to docs
        this.websocketUrl = `wss://${fullResourceName}.openai.azure.com/openai/realtime?api-version=2024-10-01-preview&deployment=${deployment}&api-key=${encodeURIComponent(apiKey)}`;
        console.log('[AzureWebSocket] Manual WebSocket URL constructed (api key hidden)');

        this.deployment = deployment;
        this.customPrompt = customPrompt;
        this.language = language || 'en-US';
        this.apiKey = apiKey;

        this.isConnected = false;
        this.isInitialized = false;
        this.socket = null;

        // Audio buffering for proper Azure realtime streaming
        this.audioBuffer = []; // Store audio chunks
        this.minAudioMs = 100; // Minimum audio before commit (Azure requirement)
        this.commitTimeoutMs = 500; // Commit delay for silence detection
        this.isCommitting = false; // Prevent concurrent commits
        this.responseInProgress = false; // Track active responses
        this.commitTimer = null; // Timer for delayed commits

        // Event callbacks
        this.callbacks = {
            onMessage: null,
            onError: null,
            onComplete: null,
            onStatus: null,
            onTranscription: null,
            onAudio: null
        };
    }

    async init() {
        console.log('[AzureWebSocket] Initializing Azure WebSocket Realtime service (manual implementation)');

        try {
            return new Promise((resolve, reject) => {
                console.log('[AzureWebSocket] Creating manual WebSocket connection...');
                console.log('[AzureWebSocket] WebSocket URL:', this.websocketUrl.replace(/api-key=[^&]*/, 'api-key=***'));

                this.socket = new WebSocket(this.websocketUrl, [], {
                    headers: {
                        'User-Agent': 'Azure-OpenAI-Node/1.0'
                    }
                });

                this.socket.on('open', () => {
                    console.log('[AzureWebSocket] WebSocket connection opened!');
                });

                this.socket.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        console.log('[AzureWebSocket] Received WebSocket message:', message.type);
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
                        console.log('[AzureWebSocket] Sending initial session configuration...');
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
            console.log('[AzureWebSocket] Sending message:', message.type);
            this.socket.send(messageStr);
            return true;
        } else {
            console.error('[AzureWebSocket] Cannot send message - socket not ready');
            return false;
        }
    }



    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'session.created':
                console.log('[AzureWebSocket] Session created:', message.session?.id);
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Connected');
                }
                break;

            case 'session.updated':
                console.log('[AzureWebSocket] Session updated');
                break;

            case 'conversation.item.created':
                console.log('[AzureWebSocket] Conversation item created');
                break;

            case 'response.created':
                console.log('[AzureWebSocket] Response created');
                break;

            case 'response.text.delta':
                if (message.delta && this.callbacks.onMessage) {
                    this.callbacks.onMessage(message.delta);
                }
                break;

            case 'response.audio.delta':
                if (message.delta && this.callbacks.onAudio) {
                    this.callbacks.onAudio(message.delta);
                }
                break;

            case 'input_audio_buffer.speech_started':
                console.log('[AzureWebSocket] Speech detected');
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Listening...');
                }
                break;

            case 'input_audio_buffer.speech_stopped':
                console.log('[AzureWebSocket] Speech stopped');
                break;

            case 'conversation.item.input_audio_transcription.completed':
                console.log('[AzureWebSocket] Transcription:', message.transcript);
                if (message.transcript && this.callbacks.onTranscription) {
                    this.callbacks.onTranscription(message.transcript);
                }
                break;

            case 'response.done':
                console.log('[AzureWebSocket] Response completed');
                this.responseInProgress = false; // Reset response flag
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Ready');
                }
                if (this.callbacks.onComplete) {
                    this.callbacks.onComplete();
                }
                break;

            case 'error':
                console.error('[AzureWebSocket] WebSocket error:', message.error);
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

        console.log('[AzureWebSocket] Sending text message:', text.substring(0, 100) + '...');

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

        console.log(`[AzureWebSocket] Buffering audio chunk: ${audioData.length} bytes`);

        // Add audio chunk to buffer
        this.audioBuffer.push(audioData);

        // Clear existing timer and set new one for delayed commit
        if (this.commitTimer) {
            clearTimeout(this.commitTimer);
        }

        this.commitTimer = setTimeout(() => {
            // Commit buffered audio after silence delay
            if (this.audioBuffer.length > 0 && !this.responseInProgress && !this.isCommitting) {
                this.commitAudioBufferAndCreateResponse();
            }
        }, this.commitTimeoutMs);

        return true;
    }

    async commitAudioBufferAndCreateResponse() {
        if (this.isCommitting || this.responseInProgress || this.audioBuffer.length === 0) {
            return;
        }

        this.isCommitting = true;
        console.log(`[AzureWebSocket] Committing buffered audio: ${this.audioBuffer.length} chunks`);

        try {
            // Send all buffered audio chunks
            for (const chunk of this.audioBuffer) {
                this.send({
                    type: "input_audio_buffer.append",
                    audio: chunk.toString('base64')
                });
            }

            // Commit the audio buffer
            this.send({ type: "input_audio_buffer.commit" });

            // Create response (only if no active response)
            this.responseInProgress = true;
            this.send({ type: "response.create" });

            console.log('[AzureWebSocket] Audio buffer committed, response created');
        } catch (error) {
            console.error('[AzureWebSocket] Error committing audio buffer:', error);
            this.responseInProgress = false;
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

    async close() {
        console.log('[AzureWebSocket] Closing Azure WebSocket connection');

        try {
            if (this.socket) {
                this.socket.close();
                this.socket = null;
            }

            this.isConnected = false;
            this.isInitialized = false;

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
