/**
 * Microsoft Learn MCP Client
 * 
 * HTTP-based MCP client for connecting to Microsoft Learn MCP server
 * at https://learn.microsoft.com/api/mcp
 * 
 * This uses the @modelcontextprotocol/sdk with HTTP transport (not stdio)
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

class MicrosoftLearnMCPClient {
    constructor() {
        this.client = null;
        this.transport = null;
        this.tools = [];
        this.connected = false;
        this.serverUrl = 'https://learn.microsoft.com/api/mcp';
    }

    /**
     * Connect to Microsoft Learn MCP server
     */
    async connect() {
        if (this.connected) {
            console.log('[MCP] Already connected to Microsoft Learn');
            return true;
        }

        try {
            console.log('[MCP] Connecting to Microsoft Learn MCP server...');

            // Create StreamableHTTP transport for HTTP-based MCP
            this.transport = new StreamableHTTPClientTransport(new URL(this.serverUrl));

            // Create MCP client
            this.client = new Client(
                {
                    name: 'sound-board',
                    version: '0.4.0'
                },
                {
                    capabilities: {
                        tools: {}
                    }
                }
            );

            // Connect to server
            await this.client.connect(this.transport);
            console.log('[MCP] Connected to Microsoft Learn MCP server');

            // List available tools
            const toolsResponse = await this.client.listTools();
            this.tools = toolsResponse.tools || [];
            console.log(`[MCP] Microsoft Learn provides ${this.tools.length} tools:`, 
                this.tools.map(t => t.name).join(', '));

            this.connected = true;
            return true;

        } catch (error) {
            console.error('[MCP] Failed to connect to Microsoft Learn:', error);
            this.connected = false;
            return false;
        }
    }

    /**
     * Disconnect from MCP server
     */
    async disconnect() {
        if (!this.connected) {
            return;
        }

        try {
            console.log('[MCP] Disconnecting from Microsoft Learn...');
            if (this.client) {
                await this.client.close();
            }
            this.client = null;
            this.transport = null;
            this.tools = [];
            this.connected = false;
            console.log('[MCP] Disconnected from Microsoft Learn');
        } catch (error) {
            console.error('[MCP] Error disconnecting:', error);
        }
    }

    /**
     * Get all available tools from Microsoft Learn MCP server
     * Returns tools in Azure OpenAI function format
     */
    getTools() {
        if (!this.connected || this.tools.length === 0) {
            return [];
        }

        return this.tools.map(tool => ({
            type: 'function',
            name: tool.name,
            description: tool.description || 'Microsoft Learn MCP tool',
            parameters: tool.inputSchema || {
                type: 'object',
                properties: {},
                required: []
            }
        }));
    }

    /**
     * Call a tool on Microsoft Learn MCP server
     */
    async callTool(toolName, args) {
        if (!this.connected) {
            throw new Error('Not connected to Microsoft Learn MCP server');
        }

        try {
            console.log(`[MCP] Calling tool: ${toolName}`, args);

            const result = await this.client.callTool({
                name: toolName,
                arguments: args
            });

            console.log(`[MCP] Tool ${toolName} result:`, result);

            return {
                success: true,
                content: result.content || []
            };

        } catch (error) {
            console.error(`[MCP] Tool call ${toolName} failed:`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Check if connected
     */
    isConnected() {
        return this.connected;
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            connected: this.connected,
            serverUrl: this.serverUrl,
            toolCount: this.tools.length,
            tools: this.tools.map(t => ({ name: t.name, description: t.description }))
        };
    }
}

// Singleton instance
let instance = null;

module.exports = {
    MicrosoftLearnMCPClient,
    getInstance: () => {
        if (!instance) {
            instance = new MicrosoftLearnMCPClient();
        }
        return instance;
    }
};
