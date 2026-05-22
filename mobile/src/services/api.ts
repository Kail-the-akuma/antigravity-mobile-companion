import { CryptoService } from './crypto';
import * as SecureStore from 'expo-secure-store';

const HOST_STORAGE_KEY = 'antigravity_companion_host_url';

let onUnauthorizedCallback: (() => void) | null = null;

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
    const url = `${hostUrl}${endpoint}`;
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

    const response = await fetch(url, {
      method,
      headers,
      body: bodyData ? payload : undefined,
    });

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
    const response = await fetch(`${hostUrl}/api/agents`);
    if (!response.ok) throw new Error('Failed to fetch agents.');
    return response.json();
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
};
