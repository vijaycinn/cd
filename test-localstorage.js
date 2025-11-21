const { app, BrowserWindow } = require('electron');

// Create a hidden browser window to access localStorage
async function testLocalStorage() {
    const win = new BrowserWindow({
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.loadURL('about:blank');

    win.webContents.on('did-finish-load', async () => {
        try {
            // Test localStorage values
            const llmService = await win.webContents.executeJavaScript('localStorage.getItem("llmService")');
            const azureApiKey = await win.webContents.executeJavaScript('localStorage.getItem("azureApiKey")');
            const azureEndpoint = await win.webContents.executeJavaScript('localStorage.getItem("azureEndpoint")');
            const azureDeployment = await win.webContents.executeJavaScript('localStorage.getItem("azureDeployment")');
            
            console.log('Current localStorage values:');
            console.log('llmService:', llmService);
            console.log('azureApiKey:', azureApiKey ? '***' : 'NOT SET');
            console.log('azureEndpoint:', azureEndpoint);
            console.log('azureDeployment:', azureDeployment);
            
            win.destroy();
        } catch (error) {
            console.error('Error accessing localStorage:', error);
            win.destroy();
        }
    });
}

testLocalStorage().catch(console.error);
