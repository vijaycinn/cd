const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

function normalizeAllowedTools(allowedTools) {
    if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
        return null;
    }

    return new Set(allowedTools.filter(toolName => typeof toolName === 'string' && toolName.trim()).map(toolName => toolName.trim()));
}

function toAzureFunctionTool(server, tool) {
    const exposedName = server.toolPrefix ? `${server.toolPrefix}_${tool.name}` : tool.name;
    return {
        type: 'function',
        name: exposedName,
        description: tool.description || `${server.id} MCP tool`,
        parameters: tool.inputSchema || {
            type: 'object',
            properties: {},
            required: []
        }
    };
}

class MCPRegistry {
    constructor({ clientFactory, transportFactory } = {}) {
        this.clientFactory = clientFactory || ((server) => new Client(
            {
                name: 'sound-board',
                version: '0.4.0'
            },
            {
                capabilities: {
                    tools: {}
                }
            }
        ));
        this.transportFactory = transportFactory || ((server) => new StreamableHTTPClientTransport(
            new URL(server.url),
            server.headers && Object.keys(server.headers).length > 0
                ? { requestInit: { headers: server.headers } }
                : undefined
        ));
        this.servers = new Map();
        this.toolIndex = new Map();
    }

    registerServer({ id, url, headers = {}, toolPrefix = '', allowedTools = null, enabled = true }) {
        if (!id || typeof id !== 'string') {
            throw new Error('MCP server id is required');
        }
        if (!url || typeof url !== 'string') {
            throw new Error(`MCP server ${id} requires a URL`);
        }

        const existing = this.servers.get(id);
        const server = {
            id,
            url,
            headers: { ...headers },
            toolPrefix: toolPrefix || '',
            allowedTools: normalizeAllowedTools(allowedTools),
            enabled: enabled !== false,
            client: existing?.client || null,
            transport: existing?.transport || null,
            tools: existing?.tools || [],
            connected: existing?.connected || false,
            lastError: null
        };

        this.servers.set(id, server);
        this.rebuildToolIndex();
        return server;
    }

    async connectAll() {
        const results = [];
        for (const server of this.servers.values()) {
            if (!server.enabled) {
                results.push({ id: server.id, connected: false, skipped: true });
                continue;
            }

            if (server.connected) {
                results.push({ id: server.id, connected: true });
                continue;
            }

            try {
                server.transport = this.transportFactory(server);
                server.client = this.clientFactory(server);
                await server.client.connect(server.transport);
                const toolsResponse = await server.client.listTools();
                const tools = Array.isArray(toolsResponse?.tools) ? toolsResponse.tools : [];
                server.tools = server.allowedTools
                    ? tools.filter(tool => server.allowedTools.has(tool.name))
                    : tools;
                server.connected = true;
                server.lastError = null;
                console.log(`[MCPRegistry] Connected ${server.id}; exposed ${server.tools.length} tool(s)`);
                results.push({ id: server.id, connected: true });
            } catch (error) {
                server.connected = false;
                server.lastError = error;
                console.warn(`[MCPRegistry] Failed to connect ${server.id}:`, error.message);
                results.push({ id: server.id, connected: false, error });
            }
        }

        this.rebuildToolIndex();
        return results;
    }

    getTools() {
        const tools = [];
        for (const server of this.servers.values()) {
            if (!server.enabled || !server.connected) {
                continue;
            }
            tools.push(...server.tools.map(tool => toAzureFunctionTool(server, tool)));
        }
        return tools;
    }

    resolveTool(functionName) {
        if (!functionName || typeof functionName !== 'string') {
            return null;
        }

        if (this.toolIndex.size === 0) {
            this.rebuildToolIndex();
        }

        return this.toolIndex.get(functionName) || null;
    }

    async callTool(functionName, args = {}) {
        const resolved = this.resolveTool(functionName);
        if (!resolved) {
            return {
                success: false,
                error: `Unknown MCP tool: ${functionName}`
            };
        }

        const server = this.servers.get(resolved.serverId);
        if (!server || !server.connected || !server.client) {
            return {
                success: false,
                error: `MCP server not connected: ${resolved.serverId}`
            };
        }

        try {
            const result = await server.client.callTool({
                name: resolved.originalToolName,
                arguments: args
            });

            return {
                success: true,
                content: result?.content || []
            };
        } catch (error) {
            console.error(`[MCPRegistry] Tool call ${functionName} failed:`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async disconnectAll() {
        for (const server of this.servers.values()) {
            if (server.client && typeof server.client.close === 'function') {
                try {
                    await server.client.close();
                } catch (error) {
                    console.warn(`[MCPRegistry] Error closing ${server.id}:`, error.message);
                }
            }
            server.client = null;
            server.transport = null;
            server.connected = false;
            server.tools = [];
        }
        this.rebuildToolIndex();
    }

    rebuildToolIndex() {
        this.toolIndex.clear();
        for (const server of this.servers.values()) {
            if (!server.enabled) {
                continue;
            }
            for (const tool of server.tools) {
                const exposedName = server.toolPrefix ? `${server.toolPrefix}_${tool.name}` : tool.name;
                this.toolIndex.set(exposedName, {
                    serverId: server.id,
                    originalToolName: tool.name
                });
            }
        }
    }

    reset() {
        this.servers.clear();
        this.toolIndex.clear();
    }
}

const defaultRegistry = new MCPRegistry();

module.exports = {
    MCPRegistry,
    defaultRegistry
};
