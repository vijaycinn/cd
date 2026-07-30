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
const { loadAzureRealtimeSettings } = require('../config/azureRealtimeSettings.js');

const COGNITIVE_SERVICES_SCOPE = 'https://cognitiveservices.azure.com/.default';
const FOUNDRY_SCOPE = 'https://ai.azure.com/.default';

let _defaultTenantId;

/**
 * Tenant every credential targets unless a caller overrides it.
 * Settings win over the env var so the app can point at a resource in another tenant
 * without changing the machine-wide az login.
 *
 * @returns {string|null}
 */
function getDefaultTenantId() {
    if (_defaultTenantId === undefined) {
        let configured = '';
        try {
            configured = (loadAzureRealtimeSettings().auth?.tenantId || '').trim();
        } catch {
            configured = '';
        }
        _defaultTenantId = configured || (process.env.AZURE_TENANT_ID || '').trim() || null;
    }
    return _defaultTenantId;
}

// One credential per tenant; the identity library handles expiry and refresh internally.
const _credentials = new Map();

function getCredential(tenantId) {
    const key = tenantId || '__default__';
    if (!_credentials.has(key)) {
        // additionallyAllowedTenants is required for the CLI credential to mint a token
        // for a tenant other than the one it is currently logged into.
        const options = tenantId
            ? { tenantId, additionallyAllowedTenants: [tenantId] }
            : {};
        _credentials.set(key, new DefaultAzureCredential(options));
    }
    return _credentials.get(key);
}

/**
 * Extract non-sensitive claims for diagnostics. Never returns or logs the token itself.
 *
 * @param {string} token
 * @returns {{ tid: string|null, aud: string|null }|null}
 */
function describeToken(token) {
    try {
        const payload = String(token).split('.')[1];
        if (!payload) {
            return null;
        }
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const claims = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
        return { tid: claims.tid || null, aud: claims.aud || null };
    } catch {
        return null;
    }
}

/**
 * Get a fresh (or cache-hit) AAD bearer token for the given scope.
 * The credential library handles expiry and transparent refresh.
 *
 * @param {string} [scope]
 * @param {string} [tenantId] Target tenant; omit to use the configured default.
 * @returns {Promise<import('@azure/identity').AccessToken>}
 */
async function getToken(scope = COGNITIVE_SERVICES_SCOPE, tenantId = undefined) {
    const targetTenant = tenantId === undefined ? getDefaultTenantId() : tenantId;
    const token = await getCredential(targetTenant).getToken(scope);
    if (!token || !token.token) {
        throw new Error('DefaultAzureCredential returned an empty token');
    }
    return token;
}

/**
 * Probe whether a credential can be resolved (without throwing to the caller).
 *
 * @param {string} [tenantId]
 * @returns {Promise<{ ok: boolean, reason?: string, tid?: string|null }>}
 */
async function checkAuth(tenantId = undefined) {
    try {
        const token = await getToken(COGNITIVE_SERVICES_SCOPE, tenantId);
        return { ok: true, tid: describeToken(token.token)?.tid ?? null };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}

module.exports = {
    getToken,
    checkAuth,
    describeToken,
    getDefaultTenantId,
    COGNITIVE_SERVICES_SCOPE,
    FOUNDRY_SCOPE
};
