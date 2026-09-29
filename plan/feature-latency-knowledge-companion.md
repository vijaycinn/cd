# Latency + Knowledge Companion Plan (Quick Wins First)

## Problem
The current Azure realtime flow is functional, but perceived response latency can still spike during live calls due to audio buffering and tool-loading overhead.  
Also, Azure realtime turns are not yet persisted into the same local conversation history pipeline used by Gemini, limiting "companion memory" during ongoing interview support.

## User constraints and targets
- Primary goal: balanced latency + knowledge quality
- Scenario focus: interview
- Target perceived latency: about 1.5s from user stop-speaking to assistant start-speaking
- Knowledge sources priority: Microsoft Learn MCP + local transcript/context memory
- Scope preference: quick wins first
- Constraint: model is deployed in Foundry tenant with limited API accessibility and latest model availability constraints

## Proposed approach
Ship a quick-win slice that reduces startup/runtime latency variance, adds observability for true bottlenecks, and introduces lightweight local context memory for Azure turns.  
Defer deeper architectural changes (full WebRTC migration, server-side retrieval orchestration) until telemetry validates remaining bottlenecks.

## Voice Live Agent vs Model (evidence-backed)
- **Voice Live model mode** is documented as preferable when fine-grained session parameters and frequently changing instructions are needed in code.
- **Voice Live agent mode** is documented as streamlined integration by connecting with agent identity, with prompt/config managed in Agent Service.
- **Agent mode constraints** from docs:
  - Voice Live + Foundry Agent Service quickstart is in public preview.
  - Foundry agent integration currently supports public endpoints only (private VNet agent endpoints not supported).
  - Agent invocation path requires Entra ID (no key-based auth for agent invocation).
- **Grounding/MCP posture**:
  - Voice Live FAQ indicates MCP is supported in model mode (except phi models) and with Foundry (new) agents; not supported with Foundry classic agents.
- **Latency anchor**:
  - Voice Live FAQ states WebRTC is currently not supported in Voice Live.
  - Azure OpenAI Realtime docs recommend WebRTC for lowest client-side latency and position WebSocket as server-to-server where low latency isn't the primary requirement.

## Recommended path forward (architect recommendation)
1. **Primary path for objective (~1.5s interview copilot)**:  
   Keep current Azure OpenAI realtime implementation as primary, optimize immediately, then prioritize AOAI Realtime **WebRTC** migration for client latency.
2. **Grounding path**:  
   Use bounded local context + MS Learn MCP + enterprise retrieval (Azure AI Search and approved enterprise sources) with strict response-time budgets.
3. **Agent path**:  
   Run Voice Live Agent mode as a parallel POC for managed prompts/tool orchestration and richer speech features; do not make it primary until measured latency/reliability gates pass.
4. **Decision gate**:  
   Promote Agent mode only if P50/P95 speech-stop-to-first-audio and grounding quality outperform model path under the same interview workload.

## Review and execution gate
- This plan is intentionally persisted for manual review before implementation.
- No code changes should begin until you explicitly say to start implementation.
- When implementation starts, execute in todo order with quick wins first.

## Todo plan

1. **Run Agent vs Model architecture spike (Voice Live + current stack)**
   - Compare Voice Live model mode vs Voice Live agent mode vs current Azure OpenAI realtime path.
   - Measure:
     - connect/setup time
     - speech stop -> first audio/text delta
     - tool-grounded answer quality under interview prompts
   - Capture objective promotion criteria for the primary runtime path.
   - Files: telemetry hooks + benchmark capture in `src/utils/azureRealtimeWebSocket.js`, `src/index.js`.

2. **Add end-to-end latency telemetry and debug switches**
   - Track timestamps for:
     - speech stop (`input_audio_buffer.speech_stopped`)
     - server commit
     - first text delta / first audio delta
     - response done
   - Track MCP tool timing:
     - MCP connect duration
     - per-tool call duration
   - Surface compact metrics in logs and optional UI/debug status.
   - Files: `src/utils/azureRealtimeWebSocket.js`, `src/utils/microsoftLearnMCP.js`, optional status bridge in `src/index.js`.

3. **Reduce audio pipeline latency for interview profile**
   - Introduce an "interview quick-latency" preset in realtime settings:
     - lower `streaming.chunkFlushIntervalMs`
     - lower `streaming.minChunkBytes` while preserving commit stability
     - keep `semantic_vad` but allow profile-specific `eagerness` tuning
   - Add safe bounds validation for chunk/commit settings to avoid `commit_empty` regressions.
   - Files: `src/config/azureRealtimeSettings.js`, `src/utils/azureRealtimeWebSocket.js`, optional settings UI in `src/components/views/AdvancedView.js`.

4. **Defer and cache MCP tool readiness to avoid connect-path stalls**
   - Move MCP connect/list-tools to background warm-up after socket/session open (non-blocking).
   - Cache tool list in memory for session lifetime and skip reconnect/list on every init unless stale/disconnected.
   - Keep graceful fallback when MCP is unavailable; do not block voice response path.
   - Files: `src/utils/microsoftLearnMCP.js`, `src/utils/azureRealtimeWebSocket.js`.

5. **Add Azure conversation memory persistence (local)**
   - Reuse existing conversation storage path (IndexedDB via renderer event) for Azure turns.
   - Save paired turns from Azure callbacks:
     - transcription from `onTranscription`
     - assistant output from `onMessage`/completion boundary
   - Ensure no duplicate turn writes during streaming updates.
   - Files: `src/index.js`, `src/utils/renderer.js` (reuse existing `save-conversation-turn` listener), optional helper extraction.

6. **Knowledge companion behavior: local-first context + constrained tool use**
   - Build a lightweight "recent interview context" payload (e.g., last N user turns) for Azure text requests/tool-grounded prompts.
   - Apply bounded retrieval policy:
     - local transcript context first
     - Microsoft Learn tool calls only when query appears documentation-seeking
   - Keep prompt budget bounded to protect latency.
   - Files: `src/index.js`, `src/utils/azureRealtimeWebSocket.js` (tool-call routing), possible helper module for context formatting.

7. **Foundry deployment compatibility guardrails**
    - Add proactive startup/session check for deployment accessibility (tenant/resource mismatch and unavailable models).
    - Provide deterministic error messaging + optional fallback deployment selection from configured list.
    - Files: `src/index.js`, `src/utils/azureRealtimeWebSocket.js`, settings UI touchpoint if fallback deployment list is exposed.

8. **Optional Voice Live agent-mode POC (non-primary)**
   - Build a thin adapter path for Voice Live Agent invocation using agent identity/session config.
   - Validate enterprise-site grounding behavior through agent-managed tools and MCP support.
   - Keep behind feature flag until latency and reliability gates pass.
   - Files: new adapter module + runtime routing in `src/index.js` and renderer config.

## Notes and considerations
- For lowest latency, Microsoft guidance favors WebRTC for client-side audio; current implementation is WebSocket-first.  
  Quick wins will optimize existing WebSocket path before any transport migration.
- Voice Live Agent mode has governance and managed prompt benefits, but preview/public-endpoint constraints should be treated as adoption risks.
- VAD defaults should remain interruption-safe for interview mode; tuning should prefer stability over aggressive cut-in.
- Any knowledge expansion must remain bounded by token and tool-call limits to avoid turning lookup into a new latency bottleneck.
- Given tenant/model constraints, include capability checks and explicit downgrade behavior rather than optimistic model assumptions.
