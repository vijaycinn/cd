---
goal: 'Enable Azure Voice Live VAD (Voice Activity Detection) for Azure OpenAI Realtime API without affecting Google Gemini functionality'
version: '1.0'
date_created: '2025-12-04'
last_updated: '2025-12-04'
owner: 'AI Development Team'
status: 'Planned'
tags: ['feature', 'azure', 'vad', 'voice-activity-detection', 'realtime-api']
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This implementation plan addresses the integration of Azure Voice Live VAD (Voice Activity Detection) within the Azure OpenAI Realtime API service. Currently, the application does not properly utilize Azure's server-side VAD capabilities, which are essential for natural conversation flow and optimal turn detection in real-time voice interactions.

**Problem Statement:**
- Azure OpenAI Realtime API provides built-in server-side VAD through `turn_detection: { type: "server_vad" }`
- Current implementation does not properly leverage Azure's `input_audio_buffer.speech_started` and `input_audio_buffer.speech_stopped` events
- Manual commit logic and buffering strategies interfere with Azure's native VAD behavior
- Audio commits are not properly synchronized with Azure's turn detection events

**Objectives:**
1. Enable Azure's server-side VAD for automatic turn detection
2. Properly handle `speech_started` and `speech_stopped` events from Azure
3. Simplify commit logic to align with Azure's recommended patterns (one commit per utterance)
4. Preserve existing Google Gemini functionality without any modifications
5. Maintain audio mode selection (`mic_only`, `speaker_only`, `both`) behavior
6. Implement client-side silence filtering to reduce unnecessary audio transmission

## 1. Requirements & Constraints

**Business Requirements:**
- **REQ-001**: Azure Voice Live integration must use server-side VAD for turn detection
- **REQ-002**: Google Gemini audio functionality must remain completely unchanged
- **REQ-003**: Audio mode selection (`mic_only`, `speaker_only`, `both`) must continue to work as expected
- **REQ-004**: UI components should display text deltas without requiring modifications
- **REQ-005**: Existing IPC handlers (`send-mic-audio-content`, `send-audio-content`) must be preserved

**Technical Requirements:**
- **REQ-006**: Implement proper handling of `input_audio_buffer.speech_started` events
- **REQ-007**: Implement proper handling of `input_audio_buffer.speech_stopped` events
- **REQ-008**: Commit audio buffer only once per Azure-detected utterance
- **REQ-009**: Use `response.create` only after Azure confirms speech has stopped
- **REQ-010**: Implement client-side RMS/energy-based silence filtering before buffering
- **REQ-011**: Add configurable grace period after `speech_stopped` before committing (50-100ms)
- **REQ-012**: Track `responseInProgress` flag to prevent overlapping responses

**Security Requirements:**
- **SEC-001**: Audio data must remain encrypted during WebSocket transmission
- **SEC-002**: API keys must not be exposed in debug logs

**Constraints:**
- **CON-001**: Changes must be isolated to Azure-specific code paths in `src/utils/azureRealtimeWebSocket.js`
- **CON-002**: No modifications allowed to `src/utils/gemini.js` or Gemini-related code
- **CON-003**: AudioRouter must continue to handle provider switching seamlessly
- **CON-004**: Must maintain backward compatibility with existing Azure configuration settings
- **CON-005**: Cannot introduce breaking changes to localStorage-based configuration

**Guidelines:**
- **GUD-001**: Follow Azure OpenAI Realtime API best practices for server VAD
- **GUD-002**: Log VAD lifecycle events clearly for debugging (speech_started → commit → response.create → response.done)
- **GUD-003**: Avoid sending empty audio commits (Azure rejects these)
- **GUD-004**: Implement one commit per utterance as recommended by Azure documentation
- **GUD-005**: Use configurable silence thresholds to allow tuning per environment

**Patterns to Follow:**
- **PAT-001**: Event-driven architecture for VAD event handling
- **PAT-002**: State machine pattern for response lifecycle management
- **PAT-003**: Guard clauses to prevent invalid state transitions
- **PAT-004**: Metrics/logging for observability of VAD behavior
- **PAT-005**: Feature flags for gradual rollout and testing

## 2. Implementation Steps

### Implementation Phase 1: Core VAD Event Handling

**GOAL-001**: Implement proper handling of Azure's server-side VAD events and synchronize audio commits with turn detection

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add handler for `input_audio_buffer.speech_started` event in `handleWebSocketMessage()` to reset buffering state and log turn start | | |
| TASK-002 | Add handler for `input_audio_buffer.speech_stopped` event to trigger immediate commit with configurable grace period (default 50-100ms) | | |
| TASK-003 | Implement `responseInProgress` flag to track active response state (set on `response.create`, clear on `response.done` or `response.error`) | | |
| TASK-004 | Add `audioAppendedSinceLastCommit` flag to track whether non-silent audio has been buffered | | |
| TASK-005 | Modify `commitAudioBufferAndCreateResponse()` to skip if `responseInProgress` is true or no audio has been appended | | |
| TASK-006 | Update `commitAudioBufferAndCreateResponse()` to send `response.create` with `modalities: ["text"]` immediately after commit (no audio output) | | |
| TASK-007 | Ensure `response.done` handler clears `responseInProgress` flag and resets commit tracking | | |
| TASK-008 | Add handler for `response.error` to clear `responseInProgress` and log error details | | |

### Implementation Phase 2: Commit Logic Simplification

**GOAL-002**: Remove manual transcript-based gating and align commit logic with Azure's one-commit-per-utterance recommendation

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | Remove `pendingResponse`, `lastTranscript`, and transcript-based gating logic from `azureRealtimeWebSocket.js` | | |
| TASK-010 | Simplify `sendAudio()` method to only append to buffer (`input_audio_buffer.append`) without triggering commits | | |
| TASK-011 | Update `commitAudioBufferAndCreateResponse()` to enforce single commit per turn (only callable from `speech_stopped` or timeout) | | |
| TASK-012 | Implement grace period timer that waits 50-100ms after `speech_stopped` before calling `commitAudioBufferAndCreateResponse()` | | |
| TASK-013 | Add validation to prevent multiple commits during same utterance (check `audioAppendedSinceLastCommit` flag) | | |
| TASK-014 | Clear audio accumulator and reset flags after successful commit | | |

### Implementation Phase 3: Error Handling and Edge Cases

**GOAL-003**: Implement robust error handling for Azure VAD edge cases and prevent invalid state transitions

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-015 | Add handler for `input_audio_buffer.commit_failed` error to log and clear buffer without triggering response | | |
| TASK-016 | Add handler for `input_audio_buffer_commit_empty` to pause commits until new non-silent audio arrives | | |
| TASK-017 | Implement guard for `conversation_already_has_active_response` error by queuing responses until `response.done` | | |
| TASK-018 | Add metrics tracking for commits, responses, errors (incrementing counters logged periodically) | | |
| TASK-019 | Ensure WebSocket `close` event clears `responseInProgress` and resets all VAD state | | |
| TASK-020 | Add timeout mechanism to force commit if `speech_stopped` never arrives (configurable, default 10s) | | |

### Implementation Phase 4: Client-Side Silence Filtering

**GOAL-004**: Implement lightweight RMS/energy-based silence detection to avoid sending idle audio to Azure

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-021 | Create `calculateRMS()` helper function to compute audio energy from PCM16 buffer | | |
| TASK-022 | Add silence gate configuration to `azureRealtimeSettings.js` (enabled, rmsThreshold, floor, autoAdjust, warmupDrops) | | |
| TASK-023 | Implement silence detection in `sendAudio()` before calling `input_audio_buffer.append` | | |
| TASK-024 | Add throttled logging when silence is skipped (max one log per 4 seconds to reduce spam) | | |
| TASK-025 | Increment `audioChunksSkipped` metric counter when silence is filtered | | |
| TASK-026 | Add developer toggle to disable silence gate for troubleshooting (via `silenceGateEnabled` config) | | |

### Implementation Phase 5: Configuration and Settings Integration

**GOAL-005**: Ensure VAD settings are configurable and properly integrated with existing Azure Realtime settings

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-027 | Verify `azureRealtimeSettings.js` includes `serverVad` section with threshold, prefixPaddingMs, silenceDurationMs, createResponse | | |
| TASK-028 | Ensure `getTurnDetectionConfig()` in `azureRealtimeWebSocket.js` correctly maps settings to session configuration | | |
| TASK-029 | Add grace period configuration (`commits.gracePeriodMs`) to settings with default 75ms | | |
| TASK-030 | Verify session configuration always includes `turn_detection: { type: "server_vad", ... }` with proper parameters | | |
| TASK-031 | Document all VAD-related settings in configuration file comments | | |

### Implementation Phase 6: AudioRouter Integration and Mode Handling

**GOAL-006**: Ensure AudioRouter properly enforces audio mode settings without disrupting VAD behavior

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-032 | Verify `AudioRouter.handleMicAudioContent()` correctly routes mic audio to Azure when in `mic_only` or `both` mode | | |
| TASK-033 | Verify `AudioRouter.handleAudioContent()` correctly routes system audio to Azure when in `speaker_only` or `both` mode | | |
| TASK-034 | Ensure `AudioRouter.startRouting()` properly takes over IPC handlers from Gemini without affecting Gemini state | | |
| TASK-035 | Ensure `AudioRouter.stopRouting()` restores Gemini handlers completely when switching providers | | |
| TASK-036 | Test that Gemini audio flow remains unchanged when Azure is not active | | |

### Implementation Phase 7: Testing and Validation

**GOAL-007**: Comprehensive testing to validate VAD behavior and ensure Gemini remains unaffected

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-037 | Manual test: `mic_only` mode - speak short phrase and verify Azure produces text deltas without audio loop | | |
| TASK-038 | Manual test: `speaker_only` mode - play sample audio and verify Azure produces text deltas | | |
| TASK-039 | Manual test: `both` mode - verify both mic and system audio feed Azure without runaway responses | | |
| TASK-040 | Manual test: Gemini audio flow - verify Gemini functionality is completely unchanged and working | | |
| TASK-041 | Validate log output shows proper lifecycle: `speech_started` → commit → `response.create` → deltas → `response.done` | | |
| TASK-042 | Verify only one commit per utterance appears in logs (no duplicate commits) | | |
| TASK-043 | Test silence filtering by monitoring `audioChunksSkipped` metric during idle periods | | |
| TASK-044 | Test error handling: trigger `commit_failed` and verify graceful recovery | | |
| TASK-045 | Test provider switching: switch between Azure and Gemini multiple times and verify both work correctly | | |
| TASK-046 | Performance test: Measure latency from speech_stopped to first text delta (should be <500ms) | | |

### Implementation Phase 8: Documentation and Knowledge Transfer

**GOAL-008**: Document the VAD implementation and provide troubleshooting guidance

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-047 | Update `memory-bank/azure-configuration-guide.md` with VAD configuration details and event flow diagrams | | |
| TASK-048 | Document troubleshooting scenarios: no response produced, feedback loops, empty commits, overlapping responses | | |
| TASK-049 | Add inline code comments explaining VAD state machine transitions in `azureRealtimeWebSocket.js` | | |
| TASK-050 | Create example configuration file showing recommended VAD settings for different use cases | | |
| TASK-051 | Document metrics and their meanings (audioChunksQueued, audioChunksSkipped, audioCommits, etc.) | | |

## 3. Alternatives

**Alternative Approaches Considered:**

- **ALT-001**: **Client-side VAD using WebRTC VAD or Silero VAD**
  - *Reason not chosen*: Azure provides robust server-side VAD optimized for their models. Client-side VAD adds complexity, latency, and may conflict with server-side detection. Azure's VAD is already integrated with their turn detection system.

- **ALT-002**: **Continue with manual transcript-based commit logic**
  - *Reason not chosen*: Current approach is unreliable, causes duplicate responses, and doesn't align with Azure's recommended patterns. Server VAD events provide more accurate turn boundaries.

- **ALT-003**: **Use polling for transcript completeness instead of event-driven approach**
  - *Reason not chosen*: Polling introduces unnecessary latency and complexity. Event-driven approach using `speech_stopped` is more responsive and aligns with Azure's API design.

- **ALT-004**: **Modify Gemini code to share VAD infrastructure**
  - *Reason not chosen*: Gemini has its own audio handling mechanisms. Shared infrastructure would increase coupling and risk breaking working Gemini functionality. Isolation is safer.

- **ALT-005**: **Implement custom silence detection only without Azure VAD**
  - *Reason not chosen*: Client-side silence detection is useful for reducing bandwidth but cannot replace server-side VAD for turn detection. Both are needed: client-side for optimization, server-side for accuracy.

## 4. Dependencies

**External Dependencies:**

- **DEP-001**: `@modelcontextprotocol/sdk` (v1.11.0+) - Already installed, used for Microsoft Learn MCP integration
- **DEP-002**: `ws` (WebSocket library) - Already installed, used for Azure WebSocket connection
- **DEP-003**: Azure OpenAI Realtime API endpoint with Voice Live support
- **DEP-004**: Valid Azure OpenAI API key with realtime API access

**Internal Dependencies:**

- **DEP-005**: `src/config/azureRealtimeSettings.js` - Configuration loader for VAD settings
- **DEP-006**: `src/utils/audioRouter.js` - Audio routing logic between providers
- **DEP-007**: `src/utils/llm.js` - Base LLMService class
- **DEP-008**: Existing IPC handlers in main process (`send-mic-audio-content`, `send-audio-content`)
- **DEP-009**: localStorage-based configuration system for Azure settings

**Configuration Dependencies:**

- **DEP-010**: `azureRealtimeSettings.serverVad.threshold` (default: 0.5)
- **DEP-011**: `azureRealtimeSettings.serverVad.prefixPaddingMs` (default: 300)
- **DEP-012**: `azureRealtimeSettings.serverVad.silenceDurationMs` (default: 200)
- **DEP-013**: `azureRealtimeSettings.serverVad.createResponse` (default: true)
- **DEP-014**: `azureRealtimeSettings.silenceGate.enabled` (default: true)
- **DEP-015**: `azureRealtimeSettings.silenceGate.rmsThreshold` (default: 0.008)

## 5. Files

**Files to Modify:**

- **FILE-001**: `src/utils/azureRealtimeWebSocket.js`
  - *Changes*: Add VAD event handlers (`speech_started`, `speech_stopped`), implement `responseInProgress` flag, simplify commit logic, add silence filtering, implement grace period timer
  - *Lines affected*: ~100-150 lines (additions and modifications in `handleWebSocketMessage()`, `sendAudio()`, `commitAudioBufferAndCreateResponse()`)

- **FILE-002**: `src/config/azureRealtimeSettings.js`
  - *Changes*: Add `commits.gracePeriodMs` configuration, verify `serverVad` and `silenceGate` sections are complete
  - *Lines affected*: ~10-20 lines (configuration additions)

- **FILE-003**: `memory-bank/azure-configuration-guide.md`
  - *Changes*: Add VAD configuration documentation, event flow diagrams, troubleshooting guide
  - *Lines affected*: ~50-100 lines (documentation additions)

**Files to Create:**

- **FILE-004**: `src/__tests__/azureVAD.test.js`
  - *Purpose*: Unit tests for VAD event handling, commit logic, silence filtering
  - *Estimated size*: ~200-300 lines

**Files NOT to Modify:**

- **FILE-005**: `src/utils/gemini.js` - No changes allowed per REQ-002
- **FILE-006**: `src/utils/audioRouter.js` - Only verify behavior, no modifications unless critical bug found
- **FILE-007**: `src/components/**/*.js` - UI components should not require changes per REQ-004

## 6. Testing

**Unit Tests:**

- **TEST-001**: Test `handleWebSocketMessage()` correctly handles `input_audio_buffer.speech_started` event
  - *Expected*: Resets buffering state, clears `audioAppendedSinceLastCommit` flag, logs turn start
  
- **TEST-002**: Test `handleWebSocketMessage()` correctly handles `input_audio_buffer.speech_stopped` event
  - *Expected*: Starts grace period timer, calls `commitAudioBufferAndCreateResponse()` after delay

- **TEST-003**: Test `commitAudioBufferAndCreateResponse()` skips when `responseInProgress` is true
  - *Expected*: Function returns early, no commit or response.create sent

- **TEST-004**: Test `commitAudioBufferAndCreateResponse()` skips when `audioAppendedSinceLastCommit` is false
  - *Expected*: Function returns early, no commit or response.create sent, logs skip reason

- **TEST-005**: Test `calculateRMS()` correctly computes RMS value from PCM16 buffer
  - *Expected*: Returns accurate RMS value, handles empty buffers gracefully

- **TEST-006**: Test silence filtering drops frames below `rmsThreshold`
  - *Expected*: Silent frames not appended to buffer, `audioChunksSkipped` metric incremented

- **TEST-007**: Test silence filtering allows frames above `rmsThreshold`
  - *Expected*: Audio frames appended to buffer, `audioAppendedSinceLastCommit` set to true

- **TEST-008**: Test `response.done` handler clears `responseInProgress` flag
  - *Expected*: Flag reset to false, subsequent commits allowed

- **TEST-009**: Test `response.error` handler clears `responseInProgress` flag and logs error
  - *Expected*: Flag reset to false, error details logged

- **TEST-010**: Test metrics tracking increments counters correctly
  - *Expected*: `audioCommits`, `audioChunksQueued`, `audioChunksSkipped` increment on respective events

**Integration Tests:**

- **TEST-011**: End-to-end test with real Azure endpoint: speak → detect speech → commit → response
  - *Expected*: Full VAD lifecycle completes successfully, text deltas received

- **TEST-012**: Test provider switching: Azure → Gemini → Azure
  - *Expected*: Both providers work correctly after switching, no state leakage

- **TEST-013**: Test audio mode enforcement: verify `mic_only` prevents system audio from reaching Azure
  - *Expected*: System audio blocked, only mic audio processed by Azure

- **TEST-014**: Test audio mode enforcement: verify `speaker_only` prevents mic audio from reaching Azure
  - *Expected*: Mic audio blocked, only system audio processed by Azure

- **TEST-015**: Test graceful degradation: Azure unavailable, fallback to Gemini works
  - *Expected*: Gemini handles audio without errors, Azure errors logged

**Manual/Exploratory Tests:**

- **TEST-016**: Verify Gemini functionality completely unchanged (audio, text, tool calls)
- **TEST-017**: Test with various silence threshold values to find optimal setting
- **TEST-018**: Test with background noise to verify silence filtering effectiveness
- **TEST-019**: Test latency from speech end to response start (should be <500ms)
- **TEST-020**: Test long utterances (>10 seconds) to verify timeout mechanism

## 7. Risks & Assumptions

**Risks:**

- **RISK-001**: *Azure VAD may trigger false positives/negatives in noisy environments*
  - *Mitigation*: Implement configurable thresholds and client-side silence filtering as first layer
  - *Fallback*: Provide manual commit trigger for edge cases

- **RISK-002**: *Grace period may be too short or too long for natural conversation flow*
  - *Mitigation*: Make grace period configurable (default 75ms, range 50-200ms)
  - *Monitoring*: Log grace period expiration timing for analysis

- **RISK-003**: *Overlapping responses if `responseInProgress` flag implementation has bugs*
  - *Mitigation*: Comprehensive state machine testing, defensive guards in commit logic
  - *Monitoring*: Track `conversation_already_has_active_response` errors

- **RISK-004**: *Silence filtering may be too aggressive and cut off speech beginnings/endings*
  - *Mitigation*: Use conservative thresholds, implement warmup period, add prefix padding
  - *Tuning*: Provide developer toggle to disable for testing

- **RISK-005**: *Provider switching may leave Azure in invalid state*
  - *Mitigation*: Implement comprehensive cleanup in `stopRouting()`, reset all flags on disconnect
  - *Testing*: Extensive provider switching tests

- **RISK-006**: *Performance impact of RMS calculation on every audio frame*
  - *Mitigation*: Use efficient RMS calculation, consider sampling rate reduction if needed
  - *Monitoring*: Profile audio processing pipeline

**Assumptions:**

- **ASSUMPTION-001**: Azure's server-side VAD is accurate enough for production use
  - *Validation*: Manual testing with diverse audio samples and accents

- **ASSUMPTION-002**: 50-100ms grace period is sufficient for all use cases
  - *Validation*: Latency measurements during testing phase

- **ASSUMPTION-003**: Client-side silence filtering won't introduce significant latency
  - *Validation*: Performance profiling of audio processing

- **ASSUMPTION-004**: Existing localStorage configuration system can handle new VAD settings
  - *Validation*: Test configuration loading and persistence

- **ASSUMPTION-005**: UI components don't need modifications to display VAD-driven responses
  - *Validation*: Integration testing with existing UI

- **ASSUMPTION-006**: Gemini code isolation ensures no side effects from Azure changes
  - *Validation*: Comprehensive Gemini regression testing

- **ASSUMPTION-007**: Azure API will not change VAD event structure during implementation
  - *Risk*: Monitor Azure API changelog for updates

## 8. Related Specifications / Further Reading

**Internal Documentation:**
- [memory-bank/azure-realtime-vad-plan.md](../memory-bank/azure-realtime-vad-plan.md) - Original VAD migration plan with detailed context
- [memory-bank/azure-configuration-guide.md](../memory-bank/azure-configuration-guide.md) - Azure configuration documentation
- [AGENTS.md](../AGENTS.md) - Repository guidelines and coding standards
- [memory-bank/project-overview.md](../memory-bank/project-overview.md) - Project architecture overview

**Azure Documentation:**
- [Azure OpenAI Realtime API - Turn Detection](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/realtime-audio#turn-detection)
- [Azure OpenAI Realtime API - Server VAD](https://learn.microsoft.com/en-us/azure/ai-services/openai/realtime-audio-reference#server-vad)
- [Azure Voice Live API Overview](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live)
- [Azure OpenAI Best Practices](https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/use-your-data)

**Technical References:**
- [WebRTC VAD Algorithm](https://webrtc.googlesource.com/src/+/refs/heads/main/common_audio/vad/)
- [RMS Audio Level Calculation](https://en.wikipedia.org/wiki/Root_mean_square#In_waveform_combinations)
- [PCM16 Audio Format Specification](https://wiki.multimedia.cx/index.php/PCM)

**Related PRs/Issues:**
- PR#84 - Original Azure OpenAI integration (architectural patterns to follow)
- Issue: "Azure Realtime not producing responses" (motivating issue for this work)
