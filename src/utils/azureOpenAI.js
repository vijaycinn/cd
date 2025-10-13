const { LLMService } = require('./llm.js');
const { OpenAI } = require('openai');

class AzureOpenAIService extends LLMService {
    constructor(apiKey, endpoint, deployment, customPrompt, profile, language) {
        super(apiKey, customPrompt, profile, language);

        // CORRECTED Azure OpenAI Configuration
        this.openai = new OpenAI({
            apiKey: apiKey,
            // ✨ CORRECT: Azure OpenAI endpoint format
            baseURL: `${endpoint}/openai/deployments/${deployment}`,
            // ✨ CORRECT: Proper Azure authentication headers
            defaultHeaders: {
                'api-key': apiKey,  // Azure requires this header
                'Ocp-Apim-Subscription-Key': apiKey  // Sometimes needed for Azure
            }
        });

        this.deployment = deployment;
        this.messageBuffer = '';
        this.isProcessing = false;
        this.callbacks = {
            onMessage: null,
            onError: null,
            onComplete: null
        };
    }

    async init() {
        console.log('[AzureOpenAI] Service initialized with deployment:', this.deployment);
        return true;
    }

    // Set callbacks for real-time communication
    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    async sendText(text) {
        try {
            console.log('[AzureOpenAI] Sending text to Azure OpenAI:', text.substring(0, 100) + '...');
            console.log('[AzureOpenAI] Using deployment:', this.deployment);
            console.log('[AzureOpenAI] Using endpoint:', this.openai.baseURL);
            
            const response = await this.openai.chat.completions.create({
                // ✨ CORRECT: Azure OpenAI uses deployment name as model
                model: this.deployment,
                messages: [{ role: 'user', content: text }],
                stream: false // For now, use non-streaming responses
            });
            
            const content = response.choices[0].message.content;
            const promptTokens = response.usage?.prompt_tokens || 0;
            const completionTokens = response.usage?.completion_tokens || 0;
            
            console.log(`[AzureOpenAI] Response received - Prompt tokens: ${promptTokens}, Completion tokens: ${completionTokens}`);
            console.log('[AzureOpenAI] Response content length:', content ? content.length : 0);
            console.log('[AzureOpenAI] Response preview:', content ? content.substring(0, 100) + '...' : 'NO CONTENT');
            
            return content;
        } catch (error) {
            console.error('[AzureOpenAI] Error sending text to Azure OpenAI:', error);
            console.error('[AzureOpenAI] Error details:', {
                message: error.message,
                status: error.status,
                code: error.code,
                type: error.type
            });
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
            throw error;
        }
    }

    async sendAudio() {
        // For now, return a placeholder - audio processing would need to be implemented
        console.log('[AzureOpenAI] Audio processing not implemented for Azure OpenAI');
        throw new Error("Audio processing not implemented for Azure OpenAI");
    }

    async sendImage() {
        // For now, return a placeholder - image processing would need to be implemented
        console.log('[AzureOpenAI] Image processing not implemented for Azure OpenAI');
        throw new Error("Image processing not implemented for Azure OpenAI");
    }

    async sendRealtimeInput(input) {
        try {
            console.log('[AzureOpenAI] sendRealtimeInput called with input type:', Object.keys(input));
            if (input.text) {
                console.log('[AzureOpenAI] Processing text input:', input.text.substring(0, 100) + '...');
                const result = await this.sendText(input.text);
                console.log('[AzureOpenAI] Text processing completed, result length:', result ? result.length : 0);
                
                // Send response back through callbacks if available
                if (this.callbacks.onMessage && result) {
                    console.log('[AzureOpenAI] Sending response through callback');
                    this.callbacks.onMessage(result);
                }
                
                return result;
            } else if (input.audio) {
                console.log('[AzureOpenAI] Processing audio input');
                const result = await this.sendAudio(input.audio);
                console.log('[AzureOpenAI] Audio processing result:', result ? '***' : 'NO RESULT');
                return result;
            } else if (input.media) {
                console.log('[AzureOpenAI] Processing media input');
                const result = await this.sendImage(input.media);
                console.log('[AzureOpenAI] Media processing result:', result ? '***' : 'NO RESULT');
                return result;
            } else {
                console.log('[AzureOpenAI] Unknown input type:', Object.keys(input));
                return null;
            }
        } catch (error) {
            console.error('[AzureOpenAI] Error in sendRealtimeInput:', error);
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
            throw error;
        }
    }

    async close() {
        console.log('[AzureOpenAI] Closing service');
        // cleanup if needed
        this.messageBuffer = '';
        this.isProcessing = false;
        this.callbacks = {
            onMessage: null,
            onError: null,
            onComplete: null
        };
    }
}

module.exports = { AzureOpenAIService };
