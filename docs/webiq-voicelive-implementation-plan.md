---
title: WebIQ MCP + Voice Live Implementation Plan
status: Ready for build
owner: SoundBoard dev
last_updated: 2026-06-17
audience: Build agent (autonomous)
---

# WebIQ MCP + Voice Live Implementation Plan

This plan is written for an autonomous build agent. Execute phases **in order**.
Each phase has a Goal, Files, Steps, and Acceptance criteria. Do not start a phase
until the previous phase's acceptance criteria pass.

## Ground rules

- **Do not modify Gemini code paths.** `src/utils/gemini.js` and Gemini routing in
  `src/utils/audioRouter.js` must remain behaviorally unchanged.
- **Keep changes isolated to Azure code paths.**
- **Never put the WebIQ API key in renderer `localStorage`.** It must live in the
  main-process settings file or an environment variable (see Phase 2).
- **Run `npm test` (vitest) after every phase.** All existing tests must stay green.
- **Use `npm.cmd`, not `npm`,** in PowerShell on this machine (npm.ps1 is blocked by
  execution policy).
- Do not create new markdown docs to describe changes. Update code and existing
  config files only.

## Context (verified facts)

- Current voice path: `src/index.js` -> `AzureRealtimeWebSocketService`
  (`src/utils/azureRealtimeWebSocket.js`) -> Azure OpenAI **Realtime** endpoint
  (`/openai/v1/realtime?model=<deployment>`).
- MCP today: `src/utils/microsoftLearnMCP.js` connects to
  `https://learn.microsoft.com/api/mcp` via `@modelcontextprotocol/sdk`
  `StreamableHTTPClientTransport`. Tool dispatch in `azureRealtimeWebSocket.js`
  is **hardcoded** to `[microsoft_docs_search, microsoft_docs_fetch, microsoft_code_sample_search]`.
- `@modelcontextprotocol/sdk` and `ws` are present in `package-lock.json` and
  `node_modules` but are **NOT declared** in `package.json` dependencies. This is a
  latent break on clean install.
- WebIQ MCP (see `docs/webiq-mcp.md`):
  - Endpoint: `https://api.microsoft.ai/v3/mcp`, transport `http`.
  - Auth: custom header `x-apikey: <key>`.
  - Tools (scoped to account): `web`, `browse`, `videos`, `news`, `images`.
- Voice Live (api-version `2026-04-10`) is a **different endpoint** than Realtime and
  natively supports `MCPTool` with a `headers` field (so `x-apikey` works natively),
  plus `azure_semantic_vad`, noise suppression, echo cancellation, interim responses,
  and `foundry_agent` tools.

## Architecture decision (the fork)

WebIQ requires a custom `x-apikey` header. The Azure OpenAI Realtime endpoint's MCP
tool only documents bearer `authorization`, not arbitrary headers. Therefore:

- **Phase 4 (Path A - app-side bridge)** delivers WebIQ on the **current Realtime
  endpoint** with no endpoint migration. This is the default deliverable.
- **Phase 6 (Path B - Voice Live, optional/flagged)** migrates to Voice Live for
  native MCP headers + better VAD. Implement only after Path A is stable and the
  user opts in.

Build agent: complete Phases 1-5 fully. Treat Phase 6 as a separate, gated effort -
do not start it without explicit user confirmation.

## Transport decision (MANDATORY — read before any agent work)

**Use WebSocket transport for everything. Do NOT use WebRTC.**

- A prior attempt to run an **agent instead of a model used WebRTC and could not hold
  a sustained connection** (the voice agent connected, then dropped). See
  Appendix A for root cause.
- The legacy WebRTC code path (`src/utils/azureRealtime.js`, the
  `get-azure-ephemeral-token` handler in `src/index.js`, and the
  `initialize-azure-webrtc` / `azure-webrtc-*` IPC channels in
  `src/utils/renderer.js`) is **deprecated**. Do not extend it, do not route the agent
  path through it.
- The working, supported path is the WebSocket service
  (`src/utils/azureRealtimeWebSocket.js`). All new work — WebIQ MCP (Phase 4) and the
  Voice Live / agent migration (Phase 6) — MUST use a WebSocket connection, not an
  `RTCPeerConnection`.
- Agents are reachable over the **same WebSocket** as models: either via Voice Live
  agent connection query params (`agent-name` + `agent-project-name`) or via the
  `foundry_agent` tool attached to a model session (chat-supervisor pattern). Both are
  WebSocket — neither requires WebRTC.

---

## Phase 1 - Stabilize dependencies

**Goal:** Make MCP/WebSocket deps explicit so clean installs work.

**Files:**
- `package.json`

**Steps:**
1. Add to `dependencies` (keep alphabetical with existing entries), using the versions
   already resolved in `package-lock.json`:
   - `@modelcontextprotocol/sdk` -> `^1.16.0`
   - `ws` -> `^8.18.0`
2. Run `npm.cmd install` to refresh the lockfile linkage. Do not upgrade unrelated
   packages.
3. Verify resolution:
   ```
   node -e "console.log(require.resolve('ws')); console.log(require.resolve('@modelcontextprotocol/sdk/client/index.js'))"
   ```

**Acceptance:**
- `npm.cmd ls @modelcontextprotocol/sdk ws --depth=0` lists both as direct deps.
- `node -e` resolution prints both paths without error.
- `npm test` passes.

---

## Phase 2 - MCP + WebIQ configuration surface

**Goal:** Add a typed config block for MCP servers (Microsoft Learn + WebIQ) in the
main-process settings, with the WebIQ key sourced from env or settings file - never
renderer `localStorage`.

**Files:**
- `src/config/azureRealtimeSettings.js`
- `.env.example`

**Steps:**
1. In `azureRealtimeSettings.js`, extend `DEFAULT_TEMPLATE` with a new `mcp` block:
   ```js
   mcp: {
     _comment: [
       'Remote MCP servers exposed as tools to the Azure Realtime session.',
       'WebIQ requires an API key via the x-apikey header.',
       'Set the key via env WEBIQ_API_KEY (preferred) or apiKey below.'
     ],
     microsoftLearn: {
       enabled: true,
       url: 'https://learn.microsoft.com/api/mcp'
     },
     webiq: {
       enabled: false,
       url: 'https://api.microsoft.ai/v3/mcp',
       apiKey: '',
       apiKeyEnv: 'WEBIQ_API_KEY',
       toolPrefix: 'webiq',
       allowedTools: ['web', 'browse', 'news']
     }
   }
   ```
2. In `applyEnvOverrides()`, resolve the WebIQ key precedence: if
   `process.env[overrides.mcp.webiq.apiKeyEnv]` is set, use it; else fall back to
   `overrides.mcp.webiq.apiKey`. Store the resolved value on a non-persisted field
   (e.g. `overrides.mcp.webiq._resolvedKey`) so it is NOT written back to the settings
   file by `maybeUpdateSettingsFile` (the existing `stripCommentKeys` drops `_`-prefixed
   keys - reuse that convention so the key is never persisted to disk).
3. Add `WEBIQ_API_KEY=` to `.env.example` with a one-line comment. Note in the comment
   that `.env` is not auto-loaded; the variable must be present in the process env.

**Acceptance:**
- Loading settings with `WEBIQ_API_KEY` set surfaces the key on `_resolvedKey` and
  NOT in the on-disk JSON (verify the written settings file contains no key).
- `mcp.webiq.enabled` defaults to `false`.
- `npm test` passes.

---

## Phase 3 - Generic MCP registry (replace hardcoded Learn client)

**Goal:** Replace the single hardcoded Microsoft Learn client with a registry that can
host multiple remote MCP servers, namespacing tool names to avoid collisions.

**Files:**
- New: `src/utils/mcpRegistry.js`
- `src/utils/microsoftLearnMCP.js` (keep, but reuse the SDK transport via the registry)
- `src/utils/azureRealtimeWebSocket.js`

**Steps:**
1. Create `mcpRegistry.js` exporting a singleton with:
   - `registerServer({ id, url, headers, toolPrefix, allowedTools })`
   - `connectAll()` - connects each enabled server via `StreamableHTTPClientTransport`
     (pass `requestInit.headers` for WebIQ's `x-apikey`).
   - `getTools()` - returns Azure-function-shaped tools. Each tool name is
     `<prefix>_<originalName>` when a prefix is set (WebIQ); Microsoft Learn keeps its
     native tool names for backward compatibility (no prefix).
   - `resolveTool(functionName)` - maps a (possibly prefixed) function name back to
     `{ serverId, originalToolName }`.
   - `callTool(functionName, args)` - resolves then calls the right server; returns
     `{ success, content }` matching the current Learn client's shape.
   - Filter by `allowedTools` when provided.
2. Wire `getAzureToolsAsync()` in `azureRealtimeWebSocket.js` to register servers from
   `this.azureRealtimeSettings.mcp` (Microsoft Learn always if enabled; WebIQ only if
   `enabled` and a resolved key exists), call `connectAll()`, then append
   `registry.getTools()` to the localStorage tools.
3. Replace the hardcoded `mcpTools` array check in `handleToolCall()` with a registry
   lookup: if `registry.resolveTool(functionName)` matches, route to a new
   `handleRegistryToolCall(callId, functionName, args)` that calls
   `registry.callTool(...)` and reuses the existing `sendToolResponse` formatting.
4. Keep `handleMCPToolCall` working or fold it into the registry path; do not break the
   existing Microsoft Learn behavior or the formatting of `function_call_output`.

**Acceptance:**
- With only Microsoft Learn enabled, behavior is unchanged: Learn tools appear with
  their native names and tool calls still return formatted text.
- Tool-name namespacing: WebIQ tools appear as `webiq_web`, `webiq_browse`, etc.
- New unit tests (Phase 5) for `resolveTool` round-tripping pass.
- `npm test` passes.

---

## Phase 4 - WebIQ via app-side MCP bridge (Path A, default deliverable)

**Goal:** Make WebIQ usable on the current Realtime endpoint, end to end.

**Files:**
- `src/utils/azureRealtimeWebSocket.js` (registry already wired in Phase 3)
- `src/components/views/AdvancedView.js` (UI toggle only - no key entry in renderer)

**Steps:**
1. Confirm registry registers WebIQ with header `{ x-apikey: resolvedKey }` and
   `allowedTools` from config.
2. Handle WebIQ tool result content shapes in the existing result formatter (text and
   resource/structured items). Reuse the array-mapping logic already in
   `handleMCPToolCall`.
3. In `AdvancedView.js`, add an Azure-only checkbox "Enable WebIQ web grounding" bound
   to a non-secret flag (e.g. `localStorage` key `azureEnableWebIQ`) that the main
   process reads as an enable signal ONLY. The actual key stays in main-process config/
   env. Do not add an API-key input field in the renderer.
4. Gracefully degrade: if WebIQ is enabled but no key resolves, log a single warning and
   skip registering WebIQ (do not throw, do not block the session).

**Acceptance:**
- With `WEBIQ_API_KEY` set, `mcp.webiq.enabled = true`, and the UI toggle on, a session
  lists WebIQ tools and a voice/text query that needs current web info triggers a
  `webiq_web`/`webiq_browse` tool call and returns grounded content.
- With the key absent, the session still starts; a single warning is logged; no WebIQ
  tools are offered.
- Microsoft Learn tools continue to work alongside WebIQ.
- `npm test` passes.

**Manual smoke (record result in PR description, not a new file):**
- Start app, enable Azure provider + WebIQ, ask "What's the latest on <recent topic>?"
  and confirm a WebIQ tool call in logs and a grounded answer.

---

## Phase 5 - Tests

**Goal:** Lock behavior with unit tests; no live network calls.

**Files:**
- New: `src/__tests__/mcpRegistry.test.js`
- Extend: `src/__tests__/azureGrounding.test.js`

**Steps:**
1. `mcpRegistry.test.js`:
   - `getTools()` namespaces WebIQ tools (`webiq_web`) and leaves Learn tools unprefixed.
   - `resolveTool(webiq_web)` -> `{ serverId: webiq, originalToolName: web }`.
   - `resolveTool(microsoft_docs_search)` -> Learn server.
   - `allowedTools` filtering excludes non-allowed tools.
   - `callTool` routes to the correct server (mock the client/transport; no network).
2. `azureGrounding.test.js`:
   - Settings loader resolves WebIQ key from env and does not persist it to disk.
   - `getAzureToolsAsync()` includes WebIQ tools only when enabled + key present (mock
     the registry).
3. Use existing vitest mocking patterns; mock `@modelcontextprotocol/sdk` client so no
   real connections occur.

**Acceptance:**
- `npm test` passes with the new tests included.
- No test performs real network I/O.

---

## Phase 6 - Voice Live migration (Path B, OPTIONAL, gated)

> Do **not** start without explicit user confirmation. This changes the endpoint and
> session schema. Implement behind a provider flag so Realtime remains the default.

**Goal:** Add a `voice-live` provider mode that uses the Voice Live endpoint with native
MCP headers, Azure semantic VAD, noise suppression, echo cancellation, and interim
responses.

**Files:**
- `src/config/azureRealtimeSettings.js` (add `voiceProvider: azure-realtime | voice-live`)
- `src/utils/azureRealtimeWebSocket.js` (or a new `src/utils/voiceLiveWebSocket.js`)
- `src/index.js` (select service by provider)
- `src/components/views/AdvancedView.js` (provider selector)

**Transport: WebSocket only (see Transport decision above). Do NOT introduce WebRTC.**

**Two ways to reach an agent (pick per use case, both over WebSocket):**
- **Agent session** — connect the Voice Live WebSocket directly to a Foundry agent using
  `agent-name` + `agent-project-name` query params instead of `model`. The agent owns
  the conversation. Note: `instructions` are not supported when using a custom agent.
- **Agent-as-tool (recommended first)** — keep a fast model session and attach a
  `foundry_agent` tool so the model delegates complex turns. Lower risk, keeps the live
  loop responsive, and avoids putting the whole conversation behind agent latency.

**Steps (high level - expand at implementation time against docs + Microsoft Learn):**
1. Endpoint (model mode): `wss://<resource>.services.ai.azure.com/voice-live/realtime?api-version=2026-04-10&model=<model>`.
   Agent mode: same base path with `&agent-name=<name>&agent-project-name=<project>` instead of `&model=`.
   Keep Entra bearer auth (existing `azureAuth.js`) via `Authorization` header.
2. Session config differences vs Realtime:
   - `voice` becomes a structured object (`{ type: openai, name: alloy }` or Azure voice).
   - Native MCP tool: `{ type: mcp, server_label, server_url, headers: { x-apikey: key }, allowed_tools, require_approval: never }`.
   - VAD: `turn_detection.type = azure_semantic_vad_multilingual` with `remove_filler_words: true`, `interrupt_response`, `auto_truncate`.
   - Add `input_audio_noise_reduction: { type: azure_deep_noise_suppression }` and
     `input_audio_echo_cancellation: { type: server_echo_cancellation }`.
   - Optional `interim-response` (static) triggered on tool/latency.
3. Handle new MCP server events (`mcp_list_tools.*`, `response.mcp_call.*`). When native
   MCP is used, the service executes tools - the app does NOT need the Phase 3 bridge for
   those tools (keep the bridge for Realtime mode).
4. Transcription: allow `input_audio_transcription.model = mai-transcribe-1` for
   non-realtime models/agents; keep `whisper-1` for `gpt-realtime`/`-mini`.
5. Recommended first agent step: add the `foundry_agent` tool to a model session
   (chat-supervisor delegation) before attempting a full agent-session connection.

**Connection resilience (REQUIRED — this is what broke the WebRTC attempt):**
- Implement a heartbeat/liveness check on the WebSocket. If no server event arrives
  within a configurable idle window, treat the socket as stale.
- Implement reconnect with exponential backoff + jitter on unexpected `close`
  (any code != 1000) and on heartbeat failure. Cap retries; surface a clear status.
- Handle the documented **60-minute max session duration**: read `session.created`
  `expires_at`, proactively renew before timeout, and resume conversation context
  on the new socket so the agent feels continuous.
- On reconnect, re-send the full `session.update` (tools, VAD, audio config) before
  resuming audio; do not assume server-side session state persists across sockets.
- Log connection lifecycle transitions (connecting → open → session.created →
  reconnecting → resumed → closed) so future drops are diagnosable.
- Reuse/extend the existing close/cleanup logic in `azureRealtimeWebSocket.js`; do not
  leak timers or half-open sockets on teardown.

**Acceptance:**
- Provider selector switches cleanly between `azure-realtime` and `voice-live` with no
  regression to the default Realtime path.
- Transport is WebSocket only; no `RTCPeerConnection` is created on any new path.
- In `voice-live` mode, WebIQ is attached natively (no app-side bridge) and a grounded
  query produces `response.mcp_call.completed`.
- Azure semantic VAD, noise suppression, and echo cancellation are present in the
  `session.update` payload and accepted (`session.updated`).
- **Sustained connection:** a voice agent session stays connected through at least one
  idle period and one forced reconnect, and survives an `expires_at` renewal without the
  user losing the conversation.
- Gemini path unaffected. `npm test` passes.

**Risk notes:**
- `mai-transcribe-1`, multilingual semantic VAD filler-word handling, and some Voice Live
  features are preview/region-gated. Gate them behind config flags and fail soft.
- Do not regress to WebRTC to "fix" latency. If latency is a concern, keep the model
  session on WebSocket and delegate via `foundry_agent`, rather than reopening the
  deprecated WebRTC path.

---

## Sequencing summary

1. Phase 1 - deps (blocking).
2. Phase 2 - config surface.
3. Phase 3 - generic MCP registry.
4. Phase 4 - WebIQ on Realtime (default deliverable).
5. Phase 5 - tests.
6. Phase 6 - Voice Live migration (gated; only on user confirmation).

## Definition of done (Phases 1-5)

- `package.json` declares `@modelcontextprotocol/sdk` and `ws`.
- WebIQ works on the current Realtime endpoint via the namespaced MCP registry.
- WebIQ key is sourced from env/main-process config, never renderer `localStorage`.
- Microsoft Learn MCP behavior is unchanged.
- Gemini behavior is unchanged.
- All vitest suites pass, including new registry tests; no real network I/O in tests.

---

## Appendix A - Prior WebRTC agent failure (root cause + guardrail)

**Symptom:** A prior attempt to use an **agent instead of a model** connected a voice
agent over WebRTC, then could not sustain the connection (dropped / no sustained
connected session).

**Likely root causes (from the repo's WebRTC code path):**
- The WebRTC path (`src/utils/azureRealtime.js`) uses a two-step preview flow: mint an
  **ephemeral key** from `.../openai/realtimeapi/sessions` and connect an
  `RTCPeerConnection` to the region-specific preview endpoint
  `https://<region>.realtimeapi-preview.ai.azure.com/v1/realtimertc`.
- This path depends on ephemeral-token lifetime, SDP offer/answer negotiation, ICE,
  and a preview RTC endpoint — far more failure surface than a single authenticated
  WebSocket. Connection drops are consistent with ephemeral-token expiry / RTC
  renegotiation in an Electron renderer, and with the preview endpoint behavior.
- The project already concluded WebSocket is the reliable transport for this Electron
  app (see `tasks/prd-azure-webrtc-integration.md`: "Switching from WebRTC to
  WebSocket"). The WebRTC integration tasks (`tasks/tasks-azure-webrtc-integration.md`
  section 5.x) were never finished.

**Guardrail for the build agent:**
- Do not revive or extend the WebRTC path for agents or models.
- Implement the agent path over WebSocket (Phase 6), with the connection-resilience
  requirements above (heartbeat, backoff reconnect, `expires_at` renewal, full
  `session.update` replay on reconnect).
- If a sustained connection still cannot be achieved over WebSocket, stop and report
  the exact close codes / server `error` events rather than switching transports.

