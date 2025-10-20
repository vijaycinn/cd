// renderer.js
const { ipcRenderer } = require('electron');

// Initialize random display name for UI components
window.randomDisplayName = null;

// Request random display name from main process
ipcRenderer
    .invoke('get-random-display-name')
    .then(name => {
        window.randomDisplayName = name;
        console.log('Set random display name:', name);
    })
    .catch(err => {
        console.warn('Could not get random display name:', err);
        window.randomDisplayName = 'System Monitor';
    });

let mediaStream = null;
let screenshotInterval = null;
let audioContext = null;
let audioProcessor = null;
let micAudioProcessor = null;
let audioBuffer = [];
const SAMPLE_RATE = 24000;
const AUDIO_CHUNK_DURATION = 0.1; // seconds
const BUFFER_SIZE = 4096; // Increased buffer size for smoother audio

let hiddenVideo = null;
let offscreenCanvas = null;
let offscreenContext = null;
let currentImageQuality = 'medium'; // Store current image quality for manual screenshots

const isLinux = process.platform === 'linux';
const isMacOS = process.platform === 'darwin';

// Token tracking system for rate limiting
let tokenTracker = {
    tokens: [], // Array of {timestamp, count, type} objects
    audioStartTime: null,

    // Add tokens to the tracker
    addTokens(count, type = 'image') {
        const now = Date.now();
        this.tokens.push({
            timestamp: now,
            count: count,
            type: type,
        });

        // Clean old tokens (older than 1 minute)
        this.cleanOldTokens();
    },

    // Calculate image tokens based on Gemini 2.0 rules
    calculateImageTokens(width, height) {
        // Images ≤384px in both dimensions = 258 tokens
        if (width <= 384 && height <= 384) {
            return 258;
        }

        // Larger images are tiled into 768x768 chunks, each = 258 tokens
        const tilesX = Math.ceil(width / 768);
        const tilesY = Math.ceil(height / 768);
        const totalTiles = tilesX * tilesY;

        return totalTiles * 258;
    },

    // Track audio tokens continuously
    trackAudioTokens() {
        if (!this.audioStartTime) {
            this.audioStartTime = Date.now();
            return;
        }

        const now = Date.now();
        const elapsedSeconds = (now - this.audioStartTime) / 1000;

        // Audio = 32 tokens per second
        const audioTokens = Math.floor(elapsedSeconds * 32);

        if (audioTokens > 0) {
            this.addTokens(audioTokens, 'audio');
            this.audioStartTime = now;
        }
    },

    // Clean tokens older than 1 minute
    cleanOldTokens() {
        const oneMinuteAgo = Date.now() - 60 * 1000;
        this.tokens = this.tokens.filter(token => token.timestamp > oneMinuteAgo);
    },

    // Get total tokens in the last minute
    getTokensInLastMinute() {
        this.cleanOldTokens();
        return this.tokens.reduce((total, token) => total + token.count, 0);
    },

    // Check if we should throttle based on settings
    shouldThrottle() {
        // Get rate limiting settings from localStorage
        const throttleEnabled = localStorage.getItem('throttleTokens') === 'true';
        if (!throttleEnabled) {
            return false;
        }

        const maxTokensPerMin = parseInt(localStorage.getItem('maxTokensPerMin') || '1000000', 10);
        const throttleAtPercent = parseInt(localStorage.getItem('throttleAtPercent') || '75', 10);

        const currentTokens = this.getTokensInLastMinute();
        const throttleThreshold = Math.floor((maxTokensPerMin * throttleAtPercent) / 100);

        console.log(`Token check: ${currentTokens}/${maxTokensPerMin} (throttle at ${throttleThreshold})`);

        return currentTokens >= throttleThreshold;
    },

    // Reset the tracker
    reset() {
        this.tokens = [];
        this.audioStartTime = null;
    },
};

// Track audio tokens every few seconds
setInterval(() => {
    tokenTracker.trackAudioTokens();
}, 2000);

function convertFloat32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        // Improved scaling to prevent clipping
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function initializeGemini(profile = 'interview', language = 'en-US') {
    const apiKey = localStorage.getItem('geminiApiKey')?.trim();
    if (apiKey) {
        const success = await ipcRenderer.invoke('initialize-gemini', apiKey, localStorage.getItem('customPrompt') || '', profile, language);
        if (success) {
            cheddar.setStatus('Live');
        } else {
            cheddar.setStatus('error');
        }
    }
}

async function initializeAzureRealtime(profile = 'interview', language = 'en-US') {
    console.log('[renderer] initializeAzureRealtime called - routing to WebSocket implementation', { profile, language });
    return await triggerAzureWebSocketInit(profile, language);
}

let azureWebSocket = null;

// WebSocket-based Azure implementation
async function initializeAzureWebSocket(config) {
    console.log('[renderer] initializeAzureWebSocket called with config:', config);

    // Clear any existing connection
    if (azureWebSocket && azureWebSocket.readyState !== WebSocket.CLOSED) {
        azureWebSocket.close();
        azureWebSocket = null;
    }

    try {
        console.log('[renderer] STEP 1: Creating WebSocket connection...');
        console.log('[renderer] WebSocket URL:', config.websocketUrl.replace(/api-key=[^&]*/, 'api-key=***'));

        azureWebSocket = new WebSocket(config.websocketUrl);
        console.log('[renderer] STEP 1: ✓ WebSocket created');

        return new Promise((resolve, reject) => {
            const connectionTimeout = setTimeout(() => {
                reject(new Error('WebSocket connection timeout'));
            }, 15000);

            azureWebSocket.onopen = () => {
                console.log('[renderer] STEP 2: ✓ WebSocket connection opened');

                // Send session configuration within 10 seconds of connection
                console.log('[renderer] STEP 3: Sending initial session update...');
                const sessionUpdate = {
                    type: 'session.update',
                    session: {
                        voice: 'alloy',
                        instructions: config.customPrompt || '',
                        input_audio_format: 'pcm16',
                        output_audio_format: 'pcm16',
                        input_audio_transcription: {
                            model: 'whisper-1'
                        },
                        turn_detection: {
                            type: 'server_vad'
                        },
                        tools: [],
                        modalities: ['text', 'audio']
                    }
                };

                azureWebSocket.send(JSON.stringify(sessionUpdate));
                console.log('[renderer] STEP 3: ✓ Session update sent');

                clearTimeout(connectionTimeout);

                // Send success response to main process
                const initResponse = {
                    success: true,
                    sessionId: 'websocket-session-' + Date.now()
                };

                ipcRenderer.send('azure-websocket-initialized', initResponse);
                resolve();
            };

            azureWebSocket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    console.log('[renderer] WebSocket message:', message.type);

                    // Handle Azure realtime events and forward to main process
                    ipcRenderer.send('azure-websocket-event', message);

                    // Process events for UI updates
                    switch (message.type) {
                        case 'session.created':
                            console.log('[renderer] Session created:', message.session?.id);
                            cheddar.setStatus('Connected');
                            break;

                        case 'session.updated':
                            console.log('[renderer] Session updated');
                            break;

                        case 'response.text.delta':
                            if (message.delta) {
                                // Update UI with streaming text
                                if (window.cheddar && window.cheddar.element()) {
                                    window.cheddar.element().setPartialResponse(message.delta);
                                }
                            }
                            break;

                        case 'response.audio.delta':
                            console.log('[renderer] Audio delta received');
                            // Audio deltas can be handled here for playback
                            break;

                        case 'response.done':
                            console.log('[renderer] Response completed');
                            cheddar.setStatus('Ready');
                            break;

                        case 'input_audio_buffer.speech_started':
                            console.log('[renderer] Speech detected');
                            cheddar.setStatus('Listening...');
                            break;

                        case 'input_audio_buffer.speech_stopped':
                            console.log('[renderer] Speech stopped');
                            break;

                        case 'conversation.item.input_audio_transcription.completed':
                            console.log('[renderer] Transcription:', message.transcript);
                            // Transcription can be displayed in UI if needed
                            break;

                        case 'error':
                            console.error('[renderer] WebSocket error:', message.error);
                            ipcRenderer.send('azure-websocket-error', message.error);
                            cheddar.setStatus('Error: ' + message.error?.message);
                            break;
                    }
                } catch (error) {
                    console.error('[renderer] Error parsing WebSocket message:', error);
                }
            };

            azureWebSocket.onerror = (error) => {
                console.error('[renderer] WebSocket error:', error);
                clearTimeout(connectionTimeout);
                reject(new Error('WebSocket connection failed'));
            };

            azureWebSocket.onclose = (event) => {
                console.log('[renderer] WebSocket closed:', event.code, event.reason);
                if (event.code !== 1000) { // Not a normal closure
                    console.error('[renderer] WebSocket closed unexpectedly');
                }
            };
        });

    } catch (error) {
        console.error('[renderer] WebSocket initialization failed:', error);

        // Send error response to main process
        const errorResponse = {
            success: false,
            error: error.message
        };

        ipcRenderer.send('azure-websocket-initialized', errorResponse);
        throw error;
    }
}

function closeAzureWebSocket() {
    if (azureWebSocket) {
        console.log('[renderer] Closing Azure WebSocket...');
        azureWebSocket.close();
        azureWebSocket = null;
    }
}

// Wrapper function that triggers WebSocket service initialization in main process
// Do NOT await this - it triggers async initialization that will respond via 'initialize-azure-websocket' IPC
function triggerAzureWebSocketInit(profile = 'interview', language = 'en-US') {
    console.log('[renderer] triggerAzureWebSocketInit called', { profile, language });

    const azureApiKey = localStorage.getItem('azureApiKey')?.trim();
    const azureEndpoint = localStorage.getItem('azureEndpoint')?.trim();
    const azureDeployment = localStorage.getItem('azureDeployment') || 'gpt-realtime';
    const azureRegion = localStorage.getItem('azureRegion')?.trim() || 'eastus2';

    console.log('[renderer] Azure credentials from localStorage:', {
        hasApiKey: !!azureApiKey,
        hasEndpoint: !!azureEndpoint,
        deployment: azureDeployment,
        region: azureRegion
    });

    if (azureApiKey && azureEndpoint && azureRegion) {
        console.log('[renderer] Invoking initialize-azure-realtime IPC call');
        // Fire and forget - this will start the service creation in main process
        ipcRenderer.invoke('initialize-azure-realtime', azureApiKey, azureEndpoint, azureDeployment, azureRegion,
                          localStorage.getItem('customPrompt') || '', profile, language)
            .then(success => {
                console.log('[renderer] initialize-azure-realtime IPC call result:', success);
                // The status will be updated via other IPC channels during initialization
            })
            .catch(error => {
                console.error('[renderer] Error in initialize-azure-realtime IPC call:', error);
                cheddar.setStatus('error');
            });
    } else {
        console.error('[renderer] Azure credentials incomplete. Required: azureApiKey, azureEndpoint, azureRegion');
        console.log('[renderer] Current values - apiKey:', azureApiKey, 'endpoint:', azureEndpoint, 'region:', azureRegion);
        cheddar.setStatus('error');
    }
}

// Azure OpenAI text message handler
async function sendAzureTextMessage(text) {
    if (!text || text.trim().length === 0) {
        console.warn('Cannot send empty text message');
        return { success: false, error: 'Empty message' };
    }

    try {
        const result = await ipcRenderer.invoke('send-azure-text-message', text);
        if (result.success) {
            console.log('Text message sent successfully to Azure OpenAI');
            // Update the response in the UI
            if (result.response) {
                cheddar.setResponse(result.response);
            }
        } else {
            console.error('Failed to send message to Azure OpenAI:', result.error);
        }
        return result;
    } catch (error) {
        console.error('Error sending text message to Azure OpenAI:', error);
        return { success: false, error: error.message };
    }
}

// Close Azure session
async function closeAzureSession() {
    try {
        const result = await ipcRenderer.invoke('close-azure-session');
        if (result.success) {
            console.log('Azure session closed successfully');
        } else {
            console.error('Failed to close Azure session:', result.error);
        }
        return result;
    } catch (error) {
        console.error('Error closing Azure session:', error);
        return { success: false, error: error.message };
    }
}

// Listen for status updates
ipcRenderer.on('update-status', (event, status) => {
    console.log('Status update:', status);
    cheddar.setStatus(status);
});

// Listen for responses from both Gemini and Azure
ipcRenderer.on('update-response', (event, response) => {
    console.log('LLM response received:', response ? '***' : 'NO RESPONSE');
    if (cheddar.e() && cheddar.e().setResponse) {
        cheddar.e().setResponse(response);
    }
});

async function startCapture(screenshotIntervalSeconds = 5, imageQuality = 'medium') {
    // Store the image quality for manual screenshots
    currentImageQuality = imageQuality;

    // Reset token tracker when starting new capture session
    tokenTracker.reset();
    console.log('🎯 Token tracker reset for new capture session');

    const audioMode = localStorage.getItem('audioMode') || 'speaker_only';

    try {
        await ipcRenderer.invoke('set-audio-mode', audioMode);
    } catch (error) {
        console.warn('Failed to update audio mode in main process:', error);
    }

    try {
        if (isMacOS) {
            // On macOS, use SystemAudioDump for audio and getDisplayMedia for screen
            console.log('Starting macOS capture with SystemAudioDump...');

            // Start macOS audio capture
            const audioResult = await ipcRenderer.invoke('start-macos-audio');
            if (!audioResult.success) {
                throw new Error('Failed to start macOS audio capture: ' + audioResult.error);
            }

            // Get screen capture for screenshots
            mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    frameRate: 1,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false, // Don't use browser audio on macOS
            });

            console.log('macOS screen capture started - audio handled by SystemAudioDump');

            if (audioMode === 'mic_only' || audioMode === 'both') {
                let micStream = null;
                try {
                    micStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            sampleRate: SAMPLE_RATE,
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                        },
                        video: false,
                    });
                    console.log('macOS microphone capture started');
                    setupLinuxMicProcessing(micStream);
                } catch (micError) {
                    console.warn('Failed to get microphone access on macOS:', micError);
                }
            }
        } else if (isLinux) {
            // Linux - use display media for screen capture and try to get system audio
            try {
                // First try to get system audio via getDisplayMedia (works on newer browsers)
                mediaStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        frameRate: 1,
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: {
                        sampleRate: SAMPLE_RATE,
                        channelCount: 1,
                        echoCancellation: false, // Don't cancel system audio
                        noiseSuppression: false,
                        autoGainControl: false,
                    },
                });

                console.log('Linux system audio capture via getDisplayMedia succeeded');

                // Setup audio processing for Linux system audio
                setupLinuxSystemAudioProcessing();
            } catch (systemAudioError) {
                console.warn('System audio via getDisplayMedia failed, trying screen-only capture:', systemAudioError);

                // Fallback to screen-only capture
                mediaStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        frameRate: 1,
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: false,
                });
            }

            // Additionally get microphone input for Linux based on audio mode
            if (audioMode === 'mic_only' || audioMode === 'both') {
                let micStream = null;
                try {
                    micStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            sampleRate: SAMPLE_RATE,
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                        },
                        video: false,
                    });

                    console.log('Linux microphone capture started');

                    // Setup audio processing for microphone on Linux
                    setupLinuxMicProcessing(micStream);
                } catch (micError) {
                    console.warn('Failed to get microphone access on Linux:', micError);
                    // Continue without microphone if permission denied
                }
            }

            console.log('Linux capture started - system audio:', mediaStream.getAudioTracks().length > 0, 'microphone mode:', audioMode);
        } else {
            // Windows - use display media with loopback for system audio
            mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    frameRate: 1,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: {
                    sampleRate: SAMPLE_RATE,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            console.log('Windows capture started with loopback audio');

            // Setup audio processing for Windows loopback audio only
            setupWindowsLoopbackProcessing();

            if (audioMode === 'mic_only' || audioMode === 'both') {
                let micStream = null;
                try {
                    micStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            sampleRate: SAMPLE_RATE,
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                        },
                        video: false,
                    });
                    console.log('Windows microphone capture started');
                    setupLinuxMicProcessing(micStream);
                } catch (micError) {
                    console.warn('Failed to get microphone access on Windows:', micError);
                }
            }
        }

        console.log('MediaStream obtained:', {
            hasVideo: mediaStream.getVideoTracks().length > 0,
            hasAudio: mediaStream.getAudioTracks().length > 0,
            videoTrack: mediaStream.getVideoTracks()[0]?.getSettings(),
        });

        // Start capturing screenshots - check if manual mode
        if (screenshotIntervalSeconds === 'manual' || screenshotIntervalSeconds === 'Manual') {
            console.log('Manual mode enabled - screenshots will be captured on demand only');
            // Don't start automatic capture in manual mode
        } else {
            const intervalMilliseconds = parseInt(screenshotIntervalSeconds) * 1000;
            screenshotInterval = setInterval(() => captureScreenshot(imageQuality), intervalMilliseconds);

            // Capture first screenshot immediately
            setTimeout(() => captureScreenshot(imageQuality), 100);
        }
    } catch (err) {
        console.error('Error starting capture:', err);
        cheddar.setStatus('error');
    }
}

function setupLinuxMicProcessing(micStream) {
    // Setup microphone audio processing for Linux
    const micAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const micSource = micAudioContext.createMediaStreamSource(micStream);
    const micProcessor = micAudioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    let audioBuffer = [];
    const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

    micProcessor.onaudioprocess = async e => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(...inputData);

        // Process audio in chunks
        while (audioBuffer.length >= samplesPerChunk) {
            const chunk = audioBuffer.splice(0, samplesPerChunk);
            const pcmData16 = convertFloat32ToInt16(chunk);
            const base64Data = arrayBufferToBase64(pcmData16.buffer);

            await ipcRenderer.invoke('send-mic-audio-content', {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            });
        }
    };

    micSource.connect(micProcessor);
    micProcessor.connect(micAudioContext.destination);

    // Store processor reference for cleanup
    micAudioProcessor = micProcessor;
}

function setupLinuxSystemAudioProcessing() {
    // Setup system audio processing for Linux (from getDisplayMedia)
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = audioContext.createMediaStreamSource(mediaStream);
    audioProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    let audioBuffer = [];
    const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

    audioProcessor.onaudioprocess = async e => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(...inputData);

        // Process audio in chunks
        while (audioBuffer.length >= samplesPerChunk) {
            const chunk = audioBuffer.splice(0, samplesPerChunk);
            const pcmData16 = convertFloat32ToInt16(chunk);
            const base64Data = arrayBufferToBase64(pcmData16.buffer);

            await ipcRenderer.invoke('send-audio-content', {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            });
        }
    };

    source.connect(audioProcessor);
    audioProcessor.connect(audioContext.destination);
}

function setupWindowsLoopbackProcessing() {
    // Setup audio processing for Windows loopback audio only
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = audioContext.createMediaStreamSource(mediaStream);
    audioProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    let audioBuffer = [];
    const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

    audioProcessor.onaudioprocess = async e => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(...inputData);

        // Process audio in chunks
        while (audioBuffer.length >= samplesPerChunk) {
            const chunk = audioBuffer.splice(0, samplesPerChunk);
            const pcmData16 = convertFloat32ToInt16(chunk);
            const base64Data = arrayBufferToBase64(pcmData16.buffer);

            await ipcRenderer.invoke('send-audio-content', {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            });
        }
    };

    source.connect(audioProcessor);
    audioProcessor.connect(audioContext.destination);
}

async function captureScreenshot(imageQuality = 'medium', isManual = false) {
    console.log(`Capturing ${isManual ? 'manual' : 'automated'} screenshot...`);
    if (!mediaStream) return;

    // Check rate limiting for automated screenshots only
    if (!isManual && tokenTracker.shouldThrottle()) {
        console.log('⚠️ Automated screenshot skipped due to rate limiting');
        return;
    }

    // Lazy init of video element
    if (!hiddenVideo) {
        hiddenVideo = document.createElement('video');
        hiddenVideo.srcObject = mediaStream;
        hiddenVideo.muted = true;
        hiddenVideo.playsInline = true;
        await hiddenVideo.play();

        await new Promise(resolve => {
            if (hiddenVideo.readyState >= 2) return resolve();
            hiddenVideo.onloadedmetadata = () => resolve();
        });

        // Lazy init of canvas based on video dimensions
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = hiddenVideo.videoWidth;
        offscreenCanvas.height = hiddenVideo.videoHeight;
        offscreenContext = offscreenCanvas.getContext('2d');
    }

    // Check if video is ready
    if (hiddenVideo.readyState < 2) {
        console.warn('Video not ready yet, skipping screenshot');
        return;
    }

    offscreenContext.drawImage(hiddenVideo, 0, 0, offscreenCanvas.width, offscreenCanvas.height);

    // Check if image was drawn properly by sampling a pixel
    const imageData = offscreenContext.getImageData(0, 0, 1, 1);
    const isBlank = imageData.data.every((value, index) => {
        // Check if all pixels are black (0,0,0) or transparent
        return index === 3 ? true : value === 0;
    });

    if (isBlank) {
        console.warn('Screenshot appears to be blank/black');
    }

    let qualityValue;
    switch (imageQuality) {
        case 'high':
            qualityValue = 0.9;
            break;
        case 'medium':
            qualityValue = 0.7;
            break;
        case 'low':
            qualityValue = 0.5;
            break;
        default:
            qualityValue = 0.7; // Default to medium
    }

    offscreenCanvas.toBlob(
        async blob => {
            if (!blob) {
                console.error('Failed to create blob from canvas');
                return;
            }

            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64data = reader.result.split(',')[1];

                // Validate base64 data
                if (!base64data || base64data.length < 100) {
                    console.error('Invalid base64 data generated');
                    return;
                }

                const result = await ipcRenderer.invoke('send-image-content', {
                    data: base64data,
                });

                if (result.success) {
                    // Track image tokens after successful send
                    const imageTokens = tokenTracker.calculateImageTokens(offscreenCanvas.width, offscreenCanvas.height);
                    tokenTracker.addTokens(imageTokens, 'image');
                    console.log(`📊 Image sent successfully - ${imageTokens} tokens used (${offscreenCanvas.width}x${offscreenCanvas.height})`);
                } else {
                    console.error('Failed to send image:', result.error);
                }
            };
            reader.readAsDataURL(blob);
        },
        'image/jpeg',
        qualityValue
    );
}

async function captureManualScreenshot(imageQuality = null) {
    console.log('Manual screenshot triggered');
    const quality = imageQuality || currentImageQuality;
    await captureScreenshot(quality, true); // Pass true for isManual
    await new Promise(resolve => setTimeout(resolve, 2000)); // TODO shitty hack
    await sendTextMessage(`Help me on this page, give me the answer no bs, complete answer.
        So if its a code question, give me the approach in few bullet points, then the entire code. Also if theres anything else i need to know, tell me.
        If its a question about the website, give me the answer no bs, complete answer.
        If its a mcq question, give me the answer no bs, complete answer.
        `);
}

// Expose functions to global scope for external access
window.captureManualScreenshot = captureManualScreenshot;

function stopCapture() {
    if (screenshotInterval) {
        clearInterval(screenshotInterval);
        screenshotInterval = null;
    }

    if (audioProcessor) {
        audioProcessor.disconnect();
        audioProcessor = null;
    }

    // Clean up microphone audio processor (Linux only)
    if (micAudioProcessor) {
        micAudioProcessor.disconnect();
        micAudioProcessor = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    // Stop macOS audio capture if running
    if (isMacOS) {
        ipcRenderer.invoke('stop-macos-audio').catch(err => {
            console.error('Error stopping macOS audio:', err);
        });
    }

    // Clean up hidden elements
    if (hiddenVideo) {
        hiddenVideo.pause();
        hiddenVideo.srcObject = null;
        hiddenVideo = null;
    }
    offscreenCanvas = null;
    offscreenContext = null;
}

// Send text message to Gemini
async function sendTextMessage(text) {
    if (!text || text.trim().length === 0) {
        console.warn('Cannot send empty text message');
        return { success: false, error: 'Empty message' };
    }

    try {
        const result = await ipcRenderer.invoke('send-text-message', text);
        if (result.success) {
            console.log('Text message sent successfully');
        } else {
            console.error('Failed to send text message:', result.error);
        }
        return result;
    } catch (error) {
        console.error('Error sending text message:', error);
        return { success: false, error: error.message };
    }
}

// Conversation storage functions using IndexedDB
let conversationDB = null;

async function initConversationStorage() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ConversationHistory', 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            conversationDB = request.result;
            resolve(conversationDB);
        };

        request.onupgradeneeded = event => {
            const db = event.target.result;

            // Create sessions store
            if (!db.objectStoreNames.contains('sessions')) {
                const sessionStore = db.createObjectStore('sessions', { keyPath: 'sessionId' });
                sessionStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

async function saveConversationSession(sessionId, conversationHistory) {
    if (!conversationDB) {
        await initConversationStorage();
    }

    const transaction = conversationDB.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');

    const sessionData = {
        sessionId: sessionId,
        timestamp: parseInt(sessionId),
        conversationHistory: conversationHistory,
        lastUpdated: Date.now(),
    };

    return new Promise((resolve, reject) => {
        const request = store.put(sessionData);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

async function getConversationSession(sessionId) {
    if (!conversationDB) {
        await initConversationStorage();
    }

    const transaction = conversationDB.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');

    return new Promise((resolve, reject) => {
        const request = store.get(sessionId);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

async function getAllConversationSessions() {
    if (!conversationDB) {
        await initConversationStorage();
    }

    const transaction = conversationDB.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');
    const index = store.index('timestamp');

    return new Promise((resolve, reject) => {
        const request = index.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            // Sort by timestamp descending (newest first)
            const sessions = request.result.sort((a, b) => b.timestamp - a.timestamp);
            resolve(sessions);
        };
    });
}

// Listen for conversation data from main process
ipcRenderer.on('save-conversation-turn', async (event, data) => {
    try {
        await saveConversationSession(data.sessionId, data.fullHistory);
        console.log('Conversation session saved:', data.sessionId);
    } catch (error) {
        console.error('Error saving conversation session:', error);
    }
});

// Initialize conversation storage when renderer loads
initConversationStorage().catch(console.error);

// Listen for emergency erase command from main process
ipcRenderer.on('clear-sensitive-data', () => {
    console.log('Clearing renderer-side sensitive data...');
    localStorage.removeItem('apiKey');
    localStorage.removeItem('customPrompt');
    // Consider clearing IndexedDB as well for full erasure
});

// Handle shortcuts based on current view
function handleShortcut(shortcutKey) {
    const currentView = cheddar.getCurrentView();

    if (shortcutKey === 'ctrl+enter' || shortcutKey === 'cmd+enter') {
        if (currentView === 'main') {
            cheddar.element().handleStart();
        } else {
            captureManualScreenshot();
        }
    }
}

let azureWebRTCConnection = null;
let azureDataChannel = null;

async function initializeAzureWebRTC(config) {
    console.log('[renderer] initializeAzureWebRTC called with config:', config);

    // Clear any existing connection
    if (azureWebRTCConnection) {
        azureWebRTCConnection.close();
        azureWebRTCConnection = null;
    }

    try {
        // STEP 1: Check WebRTC API availability
        console.log('[renderer] STEP 1: Checking WebRTC API availability...');
        if (typeof RTCPeerConnection === 'undefined') {
            throw new Error('WebRTC RTCPeerConnection API not available in this environment');
        }
        console.log('[renderer] STEP 1: ✓ WebRTC RTCPeerConnection is available');

        // STEP 2: Check media devices availability
        console.log('[renderer] STEP 2: Checking media devices API...');
        if (typeof navigator === 'undefined' || typeof navigator.mediaDevices === 'undefined') {
            throw new Error('Media devices API not available in this environment');
        }
        console.log('[renderer] STEP 2: ✓ Media devices API is available');

        // STEP 3: Generate ephemeral API key
        console.log('[renderer] STEP 3: Generating ephemeral API key from:', config.sessionsUrl);
        const ephemeralResponse = await fetch(config.sessionsUrl, {
            method: 'POST',
            headers: {
                'api-key': config.apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: config.deployment,
                voice: 'alloy'
            })
        });

        if (!ephemeralResponse.ok) {
            const errorText = await ephemeralResponse.text();
            throw new Error(`Ephemeral key request failed: HTTP ${ephemeralResponse.status} - ${errorText}`);
        }

        const ephemeralData = await ephemeralResponse.json();
        if (!ephemeralData.id || !ephemeralData.client_secret?.value) {
            throw new Error('Invalid ephemeral key response - missing required fields');
        }
        console.log('[renderer] STEP 3: ✓ Ephemeral key generated successfully (session:', ephemeralData.id, ')');

        // STEP 4: Create WebRTC peer connection
        console.log('[renderer] STEP 4: Creating WebRTC peer connection...');
        azureWebRTCConnection = new RTCPeerConnection();
        console.log('[renderer] STEP 4: ✓ RTCPeerConnection created');

        // STEP 5: Set up data channel for realtime events
        console.log('[renderer] STEP 5: Setting up data channel...');
        azureDataChannel = azureWebRTCConnection.createDataChannel('realtime-channel');
        console.log('[renderer] STEP 5: ✓ Data channel created');

        azureDataChannel.addEventListener('open', () => {
            console.log('[renderer] Data channel opened');
            // Note: In Azure WebRTC, initial session.update calls are ignored.
            // Session is created during SDP exchange. We will send session update
            // AFTER WebRTC connection is fully established.
        });

        azureDataChannel.addEventListener('message', (event) => {
            const realtimeEvent = JSON.parse(event.data);
            console.log('[renderer] WebRTC realtime event:', realtimeEvent.type);

            // Handle realtime events via IPC
            ipcRenderer.send('azure-webrtc-event', realtimeEvent);

            // Process realtime events for UI feedback
            switch (realtimeEvent.type) {
                case 'session.created':
                    console.log('[renderer] Session created:', realtimeEvent.session?.id);
                    break;
                case 'session.updated':
                    console.log('[renderer] Session updated');
                    break;
                case 'response.created':
                    console.log('[renderer] Response created');
                    break;
                case 'response.text.delta':
                    const deltaText = realtimeEvent.delta;
                    if (deltaText) {
                        // Update streaming response
                        if (window.cheddar && window.cheddar.element()) {
                            // Accumulate text deltas (this is simplified - real implementation would track response state)
                            window.cheddar.element().setPartialResponse(deltaText);
                        }
                    }
                    break;
                case 'response.audio.delta':
                    console.log('[renderer] Audio delta received');
                    break;
                case 'response.done':
                    console.log('[renderer] Response completed');
                    break;
                case 'input_audio_buffer.speech_started':
                    console.log('[renderer] Speech detected');
                    break;
                case 'input_audio_buffer.speech_stopped':
                    console.log('[renderer] Speech stopped');
                    break;
                case 'conversation.item.input_audio_transcription.completed':
                    console.log('[renderer] Transcription:', realtimeEvent.transcript);
                    break;
                case 'error':
                    console.error('[renderer] WebRTC error:', realtimeEvent.error);
                    ipcRenderer.send('azure-webrtc-error', realtimeEvent.error);
                    break;
            }
        });

        azureDataChannel.addEventListener('close', () => {
            console.log('[renderer] Data channel closed');
        });

        // Handle ICE candidates
        azureWebRTCConnection.addEventListener('icecandidate', event => {
            if (event.candidate) {
                console.log('[renderer] ICE candidate:', event.candidate);
            }
        });

        // Handle connection state changes
        azureWebRTCConnection.addEventListener('connectionstatechange', () => {
            console.log('[renderer] WebRTC connection state:', azureWebRTCConnection.connectionState);
        });

        // Handle remote audio tracks
        azureWebRTCConnection.addEventListener('track', event => {
            console.log('[renderer] Remote track received:', event.track.kind);

            if (event.track.kind === 'audio') {
                const audioElement = document.createElement('audio');
                audioElement.autoplay = true;
                audioElement.srcObject = new MediaStream([event.track]);
                document.body.appendChild(audioElement);

                console.log('[renderer] Remote audio track set up');
            }
        });

        // STEP 6: Generate WebRTC offer
        console.log('[renderer] STEP 6: Generating WebRTC offer...');
        const offer = await azureWebRTCConnection.createOffer();
        console.log('[renderer] STEP 6: ✓ Offer created');

        // STEP 7: Set local description
        console.log('[renderer] STEP 7: Setting local description...');
        await azureWebRTCConnection.setLocalDescription(offer);
        console.log('[renderer] STEP 7: ✓ Local description set');

        // STEP 8: Send SDP offer to Azure WebRTC service
        console.log('[renderer] STEP 8: Sending SDP offer to Azure WebRTC service...');
        const fullWebRTCUrl = `${config.webrtcUrl}?model=${config.deployment}`;
        console.log('[renderer] WebRTC URL:', fullWebRTCUrl);

        const sdpResponse = await fetch(fullWebRTCUrl, {
            method: 'POST',
            body: offer.sdp,
            headers: {
                'Authorization': `Bearer ${ephemeralData.client_secret?.value}`,
                'Content-Type': 'application/sdp',
            },
        });

        if (!sdpResponse.ok) {
            const errorText = await sdpResponse.text();
            throw new Error(`Azure WebRTC SDP response failed: HTTP ${sdpResponse.status} - ${errorText}`);
        }

        const answerSdp = await sdpResponse.text();
        console.log('[renderer] STEP 8: ✓ Answer SDP received from Azure');
        console.log('[renderer] Answer SDP length:', answerSdp.length);

        // STEP 9: Set remote description and establish WebRTC connection
        console.log('[renderer] STEP 9: Setting remote description...');
        const answer = { type: 'answer', sdp: answerSdp };
        await azureWebRTCConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('[renderer] STEP 9: ✓ Remote description set - WebRTC connection established');

        // STEP 10: Wait for connection stabilization and send session update
        console.log('[renderer] STEP 10: Waiting for WebRTC connection to stabilize...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('[renderer] STEP 10: ✓ WebRTC connection stabilized');

        // Now send Azure-compatible session update (v0.0.17 working structure per GitHub #466)
        if (azureDataChannel && azureDataChannel.readyState === 'open') {
            // Use the Azure-compatible session.update structure (v0.0.17 working version)
            // Only include fields with values, no banned fields, minimal structure
            const session = {};

            // Azure-accepted fields only - conditionally added per v0.0.17 working pattern
            if (config.deployment) session.model = config.deployment;
            if (config.customPrompt) session.instructions = config.customPrompt;
            session.tools = []; // Always include empty tools array (required)
            session.tool_choice = 'none'; // Always include
            session.voice = 'alloy'; // Always include
            session.modalities = ['text', 'audio']; // Azure requires both, not audio-only

            // NO banned fields: type, output_modalities, turn_detection, tracing
            // NO experimental fields: input_audio_format, output_audio_format, temperature

            const sessionUpdate = {
                type: 'session.update',
                session: session  // Use the minimal session object
            };

            azureDataChannel.send(JSON.stringify(sessionUpdate));
            console.log('[renderer] Azure v0.0.17-compatible session update sent after WebRTC connection');
        }

        // Send success response back through IPC to main process
        const initResponse = {
            success: true,
            sessionId: ephemeralData.id,
            ephemeralKey: ephemeralData.client_secret?.value
        };

        ipcRenderer.send('azure-webrtc-initialized', initResponse);

    } catch (error) {
        console.error('[renderer] WebRTC initialization failed:', error);

        // Send error response to main process
        const errorResponse = {
            success: false,
            error: error.message
        };

        ipcRenderer.send('azure-webrtc-initialized', errorResponse);
    }
}

function closeAzureWebRTC() {
    if (azureDataChannel) {
        azureDataChannel.close();
        azureDataChannel = null;
    }

    if (azureWebRTCConnection) {
        azureWebRTCConnection.close();
        azureWebRTCConnection = null;
    }
}

// IPC handlers for WebSocket commands
console.log('[renderer] Registering Azure WebSocket IPC handlers...');

// IPC handler for WebSocket initialization
ipcRenderer.on('initialize-azure-websocket', (event, config) => {
    console.log('[renderer] RECEIVED initialize-azure-websocket IPC message with config:', config);
    initializeAzureWebSocket(config);
});

// IPC handler for sending text messages
ipcRenderer.on('azure-websocket-send-text', (event, { text }) => {
    console.log('[renderer] RECEIVED azure-websocket-send-text IPC message:', text.substring(0, 50) + '...');
    if (azureWebSocket && azureWebSocket.readyState === WebSocket.OPEN) {
        const messageEvent = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [{
                    type: 'input_text',
                    text: text
                }]
            }
        };
        azureWebSocket.send(JSON.stringify(messageEvent));

        // Trigger response creation
        const responseEvent = { type: 'response.create' };
        azureWebSocket.send(JSON.stringify(responseEvent));
        console.log('[renderer] Text message and response.create sent via WebSocket');
    } else {
        console.error('[renderer] WebSocket not open or available for sending text');
    }
});

// IPC handler for sending audio messages
ipcRenderer.on('azure-websocket-send-audio', (event, { audio }) => {
    console.log('[renderer] RECEIVED azure-websocket-send-audio IPC message, audio length:', audio.length);
    if (azureWebSocket && azureWebSocket.readyState === WebSocket.OPEN) {
        // Send audio buffer append
        const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: audio
        };
        azureWebSocket.send(JSON.stringify(audioAppend));

        // Commit audio buffer for turn detection
        const commitEvent = { type: 'input_audio_buffer.commit' };
        azureWebSocket.send(JSON.stringify(commitEvent));

        // Trigger response creation
        const responseEvent = { type: 'response.create' };
        azureWebSocket.send(JSON.stringify(responseEvent));
        console.log('[renderer] Audio message (append, commit, create) sent via WebSocket');
    } else {
        console.error('[renderer] WebSocket not open or available for sending audio');
    }
});

// IPC handler for closing WebSocket connection
ipcRenderer.on('azure-websocket-close', () => {
    console.log('[renderer] RECEIVED azure-websocket-close IPC message');
    closeAzureWebSocket();
});

console.log('[renderer] Azure WebSocket IPC handlers registered successfully');

// Make WebRTC init function globally available
window.initializeAzureWebRTC = initializeAzureWebRTC;

// Create reference to the main app element
const soundBoardApp = document.querySelector('sound-board-app');

// Consolidated cheddar object - all functions in one place
const cheddar = {
    // Element access
    element: () => soundBoardApp,
    e: () => soundBoardApp,

    // App state functions - access properties directly from the app element
    getCurrentView: () => soundBoardApp.currentView,
    getLayoutMode: () => soundBoardApp.layoutMode,

    // Status and response functions
    setStatus: text => soundBoardApp.setStatus(text),
    setResponse: response => soundBoardApp.setResponse(response),

    // Core functionality
    initializeGemini,
    initializeAzureRealtime,
    startCapture,
    stopCapture,
    sendTextMessage,
    sendAzureTextMessage,
    closeAzureSession,
    handleShortcut,

    // Conversation history functions
    getAllConversationSessions,
    getConversationSession,
    initConversationStorage,

    // Content protection function
    getContentProtection: () => {
        const contentProtection = localStorage.getItem('contentProtection');
        return contentProtection !== null ? contentProtection === 'true' : true;
    },

    // Platform detection
    isLinux: isLinux,
    isMacOS: isMacOS,
};

// Make it globally available
window.cheddar = cheddar;
