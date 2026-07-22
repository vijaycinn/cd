const { LLMService } = require('./llm.js');
const { BrowserWindow, ipcMain } = require('electron');
const WebSocket = require('ws');
const { loadAzureRealtimeSettings } = require('../config/azureRealtimeSettings.js');
const { defaultRegistry: mcpRegistry } = require('./mcpRegistry.js');
const { SessionContextManager } = require('./sessionContextManager.js');

class AzureRealtimeWebSocketService extends LLMService {
    constructor(apiKey, endpoint, deployment, region, customPrompt, profile, language, options = {}) {
        super(apiKey, customPrompt, profile, language);

        console.log('[AzureWebSocket] Initializing Azure OpenAI WebSocket Service (manual implementation)');
        console.log('[AzureWebSocket] Raw endpoint:', endpoint);

        this.azureRealtimeSettings = loadAzureRealtimeSettings();
        this.runtimeOptions = options && typeof options === 'object' ? options : {};
        this.voiceProvider = this.getConfiguredVoiceProvider(this.runtimeOptions.voiceProvider);
        this.enableWebIQ = this.resolveBooleanOption(this.runtimeOptions.enableWebIQ, false);
        this.warnedMissingWebIQKey = false;
        this.lastTurnWasQuestion = false;
        this.isReplayingContext = false;
        this.contextReplayAttempts = 0;
        this.mcpRegistry = mcpRegistry;
        this.sessionContext = new SessionContextManager();

        // Parse the endpoint to extract hostname and path
        let hostname = endpoint;
        let basePath = '';
        
        if (endpoint.startsWith('http')) {
            try {
                const url = new URL(endpoint);
                hostname = url.hostname;
                basePath = url.pathname.replace(/\/$/, ''); // Remove trailing slash
                console.log('[AzureWebSocket] Extracted hostname:', hostname);
                console.log('[AzureWebSocket] Extracted base path:', basePath);
            } catch (error) {
                console.warn('[AzureWebSocket] Failed to parse endpoint URL, using as-is:', endpoint);
                hostname = endpoint.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
            }
        }

        const isCognitiveServicesEndpoint = hostname.includes('.cognitiveservices.azure.com');
        const isOpenAiEndpoint = hostname.includes('.openai.azure.com');

        let websocketHost = hostname;

        // Transform cognitiveservices domain to openai domain for Realtime API
        if (!this.isVoiceLiveProvider() && isCognitiveServicesEndpoint && !isOpenAiEndpoint) {
            websocketHost = hostname.replace('.cognitiveservices.azure.com', '.openai.azure.com');
            console.log('[AzureWebSocket] Transformed hostname from:', hostname);
            console.log('[AzureWebSocket] Transformed hostname to:', websocketHost);
        } else {
            console.log('[AzureWebSocket] Using endpoint hostname as-is:', websocketHost);
        }

        // Determine if this is a GA or Preview model based on deployment name
        // GA models: gpt-realtime, gpt-realtime-mini, gpt-realtime-mini-2025-12-15
        // Preview models: gpt-4o-realtime-preview, gpt-4o-mini-realtime-preview
        const isPreviewModel = deployment && deployment.includes('preview');
        
        let wsPath;
        const websocketQuery = new URLSearchParams();
        const agentConfig = this.azureRealtimeSettings.voiceLive?.agent;
        this.agentMode = this.isVoiceLiveProvider() && agentConfig?.enabled && agentConfig?.agentName;

        if (this.isVoiceLiveProvider()) {
            wsPath = '/voice-live/realtime';
            const apiVersion = this.azureRealtimeSettings.voiceLive?.apiVersion || '2026-04-10';
            websocketQuery.set('api-version', apiVersion);

            if (this.agentMode) {
                // Agent mode: use agent_name + project_name for server-managed memory
                websocketQuery.set('agent_name', agentConfig.agentName);
                if (agentConfig.projectName) {
                    websocketQuery.set('project_name', agentConfig.projectName);
                }
                if (agentConfig.agentVersion) {
                    websocketQuery.set('agent_version', agentConfig.agentVersion);
                }
                if (agentConfig.conversationId) {
                    websocketQuery.set('conversation_id', agentConfig.conversationId);
                }
                console.log('[AzureWebSocket] Using Voice Live AGENT mode (server-managed memory)');
            } else if (deployment) {
                websocketQuery.set('model', deployment);
                console.log('[AzureWebSocket] Using Voice Live MODEL mode');
            }
            console.log('[AzureWebSocket] Using Voice Live WebSocket endpoint format');
        } else if (isPreviewModel) {
            // Preview version: /openai/realtime?api-version=2025-04-01-preview&deployment=xxx
            wsPath = '/openai/realtime';
            websocketQuery.set('api-version', '2025-04-01-preview');
            if (deployment) {
                websocketQuery.set('deployment', deployment);
            }
            console.log('[AzureWebSocket] Using Preview model endpoint format');
        } else {
            // GA version: /openai/v1/realtime?model=xxx (no api-version needed)
            wsPath = '/openai/v1/realtime';
            if (deployment) {
                websocketQuery.set('model', deployment);
            }
            console.log('[AzureWebSocket] Using GA model endpoint format');
        }

        const queryString = websocketQuery.toString();
        this.websocketUrl = queryString ? `wss://${websocketHost}${wsPath}?${queryString}` : `wss://${websocketHost}${wsPath}`;

        console.log('[AzureWebSocket] Constructed WebSocket URL:', this.websocketUrl);

        this.deployment = deployment;
        this.region = region || null;
        this.customPrompt = customPrompt;
        this.language = language || 'en-US';
        this.apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';

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
        this.audioPaused = false; // Pause state flag
        this.pauseRequested = false; // Pause request pending
        this.resumeRequested = false; // Resume request pending
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
        this.heartbeatTimer = null;
        this.reconnectTimer = null;
        this.sessionRenewTimer = null;
        this.lastServerEventTs = Date.now();
        this.manualClose = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectBaseDelayMs = 1000;
        this.heartbeatIdleMs = 30000;
        this.lastSessionConfig = null;
        this.currentAuthHeaders = null;
        this.currentAuthMode = null;
        this.sessionExpiresAt = null;

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

    resolveBooleanOption(value, fallback = false) {
        if (typeof value === 'boolean') {
            return value;
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

    getConfiguredVoiceProvider(runtimeProvider) {
        const configuredProvider = runtimeProvider || this.azureRealtimeSettings.voiceProvider || 'azure-realtime';
        if (configuredProvider === 'voice-live') {
            return 'voice-live';
        }
        return 'azure-realtime';
    }

    isVoiceLiveProvider() {
        return this.voiceProvider === 'voice-live';
    }

    getVoiceLiveTurnDetectionConfig() {
        const semanticVad = this.azureRealtimeSettings.voiceLive?.semanticVad || {};
        if (semanticVad.enabled === false) {
            return this.getTurnDetectionConfig();
        }

        return {
            type: semanticVad.type || 'azure_semantic_vad_multilingual',
            remove_filler_words: semanticVad.removeFillerWords !== false,
            interrupt_response: semanticVad.interruptResponse !== false,
            auto_truncate: semanticVad.autoTruncate !== false
        };
    }

    getInputTranscriptionConfig() {
        if (this.isVoiceLiveProvider()) {
            const voiceLiveSettings = this.azureRealtimeSettings.voiceLive || {};
            // Per MS Learn docs: 'whisper-1' only works with gpt-realtime/gpt-realtime-mini.
            // For all other models (gpt-5.4, gpt-4.1, etc.) use 'azure-speech' (default, auto-active).
            // 'mai-transcribe' is a preview alternative.
            // https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-how-to#audio-input-transcription
            if (this.deployment && this.deployment.toLowerCase().includes('realtime')) {
                return { model: voiceLiveSettings.realtimeTranscriptionFallback || 'whisper-1' };
            }
            return { model: voiceLiveSettings.transcriptionModel || 'azure-speech' };
        }
        return { model: 'whisper-1' };
    }

    getVoiceLiveVoiceConfig() {
        const voiceConfig = this.azureRealtimeSettings.voiceLive?.voice;
        if (voiceConfig) return voiceConfig;

        // Per MS Learn docs: non-realtime models (gpt-5.4, gpt-4.1, etc.) use Azure
        // standard TTS voices. Realtime models can use OpenAI native voices.
        // https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-how-to#audio-output-through-azure-text-to-speech
        if (this.deployment && this.deployment.toLowerCase().includes('realtime')) {
            return 'alloy'; // OpenAI native voice for realtime models
        }
        return {
            name: 'en-US-Ava:DragonHDLatestNeural',
            type: 'azure-standard',
            temperature: 0.8
        };
    }

    buildSessionInstructions(basePrompt) {
        const contextSnapshot = this.sessionContext ? this.sessionContext.getPromptContext() : '';
        const { TALKING_POINT_PROMPT } = require('./talkingPointPrompt.js');

        let instructions = TALKING_POINT_PROMPT + '\n\n';

        if (contextSnapshot) {
            instructions += '## CONVERSATION CONTEXT\n' + contextSnapshot + '\n\n';
        }

        if (this.sessionContext && this.sessionContext.getLastQuestion()) {
            instructions += '## PRIORITY: The user just asked: "' + this.sessionContext.getLastQuestion() + '"\nAnswer this question directly in your first bullet point.\n\n';
        }

        if (basePrompt) {
            instructions += '## ADDITIONAL INSTRUCTIONS\n' + basePrompt + '\n';
        }

        // Bound total instruction length to ~2000 chars to keep token usage low
        if (instructions.length > 2000) {
            instructions = instructions.slice(0, 1997) + '...';
        }

        return instructions;
    }

    createSessionConfig(tools, groundingConfig = {}) {
        if (this.isVoiceLiveProvider()) {
            const voiceLive = this.azureRealtimeSettings.voiceLive || {};
            const sampleRate = this.azureRealtimeSettings.sampleRate || 24000;
            const requestedModalities = voiceLive.outputModalities || ['text', 'audio'];

            // Build session matching the exact Voice Live API reference structure:
            // https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-api-reference-2026-04-10
            const session = {
                modalities: requestedModalities,
                instructions: this.agentMode ? undefined : this.buildSessionInstructions(this.customPrompt || ''),
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                input_audio_sampling_rate: sampleRate,
                turn_detection: this.getVoiceLiveTurnDetectionConfig(),
                input_audio_transcription: this.getInputTranscriptionConfig(),
                temperature: voiceLive.temperature || 0.8,
                max_response_output_tokens: voiceLive.maxResponseOutputTokens || 200
            };

            // Voice config — required when audio modality is present
            if (requestedModalities.includes('audio')) {
                session.voice = this.getVoiceLiveVoiceConfig();
            }

            // Only include tools if non-empty
            if (tools && tools.length > 0) {
                session.tools = tools;
            }

            // Remove undefined keys (agent mode strips instructions)
            if (session.instructions === undefined) {
                delete session.instructions;
            }

            if (voiceLive.noiseSuppression !== false) {
                session.input_audio_noise_reduction = { type: 'azure_deep_noise_suppression' };
            }
            if (voiceLive.echoCancellation !== false) {
                session.input_audio_echo_cancellation = { type: 'server_echo_cancellation' };
            }

            return {
                type: 'session.update',
                session
            };
        }

        const sessionConfig = {
            type: 'session.update',
            session: {
                type: 'realtime',
                instructions: this.buildSessionInstructions(this.customPrompt || ''),
                output_modalities: ['audio'],
                audio: {
                    input: {
                        transcription: this.getInputTranscriptionConfig(),
                        format: {
                            type: 'audio/pcm',
                            rate: 24000
                        },
                        turn_detection: this.getTurnDetectionConfig()
                    },
                    output: {
                        voice: 'alloy',
                        format: {
                            type: 'audio/pcm',
                            rate: 24000
                        }
                    }
                },
                tools
            }
        };

        if (groundingConfig.data_sources) {
            sessionConfig.session.data_sources = groundingConfig.data_sources;
        }

        return sessionConfig;
    }

    getTurnDetectionConfig() {
        const serverVad = this.azureRealtimeSettings.serverVad;
        
        // Check if server VAD is enabled
        if (serverVad.enabled === false) {
            // VAD disabled - client must manually commit and create responses
            return { type: 'none' };
        }
        
        // Server VAD enabled - use configured type (server_vad, semantic_vad, etc.)
        const vadType = serverVad.type || 'server_vad';

        const turnDetection = {
            type: vadType,
            create_response: serverVad.createResponse !== false // Default true
        };

        if (serverVad.interruptResponse !== undefined) {
            turnDetection.interrupt_response = serverVad.interruptResponse !== false;
        }

        if (vadType === 'semantic_vad') {
            if (serverVad.eagerness) {
                turnDetection.eagerness = serverVad.eagerness;
            }
            return turnDetection;
        }

        turnDetection.threshold = serverVad.threshold;
        turnDetection.prefix_padding_ms = serverVad.prefixPaddingMs;
        turnDetection.silence_duration_ms = serverVad.silenceDurationMs;
        return turnDetection;
    }

    getAzureGroundingConfig() {
        const config = {};
        
        // Azure AI Search grounding (Knowledge Base)
        // Read from localStorage (Electron renderer values)
        const searchEndpoint = (typeof localStorage !== 'undefined' ? localStorage.getItem('azureSearchEndpoint') : null) || null;
        const searchIndex = (typeof localStorage !== 'undefined' ? localStorage.getItem('azureSearchIndex') : null) || null;
        const searchKey = (typeof localStorage !== 'undefined' ? localStorage.getItem('azureSearchKey') : null) || null;
        
        if (searchEndpoint && searchIndex) {
            config.data_sources = [{
                type: 'azure_search',
                parameters: {
                    endpoint: searchEndpoint,
                    index_name: searchIndex,
                    authentication: searchKey ? {
                        type: 'api_key',
                        key: searchKey
                    } : { type: 'system_assigned_managed_identity' },
                    query_type: 'semantic',
                    in_scope: true,
                    top_n_documents: 5,
                    strictness: 3
                }
            }];
            console.log('[AzureWebSocket] Azure AI Search grounding enabled:', searchIndex);
        }
        
        // Web search grounding (Bing)
        const enableWebSearch = (typeof localStorage !== 'undefined' ? localStorage.getItem('azureEnableWebSearch') : null) === 'true';
        if (enableWebSearch) {
            if (!config.data_sources) config.data_sources = [];
            const bingConnectionId = (typeof localStorage !== 'undefined' ? localStorage.getItem('azureBingConnectionId') : null) || 'default';
            config.data_sources.push({
                type: 'bing_grounding',
                parameters: {
                    connection_id: bingConnectionId
                }
            });
            console.log('[AzureWebSocket] Web search grounding enabled');
        }
        
        return config;
    }

    getAzureTools() {
        const tools = [];
        
        // Load custom function tools from localStorage
        // Example: Your deployed Azure AI Foundry tools
        const customToolsJson = typeof localStorage !== 'undefined' ? localStorage.getItem('azureCustomTools') : null;
        if (customToolsJson) {
            try {
                const customTools = JSON.parse(customToolsJson);
                if (Array.isArray(customTools)) {
                    tools.push(...customTools);
                    console.log(`[AzureWebSocket] Loaded ${customTools.length} custom tools`);
                } else {
                    console.warn('[AzureWebSocket] Custom tools is not an array, ignoring');
                }
            } catch (error) {
                console.warn('[AzureWebSocket] Failed to parse custom tools:', error.message);
            }
        }
        
        // Note: MCP tools are loaded asynchronously via getAzureToolsAsync()
        // This method returns only localStorage tools for backward compatibility
        
        return tools;
    }

    /**
     * Get tools including MCP tools (async)
     * Call this during session initialization to include MCP tools
     */
    async getAzureToolsAsync() {
        const tools = this.getAzureTools(); // Get localStorage tools

        try {
            if (this.isVoiceLiveProvider()) {
                const nativeTools = this.getVoiceLiveNativeMCPTools();
                if (nativeTools.length > 0) {
                    console.log(`[AzureWebSocket] Loaded ${nativeTools.length} native Voice Live MCP tool server(s)`);
                    tools.push(...nativeTools);
                }
                return tools;
            }

            this.configureMCPRegistry();
            await this.mcpRegistry.connectAll();
            const mcpTools = this.mcpRegistry.getTools();
            if (mcpTools.length > 0) {
                console.log(`[AzureWebSocket] Loaded ${mcpTools.length} MCP tool(s) from registry`);
                tools.push(...mcpTools);
            }
        } catch (error) {
            console.warn('[AzureWebSocket] Error loading MCP tools:', error.message);
        }
        
        return tools;
    }

    configureMCPRegistry() {
        const mcpSettings = this.azureRealtimeSettings.mcp || {};
        this.mcpRegistry.reset();

        if (mcpSettings.microsoftLearn?.enabled !== false) {
            this.mcpRegistry.registerServer({
                id: 'microsoftLearn',
                url: mcpSettings.microsoftLearn?.url || 'https://learn.microsoft.com/api/mcp',
                toolPrefix: '',
                enabled: true
            });
        }

        const webiqSettings = mcpSettings.webiq || {};
        if (webiqSettings.enabled && this.enableWebIQ) {
            const resolvedKey = webiqSettings._resolvedKey;
            if (resolvedKey) {
                this.mcpRegistry.registerServer({
                    id: 'webiq',
                    url: webiqSettings.url || 'https://api.microsoft.ai/v3/mcp',
                    headers: { 'x-apikey': resolvedKey },
                    toolPrefix: webiqSettings.toolPrefix || 'webiq',
                    allowedTools: webiqSettings.allowedTools,
                    enabled: true
                });
            } else if (!this.warnedMissingWebIQKey) {
                console.warn('[AzureWebSocket] WebIQ enabled but no WEBIQ_API_KEY or settings apiKey resolved; skipping WebIQ MCP');
                this.warnedMissingWebIQKey = true;
            }
        }
    }

    getVoiceLiveNativeMCPTools() {
        const mcpSettings = this.azureRealtimeSettings.mcp || {};
        const tools = [];

        if (mcpSettings.microsoftLearn?.enabled !== false) {
            tools.push({
                type: 'mcp',
                server_label: 'microsoftLearn',
                server_url: mcpSettings.microsoftLearn?.url || 'https://learn.microsoft.com/api/mcp',
                require_approval: 'never'
            });
        }

        const webiqSettings = mcpSettings.webiq || {};
        if (webiqSettings.enabled && this.enableWebIQ) {
            const resolvedKey = webiqSettings._resolvedKey;
            if (resolvedKey) {
                const webiqTool = {
                    type: 'mcp',
                    server_label: webiqSettings.toolPrefix || 'webiq',
                    server_url: webiqSettings.url || 'https://api.microsoft.ai/v3/mcp',
                    headers: { 'x-apikey': resolvedKey },
                    require_approval: 'never'
                };

                if (Array.isArray(webiqSettings.allowedTools) && webiqSettings.allowedTools.length > 0) {
                    webiqTool.allowed_tools = webiqSettings.allowedTools;
                }

                tools.push(webiqTool);
            } else if (!this.warnedMissingWebIQKey) {
                console.warn('[AzureWebSocket] WebIQ enabled but no WEBIQ_API_KEY or settings apiKey resolved; skipping native WebIQ MCP');
                this.warnedMissingWebIQKey = true;
            }
        }

        return tools;
    }

    async resolveAuthHeaders(preferredMode = null) {
        const mode = preferredMode || (this.apiKey ? 'api-key' : 'managed-identity');

        if (mode === 'api-key') {
            if (!this.apiKey) {
                throw new Error('No Azure API key configured');
            }
            return {
                headers: {
                    'api-key': this.apiKey,
                    'User-Agent': 'Azure-OpenAI-Node/1.0'
                },
                mode: 'api-key'
            };
        }

        const azureAuth = require('./azureAuth.js');
        const tokenResult = await azureAuth.getToken();
        return {
            headers: {
                'Authorization': `Bearer ${tokenResult.token}`,
                'User-Agent': 'Azure-OpenAI-Node/1.0'
            },
            mode: 'managed-identity'
        };
    }

    getFallbackAuthMode(primaryMode) {
        if (primaryMode === 'api-key') {
            return 'managed-identity';
        }
        if (primaryMode === 'managed-identity' && this.apiKey) {
            return 'api-key';
        }
        return null;
    }

    shouldRetryWithFallback(error, attemptedMode) {
        const errorCode = error?.details?.error?.code || '';
        const rawMessage = error?.details?.error?.message || error?.message || '';
        const message = String(rawMessage).toLowerCase();

        if (attemptedMode === 'api-key') {
            return errorCode === 'AuthenticationTypeDisabled' || message.includes('key based authentication is disabled');
        }

        if (attemptedMode === 'managed-identity') {
            return errorCode === 'Tenant provided in token does not match resource token' ||
                (message.includes('token tenant') && message.includes('resource tenant'));
        }

        return false;
    }

    async openSocketConnection(authHeaders, authMode) {
        return new Promise((resolve, reject) => {
            this.debugLog('[AzureWebSocket] Creating manual WebSocket connection...');
            this.debugLog('[AzureWebSocket] WebSocket URL:', this.websocketUrl);
            this.currentAuthHeaders = authHeaders;
            this.currentAuthMode = authMode;

            let settled = false;
            const settleReject = (error) => {
                if (!settled) {
                    settled = true;
                    reject(error);
                }
            };
            const settleResolve = (value) => {
                if (!settled) {
                    settled = true;
                    resolve(value);
                }
            };

            // Voice Live does NOT use the 'realtime' subprotocol — connecting with it
            // causes the server to drop the WebSocket immediately (close code 1006).
            // Only the Realtime API path uses the 'realtime' subprotocol.
            const wsOptions = { headers: authHeaders };
            this.socket = this.isVoiceLiveProvider()
                ? new WebSocket(this.websocketUrl, wsOptions)
                : new WebSocket(this.websocketUrl, 'realtime', wsOptions);

            // Capture the HTTP response for better error messages
            this.socket.on('unexpected-response', (req, res) => {
                console.error('[AzureWebSocket] Unexpected server response:', res.statusCode, res.statusMessage);
                let body = '';
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => {
                    console.error('[AzureWebSocket] Response body:', body);
                    let errorData = null;
                    try {
                        errorData = JSON.parse(body);
                        console.error('[AzureWebSocket] Error details:', JSON.stringify(errorData, null, 2));
                    } catch (e) {
                        console.error('[AzureWebSocket] Raw error response:', body);
                    }

                    const handshakeError = new Error(`WebSocket handshake failed: HTTP ${res.statusCode} ${res.statusMessage}`);
                    handshakeError.statusCode = res.statusCode;
                    handshakeError.responseBody = body;
                    handshakeError.details = errorData;
                    handshakeError.authMode = authMode;
                    settleReject(handshakeError);
                });
            });

            this.socket.on('open', () => {
                console.log('[AzureWebSocket] WebSocket connection opened!');
                this.lastServerEventTs = Date.now();
                this.startHeartbeatMonitor();
            });

            this.socket.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.lastServerEventTs = Date.now();
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
                    error.authMode = authMode;
                    settleReject(error);
                }
            });

            this.socket.on('close', (code, reason) => {
                console.log(`[AzureWebSocket] WebSocket closed: code=${code}, reason=${reason.toString()}`);
                const shouldReconnect = !this.manualClose && (this.isInitialized || this.isConnected) && code !== 1000;
                this.isConnected = false;
                this.isInitialized = false;
                this.pendingChunkAccumulator = [];
                this.pendingChunkBytes = 0;
                this.clearFlushTimer();
                this.lastChunkFlushTs = Date.now();
                this.speechActive = false;
                if (this._initTimeout) {
                    clearTimeout(this._initTimeout);
                    this._initTimeout = null;
                }
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Disconnected');
                }
                this.clearHeartbeatMonitor();
                this.clearSessionRenewTimer();
                if (shouldReconnect) {
                    this.scheduleReconnect(`close:${code}`);
                }
                if (!settled) {
                    const closeError = new Error(`WebSocket closed before session.created: code=${code}`);
                    closeError.authMode = authMode;
                    settleReject(closeError);
                }
            });

            // Per MS Learn Voice Live docs: the server sends 'session.created' first.
            // We must wait for that event before sending 'session.update'.
            // Use event-driven approach instead of blind setTimeout.
            // The 'message' handler above calls handleWebSocketMessage which triggers
            // _onSessionCreated → sends session.update → sets isInitialized.
            // We store the promise settle functions so _onSessionCreated can resolve.
            this._initSettleResolve = settleResolve;
            this._initSettleReject = settleReject;

            // Safety timeout: if session.created never arrives within 15s, reject
            this._initTimeout = setTimeout(() => {
                if (!settled) {
                    const timeoutError = new Error('Voice Live session.created not received within 15s');
                    timeoutError.authMode = authMode;
                    settleReject(timeoutError);
                }
            }, 15000);
        });
    }

    /**
     * Called when the server sends session.created — per the official SDK pattern:
     * connect → session.created → send session.update → session.updated → start audio.
     * https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-quickstart
     */
    async _onSessionCreated() {
        if (this._initTimeout) {
            clearTimeout(this._initTimeout);
            this._initTimeout = null;
        }

        try {
            this.debugLog('[AzureWebSocket] Sending initial session configuration...');

            // Get grounding configuration
            const groundingConfig = this.getAzureGroundingConfig();

            // Get tools (including MCP tools) — non-fatal if this fails
            let tools = [];
            try {
                tools = await this.getAzureToolsAsync();
            } catch (toolErr) {
                console.warn('[AzureWebSocket] Tool resolution failed (non-fatal):', toolErr.message);
            }
            console.log(`[AzureWebSocket] Total tools: ${tools.length}`);

            const sessionConfig = this.createSessionConfig(tools, groundingConfig);

            // On reconnect, refresh instructions with current conversation context
            if (!this.isReplayingContext && this.sessionContext && this.sessionContext.rollingTurns.length > 0) {
                this.isReplayingContext = true;
                this.contextReplayAttempts++;
                if (this.contextReplayAttempts > 2) {
                    console.warn('[AzureWebSocket] Max context replay attempts reached; sending session without context');
                } else {
                    const freshInstructions = this.buildSessionInstructions(this.customPrompt || '');
                    if (sessionConfig.session?.instructions) {
                        sessionConfig.session.instructions = freshInstructions;
                    }
                    console.log('[AzureWebSocket] Refreshed session instructions with current context on reconnect');
                }
                this.isReplayingContext = false;
            }

            if (groundingConfig.data_sources) {
                console.log('[AzureWebSocket] Grounding enabled with', groundingConfig.data_sources.length, 'data source(s)');
            }

            console.log('[AzureWebSocket] Sending session configuration:', JSON.stringify(sessionConfig, null, 2));
            this.lastSessionConfig = sessionConfig;
            this.send(sessionConfig);

            if (this.contextReplayAttempts > 0 && this.contextReplayAttempts <= 2 && this.callbacks.onStatus) {
                this.callbacks.onStatus('Context restored');
            }

            this.isInitialized = true;
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.contextReplayAttempts = 0;
            console.log('[AzureWebSocket] Azure WebSocket Realtime service initialized successfully');

            if (this.callbacks.onStatus) {
                this.callbacks.onStatus('Connected');
            }

            if (this._initSettleResolve) {
                this._initSettleResolve(true);
                this._initSettleResolve = null;
                this._initSettleReject = null;
            }
        } catch (err) {
            console.error('[AzureWebSocket] _onSessionCreated failed:', err);
            if (this._initSettleReject) {
                this._initSettleReject(err);
                this._initSettleResolve = null;
                this._initSettleReject = null;
            }
        }
    }

    async init() {
        console.log('[AzureWebSocket] Initializing Azure WebSocket Realtime service (manual implementation)');
        this.manualClose = false;

        // Resolve auth headers before opening the WebSocket.
        // Use configured API key first when present, then auto-fallback on known auth-mode mismatch failures.
        let primaryAuth;
        try {
            primaryAuth = await this.resolveAuthHeaders();
        } catch (authErr) {
            throw new Error(`Azure authentication failed: no usable API key or managed identity token. ${authErr.message}`);
        }

        if (primaryAuth.mode === 'api-key') {
            console.log('[AzureWebSocket] Using API key authentication');
        } else {
            console.log('[AzureWebSocket] Using managed identity bearer token for authentication');
        }

        try {
            try {
                return await this.openSocketConnection(primaryAuth.headers, primaryAuth.mode);
            } catch (primaryError) {
                const fallbackMode = this.getFallbackAuthMode(primaryAuth.mode);
                if (!fallbackMode || !this.shouldRetryWithFallback(primaryError, primaryAuth.mode)) {
                    throw primaryError;
                }

                console.warn(
                    `[AzureWebSocket] Primary auth mode "${primaryAuth.mode}" failed (${primaryError.message}). Retrying with "${fallbackMode}"...`
                );
                const fallbackAuth = await this.resolveAuthHeaders(fallbackMode);
                if (fallbackAuth.mode === 'api-key') {
                    console.log('[AzureWebSocket] Using API key authentication');
                } else {
                    console.log('[AzureWebSocket] Using managed identity bearer token for authentication');
                }

                return await this.openSocketConnection(fallbackAuth.headers, fallbackAuth.mode);
            }
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
                this.sessionContext.startSession(message.session?.id || Date.now().toString());
                // Store conversation_id for agent mode reconnection
                if (message.session?.conversation_id) {
                    this.conversationId = message.session.conversation_id;
                    console.log('[AzureWebSocket] Agent conversation_id:', this.conversationId);
                }
                if (message.session?.expires_at) {
                    this.scheduleSessionRenewal(Number(message.session.expires_at));
                }
                // Per Voice Live protocol: send session.update only AFTER session.created
                this._onSessionCreated();
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

            case 'response.output_text.delta':
                if (typeof message.delta === 'string') {
                    this.textBuffer += message.delta;
                    this.publishTextUpdate();
                }
                break;

            case 'response.output_text.done':
                if (typeof message.text === 'string') {
                    this.textBuffer = message.text;
                    this.publishTextUpdate(true);
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
                    console.log('[AzureWebSocket] Audio transcript delta:', message.delta.substring(0, 100));
                    this.publishTextUpdate();
                }
                break;

            case 'response.audio_transcript.done':
                if (typeof message.transcript === 'string') {
                    this.textBuffer = message.transcript;
                    console.log('[AzureWebSocket] Audio transcript done:', message.transcript.substring(0, 200));
                    this.publishTextUpdate(true);
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
                this.debugLog('[AzureWebSocket] Speech stopped (server VAD) - server will auto-commit');
                // With server VAD enabled, the server automatically commits the buffer.
                // DO NOT manually call commitAudioBuffer() here - it causes buffer size errors.
                // The server will send input_audio_buffer.committed when ready.
                {
                    // Flush any remaining client-side buffered audio chunks to server
                    this.flushAudioAccumulator({ force: true, context: 'speech_stopped' });
                    // Note: No manual commit needed - server VAD handles this automatically
                }
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Processing...');
                }
                break;

            case 'input_audio_buffer.committed':
                this.debugLog('[AzureWebSocket] Server acknowledged audio commit (server auto-committed with VAD)');
                // Server has committed the buffer - audio is now part of conversation
                this.pendingAudioForCommit = false;
                this.bytesSinceLastCommit = 0;
                // conversation.item.created event will follow with the user message item
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
                    if (cleanedTranscript) {
                        this.sessionContext.finalizeUserTurn(cleanedTranscript);
                    }
                    if (cleanedTranscript && this.sessionContext.isQuestion(cleanedTranscript)) {
                        this.lastTurnWasQuestion = true;
                        console.log('[AzureWebSocket] Detected question turn — will prioritize in next response');
                    }
                }
                break;

            case 'response.done':
                console.log('[AzureWebSocket] Response completed');
                // Fallback: extract text from response.done output items if streaming events didn't populate textBuffer
                if (!this.textBuffer && message.response?.output) {
                    for (const item of message.response.output) {
                        if (item.content && Array.isArray(item.content)) {
                            for (const part of item.content) {
                                if (part.transcript) {
                                    this.textBuffer += (this.textBuffer ? '\n' : '') + part.transcript;
                                } else if (part.text) {
                                    this.textBuffer += (this.textBuffer ? '\n' : '') + part.text;
                                }
                            }
                        }
                    }
                    if (this.textBuffer) {
                        console.log('[AzureWebSocket] Extracted text from response.done output:', this.textBuffer.substring(0, 200));
                    }
                }
                if (this.textBuffer) {
                    this.publishTextUpdate(true);
                    this.sessionContext.appendAssistantTurn(this.textBuffer);
                } else {
                    console.warn('[AzureWebSocket] Response completed with empty textBuffer — no text content received');
                }
                this.lastTurnWasQuestion = false;
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

            case 'response.function_call_arguments.delta':
                this.debugLog('[AzureWebSocket] Function call arguments delta:', message);
                // Accumulate function call arguments if needed
                break;

            case 'response.function_call_arguments.done':
                console.log('[AzureWebSocket] Function call completed:', message.name);
                this.handleToolCall(message);
                break;

            case 'mcp_list_tools.in_progress':
            case 'mcp_list_tools.completed':
            case 'mcp_list_tools.failed':
            case 'response.mcp_call.in_progress':
            case 'response.mcp_call.completed':
            case 'response.mcp_call.failed':
                this.debugLog('[AzureWebSocket] Native MCP event:', message.type, this.sanitizeForLog(message));
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
                // Log ALL unhandled events visibly so we can diagnose missing event handlers
                if (message.type && message.type.startsWith('response.')) {
                    console.log('[AzureWebSocket] UNHANDLED response event:', message.type, JSON.stringify(message).substring(0, 500));
                } else {
                    console.log('[AzureWebSocket] Unhandled event:', message.type);
                }
        }
    }

    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    async handleToolCall(message) {
        const functionName = message.name;
        const callId = message.call_id;
        let args = {};

        try {
            args = JSON.parse(message.arguments || '{}');
        } catch (error) {
            console.error('[AzureWebSocket] Failed to parse tool arguments:', error);
            this.sendToolResponse(callId, { error: 'Invalid arguments format' });
            return;
        }

        console.log(`[AzureWebSocket] Executing tool: ${functionName}`, args);

        if (this.mcpRegistry.resolveTool(functionName)) {
            await this.handleRegistryToolCall(callId, functionName, args);
        } else {
            console.warn(`[AzureWebSocket] Unknown tool: ${functionName}`);
            this.sendToolResponse(callId, {
                error: `Tool '${functionName}' is not implemented`
            });
        }
    }

    /**
     * Handle app-side MCP registry tool call
     */
    async handleRegistryToolCall(callId, toolName, args) {
        try {
            console.log(`[AzureWebSocket] Calling MCP registry tool: ${toolName}`, args);

            const timeoutMs = this.azureRealtimeSettings?.mcp?.webiq?.timeoutMs || 2000;
            const result = await Promise.race([
                this.mcpRegistry.callTool(toolName, args),
                new Promise((_, reject) => setTimeout(() => reject(new Error('MCP tool timeout')), timeoutMs))
            ]).catch(error => {
                if (error.message === 'MCP tool timeout') {
                    console.warn(`[AzureWebSocket] MCP tool ${toolName} timed out after ${timeoutMs}ms; responding without grounding`);
                    return { success: false, error: 'timeout' };
                }
                throw error;
            });

            if (!result.success) {
                throw new Error(result.error || 'MCP tool call failed');
            }

            console.log(`[AzureWebSocket] MCP tool result:`, result.content);
            this.sendToolResponse(callId, this.formatMCPContent(result.content));

        } catch (error) {
            console.error(`[AzureWebSocket] MCP tool call failed:`, error);
            this.sendToolResponse(callId, {
                error: error.message
            });
        }
    }

    async handleMCPToolCall(callId, toolName, args) {
        return this.handleRegistryToolCall(callId, toolName, args);
    }

    formatMCPContent(content) {
        if (Array.isArray(content)) {
            return content
                .map(item => this.formatMCPContentItem(item))
                .filter(Boolean)
                .join('\n\n');
        }

        if (typeof content === 'string') {
            return content;
        }

        if (content && typeof content === 'object') {
            return JSON.stringify(content);
        }

        return String(content ?? '');
    }

    formatMCPContentItem(item) {
        if (!item || typeof item !== 'object') {
            return String(item ?? '');
        }

        if (item.type === 'text') {
            return item.text || '';
        }

        if (item.type === 'resource') {
            const resource = item.resource || item;
            const uri = resource.uri || item.uri || 'unknown';
            const text = resource.text || item.text || resource.blob || '';
            return `[Resource: ${uri}]\n${text}`.trim();
        }

        if (item.structuredContent) {
            return JSON.stringify(item.structuredContent);
        }

        return JSON.stringify(item);
    }

    sendToolResponse(callId, output) {
        const outputString = typeof output === 'string' ? output : JSON.stringify(output);

        console.log('[AzureWebSocket] Sending tool response for call:', callId);

        // Send function output to Azure
        this.send({
            type: 'conversation.item.create',
            item: {
                type: 'function_call_output',
                call_id: callId,
                output: outputString
            }
        });

        // Request the AI to continue its response
        this.send({
            type: 'response.create'
        });
    }

    async sendText(text) {
        if (!this.isInitialized || !this.socket) {
            console.warn('[AzureWebSocket] sendText dropped - WebSocket not initialized/connected');
            return false;
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
        // Task 0.1.4: Early exit if paused
        if (this.audioPaused) {
            const now = Date.now();
            if (now - (this._lastPauseWarnTs || 0) > 5000) {
                console.log('[AzureWebSocket] Audio paused - dropping incoming chunks');
                this._lastPauseWarnTs = now;
            }
            return true; // Return success to avoid breaking audio pipeline
        }

        if (!this.isInitialized || !this.socket) {
            // Gracefully drop audio instead of throwing — avoids crashing the
            // audio pipeline when the session hasn't connected or has disconnected.
            const now = Date.now();
            if (now - (this._lastNotInitWarnTs || 0) > 5000) {
                console.warn('[AzureWebSocket] Audio dropped - WebSocket not initialized/connected');
                this._lastNotInitWarnTs = now;
            }
            return true;
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

    /**
     * Task 0.1.2: Pause audio transmission
     * Flushes pending audio and optionally forces commit based on VAD mode
     */
    pauseAudio() {
        if (this.audioPaused) {
            console.log('[AzureWebSocket] Already paused');
            return { success: true, alreadyPaused: true };
        }

        console.log('[AzureWebSocket] Pausing audio transmission...');
        this.audioPaused = true;
        this.pauseRequested = true;

        // Flush any pending audio chunks
        const flushed = this.flushAudioAccumulator();
        console.log('[AzureWebSocket] Flushed %d accumulated chunks on pause', flushed);

        // Force commit if configured and VAD is enabled
        const settings = this.settings?.pauseButton || {};
        if (settings.forceCommitOnPause && this.serverVadEnabled && this.pendingAudioForCommit) {
            console.log('[AzureWebSocket] Forcing commit on pause (VAD enabled)');
            this.commitAudioBuffer('pause_button', { forceTailPadding: true });
        }

        // Update status via callback
        if (this.onStatusUpdate) {
            this.onStatusUpdate('Audio paused');
        }

        console.log('[AzureWebSocket] Audio transmission paused');
        return { success: true, flushedChunks: flushed };
    }

    /**
     * Task 0.1.3: Resume audio transmission
     */
    resumeAudio() {
        if (!this.audioPaused) {
            console.log('[AzureWebSocket] Not paused');
            return { success: true, notPaused: true };
        }

        console.log('[AzureWebSocket] Resuming audio transmission...');
        this.audioPaused = false;
        this.resumeRequested = true;
        this._lastPauseWarnTs = 0; // Reset throttle

        // Clear audio accumulators to start fresh
        this.pendingChunkAccumulator.length = 0;
        this.bytesInPendingChunks = 0;

        // Update status via callback
        if (this.onStatusUpdate) {
            this.onStatusUpdate('Audio resumed');
        }

        console.log('[AzureWebSocket] Audio transmission resumed');
        return { success: true };
    }

    /**
     * Get current pause state
     */
    isPaused() {
        return this.audioPaused;
    }

    clearFlushTimer() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
    }

    clearHeartbeatMonitor() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    startHeartbeatMonitor() {
        this.clearHeartbeatMonitor();
        this.heartbeatTimer = setInterval(() => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                return;
            }

            const idleMs = Date.now() - this.lastServerEventTs;
            if (idleMs > this.heartbeatIdleMs * 2) {
                console.warn(`[AzureWebSocket] No server events for ${idleMs}ms; terminating stale socket`);
                this.socket.terminate();
                return;
            }

            if (idleMs > this.heartbeatIdleMs && typeof this.socket.ping === 'function') {
                this.debugLog('[AzureWebSocket] Sending WebSocket ping after idle period');
                try {
                    this.socket.ping();
                } catch (error) {
                    console.warn('[AzureWebSocket] WebSocket ping failed:', error.message);
                }
            }
        }, Math.max(5000, Math.floor(this.heartbeatIdleMs / 2)));
    }

    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    scheduleReconnect(reason) {
        if (this.manualClose || this.reconnectTimer) {
            return;
        }

        if (this.sessionContext) {
            this.sessionContext.flushToDisk().catch(err =>
                console.warn('[AzureWebSocket] Failed to flush context before reconnect:', err.message)
            );
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            const error = new Error(`Azure WebSocket reconnect failed after ${this.maxReconnectAttempts} attempts (${reason})`);
            console.error('[AzureWebSocket]', error.message);
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
            return;
        }

        this.reconnectAttempts += 1;
        const jitterMs = Math.floor(Math.random() * 250);
        const delayMs = Math.min(30000, this.reconnectBaseDelayMs * (2 ** (this.reconnectAttempts - 1))) + jitterMs;
        console.log(`[AzureWebSocket] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delayMs}ms (${reason})`);
        if (this.callbacks.onStatus) {
            this.callbacks.onStatus('Reconnecting...');
        }

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            try {
                const auth = await this.resolveAuthHeaders(this.currentAuthMode);
                await this.openSocketConnection(auth.headers, auth.mode);
                if (this.callbacks.onStatus) {
                    this.callbacks.onStatus('Connected');
                }
            } catch (error) {
                console.error('[AzureWebSocket] Reconnect attempt failed:', error.message);
                this.scheduleReconnect(`retry-failed:${error.message}`);
            }
        }, delayMs);
    }

    clearSessionRenewTimer() {
        if (this.sessionRenewTimer) {
            clearTimeout(this.sessionRenewTimer);
            this.sessionRenewTimer = null;
        }
    }

    scheduleSessionRenewal(expiresAt) {
        this.clearSessionRenewTimer();
        if (!expiresAt || !Number.isFinite(expiresAt)) {
            return;
        }

        this.sessionExpiresAt = expiresAt;
        const expiresAtMs = expiresAt * 1000;
        const renewAtMs = expiresAtMs - (2 * 60 * 1000);
        const delayMs = renewAtMs - Date.now();
        if (delayMs <= 0) {
            return;
        }

        this.sessionRenewTimer = setTimeout(() => {
            if (this.manualClose || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
                return;
            }
            console.log('[AzureWebSocket] Renewing Azure WebSocket session before server expiry');
            this.socket.close(4000, 'session-renewal');
        }, delayMs);
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
        this.manualClose = true;

        try {
            this.clearFlushTimer();
            this.clearHeartbeatMonitor();
            this.clearReconnectTimer();
            this.clearSessionRenewTimer();
            this.flushAudioAccumulator({ force: true, context: 'close' });

            if (this.sessionContext) {
                await this.sessionContext.flushToDisk();
                this.sessionContext.reset();
            }

            if (this.socket) {
                this.socket.close();
                this.socket = null;
            }

            if (!this.isVoiceLiveProvider()) {
                await this.mcpRegistry.disconnectAll();
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
