/**
 * Tests for Azure Realtime WebSocket grounding features
 * Ensures backward compatibility and proper configuration handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Azure Grounding Configuration', () => {
    let originalLocalStorage;

    beforeEach(() => {
        // Mock localStorage
        originalLocalStorage = global.localStorage;
        global.localStorage = {
            getItem: (key) => null,
            setItem: () => {},
            removeItem: () => {},
            clear: () => {}
        };
    });

    afterEach(() => {
        global.localStorage = originalLocalStorage;
    });

    it('getAzureGroundingConfig returns empty config when no settings present', () => {
        const { AzureRealtimeWebSocketService } = require('../utils/azureRealtimeWebSocket.js');
        const service = new AzureRealtimeWebSocketService(
            'test-key',
            'https://test.openai.azure.com',
            'gpt-5-mini',
            'eastus2',
            'test prompt',
            'interview',
            'en-US'
        );

        const config = service.getAzureGroundingConfig();
        expect(config).toEqual({});
        expect(config.data_sources).toBeUndefined();
    });

    it('getAzureGroundingConfig includes Azure AI Search when configured', () => {
        global.localStorage = {
            getItem: (key) => {
                if (key === 'azureSearchEndpoint') return 'https://test.search.windows.net';
                if (key === 'azureSearchIndex') return 'test-index';
                if (key === 'azureSearchKey') return 'test-key';
                return null;
            },
            setItem: () => {},
            removeItem: () => {},
            clear: () => {}
        };

        const { AzureRealtimeWebSocketService } = require('../utils/azureRealtimeWebSocket.js');
        const service = new AzureRealtimeWebSocketService(
            'test-key',
            'https://test.openai.azure.com',
            'gpt-5-mini',
            'eastus2',
            'test prompt',
            'interview',
            'en-US'
        );

        const config = service.getAzureGroundingConfig();
        expect(config.data_sources).toBeDefined();
        expect(config.data_sources).toHaveLength(1);
        expect(config.data_sources[0].type).toBe('azure_search');
        expect(config.data_sources[0].parameters.endpoint).toBe('https://test.search.windows.net');
        expect(config.data_sources[0].parameters.index_name).toBe('test-index');
    });

    it('getAzureGroundingConfig includes web search when enabled', () => {
        global.localStorage = {
            getItem: (key) => {
                if (key === 'azureEnableWebSearch') return 'true';
                if (key === 'azureBingConnectionId') return 'my-connection';
                return null;
            },
            setItem: () => {},
            removeItem: () => {},
            clear: () => {}
        };

        const { AzureRealtimeWebSocketService } = require('../utils/azureRealtimeWebSocket.js');
        const service = new AzureRealtimeWebSocketService(
            'test-key',
            'https://test.openai.azure.com',
            'gpt-5-mini',
            'eastus2',
            'test prompt',
            'interview',
            'en-US'
        );

        const config = service.getAzureGroundingConfig();
        expect(config.data_sources).toBeDefined();
        expect(config.data_sources).toHaveLength(1);
        expect(config.data_sources[0].type).toBe('bing_grounding');
        expect(config.data_sources[0].parameters.connection_id).toBe('my-connection');
    });

    it('getAzureTools returns empty array when no tools configured', () => {
        const { AzureRealtimeWebSocketService } = require('../utils/azureRealtimeWebSocket.js');
        const service = new AzureRealtimeWebSocketService(
            'test-key',
            'https://test.openai.azure.com',
            'gpt-5-mini',
            'eastus2',
            'test prompt',
            'interview',
            'en-US'
        );

        const tools = service.getAzureTools();
        expect(tools).toEqual([]);
        expect(Array.isArray(tools)).toBe(true);
    });

    it('getAzureTools parses valid JSON tools from localStorage', () => {
        const mockTools = [
            {
                type: 'function',
                name: 'get_weather',
                description: 'Get weather',
                parameters: {
                    type: 'object',
                    properties: {
                        location: { type: 'string' }
                    }
                }
            }
        ];

        global.localStorage = {
            getItem: (key) => {
                if (key === 'azureCustomTools') return JSON.stringify(mockTools);
                return null;
            },
            setItem: () => {},
            removeItem: () => {},
            clear: () => {}
        };

        const { AzureRealtimeWebSocketService } = require('../utils/azureRealtimeWebSocket.js');
        const service = new AzureRealtimeWebSocketService(
            'test-key',
            'https://test.openai.azure.com',
            'gpt-5-mini',
            'eastus2',
            'test prompt',
            'interview',
            'en-US'
        );

        const tools = service.getAzureTools();
        expect(tools).toHaveLength(1);
        expect(tools[0].name).toBe('get_weather');
    });

    it('getAzureTools handles invalid JSON gracefully', () => {
        global.localStorage = {
            getItem: (key) => {
                if (key === 'azureCustomTools') return 'invalid json{';
                return null;
            },
            setItem: () => {},
            removeItem: () => {},
            clear: () => {}
        };

        const { AzureRealtimeWebSocketService } = require('../utils/azureRealtimeWebSocket.js');
        const service = new AzureRealtimeWebSocketService(
            'test-key',
            'https://test.openai.azure.com',
            'gpt-5-mini',
            'eastus2',
            'test prompt',
            'interview',
            'en-US'
        );

        const tools = service.getAzureTools();
        expect(tools).toEqual([]);
    });

    it('getAzureTools handles non-array JSON gracefully', () => {
        global.localStorage = {
            getItem: (key) => {
                if (key === 'azureCustomTools') return '{"type": "function"}';
                return null;
            },
            setItem: () => {},
            removeItem: () => {},
            clear: () => {}
        };

        const { AzureRealtimeWebSocketService } = require('../utils/azureRealtimeWebSocket.js');
        const service = new AzureRealtimeWebSocketService(
            'test-key',
            'https://test.openai.azure.com',
            'gpt-5-mini',
            'eastus2',
            'test prompt',
            'interview',
            'en-US'
        );

        const tools = service.getAzureTools();
        expect(tools).toEqual([]);
    });
});
