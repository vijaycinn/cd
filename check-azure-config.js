// Run this in the browser DevTools console to check your current Azure settings
console.log('=== Current Azure OpenAI Configuration ===');
console.log('API Key:', localStorage.getItem('azureApiKey') ? '***SET***' : 'NOT SET');
console.log('Endpoint:', localStorage.getItem('azureEndpoint'));
console.log('Deployment:', localStorage.getItem('azureDeployment'));
console.log('Region:', localStorage.getItem('azureRegion'));
console.log('==========================================');

// To update settings (replace values as needed):
// localStorage.setItem('azureApiKey', 'YOUR_API_KEY_HERE');
// localStorage.setItem('azureEndpoint', 'https://your-resource.openai.azure.com/');
// localStorage.setItem('azureDeployment', 'gpt-realtime-mini');
// localStorage.setItem('azureRegion', 'eastus2');
