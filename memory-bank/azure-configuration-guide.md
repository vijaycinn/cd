# Azure OpenAI Configuration Guide

## Prerequisites

1. **Azure Subscription** - You need an active Azure subscription
2. **Azure OpenAI Resource** - Create an Azure OpenAI resource in the Azure portal
3. **Deployment** - Create a deployment of the GPT model you want to use (e.g., gpt-4, gpt-35-turbo)

## Required Configuration Parameters

### 1. Azure API Key
- Navigate to your Azure OpenAI resource in the Azure portal
- Go to "Keys and Endpoint" in the left sidebar
- Copy one of the two keys provided

### 2. Azure Endpoint
- This is the endpoint URL for your Azure OpenAI resource
- Format: `https://YOUR_RESOURCE_NAME.openai.azure.com`
- Found in the "Keys and Endpoint" section

### 3. Deployment Name
- The name you gave to your model deployment
- Default recommendation: `gpt-realtime` for real-time conversation use cases
- Found in the "Deployments" section of your Azure OpenAI resource

## Configuration Steps

1. Open the Sound Board application
2. Go to Advanced Settings (click the gear icon)
3. Select "Azure OpenAI" from the LLM Service dropdown
4. Enter your Azure API Key
5. Enter your Azure Endpoint URL
6. Enter your Deployment Name (or use default `gpt-realtime`)
7. Save the settings

## Troubleshooting

### Common Issues

1. **"Invalid API Key" Error**
   - Verify the API key is correct and active
   - Ensure you're using a key from the correct Azure OpenAI resource
   - Check that the resource is not disabled or deleted

2. **"Endpoint Not Found" Error**
   - Verify the endpoint URL format is correct
   - Ensure there are no extra spaces or characters
   - Confirm the Azure OpenAI resource exists and is active

3. **"Deployment Not Found" Error**
   - Verify the deployment name is correct
   - Check that the deployment exists in your Azure OpenAI resource
   - Ensure the deployment is in "Succeeded" status

### Network Issues

- Ensure your firewall allows outbound connections to Azure
- Check that your network connection is stable
- Verify Azure services are accessible from your location

## Best Practices

1. **Security**
   - Rotate API keys regularly
   - Use Azure Key Vault for key management in production
   - Never share API keys in plain text

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
