# Azure OpenAI Configuration Guide

## Prerequisites

1. **Azure Subscription** - You need an active Azure subscription
2. **Azure OpenAI Resource** - Create an Azure OpenAI resource in the Azure portal
3. **Deployment** - Create a deployment of the GPT model you want to use (e.g., gpt-4, gpt-35-turbo)
4. **Entra login** - Run `az login` in the same tenant as the Azure AI resource

## Required Configuration Parameters

### 1. Azure Endpoint
- This is the endpoint URL for your Azure OpenAI resource
- Format: `https://YOUR_RESOURCE_NAME.services.ai.azure.com` (Foundry resource) or `https://YOUR_RESOURCE_NAME.openai.azure.com`
- Found in the "Keys and Endpoint" section

### 2. Deployment Name
- The name you gave to your model deployment
- Default recommendation: `gpt-realtime` for real-time conversation use cases
- Found in the "Deployments" section of your Azure OpenAI resource

## Configuration Steps

1. Open the Sound Board application
2. Go to Advanced Settings (click the gear icon)
3. Select "Azure OpenAI" from the LLM Service dropdown
4. Enter your Azure Endpoint URL
5. Enter your Voice Deployment Name (or use default `gpt-realtime`)
6. Save the settings
7. Authenticate with `az login` (same tenant as the resource)

## Voice / VAD Recommendations (Interview or Sales Calls)

Based on Microsoft Learn realtime and Voice Live guidance:

- Prefer `semantic_vad` for natural conversation flow (less interruption while speaking).
- Use `eagerness: low` for interview/sales scenarios to allow brief pauses.
- Keep `create_response: true` for hands-free conversational turn-taking.
- Keep `interrupt_response: true` for barge-in behavior when the speaker resumes talking.
- If switching to `server_vad`, start from:
  - `threshold: 0.5`
  - `prefix_padding_ms: 300`
  - `silence_duration_ms: 500` (safer for natural pauses)

## Troubleshooting

### Common Issues

1. **"Endpoint Not Found" Error**
   - Verify the endpoint URL format is correct
   - Ensure there are no extra spaces or characters
   - Confirm the Azure OpenAI resource exists and is active

2. **"Deployment Not Found" Error**
   - Verify the deployment name is correct
   - Check that the deployment exists in your Azure OpenAI resource
   - Ensure the deployment is in "Succeeded" status

3. **"Tenant provided in token does not match resource tenant" Error**
   - This means an Entra ID token was issued for a different tenant than your Azure OpenAI resource
   - Run `az account show` and confirm tenant/subscription
   - Re-run `az login` with the tenant that owns the resource

4. **"AuthenticationTypeDisabled" Error**
   - This means key-based auth is disabled on that Azure resource
   - This app now uses managed identity/Entra auth by default for realtime

### Network Issues

- Ensure your firewall allows outbound connections to Azure
- Check that your network connection is stable
- Verify Azure services are accessible from your location

## Best Practices

1. **Security**
   - Use Entra ID / managed identity for authentication
   - Assign least-privilege roles (`Cognitive Services User`, `Azure AI User`)
   - Avoid storing secrets in local config

2. **Performance**
   - Use appropriate deployment sizes for your workload
   - Monitor token usage to avoid rate limits
   - Consider using multiple deployments for different use cases

3. **Cost Management**
   - Monitor usage through Azure portal
   - Set up budget alerts
   - Use appropriate models for your use case (smaller models for simpler tasks)

## Supported Features

### Currently Supported
- Text-based conversations
- Real-time response streaming
- Multiple deployment configurations

### Coming Soon
- Audio input processing
- Image analysis capabilities
- Advanced conversation features

## Support

For issues with Azure OpenAI integration, please check:
1. Azure OpenAI service status
2. Your resource quotas and limits
3. Network connectivity to Azure services
