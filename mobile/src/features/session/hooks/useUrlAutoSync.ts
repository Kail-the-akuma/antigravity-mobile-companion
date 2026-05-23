import { useEffect } from 'react';
import { ApiService } from '../../../services/api';

interface UseUrlAutoSyncProps {
  isConnected: boolean;
  hostUrl: string | null;
  setHostUrl: (url: string | null) => void;
  fallbackHostUrl: string | null;
  setFallbackHostUrl: (url: string | null) => void;
}

export const useUrlAutoSync = ({
  isConnected,
  hostUrl,
  setHostUrl,
  fallbackHostUrl,
  setFallbackHostUrl,
}: UseUrlAutoSyncProps) => {

  useEffect(() => {
    if (isConnected) {
      const syncUrls = async () => {
        const fetchWithTimeout = async (url: string, headers: Record<string, string> = {}, timeoutMs = 3000) => {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const res = await fetch(url, { headers, signal: controller.signal });
            clearTimeout(id);
            return res;
          } catch (e) {
            clearTimeout(id);
            throw e;
          }
        };

        try {
          let response: Response | null = null;
          
          if (hostUrl) {
            try {
              response = await fetchWithTimeout(`${hostUrl}/api/pairing/status`, {}, 3000);
            } catch (err) {
              console.log('[useUrlAutoSync] Local host status query failed during sync. Trying fallback...');
            }
          }
          
          if ((!response || !response.ok) && fallbackHostUrl) {
            try {
              response = await fetchWithTimeout(
                `${fallbackHostUrl}/api/pairing/status`, 
                { 'Bypass-Tunnel-Reminder': 'true' }, 
                4000
              );
            } catch (err) {
              console.log('[useUrlAutoSync] Fallback host status query failed during sync.');
            }
          }
          
          if (response && response.ok) {
            const data = await response.json();
            if (data) {
              // 1. Sync local LAN URL if IP or Port changed (DHCP lease renewal helper)
              if (data.ip && data.port) {
                const currentLocalUrl = await ApiService.getHostUrl();
                const newLocalUrl = `http://${data.ip}:${data.port}`;
                if (currentLocalUrl !== newLocalUrl) {
                  await ApiService.setHostUrl(newLocalUrl);
                  setHostUrl(newLocalUrl);
                  console.log('[useUrlAutoSync] Dynamically updated local LAN host URL:', newLocalUrl);
                }
              }
              
              // 2. Sync remote fallback tunnel URL if changed
              if (data.tunnelUrl) {
                const savedFallback = await ApiService.getFallbackHostUrl();
                if (savedFallback !== data.tunnelUrl) {
                  await ApiService.setFallbackHostUrl(data.tunnelUrl);
                  setFallbackHostUrl(data.tunnelUrl);
                  console.log('[useUrlAutoSync] Dynamically updated fallback tunnel URL:', data.tunnelUrl);
                }
              }
            }
          }
        } catch (err) {
          console.warn('[useUrlAutoSync] Bidirectional URL sync failed:', err);
        }
      };
      
      syncUrls();
    }
  }, [isConnected, hostUrl, fallbackHostUrl, setHostUrl, setFallbackHostUrl]);
};
