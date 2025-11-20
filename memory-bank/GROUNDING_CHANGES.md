# Azure AI Foundry Grounding - Change Summary

## Overview
Added support for Azure AI Foundry grounding (Knowledge Base) and custom tools while maintaining full backward compatibility with existing functionality.

## Changes Made

### 1. Updated `src/utils/azureRealtimeWebSocket.js`
- **Changed `getAzureGroundingConfig()`**: Now reads from `localStorage` instead of `process.env` (Electron compatibility)
  - Supports Azure AI Search grounding via localStorage keys:
    - `azureSearchEndpoint`: Your Azure AI Search endpoint
    - `azureSearchIndex`: Index name containing your knowledge base
    - `azureSearchKey`: API key (optional if using managed identity)
  - Supports Bing web search grounding via:
    - `azureEnableWebSearch`: Set to 'true' to enable
    - `azureBingConnectionId`: Connection ID (defaults to 'default')

- **Changed `getAzureTools()`**: Now reads from `localStorage` instead of `process.env`
  - Supports custom Azure AI Foundry tools via `azureCustomTools` (JSON array)
  - Validates tool format (must be valid JSON array)
  - Gracefully handles invalid JSON or non-array values

### 2. Backward Compatibility Verification
- ✅ All 14 tests pass (7 existing + 7 new grounding tests)
- ✅ When no grounding settings present: Returns empty config
- ✅ Session configuration only adds grounding when configured
- ✅ No changes to existing deployment/endpoint logic
- ✅ Safe localStorage access with `typeof localStorage !== 'undefined'` checks

### 3. Test Coverage (`src/__tests__/azureGrounding.test.js`)
New tests verify:
- Empty config when no settings present
- Azure AI Search grounding configuration
- Web search grounding configuration
- Empty tools array when not configured
- Valid JSON tools parsing
- Invalid JSON handling
- Non-array JSON handling

## How Existing Functionality is Protected

1. **No hardcoded defaults**: All grounding features are opt-in via localStorage
2. **Conditional configuration**: Grounding only added to session if localStorage values exist
3. **Safe fallbacks**: Methods return empty arrays/objects when settings absent
4. **Type validation**: Tools must be valid JSON array, otherwise ignored
5. **Error handling**: Invalid JSON logged as warning, doesn't break service

## Configuration Keys for Grounding

### Azure AI Search (Knowledge Base)
```javascript
localStorage.setItem('azureSearchEndpoint', 'https://your-service.search.windows.net');
localStorage.setItem('azureSearchIndex', 'your-index-name');
localStorage.setItem('azureSearchKey', 'your-api-key'); // Optional
```

### Web Search (Bing)
```javascript
localStorage.setItem('azureEnableWebSearch', 'true');
localStorage.setItem('azureBingConnectionId', 'default'); // Optional
```

### Custom Tools
```javascript
const tools = [{
    type: 'function',
    name: 'get_weather',
    description: 'Get weather for a location',
    parameters: {
        type: 'object',
        properties: {
            location: { type: 'string' }
        },
        required: ['location']
    }
}];
localStorage.setItem('azureCustomTools', JSON.stringify(tools));
```

## What Hasn't Changed

- ✅ Endpoint parsing logic (handles `/openai/v1/` paths)
- ✅ WebSocket connection setup
- ✅ Audio streaming and VAD
- ✅ Session configuration for existing deployments
- ✅ Deployment name handling (gpt-5-mini, etc.)
- ✅ All UI components and views
- ✅ Main process IPC communication

## Next Steps (Optional)

To make grounding configurable via UI:
1. Add form fields to `AdvancedView.js` for grounding settings
2. Store user inputs in localStorage using the keys above
3. Values will automatically be used by `getAzureGroundingConfig()` and `getAzureTools()`

No code changes required - the backend is already ready!
