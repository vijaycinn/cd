<img src="/src/assets/logo.png" alt="Sound Board Logo" width="200"/>

# Sound Board

> [!NOTE]  
> Recommended for Windows 10/11 (64-bit) and macOS. Linux is supported for development and testing.

A real-time AI assistant for interviews, customer meetings, presentations, and technical discussions. Sound Board captures screen context and live audio, streaming speech to Azure or Gemini to surface fast, structured talking points directly on screen.

---

## ✨ Features

### 🎙️ Azure Voice Live & Realtime API
- **Azure Voice Live WebSocket Integration**: Connects directly to Azure AI Foundry Voice Live endpoints (`/voice-live/realtime?api-version=2026-04-10`) and Azure OpenAI Realtime (`/openai/v1/realtime`).
- **Cascaded & Realtime Models**: Supports `gpt-5.4`, `gpt-5-nano`, `gpt-4.1`, `gpt-realtime`, `gpt-realtime-mini`, and other Foundry deployments.
- **Server Voice Activity Detection (VAD)**: Utilizes `azure_semantic_vad` and `server_vad` for automatic turn-taking and end-of-utterance detection.
- **Trailing Silence Preservation**: Ensures the server VAD receives trailing silence frames after user speech to trigger automatic commits and responses reliably, guarded by a safety watchdog.
- **Client-Side Silence Gate**: Filters idle room noise to conserve bandwidth and prevent spurious turn detections.
- **Pause & Resume Audio**: Dedicated controls to temporarily pause audio capture, force-commit pending audio, and trigger responses on demand.

### 🔐 Keyless Entra ID (Azure CLI) Authentication
- **Zero API Keys Required**: Native authentication using Azure Managed Identity / Entra ID bearer tokens via Azure CLI (`az login`).
- **Tenant-Aware**: Automatically targets the correct resource tenant (`https://cognitiveservices.azure.com/.default`) with built-in diagnostics for cross-tenant setups.

### 🧠 In-Session Context Memory (L1 / L2 / L3)
- **Deterministic Carry-Forward**: Built-in `SessionContextManager` preserves conversational continuity across turns instead of treating each turn as an isolated prompt.
  - **L1**: Rolling verbatim turn buffer (sized for up to 60-minute meetings).
  - **L2**: Running conversation summaries updated automatically.
  - **L3**: Key fact ledger capturing entities, decisions, open questions, and action items.
- **Interrogative Routing**: Automatically classifies questions and prioritizes direct answers in the first talking point.
- **Disk Snapshot Persistence**: Periodic snapshots save session state to disk to survive reconnects and network interruptions.

### 🌐 Live Grounding via Model Context Protocol (MCP)
- **Microsoft Learn MCP**: Queries official Microsoft Learn documentation (`https://learn.microsoft.com/api/mcp`) for accurate Azure, M365, and technical knowledge.
- **WebIQ MCP**: Live web browsing and search grounding (`https://api.microsoft.ai/v3/mcp`).
- **Non-blocking Tool Warm-up**: Tools connect in the background (`warmUpMCPTools()`) so initial audio turns are never stalled by HTTP round-trips.
- **Dedicated Timeouts**: Configurable per-server timeout budgets (default 8s for deep Learn lookups) with graceful ungrounded fallback.

### 👁️ Azure Vision Screenshot Analysis
- **On-Demand Visual Intelligence**: Uses Azure OpenAI GPT-4.1 Chat Completions Vision API to analyze screen content and diagrams.
- **Three Capture Triggers**: Camera button in toolbar, right-click anywhere, or `Ctrl+Enter` shortcut.

### ⚡ Ultra-Low Latency Talking Points
- **Sub-1.5s Response Target**: Model output is constrained to 2–5 actionable bullet points (`• ` prefix) capped at 200 tokens.
- **Text-Only Modality Optimization**: Skips server TTS generation by default for maximum speed and instant on-screen rendering.

### ♊ Google Gemini Fallback
- Dual-provider architecture: Seamlessly toggle between Azure and Google Gemini 2.0 Flash Live.

### 🛡️ Stealth & Overlay Controls
- Always-on-top transparent overlay with click-through toggle (`Ctrl+M`).
- Anti-analysis and stealth measures: Randomized process names, dynamic window titles, taskbar concealment.
- Emergency Erase (`Ctrl+Shift+E`) to clear on-screen data instantly.

---

## 🚀 Getting Started

### Prerequisites

1. **Azure CLI (`az`)**: Install [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) and authenticate:
   ```bash
   az login --tenant <your-tenant-id>
   ```
2. **Node.js**: v18+ (Node.js 20+ recommended).
3. **PowerShell 7 (`pwsh`)**: Recommended on Windows.

### Installation

```bash
git clone https://github.com/vijaycinn/cd.git
cd cd
npm install
```

### Running the App

```bash
npm start
```

---

## ⚙️ Configuration

Settings are configured via the **Advanced** UI tab or in `%APPDATA%\sound-board-config\azure-realtime-settings.json`:

```json
{
  "voiceProvider": "voice-live",
  "sampleRate": 24000,
  "auth": {
    "tenantId": ""
  },
  "voiceLive": {
    "apiVersion": "2026-04-10",
    "outputModalities": ["text", "audio"],
    "maxResponseOutputTokens": 200,
    "semanticVad": {
      "enabled": true,
      "type": "azure_semantic_vad",
      "silenceDurationMs": 600,
      "speechDurationMs": 80
    },
    "noiseSuppression": true,
    "echoCancellation": false
  },
  "mcp": {
    "microsoftLearn": {
      "enabled": true,
      "timeoutMs": 8000
    },
    "webiq": {
      "enabled": true,
      "timeoutMs": 8000
    }
  },
  "vision": {
    "enabled": true,
    "deployment": "gpt-4.1"
  }
}
```

### Connecting with Azure AI Foundry

1. Open Sound Board and navigate to the **Advanced** tab.
2. Select **Azure OpenAI** as the LLM Service.
3. Enter your **Azure Endpoint** (e.g., `https://<your-resource>.services.ai.azure.com/`).
4. Set the **Region** (e.g., `eastus2`).
5. Set **Voice Deployment** (`gpt-5-nano`, `gpt-4.1-mini`, etc. — see recommendations below).
6. Set **Vision Deployment** (`gpt-4.1-mini` or `gpt-4.1`).
7. Ensure `az login` is authenticated to the resource tenant. Entra ID bearer tokens are acquired automatically without entering API keys.

---

## 🎯 Recommended Azure Foundry Models (Low Latency & Low Cost)

For real-time meeting and interview assistance, model selection directly controls token-to-screen latency and compute costs.

### Model Matrix for Voice Live & Realtime

| Deployment / Model | Modality & Mode | Latency (TTFT) | Relative Cost | Best For / Recommendation |
|---|---|---|---|---|
| **`gpt-5-nano`** 🏆 | Cascaded (Azure STT → LLM → TTS) | **~0.8s – 1.2s** | **$ (Lowest)** | **Top Pick for Real-time Talking Points.** Fastest inference, lowest cost per token. *Note: Use default temperature (leave `temperature: null` in config).* |
| **`gpt-4.1-mini`** 🥈 | Cascaded (Azure STT → LLM → TTS) | **~1.0s – 1.4s** | **$ (Low)** | **Best Balanced Choice.** Excellent MCP tool grounding (Microsoft Learn / WebIQ) and structured reasoning at high speed and low cost. |
| **`gpt-realtime-mini`** | Native Speech-to-Speech | **~0.9s – 1.3s** | **$$ (Moderate)** | **Best for Native Audio.** Use when live voice audio feedback is required rather than text-only display. |
| **`gpt-5.4`** | Cascaded (Azure STT → LLM → TTS) | **~1.8s – 2.5s** | **$$$ (Standard)** | **Deep Technical Reasoning.** Higher latency and token cost; best when answering complex architectural questions where depth overrides raw speed. |

### Model Matrix for Screenshot Analysis (Vision)

| Deployment / Model | Latency | Relative Cost | Recommendation |
|---|---|---|---|
| **`gpt-4.1-mini`** 🏆 | **~1.2s – 1.8s** | **$ (Lowest)** | **Recommended for Frequent Screenshots.** Low cost per image, fast OCR and summary of slides or terminal logs. |
| **`gpt-4.1`** | **~2.0s – 3.0s** | **$$ (Moderate)** | **Complex Architectural Diagrams.** Superior accuracy for fine text, multi-tier system diagrams, and dense code snippets. |

### 💡 Latency Optimization Tips
1. **Use Text-Only Modality**: In `azure-realtime-settings.json`, set `"outputModalities": ["text"]` if you only read the on-screen display. Skipping text-to-speech (TTS) audio generation saves 800ms–1.5s per turn.
2. **Cap Output Tokens**: Keep `"maxResponseOutputTokens": 200`. The model produces 2–5 punchy bullet points without wasting tokens on preambles.
3. **Region Proximity**: Deploy your Foundry resource in the Azure region geographically closest to your client (e.g., `eastus2` or `westus2`) to minimize round-trip WebSocket ping time.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` (Windows) / `Cmd+Enter` (macOS) | Start Session / Capture Screenshot |
| `Ctrl+\` / `Cmd+\` | Toggle Window Visibility |
| `Ctrl+M` / `Cmd+M` | Toggle Click-Through Mode |
| `Ctrl+Arrow Keys` | Reposition Window |
| `Ctrl+[` / `Ctrl+]` | Navigate Previous / Next Response |
| `Ctrl+E` | "Go Deeper" (Expand details on current talking point) |
| `Ctrl+Shift+E` | Emergency Erase (Instantly purge current session data) |

---

## 📦 Windows Portable Edition

A standalone, zero-installation build is available:
- **Download**: Grab `SoundBoard-v0.4.0-win-x64-portable.zip` from [GitHub Releases](https://github.com/vijaycinn/cd/releases).
- **Run**: Unzip anywhere and double-click `SoundBoard.exe`.
- **Local Build**: Run `npm run package` to compile directly into `out/SoundBoard-win32-x64/` and `installer/SoundBoard-Portable/`.

---

## 🧪 Testing

Run the Vitest test suite:

```bash
npm test
```

Includes unit tests for audio RMS analysis, MCP grounding, session context manager, Voice Live latency budgets, and server VAD trailing-silence mechanics.

---

## 📄 License

GPL-3.0 License. See [LICENSE](LICENSE) for details.
