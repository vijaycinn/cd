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

    it('resolveAuthHeaders prefers API key when configured', async () => {
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

        const auth = await service.resolveAuthHeaders();
        expect(auth.mode).toBe('api-key');
        expect(auth.headers['api-key']).toBe('test-key');
        expect(auth.headers.Authorization).toBeUndefined();
    });

    it('shouldRetryWithFallback returns true when API key auth is disabled', () => {
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

        const shouldRetry = service.shouldRetryWithFallback(
            {
                details: {
                    error: {
                        code: 'AuthenticationTypeDisabled',
                        message: 'Key based authentication is disabled for this resource.'
                    }
                }
            },
            'api-key'
        );

        expect(shouldRetry).toBe(true);
    });

    it('shouldRetryWithFallback returns true on managed identity tenant mismatch', () => {
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

        const shouldRetry = service.shouldRetryWithFallback(
            {
                details: {
                    error: {
                        code: 'Tenant provided in token does not match resource token',
                        message: 'Token tenant 72f988bf-86f1-41af-91ab-2d7cd011db47 does not match resource tenant.'
                    }
                }
            },
            'managed-identity'
        );

        expect(shouldRetry).toBe(true);
    });

    it('getTurnDetectionConfig includes semantic_vad eagerness and interrupt_response', () => {
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

        service.azureRealtimeSettings.serverVad = {
            enabled: true,
            type: 'semantic_vad',
            createResponse: true,
            interruptResponse: true,
            eagerness: 'low'
        };

        const config = service.getTurnDetectionConfig();
        expect(config.type).toBe('semantic_vad');
        expect(config.eagerness).toBe('low');
        expect(config.interrupt_response).toBe(true);
        expect(config.threshold).toBeUndefined();
    });

    it('getTurnDetectionConfig includes threshold settings for server_vad', () => {
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

        service.azureRealtimeSettings.serverVad = {
            enabled: true,
            type: 'server_vad',
            createResponse: true,
            threshold: 0.5,
            prefixPaddingMs: 300,
            silenceDurationMs: 500
        };

        const config = service.getTurnDetectionConfig();
        expect(config.type).toBe('server_vad');
        expect(config.threshold).toBe(0.5);
        expect(config.prefix_padding_ms).toBe(300);
        expect(config.silence_duration_ms).toBe(500);
    });
});
