import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

function loadService(deployment = 'gpt-4.1') {
    vi.doMock('../config/azureRealtimeSettings.js', () => ({
        loadAzureRealtimeSettings: () => ({
            vision: {
                detailLevel: 'auto',
                maxTokens: 1000,
                systemPrompt: 'You are analyzing a screenshot.'
            }
        })
    }));

    const { AzureVisionService } = require('../utils/azureVision.js');
    return new AzureVisionService(
        null,
        'https://test.openai.azure.com',
        deployment,
        '',
        'interview',
        'en-US'
    );
}

describe('AzureVisionService token parameter compatibility', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('uses max_completion_tokens for GPT-5 deployments', async () => {
        const service = loadService('gpt-5-mini');
        const createMock = vi.fn(async () => ({
            choices: [{ message: { content: 'ok' } }]
        }));

        service.client = {
            chat: {
                completions: {
                    create: createMock
                }
            }
        };

        const response = await service.sendImage('data:image/jpeg;base64,ZmFrZQ==');

        expect(response).toBe('ok');
        expect(createMock).toHaveBeenCalledTimes(1);
        expect(createMock.mock.calls[0][0]).toMatchObject({
            max_completion_tokens: 1000
        });
        expect(createMock.mock.calls[0][0].max_tokens).toBeUndefined();
    });

    it('retries with max_completion_tokens when max_tokens is rejected', async () => {
        const service = loadService('gpt-chat-latest');
        const unsupportedParamError = new Error(
            "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."
        );
        unsupportedParamError.status = 400;
        unsupportedParamError.code = 'unsupported_parameter';
        unsupportedParamError.param = 'max_tokens';
        unsupportedParamError.error = {
            code: 'unsupported_parameter',
            param: 'max_tokens'
        };

        const createMock = vi
            .fn()
            .mockRejectedValueOnce(unsupportedParamError)
            .mockResolvedValueOnce({
                choices: [{ message: { content: 'retry-ok' } }]
            });

        service.client = {
            chat: {
                completions: {
                    create: createMock
                }
            }
        };

        const response = await service.sendText('hello world');

        expect(response).toBe('retry-ok');
        expect(createMock).toHaveBeenCalledTimes(2);
        expect(createMock.mock.calls[0][0]).toMatchObject({ max_tokens: 1000 });
        expect(createMock.mock.calls[1][0]).toMatchObject({ max_completion_tokens: 1000 });
    });

    it('keeps using max_completion_tokens after successful fallback', async () => {
        const service = loadService('gpt-chat-latest');
        const unsupportedParamError = new Error(
            "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."
        );
        unsupportedParamError.status = 400;
        unsupportedParamError.code = 'unsupported_parameter';
        unsupportedParamError.param = 'max_tokens';
        unsupportedParamError.error = {
            code: 'unsupported_parameter',
            param: 'max_tokens'
        };

        const createMock = vi
            .fn()
            .mockRejectedValueOnce(unsupportedParamError)
            .mockResolvedValueOnce({ choices: [{ message: { content: 'first' } }] })
            .mockResolvedValueOnce({ choices: [{ message: { content: 'second' } }] });

        service.client = {
            chat: {
                completions: {
                    create: createMock
                }
            }
        };

        await service.sendText('first request');
        await service.sendText('second request');

        expect(createMock).toHaveBeenCalledTimes(3);
        expect(createMock.mock.calls[2][0]).toMatchObject({ max_completion_tokens: 1000 });
    });
});
