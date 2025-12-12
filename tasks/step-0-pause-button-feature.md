# Step 0: Pause Button for Manual Response Triggering

**Feature Goal**: Add a pause button to the UI that temporarily stops continuous audio transmission to Azure, allowing accumulated audio to be processed and generate a response, then resume audio capture.

**Priority**: HIGH (Prerequisite for Phase 1-9 VAD implementation)  
**Status**: Planning - Awaiting Approval  
**Date**: 2025-12-12

---

## 🎯 **Feature Overview**

### **Current Behavior**
- Audio continuously streams to Azure OpenAI Realtime API
- Server VAD (`server_vad`, `semantic_vad`, or `azure_semantic_vad`) detects speech end
- Server auto-commits audio buffer when speech stops
- Response generated automatically (when `createResponse: true`)

### **Desired Behavior with Pause Button**
- User can manually control when to stop audio transmission
- Clicking "Pause" button:
  1. Stops capturing/sending new audio chunks
  2. Flushes any accumulated audio chunks to server
  3. Triggers manual commit of audio buffer (or lets server VAD commit)
  4. Waits for server to process and respond
  5. Button changes to "Resume"
- Clicking "Resume" button:
  1. Re-enables audio capture and transmission
  2. Resets state for next audio segment
  3. Button changes back to "Pause"

### **Use Cases**
1. **Manual turn-taking**: User wants to control exactly when their speech ends
2. **Network latency**: User wants to ensure all audio is sent before requesting response
3. **Testing/Debugging**: Developer wants precise control over audio buffer commits
4. **Noisy environments**: User wants to prevent false speech detection triggers

---

## 📋 **Implementation Plan**

### **Phase 0.1: Backend State Management**

#### **Task 0.1.1: Add Pause State to AzureRealtimeWebSocket**
**File**: `src/utils/azureRealtimeWebSocket.js`  
**Priority**: CRITICAL  

**Changes Required**:
```javascript
// In constructor (around line 75)
this.audioPaused = false;          // Pause state flag
this.pauseRequested = false;        // Pause request pending
this.resumeRequested = false;       // Resume request pending
```

**Reasoning**: Need to track pause state separately from other states to avoid conflicts with server VAD.

---

#### **Task 0.1.2: Implement pauseAudio() Method**
**File**: `src/utils/azureRealtimeWebSocket.js`  
**Priority**: CRITICAL  

**Implementation**:
```javascript
/**
 * Pause audio transmission and trigger response
 * Flushes accumulated audio and optionally commits buffer
 */
pauseAudio() {
    if (this.audioPaused) {
        console.log('[AzureWebSocket] Audio already paused, ignoring');
        return { success: false, reason: 'already_paused' };
    }

    console.log('[AzureWebSocket] Pausing audio transmission');
    this.audioPaused = true;
    this.pauseRequested = true;

    // Flush any accumulated audio chunks
    const flushed = this.flushAudioAccumulator({ 
        force: true, 
        context: 'pause_button' 
    });

    if (!flushed) {
        console.warn('[AzureWebSocket] Failed to flush audio on pause');
        return { success: false, reason: 'flush_failed' };
    }

    // Decision: Should we manually commit or let server VAD handle it?
    // Option A: Let server VAD handle commit (recommended for server_vad mode)
    // Option B: Manual commit (needed if serverVad.enabled = false)
    
    const serverVadEnabled = this.azureRealtimeSettings.serverVad?.enabled ?? true;
    
    if (!serverVadEnabled) {
        // Manual commit mode - we must commit
        console.log('[AzureWebSocket] Manual commit mode - committing buffer');
        this.commitAudioBuffer('pause_button', { forceTailPadding: true });
    } else {
        // Server VAD mode - server will auto-commit when it detects speech end
        // We can optionally send input_audio_buffer.commit to force immediate commit
        console.log('[AzureWebSocket] Server VAD mode - waiting for auto-commit');
        
        // Optional: Force immediate commit even with server VAD
        // Uncomment if you want pause button to always force commit:
        // this.commitAudioBuffer('pause_button_force', { forceTailPadding: true });
    }

    // Update UI status
    if (this.callbacks.onStatus) {
        this.callbacks.onStatus('Processing...');
    }

    this.pauseRequested = false;
    return { success: true, mode: serverVadEnabled ? 'server_vad' : 'manual' };
}
```

**Reasoning**: 
- Flushes pending audio chunks to ensure nothing is lost
- Respects server VAD configuration (doesn't force manual commits if server VAD enabled)
- Provides feedback to UI layer

---

#### **Task 0.1.3: Implement resumeAudio() Method**
**File**: `src/utils/azureRealtimeWebSocket.js`  
**Priority**: CRITICAL  

**Implementation**:
```javascript
/**
 * Resume audio transmission after pause
 * Resets state and prepares for next audio segment
 */
resumeAudio() {
    if (!this.audioPaused) {
        console.log('[AzureWebSocket] Audio not paused, ignoring resume');
        return { success: false, reason: 'not_paused' };
    }

    console.log('[AzureWebSocket] Resuming audio transmission');
    this.audioPaused = false;
    this.resumeRequested = false;

    // Reset audio accumulator for fresh start
    this.pendingChunkAccumulator = [];
    this.pendingChunkBytes = 0;

    // Update UI status
    if (this.callbacks.onStatus) {
        this.callbacks.onStatus('Listening...');
    }

    return { success: true };
}
```

**Reasoning**: Clean state reset ensures no audio leakage between pause/resume cycles.

---

#### **Task 0.1.4: Modify sendAudio() to Respect Pause State**
**File**: `src/utils/azureRealtimeWebSocket.js` (line ~874)  
**Priority**: CRITICAL  

**Change Required**:
```javascript
async sendAudio(audioData) {
    // Early exit if paused
    if (this.audioPaused) {
        // Optionally log throttled warning
        const now = Date.now();
        if (now - (this._lastPauseWarnTs || 0) > 5000) {
            console.log('[AzureWebSocket] Audio paused - dropping incoming chunks');
            this._lastPauseWarnTs = now;
        }
        return true; // Return success to avoid breaking audio pipeline
    }

    // ... rest of existing sendAudio logic
```

**Reasoning**: Prevents audio accumulation while paused without breaking the audio capture pipeline.

---

### **Phase 0.2: AudioRouter Integration**

#### **Task 0.2.1: Add Pause/Resume Methods to AudioRouter**
**File**: `src/utils/audioRouter.js`  
**Priority**: HIGH  

**Implementation**:
```javascript
// In AudioRouter class (after line 150)

/**
 * Pause Azure audio transmission
 */
pauseAzureAudio() {
    if (!this.azureServiceRef?.current) {
        console.warn('[AudioRouter] No Azure service to pause');
        return { success: false, reason: 'no_azure_service' };
    }

    if (!this.routingActive) {
        console.warn('[AudioRouter] Azure routing not active');
        return { success: false, reason: 'routing_inactive' };
    }

    return this.azureServiceRef.current.pauseAudio();
}

/**
 * Resume Azure audio transmission
 */
resumeAzureAudio() {
    if (!this.azureServiceRef?.current) {
        console.warn('[AudioRouter] No Azure service to resume');
        return { success: false, reason: 'no_azure_service' };
    }

    if (!this.routingActive) {
        console.warn('[AudioRouter] Azure routing not active');
        return { success: false, reason: 'routing_inactive' };
    }

    return this.azureServiceRef.current.resumeAudio();
}

/**
 * Get current pause state
 */
isAudioPaused() {
    if (!this.azureServiceRef?.current) return false;
    return this.azureServiceRef.current.audioPaused ?? false;
}
```

**Reasoning**: AudioRouter is the abstraction layer between UI and Azure service, should expose pause controls.

---

### **Phase 0.3: IPC Communication Layer**

#### **Task 0.3.1: Add IPC Handlers in Main Process**
**File**: `src/index.js`  
**Priority**: HIGH  

**Implementation**:
```javascript
// Add after existing Azure IPC handlers (search for 'azure-')

ipcMain.handle('azure-pause-audio', async () => {
    try {
        if (!audioRouter) {
            return { success: false, error: 'AudioRouter not initialized' };
        }
        return audioRouter.pauseAzureAudio();
    } catch (error) {
        console.error('[Main] Error pausing Azure audio:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('azure-resume-audio', async () => {
    try {
        if (!audioRouter) {
            return { success: false, error: 'AudioRouter not initialized' };
        }
        return audioRouter.resumeAzureAudio();
    } catch (error) {
        console.error('[Main] Error resuming Azure audio:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('azure-get-pause-state', async () => {
    try {
        if (!audioRouter) {
            return { paused: false };
        }
        return { paused: audioRouter.isAudioPaused() };
    } catch (error) {
        console.error('[Main] Error getting pause state:', error);
        return { paused: false };
    }
});
```

**Reasoning**: Secure IPC layer follows Electron best practices for renderer-to-main communication.

---

#### **Task 0.3.2: Add Preload Bindings**
**File**: `src/preload.js`  
**Priority**: HIGH  

**Implementation**:
```javascript
// Add to contextBridge.exposeInMainWorld electron object
contextBridge.exposeInMainWorld('electron', {
    // ... existing methods
    
    azurePauseAudio: () => ipcRenderer.invoke('azure-pause-audio'),
    azureResumeAudio: () => ipcRenderer.invoke('azure-resume-audio'),
    azureGetPauseState: () => ipcRenderer.invoke('azure-get-pause-state')
});
```

**Reasoning**: Exposes pause/resume methods to renderer process securely.

---

### **Phase 0.4: UI Components**

#### **Task 0.4.1: Add Pause Button to AppHeader Menu Bar**
**File**: `src/components/app/AppHeader.js`  
**Priority**: HIGH  

**Implementation**:

**Step 1: Add properties to AppHeader class (after line 95)**
```javascript
static properties = {
    // ... existing properties
    llmProvider: { type: String },          // Track current LLM provider
    audioPaused: { type: Boolean },         // Track audio pause state
    onPauseClick: { type: Function },       // Pause button callback
};

constructor() {
    super();
    // ... existing initialization
    this.llmProvider = 'gemini';
    this.audioPaused = false;
    this.onPauseClick = () => {};
    this._pauseStateInterval = null;
}
```

**Step 2: Add pause state polling (after connectedCallback, line ~115)**
```javascript
connectedCallback() {
    super.connectedCallback();
    this._startTimer();
    this._startPauseStatePolling();
}

disconnectedCallback() {
    super.disconnectedCallback();
    this._stopTimer();
    this._stopPauseStatePolling();
}

_startPauseStatePolling() {
    if (this.llmProvider === 'azure' && this.currentView === 'assistant') {
        this._stopPauseStatePolling();
        this._pauseStateInterval = setInterval(() => this._updatePauseState(), 500);
        this._updatePauseState(); // Immediate update
    }
}

_stopPauseStatePolling() {
    if (this._pauseStateInterval) {
        clearInterval(this._pauseStateInterval);
        this._pauseStateInterval = null;
    }
}

async _updatePauseState() {
    if (!window.electron?.azureGetPauseState) return;
    
    try {
        const result = await window.electron.azureGetPauseState();
        this.audioPaused = result.paused ?? false;
    } catch (error) {
        // Silent fail - just keep previous state
    }
}
```

**Step 3: Add pause icon SVGs (helper methods before render())**
```javascript
_renderPauseIcon() {
    return html`
        <?xml version="1.0" encoding="UTF-8"?>
        <svg width="24px" height="24px" stroke-width="1.7" viewBox="0 0 24 24" 
             fill="none" xmlns="http://www.w3.org/2000/svg" color="currentColor">
            <path d="M6 18.4V5.6C6 5.26863 6.26863 5 6.6 5H9.4C9.73137 5 10 5.26863 10 5.6V18.4C10 18.7314 9.73137 19 9.4 19H6.6C6.26863 19 6 18.7314 6 18.4Z" 
                  stroke="currentColor" stroke-width="1.7"/>
            <path d="M14 18.4V5.6C14 5.26863 14.2686 5 14.6 5H17.4C17.7314 5 18 5.26863 18 5.6V18.4C18 18.7314 17.7314 19 17.4 19H14.6C14.2686 19 14 18.7314 14 18.4Z" 
                  stroke="currentColor" stroke-width="1.7"/>
        </svg>
    `;
}

_renderResumeIcon() {
    return html`
        <?xml version="1.0" encoding="UTF-8"?>
        <svg width="24px" height="24px" stroke-width="1.7" viewBox="0 0 24 24" 
             fill="none" xmlns="http://www.w3.org/2000/svg" color="currentColor">
            <path d="M6.90588 4.53682C6.50592 4.2998 6 4.58808 6 5.05299V18.947C6 19.4119 6.50592 19.7002 6.90588 19.4632L18.629 12.5162C19.0211 12.2838 19.0211 11.7162 18.629 11.4838L6.90588 4.53682Z" 
                  stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;
}
```

**Step 4: Add pause button to header actions in render() method**

Insert the pause button before the "Hide" button in the assistant view section (around line 360):
```javascript
${this.currentView === 'assistant'
    ? html`
          <!-- Pause button (Azure only) -->
          ${this.llmProvider === 'azure'
              ? html`
                    <button 
                        @click=${this.onPauseClick} 
                        class="icon-button"
                        title="${this.audioPaused ? 'Resume audio transmission' : 'Pause to trigger response'}"
                    >
                        ${this.audioPaused ? this._renderResumeIcon() : this._renderPauseIcon()}
                    </button>
                `
              : ''}
          <!-- Hide button -->
          <button @click=${this.onHideToggleClick} class="button">
              Hide&nbsp;&nbsp;<span class="key" style="pointer-events: none;">${cheddar.isMacOS ? 'Cmd' : 'Ctrl'}</span
              >&nbsp;&nbsp;<span class="key">&bsol;</span>
          </button>
          <!-- ... rest of assistant view actions -->
      `
    : ''}
```

**Step 5: Update polling on view/provider changes**
```javascript
updated(changedProperties) {
    super.updated(changedProperties);

    // Start/stop timer based on view change
    if (changedProperties.has('currentView')) {
        if (this.currentView === 'assistant' && this.startTime) {
            this._startTimer();
        } else {
            this._stopTimer();
        }
        // Start/stop pause state polling
        this._startPauseStatePolling();
    }

    // Start/stop pause polling on provider change
    if (changedProperties.has('llmProvider')) {
        this._startPauseStatePolling();
    }

    // ... rest of existing updated logic
}
```

**Reasoning**: 
- Integrates seamlessly into existing AppHeader component
- Uses consistent icon-button styling matching other header buttons
- Only visible in assistant view when Azure provider is active
- Polls pause state automatically to stay synchronized
- Minimal code changes, follows existing patterns

---

#### **Task 0.4.2: Connect AppHeader Pause Button to Backend**
**File**: `src/components/app/SoundBoardApp.js` (or main app component)  
**Priority**: HIGH  

**Changes Required**:

**Step 1: Pass llmProvider to AppHeader**
```javascript
// In SoundBoardApp render() method, update app-header binding:
<app-header
    .currentView=${this.currentView}
    .statusText=${this.statusText}
    .startTime=${this.startTime}
    .llmProvider=${this.llmProvider}
    .audioPaused=${this.audioPaused}
    .onPauseClick=${this.handlePauseClick.bind(this)}
    @customize-click=${this.handleCustomizeClick}
    @help-click=${this.handleHelpClick}
    @history-click=${this.handleHistoryClick}
    @close-click=${this.handleCloseClick}
    @back-click=${this.handleBackClick}
    @hide-toggle-click=${this.handleHideToggleClick}
></app-header>
```

**Step 2: Add pause click handler**
```javascript
async handlePauseClick() {
    if (!window.electron) return;

    try {
        if (this.audioPaused) {
            // Resume
            const result = await window.electron.azureResumeAudio();
            if (result.success) {
                this.audioPaused = false;
                console.log('[SoundBoardApp] Audio resumed');
            } else {
                console.error('[SoundBoardApp] Resume failed:', result.reason);
            }
        } else {
            // Pause
            const result = await window.electron.azurePauseAudio();
            if (result.success) {
                this.audioPaused = true;
                console.log('[SoundBoardApp] Audio paused');
            } else {
                console.error('[SoundBoardApp] Pause failed:', result.reason);
            }
        }
    } catch (error) {
        console.error('[SoundBoardApp] Error toggling pause:', error);
    }
}
```

**Step 3: Track provider changes**
```javascript
// Listen for provider changes in connectedCallback
window.electron?.ipcRenderer?.on('llm-provider-changed', (event, provider) => {
    this.llmProvider = provider;
});
```

**Reasoning**: 
- Centralizes pause/resume logic in main app component
- Passes state down to AppHeader for display
- Follows existing event handling patterns

---

### **Phase 0.5: Configuration Options**

#### **Task 0.5.1: Add Pause Button Settings**
**File**: `src/config/azureRealtimeSettings.js`  
**Priority**: MEDIUM  

**Changes Required**:
```javascript
const DEFAULT_TEMPLATE = {
    // ... existing settings
    
    pauseButton: {
        _comment: [
            'Pause button behavior configuration.',
            'forceCommitOnPause: true = always commit buffer when paused',
            'autoResumeAfterResponse: true = automatically resume after response complete'
        ],
        forceCommitOnPause: false,  // Let server VAD handle by default
        autoResumeAfterResponse: false,  // User must manually resume
        showInUI: true  // Show pause button in assistant view
    }
};
```

**Reasoning**: Provides configuration flexibility for different use cases.

---

#### **Task 0.5.2: Implement Auto-Resume Feature (Optional)**
**File**: `src/utils/azureRealtimeWebSocket.js`  
**Priority**: LOW  

**Implementation**:
```javascript
// In handleWebSocketMessage, case 'response.done':
case 'response.done':
    // ... existing response.done logic
    
    // Auto-resume if configured
    const autoResume = this.azureRealtimeSettings.pauseButton?.autoResumeAfterResponse ?? false;
    if (autoResume && this.audioPaused) {
        console.log('[AzureWebSocket] Auto-resuming after response complete');
        this.resumeAudio();
    }
    break;
```

**Reasoning**: Some users may prefer automatic resume after response, others want manual control.

---

## 🧪 **Testing Plan**

### **Manual Testing**

#### **Test 0.1: Basic Pause/Resume Cycle**
1. Start Azure session
2. Speak for 2-3 seconds
3. Click "Pause" button
4. Verify: Audio transmission stops, response is generated
5. Click "Resume" button
6. Speak again
7. Verify: Audio transmission resumes, can trigger another response

**Expected Result**: Clean pause/resume cycle without audio loss or state corruption.

---

#### **Test 0.2: Pause During Server VAD Speech Detection**
1. Start speaking
2. Click "Pause" while still speaking (before server detects speech_stopped)
3. Verify: Immediate pause, audio flushed and committed
4. Verify: Response generated from partial speech

**Expected Result**: Pause takes priority over server VAD timing.

---

#### **Test 0.3: Multiple Pause/Resume Cycles**
1. Perform 5 consecutive pause/resume cycles
2. Verify: No audio leakage between cycles
3. Verify: Each cycle produces independent response
4. Check logs for memory leaks or state issues

**Expected Result**: Stable behavior across multiple cycles.

---

#### **Test 0.4: Pause When No Audio Sent**
1. Start session
2. Immediately click "Pause" without speaking
3. Verify: Graceful handling (no error, no response generated)
4. Click "Resume"
5. Verify: Can speak normally

**Expected Result**: No errors or crashes when pausing with empty buffer.

---

#### **Test 0.5: Provider Switching**
1. Start Azure session with pause button visible
2. Switch to Gemini provider
3. Verify: Pause button disappears
4. Switch back to Azure
5. Verify: Pause button reappears and functions

**Expected Result**: Pause button only active for Azure provider.

---

### **Automated Testing (Future)**

```javascript
// Example test structure (Jest/Vitest)
describe('AzureRealtimeWebSocket Pause/Resume', () => {
    test('pauseAudio flushes accumulator', () => {
        // Arrange: Create service, add audio chunks
        // Act: Call pauseAudio()
        // Assert: flushAudioAccumulator called, audioPaused = true
    });

    test('sendAudio drops chunks when paused', () => {
        // Arrange: Pause audio
        // Act: Send audio chunk
        // Assert: Chunk dropped, not added to accumulator
    });

    test('resumeAudio resets state', () => {
        // Arrange: Pause audio
        // Act: Call resumeAudio()
        // Assert: audioPaused = false, accumulators cleared
    });
});
```

---

## 📊 **Success Criteria**

### **Must Have**
- ✅ Pause button visible only when Azure provider active
- ✅ Clicking "Pause" stops audio transmission immediately
- ✅ Accumulated audio flushed and processed
- ✅ Response generated after pause
- ✅ Clicking "Resume" re-enables audio capture
- ✅ No audio loss or state corruption across pause/resume cycles
- ✅ Works correctly with server VAD enabled/disabled

### **Should Have**
- ✅ Configuration option for force-commit vs server VAD auto-commit
- ✅ Configuration option for auto-resume after response
- ✅ Clear visual feedback (button states, icons)
- ✅ Graceful error handling (pause with no audio, etc.)

### **Nice to Have**
- ⏳ Keyboard shortcut for pause/resume (e.g., Spacebar)
- ⏳ Visual indicator showing pause state in transcript
- ⏳ Metrics tracking (pause count, avg pause duration)
- ⏳ Animation during pause-to-processing transition

---

## 🚨 **Known Issues & Edge Cases**

### **Issue 1: Race Condition with Server VAD**
**Scenario**: User clicks "Pause" exactly when server VAD detects `speech_stopped`  
**Solution**: Pause flag takes priority, server auto-commit is ignored if manual pause triggered  
**Status**: Needs testing

---

### **Issue 2: Network Latency**
**Scenario**: Audio chunks still in flight when pause clicked  
**Solution**: `flushAudioAccumulator()` ensures all pending chunks sent before pause completes  
**Status**: Handled

---

### **Issue 3: Pause During Response Generation**
**Scenario**: User clicks "Pause" while model is already generating response  
**Solution**: Pause only affects audio input, response continues. Next pause/resume cycle starts after current response completes.  
**Status**: Expected behavior

---

## 🔄 **Integration with Existing VAD Implementation**

### **Compatibility with Phase 1-9 Tasks**

This Step 0 implementation is **complementary** to the existing VAD tasks:

- **Phase 1 (Server VAD Setup)**: Pause button works with all VAD types (server_vad, semantic_vad, azure_semantic_vad)
- **Phase 2 (Response Lifecycle)**: `responseInProgress` flag prevents pause during active response
- **Phase 3 (Silence Filtering)**: Client-side silence gate still active while not paused
- **Phase 4 (Metrics)**: Add `pauseCount`, `resumeCount`, `avgPauseDuration` metrics
- **Phase 5 (Code Cleanup)**: Pause logic is isolated, doesn't conflict with VAD cleanup
- **Phase 6-8 (Testing)**: Add pause button tests to each test scenario
- **Phase 9 (Documentation)**: Document pause button configuration and use cases

### **Configuration Interaction**

```javascript
// Example: How pause button interacts with server VAD
if (pauseButton.forceCommitOnPause) {
    // Force manual commit even with server VAD
    this.commitAudioBuffer('pause_button_force');
} else if (serverVad.enabled) {
    // Let server VAD handle commit timing
    // Pause just stops new audio input
} else {
    // Manual mode - must commit
    this.commitAudioBuffer('pause_button');
}
```

---

## 📝 **Implementation Checklist**

- [ ] **0.1.1** Add pause state flags to AzureRealtimeWebSocket constructor
- [ ] **0.1.2** Implement `pauseAudio()` method
- [ ] **0.1.3** Implement `resumeAudio()` method
- [ ] **0.1.4** Modify `sendAudio()` to check pause state
- [ ] **0.2.1** Add pause/resume methods to AudioRouter
- [ ] **0.3.1** Add IPC handlers in main process (index.js)
- [ ] **0.3.2** Add preload bindings for pause/resume (preload.js)
- [ ] **0.4.1** Add pause button to AppHeader menu bar with icon
- [ ] **0.4.2** Connect AppHeader pause button to backend in SoundBoardApp
- [ ] **0.5.1** Add pause button configuration options
- [ ] **0.5.2** Implement auto-resume feature (optional)
- [ ] **Test 0.1** Basic pause/resume cycle
- [ ] **Test 0.2** Pause during server VAD detection
- [ ] **Test 0.3** Multiple pause/resume cycles
- [ ] **Test 0.4** Pause with empty buffer
- [ ] **Test 0.5** Provider switching behavior
- [ ] Update `azure-vad-implementation.md` to reference Step 0
- [ ] Update `azure-configuration-guide.md` with pause button documentation

---

## 🎯 **Next Steps**

1. **Review this plan** and provide feedback/approval
2. **Choose configuration defaults**:
   - `forceCommitOnPause`: `false` (recommended) or `true`?
   - `autoResumeAfterResponse`: `false` (recommended) or `true`?
3. **UI Placement**: ✅ **DECIDED** - Pause button will appear in AppHeader menu bar (assistant view only, Azure provider only)
4. **Approve implementation** to proceed with Phase 0.1

---

## 📚 **References**

- Azure OpenAI Realtime API: [Audio Buffer Management](https://learn.microsoft.com/en-us/azure/ai-services/openai/realtime-audio-reference#audio-buffer-management)
- Existing task list: `tasks/azure-vad-implementation.md`
- Audio routing: `src/utils/audioRouter.js`
- WebSocket service: `src/utils/azureRealtimeWebSocket.js`
- UI components: `src/components/views/AssistantView.js`

---

**Ready for Implementation**: Awaiting user approval to proceed with Step 0 implementation.
