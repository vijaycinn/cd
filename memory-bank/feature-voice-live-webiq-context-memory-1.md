---
goal: "Implement low-latency Voice Live + WebIQ with continuous in-session context memory and deterministic talking-point surfacing"
version: "2.1"
date_created: "2026-07-22"
last_updated: "2026-07-22"
owner: "Sound Board Engineering"
status: "In Progress"
tags: ["feature", "architecture", "voice-live", "webiq", "memory", "realtime", "performance", "agent-mode"]
---

# Introduction

![Status: In Progress](https://img.shields.io/badge/status-In%20Progress-yellow)

This plan defines a single forward implementation path to deliver fast, high-fidelity meeting assistance using Azure Voice Live + WebIQ with semantic VAD, stable WebSocket lifecycle handling, and explicit linear session memory so each new response builds on prior conversation context instead of behaving like isolated turns.

**Authoritative sources** (all code MUST conform to these):
- [Voice Live quickstart](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-quickstart)
- [Voice Live How-To (session config, auth, turn detection)](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-how-to)
- [Voice Live 2026-04-10 API Reference](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-api-reference-2026-04-10)
- [Voice Live supported models and regions](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [Voice Live Agents quickstart (Foundry Agent Service)](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-agents-quickstart)
- [How to build a voice agent (conversation reconnect)](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-voice-agent-integration)
- [Interim response (latency bridging)](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-voice-live-interim-response)

## Protocol Facts (from MS Learn — DO NOT deviate)

| Property | Correct Value | Source |
|----------|--------------|--------|
| WebSocket URL (model mode) | `wss://<resource>.services.ai.azure.com/voice-live/realtime?api-version=2026-04-10&model=gpt-5.4` | How-To §WebSocket endpoint |
| WebSocket URL (agent mode) | `wss://<resource>.services.ai.azure.com/voice-live/realtime?api-version=2026-04-10&agent_name=X&project_name=Y` | Agent quickstart |
| Subprotocol | NONE (no 'realtime' subprotocol) | Confirmed by 1006 close fix |
| Auth header | `Authorization: Bearer <token>` (scope `https://cognitiveservices.azure.com/.default`) | How-To §Authentication |
| Init sequence | connect → server sends `session.created` → client sends `session.update` → server replies `session.updated` → start audio | SDK quickstart + How-To §Session configuration |
| `input_audio_format` | `"pcm16"` (string enum, NOT an object) | SDK RequestSession model |
| `output_audio_format` | `"pcm16"` (string enum) | SDK RequestSession model |
| `modalities` | `["text"]` for fastest text-only OR `["text", "audio"]` for voice | API Reference §Components |
| `max_response_output_tokens` | Integer 1-4096 or `"inf"`. Default 200 for talking points. | API Reference §Components |
| `temperature` | 0.6-1.2 range. Default 0.6 for fastest/most deterministic. | API Reference §Components |
| Audio append event | `{ type: "input_audio_buffer.append", audio: "<base64>" }` | API Reference §input_audio_buffer.append |
| Turn detection | `{ type: "azure_semantic_vad_multilingual", remove_filler_words: true }` | How-To §Turn Detection Parameters |
| Voice (non-realtime model) | `{ name: "en-US-Ava:DragonHDLatestNeural", type: "azure-standard", temperature: 0.8 }` | How-To §Azure HD voices |
| Transcription (non-realtime) | `{ model: "mai-transcribe" }` (NO version suffix) | How-To §MAI Transcribe |
| Noise suppression | `{ type: "azure_deep_noise_suppression" }` | How-To §Noise suppression |
| Echo cancellation | `{ type: "server_echo_cancellation" }` | How-To §Echo cancellation |
| gpt-5.4 on Voice Live | **Supported** — fully managed, no deploy needed | Voice Live overview §Supported models |
| Agent mode instructions | NOT SUPPORTED — agent uses its own prompt | How-To §Session configuration |
| Agent `conversation_id` | Reconnect to prior conversation; server manages full history | Agent how-to §Reconnect |
| Interim response | `interim_response` config with `latency`/`tool` triggers | Interim response how-to |

## 1. Requirements & Constraints

- **REQ-001**: Use WebSocket transport only for Azure voice paths; do not implement new WebRTC logic.
- **REQ-002**: Keep Gemini runtime behavior unchanged (`src/utils/gemini.js`, `src/utils/audioRouter.js` fallback behavior).
- **REQ-003**: Maintain and prioritize semantic VAD for meeting speech segmentation.
- **REQ-004**: Provide deterministic, continuous in-session memory (rolling turns + summary + key facts) for Azure voice sessions.
- **REQ-005**: Surface talking points in UI within target latency while preserving response quality.
- **REQ-006**: Preserve WebIQ MCP support in both providers:
  - App-side MCP registry for `voiceProvider=azure-realtime`.
  - Native MCP server tool for `voiceProvider=voice-live`.
- **REQ-007**: Add explicit handling for transcription model selection (`whisper-1` vs `mai-transcribe`) with deterministic fallback logic.
- **REQ-008**: Ensure reconnect restores session configuration and conversation continuity.
- **REQ-009**: Keep all write operations deterministic and testable with unit tests; no network calls in unit tests.
- **REQ-010**: Enforce concise bullet-point talking-point format in model responses; cap response at ~200 output tokens for talking-point stage.
- **REQ-011**: Detect questions posed in voice (interrogative utterances) and prioritize retrieval/response for those turns over general statements.
- **REQ-012**: Guard WebIQ tool latency with a configurable timeout (default 2s); respond without grounding if timeout exceeded, append grounding async.
- **REQ-013**: Persist session memory to disk periodically (every 5 turns or on pause/reconnect) so a crash does not lose the full conversation context.
- **REQ-014**: Support optional `foundry_agent` tool delegation for complex turns that exceed the fast model's capability, without switching the entire session to an agent WebSocket.

- **SEC-001**: Do not store WebIQ key in renderer `localStorage`.
- **SEC-002**: Preserve existing process-env precedence (`WEBIQ_API_KEY`) in `src/config/azureRealtimeSettings.js`.
- **SEC-003**: Do not log API keys or bearer tokens.

- **PER-001**: Target first visible talking points in $\leq 1.5\,\text{s}$ after utterance end under nominal network conditions.
- **PER-002**: Keep final refined response in $\leq 3\,\text{s}$ median for short factual queries.
- **PER-003**: Avoid additional model/tool orchestration on every partial frame; keep hot path minimal.
- **PER-004**: WebIQ tool calls must complete within 2s timeout or be aborted; response proceeds without grounding and grounding result is appended asynchronously if it arrives later.
- **PER-005**: Transcription (`mai-transcribe`) runs in parallel with response generation; it is not a blocking prerequisite for the model to begin responding.

- **CON-001**: Existing code anchors (must be preserved and extended, not replaced):
  - `src/utils/azureRealtimeWebSocket.js:7` (`class AzureRealtimeWebSocketService`)
  - `src/utils/azureRealtimeWebSocket.js:413` (`getAzureToolsAsync`)
  - `src/utils/azureRealtimeWebSocket.js:440` (`configureMCPRegistry`)
  - `src/utils/azureRealtimeWebSocket.js:472` (`getVoiceLiveNativeMCPTools`)
  - `src/utils/azureRealtimeWebSocket.js:877` (`handleWebSocketMessage`)
  - `src/config/azureRealtimeSettings.js:305` (`applyEnvOverrides`)
  - `src/index.js:227` (`initialize-azure-realtime` IPC)
  - `src/components/views/AdvancedView.js:715` (Voice Transport Provider UI)
- **CON-002**: Current memory persistence for conversation is Gemini-focused; Azure path must add its own deterministic state manager.
- **CON-003**: User will provide API keys in config files/environment; UI must not require secret entry in renderer.

- **GUD-001**: Use explicit state fields and event-driven transitions; no hidden state mutation.
- **GUD-002**: Keep one source of truth for session memory per active Azure session.
- **GUD-003**: Emit structured logs for: turn start/end, transcription finalization, memory update, reconnect, replay.

- **PAT-001**: L1/L2/L3 memory pattern:
  - L1 = rolling verbatim turns,
  - L2 = running summary,
  - L3 = key fact ledger (entities/actions/decisions/open questions).
- **PAT-002**: Two-stage response pattern:
  - Stage A = quick talking points (≤200 tokens, bullet-point format, no preamble),
  - Stage B = refined answer once grounding/model output stabilizes.
- **PAT-003**: Question-detection heuristic: if finalized transcript ends with `?` or matches interrogative patterns (who/what/when/where/why/how + verb), classify turn as a question and route through retrieval + response; otherwise append to context silently or respond minimally.
- **PAT-004**: Agent-as-tool delegation: attach a `foundry_agent` tool to the fast model session. Model decides when to delegate; the agent runs over the same WebSocket (no separate connection). This avoids the WebSocket open/close failures from prior agent-session attempts.
- **PAT-005**: Disk persistence pattern: `SessionContextManager.flushToDisk()` writes a JSON snapshot to the app config directory every 5 finalized turns, on pause, and on reconnect. `hydrate()` reads from disk on session resume if in-memory state is empty.

## 2. Implementation Steps

### Implementation Phase 1

- **GOAL-001**: Establish deterministic configuration and secret-handling boundaries for Voice Live + WebIQ + transcription settings.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In `src/config/azureRealtimeSettings.js`, extend `DEFAULT_TEMPLATE.voiceLive` with explicit fields: `outputModalities` (default `['text', 'audio']`), `transcriptionModel` (default `'mai-transcribe'`), `realtimeTranscriptionFallback` (default `'whisper-1'`), Azure TTS voice config. | ✅ | 2026-07-22 |
| TASK-002 | In `src/config/azureRealtimeSettings.js` `applyEnvOverrides()` (`~line 305`), add env overrides: `AZURE_VOICE_PROVIDER`, `AZURE_VOICELIVE_TRANSCRIPTION_MODEL`, `AZURE_VOICELIVE_OUTPUT_MODALITIES`, preserving existing normalization helpers. | ✅ | 2026-07-22 |
| TASK-003 | In `.env.example`, add placeholders and comments for new env keys (`AZURE_VOICE_PROVIDER`, `AZURE_VOICELIVE_TRANSCRIPTION_MODEL`, `AZURE_VOICELIVE_OUTPUT_MODALITIES`, `WEBIQ_API_KEY`). |  |  |
| TASK-004 | In `src/components/views/AdvancedView.js`, remove renderer-side WebIQ API-key entry workflow (`azureWebIQApiKey`, `saveWebIQApiKey()`, `set-azure-webiq-api-key` path) while keeping non-secret enable toggle `azureEnableWebIQ`. | ✅ | 2026-07-22 |
| TASK-005 | In `src/index.js`, remove no-longer-needed secret-write IPC handler `set-azure-webiq-api-key`; keep read-only non-secret settings diagnostics if required. | ✅ | 2026-07-22 |

### Implementation Phase 2

- **GOAL-002**: Implement explicit Azure session memory manager that continuously accumulates conversation context for deterministic carry-forward.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | Create `src/utils/sessionContextManager.js` exporting `SessionContextManager` with deterministic APIs: `startSession(sessionId)`, `appendPartialTranscript(text)`, `finalizeUserTurn(text)`, `appendAssistantTurn(text)`, `getPromptContext()`, `serialize()`, `hydrate(payload)`, `reset()`. | ✅ | 2026-07-22 |
| TASK-007 | Implement L1/L2/L3 structures in `SessionContextManager`: `rollingTurns` (max 30 — sized for ~60 min meetings), `runningSummary`, `factLedger` (entities/actions/decisions/questions), `questionLog` (detected questions with timestamps for priority routing). | ✅ | 2026-07-22 |
| TASK-008 | Add deterministic summarization update policy in manager: recompute L2 every 3 finalized turns using string/regex heuristic as immediate fallback layer; prepare interface for model-assisted upgrade in Phase 3a. | ✅ | 2026-07-22 |
| TASK-008a | Add `isQuestion(transcript)` classifier in `SessionContextManager`: returns true if utterance ends with `?` or matches interrogative patterns (who/what/when/where/why/how + auxiliary verb). Log detected questions into `questionLog`. | ✅ | 2026-07-22 |
| TASK-008b | Add `flushToDisk()` and `hydrateFromDisk()` methods: write/read JSON snapshot to `getConfigDir()/session-context-<sessionId>.json`. Call `flushToDisk()` every 5 finalized turns, on pause, and on reconnect. | ✅ | 2026-07-22 |
| TASK-009 | Integrate manager into `src/utils/azureRealtimeWebSocket.js` constructor (`~line 7`) as `this.sessionContext`; initialize on `session.created`. | ✅ | 2026-07-22 |
| TASK-010 | In `handleWebSocketMessage()` (`~line 877`), feed manager from transcription and response events: `conversation.item.input_audio_transcription.completed` -> `finalizeUserTurn`, `response.done` -> `appendAssistantTurn`. | ✅ | 2026-07-22 |

### Implementation Phase 3

- **GOAL-003**: Apply low-latency Voice Live session settings with semantic VAD, deterministic transcription-model fallback, concise response enforcement, and WebIQ latency guard.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | In `src/utils/azureRealtimeWebSocket.js` `getInputTranscriptionConfig()`, implement deterministic selection: if deployment/model contains `realtime`, use `realtimeTranscriptionFallback` (`whisper-1`); else use `voiceLive.transcriptionModel` (`mai-transcribe` by default). Transcription must run in parallel with response generation (non-blocking). | ✅ | 2026-07-22 |
| TASK-012 | In `createSessionConfig()` Voice Live branch, set `modalities` from config (default `['text', 'audio']`), use string `'pcm16'` for audio formats, and preserve semantic VAD (`getVoiceLiveTurnDetectionConfig()`). | ✅ | 2026-07-22 |
| TASK-013 | Ensure Voice Live audio optimization flags remain enabled by default: `input_audio_noise_reduction` and `input_audio_echo_cancellation`. | ✅ | 2026-07-22 |
| TASK-014 | Add explicit context injection helper in `azureRealtimeWebSocket.js` (new method `buildSessionInstructions(basePrompt, contextSnapshot)`), prepending concise L2/L3 memory to session instructions with bounded length. Include a **talking-point prompt template** that constrains the model: "Respond ONLY with 2-5 concise bullet points. No preamble. Max 200 tokens. If the user asked a question, answer it directly first then add supporting points." | ✅ | 2026-07-22 |
| TASK-015 | Wire `buildSessionInstructions()` into `createSessionConfig()` so each new/reconnected session starts with current context snapshot. | ✅ | 2026-07-22 |
| TASK-015a | Add WebIQ latency guard in `handleRegistryToolCall()`: wrap `mcpRegistry.callTool()` with a configurable timeout (default 2000ms from `azureRealtimeSettings.mcp.webiq.timeoutMs`). On timeout, return `{ success: false, error: 'timeout' }` and let the model respond without grounding. Log the timeout event. | ✅ | 2026-07-22 |
| TASK-015b | Add question-priority routing in `handleWebSocketMessage()`: when `isQuestion()` returns true for a finalized transcript, set a session-level flag `lastTurnWasQuestion = true` so the model's system instructions include "The user just asked a direct question — prioritize answering it." Reset flag on next `response.done`. | ✅ | 2026-07-22 |

### Implementation Phase 3a

- **GOAL-003a**: Upgrade L2/L3 summarization from heuristic to model-assisted for meetings exceeding 10 turns (opt-in, enabled by default when model is available).

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-M01 | In `SessionContextManager`, add `modelSummarize(turns)` async method that sends the last N unsummarized turns to the active model via a lightweight `conversation.item.create` + `response.create` with a summarization-only system instruction (separate from the main conversation flow). |  |  |
| TASK-M02 | Gate model-assisted summarization behind config flag `azureRealtimeSettings.voiceLive.modelAssistedSummary` (default `true`). When disabled, fall back to heuristic. |  |  |
| TASK-M03 | Trigger model-assisted L2 update only when `rollingTurns.length > 10` AND at least 3 turns have elapsed since last model summary (rate limit to avoid flooding the session). |  |  |
| TASK-M04 | Parse model summary output and merge into `runningSummary` and `factLedger` deterministically (append new facts, don't overwrite existing). |  |  |

### Implementation Phase 3b

- **GOAL-003b**: Add optional `foundry_agent` tool delegation for complex turns without opening a separate agent WebSocket.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-A01 | In `src/config/azureRealtimeSettings.js`, add `voiceLive.agentDelegation` config block: `{ enabled: false, agentName: '', agentProjectName: '', delegationTrigger: 'model-decided' }`. |  |  |
| TASK-A02 | In `getAzureToolsAsync()` / `getVoiceLiveNativeMCPTools()`, when `agentDelegation.enabled` is true, append a `{ type: 'foundry_agent', agent_name, agent_project_name }` tool to the session tools list. |  |  |
| TASK-A03 | Handle `response.foundry_agent_call.*` events in `handleWebSocketMessage()` (or equivalent Voice Live event names). Route results back via existing `sendToolResponse()` pattern. |  |  |
| TASK-A04 | Document in `.env.example` the agent delegation config keys and when to enable (complex reasoning turns that exceed fast-model capability). |  |  |

### Implementation Phase 4

- **GOAL-004**: Harden reconnect and continuity so conversation context survives socket churn.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-016 | In `src/utils/azureRealtimeWebSocket.js` reconnect flow (`scheduleReconnect`, `openSocketConnection`, `scheduleSessionRenewal`), add explicit replay step: after `session.created`, send `session.update` with refreshed context from `SessionContextManager.getPromptContext()`. | ✅ | 2026-07-22 |
| TASK-016a | **[NEW]** Replace blind `setTimeout(3000)` session init with event-driven flow: wait for `session.created` server event → then send `session.update` → mark initialized on `session.updated`. Matches official SDK connect pattern. | ✅ | 2026-07-22 |
| TASK-016b | **[NEW]** Fix `sendAudio()` and `sendText()` to gracefully drop data (throttled warning) instead of throwing when WebSocket is not initialized. Prevents audio pipeline crash during connection churn. | ✅ | 2026-07-22 |
| TASK-016c | **[NEW]** Fix `createSessionConfig()` to use string `'pcm16'` for `input_audio_format`/`output_audio_format` (not object). Fix `modalities` field name (was `output_modalities`). Fix voice config default to Azure HD voice for non-realtime models. | ✅ | 2026-07-22 |
| TASK-017 | Add guard state `isReplayingContext` to avoid duplicate context replay during rapid reconnect loops. | ✅ | 2026-07-22 |
| TASK-018 | Emit structured status events to renderer for reconnect lifecycle (`Connecting`, `Reconnecting`, `Context restored`, `Ready`). | ✅ | 2026-07-22 |
| TASK-019 | Add bounded retry behavior for replay failures (max 2 replay attempts per reconnect) without dropping the live session. | ✅ | 2026-07-22 |
| TASK-020 | Persist in-memory snapshot at close (`close()`) via `flushToDisk()` and reset safely to prevent stale context bleed between sessions. On next session start, if a prior snapshot exists for a session < 2 hours old, offer to hydrate (automatic hydrate on reconnect, user-prompted on fresh start). |  |  |

### Implementation Phase 5

- **GOAL-005**: Surface talking points and context-in-progress in UI with minimal latency and no provider regressions.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-021 | In `src/index.js`, add renderer events: `update-live-transcript`, `update-talking-points`, and `update-context-summary` sourced from Azure callbacks and/or context manager updates. |  |  |
| TASK-022 | In `src/components/app/SoundBoardApp.js`, add reactive properties for `liveTranscript`, `talkingPoints`, and `contextSummary`; subscribe/unsubscribe to new IPC events in lifecycle hooks. |  |  |
| TASK-023 | In `src/components/views/AssistantView.js`, render top pinned sections for transcript/talking points/context summary above response body; keep existing response navigation unchanged. |  |  |
| TASK-024 | Ensure Azure text send path (`send-azure-text-message`) and mic path both update the same memory/talking-point channels for consistent behavior. |  |  |
| TASK-025 | Keep Gemini UI behavior unchanged by gating new panels behind provider check (`llmService === 'azure'`) or empty-state render. |  |  |

### Implementation Phase 6

- **GOAL-006**: Validate correctness/performance with deterministic tests and scripted manual checks.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-026 | Create `src/__tests__/sessionContextManager.test.js` covering rolling window trim, summary recompute cadence, fact extraction determinism, serialize/hydrate roundtrip. |  |  |
| TASK-027 | Extend `src/__tests__/azureGrounding.test.js` to validate new transcription selection logic and instruction-context injection bounds. |  |  |
| TASK-028 | Extend `src/__tests__/mcpRegistry.test.js` (or add `azureVoiceLiveMcp.test.js`) to validate `voice-live` native MCP tool attachment with WebIQ headers and allowed tools filter. |  |  |
| TASK-029 | Add reconnect simulation tests for `azureRealtimeWebSocket` replay behavior using mocked WebSocket + mocked timers (no real network). |  |  |
| TASK-030 | Execute manual scripted validation matrix: (A) semantic VAD split quality, (B) talking-point latency, (C) continuous-context QA quality, (D) reconnect continuity, (E) Gemini non-regression. |  |  |

### Implementation Phase 7 — Speed Optimization + Foundry Agent Memory

- **GOAL-007**: Reduce response latency to sub-2s for talking points; provide opt-in server-managed conversation memory via Voice Live Agent mode.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-031 | Set `modalities: ["text"]` default (skip TTS generation). TTS adds 1-2s; text-only talking points don't need audio. Users who want voice output can set `["text","audio"]` in config. | ✅ | 2026-07-22 |
| TASK-032 | Set `max_response_output_tokens: 200` default (was `"inf"`). Caps generation at ~5 bullet points max, stops model from producing verbose output. | ✅ | 2026-07-22 |
| TASK-033 | Set `temperature: 0.6` default (min allowed). Reduces sampling variance = faster token selection. | ✅ | 2026-07-22 |
| TASK-034 | Add Voice Live Agent mode: when `voiceLive.agent.enabled=true`, WebSocket URL uses `agent_name` + `project_name` query params instead of `model`. Server manages full conversation memory. | ✅ | 2026-07-22 |
| TASK-035 | In agent mode, skip `instructions` in `session.update` (not supported per docs — agent uses its own prompt). | ✅ | 2026-07-22 |
| TASK-036 | Store `conversation_id` from `session.created` response for reconnection. When set in config, pass as query param to reconnect to prior conversation. | ✅ | 2026-07-22 |
| TASK-037 | Add `voiceLive.agent` config block to `azureRealtimeSettings.js` with: `enabled`, `agentName`, `projectName`, `agentVersion`, `conversationId`, `foundryResourceOverride`. | ✅ | 2026-07-22 |
| TASK-038 | Add UI toggle in AdvancedView for agent mode enable + agent name field (non-secret). |  |  |
| TASK-039 | Investigate `interim_response` config (`llm_interim_response` with `latency` trigger at 2000ms) for perceived latency improvement during tool calls. |  |  |
| TASK-040 | Test with `gpt-4.1-mini` as model (faster inference than gpt-5.4) for talking-point-only use case. |  |  |

#### Agent Mode Architecture Notes (from MS Learn docs)

**How it works:**
- Voice Live Agent mode connects to a Foundry Agent Service agent
- The agent has its own instructions, tools, and knowledge configured in Foundry portal
- The server maintains full conversation history (no need for local SessionContextManager in agent mode)
- `conversation_id` allows reconnecting to a prior conversation — server recalls all context
- Conversation IDs are tied to the specific agent + project

**When to use Agent mode vs Model mode:**
| Scenario | Use Mode |
|----------|----------|
| Fast talking points, local context control | Model mode (current) |
| Persistent multi-session memory | Agent mode |
| Custom tools managed in Foundry portal | Agent mode |
| No Foundry project/agent configured | Model mode |
| Meeting-to-meeting continuity | Agent mode + `conversation_id` |

**WebSocket URL difference:**
- Model: `?api-version=2026-04-10&model=gpt-5.4`
- Agent: `?api-version=2026-04-10&agent_name=MyAgent&project_name=MyProject`

## 3. Alternatives

- **ALT-001**: Agent-first orchestration on every utterance using full tool planning.
  - Rejected because added orchestration latency conflicts with PER-001/PER-002 and increases WebSocket complexity.
- **ALT-002**: Keep only provider-managed conversation state with no app-level memory.
  - Rejected because reconnect/renewal events can lose continuity; explicit local memory is required for deterministic carry-forward in model mode. Agent mode provides server-managed alternative.
- **ALT-003**: Use WebRTC path for voice-agent reliability.
  - Rejected because current architecture and prior failures favor WebSocket stability and deterministic reconnect behavior.
- **ALT-004**: Keep renderer-side WebIQ API key entry.
  - Rejected to reduce secret surface and align with config/env-first requirement.
- **ALT-005**: Force `whisper-1` for all transcription scenarios.
  - Rejected because non-realtime sessions can benefit from `mai-transcribe-1` fidelity.
- **ALT-006**: Run model-assisted summarization from Phase 2 (no heuristic fallback).
  - Rejected because model calls add latency and may fail; heuristic provides immediate deterministic baseline. Model-assisted upgrades in Phase 3a once baseline is proven.
- **ALT-007**: Open a separate agent WebSocket for complex turns.
  - Rejected because this is exactly what failed previously (WebSocket open/close churn). `foundry_agent` tool delegation keeps one WebSocket alive.

## 4. Dependencies

- **DEP-001**: `src/utils/azureRealtimeWebSocket.js` core event and transport lifecycle.
- **DEP-002**: `src/config/azureRealtimeSettings.js` settings resolution and env override logic.
- **DEP-003**: `src/utils/mcpRegistry.js` for app-side MCP in `azure-realtime` provider.
- **DEP-004**: `src/index.js` main-process IPC routing to renderer.
- **DEP-005**: `src/components/app/SoundBoardApp.js` and `src/components/views/AssistantView.js` for surfaced context/talking points.
- **DEP-006**: Existing test framework (`vitest`) and test setup patterns.
- **DEP-007**: Azure Voice Live endpoint availability and model deployment compatibility.
- **DEP-008**: WebIQ MCP endpoint availability and `WEBIQ_API_KEY` process env.

## 5. Files

- **FILE-001**: `src/config/azureRealtimeSettings.js` — add deterministic Voice Live/transcription/output modality settings and env overrides.
- **FILE-002**: `.env.example` — add explicit placeholders/comments for new env keys.
- **FILE-003**: `src/utils/sessionContextManager.js` (new) — deterministic linear memory manager for Azure sessions.
- **FILE-004**: `src/utils/azureRealtimeWebSocket.js` — integrate memory manager, context injection, transcription selection fallback, reconnect replay.
- **FILE-005**: `src/index.js` — emit new renderer channels and remove secret-write IPC for WebIQ key.
- **FILE-006**: `src/components/views/AdvancedView.js` — remove renderer-side WebIQ secret input path; retain non-secret toggle.
- **FILE-007**: `src/components/app/SoundBoardApp.js` — receive/display transcript/talking points/context summary state.
- **FILE-008**: `src/components/views/AssistantView.js` — render context/talking-point UI panel.
- **FILE-009**: `src/__tests__/sessionContextManager.test.js` (new) — memory determinism tests.
- **FILE-010**: `src/__tests__/azureGrounding.test.js` — extend for transcription and context injection assertions.
- **FILE-011**: `src/__tests__/mcpRegistry.test.js` (or `src/__tests__/azureVoiceLiveMcp.test.js`) — validate native/app-side MCP behavior.
- **FILE-012**: `src/utils/talkingPointPrompt.js` (new) — exported talking-point system prompt template enforcing concise bullet-point format with max token cap.
- **FILE-013**: Disk persistence target path: `<configDir>/session-context-<sessionId>.json` — written by `SessionContextManager.flushToDisk()`.

## 6. Testing

- **TEST-001**: Unit — `SessionContextManager` trims L1 to max 30 turns and preserves recency order.
- **TEST-002**: Unit — L2 summary recomputes only on every 2 finalized turns and remains deterministic for same inputs.
- **TEST-003**: Unit — L3 fact ledger extraction captures entities, actions, due dates, and open questions from canonical fixtures.
- **TEST-004**: Unit — `getInputTranscriptionConfig()` chooses `whisper-1` for realtime deployments and `mai-transcribe-1` otherwise.
- **TEST-005**: Unit — `createSessionConfig()` applies configured `output_modalities` and semantic VAD fields for Voice Live.
- **TEST-006**: Unit — reconnect path replays `session.update` then context exactly once per reconnect attempt.
- **TEST-007**: Unit — WebIQ secret remains absent from renderer localStorage and logs.
- **TEST-008**: Integration (mocked) — `update-live-transcript`, `update-talking-points`, `update-context-summary` events update `SoundBoardApp` state.
- **TEST-009**: Manual — Teams conversation with pauses verifies semantic VAD turn boundaries and no context reset across turns.
- **TEST-010**: Manual — force WebSocket reconnect and verify context continuity in subsequent answer.
- **TEST-011**: Manual — WebIQ grounded query returns current facts and appears in talking points within latency target.
- **TEST-012**: Regression — Gemini path unchanged for audio, text send, status updates, and response rendering.
- **TEST-013**: Unit — `isQuestion()` correctly classifies interrogative utterances ("What is the timeline?", "How does auth work?") and rejects statements ("I think we should proceed.", "Next slide please.").
- **TEST-014**: Unit — `flushToDisk()` writes valid JSON; `hydrateFromDisk()` restores identical L1/L2/L3 state.
- **TEST-015**: Unit — WebIQ timeout guard returns `{ success: false, error: 'timeout' }` after configured ms and does not block response generation.
- **TEST-016**: Manual — 30-minute simulated meeting: verify L2 summary quality after model-assisted phase activates (>10 turns), compare with heuristic-only.
- **TEST-017**: Manual — Agent delegation: enable `foundry_agent` tool, ask a complex reasoning question, verify model delegates without WebSocket instability.

## 7. Risks & Assumptions

- **RISK-001**: Heuristic summary/fact extraction may underperform on noisy transcripts.
  - Mitigation: deterministic fallback + bounded prompt context + future optional model-assisted summarization behind flag.
- **RISK-002**: Text-only output modality may reduce perceived interactivity for users expecting speech audio.
  - Mitigation: keep configurable `outputModalities` in settings.
- **RISK-003**: Reconnect replay can duplicate context if idempotency guard fails.
  - Mitigation: `isReplayingContext` + replay attempt counter + replay hash cache.
- **RISK-004**: Voice Live transcription model availability may vary by region.
  - Mitigation: deterministic fallback to `whisper-1` + warning log + continue session.
- **RISK-005**: UI additions may clutter assistant experience.
  - Mitigation: compact collapsible panels and provider-gated rendering.
- **RISK-006**: Model-assisted summarization (Phase 3a) injects extra conversation items into the session which may confuse the main response flow.
  - Mitigation: Use a separate ephemeral item with `role: system` tagged `[INTERNAL-SUMMARY]` and suppress it from UI display. Rate-limit to max 1 summary call per 3 turns.
- **RISK-007**: `foundry_agent` tool delegation may introduce latency spikes for delegated turns.
  - Mitigation: Only delegate when model explicitly decides to; surface "Thinking deeper..." status in UI during agent execution so user perceives progress.
- **RISK-008**: Disk persistence writes may block the event loop on large sessions.
  - Mitigation: Use `fs.writeFile` (async) not `fs.writeFileSync`; cap serialized payload at 256KB by trimming oldest L1 turns first.

- **ASSUMPTION-001**: Azure Voice Live WebSocket endpoint remains available for configured regions.
- **ASSUMPTION-002**: `WEBIQ_API_KEY` is provided via process environment in execution environment.
- **ASSUMPTION-003**: Existing MCP registry behavior remains stable for app-side tool routing.
- **ASSUMPTION-004**: Current CI/test environment supports deterministic timer mocking for reconnect tests.
- **ASSUMPTION-005**: For model-assisted summarization, the active model deployment accepts `conversation.item.create` with system-role items mid-session without error.
- **ASSUMPTION-006**: `foundry_agent` tool type is supported in Voice Live `session.update` tools array (per `docs/webiq-voicelive-implementation-plan.md` Phase 6 guidance).

## 8. Related Specifications / Further Reading

- `docs/webiq-voicelive-implementation-plan.md`
- `docs/webiq-mcp.md`
- `plan/feature-azure-voice-live-vad-1.md`
- `src/utils/azureRealtimeWebSocket.js`
- `src/config/azureRealtimeSettings.js`
- `src/utils/mcpRegistry.js`
- `src/components/views/AdvancedView.js`
- `src/components/views/AssistantView.js`