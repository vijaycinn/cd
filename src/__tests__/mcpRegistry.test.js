import { describe, it, expect, vi } from 'vitest';

const { MCPRegistry } = require('../utils/mcpRegistry.js');

function createRegistry(fixtures) {
    const clients = new Map();
    const registry = new MCPRegistry({
        transportFactory: server => ({ serverId: server.id, headers: server.headers }),
        clientFactory: server => {
            const client = {
                connect: vi.fn(async () => {}),
                close: vi.fn(async () => {}),
                listTools: vi.fn(async () => ({ tools: fixtures[server.id]?.tools || [] })),
                callTool: vi.fn(async ({ name, arguments: args }) => ({
                    content: [{ type: 'text', text: `${server.id}:${name}:${args.query || args.q || ''}` }]
                }))
            };
            clients.set(server.id, client);
            return client;
        }
    });

    return { registry, clients };
}

describe('MCPRegistry', () => {
    it('getTools namespaces WebIQ tools and leaves Microsoft Learn tools unprefixed', async () => {
        const { registry } = createRegistry({
            microsoftLearn: {
                tools: [{ name: 'microsoft_docs_search', description: 'Search docs', inputSchema: { type: 'object' } }]
            },
            webiq: {
                tools: [{ name: 'web', description: 'Search web', inputSchema: { type: 'object' } }]
            }
        });

        registry.registerServer({ id: 'microsoftLearn', url: 'https://learn.microsoft.com/api/mcp' });
        registry.registerServer({ id: 'webiq', url: 'https://api.microsoft.ai/v3/mcp', toolPrefix: 'webiq' });
        await registry.connectAll();

        const toolNames = registry.getTools().map(tool => tool.name);
        expect(toolNames).toContain('microsoft_docs_search');
        expect(toolNames).toContain('webiq_web');
    });

    it('resolveTool maps prefixed and unprefixed names back to original tool names', async () => {
        const { registry } = createRegistry({
            microsoftLearn: { tools: [{ name: 'microsoft_docs_search' }] },
            webiq: { tools: [{ name: 'web' }] }
        });

        registry.registerServer({ id: 'microsoftLearn', url: 'https://learn.microsoft.com/api/mcp' });
        registry.registerServer({ id: 'webiq', url: 'https://api.microsoft.ai/v3/mcp', toolPrefix: 'webiq' });
        await registry.connectAll();

        expect(registry.resolveTool('webiq_web')).toEqual({ serverId: 'webiq', originalToolName: 'web' });
        expect(registry.resolveTool('microsoft_docs_search')).toEqual({ serverId: 'microsoftLearn', originalToolName: 'microsoft_docs_search' });
    });

    it('allowedTools filtering excludes non-allowed tools', async () => {
        const { registry } = createRegistry({
            webiq: {
                tools: [
                    { name: 'web' },
                    { name: 'browse' },
                    { name: 'images' }
                ]
            }
        });

        registry.registerServer({
            id: 'webiq',
            url: 'https://api.microsoft.ai/v3/mcp',
            toolPrefix: 'webiq',
            allowedTools: ['web', 'browse']
        });
        await registry.connectAll();

        const toolNames = registry.getTools().map(tool => tool.name);
        expect(toolNames).toEqual(['webiq_web', 'webiq_browse']);
    });

    it('callTool routes to the correct server and original tool name', async () => {
        const { registry, clients } = createRegistry({
            microsoftLearn: { tools: [{ name: 'microsoft_docs_search' }] },
            webiq: { tools: [{ name: 'web' }] }
        });

        registry.registerServer({ id: 'microsoftLearn', url: 'https://learn.microsoft.com/api/mcp' });
        registry.registerServer({ id: 'webiq', url: 'https://api.microsoft.ai/v3/mcp', toolPrefix: 'webiq' });
        await registry.connectAll();

        const result = await registry.callTool('webiq_web', { query: 'latest azure news' });

        expect(result.success).toBe(true);
        expect(result.content[0].text).toBe('webiq:web:latest azure news');
        expect(clients.get('webiq').callTool).toHaveBeenCalledWith({
            name: 'web',
            arguments: { query: 'latest azure news' }
        });
        expect(clients.get('microsoftLearn').callTool).not.toHaveBeenCalled();
    });
});
