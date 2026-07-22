/**
 * Microsoft Learn MCP Client
 * 
 * HTTP-based MCP client for connecting to Microsoft Learn MCP server
 * at https://learn.microsoft.com/api/mcp
 * 
 * This uses the @modelcontextprotocol/sdk with HTTP transport (not stdio)
 */

const { defaultRegistry } = require('./mcpRegistry.js');

class MicrosoftLearnMCPClient {
    constructor() {
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
            defaultRegistry.registerServer({
                id: 'microsoftLearn',
                url: this.serverUrl,
                toolPrefix: '',
                enabled: true
            });

            const results = await defaultRegistry.connectAll();
            const learnResult = results.find(result => result.id === 'microsoftLearn');
            this.connected = !!learnResult?.connected;

            if (this.connected) {
                const tools = this.getRawTools();
                console.log(`[MCP] Microsoft Learn provides ${tools.length} tools:`, tools.map(t => t.name).join(', '));
            }

            return this.connected;

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
            await defaultRegistry.disconnectAll();
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
        const server = defaultRegistry.servers.get('microsoftLearn');
        if (!this.connected || !server?.connected || server.tools.length === 0) {
            return [];
        }

        return server.tools.map(tool => ({
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

            const result = await defaultRegistry.callTool(toolName, args);
            console.log(`[MCP] Tool ${toolName} result:`, result);
            return result;

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
        const tools = this.getRawTools();
        return {
            connected: this.connected,
            serverUrl: this.serverUrl,
            toolCount: tools.length,
            tools: tools.map(t => ({ name: t.name, description: t.description }))
        };
    }

    getRawTools() {
        const server = defaultRegistry.servers.get('microsoftLearn');
        return server?.tools || [];
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
