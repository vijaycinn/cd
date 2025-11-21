const { BrowserWindow, ipcMain } = require('electron');
const { handleGeminiAudioChunk, handleGeminiMicAudioChunk } = require('./gemini');

// Audio routing service that intelligently routes audio between Gemini and Azure
class AudioRouter {
    constructor() {
        this.geminiSessionRef = null;
        this.azureServiceRef = null;
        this.routingActive = false; // Track if Azure routing is active
        this.audioMode = 'speaker_only';

        // Store original Gemini handlers to restore them later
        this.originalAudioHandler = null;
        this.originalMicAudioHandler = null;
    }

    setAudioMode(mode) {
        const validModes = ['speaker_only', 'mic_only', 'both'];
        if (!validModes.includes(mode)) {
            console.warn(`[AudioRouter] Ignoring invalid audio mode: ${mode}`);
            return;
        }

        if (this.audioMode !== mode) {
            this.audioMode = mode;
            console.log('[AudioRouter] Audio mode set to:', mode);
        }
    }

    setGeminiSessionRef(geminiSessionRef) {
        this.geminiSessionRef = geminiSessionRef;
    }

    setAzureServiceRef(azureServiceRef) {
        this.azureServiceRef = azureServiceRef;
    }

    sendToRenderer(channel, data) {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            windows[0].webContents.send(channel, data);
        }
    }

    // Start Azure-specific routing - takes over audio handlers from Gemini
    startRouting() {
        if (this.routingActive) return; // Already active

        console.log('[AudioRouter] Starting Azure-specific routing');
        const hasRemoveHandler = typeof ipcMain.removeHandler === 'function';
        console.log('[AudioRouter] ipcMain.removeHandler available:', hasRemoveHandler);

        if (hasRemoveHandler) {
            ipcMain.removeHandler('send-audio-content');
            ipcMain.removeHandler('send-mic-audio-content');
        }

        ipcMain.handle('send-audio-content', this.handleAudioContent.bind(this));
        ipcMain.handle('send-mic-audio-content', this.handleMicAudioContent.bind(this));

        this.routingActive = true;
    }

    // Stop Azure routing - restore Gemini handlers
    stopRouting() {
        if (!this.routingActive) return; // Already inactive

        console.log('[AudioRouter] Stopping Azure-specific routing, restoring Gemini handlers');
        const hasRemoveHandler = typeof ipcMain.removeHandler === 'function';
        if (hasRemoveHandler) {
            ipcMain.removeHandler('send-audio-content');
            ipcMain.removeHandler('send-mic-audio-content');
        }

        // Restore Gemini handlers
        ipcMain.handle('send-audio-content', async (event, payload) => handleGeminiAudioChunk(payload));

        ipcMain.handle('send-mic-audio-content', async (event, payload) => handleGeminiMicAudioChunk(payload));

        this.routingActive = false;
    }

    // Azure-specific audio content handler
    async handleAudioContent(event, { data, mimeType }) {
        if (this.azureServiceRef?.current) {
            const allowSystemAudio = this.audioMode === 'speaker_only' || this.audioMode === 'both';
            if (!allowSystemAudio) {
                return { success: true, skipped: 'azure-system-audio-disabled' };
            }

            try {
                const buffer = Buffer.from(data, 'base64');
                await this.azureServiceRef.current.sendAudio(buffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending system audio to Azure:', error);
                return { success: false, error: error.message };
            }
        } else {
            // Fallback to Gemini if no Azure
            return this.fallbackToGemini('send-audio-content', { data, mimeType });
        }
    }

    // Azure-specific microphone audio handler
    async handleMicAudioContent(event, { data, mimeType }) {
        if (this.azureServiceRef?.current) {
            const allowMicAudio = this.audioMode === 'mic_only' || this.audioMode === 'both';
            if (!allowMicAudio) {
                return { success: true, skipped: 'azure-mic-audio-disabled' };
            }

            try {
                const buffer = Buffer.from(data, 'base64');
                await this.azureServiceRef.current.sendAudio(buffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending mic audio to Azure:', error);
                return { success: false, error: error.message };
            }
        } else {
            // Fallback to Gemini if no Azure
            return this.fallbackToGemini('send-mic-audio-content', { data, mimeType });
        }
    }

    // Fallback to Gemini for any audio if Azure not available
    async fallbackToGemini(channel, { data, mimeType }) {
        if (!this.geminiSessionRef?.current) {
            return { success: false, error: `No active LLM session for ${channel}` };
        }

        if (channel === 'send-audio-content') {
            return handleGeminiAudioChunk({ data, mimeType });
        }

        return handleGeminiMicAudioChunk({ data, mimeType });
    }

    isAzureActive() {
        return this.azureServiceRef?.current !== null;
    }

    isGeminiActive() {
        return this.geminiSessionRef?.current !== null;
    }
}

module.exports = { AudioRouter };
