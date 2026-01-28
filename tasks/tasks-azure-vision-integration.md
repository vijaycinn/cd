# Task List: Azure OpenAI Vision Integration

**Feature**: Screenshot Analysis using Azure OpenAI GPT-4.1  
**PRD**: `prd-azure-vision-integration.md`  
**Created**: January 28, 2026  
**Status**: Not Started  

---

## 📋 Task Breakdown

### Phase 1: Configuration & Settings (Foundation)

#### Task 1.1: Extend Azure Realtime Settings Configuration
**File**: `src/config/azureRealtimeSettings.js`  
**Estimated Time**: 20 minutes  
**Status**: ⏳ Not Started  

**Description**: Add vision configuration block to settings schema

**Implementation**:
```javascript
// In DEFAULT_TEMPLATE object, after pauseButton section:
vision: {
    _comment: [
        ''Vision/screenshot analysis settings for Azure OpenAI.'',
        ''Uses Chat Completions API with GPT-4.1 or similar vision-capable model.'',
        ''Separate from realtime voice deployment.''
    ],
    enabled: true,
    deployment: ''gpt-4.1'',
    detailLevel: ''auto'',  // ''low'' | ''high'' | ''auto''
    maxTokens: 1000,
    systemPrompt: ''You are analyzing a screenshot. Provide clear, concise insights.''
}
```

**Test Cases**:
- [ ] Settings file loads without errors
- [ ] Vision config accessible via `loadAzureRealtimeSettings()`
- [ ] Default values apply when config missing
- [ ] Comments preserved in template

**Acceptance Criteria**:
- Vision config structure matches schema
- Backward compatible with existing settings
- Default values sensible for most use cases

---

#### Task 1.2: Add UI Settings in AdvancedView
**File**: `src/components/views/AdvancedView.js`  
**Estimated Time**: 40 minutes  
**Status**: ⏳ Not Started  

**Description**: Add vision deployment fields to Azure OpenAI settings section

**Implementation Steps**:

1. **Add Static Properties**:
```javascript
static properties = {
    // Existing...
    azureApiKey: { type: String },
    azureEndpoint: { type: String },
    azureRegion: { type: String },
    azureDeployment: { type: String },
    // NEW:
    azureVisionEnabled: { type: Boolean },
    azureVisionDeployment: { type: String },
}
```

2. **Update Constructor**:
```javascript
constructor() {
    super();
    // Existing...
    this.azureDeployment = localStorage.getItem(''azureDeployment'') || ''gpt-realtime'';
    // NEW:
    this.azureVisionEnabled = localStorage.getItem(''azureVisionEnabled'') !== ''false'';
    this.azureVisionDeployment = localStorage.getItem(''azureVisionDeployment'') || ''gpt-4.1'';
}
```

3. **Update handleInputChange**:
```javascript
handleInputChange(e) {
    const { name, value, type, checked } = e.target;
    const newValue = type === ''checkbox'' ? checked : value;
    
    this[name] = newValue;
    localStorage.setItem(name, newValue);
    this.requestUpdate();
}
```

4. **Add UI Template** (after existing Azure deployment field):
```javascript
${this.llmService === ''azure'' ? html`
    <!-- Existing fields... -->
    <div class="form-group">
        <label class="form-label">Voice Deployment</label>
        <input type="text" name="azureDeployment" class="form-control" 
               .value=${this.azureDeployment} @input=${this.handleInputChange}
               placeholder="gpt-realtime">
        <small class="form-hint">Deployment for voice/audio (Realtime API)</small>
    </div>
    
    <!-- NEW: Vision Section -->
    <div class="form-group" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #333;">
        <label class="form-label">
            <input type="checkbox" name="azureVisionEnabled" 
                   .checked=${this.azureVisionEnabled}
                   @change=${this.handleInputChange}>
            Enable Screenshot Analysis
        </label>
    </div>
    
    ${this.azureVisionEnabled ? html`
        <div class="form-group">
            <label class="form-label">Vision Deployment</label>
            <input type="text" name="azureVisionDeployment" class="form-control"
                   .value=${this.azureVisionDeployment} @input=${this.handleInputChange}
                   placeholder="gpt-4.1">
            <small class="form-hint">Deployment for vision model (e.g., gpt-4.1, gpt-4o)</small>
        </div>
    ` : ''''}
` : ''''}
```

**Test Cases**:
- [ ] Checkbox appears when Azure selected
- [ ] Vision deployment field shows when enabled
- [ ] Values persist to localStorage
- [ ] Defaults work for new users
- [ ] Existing users see checkbox checked
- [ ] UI updates when toggling checkbox

**Acceptance Criteria**:
- Settings UI matches design mockup
- All fields save/load correctly
- Good UX with helpful hints
- No breaking changes to existing fields

---

### Phase 2: Azure Vision Service (Core Logic)

#### Task 2.1: Create AzureVisionService Class
**File**: `src/utils/azureVision.js` (NEW)  
**Estimated Time**: 60 minutes  
**Status**: ⏳ Not Started  

**Description**: Create service class for Chat Completions API with vision support

**Full Implementation**: See code block in PRD document

**Key Methods**:
- `constructor()` - Initialize OpenAI client with Azure config
- `init()` - Setup and validation
- `sendImage(base64, prompt)` - Analyze screenshot
- `sendText(text)` - Fallback text handling
- `close()` - Cleanup

**Test Cases**:
- [ ] Service initializes with valid credentials
- [ ] Rejects invalid endpoint format
- [ ] SendImage accepts base64 JPEG
- [ ] Returns text analysis response
- [ ] Handles API errors gracefully
- [ ] Respects maxTokens config
- [ ] Detail level parameter works
- [ ] Custom prompts apply correctly

**Acceptance Criteria**:
- Clean class interface matching LLMService
- Proper error handling with descriptive messages
- Configuration from azureRealtimeSettings
- No side effects on other services

---

### Phase 3: IPC Integration (Main Process)

#### Task 3.1: Add Vision Service Global Reference
**File**: `src/index.js` or `src/utils/gemini.js`  
**Estimated Time**: 10 minutes  
**Status**: ⏳ Not Started  

**Description**: Create global reference for vision service instance

**Implementation**:
```javascript
// Near other global references (azureServiceRef, geminiSessionRef)
if (!global.azureVisionServiceRef) {
    global.azureVisionServiceRef = { current: null };
}
```

**Test Cases**:
- [ ] Global reference accessible from IPC handlers
- [ ] Doesn''t conflict with existing refs
- [ ] Properly initialized before use

**Acceptance Criteria**:
- Single global instance
- Follows existing pattern
- Memory safe (no leaks)

---

#### Task 3.2: Add Vision Initialization IPC Handler
**File**: `src/index.js` or `src/utils/gemini.js`  
**Estimated Time**: 20 minutes  
**Status**: ⏳ Not Started  

**Description**: Create IPC handler for vision service initialization

**Implementation**:
```javascript
const { AzureVisionService } = require(''./utils/azureVision.js'');

ipcMain.handle(''initialize-azure-vision'', async (event, apiKey, endpoint, deployment, customPrompt, profile, language) => {
    try {
        console.log(''[IPC] Initializing Azure Vision service...'');
        const visionService = new AzureVisionService(
            apiKey, endpoint, deployment, customPrompt, profile, language
        );
        
        const success = await visionService.init();
        
        if (success) {
            global.azureVisionServiceRef.current = visionService;
            console.log(''[IPC] Azure Vision service initialized successfully'');
            return { success: true };
        }
        return { success: false, error: ''Initialization failed'' };
    } catch (error) {
        console.error(''[IPC] Azure Vision initialization error:'', error);
        return { success: false, error: error.message };
    }
});
```

**Test Cases**:
- [ ] Handler registered properly
- [ ] Returns success for valid credentials
- [ ] Returns error for invalid credentials
- [ ] Stores service in global reference
- [ ] Logs initialization events
- [ ] Doesn''t crash on errors

**Acceptance Criteria**:
- Consistent error handling
- Clear logging
- Non-blocking initialization

---

#### Task 3.3: Update send-image-content IPC Handler
**File**: `src/index.js` or `src/utils/gemini.js`  
**Estimated Time**: 30 minutes  
**Status**: ⏳ Not Started  

**Description**: Route screenshots to Azure Vision when enabled

**Implementation**:
```javascript
ipcMain.handle(''send-image-content'', async (event, { data, debug }) => {
    const llmService = await getStoredSetting(''llmService'', ''gemini'');
    const azureVisionEnabled = await getStoredSetting(''azureVisionEnabled'', ''true'') === ''true'';
    
    // Route to Azure Vision if enabled
    if (llmService === ''azure'' && azureVisionEnabled && global.azureVisionServiceRef?.current) {
        console.log(''[IPC] Routing screenshot to Azure Vision...'');
        try {
            const response = await global.azureVisionServiceRef.current.sendImage(data);
            
            // Send response to renderer
            sendToRenderer(''update-response'', response);
            
            return { success: true, response };
        } catch (error) {
            console.error(''[IPC] Azure Vision error:'', error);
            return { success: false, error: error.message };
        }
    }
    
    // Fallback to Gemini (existing logic)
    if (!geminiSessionRef.current) {
        return { success: false, error: ''No active Gemini session'' };
    }
    
    // ... existing Gemini code ...
});
```

**Test Cases**:
- [ ] Routes to Azure when enabled
- [ ] Falls back to Gemini when disabled
- [ ] Handles missing service reference
- [ ] Sends response to renderer
- [ ] Returns proper success/error
- [ ] Logs routing decisions

**Acceptance Criteria**:
- Correct routing based on settings
- No regression for Gemini
- Clean error messages
- Response format consistent

---

### Phase 4: Renderer Integration (Client Side)

#### Task 4.1: Add Vision Initialization Function
**File**: `src/utils/renderer.js`  
**Estimated Time**: 20 minutes  
**Status**: ⏳ Not Started  

**Description**: Create renderer-side function to initialize vision service

**Implementation**: See full code in PRD Phase 4.1

**Test Cases**:
- [ ] Checks vision enabled flag
- [ ] Reads correct localStorage keys
- [ ] Invokes IPC correctly
- [ ] Handles success/failure
- [ ] Logs appropriately
- [ ] Returns boolean result

**Acceptance Criteria**:
- Non-blocking async function
- Clear error messages
- Doesn''t break if credentials missing

---

#### Task 4.2: Update Main Initialization Flow
**File**: `src/utils/renderer.js`  
**Estimated Time**: 15 minutes  
**Status**: ⏳ Not Started  

**Description**: Integrate vision init into Azure Realtime initialization

**Implementation**:
```javascript
async function initializeAzureRealtime(profile = ''interview'', language = ''en-US'') {
    console.log(''[renderer] initializeAzureRealtime called'');
    
    // Initialize voice (WebSocket) - existing
    const voiceSuccess = await triggerAzureWebSocketInit(profile, language);
    
    // Initialize vision (REST) - new
    const visionSuccess = await initializeAzureVision(profile, language);
    
    if (!voiceSuccess) {
        console.warn(''[Renderer] Voice initialization failed'');
    }
    
    if (!visionSuccess) {
        console.warn(''[Renderer] Vision initialization failed (non-fatal)'');
    }
    
    return voiceSuccess; // Voice is critical
}
```

**Test Cases**:
- [ ] Both services initialize in parallel
- [ ] Voice failure reported properly
- [ ] Vision failure is non-fatal
- [ ] Returns voice status (critical path)
- [ ] Logs results clearly

**Acceptance Criteria**:
- Voice unaffected by vision failures
- Both services can run simultaneously
- Clear separation of concerns

---

#### Task 4.3: Export Vision Init Function
**File**: `src/utils/renderer.js`  
**Estimated Time**: 5 minutes  
**Status**: ⏳ Not Started  

**Description**: Export vision init for external access if needed

**Implementation**:
```javascript
const cheddar = {
    // Existing...
    initializeGemini,
    initializeAzureRealtime,
    initializeAzureVision,  // NEW: Export vision init
    // ...
};
```

**Test Cases**:
- [ ] Function accessible on cheddar object
- [ ] Can be called independently

**Acceptance Criteria**:
- Consistent with existing pattern
- Available globally

---

### Phase 5: Testing & Polish

#### Task 5.1: Add Validation Helper
**File**: `src/utils/azureVision.js`  
**Estimated Time**: 15 minutes  
**Status**: ⏳ Not Started  

**Description**: Add configuration validation function

**Implementation**:
```javascript
function validateAzureVisionConfig(apiKey, endpoint, deployment) {
    const errors = [];
    
    if (!apiKey || apiKey.trim() === '''') {
        errors.push(''Azure API Key is required'');
    }
    
    if (!endpoint || endpoint.trim() === '''') {
        errors.push(''Azure Endpoint is required'');
    } else if (!endpoint.startsWith(''http'')) {
        errors.push(''Azure Endpoint must be a valid URL'');
    }
    
    if (!deployment || deployment.trim() === '''') {
        errors.push(''Vision Deployment name is required'');
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}
```

**Test Cases**:
- [ ] Detects missing API key
- [ ] Detects missing endpoint
- [ ] Detects invalid URL format
- [ ] Detects missing deployment
- [ ] Returns all errors at once

**Acceptance Criteria**:
- User-friendly error messages
- All validation rules covered

---

#### Task 5.2: Add Error Handling in UI
**File**: `src/components/views/AdvancedView.js`  
**Estimated Time**: 20 minutes  
**Status**: ⏳ Not Started  

**Description**: Show validation errors in settings UI

**Implementation**:
```javascript
async validateAzureVisionSettings() {
    if (!this.azureVisionEnabled) return true;
    
    const errors = [];
    if (!this.azureApiKey) errors.push(''API Key required'');
    if (!this.azureEndpoint) errors.push(''Endpoint required'');
    if (!this.azureVisionDeployment) errors.push(''Vision Deployment required'');
    
    if (errors.length > 0) {
        this.statusMessage = errors.join('', '');
        this.statusType = ''error'';
        return false;
    }
    return true;
}
```

**Test Cases**:
- [ ] Shows errors in UI
- [ ] Clears errors when fixed
- [ ] Doesn''t validate when disabled

**Acceptance Criteria**:
- Inline validation feedback
- Non-blocking UX

---

#### Task 5.3: Integration Testing
**File**: Manual testing  
**Estimated Time**: 30 minutes  
**Status**: ⏳ Not Started  

**Test Scenarios**:

1. **Fresh Install**
   - [ ] Settings show default values
   - [ ] Vision enabled by default
   - [ ] Can configure and save

2. **Enable/Disable Vision**
   - [ ] Toggle works smoothly
   - [ ] Voice unaffected when toggling
   - [ ] Settings persist

3. **Screenshot Flow**
   - [ ] Screenshots route to Azure
   - [ ] Response appears in UI
   - [ ] Works with manual screenshots

4. **Error Scenarios**
   - [ ] Invalid credentials show error
   - [ ] Missing deployment shows error
   - [ ] Voice works if vision fails

5. **Switching Services**
   - [ ] Switch Azure → Gemini works
   - [ ] Switch Gemini → Azure works
   - [ ] Screenshots route correctly

6. **Performance**
   - [ ] Vision init doesn''t block UI
   - [ ] Screenshots analyze in <5s
   - [ ] No memory leaks

**Acceptance Criteria**:
- All test scenarios pass
- No regressions in existing features
- Smooth user experience

---

## 📊 Progress Tracking

### Phase 1: Configuration & Settings
- [ ] Task 1.1: Extend settings (20 min)
- [ ] Task 1.2: Add UI fields (40 min)
- **Total: 0/2 complete (0%)**

### Phase 2: Azure Vision Service
- [ ] Task 2.1: Create service class (60 min)
- **Total: 0/1 complete (0%)**

### Phase 3: IPC Integration
- [ ] Task 3.1: Global reference (10 min)
- [ ] Task 3.2: Init handler (20 min)
- [ ] Task 3.3: Image routing (30 min)
- **Total: 0/3 complete (0%)**

### Phase 4: Renderer Integration
- [ ] Task 4.1: Vision init function (20 min)
- [ ] Task 4.2: Update main flow (15 min)
- [ ] Task 4.3: Export function (5 min)
- **Total: 0/3 complete (0%)**

### Phase 5: Testing & Polish
- [ ] Task 5.1: Validation helper (15 min)
- [ ] Task 5.2: UI error handling (20 min)
- [ ] Task 5.3: Integration testing (30 min)
- **Total: 0/3 complete (0%)**

---

## 🎯 Overall Progress

**Total Tasks**: 12  
**Completed**: 0  
**Remaining**: 12  
**Progress**: 0%

**Estimated Total Time**: 4 hours

---

## 🚀 Next Steps

1. **Phase 1, Task 1.1**: Add vision config to `azureRealtimeSettings.js`
2. Run app and verify settings load
3. Proceed to Task 1.2

---

## 📝 Notes

- Voice functionality is completely independent
- Vision can be disabled without affecting anything
- All changes are additive (no breaking changes)
- Follow existing code patterns for consistency

---

**Last Updated**: January 28, 2026  
**Next Review**: After Phase 1 completion
