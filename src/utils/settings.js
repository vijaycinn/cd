// src/utils/settings.js - Settings manager for persistent storage
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

class SettingsManager {
    constructor() {
        // Get user data path (platform-specific)
        this.userDataPath = app.getPath('userData');
        this.settingsFile = path.join(this.userDataPath, 'settings.json');
        this.settings = this.loadSettings();
    }

    loadSettings() {
        try {
            if (fs.existsSync(this.settingsFile)) {
                const data = fs.readFileSync(this.settingsFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        }
        return {
            llmService: 'gemini',
            azureApiKey: '',
            azureEndpoint: '',
            azureDeployment: '',
            geminiApiKey: '',
            layoutMode: 'normal'
        };
    }

    saveSettings() {
        try {
            fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2));
        } catch (error) {
            console.error('Error saving settings:', error);
        }
    }

    // Get a setting value
    get(key) {
        return this.settings[key];
    }

    // Set a setting value
    set(key, value) {
        this.settings[key] = value;
        this.saveSettings();
    }

    // Clear all settings
    clear() {
        this.settings = {
            llmService: 'gemini',
            azureApiKey: '',
            azureEndpoint: '',
            azureDeployment: '',
            geminiApiKey: '',
            layoutMode: 'normal'
        };
        this.saveSettings();
    }
}

// Create singleton instance
const settingsManager = new SettingsManager();

module.exports = settingsManager;