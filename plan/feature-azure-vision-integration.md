# Azure Vision Integration - Quick Reference Plan

**Feature**: Screenshot Analysis with GPT-4.1  
**Status**: Planning  
**Created**: 2026-01-28  

## 🎯 Goal
Enable screenshot analysis using Azure OpenAI GPT-4.1 Chat Completions API while preserving existing voice functionality.

## 📁 Files to Create/Modify

### New Files (1)
- `src/utils/azureVision.js` - Vision service class

### Modified Files (6)
- `src/config/azureRealtimeSettings.js` - Add vision config
- `src/components/views/AdvancedView.js` - Add vision UI fields
- `src/index.js` (or `gemini.js`) - Add IPC handlers
- `src/utils/renderer.js` - Add vision init

## 🔧 Quick Implementation Guide

### Step 1: Config (20 min)
```javascript
// azureRealtimeSettings.js - Add to DEFAULT_TEMPLATE
vision: {
    enabled: true,
    deployment: ''gpt-4.1'',
    detailLevel: ''auto'',
    maxTokens: 1000,
    systemPrompt: ''You are analyzing a screenshot...''
}
```

### Step 2: UI (40 min)
```javascript
// AdvancedView.js - Add properties
azureVisionEnabled: { type: Boolean }
azureVisionDeployment: { type: String }

// Add checkbox + input field in render()
```

### Step 3: Service (60 min)
```javascript
// NEW: src/utils/azureVision.js
class AzureVisionService extends LLMService {
    async sendImage(base64Image, prompt) {
        // Call Chat Completions API with vision
    }
}
```

### Step 4: IPC (30 min)
```javascript
// index.js - Add handlers
ipcMain.handle(''initialize-azure-vision'', ...)
// Update send-image-content to route to Azure
```

### Step 5: Renderer (20 min)
```javascript
// renderer.js
async function initializeAzureVision(...) {
    // Call initialize-azure-vision IPC
}
// Update initializeAzureRealtime to call both
```

## ✅ Testing Checklist
- [ ] Settings UI shows vision fields
- [ ] Vision service initializes
- [ ] Screenshots route to Azure
- [ ] Voice still works (no regression)
- [ ] Error handling works
- [ ] Can disable vision independently

## 📊 Time Estimate
- Config & UI: 1 hour
- Service: 1 hour  
- IPC: 0.5 hours
- Renderer: 0.5 hours
- Testing: 1 hour
**Total: 4 hours**

## 🔗 Related Documents
- PRD: `tasks/prd-azure-vision-integration.md`
- Tasks: `tasks/tasks-azure-vision-integration.md`

---

**Quick Start**: Begin with Task 1.1 in tasks document
