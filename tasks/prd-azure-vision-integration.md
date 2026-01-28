# Product Requirements Document: Azure OpenAI Vision Integration

**Feature**: Screenshot Analysis using Azure OpenAI GPT-4.1 (Chat Completions API)  
**Created**: January 28, 2026  
**Status**: Planning  
**Priority**: Medium  

---

## 🎯 Objective

Add screenshot analysis capability using Azure OpenAI GPT-4.1 (Chat Completions API with vision) while preserving existing Azure Realtime voice functionality.

## 📐 Architecture Overview

### Current State
- **Voice**: Azure Realtime API (gpt-realtime) via WebSocket → `azureRealtimeWebSocket.js`
- **Screenshots**: Gemini only → `send-image-content` IPC → Gemini session

### Target State (Hybrid)
- **Voice**: Azure Realtime API (gpt-realtime) via WebSocket [NO CHANGES]
- **Screenshots**: Azure Chat Completions API (gpt-4.1) via REST [NEW]

### Key Design Principles
1. **Separation of Concerns**: Voice (WebSocket) and Vision (REST) are independent services
2. **Optional Vision**: Voice functionality works independently; vision is additive
3. **Shared Credentials**: API key and endpoint are resource-level, deployments are model-specific
4. **Backward Compatible**: No impact on Gemini users or Azure voice-only users
5. **Graceful Degradation**: Voice works even if vision initialization fails

---

## 🔧 Technical Architecture

### Service Layer
```
AzureRealtimeWebSocketService (existing)
  ├─ WebSocket connection to Realtime API
  ├─ Handles: Audio streaming, VAD, session management
  └─ Model: gpt-realtime

AzureVisionService (new)
  ├─ REST API calls to Chat Completions
  ├─ Handles: Image analysis, text responses
  └─ Model: gpt-4.1 or gpt-4o
```

### Configuration Structure
```javascript
azureRealtimeSettings.js:
  - voice: { existing voice/VAD settings }
  - vision: {
      enabled: true,
      deployment: "gpt-4.1",
      detailLevel: "auto",
      maxTokens: 1000,
      systemPrompt: "..."
    }
```

### IPC Flow
```
Renderer (screenshot) 
  → send-image-content IPC
    → Route based on llmService + azureVisionEnabled
      → Azure: AzureVisionService.sendImage()
      → Gemini: Gemini session (existing)
    → Response via update-response channel
```

---

## 💾 Data Requirements

### New localStorage Keys
- `azureVisionEnabled`: boolean (default: true)
- `azureVisionDeployment`: string (default: "gpt-4.1")

### Existing Keys (Reused)
- `azureApiKey`: Shared between voice and vision
- `azureEndpoint`: Shared between voice and vision
- `azureDeployment`: Voice/Realtime deployment only

---

## 🎨 User Interface Changes

### Advanced Settings → Azure OpenAI Section

**Before:**
```
[x] LLM Service: Azure OpenAI
  - Azure API Key: [password field]
  - Azure Endpoint: [text field]
  - Azure Region: [text field]
  - Deployment Name: [text field] (gpt-realtime)
```

**After:**
```
[x] LLM Service: Azure OpenAI
  - Azure API Key: [password field]
  - Azure Endpoint: [text field]
  - Azure Region: [text field]
  - Voice Deployment: [text field] (gpt-realtime)
  
  [x] Enable Screenshot Analysis
  - Vision Deployment: [text field] (gpt-4.1)
      Hint: Deployment name for vision model (e.g., gpt-4.1, gpt-4o)
```

---

## 📋 Implementation Phases

### Phase 1: Configuration & Settings ✅
**Goal**: Add vision config structure and UI settings  
**Files**: `azureRealtimeSettings.js`, `AdvancedView.js`  
**Deliverable**: Users can configure vision deployment in settings

### Phase 2: Azure Vision Service ✅
**Goal**: Create Chat Completions service with vision support  
**Files**: New `azureVision.js`  
**Deliverable**: Service class that can analyze images via Azure

### Phase 3: IPC Integration ✅
**Goal**: Connect vision service to main process  
**Files**: `index.js` or `gemini.js`  
**Deliverable**: IPC handlers for vision init and image routing

### Phase 4: Renderer Integration ✅
**Goal**: Initialize vision alongside voice  
**Files**: `renderer.js`  
**Deliverable**: Vision service initializes when Azure selected

### Phase 5: Testing & Polish ✅
**Goal**: Validation, error handling, user feedback  
**Files**: Multiple  
**Deliverable**: Production-ready feature with proper error states

---

## ✅ Success Criteria

### Functional Requirements
- [x] Users can enable/disable vision independently of voice
- [x] Screenshots route to Azure Vision when enabled
- [x] Azure voice functionality unaffected (no regression)
- [x] Gemini users unaffected (no regression)
- [x] Vision works with gpt-4.1 deployment
- [x] Clear error messages for missing credentials
- [x] Vision initialization can fail without breaking voice

### Non-Functional Requirements
- [x] Vision requests complete within 5 seconds (typical)
- [x] No memory leaks from vision service
- [x] Proper cleanup on service close
- [x] Configuration persists across restarts
- [x] Settings UI responsive and intuitive

---

## 🔒 Security & Privacy

### Authentication
- Reuses existing Azure API key (same resource)
- No additional credentials required
- API key stored in localStorage (existing pattern)

### Data Handling
- Screenshots sent as base64 to Azure API
- No local storage of screenshot data
- Temporary base64 encoding only during transmission
- Follows existing Gemini screenshot privacy model

---

## 📊 Testing Strategy

### Unit Tests
- AzureVisionService initialization
- Image encoding/decoding
- Error handling for API failures
- Configuration validation

### Integration Tests
- Voice + Vision running simultaneously
- Screenshot routing based on llmService
- IPC communication flow
- Settings persistence

### Manual Testing
- Enable/disable vision toggle
- Switch between Gemini and Azure
- Test with invalid credentials
- Test with missing deployment
- Verify voice unaffected
- Test screenshot analysis quality

---

## 🚫 Out of Scope

### Not Included in V1
- Batch image analysis
- Image preprocessing/optimization
- Vision-specific rate limiting
- Custom vision prompts per screenshot
- Vision conversation history
- Integration with voice responses

### Future Considerations
- Multimodal responses (voice + vision combined)
- Vision streaming for video analysis
- Advanced image preprocessing
- Vision-specific grounding sources
- Vision analytics/metrics dashboard

---

## 📈 Metrics & Monitoring

### Key Metrics
- Vision service initialization success rate
- Screenshot analysis latency (p50, p95, p99)
- Vision API error rate
- Vision feature adoption rate
- Voice service stability (pre/post vision)

### Logging
- Vision service lifecycle events
- Image analysis requests/responses
- API errors with context
- Configuration changes

---

## 🔄 Rollback Plan

### If Issues Arise
1. Set `azureVisionEnabled: false` in settings (user-level)
2. Remove vision IPC handlers (code-level)
3. Voice functionality remains intact
4. Gemini screenshots continue working

### Zero-Risk Rollback
- Voice and Gemini unaffected by vision failures
- Vision is purely additive feature
- Can disable without code changes via settings toggle

---

## 📚 Documentation Requirements

### User Documentation
- How to configure vision deployment
- Supported vision models
- Troubleshooting vision errors
- Performance expectations

### Developer Documentation
- Architecture diagram
- Service class API reference
- IPC protocol documentation
- Configuration schema

---

## 🎯 Dependencies

### External
- Azure OpenAI resource with GPT-4.1 deployment
- `openai` npm package (already installed)
- Chat Completions API access

### Internal
- Existing Azure authentication infrastructure
- Screenshot capture mechanism (renderer.js)
- IPC communication framework
- Settings persistence (localStorage)

---

## ⏱️ Timeline Estimate

- **Phase 1**: 1 hour (Config + UI)
- **Phase 2**: 1 hour (Service class)
- **Phase 3**: 0.5 hours (IPC handlers)
- **Phase 4**: 0.5 hours (Renderer integration)
- **Phase 5**: 1 hour (Testing + polish)

**Total**: 3-4 hours for complete implementation + testing

---

## 👥 Stakeholders

- **Developer**: VC
- **Users**: Audio interview assistant users with Azure subscriptions
- **Impacted**: Existing Azure voice users (minimal impact)

---

## 📝 Open Questions

- [ ] Should vision deployment default to same as voice if not specified?
- [ ] Do we need vision-specific rate limiting?
- [ ] Should vision analysis include conversation context?
- [ ] Need separate system prompts for voice vs vision?
- [ ] Should vision errors surface in UI or just console?

---

## ✅ Approval & Sign-off

- [ ] Technical design reviewed
- [ ] Security implications assessed
- [ ] User experience validated
- [ ] Implementation plan approved
- [ ] Ready to proceed with Phase 1

---

**Next Steps**: Begin Phase 1 implementation (Config & UI)
