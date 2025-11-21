# Product Requirements Document: Azure OpenAI WebSocket Realtime Integration Feature
# ***UPDATED: Switching from WebRTC to WebSocket per user request***

## Introduction/Overview
**Feature Name:** Azure OpenAI WebSocket Realtime Integration
**Description:** Implement WebSocket-based realtime audio conversation with Azure OpenAI GPT-4o-realtime, providing reliable low-latency audio streaming that follows Azure's recommended WebSocket architecture for Electron applications.

## Goals
- Provide Azure OpenAI with reliable WebSocket-based realtime audio streaming (recommended for low-latency client-side applications)
- Achieve consistent audio processing with same low-latency performance as Gemini Live
- Implement proper authentication with query parameter API keys (simpler than ephemeral tokens)
- Maintain streaming audio input/output with real-time transcription and responses
- Ensure seamless audio processing pipeline from browser microphone to Azure WebSocket service

## User Stories
- As a user, I want Azure OpenAI to use WebSocket for reliable realtime audio streaming that works consistently in Electron
- As a user, I want secure API key authentication via query parameters instead of complex ephemeral key generation
- As a user, I want continuous audio streaming with same VAD and turn-taking as Gemini Live
- As a user, I want the same seamless parallel audio experience as Gemini but with Azure OpenAI models

## Functional Requirements
1. **WebSocket Connection Establishment**: Direct WebSocket connection to Azure realtime endpoint
2. **Query Parameter Authentication**: Simple API key authentication via wss:// URL parameters
3. **Event-Based Communication**: Bidirectional JSON event streaming over WebSocket
4. **Audio Buffer Management**: input_audio_buffer.append and commit events for streaming audio
5. **Real-Time Events**: Handle all Azure realtime API events (session updates, audio deltas, transcription)
6. **Voice Activity Detection**: Server-side VAD with speech_started/speech_stopped detection
7. **Audio Streaming**: Continuous PCM audio streaming at optimal sample rates
8. **Error Handling**: WebSocket connection state and event error handling
9. **Session Lifecycle**: Proper WebSocket connection setup/cleanup and session management

## Non-Goals (Out of Scope)
- Modifying existing REST API text-only Azure OpenAI implementation
- Changing Gemini Live WebSocket implementation or behavior
- Implementing multiple audio codecs beyond PCM16
- Adding new UI components beyond existing conversation flow

## Technical Considerations
- **WebSocket API**: Use browser WebSocket APIs directly in Electron renderer process
- **Authentication**: API key via URL query parameter (wss://...?api-key=KEY)
- **Event Processing**: Same JSON event schema as WebRTC but transported over WebSocket
- **Audio Processing**: PCM 24kHz mono audio format optimized for bidirectional streaming
- **IPC Communication**: IPC coordination between main process and renderer WebSocket state
- **Connection Resilience**: WebSocket reconnection handling and connection state monitoring
- **Browser Compatibility**: Ensure Electron/Chromium version supports all required WebSocket features
- **Event Protocol**: Implement Azure realtime API event schema over WebSocket connections

## Success Metrics
- Azure OpenAI WebSocket connection establishes reliably with query parameter authentication
- Continuous low-latency audio streaming with <500ms response times
- Seamless voice conversations with automatic VAD-based turn-taking
- Same or better reliability than Gemini Live WebSocket implementation
- Failed connection automatic fallback to text-only REST API mode
- All existing text functionality remains intact during WebSocket mode
