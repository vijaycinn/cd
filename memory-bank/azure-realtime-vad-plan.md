# Azure Realtime VAD Migration Plan

## Goal
Adopt Azure OpenAI realtime service for microphone-driven conversations while relying on the provider’s server-side VAD. Align behaviour with Gemini Live: single mic stream in, streaming text out, no audio feedback loops.

## Constraints
- Preserve existing renderer entry points (`send-mic-audio-content`, `send-audio-content`).
- Honour Audio Mode selection (`speaker_only`, `mic_only`, `both`).
- Keep Gemini flow untouched and fallback-ready.
- Minimise disruption to UI components (should only display text deltas already supplied).

## Implementation Steps

1. **Audit Current Azure Flow**
   - [ ] Document existing state transitions inside `src/utils/azureRealtimeWebSocket.js` (buffering, commit, response creation).
   - [ ] Identify locations where we override or ignore Azure’s `speech_started` / `speech_stopped` cadence and mark for removal.
   - [ ] Reconcile our flow with Microsoft’s realtime guidance (context7 §“Turn detection and server VAD”) to ensure parity.

2. **Lean on Server VAD Events**
   - [x] Register handlers for `input_audio_buffer.speech_started` and `input_audio_buffer.speech_stopped` to control local buffering windows.
   - [x] On `speech_started`, reset any partial buffer and log the turn start.
   - [x] On `speech_stopped`, trigger `commitAudioBufferAndCreateResponse()` immediately, regardless of buffer size (Azure already guarantees ≥100 ms).
   - [x] Verify session configuration always sets `turn_detection: { type: "server_vad" }` (matches context7 guidance) and document the rationale.
   - [x] Confirm we send a `conversation.item.create` with role `user` (per Azure docs) to anchor each mic turn before requesting a response.

3. **Simplify Commit Logic**
   - [x] Remove `pendingResponse`, `lastTranscript`, and transcript-based gating introduced during manual fixes.
   - [x] Update `commitAudioBufferAndCreateResponse()` to:
        - Skip if `responseInProgress` or the buffer is empty.
        - Commit once (`input_audio_buffer.append` + `commit`).
        - Immediately send `{ type: "response.create", response: { modalities: ["text"] } }` if no response is active.
        - Set `responseInProgress = true` until `response.done` arrives.
   - [x] Ensure `response.done`, `response.error`, and socket close events reset `responseInProgress`.
   - [x] Enforce “one commit per Azure speech turn”: only call `commitAudioBufferAndCreateResponse()` from `speech_stopped` (or a forced timeout) when audio has been appended since the last commit.
   - [x] Introduce a short grace period after `speech_stopped` before committing to allow end-of-utterance tail frames (configurable, default 50–100 ms).

4. **Error & Silence Handling** *(context7: Azure realtime docs call out single commit per utterance)*
   - [x] Handle Azure errors such as `input_audio_buffer.commit_failed` by logging and clearing the buffer without triggering `response.create`.
   - [x] Add lightweight metrics/log counters for commits vs. responses to aid debugging.
   - [x] Track whether any non-silent audio has been appended since the previous commit and skip both `input_audio_buffer.commit` and `response.create` when no frames were added (per doc warning about empty commits).
   - [x] When Azure emits `input_audio_buffer_commit_empty`, pause further commits until fresh non-silent audio arrives and reset the pending-audio flag.
   - [x] Guard against `conversation_already_has_active_response` by queuing further responses until `response.done` or `response.error` clears the flag.

5. **Audio Mode Enforcement**
   - [x] Keep current `AudioRouter` skip logic to prevent Azure hearing itself unless user chooses `speaker_only` / `both`.
   - [ ] Verify mic-only streams call `send-mic-audio-content` exclusively, i.e., no loopback feed.

6. **Silence Filtering** *(New — aligns with context7 guidance to avoid sending idle audio)*
   - [x] Add a lightweight RMS/energy gate before buffering mic PCM so near-zero frames are discarded client-side.
   - [x] Log when silence is skipped to aid tuning.
   - [x] Expose a developer toggle to disable the gate for troubleshooting (optional but recommended).
   - [ ] Evaluate whether we need to mirror Gemini’s noise-suppression options (e.g., reuse browser `noiseSuppression` and `autoGainControl` defaults) to reduce residual whisper noise.

7. **Testing Plan**
   - [ ] Manual test matrix:
        1. `mic_only`: speak short phrase → expect Azure text deltas, no loop.
        2. `speaker_only`: play sample audio → expect Azure text deltas.
        3. `both`: confirm both sources feed Azure without runaway responses.
   - [ ] Validate logging shows lifecycle: `speech_started` → commit → `response.create` → deltas → `response.done`.
   - [ ] Confirm UI updates via existing `update-response` channel.
   - [ ] Capture a trace showing only one commit per Azure utterance (as recommended in context7 examples).
   - [ ] Compare latency/UX with Gemini by recording both pipelines handling the same scripted utterance.

8. **Documentation Update**
   - [ ] Capture the new flow in `memory-bank/azure-configuration-guide.md` (how VAD is handled, expected events, references to context7).
   - [ ] Note troubleshooting tips (e.g., what to check if no response is produced, how to detect feedback loops, symptoms of empty commits).

## Acceptance Criteria
- Azure realtime produces streamed text responses for mic-only conversations without manual transcript polling.
- No repeated self-triggered responses when Audio Mode excludes system audio.
- Logs clearly outline VAD lifecycle events and commit points.
- Gemini behaviour remains unchanged and continues to serve as fallback.
