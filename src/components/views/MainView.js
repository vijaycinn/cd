import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { resizeLayout } from '../../utils/windowResize.js';

export class MainView extends LitElement {
    static styles = css`
        * {
            font-family: 'Inter', sans-serif;
            cursor: default;
            user-select: none;
        }

        .welcome {
            font-size: 24px;
            margin-bottom: 8px;
            font-weight: 600;
            margin-top: auto;
        }

        .input-group {
            display: flex;
            gap: 12px;
            margin-bottom: 20px;
        }

        .input-group input {
            flex: 1;
        }

        input {
            background: var(--input-background);
            color: var(--text-color);
            border: 1px solid var(--button-border);
            padding: 10px 14px;
            width: 100%;
            border-radius: 8px;
            font-size: 14px;
            transition: border-color 0.2s ease;
        }

        input:focus {
            outline: none;
            border-color: var(--focus-border-color);
            box-shadow: 0 0 0 3px var(--focus-box-shadow);
            background: var(--input-focus-background);
        }

        input::placeholder {
            color: var(--placeholder-color);
        }

        /* Red blink animation for empty API key */
        input.api-key-error {
            animation: blink-red 1s ease-in-out;
            border-color: #ff4444;
        }

        @keyframes blink-red {
            0%,
            100% {
                border-color: var(--button-border);
                background: var(--input-background);
            }
            25%,
            75% {
                border-color: #ff4444;
                background: rgba(255, 68, 68, 0.1);
            }
            50% {
                border-color: #ff6666;
                background: rgba(255, 68, 68, 0.15);
            }
        }

        .start-button {
            background: var(--start-button-background);
            color: var(--start-button-color);
            border: 1px solid var(--start-button-border);
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 500;
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .start-button:hover {
            background: var(--start-button-hover-background);
            border-color: var(--start-button-hover-border);
        }

        .start-button.initializing {
            opacity: 0.5;
        }

        .start-button.initializing:hover {
            background: var(--start-button-background);
            border-color: var(--start-button-border);
        }

        .shortcut-icons {
            display: flex;
            align-items: center;
            gap: 2px;
            margin-left: 4px;
        }

        .shortcut-icons svg {
            width: 14px;
            height: 14px;
        }

        .shortcut-icons svg path {
            stroke: currentColor;
        }

        .description {
            color: var(--description-color);
            font-size: 14px;
            margin-bottom: 24px;
            line-height: 1.5;
        }

        .provider-select {
            margin-bottom: 20px;
        }

        .provider-dropdown {
            background: var(--input-background);
            color: var(--text-color);
            border: 1px solid var(--button-border);
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 14px;
            width: 100%;
            cursor: pointer;
            transition: all 0.15s ease;
            appearance: none;
            -webkit-appearance: none;
            background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
            background-repeat: no-repeat;
            background-position: right 8px center;
            background-size: 16px;
            padding-right: 32px;
        }

        .provider-dropdown:focus {
            outline: none;
            border-color: var(--focus-border-color);
            box-shadow: 0 0 0 2px var(--focus-box-shadow);
        }

        .provider-dropdown:hover {
            border-color: rgba(255, 255, 255, 0.25);
            background-color: rgba(0, 0, 0, 0.35);
        }

        .link {
            color: var(--link-color);
            text-decoration: underline;
            cursor: pointer;
        }

        .shortcut-hint {
            color: var(--description-color);
            font-size: 11px;
            opacity: 0.8;
        }

        :host {
            height: 100%;
            display: flex;
            flex-direction: column;
            width: 100%;
            max-width: 500px;
        }
    `;

    static properties = {
        onStart: { type: Function },
        onAPIKeyHelp: { type: Function },
        isInitializing: { type: Boolean },
        onLayoutModeChange: { type: Function },
        showApiKeyError: { type: Boolean },
        llmService: { type: String },
        azureConfigComplete: { type: Boolean }
    };

    constructor() {
        super();
        this.onStart = () => {};
        this.onAPIKeyHelp = () => {};
        this.isInitializing = false;
        this.onLayoutModeChange = () => {};
        this.showApiKeyError = false;
        this.boundKeydownHandler = this.handleKeydown.bind(this);
        this.azureConfigComplete = false;

        // Initialize settings from main process
        this.initializeSettings();
    }

    connectedCallback() {
        super.connectedCallback();
        window.electron?.ipcRenderer?.on('session-initializing', (event, isInitializing) => {
            this.isInitializing = isInitializing;
        });

        // Add keyboard event listener for Ctrl+Enter (or Cmd+Enter on Mac)
        document.addEventListener('keydown', this.boundKeydownHandler);

        // Load and apply layout mode on startup
        this.loadLayoutMode();
        // Resize window for this view
        resizeLayout();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.electron?.ipcRenderer?.removeAllListeners('session-initializing');
        // Remove keyboard event listener
        document.removeEventListener('keydown', this.boundKeydownHandler);
    }

    handleKeydown(e) {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const isStartShortcut = isMac ? e.metaKey && e.key === 'Enter' : e.ctrlKey && e.key === 'Enter';

        if (isStartShortcut) {
            e.preventDefault();
            this.handleStartClick();
        }
    }

    handleInput(e) {
        const key = this.llmService === 'azure' ? 'azureApiKey' : 'geminiApiKey';
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(key, e.target.value);
        }
        if (window.electron?.ipcRenderer?.invoke) {
            window.electron.ipcRenderer
                .invoke('set-setting', {
                    key,
                    value: e.target.value
                })
                .catch(error => console.warn('Failed to persist setting', key, error?.message));
        }
        // Clear error state when user starts typing
        if (this.showApiKeyError) {
            this.showApiKeyError = false;
        }
    }

    async initializeSettings() {
        // Get initial settings (prefer persisted store, fall back to localStorage)
        if (window.electron?.ipcRenderer?.invoke) {
            try {
                this.llmService = (await window.electron.ipcRenderer.invoke('get-setting', 'llmService')) || localStorage.getItem('llmService') || 'gemini';
            } catch (error) {
                console.warn('Falling back to localStorage for llmService:', error?.message);
                this.llmService = localStorage.getItem('llmService') || 'gemini';
            }
        } else {
            this.llmService = localStorage.getItem('llmService') || 'gemini';
        }
        await this.validateAzureConfig();
        this.requestUpdate();
    }

    handleProviderChange(e) {
        const newProvider = e.target.value;
        this.llmService = newProvider;
        if (window.electron?.ipcRenderer?.invoke) {
            window.electron.ipcRenderer
                .invoke('set-setting', {
                    key: 'llmService',
                    value: newProvider
                })
                .catch(error => console.warn('Failed to persist llmService', error?.message));
        } else {
            localStorage.setItem('llmService', newProvider);
        }
        
        if (newProvider === 'azure') {
            this.validateAzureConfig();
        }
        this.requestUpdate();
    }

    async validateAzureConfig() {
        let azureApiKey = '';
        let azureEndpoint = '';
        let azureDeployment = '';

        if (window.electron?.ipcRenderer?.invoke) {
            try {
                azureApiKey = await window.electron.ipcRenderer.invoke('get-setting', 'azureApiKey');
            } catch (error) {
                console.warn('Falling back to localStorage for azureApiKey:', error?.message);
            }
            try {
                azureEndpoint = await window.electron.ipcRenderer.invoke('get-setting', 'azureEndpoint');
            } catch (error) {
                console.warn('Falling back to localStorage for azureEndpoint:', error?.message);
            }
            try {
                azureDeployment = await window.electron.ipcRenderer.invoke('get-setting', 'azureDeployment');
            } catch (error) {
                console.warn('Falling back to localStorage for azureDeployment:', error?.message);
            }
        }

        if (!azureApiKey && typeof localStorage !== 'undefined') {
            azureApiKey = localStorage.getItem('azureApiKey');
        }

        if (!azureEndpoint && typeof localStorage !== 'undefined') {
            azureEndpoint = localStorage.getItem('azureEndpoint');
        }

        if (!azureDeployment && typeof localStorage !== 'undefined') {
            azureDeployment = localStorage.getItem('azureDeployment');
        }

        let azureRegion = '';
        if (window.electron?.ipcRenderer?.invoke) {
            try {
                azureRegion = await window.electron.ipcRenderer.invoke('get-setting', 'azureRegion');
            } catch (error) {
                console.warn('Falling back to localStorage for azureRegion:', error?.message);
            }
        }

        if (!azureRegion && typeof localStorage !== 'undefined') {
            azureRegion = localStorage.getItem('azureRegion');
        }

        if (!azureRegion) {
            azureRegion = 'eastus2';
        }

        this.azureConfigComplete = !!(azureApiKey && azureEndpoint && azureDeployment && azureRegion);
        return this.azureConfigComplete;
    }

    async handleStartClick() {
        if (this.isInitializing) {
            return;
        }

        if (this.llmService === 'azure') {
            const isValidAzureConfig = await this.validateAzureConfig();
            if (!isValidAzureConfig) {
                this.triggerApiKeyError();
                return;
            }
        }

        this.onStart();
    }

    handleAPIKeyHelpClick() {
        this.onAPIKeyHelp();
    }

    handleResetOnboarding() {
        localStorage.removeItem('onboardingCompleted');
        // Refresh the page to trigger onboarding
        window.location.reload();
    }

    loadLayoutMode() {
        const savedLayoutMode = localStorage.getItem('layoutMode');
        if (savedLayoutMode && savedLayoutMode !== 'normal') {
            // Notify parent component to apply the saved layout mode
            this.onLayoutModeChange(savedLayoutMode);
        }
    }

    // Method to trigger the red blink animation
    triggerApiKeyError() {
        this.showApiKeyError = true;
        // Remove the error class after 1 second
        setTimeout(() => {
            this.showApiKeyError = false;
        }, 1000);
    }

    // Method to trigger Azure credential error (for Azure service)
    triggerAzureCredentialError() {
        // For Azure, we could show a different UI indication or just log it
        console.log('Azure credentials are missing or invalid');
        // You could add visual feedback here if needed
    }

    getStartButtonText() {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

        const cmdIcon = html`<svg width="14px" height="14px" viewBox="0 0 24 24" stroke-width="2" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 6V18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M15 6V18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            <path
                d="M9 6C9 4.34315 7.65685 3 6 3C4.34315 3 3 4.34315 3 6C3 7.65685 4.34315 9 6 9H18C19.6569 9 21 7.65685 21 6C21 4.34315 19.6569 3 18 3C16.3431 3 15 4.34315 15 6"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            ></path>
            <path
                d="M9 18C9 19.6569 7.65685 21 6 21C4.34315 21 3 19.6569 3 18C3 16.3431 4.34315 15 6 15H18C19.6569 15 21 16.3431 21 18C21 19.6569 19.6569 21 18 21C16.3431 21 15 19.6569 15 18"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            ></path>
        </svg>`;

        const enterIcon = html`<svg width="14px" height="14px" stroke-width="2" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
                d="M10.25 19.25L6.75 15.75L10.25 12.25"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            ></path>
            <path
                d="M6.75 15.75H12.75C14.9591 15.75 16.75 13.9591 16.75 11.75V4.75"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            ></path>
        </svg>`;

        if (isMac) {
            return html`Start Session <span class="shortcut-icons">${cmdIcon}${enterIcon}</span>`;
        } else {
            return html`Start Session <span class="shortcut-icons">Ctrl${enterIcon}</span>`;
        }
    }

    getApiKeyPlaceholder() {
        switch (this.llmService) {
            case 'azure':
                return 'Azure OpenAI credentials configured in Advanced settings';
            case 'gemini':
            default:
                return 'Enter your Gemini API Key';
        }
    }

    getApiKeyStorageKey() {
        switch (this.llmService) {
            case 'azure':
                return 'azureApiKey';
            case 'gemini':
            default:
                return 'apiKey';
        }
    }

    render() {
        const placeholder = this.getApiKeyPlaceholder();
        const storageKey = this.getApiKeyStorageKey();
        const currentValue = localStorage.getItem(storageKey) || '';
        
        // For Azure, we don't show the input field since credentials are in Advanced settings
        const showInputField = this.llmService !== 'azure';

        return html`
            <div class="input-group provider-select">
                <select 
                    class="provider-dropdown"
                    .value=${this.llmService}
                    @change=${this.handleProviderChange}
                >
                    <option value="gemini">Gemini Live</option>
                    <option value="azure">Azure OpenAI</option>
                </select>
            </div>
            <div class="welcome">Welcome</div>

            ${showInputField ? html`
                <div class="input-group">
                    <input
                        type="password"
                        placeholder="${placeholder}"
                        .value=${currentValue}
                        @input=${this.handleInput}
                        class="${this.showApiKeyError ? 'api-key-error' : ''}"
                    />
                    <button @click=${this.handleStartClick} class="start-button ${this.isInitializing ? 'initializing' : ''}">
                        ${this.getStartButtonText()}
                    </button>
                </div>
            ` : html`
                <div class="input-group">
                    <button @click=${this.handleStartClick} class="start-button ${this.isInitializing ? 'initializing' : ''}">
                        ${this.getStartButtonText()}
                    </button>
                </div>
            `}
            <p class="description">
                ${this.llmService === 'gemini' ? html`
                    dont have an api key?
                    <span @click=${this.handleAPIKeyHelpClick} class="link">get one here</span>
                ` : this.llmService === 'azure' ? html`
                    configure azure credentials in <span @click=${() => {}} class="link">advanced settings</span>
                ` : ''}
            </p>
        `;
    }
}

customElements.define('main-view', MainView);
