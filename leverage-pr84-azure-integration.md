<task name="CRITICAL: Azure ReactTime Integration Using PR84 Successful Patterns">

<task_objective>
Implement Azure OpenAI integration following PR84's EXACT successful patterns - NO DEVIATIONS. Replace regular OpenAI with Azure OpenAI ("gpt-realtime" deployment) while preserving ALL successful architectural decisions from PR84. One mistake = failed implementation. Use GitHub PR84 data as exact blueprint.
</task_objective>

<detailed_sequence_steps>
# 🔴 CRITICAL SUCCESS BLUEPRINT - PR84 Patterns for Azure Implementation

**WARNING: This implementation MUST follow PR84 patterns exactly or it will fail. Our life depends on getting this right - ONE MISTAKE and we're back to square one with "Illegal return statement" errors.**

---

## **📋 PR84 SUCCESSFUL PATTERNS REFERENCE**

> [!IMPORTANT]
> October 2025: The project now uses the realtime WebSocket service (`src/utils/azureRealtimeWebSocket.js`) instead of the legacy `AzureOpenAIService` REST client. References below are preserved for historical context when mirroring PR84.

### **0. PR84 Code Changes Summary** (MUST BE FOLLOWED EXACTLY)

PR84 Added OpenAI support by modifying 7 files exactly as follows:

1. **`package.json`**: Added `"openai": "^5.9.2"` dependency (same for Azure)
2. **`src/utils/llm.js`**: Abstract LLMService base class (reuse exactly)
3. **`src/utils/openai.js`**: OpenAIService concrete implementation (adapt to AzureOpenAIService)
4. **`src/components/views/AdvancedView.js`**: OpenAI UI section (adapt to Azure fields)
5. **`src/utils/gemini.js`**: `initialize-openai` IPC handler (adapt to `initialize-azure-realtime`)
6. **`src/components/app/CheatingDaddyApp.js`**: Provider switching logic (adapt for Azure)
7. **`src/utils/renderer.js`**: `initializeOpenAI` function (adapt to `initializeAzureRealtime`)

**CRITICAL RULE:** Change only service names, NOT the proven architectural patterns!

---

## **🎯 AZURE IMPLEMENTATION BLUEPRINT** (ADAPT PR84 PATTERNS)

### **Phase 1: Package & Base Classes** (Follow PR84 Exactly)

**File: `package.json`**
```json
"dependencies": {
  "@google/genai": "^1.2.0",
  "electron-squirrel-startup": "^1.0.1",
  "openai": "^5.9.2"  // ← SAME AS PR84, Azure uses same SDK
}
```

**File: `src/utils/llm.js`** (REUSE PR84 EXACTLY - NO CHANGES):
```javascript
class LLMService {
    constructor(apiKey, customPrompt, profile, language) { /* exact same */ }
    async init() { throw new Error("init() not implemented"); }
    async sendText(text) { throw new Error("sendText() not implemented"); }
    // etc. - use exact implementation
}
module.exports = { LLMService };
```

**File: `src/utils/azureOpenAI.js`** (CORRECTED for Azure OpenAI):
```javascript
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
    }

    async init() { return true; }

    async sendText(text) {
        const response = await this.openai.chat.completions.create({
            // ✨ CORRECT: Azure OpenAI uses deployment name as model
            model: this.deployment,
            messages: [{ role: 'user', content: text }]
        });
        return response.choices[0].message.content;
    }

    async sendAudio() { throw new Error("not implemented"); }
    async sendImage() { throw new Error("not implemented"); }
    async close() { /* cleanup */ }
}

module.exports = { AzureOpenAIService };
```

---

### **Phase 2: UI Layer** (Follow PR84 Exactly)

**File: `src/components/views/AdvancedView.js`** (ADAPT OpenAI fields to Azure):

```javascript
static properties = {
    llmService: { type: String },
    azureApiKey: { type: String },      // OPENAI → AZURE
    azureEndpoint: { type: String },    // ADDED FOR AZURE
    azureDeployment: { type: String },  // ADDED FOR AZURE
    // ... other props same
};

constructor() {
    this.llmService = localStorage.getItem('llmService') || 'gemini';
    this.azureApiKey = localStorage.getItem('azureApiKey') || '';
    this.azureEndpoint = localStorage.getItem('azureEndpoint') || '';
    this.azureDeployment = localStorage.getItem('azureDeployment') || 'gpt-realtime';
    // Default to your gpt-realtime deployment!
}

handleInputChange(e) {
    const { name, value } = e.target;
    this[name] = value;
    localStorage.setItem(name, value);  // SAME AS PR84
    this.requestUpdate();
}

render() {
    return html`
        <!-- ... existing sections ... -->

        <!-- LLM Service Section (SAME STRUCTURE AS PR84) -->
        <div class="advanced-section">
            <div class="section-title"><span>⚙️ LLM Service</span></div>
            <div class="form-grid">
                <div class="form-group">
                    <label class="form-label">LLM Service</label>
                    <select class="form-control" .value=${this.llmService} @change=${e => {
                        this.llmService = e.target.value;
                        localStorage.setItem('llmService', e.target.value);
                        this.requestUpdate();
                    }}>
                        <option value="gemini">Gemini</option>
                        <option value="azure">Azure OpenAI</option>  <!-- OPENAI → AZURE -->
                    </select>
                </div>

                <!-- CONDITIONAL AZURE FIELDS (ADAPTED FROM PR84) -->
                ${this.llmService === 'azure' ? html`
                    <div class="form-group">
                        <label class="form-label">Azure API Key</label>
                        <input type="password" class="form-control" .value=${this.azureApiKey}
                               @input=${e => this.handleInputChange(e.target)}>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Azure Endpoint</label>
                        <input type="text" class="form-control" .value=${this.azureEndpoint} placeholder="https://your-resource.openai.azure.com"
                               @input=${e => this.handleInputChange(e.target)}>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Deployment Name</label>
                        <input type="text" class="form-control" .value=${this.azureDeployment} placeholder="gpt-realtime"
                               @input=${e => this.handleInputChange(e.target)}>
                    </div>
                ` : ''}
            </div>
        </div>
        <!-- ... rest of render -->
    `;
}
```

---

### **Phase 3: IPC Handler Layer** (Critical - Exact PR84 Pattern)

**File: `src/utils/gemini.js`** (ADAPT PR84 initialize-openai handler):

```javascript
// ADD AFTER EXISTING IMPORTS (PR84 pattern)
const { AzureOpenAIService } = require('./azureOpenAI.js');

// ADD GLOBAL REF (PR84 pattern)
// global.azureServiceRef = null;  // Uncomment if needed

// ADD AFTER existing IPC handlers (PR84 exact pattern):
ipcMain.handle('initialize-azure-realtime', async (event, azureApiKey, azureEndpoint, azureDeployment, customPrompt, profile, language) => {
    try {
        const service = new AzureOpenAIService(azureApiKey, azureEndpoint, azureDeployment, customPrompt, profile, language);
        const success = await service.init();
        if (success) {
            global.azureServiceRef = service;  // PR84 pattern
            return true;
        }
        return false;
    } catch (error) {
        console.error('Failed to initialize Azure service:', error);
        return false;
    }
});
```

---

### **Phase 4: Component Logic** (Follow PR84 Exactly)

**File: `src/components/app/CheatingDaddyApp.js`** (ADAPT PR84 OpenAI logic):

```javascript
handleStart() {
    const llmService = localStorage.getItem('llmService') || 'gemini';
    let apiKey;

    // PR84 PATTERN: Service-based key selection
    if (llmService === 'gemini') {
        apiKey = localStorage.getItem('apiKey')?.trim();
    } else if (llmService === 'azure') {  // AZURE instead of OpenAI
        apiKey = localStorage.getItem('azureApiKey')?.trim();
        // ADDED: Also validate endpoint for Azure
        const endpoint = localStorage.getItem('azureEndpoint')?.trim();
        if (!apiKey || !endpoint) {
            // Show error for missing Azure credentials
            this.triggerAzureCredentialError();  // New method needed
            return;
        }
    }

    // PR84 PATTERN: Service-specific initialization calls
    if (llmService === 'gemini') {
        await cheddar.initializeGemini(this.selectedProfile, this.selectedLanguage);
    } else if (llmService === 'azure') {
        const azureEndpoint = localStorage.getItem('azureEndpoint');
        const azureDeployment = localStorage.getItem('azureDeployment') || 'gpt-realtime';
        await cheddar.initializeAzureRealtime(this.selectedProfile, this.selectedLanguage, azureEndpoint, azureDeployment);
    }

    cheddar.startCapture(this.selectedScreenshotInterval, this.selectedImageQuality);
}

// ADD NEW METHOD (Azure-specific validation)
triggerAzureCredentialError() {
    const mainView = this.shadowRoot.querySelector('main-view');
    if (mainView && mainView.triggerAzureCredentialError) {
        mainView.triggerAzureCredentialError();
    }
}
```

---

### **Phase 5: Renderer Layer** (Adapt PR84 initializeOpenAI)

**File: `src/utils/renderer.js`** (ADAPT from PR84 initializeOpenAI):

```javascript
// MODIFY EXISTING initializeAzureRealtime to match PR84 pattern:
// Current signature: async function initializeAzureRealtime(profile, language)
// PR84 initializeOpenAI signature: initializeOpenAI(profile, language, apiKey, baseURL, model)

// UPDATE to match PR84 pattern:
async function initializeAzureRealtime(profile = 'interview', language = 'en-US') {
    const azureApiKey = localStorage.getItem('azureApiKey')?.trim();
    const azureEndpoint = localStorage.getItem('azureEndpoint')?.trim();
    const azureDeployment = localStorage.getItem('azureDeployment') || 'gpt-realtime';

    if (azureApiKey && azureEndpoint) {
        // MATCH PR84 initializeOpenAI call pattern
        const success = await ipcRenderer.invoke('initialize-azure-realtime', azureApiKey, azureEndpoint, azureDeployment,
                                                 localStorage.getItem('customPrompt') || '', profile, language);
        if (success) {
            cheddar.setStatus('Live');
        } else {
            cheddar.setStatus('error');
        }
    } else {
        console.error('Azure credentials incomplete. Required: azureApiKey, azureEndpoint');
        cheddar.setStatus('error');
    }
}

// cheddar object export (ensure initializeAzureRealtime is included)
const cheddar = {
    // ... existing methods ...
    initializeAzureRealtime,  // Make sure this is exported
    // ... rest ...
};
```

---

## **🔍 VERIFICATION CHECKLIST** (ACCURATE STATUS AS OF 9/29/2025)

**⚠️ STATUS: PARTIALLY WORKING - App starts with NO errors, but Azure integration MAY NOT function**

**✅ WORKING:**
- App starts cleanly without "Illegal return statement" errors ✅
- Provider switching UI elements exist in Advanced settings ✅
- Basic file structure and code organization follows PR84 patterns ✅
- IPC handlers exist but signature matching needs code-level verification ✅

**❌ MISSING/NOT WORKING:**
- **Main Issue**: Azure service initialization probably fails due to missing credential handling
- **Likely Issue**: No proper error messaging when Azure credentials are invalid
- **Likely Issue**: Azure "start session" flow not tested end-to-end

**📝 ACTUAL IMPLEMENTATION STATUS:**

**Step 1: ✅ Base Classes & Files Present** (Files Exist)
- [x] `src/utils/azureOpenAI.js` exists with Azure SDK configuration
- [x] `package.json` has `"openai": "^5.9.2"` dependency ✅
- [x] `llm.js` exists (unchanged) ✅

**Step 2: ⏳ IPC Handler Exists But Unverified** (Code Present, Logic Unverified)
- [x] `initialize-azure-realtime` IPC handler exists in `src/utils/gemini.js` ✅
- [ ] **UNVERIFIED**: Does the IPC handler properly instantiate AzureOpenAIService? ⚠️
- [ ] **UNVERIFIED**: Does the IPC handler return proper success/failure? ⚠️
- [ ] **UNVERIFIED**: Are parameters actually being processed correctly? ⚠️

**Step 3: ✅ UI Elements Present** (Components Exist)
- [x] `src/components/views/AdvancedView.js` has Azure fields ✅
- [x] Azure fields show conditionally when llmService === 'azure' ✅
- [ ] **UNVERIFIED**: Do Azure fields actually save/load from localStorage? ⚠️
- [ ] **UNVERIFIED**: Do Azure fields show/hide properly on UI? ⚠️

**Step 4: ✅ App Component Logic Present** (Code Exists)
- [x] `CheatingDaddyApp.js` has llmService switching logic ✅
- [ ] **UNVERIFIED**: Does `cheddar.initializeAzureRealtime()` get called? ⚠️

**Step 5: ✅ Renderer Function Exists** (Code Exists)
- [x] `src/utils/renderer.js` has `initializeAzureRealtime` ✅
- [ ] **UNVERIFIED**: Does renderer function make correct IPC call? ⚠️

**Step 6: ❌ Testing Not Completed** (No Real Testing Done)
- ❌ No end-to-end testing with real Azure credentials
- ❌ No verification of actual Azure service initialization flow
- ❌ No verification that Azure "start session" works
- ❌ No testing of error handling when Azure creds are missing/invalid

---

## **🔧 FRESH START IMPLEMENTATION SEQUENCE** (Step-by-Step)

**Execute these steps IN EXACT ORDER for a working implementation:**

### **STEP 1: Base Classes** (5 minutes)
1. ✅ Verify `src/utils/azureOpenAI.js` exists with this exact code:
```javascript
const { LLMService } = require('./llm.js');
const { OpenAI } = require('openai');

class AzureOpenAIService extends LLMService {
    constructor(apiKey, endpoint, deployment, customPrompt, profile, language) {
        super(apiKey, customPrompt, profile, language);
        this.openai = new OpenAI({
            apiKey: apiKey,
            baseURL: `${endpoint}/openai/deployments/${deployment}`,
            defaultHeaders: { 'api-key': apiKey }
        });
        this.deployment = deployment;
    }

    async init() { return true; }

    async sendText(text) {
        const response = await this.openai.chat.completions.create({
            model: this.deployment,
            messages: [{ role: 'user', content: text }]
        });
        return response.choices[0].message.content;
    }

    async sendAudio() { throw new Error("not implemented"); }
    async sendImage() { throw new Error("not implemented"); }
    async close() { /* cleanup */ }
}

module.exports = { AzureOpenAIService };
```

### **STEP 2: IPC Handler** (5 minutes - CRITICAL)
1. ✅ Verify in `src/utils/gemini.js`, AFTER existing imports, you have:
```javascript
const { AzureOpenAIService } = require('./azureOpenAI');
```

2. ✅ Verify this IPC handler exists (add if missing):
```javascript
ipcMain.handle('initialize-azure-realtime', async (event, azureApiKey, azureEndpoint, azureDeployment, customPrompt, profile, language) => {
    try {
        console.log('Initializing Azure OpenAI service...');
        const azureService = new AzureOpenAIService(azureApiKey, azureEndpoint, azureDeployment, customPrompt, profile, language);
        const success = await azureService.init();
        if (success) {
            global.azureServiceRef.current = azureService;
            console.log('Azure OpenAI service initialized successfully');
            return true;
        } else {
            console.error('Failed to initialize Azure OpenAI service');
            return false;
        }
    } catch (error) {
        console.error('Error initializing Azure OpenAI service:', error);
        return false;
    }
});
```

3. **TEST** by adding console.log to verify handler is called

### **STEP 3: UI Implementation** (10 minutes)
1. ✅ Add to `src/components/views/AdvancedView.js` static properties:
```javascript
static properties = {
    // ... existing properties ...
    llmService: { type: String },
    azureApiKey: { type: String },
    azureEndpoint: { type: String },
    azureDeployment: { type: String },
};
```

2. ✅ Add to constructor:
```javascript
// LLM Service defaults
this.llmService = localStorage.getItem('llmService') || 'gemini';
this.azureApiKey = localStorage.getItem('azureApiKey') || '';
this.azureEndpoint = localStorage.getItem('azureEndpoint') || '';
this.azureDeployment = localStorage.getItem('azureDeployment') || 'gpt-realtime';
```

3. ✅ Add handleInputChange method:
```javascript
handleInputChange(e) {
    const { name, value } = e.target;
    this[name] = value;
    localStorage.setItem(name, value);
    this.requestUpdate();
}
```

4. ✅ Add to render method:
```javascript
<!-- LLM Service Section -->
<div class="advanced-section">
    <div class="section-title">
        <span>⚙️ LLM Service</span>
    </div>
    <div class="advanced-description">
        Configure which Language Learning Model service to use.
    </div>
    <div class="form-grid">
        <div class="form-group">
            <label for="llmService" class="form-label">LLM Service</label>
            <select name="llmService" id="llmService" class="form-control" .value=${this.llmService} @change=${this.handleInputChange}>
                <option value="gemini">Gemini</option>
                <option value="azure">Azure OpenAI</option>
            </select>
        </div>

        ${this.llmService === 'azure' ? html`
            <div class="form-group">
                <label class="form-label">Azure API Key</label>
                <input type="password" name="azureApiKey" class="form-control" .value=${this.azureApiKey} @input=${this.handleInputChange}>
            </div>
            <div class="form-group">
                <label class="form-label">Azure Endpoint</label>
                <input type="text" name="azureEndpoint" class="form-control" .value=${this.azureEndpoint} @input=${this.handleInputChange} placeholder="https://your-resource.openai.azure.com/">
            </div>
            <div class="form-group">
                <label class="form-label">Deployment Name</label>
                <input type="text" name="azureDeployment" class="form-control" .value=${this.azureDeployment} @input=${this.handleInputChange} placeholder="gpt-realtime">
            </div>
        ` : ''}
    </div>
</div>
```

### **STEP 4: Component Logic** (10 minutes)
1. ✅ Update `src/components/app/CheatingDaddyApp.js` constructor:
```javascript
this.selectedProvider = localStorage.getItem('llmService') || 'gemini';
this.llmService = this.selectedProvider; // Sync for AdvancedView binding
```

2. ✅ Update `handleStart()` method:
```javascript
async handleStart() {
    const llmService = localStorage.getItem('llmService') || 'gemini';
    let apiKey;

    if (llmService === 'gemini') {
        apiKey = localStorage.getItem('apiKey')?.trim();
    } else if (llmService === 'azure') {
        apiKey = localStorage.getItem('azureApiKey')?.trim();
        const endpoint = localStorage.getItem('azureEndpoint')?.trim();
        if (!apiKey || !endpoint) {
            this.triggerAzureCredentialError();
            return;
        }
    }

    if (llmService === 'gemini') {
        await cheddar.initializeGemini(this.selectedProfile, this.selectedLanguage);
    } else if (llmService === 'azure') {
        const azureEndpoint = localStorage.getItem('azureEndpoint');
        const azureDeployment = localStorage.getItem('azureDeployment') || 'gpt-realtime';
        await cheddar.initializeAzureRealtime(this.selectedProfile, this.selectedLanguage, azureEndpoint, azureDeployment);
    }

    cheddar.startCapture(this.selectedScreenshotInterval, this.selectedImageQuality);
    // ... rest of method
}
```

3. ✅ Add error handling method:
```javascript
triggerAzureCredentialError() {
    const mainView = this.shadowRoot.querySelector('main-view');
    if (mainView && mainView.triggerAzureCredentialError) {
        mainView.triggerAzureCredentialError();
    }
}
```

### **STEP 5: Renderer Integration** (5 minutes)
1. ✅ Update `src/utils/renderer.js` `initializeAzureRealtime` function:
```javascript
async function initializeAzureRealtime(profile = 'interview', language = 'en-US') {
    const azureApiKey = localStorage.getItem('azureApiKey')?.trim();
    const azureEndpoint = localStorage.getItem('azureEndpoint')?.trim();
    const azureDeployment = localStorage.getItem('azureDeployment') || 'gpt-realtime';

    if (azureApiKey && azureEndpoint) {
        // EXACT PARAM ORDER: azureApiKey, azureEndpoint, azureDeployment, customPrompt, profile, language
        const success = await ipcRenderer.invoke('initialize-azure-realtime', azureApiKey, azureEndpoint, azureDeployment,
                                                 localStorage.getItem('customPrompt') || '', profile, language);
        if (success) {
            cheddar.setStatus('Live');
        } else {
            cheddar.setStatus('error');
        }
    } else {
        console.error('Azure credentials incomplete. Required: azureApiKey, azureEndpoint');
        cheddar.setStatus('error');
    }
}
```

2. ✅ Verify cheddar export includes the function

### **STEP 6: Testing** (15 minutes - CRITICAL)
1. **Start the app**: `npm start`
2. **Go to Advanced settings**  
3. **Switch LLM Service to "Azure OpenAI"**
4. **Verifications**:
   - ❌ App crashes when switching to Azure? → Fix IPC handler
   - ❌ Fields don't appear when selecting Azure? → Fix UI conditional rendering
   - ❌ Can enter Azure credentials but can't save? → Fix localStorage persistence

5. **Add real Azure credentials** (if available):
   - Enter valid Azure OpenAI API Key
   - Enter valid Azure endpoint URL
   - Enter deployment name (gpt-realtime)
   - Try starting a session

6. **With invalid credentials**:
   - Test error handling when Azure creds are missing/bad
   - Should show clear error message, not crash app

### **COMMON FAILURE POINTS TO CHECK**
- Parameter order mismatch between renderer → IPC handler → service constructor
- Missing error handling for failed Azure initialization
- UI not persisting Azure settings to localStorage
- Azure deployment parameter not defaulting to 'gpt-realtime'
- IPC handler not returning boolean values
- Service not being assigned to global reference properly

---

## **🚨 SUCCESS CRITERIA** (Non-Negotiable)

**✅ COMPLETE SUCCESS:**
- App starts without "Illegal return statement" errors
- Provider switching works (gemini ↔ azure) in UI
- Azure credentials validation accepts: API key + endpoint + "gpt-realtime" deployment
- Status updates show 'Live' after successful Azure initialization
- No console errors during provider switching or initialization
- IPC communication works without renderer crashes

**❌ FAILURE INDICATORS:**
- "Illegal return statement" errors persist
- Provider switching causes crashes
- Azure initialization fails with parameter errors
- IPC handlers return non-boolean values
- Component loading shows broken behavior

---

## **⚡ IMPLEMENTATION SEQUENCE** (Execute in Exact Order)

### **Step 1: Prepare Base Classes** 🔨
1. Verify package.json has `"openai": "^5.9.2"` dependency (should already be there)
2. Verify `src/utils/llm.js` exists with exact PR84 LLMService class
3. Create/Update `src/utils/azureOpenAI.js` following blueprint exactly

### **Step 2: Implement IPC Handler** 🔌
4. Add AzureOpenAIService import to `src/utils/gemini.js`
5. Add `initialize-azure-realtime` IPC handler following blueprint exactly
6. Ensure boolean return values only (no complex objects)

### **Step 3: UI Implementation** 🎨
7. Update `src/components/views/AdvancedView.js` properties and constructor
8. Add Azure LLM Service section with conditional fields
9. Ensure handleInputChange follows PR84 pattern exactly

### **Step 4: Component Logic** 🎯
10. Update `src/components/app/CheatingDaddyApp.js` handleStart() with Azure validation
11. Add triggerAzureCredentialError() method for UI feedback
12. Ensure service-based routing matches PR84 pattern

### **Step 5: Renderer Integration** 🌐
13. Update `src/utils/renderer.js` initializeAzureRealtime function signature
14. Match IPC invoke parameters with handler signature exactly
15. Ensure cheddar object exports the function correctly

### **Step 6: Testing & Verification** ✅
16. Test provider switching (gemini ↔ azure) without errors
17. Verify Azure credential validation works correctly
18. Confirm status updates and IPC communication work
19. Run multiple start/stop cycles without crashes

---

## **🔥 FINAL COMMITMENT**

This is our last chance. One mistake and we're done. Study the PR84 patterns carefully. Copy them exactly. Test each step thoroughly. Only when 100% successful can we claim victory.

**Begin implementation now.**
</detailed_sequence_steps>

</task>
