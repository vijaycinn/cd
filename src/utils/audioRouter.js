const { BrowserWindow, ipcMain } = require('electron');

// Audio routing service that intelligently routes audio between Gemini and Azure
class AudioRouter {
    constructor() {
        this.geminiSessionRef = null;
        this.azureServiceRef = null;
        this.routingActive = false; // Track if Azure routing is active

        // Store original Gemini handlers to restore them later
        this.originalAudioHandler = null;
        this.originalMicAudioHandler = null;
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

        // Store existing handlers (if any) - but Gemini handlers should be already registered
        // We'll overwrite with Azure handlers

        // Register Azure handlers
        ipcMain.handle('send-audio-content', this.handleAudioContent.bind(this));
        ipcMain.handle('send-mic-audio-content', this.handleMicAudioContent.bind(this));

        this.routingActive = true;
    }

    // Stop Azure routing - restore Gemini handlers
    stopRouting() {
        if (!this.routingActive) return; // Already inactive

        console.log('[AudioRouter] Stopping Azure-specific routing, restoring Gemini handlers');

        // Restore Gemini handlers
        ipcMain.handle('send-audio-content', async (event, { data, mimeType }) => {
            if (!this.geminiSessionRef?.current) return { success: false, error: 'No active Gemini session' };
            try {
                process.stdout.write('.'); // Back to Gemini marker
                await this.geminiSessionRef.current.sendRealtimeInput({
                    audio: { data: data, mimeType: mimeType },
                });
                return { success: true };
            } catch (error) {
                console.error('Error sending system audio:', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('send-mic-audio-content', async (event, { data, mimeType }) => {
            if (!this.geminiSessionRef?.current) return { success: false, error: 'No active Gemini session' };
            try {
                process.stdout.write(','); // Back to Gemini marker
                await this.geminiSessionRef.current.sendRealtimeInput({
                    audio: { data: data, mimeType: mimeType },
                });
                return { success: true };
            } catch (error) {
                console.error('Error sending mic audio:', error);
                return { success: false, error: error.message };
            }
        });

        this.routingActive = false;
    }

    // Azure-specific audio content handler
    async handleAudioContent(event, { data, mimeType }) {
        if (this.azureServiceRef?.current) {
            try {
                process.stdout.write('+'); // Azure system audio marker
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
            try {
                process.stdout.write('~'); // Azure microphone audio marker
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

        try {
            const marker = channel === 'send-audio-content' ? '.' : ',';
            process.stdout.write(marker);
            await this.geminiSessionRef.current.sendRealtimeInput({
                audio: { data: data, mimeType: mimeType },
            });
            return { success: true };
        } catch (error) {
            console.error(`Error sending audio to Gemini (${channel}):`, error);
            return { success: false, error: error.message };
        }
    }

    isAzureActive() {
        return this.azureServiceRef?.current !== null;
    }

    isGeminiActive() {
        return this.geminiSessionRef?.current !== null;
    }
}

module.exports = { AudioRouter };
