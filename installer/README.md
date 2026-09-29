# Sound Board v0.4.0 - Portable Edition

**Build Date:** September 29, 2026  
**Platform:** Windows x64  
**Package Size:** ~314 MB uncompressed (~122 MB zipped)  
**Built from:** Latest master branch (`cd-oai/cd`)

## Directory Contents

### SoundBoard-Portable/
**Portable Standalone Edition — Zero Installation Required**

- Unzip and double-click `SoundBoard.exe`
- No administrator rights or registry alterations needed
- Application settings saved under `%APPDATA%\sound-board-config\` and `%APPDATA%\Sound Board\`
- Self-contained with Electron runtime and all required native dependencies

**Quick Start:**
```text
1. Open the SoundBoard-Portable folder
2. Double-click SoundBoard.exe
3. Navigate to the "Advanced" tab
4. Configure Azure OpenAI / Voice Live (or Gemini)
5. Start session (Ctrl+Enter)
```

---

## ✨ Features

- **Azure Voice Live & Realtime API**: Live streaming audio with server VAD (`azure_semantic_vad` and `server_vad`).
- **Keyless Entra ID Auth**: Automatically acquires bearer tokens via Azure CLI (`az login`).
- **In-Session Context Memory**: Continuous L1/L2/L3 memory keeping full context across meeting turns.
- **MCP Grounding**: Live technical retrieval from Microsoft Learn MCP and WebIQ search.
- **Azure Vision Screenshot Analysis**: Multi-modal screen capture analysis via GPT-4.1.
- **Low-Latency Talking Points**: Concisely structured 2-5 bullet talking points under 1.5s.
- **Google Gemini Fallback**: Option to toggle to Gemini 2.0 Flash Live.
- **Stealth & Overlay**: Click-through transparent overlay, randomized process titles, emergency erase.

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Start Session / Capture Screenshot |
| `Ctrl+\` | Toggle Visibility |
| `Ctrl+M` | Toggle Click-Through Mode |
| `Ctrl+Arrow Keys` | Reposition Window |
| `Ctrl+[` / `Ctrl+]` | Previous / Next Response |
| `Ctrl+E` | Go Deeper (Expand current talking point) |
| `Ctrl+Shift+E` | Emergency Erase |

---

## 🔧 Connecting with Azure

1. Ensure Azure CLI is installed and logged in:
   ```bash
   az login
   ```
2. In Sound Board's **Advanced** tab:
   - LLM Service: `Azure OpenAI`
   - Endpoint: `https://<your-resource>.services.ai.azure.com/`
   - Region: `eastus2`
   - Voice Deployment: `gpt-5-nano` or `gpt-4.1-mini` (recommended for low latency/cost)
   - Vision Deployment: `gpt-4.1-mini` or `gpt-4.1`
3. Click "Start Session" to begin. Authentication is handled automatically via Entra ID tokens.

### 🎯 Recommended Deployments (Lowest Latency & Cost)
- **Voice**: `gpt-5-nano` (fastest talking points under 1.2s, lowest cost) or `gpt-4.1-mini` (strong grounding with Microsoft Learn / WebIQ).
- **Vision**: `gpt-4.1-mini` (rapid slide and diagram analysis).
- **Modality**: Setting `"outputModalities": ["text"]` in settings skips TTS audio generation, saving 1–1.5s per response.

