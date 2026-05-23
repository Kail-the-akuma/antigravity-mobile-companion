import { CryptoService } from './crypto';
import * as SecureStore from 'expo-secure-store';

const HOST_STORAGE_KEY = 'antigravity_companion_host_url';
const FALLBACK_HOST_STORAGE_KEY = 'antigravity_companion_fallback_host_url';

let onUnauthorizedCallback: (() => void) | null = null;

const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs = 3500): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
};

export const ApiService = {
  setUnauthorizedCallback: (callback: () => void) => {
    onUnauthorizedCallback = callback;
  },

  setHostUrl: async (url: string): Promise<void> => {
    await SecureStore.setItemAsync(HOST_STORAGE_KEY, url);
  },

  getHostUrl: async (): Promise<string | null> => {
    return await SecureStore.getItemAsync(HOST_STORAGE_KEY);
  },

  clearHostUrl: async (): Promise<void> => {
    await SecureStore.deleteItemAsync(HOST_STORAGE_KEY);
    await SecureStore.deleteItemAsync(FALLBACK_HOST_STORAGE_KEY).catch(() => {});
  },

  setFallbackHostUrl: async (url: string): Promise<void> => {
    await SecureStore.setItemAsync(FALLBACK_HOST_STORAGE_KEY, url);
  },

  getFallbackHostUrl: async (): Promise<string | null> => {
    return await SecureStore.getItemAsync(FALLBACK_HOST_STORAGE_KEY);
  },

  clearFallbackHostUrl: async (): Promise<void> => {
    await SecureStore.deleteItemAsync(FALLBACK_HOST_STORAGE_KEY);
  },

  // Helper to make signed requests to the protected daemon API
  request: async (
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    bodyData?: any
  ): Promise<any> => {
    const hostUrl = await ApiService.getHostUrl();
    if (!hostUrl) {
      throw new Error('Device is not paired. Host URL not found.');
    }

    const identity = await CryptoService.getIdentity();
    if (!identity) {
      throw new Error('Device identity is missing. Please re-pair.');
    }

    const { deviceId, secretKey } = identity;
    let url = `${hostUrl}${endpoint}`;
    const payload = bodyData ? JSON.stringify(bodyData) : '';
    const timestamp = new Date().toISOString();
    const nonce = Math.random().toString(36).substring(2, 15);

    // Compute signature
    const signature = await CryptoService.signRequest(payload, timestamp, nonce, secretKey);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId,
      'X-Timestamp': timestamp,
      'X-Nonce': nonce,
      'X-Signature': signature,
    };

    let response: Response;
    try {
      // Try local URL first with timeout
      response = await fetchWithTimeout(url, {
        method,
        headers,
        body: bodyData ? payload : undefined,
      }, 3500);
    } catch (err) {
      // Fallback if local request fails (e.g. timeout or Network Request Failed)
      const fallbackHostUrl = await ApiService.getFallbackHostUrl();
      if (fallbackHostUrl) {
        console.log(`[ApiService] Local connection failed. Falling back to public tunnel: ${fallbackHostUrl}`);
        url = `${fallbackHostUrl}${endpoint}`;
        
        // Add bypass header for localtunnel
        headers['Bypass-Tunnel-Reminder'] = 'true';
        
        // No short timeout on remote tunnel since cellular network might be slower
        response = await fetch(url, {
          method,
          headers,
          body: bodyData ? payload : undefined,
        });
      } else {
        throw err;
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401 || errorText.includes('Device is not paired') || errorText.includes('authorized')) {
        if (onUnauthorizedCallback) {
          onUnauthorizedCallback();
        }
      }
      throw new Error(errorText || `Request failed with status ${response.status}`);
    }

    return response.status !== 204 ? await response.json() : null;
  },

  // ── Agents ──────────────────────────────────────────────────────────────
  getAgents: async (): Promise<any[]> => {
    const hostUrl = await ApiService.getHostUrl();
    if (!hostUrl) throw new Error('Not paired.');
    
    try {
      const response = await fetchWithTimeout(`${hostUrl}/api/agents`, {}, 3500);
      if (!response.ok) throw new Error('Failed to fetch agents.');
      return response.json();
    } catch (err) {
      const fallbackHostUrl = await ApiService.getFallbackHostUrl();
      if (fallbackHostUrl) {
        console.log(`[ApiService] getAgents local failed. Trying fallback tunnel: ${fallbackHostUrl}`);
        const response = await fetch(`${fallbackHostUrl}/api/agents`, {
          headers: { 'Bypass-Tunnel-Reminder': 'true' }
        });
        if (!response.ok) throw new Error('Failed to fetch agents.');
        return response.json();
      } else {
        throw err;
      }
    }
  },

  // ── Conversations ────────────────────────────────────────────────────────
  getConversations: async (): Promise<any[]> => {
    return ApiService.request('/api/conversations');
  },

  createConversation: async (agentId: string, title?: string): Promise<any> => {
    return ApiService.request('/api/conversations', 'POST', { agentId, title });
  },

  getMessages: async (conversationId: string): Promise<any[]> => {
    return ApiService.request(`/api/conversations/${conversationId}/messages`);
  },

  sendMessage: async (conversationId: string, content: string): Promise<any> => {
    return ApiService.request(`/api/conversations/${conversationId}/messages`, 'POST', { content });
  },

  deleteConversation: async (conversationId: string): Promise<any> => {
    return ApiService.request(`/api/conversations/${conversationId}`, 'DELETE');
  },

  togglePinConversation: async (conversationId: string): Promise<any> => {
    return ApiService.request(`/api/conversations/${conversationId}/pin`, 'PUT');
  },

  getDeletedConversations: async (): Promise<any[]> => {
    return ApiService.request('/api/conversations/deleted');
  },

  restoreConversation: async (conversationId: string): Promise<any> => {
    return ApiService.request(`/api/conversations/${conversationId}/restore`, 'PUT');
  },

  // ── Implementation Plan Reviewer ──────────────────────────────────────
  getImplementationPlan: async (conversationId: string): Promise<any> => {
    return ApiService.request(`/api/conversations/${conversationId}/implementation-plan`);
  },

  postPlanComment: async (conversationId: string, section: string, commentText: string): Promise<any> => {
    return ApiService.request(`/api/conversations/${conversationId}/implementation-plan/comments`, 'POST', { section, commentText });
  },

  registerPushToken: async (pushToken: string): Promise<any> => {
    const identity = await CryptoService.getIdentity();
    if (!identity) {
      throw new Error('Device identity is missing.');
    }
    return ApiService.request('/api/pairing/push-token', 'POST', {
      deviceId: identity.deviceId,
      pushToken,
    });
  },

  getModelsQuota: async (): Promise<any> => {
    return ApiService.request('/api/models/quota');
  },

  setCreditOverages: async (enableOverages: boolean): Promise<any> => {
    return ApiService.request('/api/models/overages', 'POST', { enableOverages });
  },
};
