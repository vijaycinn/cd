class LLMService {
    constructor(apiKey, customPrompt, profile, language) {
        this.apiKey = apiKey;
        this.customPrompt = customPrompt;
        this.profile = profile;
        this.language = language;
    }

    async init() {
        throw new Error("init() not implemented");
    }

    async sendText(text) {
        throw new Error("sendText() not implemented");
    }

    async sendAudio() {
        throw new Error("sendAudio() not implemented");
    }

    async sendImage() {
        throw new Error("sendImage() not implemented");
    }

    async close() {
        // Default implementation - can be overridden
    }
}

module.exports = { LLMService };
