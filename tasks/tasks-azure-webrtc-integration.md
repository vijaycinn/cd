# Task List for: Azure OpenAI WebSocket Realtime Integration
# ***UPDATED: Switching from WebRTC to WebSocket per user request***

**PRD Reference:** `tasks/prd-azure-webrtc-integration.md` (needs update for WebSocket approach)

## Relevant Files & Test Strategy
*This section will be updated during implementation.*
- `src/utils/azureRealtimeWebSocket.js` - New WebSocket-based AzureRealtimeWebSocketService class
- `src/utils/renderer.js` - WebSocket implementation in browser context
- `src/utils/gemini.js` - Updated IPC handlers for WebSocket commands
- `src/components/app/SoundBoardApp.js` - Main app logic for WebSocket initialization
- `src/components/views/AdvancedView.js` - UI for Azure WebSocket provider selection

### WebSocket Implementation Implementation Notes
- **Authentication**: API key via query parameter (wss://...&api-key=KEY)
- **WebSocket URLs**: `wss://{resource}.openai.azure.com/openai/realtime?api-version=2025-04-01-preview&deployment={deployment}&api-key={api-key}`
- **Event-Based Communication**: JSON events over WebSocket (same schema as WebRTC but simpler)
- **Audio Processing**: PCM16 24kHz mono with input_audio_buffer.append/commit events
- **Voice Activity Detection**: Server-side VAD (server_vad) recommended
- **Direct Connection**: No complex SDP negotiation or peer-to-peer connection

### Notes on Testing
- Test ephemeral key generation creates valid short-lived authentication tokens
- Verify WebRTC peer connection establishes successfully with Azure servers
- Confirm SDP offer/answer exchange completes for media negotiation
- Test data channel opens and Azure realtime events flow properly
- Check audio track attachment for microphone input and playback output
- Ensure VAD (Voice Activity Detection) triggers conversation responses
- Verify graceful fallback when WebRTC connection fails
- Test Windows/macOS/Linux browser WebRTC compatibility in Electron
- Run existing test suite to confirm no regressions in text-only Azure mode

## Tasks

## 1.0 Core Infrastructure - WebRTC Service Architecture
- [x] 1.1 Create AzureRealtimeService class inheriting from LLMService (`src/utils/azureRealtime.js`)
- [x] 1.2 Implement IPC-based WebRTC initialization in main process
- [x] 1.3 Setup WebRTC configuration URL construction (sessions + webrtc endpoints)
- [x] 1.4 Create WebRTC event handling bridge between renderer and main processes
- [x] 1.5 Add WebRTC service cleanup and connection state management

## 2.0 Renderer WebRTC Implementation - Browser Layer
- [x] 2.1 Implement `initializeAzureWebRTC()` function in renderer.js
- [x] 2.2 Add ephemeral API key generation from sessions endpoint
- [x] 2.3 Create WebRTC RTCPeerConnection with proper configuration
- [x] 2.4 Implement data channel setup for realtime API events
- [x] 2.5 Add SDP offer generation and WebRTC URL communication
- [x] 2.6 Handle SDP answer reception and peer connection completion
- [x] 2.7 Initialize microphone audio tracks for continuous streaming
- [x] 2.8 Set up remote audio tracks for AI response playback
- [x] 2.9 Implement session.update command with VAD, voice, and audio formats
- [x] 2.10 Add comprehensive WebRTC connection state monitoring

## 3.0 IPC Communication Layer - Main/Renderer Bridge
- [x] 3.1 Create `initialize-azure-webrtc` IPC channel for service initialization
- [x] 3.2 Add `azure-webrtc-send-text` IPC channel for text message dispatch
- [x] 3.3 Implement `azure-webrtc-send-audio` IPC channel for audio streaming
- [x] 3.4 Create `azure-webrtc-event` IPC channel for realtime event forwarding
- [x] 3.5 Add `azure-webrtc-error` IPC channel for error propagation
- [x] 3.6 Implement `azure-webrtc-close` IPC channel for service shutdown
- [x] 3.7 Update WebRTC command routing in gemini.js IPC handlers

## 4.0 Realtime Events Processing - Event Handling
- [x] 4.1 Handle `session.created` and `session.updated` events for status updates
- [x] 4.2 Process `response.text.delta` events for streaming text responses
- [x] 4.3 Handle `response.audio.delta` events for audio chunk reception
- [x] 4.4 Implement voice activity detection events (`speech_started`/`speech_stopped`)
- [x] 4.5 Add transcription handling for `input_audio_transcription.completed`
- [x] 4.6 Route `response.done` events for completion signaling
- [x] 4.7 Implement comprehensive error event handling across all types
- [x] 4.8 Add connection state monitoring and error recovery

## 5.0 Integration and Testing - Finalized WebRTC Feature
- [ ] 5.1 Update UI provider selection to support WebRTC Azure mode
- [ ] 5.2 Integrate WebRTC initialization in main app startup flow
- [ ] 5.3 Add connection fallback to text-only mode on WebRTC failure
- [ ] 5.4 Implement audio permission handling and user prompts
- [ ] 5.5 Test complete WebRTC end-to-end conversation flow
- [ ] 5.6 Verify VAD-based turn-taking in voice conversations
- [ ] 5.7 Add WebRTC connection monitoring and connection loss handling
- [ ] 5.8 Update configuration documentation with WebRTC requirements
- [ ] 5.9 Perform cross-platform testing (Windows/macOS/Linux)
- [ ] 5.10 Finalize memory bank and documentation updates
