# System Patterns

## Sound Board - AI Interview Assistant

**Version:** 0.4.0
**Last Updated:** September 29, 2025

## Architecture Overview

The application follows a client-server architecture pattern within a desktop application context:

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                    │
│  ┌─────────────┐    IPC     ┌────────────────────────────┐ │
│  │ Audio/Gemini │◄──────────►│     Renderer Process       │ │
│  │   Service    │           │                            │ │
│  └─────────────┘           │  ┌────────────────────────┐  │ │
│                            │  │    SoundBoardApp      │  │ │
│                            │  │   (Main Application)   │  │ │
│                            │  └────────────────────────┘  │ │
│                            │              │                │ │
│                            │              ▼                │ │
│                            │  ┌────────────────────────┐  │ │
│                            │  │      View Components   │  │ │
│                            │  │  (MainView, AdvancedView,  │ │
│                            │  │   AssistantView, etc.) │  │ │
│                            │  └────────────────────────┘  │ │
│                            │              │                │ │
│                            │              ▼                │ │
│                            │  ┌────────────────────────┐  │ │
│                            │  │      LLM Services      │  │ │
│                            │  │  (Gemini, AzureRealtime)│ │ │
│                            │  └────────────────────────┘  │ │
└─────────────────────────────────────────────────────────────┘
```

## Core Design Patterns

### 1. Service Abstraction Pattern
The application uses an abstract service pattern for LLM integration:

```javascript
// Base class for all LLM services
class LLMService {
    constructor(apiKey, customPrompt, profile, language) { /* ... */ }
    async init() { /* ... */ }
    async sendText(text) { /* ... */ }
    async sendAudio() { /* ... */ }
    async sendImage() { /* ... */ }
    async close() { /* ... */ }
}

// Concrete implementations
class AzureRealtimeWebSocketService extends LLMService { /* ... */ }
class GoogleGeminiService { /* ... */ } // (existing implementation)
```

### 2. IPC Communication Pattern
Inter-Process Communication follows a request-response pattern:

```javascript
// Renderer → Main Process
const success = await ipcRenderer.invoke('initialize-azure-realtime', 
    apiKey, endpoint, deployment, customPrompt, profile, language);

// Main Process → Renderer
ipcMain.handle('initialize-azure-realtime', async (event, ...params) => {
    // Handle initialization
    return success; // boolean response
});
```

### 3. Component-Based UI Architecture
UI follows LitElement component architecture with state management:

```javascript
class AdvancedView extends LitElement {
    static properties = {
        llmService: { type: String },
        azureApiKey: { type: String },
        // ... other properties
    };
    
    handleInputChange(e) {
        // Update state and localStorage
    }
}
```

### 4. Event-Driven Response Handling
Real-time responses are handled through event listeners:

```javascript
// Listen for AI responses
ipcRenderer.on('update-response', (_, response) => {
    cheddar.setResponse(response);
});

// Listen for status updates
ipcRenderer.on('update-status', (_, status) => {
    cheddar.setStatus(status);
});
```

## Key Technical Decisions

### LLM Service Architecture
- **Abstract Base Class**: `LLMService` provides common interface
- **Concrete Implementations**: Each LLM provider has its own service class
- **Factory Pattern**: Services are instantiated based on user selection
- **Consistent API**: All services implement the same methods

### Audio Processing Pipeline
```
System Audio Capture → PCM Conversion → Base64 Encoding → LLM Service
         ▲                    ▲              ▲            ▲
         │                    │              │            │
   Platform-specific     Float32 to     Chunk-based    Real-time
   audio APIs           Int16 conversion  processing    streaming
```

### Screen Capture Flow
```
getDisplayMedia() → Hidden Video Element → Canvas Drawing → JPEG Compression → Base64 → LLM
        ▲                    ▲                    ▲              ▲              ▲      ▲
        │                    │                    │              │              │      │
  User permission      Frame rate          Quality control   Size optimization  Data   AI
  required            control (1fps)      based on user     based on tokens    format processing
```

### Storage Strategy
- **localStorage**: User preferences, API keys, settings
- **IndexedDB**: Conversation history and session data
- **In-Memory**: Current session state and temporary data

## Integration Patterns

### Azure Realtime Integration Pattern
The legacy REST client has been replaced with a WebSocket implementation:

1. **Connection Setup**:
```javascript
this.websocketUrl = `wss://${websocketHost}/openai/realtime?api-version=2025-04-01-preview`;
this.socket = new WebSocket(this.websocketUrl, 'realtime', {
    headers: { 'api-key': this.apiKey }
});
```

2. **Session Configuration**: Send a `session.update` payload specifying deployment, audio formats, and system instructions once the socket opens.
3. **Streaming Responses**: Listen for `response.text.delta`, `response.audio.delta`, and transcription events to push updates into the UI.
4. **Error Handling**: Retry on transient socket failures and surface detailed status updates via renderer IPC.

### Provider Switching Pattern
```javascript
// Service selection based on user choice
if (llmService === 'gemini') {
    await cheddar.initializeGemini(profile, language);
} else if (llmService === 'azure') {
    await cheddar.initializeAzureRealtime(profile, language, endpoint, deployment);
}
```

## Data Flow Patterns

### Initialization Flow
```
User selects Azure → Save credentials → Start session → Initialize service → Begin capture
       │              │                   │              │              │
       ▼              ▼                   ▼              ▼              ▼
    AdvancedView   localStorage      SoundBoardApp     Renderer.js    Main Process
  handleInputChange                 handleStart        initializeAzureRealtime
```

### Real-time Processing Flow
```
Audio/Screenshots → Main Process → LLM Service → AI Response → Renderer → UI Update
        │              │              │              │            │          │
        ▼              ▼              ▼              ▼            ▼          ▼
   System capture   IPC invoke    Azure API call   IPC send     setResponse  AssistantView
                    handlers                      response     update
```

## Error Handling Patterns

### Credential Validation
```javascript
// Validate required fields before initialization
if (!apiKey || !endpoint) {
    this.triggerAzureCredentialError();
    return;
}
```

### Service Initialization Errors
```javascript
try {
    const success = await service.init();
    if (success) {
        global.azureServiceRef = service;
        return true;
    }
} catch (error) {
    console.error('Failed to initialize service:', error);
    return false;
}
```

### Status Updates
```javascript
// Consistent status reporting across all services
cheddar.setStatus('Live');      // Success
cheddar.setStatus('error');     // Failure
cheddar.setStatus('Listening...'); // Ongoing
```

## Security Patterns

### Credential Storage
- **localStorage**: API keys stored locally (user responsibility)
- **Memory-only**: Keys only in memory during active sessions
- **No server storage**: No external storage of credentials

### Content Protection
- **Window hiding**: Optional stealth mode for screen sharing
- **Process naming**: Stealth features for audio capture processes

## Performance Patterns

### Rate Limiting
```javascript
// Token tracking for rate limiting
tokenTracker = {
    tokens: [], // Track token usage over time
    addTokens(count, type),
    shouldThrottle(),
    getTokensInLastMinute()
};
```

### Memory Management
- **Buffer recycling**: Audio buffers reused to prevent memory leaks
- **Stream cleanup**: Proper disposal of MediaStream tracks
- **Event listener cleanup**: Remove listeners when components are destroyed

## Testing Patterns

### Unit Testing Structure
```javascript
// Test file organization
src/__tests__/
├── audioUtils.test.js      // Unit tests for audio utilities
├── geminiConversation.test.js  // Conversation logic tests
├── speakerFormat.test.js   // Speaker formatting tests
├── audioUtils.e2e.test.js  // End-to-end audio tests
└── syntaxHighlight.e2e.test.js // UI component tests
```

### Integration Testing
- **IPC Communication**: Test handler registration and parameter passing
- **Service Initialization**: Test service creation and configuration
- **UI Integration**: Test component state management and rendering

## Future Extensibility Patterns

### Adding New LLM Providers
1. Create new service class extending `LLMService`
2. Add IPC handler in main process
3. Update UI components with new provider option
4. Add initialization logic in main app
5. Update renderer functions

### Adding New Features
1. Follow existing component patterns
2. Use consistent IPC communication
3. Maintain localStorage integration
4. Follow error handling conventions
5. Update relevant documentation

## Code Organization Patterns

### File Structure
```
src/
├── components/          # UI Components
│   ├── app/            # Main application components
│   └── views/          # View-specific components
├── utils/              # Utility functions and services
│   ├── llm.js          # Base LLM service class
│   ├── azureRealtimeWebSocket.js  # Azure realtime WebSocket service
│   ├── gemini.js       # Gemini service and IPC handlers
│   └── renderer.js     # Renderer process utilities
└── assets/             # Static assets
```

### Naming Conventions
- **PascalCase**: Component and class names
- **camelCase**: Function and variable names
- **kebab-case**: File names
- **UPPER_CASE**: Constants

### Export Patterns
```javascript
// Consistent module exports
module.exports = { 
    functionName,
    ClassName,
    constantValue 
};
