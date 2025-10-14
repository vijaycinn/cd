# Technical Context

## Sound Board - AI Interview Assistant

**Version:** 0.4.0
**Last Updated:** September 29, 2025

## Core Technologies

### Primary Framework
- **Electron**: Desktop application framework (v30.0.5)
- **Node.js**: JavaScript runtime environment
- **HTML/CSS/JavaScript**: Core web technologies

### UI Framework
- **LitElement**: Web Components-based UI library (v2.7.4)
- **Custom CSS**: Tailored styling for desktop application

### AI Services
- **Google Gemini API**: @google/genai package (v1.2.0)
- **OpenAI API**: openai package (v5.9.2) - used for Azure OpenAI integration
- **Azure OpenAI**: Microsoft's managed OpenAI service (uses openai package with custom configuration)

### Audio Processing
- **Web Audio API**: Browser-based audio processing
- **PCM Audio**: Raw audio format for LLM processing
- **Base64 Encoding**: Audio data transmission format

### Storage
- **localStorage**: Client-side persistent storage for settings
- **IndexedDB**: Client-side database for conversation history
- **Session Storage**: Temporary data storage

### Development Tools
- **Electron Forge**: Build and packaging tool
- **Vitest**: Testing framework
- **JSDOM**: DOM testing environment

## Development Environment

### Node.js Version
- **Target**: Node.js 18+ (Electron 30 compatibility)
- **Package Manager**: npm

### Build System
- **Electron Forge**: Configuration in `forge.config.js`
- **Makers**: 
  - Windows: Squirrel (.exe)
  - macOS: DMG (.dmg)
  - Linux: AppImage, DEB, RPM

### Testing Environment
- **Unit Testing**: Vitest with JSDOM
- **Test Files**: `src/__tests__/`
- **Mock Data**: `src/__mocks__/`

## Code Standards and Conventions

### JavaScript Style
- **ES6+ Features**: Modern JavaScript syntax
- **Modules**: ES Modules (import/export)
- **Async/Await**: Promise handling
- **Arrow Functions**: Functional programming patterns

### Component Architecture
- **LitElement**: Reactive web components
- **Properties**: Reactive state management
- **Lifecycle**: connectedCallback, disconnectedCallback
- **Rendering**: Template literals with CSS-in-JS

### File Naming
- **PascalCase**: Component files (`SoundBoardApp.js`)
- **camelCase**: Utility files (`audioUtils.js`)
- **kebab-case**: Configuration files (`forge.config.js`)

### Code Organization
```
src/
├── assets/              # Static resources
├── components/          # UI components
│   ├── app/            # Main application components
│   └── views/          # View-specific components
├── utils/              # Utility functions
├── __mocks__/          # Test mocks
└── __tests__/          # Test files
```

## API Integration Patterns

### LLM Service Interface
```javascript
class LLMService {
    constructor(apiKey, customPrompt, profile, language) { }
    async init() { }           // Initialize service
    async sendText(text) { }   // Send text message
    async sendAudio() { }      // Send audio data
    async sendImage() { }      // Send image data
    async close() { }          // Cleanup resources
}
```

### IPC Communication
```javascript
// Main Process (src/utils/gemini.js)
ipcMain.handle('initialize-azure-realtime', async (event, ...params) => {
    // Handle initialization
    return boolean; // Success/failure
});

// Renderer Process (src/utils/renderer.js)
const success = await ipcRenderer.invoke('initialize-azure-realtime', ...params);
```

### Error Handling
- **Try/Catch**: Wrapped service calls
- **Boolean Returns**: IPC handlers return success/failure
- **Console Logging**: Detailed error information
- **User Feedback**: Status updates in UI

## Testing Strategy

### Test Framework
- **Vitest**: Fast unit testing
- **JSDOM**: Browser environment simulation
- **File Pattern**: `*.test.js` and `*.e2e.test.js`

### Test Categories
1. **Unit Tests**: Individual function testing
2. **Integration Tests**: Component interaction
3. **End-to-End Tests**: Full workflow testing

### Test Commands
```bash
npm test              # Run all tests
npm run test:unit     # Run unit tests only
npm run test:e2e      # Run end-to-end tests
```

### Test File Structure
```
src/__tests__/
├── audioUtils.test.js          # Unit tests for audio utilities
├── geminiConversation.test.js  # Conversation logic tests
├── speakerFormat.test.js       # Speaker formatting tests
├── audioUtils.e2e.test.js      # End-to-end audio tests
└── syntaxHighlight.e2e.test.js # UI component tests
```

## Deployment and Packaging

### Build Commands
```bash
npm run make              # Build for current platform
npm run package           # Package without making installers
npm run start             # Development mode
```

### Platform Support
- **Windows**: .exe installer via Squirrel
- **macOS**: .dmg disk image
- **Linux**: AppImage, DEB, RPM packages

### Code Signing
- **Windows**: Squirrel auto-updates
- **macOS**: Code signing for Gatekeeper
- **Linux**: No code signing required

## Performance Considerations

### Memory Management
- **Stream Cleanup**: Proper disposal of MediaStream tracks
- **Event Listeners**: Remove when components are destroyed
- **Buffer Recycling**: Reuse audio buffers to prevent leaks

### Rate Limiting
- **Token Tracking**: Monitor API usage over time
- **Throttling**: Configurable rate limiting settings
- **User Control**: Adjustable limits in Advanced settings

### Audio Processing
- **Sample Rate**: 24000 Hz for LLM compatibility
- **Buffer Size**: 4096 samples for smooth processing
- **Chunk Duration**: 0.1 seconds for real-time processing

## Security Considerations

### Credential Handling
- **localStorage**: API keys stored locally
- **Memory-only**: Keys only in memory during sessions
- **No Server Storage**: No external credential storage

### Content Protection
- **Window Hiding**: Optional stealth mode
- **Process Naming**: Stealth features for audio capture
- **User Control**: Toggle privacy features

### Data Privacy
- **Local Processing**: Minimal data sent externally
- **User Control**: Users control their API usage
- **No Analytics**: No telemetry or tracking

## Debugging and Development

### Development Mode
```bash
npm start                 # Run in development mode
npm run dev               # Alternative development command
```

### Debugging Tools
- **Chrome DevTools**: Access via Electron menu
- **Console Logging**: Detailed logging throughout
- **Error Boundaries**: Component-level error handling

### Common Debugging Scenarios
1. **IPC Communication Issues**: Check parameter order and types
2. **Audio Capture Problems**: Verify permissions and device access
3. **LLM Service Errors**: Validate API keys and endpoints
4. **UI State Issues**: Check localStorage persistence

## Integration Guidelines

### Adding New LLM Providers
1. **Extend LLMService**: Create new service class
2. **Add IPC Handler**: Register in main process
3. **Update UI**: Add provider option in AdvancedView
4. **Update Main App**: Add initialization logic
5. **Update Renderer**: Add renderer function

### Adding New Features
1. **Component Pattern**: Follow existing UI patterns
2. **IPC Communication**: Use consistent messaging
3. **Storage Integration**: Use localStorage appropriately
4. **Error Handling**: Follow established conventions
5. **Testing**: Add unit and integration tests

## Common Issues and Solutions

### Audio Capture Issues
- **Permissions**: Ensure microphone/screen recording permissions
- **Platform Differences**: Handle Windows/macOS/Linux variations
- **Buffer Underruns**: Adjust buffer sizes and processing timing

### LLM Service Issues
- **API Key Validation**: Check credential format and permissions
- **Endpoint Configuration**: Verify Azure OpenAI endpoint format
- **Rate Limiting**: Monitor token usage and adjust settings

### UI/UX Issues
- **State Management**: Ensure localStorage synchronization
- **Component Updates**: Use requestUpdate() for reactive changes
- **Error Display**: Implement clear error messaging

### Performance Issues
- **Memory Leaks**: Check stream and event listener cleanup
- **Audio Processing**: Optimize buffer sizes and chunk processing
- **Screen Capture**: Adjust quality settings for performance

## Future Technology Considerations

### Potential Additions
- **WebRTC**: For peer-to-peer communication
- **WebAssembly**: For performance-critical audio processing
- **Service Workers**: For background processing
- **WebGPU**: For accelerated image processing

### API Evolution
- **New LLM Providers**: OpenAI, Anthropic, Mistral
- **Enhanced Audio**: Real-time transcription services
- **Computer Vision**: Advanced image analysis
- **Voice Synthesis**: Text-to-speech capabilities

### Platform Expansion
- **Mobile**: React Native or Flutter version
- **Web**: Browser-based version
- **Cloud**: Server-based processing option
