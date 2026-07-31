# Handoff — current state

Snapshot for a new session/agent picking this up. Last updated 2026-07-31.

## What this is

Electron desktop app ("Sound Board") — a real-time voice meeting assistant. Captures mic +
system audio, streams it to Azure, and surfaces short talking-point answers. Fork of
`cheating-daddy`; see [AGENTS.md](AGENTS.md) for the original project conventions.

## Where things stand

Branch `smec-dev`. Recent commits:

| Commit | What |
|---|---|
| `9caa494` | Build fix — stop packaging `.env` and build output into `app.asar` |
| `f093160` | `.vscode/settings.json` — pwsh 7 default terminal |
| `bc5676c` | MCP grounding restored + connect-path latency fix + "Go deeper" button |

Tags: `pre-mcp-grounding-fix` (revert target), `interim/mcp-grounding-latency`,
`build/v0.4.0-portable`. **All local — nothing has been pushed.**

## Commands

```powershell
npm start                                  # run the app
node node_modules\vitest\vitest.mjs run    # tests (9 files pass). npx vitest fails on exec policy
npm run package                            # build to out\SoundBoard-win32-x64\
```

Requires **PowerShell 7** (`pwsh`), not Windows PowerShell 5.1 — see Traps below.

## Architecture you need to know first

**`voiceProvider` decides everything.** It lives in
`%APPDATA%\sound-board-config\azure-realtime-settings.json` and is currently `azure-realtime`.

- `azure-realtime` (GA Realtime API) → **client-side** MCP via [src/utils/mcpRegistry.js](src/utils/mcpRegistry.js).
  The app makes the HTTP calls. `requireApproval` is ignored here; `timeoutMs` is what matters.
- `voice-live` → **server-side** MCP (`type: 'mcp'` tool declarations). Azure calls the endpoint
  inline. `require_approval`, `mcp_approval_request`, and `mcp_list_tools.*` only exist on this path.

Main service: [src/utils/azureRealtimeWebSocket.js](src/utils/azureRealtimeWebSocket.js) (~1900 lines).

## Fixed this session

**Grounding** — the model was answering "Not certain — Agent 365 isn't a recognized product"
instead of looking things up. Four causes, all fixed:
1. `requireApproval` had been flipped to `'always'`; back to `'never'`, opt-in only.
2. Approval items were only routed from `conversation.item.created`. Now handled from all five
   carrier events, deduped by id.
3. No `response.create` after approving, so the approved lookup never ran (`pendingMCPResume`).
4. Every MCP server shared WebIQ's 2s timeout. Microsoft Learn is documented at 3–60s, so every
   Learn lookup timed out. Now per-server via `getMCPToolTimeout()`, default 8s.

**Latency** — `_onSessionCreated()` awaited the MCP handshake before sending `session.update` and
before setting `isInitialized`. Since `sendAudio()` early-exits when not initialized, the user's
first utterance paid for the whole HTTP round trip. Now `warmUpMCPTools()` connects in the
background and patches tools in with a follow-up `session.update`.

**UI** — the expand action existed but was a 4-arrow icon among three identical icons. Now a
labelled "Go deeper" pill with `Ctrl+E` in [src/components/views/AssistantView.js](src/components/views/AssistantView.js).

**Packaging** — `forge.config.js` had no `ignore` rule, so Packager copied the whole project tree
into `app.asar`: `.env` (a real `WEBIQ_API_KEY`), the previous `installer/` build, and a stray
104 MB exe. asar went 1159 MB → 60 MB. Keys are entered in the Settings pane at runtime.

## Traps that have bitten repeatedly

- **PowerShell 5.1 writes a UTF-8 BOM.** `Set-Content -Encoding UTF8` / `Out-File` corrupt JSON
  config — `loadAzureRealtimeSettings()` fails to parse and *silently falls back to defaults*.
  Use `[System.IO.File]::WriteAllText($p, $text, (New-Object System.Text.UTF8Encoding($false)))`.
  PS 5.1 also has no `utf8NoBOM`.
- **The live settings file wins over code defaults.** `deepMerge(DEFAULT_SETTINGS, fileValues)`
  means editing `DEFAULT_TEMPLATE` in [src/config/azureRealtimeSettings.js](src/config/azureRealtimeSettings.js)
  is a no-op on an existing install. Change `%APPDATA%\sound-board-config\azure-realtime-settings.json` too.
- **`.env` is not auto-loaded.** Export vars in the process environment before launch.
- **`forge.config.js` `ignore` list** must be updated when adding new top-level folders, or they
  ship inside the asar.

## Open / unverified

- The portable build in [installer/SoundBoard-Portable](installer/SoundBoard-Portable) has **not been
  launched**. The `ignore` filter is new — smoke-test before copying to another machine.
- `getAzureGroundingConfig()` sets `session.data_sources` (Azure AI Search / Bing). `data_sources`
  is a Chat Completions "On Your Data" extension and is probably **dropped by the realtime socket**.
  Unverified — log `message.session?.data_sources` on `session.updated` to settle it. Don't build
  on that path until confirmed.
- `SoundBoard-Setup.exe` (104 MB) still sits in the repo root, untracked. Regenerable with
  `npm run make`. Excluded from packaging, but it's dead weight.
- Grounding on local docs (md/pdf/html) was discussed but not built. The viable path is a tool
  call (local index, Azure AI Search, or Foundry Agent knowledge) — not `data_sources`.

## Reverting

```powershell
git diff pre-mcp-grounding-fix HEAD          # everything changed this session
git revert --no-commit <sha>                 # keeps history
```

The pre-change copy of the live settings file is at
`%APPDATA%\sound-board-config\azure-realtime-settings.json.bak`.
