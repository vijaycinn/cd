# MCP Server

## Authentication

All requests (both MCP and REST API) can be authenticated using an **API key** or **Entra ID**. For detailed setup instructions, see [Authentication](/documentation/authentication).

## MCP Server Integration

The Web IQ MCP server enables AI agents to seamlessly integrate with the rich search capabilities provided by Microsoft Web IQ offerings. This integration provides AI models with real-time access to the latest content from web, news, videos, images and browse capabilities.

**Endpoint:** `mcp https://api.microsoft.ai/v3/mcp`

**Available MCP Tools:**

- `web` - Search the web and retrieve webpage content
- `videos` - Search for relevant videos
- `browse` - Retrieve content from a specific URL
- `news` - Search for the latest news articles **(Beta)**
- `images` - Search for relevant images **(Beta)**

> **Note:** The tools exposed by the WebIQ MCP server are scoped to your account's allowed service list. If your API key or Entra ID does not have permission for a given tool, it will not appear in the MCP tools list. Contact your Microsoft representative to request access to additional tools.

**MCP Server Configuration:**

Add this to your `mcp.json` file to use with VS Code Copilot or other MCP-compatible clients:

```json
{
  "mcpServers": {
    "WebIQ-MCP": {
      "url": "https://api.microsoft.ai/v3/mcp",
      "type": "http",
      "headers": {
        "x-apikey": "<your-api-key>"
      }
    }
  }
}
```

For Copilot CLI, add the following content to the configuration file located at:

- Mac/Linux: `~/.copilot/mcp-config.json`
- Windows: `%USERPROFILE%\.copilot\mcp-config.json`

```json
{
  "mcpServers": {
    "WebIQ-MCP": {
      "url": "https://api.microsoft.ai/v3/mcp",
      "type": "http",
      "authtype": "api-key",
      "headers": {
        "x-apikey": "<your-api-key>"
      }
    }
  }
}
```

---

## Web Search MCP Tool

**Tool Name:** `web`

The MCP tool accepts the same parameters as the REST API. See [Web Search Parameters](/documentation/api-reference/web#parameters) for the full reference.

---

## Videos Search MCP Tool

**Tool Name:** `videos`

The MCP tool accepts the same parameters as the REST API. See [Videos Search Parameters](/documentation/api-reference/videos#parameters) for the full reference.

---

## Browse MCP Tool

**Tool Name:** `browse`

The MCP tool accepts the same parameters as the REST API. See [Browse Parameters](/documentation/api-reference/browse#parameters) for the full reference.

---

## News Search MCP Tool (Beta)

**Tool Name:** `news`

The MCP tool accepts the same parameters as the REST API. See [News Search Parameters](/documentation/api-reference/news#parameters) for the full reference.

---

## Images Search MCP Tool (Beta)

**Tool Name:** `images`

The MCP tool accepts the same parameters as the REST API. See [Images Search Parameters](/documentation/api-reference/images#parameters) for the full reference.
