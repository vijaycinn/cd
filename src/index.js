if (require('electron-squirrel-startup')) {
    process.exit(0);
}

const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { createWindow, updateGlobalShortcuts } = require('./utils/window');
const { setupGeminiIpcHandlers, stopMacOSAudioCapture, sendToRenderer } = require('./utils/gemini');
const { AudioRouter } = require('./utils/audioRouter');
const { initializeRandomProcessNames } = require('./utils/processRandomizer');
const { applyAntiAnalysisMeasures } = require('./utils/stealthFeatures');
const { getLocalConfig, writeConfig } = require('./config');

const geminiSessionRef = { current: null };
const azureServiceRef = { current: null };
const audioRouter = new AudioRouter();
let mainWindow = null;

// Initialize random process names for stealth
const randomNames = initializeRandomProcessNames();

function createMainWindow() {
    mainWindow = createWindow(sendToRenderer, geminiSessionRef, randomNames);
    return mainWindow;
}

app.whenReady().then(async () => {
    // Apply anti-analysis measures with random delay
    await applyAntiAnalysisMeasures();

    createMainWindow();

    // Initialize audio routing service
    audioRouter.setGeminiSessionRef(geminiSessionRef);
    audioRouter.setAzureServiceRef(azureServiceRef);

    setupGeminiIpcHandlers(geminiSessionRef);
    setupGeneralIpcHandlers();
});

app.on('window-all-closed', () => {
    stopMacOSAudioCapture();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopMacOSAudioCapture();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

function setupGeneralIpcHandlers() {
    // Config-related IPC handlers
    ipcMain.handle('set-onboarded', async (event) => {
        try {
            const config = getLocalConfig();
            config.onboarded = true;
            writeConfig(config);
            return { success: true, config };
        } catch (error) {
            console.error('Error setting onboarded:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('set-stealth-level', async (event, stealthLevel) => {
        try {
            const validLevels = ['visible', 'balanced', 'ultra'];
            if (!validLevels.includes(stealthLevel)) {
                throw new Error(`Invalid stealth level: ${stealthLevel}. Must be one of: ${validLevels.join(', ')}`);
            }
            
            const config = getLocalConfig();
            config.stealthLevel = stealthLevel;
            writeConfig(config);
            return { success: true, config };
        } catch (error) {
            console.error('Error setting stealth level:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('set-layout', async (event, layout) => {
        try {
            const validLayouts = ['normal', 'compact'];
            if (!validLayouts.includes(layout)) {
                throw new Error(`Invalid layout: ${layout}. Must be one of: ${validLayouts.join(', ')}`);
            }
            
            const config = getLocalConfig();
            config.layout = layout;
            writeConfig(config);
            return { success: true, config };
        } catch (error) {
            console.error('Error setting layout:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-config', async (event) => {
        try {
            const config = getLocalConfig();
            return { success: true, config };
        } catch (error) {
            console.error('Error getting config:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('set-audio-mode', async (event, mode) => {
        try {
            audioRouter.setAudioMode(mode);
            return { success: true };
        } catch (error) {
            console.error('Error updating audio mode:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('quit-application', async event => {
        try {
            stopMacOSAudioCapture();
            app.quit();
            return { success: true };
        } catch (error) {
            console.error('Error quitting application:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('open-external', async (event, url) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            console.error('Error opening external URL:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.on('update-keybinds', (event, newKeybinds) => {
        if (mainWindow) {
            updateGlobalShortcuts(newKeybinds, mainWindow, sendToRenderer, geminiSessionRef);
        }
    });

    ipcMain.handle('update-content-protection', async (event, contentProtection) => {
        try {
            if (mainWindow) {

                // Get content protection setting from localStorage via cheddar
                const contentProtection = await mainWindow.webContents.executeJavaScript('cheddar.getContentProtection()');
                mainWindow.setContentProtection(contentProtection);
                console.log('Content protection updated:', contentProtection);
            }
            return { success: true };
        } catch (error) {
            console.error('Error updating content protection:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-random-display-name', async event => {
        try {
            return randomNames ? randomNames.displayName : 'System Monitor';
        } catch (error) {
            console.error('Error getting random display name:', error);
            return 'System Monitor';
        }
    });

    // Azure Realtime IPC handlers
    ipcMain.handle('initialize-azure-realtime', async (event, azureApiKey, azureEndpoint, azureDeployment, azureRegion, customPrompt, profile, language) => {
        try {
            console.log('[index.js] initialize-azure-realtime called with parameters - switching to WebSocket:', {
                hasApiKey: !!azureApiKey,
                hasEndpoint: !!azureEndpoint,
                deployment: azureDeployment,
                region: azureRegion,
                profile,
                language
            });

            const { AzureRealtimeWebSocketService } = require('./utils/azureRealtimeWebSocket.js');

            // Initialize conversation session for Azure (like Gemini does)
            // initializeNewSession(); // Don't call this - it belongs to Gemini

            // Create AzureRealtimeWebSocketService
            const azureService = new AzureRealtimeWebSocketService(azureApiKey, azureEndpoint, azureDeployment, azureRegion, customPrompt, profile, language);

            // Set up callbacks to send updates to renderer
            azureService.setCallbacks({
                onMessage: (response) => {
                    console.log('[AzureRealtime] Callback - Response received, sending to renderer:', response ? response.substring(0, 100) + '...' : 'NO RESPONSE');
                    const windows = BrowserWindow.getAllWindows();
                    if (windows.length > 0) {
                        windows[0].webContents.send('update-response', response);
                    }
                },
                onError: (error) => {
                    console.error('[AzureRealtime] Callback - Error:', error);
                    const windows = BrowserWindow.getAllWindows();
                    if (windows.length > 0) {
                        windows[0].webContents.send('update-status', 'Error: ' + error.message);
                    }
                },
                onStatus: (status) => {
                    console.log('[AzureRealtime] Callback - Status:', status);
                    const windows = BrowserWindow.getAllWindows();
                    if (windows.length > 0) {
                        windows[0].webContents.send('update-status', status);
                    }
                },
                onTranscription: (transcription) => {
                    console.log('[AzureRealtime] Callback - Transcription:', transcription);
                },
                onAudio: (audioData) => {
                    console.log('[AzureRealtime] Callback - Audio received:', audioData?.length, 'bytes');
                }
            });

            const success = await azureService.init();
            if (success) {
                azureServiceRef.current = azureService;
                // Start Azure-specific audio routing
                audioRouter.startRouting();
                console.log('[index.js] Azure Realtime WebSocket service initialized successfully');
                return true;
            } else {
                console.error('[index.js] Failed to initialize Azure Realtime WebSocket service');
                return false;
            }
        } catch (error) {
            console.error('[index.js] Error initializing Azure Realtime WebSocket service:', error);
            return false;
        }
    });

    ipcMain.handle('send-azure-text-message', async (event, text) => {
        console.log('[index.js] send-azure-text-message called with text:', text.substring(0, 100) + '...');
        if (!azureServiceRef.current) {
            console.error('[index.js] No active Azure OpenAI session');
            return { success: false, error: 'No active Azure OpenAI session' };
        }

        try {
            if (!text || typeof text !== 'string' || text.trim().length === 0) {
                console.log('[index.js] Invalid text message - empty or invalid');
                return { success: false, error: 'Invalid text message' };
            }

            console.log('[index.js] Sending text message to Azure OpenAI service');
            const azureService = azureServiceRef.current;
            const payload = { text: text.trim() };
            let response;

            if (typeof azureService.sendRealtimeInput === 'function') {
                console.log('[index.js] azureService.sendRealtimeInput available');
                response = await azureService.sendRealtimeInput(payload);
            } else if (typeof azureService.sendText === 'function') {
                console.warn('[index.js] azureService.sendRealtimeInput missing; falling back to sendText');
                response = await azureService.sendText(payload.text);
            } else {
                throw new Error('Azure realtime service does not support text input');
            }
            console.log('[index.js] Azure OpenAI service returned response:', response ? '***' : 'NO RESPONSE');

            return { success: true, response };
        } catch (error) {
            console.error('[index.js] Error sending text to Azure OpenAI:', error);
            console.error('[index.js] Error details:', {
                message: error.message,
                stack: error.stack,
                name: error.name
            });
            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0) {
                windows[0].webContents.send('update-status', 'Error: ' + error.message);
            }
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('close-azure-session', async event => {
        console.log('[index.js] close-azure-session called');
        try {
            if (azureServiceRef.current) {
                console.log('[index.js] Closing Azure session');
                await azureServiceRef.current.close();
                azureServiceRef.current = null;
                console.log('[index.js] Azure session closed successfully');

                // Stop Azure-specific audio routing and restore Gemini handlers
                audioRouter.stopRouting();
            } else {
                console.log('[index.js] No Azure session to close');
            }

            return { success: true };
        } catch (error) {
            console.error('[index.js] Error closing Azure session:', error);
            return { success: false, error: error.message };
        }
    });
}
