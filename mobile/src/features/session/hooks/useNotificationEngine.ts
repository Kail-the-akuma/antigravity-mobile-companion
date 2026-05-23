import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { ApiService } from '../../../services/api';
import { ApprovalRequest } from '../../../hooks/useSignalR';

type Screen = 'loading' | 'pairing' | 'agents' | 'conversations' | 'conversation' | 'deleted_conversations' | 'models';

interface UseNotificationEngineProps {
  hostUrl: string | null;
  fallbackHostUrl: string | null;
  setFallbackHostUrl: (url: string | null) => void;
  screen: Screen;
  selectedConversationId: string | null;
  setSelectedConversationId: (id: string | null) => void;
  setScreen: (s: Screen) => void;
  activeApproval: ApprovalRequest | null;
  setPendingApprovals: React.Dispatch<React.SetStateAction<Record<string, any>>>;
}

export const useNotificationEngine = ({
  hostUrl,
  fallbackHostUrl,
  setFallbackHostUrl,
  screen,
  selectedConversationId,
  setSelectedConversationId,
  setScreen,
  activeApproval,
  setPendingApprovals,
}: UseNotificationEngineProps) => {

  // 1. Register push notifications when hostUrl changes (paired)
  useEffect(() => {
    async function registerForPushNotificationsAsync() {
      try {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        
        if (finalStatus !== 'granted') {
          console.log('[useNotificationEngine] Notification permissions not granted.');
          return;
        }

        const tokenData = await Notifications.getExpoPushTokenAsync();
        const token = tokenData.data;
        console.log('[useNotificationEngine] Expo Push Token retrieved:', token);

        await ApiService.registerPushToken(token);
        console.log('[useNotificationEngine] Push token successfully registered with daemon backend.');
      } catch (err) {
        console.warn('[useNotificationEngine] Failed to register for push notifications:', err);
      }
    }

    if (hostUrl) {
      registerForPushNotificationsAsync();
    }
  }, [hostUrl]);

  // 2. Handle push notification interactions and foreground routing logic
  useEffect(() => {
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const data = response.notification.request.content.data as any;
      if (data) {
        if (data.type === 'TunnelUrlUpdate' && data.tunnelUrl) {
          console.log('[useNotificationEngine] Opened app via tunnel update notification:', data.tunnelUrl);
          await ApiService.setFallbackHostUrl(data.tunnelUrl);
          setFallbackHostUrl(data.tunnelUrl);
        } else if (data.conversationId) {
          console.log('[useNotificationEngine] Tapped push notification, navigating:', data.conversationId);
          setSelectedConversationId(data.conversationId as string);
          setScreen('conversation');
        }
      }
    });

    const receivedSubscription = Notifications.addNotificationReceivedListener(async (notification) => {
      const data = notification.request.content.data as any;
      if (data && data.type === 'TunnelUrlUpdate' && data.tunnelUrl) {
        console.log('[useNotificationEngine] Dynamic tunnel URL update captured:', data.tunnelUrl);
        await ApiService.setFallbackHostUrl(data.tunnelUrl);
        setFallbackHostUrl(data.tunnelUrl);
      }
    });

    Notifications.getLastNotificationResponseAsync().then(async (response) => {
      if (response) {
        const data = response.notification.request.content.data as any;
        if (data) {
          if (data.type === 'TunnelUrlUpdate' && data.tunnelUrl) {
            console.log('[useNotificationEngine] App launched via tunnel update notification:', data.tunnelUrl);
            await ApiService.setFallbackHostUrl(data.tunnelUrl);
            setFallbackHostUrl(data.tunnelUrl);
          } else if (data.conversationId) {
            console.log('[useNotificationEngine] App launched via push notification, navigating:', data.conversationId);
            setSelectedConversationId(data.conversationId as string);
            setScreen('conversation');
          }
        }
      }
    });

    return () => {
      responseSubscription.remove();
      receivedSubscription.remove();
    };
  }, [setFallbackHostUrl, setSelectedConversationId, setScreen]);

  // 3. Contextual approval listener (notifying on different screens)
  useEffect(() => {
    if (!activeApproval) return;

    const approvalConvId = activeApproval.conversationId;
    if (!approvalConvId) return;

    if (screen === 'conversation' && selectedConversationId?.toLowerCase() === approvalConvId.toLowerCase()) {
      console.log('[useNotificationEngine] Foreground SignalR: matching screen, approval modal will show.');
    } else {
      console.log('[useNotificationEngine] Foreground SignalR: different screen, scheduling local notification...');
      
      Notifications.scheduleNotificationAsync({
        content: {
          title: '⚡ Antigravity - Ação Requerida',
          body: 'O agente gerou um plano de alterações que necessita de revisão.',
          data: {
            conversationId: approvalConvId.toLowerCase(),
            approvalId: activeApproval.id,
          },
        },
        trigger: null,
      });

      setPendingApprovals(prev => ({
        ...prev,
        [approvalConvId.toLowerCase()]: activeApproval
      }));
    }
  }, [activeApproval, screen, selectedConversationId, setPendingApprovals]);
};
