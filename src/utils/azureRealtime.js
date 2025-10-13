const { LLMService } = require('./llm.js');
const { BrowserWindow } = require('electron');

class AzureRealtimeService extends LLMService {
    constructor(apiKey, endpoint, deployment, customPrompt, profile, language) {
        super(apiKey, customPrompt, profile, language);

        // Extract hostname from endpoint URL (handle both full URLs and hostnames)
        let hostname = endpoint;
        let region = 'eastus2'; // Default region
        let resourceName = null;

        if (endpoint.startsWith('http')) {
            try {
                const url = new URL(endpoint);
                hostname = url.hostname;
                console.log('[AzureRealtime] Extracted hostname from endpoint:', hostname);
            } catch (error) {
                console.warn('[AzureRealtime] Failed to parse endpoint URL, using as-is:', endpoint, error.message);
            }
        }

        // Parse Azure resource URL format: {resourceName}-{region}.cognitiveservices.azure.com
        // Example: think-mfpn0e5t-eastus2.cognitiveservices.azure.com
        console.log('[AzureRealtime] Parsing Azure resource URL:', hostname);

        const parts = hostname.split('.'); // Split on dots
        if (parts.length >= 4 && parts[parts.length - 3] === 'cognitiveservices') {
            // Azure resource URL structure: {resourceName}-{region}.cognitiveservices.azure.com
            const resourceAndRegion = parts[0]; // 'think-mfpn0e5t-eastus2'

            // Find the last hyphen to separate resource name from region
            const lastHyphenIndex = resourceAndRegion.lastIndexOf('-');
            if (lastHyphenIndex > 0) {
                resourceName = resourceAndRegion.slice(0, lastHyphenIndex);
                region = resourceAndRegion.slice(lastHyphenIndex + 1);
                console.log('[AzureRealtime] Extracted resource name:', resourceName);
                console.log('[AzureRealtime] Extracted region:', region);
            } else {
                console.warn('[AzureRealtime] Could not find hyphen separator in resource-region part');
                resourceName = resourceAndRegion;
                region = 'eastus2'; // Default fallback
            }
        } else {
            console.warn('[AzureRealtime] Unexpected Azure URL format, using fallback parsing');
            // Fallback for edge cases
            const fallbackMatch = hostname.match(/^(.*?)\.cognitiveservices\.azure\.com$/);
            if (fallbackMatch) {
                const fullResource = fallbackMatch[1]; // 'think-mfpn0e5t-eastus2'
                const lastHyphenIndex = fullResource.lastIndexOf('-');
                if (lastHyphenIndex > 0) {
                    resourceName = fullResource.slice(0, lastHyphenIndex);
                    region = fullResource.slice(lastHyphenIndex + 1);
                } else {
                    resourceName = fullResource;
                    region = 'eastus2'; // Default fallback
                }
            } else {
                resourceName = hostname.replace(/\..*azure\.com$/, '');
                region = 'eastus2'; // Default fallback
            }
            console.log('[AzureRealtime] Fallback resource name:', resourceName, 'region:', region);
        }

        // Azure WebRTC Configuration - exact URLs from Azure documentation
        this.endpoint = hostname;
        this.deployment = deployment;
        this.region = region;
        this.resourceName = resourceName;

        // Sessions URL - must use .openai.azure.com domain per Azure docs
        this.sessionsUrl = `https://${resourceName}.openai.azure.com/openai/realtimeapi/sessions?api-version=2025-04-01-preview`;

        // WebRTC URL - uses region-specific realtimeapi-preview.ai.azure.com
        this.webrtcUrl = `https://${region}.realtimeapi-preview.ai.azure.com/v1/realtimertc`;

        console.log('[AzureRealtime] Sessions URL:', this.sessionsUrl);
        console.log('[AzureRealtime] WebRTC URL:', this.webrtcUrl);

        this.apiKey = apiKey;
        this.ephemeralKey = null;
        this.sessionId = null;

        this.isConnected = false;
        this.isInitialized = false;

        // Event callbacks
        this.callbacks = {
            onMessage: null,
            onError: null,
            onComplete: null,
            onStatus: null,
            onTranscription: null,
            onAudio: null
        };

        // Session state
        this.pendingResponses = new Map();

        // Track WebRTC configuration in renderer
        this.webrtcConfig = {
            sessionsUrl: this.sessionsUrl,
            webrtcUrl: this.webrtcUrl,
            apiKey: this.apiKey,
            deployment: this.deployment,
            customPrompt: this.customPrompt,
            profile: this.profile,
            language: this.language
        };
    }

    async init() {
        console.log('[AzureRealtime] Initializing Azure Realtime WebRTC service');

        try {
            await this.initializeWebRTCInRenderer();
            console.log('[AzureRealtime] Azure Realtime WebRTC service initialized successfully');
            return true;
        } catch (error) {
            console.error('[AzureRealtime] Failed to initialize Azure Realtime WebRTC service:', error);
            throw error;
        }
    }

    async initializeWebRTCInRenderer() {
        return new Promise((resolve, reject) => {
            console.log('[AzureRealtime] Starting WebRTC initialization in renderer process...');

            // Send WebRTC configuration to renderer process
            const windows = BrowserWindow.getAllWindows();
            if (windows.length === 0) {
                throw new Error('No renderer window available for WebRTC');
            }

            const mainWindow = windows[0];

            // Setup IPC handlers for WebRTC responses
            this.setupWebRTCIpcHandlers();

            // Send initialization command to renderer
            console.log('[AzureRealtime] MAIN: Sending initialize-azure-webrtc IPC message to renderer');
            console.log('[AzureRealtime] MAIN: Config being sent:', this.webrtcConfig);
            mainWindow.webContents.send('initialize-azure-webrtc', this.webrtcConfig);
            console.log('[AzureRealtime] MAIN: IPC message sent, waiting for renderer response...');

            // Wait for initialization response
            let initTimeout = setTimeout(() => {
                reject(new Error('WebRTC initialization timeout'));
            }, 15000); // Extended timeout for WebRTC setup

            // Handle initialization response via IPC
            const handleInitResponse = (event, response) => {
                console.log('[AzureRealtime] WebRTC initialization response:', response);

                if (!mainWindow.azureWebrtcInitReceived) {
                    mainWindow.azureWebrtcInitReceived = true;

                    if (response.success) {
                        this.isInitialized = true;
                        this.sessionId = response.sessionId;
                        this.ephemeralKey = response.ephemeralKey;

                        console.log('[AzureRealtime] WebRTC connected with session ID:', this.sessionId);

                        if (this.callbacks.onStatus) {
                            this.callbacks.onStatus('Connected');
                        }

                        clearTimeout(initTimeout);
                        // Remove the listener after successful initialization
                        mainWindow.removeListener('azure-webrtc-initialized', handleInitResponse);
                        resolve();
                    } else {
                        clearTimeout(initTimeout);
                        mainWindow.removeListener('azure-webrtc-initialized', handleInitResponse);
                        reject(new Error(response.error || 'WebRTC initialization failed'));
                    }
                }
            };

            // Listen for initialization response via IPC
            mainWindow.azureWebrtcInitReceived = false;
            mainWindow.on('azure-webrtc-initialized', handleInitResponse);


        });
    }

    setupWebRTCIpcHandlers() {
        const mainWindow = BrowserWindow.getAllWindows()[0];

        // Handle WebRTC events from renderer
        mainWindow.on('azure-webrtc-event', (event, message) => {
            console.log('[AzureRealtime] Received WebRTC event from renderer:', message.type);

            // Handle different WebRTC message types
            this.handleWebRTCMessage(message);
        });

        mainWindow.on('azure-webrtc-error', (event, error) => {
            console.error('[AzureRealtime] WebRTC error from renderer:', error);
            if (this.callbacks.onError) {
                this.callbacks.onError(new Error(error.message || 'WebRTC error'));
            }
            if (this.callbacks.onStatus) {
                this.callbacks.onStatus('Error: ' + error.message);
            }
        });
    }

    handleWebRTCMessage(message) {
        switch (message.type) {
            case 'session.created':
                console.log('[AzureRealtime] WebRTC session created:', message.session?.id);
                this.sessionId = message.session?.id;
                break;

            case 'session.updated':
                console.log('[AzureRealtime] WebRTC session updated');
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Ready');
                }
                break;

            case 'response.created':
                console.log('[AzureRealtime] WebRTC response created');
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
                console.log('[AzureRealtime] Speech detected');
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Listening...');
                }
                break;

            case 'input_audio_buffer.speech_stopped':
                console.log('[AzureRealtime] Speech stopped');
                break;

            case 'conversation.item.input_audio_transcription.completed':
                console.log('[AzureRealtime] Transcription:', message.transcript);
                if (message.transcript && this.callbacks.onTranscription) {
                    this.callbacks.onTranscription(message.transcript);
                }
                break;

            case 'response.done':
                console.log('[AzureRealtime] Response completed');
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Ready');
                }
                break;

            case 'error':
                console.error('[AzureRealtime] WebRTC error:', message.error);
                if (this.callbacks.onError) {
                    this.callbacks.onError(new Error(message.error?.message || 'WebRTC error'));
                }
                break;

            default:
                console.log('[AzureRealtime] Unhandled WebRTC message type:', message.type);
        }
    }



    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    async sendText(text) {
        if (!this.isInitialized) {
            throw new Error('Azure WebRTC not initialized');
        }

        console.log('[AzureRealtime] Sending text message:', text.substring(0, 100) + '...');

        // Send text message command to renderer process via IPC
        const mainWindow = BrowserWindow.getAllWindows()[0];
        mainWindow.webContents.send('azure-webrtc-send-text', { text });

        return true; // Indicate message sent, not the response content
    }

    async sendAudio(audioData) {
        if (!this.isInitialized) {
            throw new Error('Azure WebRTC not initialized');
        }

        console.log(`[AzureRealtime] Sending audio chunk: ${audioData.length} bytes`);

        // Send audio data to renderer process for WebRTC transmission
        const mainWindow = BrowserWindow.getAllWindows()[0];
        mainWindow.webContents.send('azure-webrtc-send-audio', {
            audio: audioData.toString('base64')
        });

        return true;
    }

    async sendImage(imageData) {
        // Azure Realtime doesn't support images yet
        console.log('[AzureRealtime] Image processing not supported in realtime mode');
        throw new Error('Image processing not supported in Azure realtime mode');
    }

    async close() {
        console.log('[AzureRealtime] Closing Azure WebRTC connection');

        try {
            // Send close command to renderer process
            const mainWindow = BrowserWindow.getAllWindows()[0];
            mainWindow.webContents.send('azure-webrtc-close');

            this.isConnected = false;
            this.isInitialized = false;
            this.ephemeralKey = null;
            this.sessionId = null;
            this.pendingResponses.clear();

            console.log('[AzureRealtime] Azure WebRTC service closed');
        } catch (error) {
            console.error('[AzureRealtime] Error closing WebRTC service:', error);
        }
    }

    isActive() {
        return this.isInitialized; // WebRTC connection status is managed by the RTCPeerConnection
    }
}

module.exports = { AzureRealtimeService };
