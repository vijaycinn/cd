// src/utils/azureAuth.js
// Main-process-only Azure credential helper.
//
// Uses DefaultAzureCredential which automatically resolves identity from:
//   1. Azure Developer CLI  — run: azd login
//   2. Azure CLI            — run: az login
//   3. Environment vars     — AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID
//   4. Managed Identity     — when running inside an Azure-hosted environment
//
// IMPORTANT: This module must only be required from the Electron main process.
// Never send raw tokens to the renderer process.

const { DefaultAzureCredential } = require('@azure/identity');

const COGNITIVE_SERVICES_SCOPE = 'https://cognitiveservices.azure.com/.default';

// Singleton credential instance — token caching and refresh are managed internally
// by the Azure Identity library; do not create multiple instances.
let _credential = null;

function getCredential() {
    if (!_credential) {
        _credential = new DefaultAzureCredential();
    }
    return _credential;
}

/**
 * Get a fresh (or cache-hit) AAD bearer token for the given scope.
 * The credential library handles expiry and transparent refresh.
 *
 * @param {string} [scope]
 * @returns {Promise<import('@azure/identity').AccessToken>}
 */
async function getToken(scope = COGNITIVE_SERVICES_SCOPE) {
    const token = await getCredential().getToken(scope);
    if (!token || !token.token) {
        throw new Error('DefaultAzureCredential returned an empty token');
    }
    return token;
}

/**
 * Probe whether a credential can be resolved (without throwing to the caller).
 *
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function checkAuth() {
    try {
        await getToken();
        return { ok: true };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}

module.exports = { getToken, checkAuth, COGNITIVE_SERVICES_SCOPE };
