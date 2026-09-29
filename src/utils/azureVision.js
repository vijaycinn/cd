const { LLMService } = require('./llm.js');
const { loadAzureRealtimeSettings } = require('../config/azureRealtimeSettings.js');
const OpenAI = require('openai');
const { AzureOpenAI } = require('openai');

class AzureVisionService extends LLMService {
    constructor(apiKey, endpoint, deployment, customPrompt, profile, language) {
        super(apiKey, customPrompt, profile, language);

        this.endpoint = endpoint;
        this.deployment = deployment;
        this.settings = loadAzureRealtimeSettings();

        const baseURL = endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;
        const formattedEndpoint = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
        this.formattedEndpoint = formattedEndpoint;

        // Client is initialized in init() after auth is resolved
        this.client = null;

        this.systemPrompt = customPrompt || this.settings.vision.systemPrompt;
        this.detailLevel = this.settings.vision.detailLevel || 'auto';
        this.maxTokens = this.settings.vision.maxTokens || 1000;
        this.completionTokenParam = this.getPreferredCompletionTokenParam();

        console.log('[AzureVision] Initialized with deployment:', deployment);
        console.log('[AzureVision] Detail level:', this.detailLevel);
        console.log('[AzureVision] Max tokens:', this.maxTokens);
        console.log('[AzureVision] Completion token parameter:', this.completionTokenParam);
    }

    getPreferredCompletionTokenParam() {
        const deploymentName = String(this.deployment || '').toLowerCase();

        // GPT-5 and reasoning-style models require max_completion_tokens on Chat Completions.
        if (deploymentName.includes('gpt-5') || deploymentName.includes('o1') || deploymentName.includes('o3') || deploymentName.includes('o4')) {
            return 'max_completion_tokens';
        }

        return 'max_tokens';
    }

    buildChatCompletionRequest(messages) {
        const request = {
            model: this.deployment,
            messages,
            temperature: 0.7
        };

        request[this.completionTokenParam] = this.maxTokens;
        return request;
    }

    shouldRetryWithAlternateTokenParam(error) {
        const errorMessage = String(error?.message || '').toLowerCase();
        const errorParam = String(error?.param || error?.error?.param || '').toLowerCase();
        const errorCode = String(error?.code || error?.error?.code || '').toLowerCase();

        return errorCode === 'unsupported_parameter'
            && (errorParam === 'max_tokens' || errorParam === 'max_completion_tokens')
            && errorMessage.includes('use')
            && (errorMessage.includes('max_completion_tokens') || errorMessage.includes('max_tokens'));
    }

    async createChatCompletion(messages) {
        if (!this.client) {
            throw new Error('Azure Vision client not initialized');
        }

        const request = this.buildChatCompletionRequest(messages);

        try {
            return await this.client.chat.completions.create(request);
        } catch (error) {
            if (!this.shouldRetryWithAlternateTokenParam(error)) {
                throw error;
            }

            const alternateParam = this.completionTokenParam === 'max_tokens'
                ? 'max_completion_tokens'
                : 'max_tokens';

            console.warn(`[AzureVision] Retrying with ${alternateParam} after unsupported ${this.completionTokenParam}`);

            this.completionTokenParam = alternateParam;
            const retryRequest = this.buildChatCompletionRequest(messages);
            return await this.client.chat.completions.create(retryRequest);
        }
    }

    async init() {
        try {
            if (!this.endpoint || !this.deployment) {
                throw new Error('Missing required Azure Vision configuration (endpoint or deployment)');
            }

            // Try managed identity (azd login / az login) first, then fall back to API key
            try {
                const azureAuth = require('./azureAuth.js');
                await azureAuth.getToken(); // verify credential is resolvable before wiring up the provider
                this.client = new AzureOpenAI({
                    endpoint: this.formattedEndpoint,
                    deployment: this.deployment,
                    apiVersion: '2024-08-01-preview',
                    azureADTokenProvider: async () => {
                        const t = await azureAuth.getToken();
                        return t.token;
                    }
                });
                console.log('[AzureVision] Using managed identity authentication');
            } catch (tokenErr) {
                if (!this.apiKey) {
                    throw new Error(`Azure authentication failed: no managed identity and no API key configured. ${tokenErr.message}`);
                }
                console.warn('[AzureVision] Managed identity unavailable, using API key fallback:', tokenErr.message);
                this.client = new OpenAI({
                    apiKey: this.apiKey,
                    baseURL: `${this.formattedEndpoint}/openai/deployments/${this.deployment}`,
                    defaultQuery: { 'api-version': '2024-08-01-preview' },
                    defaultHeaders: { 'api-key': this.apiKey }
                });
            }

            console.log('[AzureVision] Service initialized successfully');
            return true;
        } catch (error) {
            console.error('[AzureVision] Initialization error:', error);
            throw error;
        }
    }

    async sendImage(base64Image, userPrompt = null) {
        try {
            if (!base64Image || typeof base64Image !== 'string') {
                throw new Error('Invalid base64 image data');
            }

            const imageUrl = base64Image.startsWith('data:')
                ? base64Image
                : `data:image/jpeg;base64,${base64Image}`;

            const messages = [
                {
                    role: 'system',
                    content: this.systemPrompt
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: {
                                url: imageUrl,
                                detail: this.detailLevel
                            }
                        }
                    ]
                }
            ];

            if (userPrompt) {
                messages[1].content.push({
                    type: 'text',
                    text: userPrompt
                });
            }

            console.log('[AzureVision] Sending image for analysis...');
            const response = await this.createChatCompletion(messages);

            const analysisText = response.choices[0]?.message?.content || '';
            console.log('[AzureVision] Analysis received, length:', analysisText.length);

            return analysisText;
        } catch (error) {
            console.error('[AzureVision] Error analyzing image:', error);
            throw new Error(`Azure Vision analysis failed: ${error.message}`);
        }
    }

    async sendText(text) {
        try {
            console.log('[AzureVision] Sending text message:', text.substring(0, 50) + '...');

            const response = await this.createChatCompletion([
                { role: 'system', content: this.systemPrompt },
                { role: 'user', content: text }
            ]);

            return response.choices[0]?.message?.content || '';
        } catch (error) {
            console.error('[AzureVision] Error sending text:', error);
            throw new Error(`Azure Vision text failed: ${error.message}`);
        }
    }

    async close() {
        console.log('[AzureVision] Service closed');
    }
}

module.exports = { AzureVisionService };
