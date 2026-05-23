import { useEffect } from 'react';
import { Alert } from 'react-native';
import * as Notifications from 'expo-notifications';
import { ApiService } from '../../../services/api';
import { CryptoService } from '../../../services/crypto';
import { sqliteService } from '../../../services/sqlite';

type Screen = 'loading' | 'pairing' | 'agents' | 'conversations' | 'conversation' | 'deleted_conversations' | 'models';

interface UsePairingStateProps {
  setScreen: (s: Screen) => void;
  setHostUrl: (url: string | null) => void;
  setFallbackHostUrl: (url: string | null) => void;
  setSelectedAgent: (agent: any) => void;
  setSelectedConversationId: (id: string | null) => void;
}

export const usePairingState = ({
  setScreen,
  setHostUrl,
  setFallbackHostUrl,
  setSelectedAgent,
  setSelectedConversationId,
}: UsePairingStateProps) => {
  
  const handleUnpair = async () => {
    try {
      await ApiService.clearHostUrl();
      await CryptoService.clearIdentity();
    } catch (e) {
      console.error('[usePairingState] Error clearing pairing state:', e);
    }
    setHostUrl(null);
    setFallbackHostUrl(null);
    setSelectedAgent(null);
    setSelectedConversationId(null);
    setScreen('pairing');
  };

  useEffect(() => {
    // Set 401 callback to unpair device reactively
    ApiService.setUnauthorizedCallback(() => {
      Alert.alert(
        'Sessão Expirada',
        'O dispositivo foi desautorizado ou o servidor foi reiniciado. Por favor, emparelhe novamente.',
        [{ text: 'OK', onPress: handleUnpair }]
      );
    });

    const checkPairingStatus = async () => {
      let resolved = false;

      // Safety timeout: if SecureStore takes longer than 1500ms, fallback to pairing screen
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          console.warn('[usePairingState] SecureStore query timed out. Defaulting to pairing screen.');
          resolved = true;
          setScreen('pairing');
        }
      }, 1500);

      try {
        // Inicializa o banco de dados SQLite local
        await sqliteService.initialize().catch(err => {
          console.error('[usePairingState] Erro ao inicializar SQLite local:', err);
        });

        // Read presented notifications on app boot to catch background TunnelUrlUpdate
        let foundTunnelUrl: string | null = null;
        try {
          const presented = await Notifications.getPresentedNotificationsAsync().catch(() => []);
          for (const notification of presented) {
            const data = notification.request.content.data as any;
            if (data && data.type === 'TunnelUrlUpdate' && data.tunnelUrl) {
              console.log('[usePairingState] Found active TunnelUrlUpdate on boot:', data.tunnelUrl);
              foundTunnelUrl = data.tunnelUrl;
              break;
            }
          }
        } catch (notifErr) {
          console.warn('[usePairingState] Error reading presented notifications:', notifErr);
        }

        const url = await ApiService.getHostUrl();
        let fallbackUrl = await ApiService.getFallbackHostUrl();

        if (foundTunnelUrl && foundTunnelUrl !== fallbackUrl) {
          await ApiService.setFallbackHostUrl(foundTunnelUrl);
          fallbackUrl = foundTunnelUrl;
        }

        const identity = await CryptoService.getIdentity();

        if (!resolved) {
          clearTimeout(timeoutId);
          resolved = true;
          if (url && identity) {
            setHostUrl(url);
            setFallbackHostUrl(fallbackUrl);
            setScreen('agents');
          } else {
            setScreen('pairing');
          }
        }
      } catch (err) {
        console.error('[usePairingState] Error loading initial pairing state:', err);
        if (!resolved) {
          clearTimeout(timeoutId);
          resolved = true;
          setScreen('pairing');
        }
      }
    };

    checkPairingStatus();
  }, []);

  return {
    handleUnpair,
  };
};
