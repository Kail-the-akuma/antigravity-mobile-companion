import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  ActivityIndicator,
  Modal,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  TextInput,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from './src/theme/colors';
import { PairingScreen } from './src/screens/PairingScreen';
import { AgentListScreen } from './src/screens/AgentListScreen';
import { ConversationListScreen } from './src/screens/ConversationListScreen';
import { ConversationScreen } from './src/screens/ConversationScreen';
import { DeletedConversationsScreen } from './src/screens/DeletedConversationsScreen';
import { ModelsScreen } from './src/screens/ModelsScreen';
import { ApiService } from './src/services/api';
import { CryptoService } from './src/services/crypto';
import { useSignalR } from './src/hooks/useSignalR';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Updates from 'expo-updates';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

interface Agent {
  id: string;
  name: string;
  description: string;
  iconEmoji: string;
  isOnline: boolean;
  capabilities: string;
  lastPing: string;
}

type Screen = 'loading' | 'pairing' | 'agents' | 'conversations' | 'conversation' | 'deleted_conversations' | 'models';

function AppContent() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [hostUrl, setHostUrl] = useState<string | null>(null);
  const [fallbackHostUrl, setFallbackHostUrl] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [processingApproval, setProcessingApproval] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, any>>({});
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [isEditingTunnel, setIsEditingTunnel] = useState(false);
  const [tempTunnelUrl, setTempTunnelUrl] = useState('');

  const handleSaveTunnelUrl = async () => {
    const cleanUrl = tempTunnelUrl.trim();
    if (cleanUrl) {
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        Alert.alert('Erro de Validação', 'O URL do túnel tem de começar com http:// ou https://');
        return;
      }
    }
    
    try {
      if (cleanUrl) {
        await ApiService.setFallbackHostUrl(cleanUrl);
        setFallbackHostUrl(cleanUrl);
      } else {
        await ApiService.clearFallbackHostUrl();
        setFallbackHostUrl(null);
      }
      setIsEditingTunnel(false);
      Alert.alert('Sucesso', 'Túnel remoto atualizado!');
    } catch (err: any) {
      Alert.alert('Erro', 'Não foi possível guardar o túnel: ' + err.message);
    }
  };

  // Initialize global SignalR Hub connection if device is paired
  const hubUrl = hostUrl ? `${hostUrl}/hubs/companion` : null;
  const fallbackHubUrl = fallbackHostUrl ? `${fallbackHostUrl}/hubs/companion` : null;
  const { 
    isConnected, 
    activeApproval, 
    setActiveApproval,
    incomingMessage,
    activeExecutionState,
    agentStatusUpdate
  } = useSignalR(hubUrl, fallbackHubUrl);

  // Bidirectional self-healing sync of connection URLs (both LAN IP and Remote Tunnel)
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
              console.log('[App] Local host status query failed during sync. Trying fallback...');
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
              console.log('[App] Fallback host status query failed during sync.');
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
                  console.log('[App] Dynamically updated local LAN host URL:', newLocalUrl);
                }
              }
              
              // 2. Sync remote fallback tunnel URL if changed
              if (data.tunnelUrl) {
                const savedFallback = await ApiService.getFallbackHostUrl();
                if (savedFallback !== data.tunnelUrl) {
                  await ApiService.setFallbackHostUrl(data.tunnelUrl);
                  setFallbackHostUrl(data.tunnelUrl);
                  console.log('[App] Dynamically updated fallback tunnel URL:', data.tunnelUrl);
                }
              }
            }
          }
        } catch (err) {
          console.warn('[App] Bidirectional URL sync failed:', err);
        }
      };
      
      syncUrls();
    }
  }, [isConnected, hostUrl, fallbackHostUrl]);

  // EAS Over-The-Air Automatic Updates Hook
  useEffect(() => {
    async function checkAndApplyUpdates() {
      if (__DEV__) {
        console.log('Skipping OTA updates check in development mode.');
        return;
      }
      if (!Updates.isEnabled) {
        console.log('EAS Updates service is not enabled in this build. Skipping check.');
        return;
      }
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          console.log('New EAS update available. Fetching update...');
          await Updates.fetchUpdateAsync();
          Alert.alert(
            '⚡ Antigravity Atualizada',
            'Uma nova versão do Companion foi descarregada com sucesso. Pretendes aplicar as alterações agora?',
            [
              {
                text: 'Recarregar Agora',
                onPress: async () => {
                  await Updates.reloadAsync();
                },
              },
            ],
            { cancelable: false }
          );
        }
      } catch (err) {
        console.log('Error checking for EAS Updates:', err);
      }
    }

    checkAndApplyUpdates();
  }, []);

  // Register push notifications
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
          console.log('Notification permissions not granted.');
          return;
        }

        const tokenData = await Notifications.getExpoPushTokenAsync();
        const token = tokenData.data;
        console.log('Expo Push Token retrieved:', token);

        await ApiService.registerPushToken(token);
        console.log('Push token successfully registered with daemon backend.');
      } catch (err) {
        console.warn('Failed to register for push notifications:', err);
      }
    }

    if (hostUrl) {
      registerForPushNotificationsAsync();
    }
  }, [hostUrl]);

  // Handle push notification interactions and foreground routing logic
  useEffect(() => {
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const data = response.notification.request.content.data as any;
      if (data) {
        if (data.type === 'TunnelUrlUpdate' && data.tunnelUrl) {
          console.log('[Notification Response] User opened app via tunnel update notification:', data.tunnelUrl);
          await ApiService.setFallbackHostUrl(data.tunnelUrl);
          setFallbackHostUrl(data.tunnelUrl);
        } else if (data.conversationId) {
          console.log('User tapped push notification, navigating to conversation:', data.conversationId);
          setSelectedConversationId(data.conversationId as string);
          setScreen('conversation');
        }
      }
    });

    const receivedSubscription = Notifications.addNotificationReceivedListener(async (notification) => {
      const data = notification.request.content.data as any;
      if (data && data.type === 'TunnelUrlUpdate' && data.tunnelUrl) {
        console.log('[Push Notification Received] Dynamic tunnel URL update captured in real-time:', data.tunnelUrl);
        await ApiService.setFallbackHostUrl(data.tunnelUrl);
        setFallbackHostUrl(data.tunnelUrl);
      }
    });

    Notifications.getLastNotificationResponseAsync().then(async (response) => {
      if (response) {
        const data = response.notification.request.content.data as any;
        if (data) {
          if (data.type === 'TunnelUrlUpdate' && data.tunnelUrl) {
            console.log('[App Boot] App launched via tunnel update notification:', data.tunnelUrl);
            await ApiService.setFallbackHostUrl(data.tunnelUrl);
            setFallbackHostUrl(data.tunnelUrl);
          } else if (data.conversationId) {
            console.log('App launched via push notification, navigating:', data.conversationId);
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
  }, []);

  // Contextual approval listener
  useEffect(() => {
    if (!activeApproval) return;

    const approvalConvId = activeApproval.conversationId;
    if (!approvalConvId) return;

    if (screen === 'conversation' && selectedConversationId?.toLowerCase() === approvalConvId.toLowerCase()) {
      console.log('Foreground SignalR: matching screen, modal will show automatically.');
    } else {
      console.log('Foreground SignalR: different screen, scheduling local notification and marking list card.');
      
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
  }, [activeApproval, screen, selectedConversationId]);

  const handleApprovalResponse = async (status: 'Approved' | 'Rejected') => {
    if (!activeApproval) return;

    setProcessingApproval(true);
    try {
      // 1. Biometrics verification
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (hasHardware && isEnrolled) {
        const authResult = await LocalAuthentication.authenticateAsync({
          promptMessage: `Verifique a sua identidade para ${status === 'Approved' ? 'APROVAR' : 'REJEITAR'} este plano de execução.`,
          fallbackLabel: 'Usar Código de Acesso',
          disableDeviceFallback: false,
        });

        if (!authResult.success) {
          Alert.alert('Autenticação Negada', 'Não foi possível verificar a sua identidade. Operação cancelada.');
          setProcessingApproval(false);
          return;
        }
      }

      // 2. Cryptographic signature
      const identity = await CryptoService.getIdentity();
      if (!identity) {
        throw new Error('Identidade do dispositivo não encontrada.');
      }

      const timestamp = new Date().toISOString();
      const nonce = Math.random().toString(36).substring(2, 15);
      const approvalMsg = `approval:${activeApproval.id}:${status}`;
      
      const approvalSignature = await CryptoService.signRequest(
        approvalMsg,
        timestamp,
        nonce,
        identity.secretKey
      );

      // 3. Post signed answer back to the Daemon
      await ApiService.request(`/api/approvals/${activeApproval.id}/respond`, 'POST', {
        status,
        signature: approvalSignature,
      });

      // Clear from pending approvals map
      if (activeApproval.conversationId) {
        setPendingApprovals(prev => {
          const updated = { ...prev };
          delete updated[activeApproval.conversationId!.toLowerCase()];
          return updated;
        });
      }

      setActiveApproval(null);
      Alert.alert(
        status === 'Approved' ? 'Aprovado' : 'Rejeitado',
        `O plano de execução foi ${status === 'Approved' ? 'aprovado' : 'rejeitado'} com sucesso!`
      );
    } catch (err: any) {
      console.error('Error processing approval response:', err);
      Alert.alert('Erro', err.message || 'Erro ao submeter resposta de aprovação.');
    } finally {
      setProcessingApproval(false);
    }
  };

  useEffect(() => {
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
          console.warn('Pairing status check timed out after 1500ms. Defaulting to pairing screen.');
          resolved = true;
          setScreen('pairing');
        }
      }, 1500);

      try {
        // Issue 2 Fix: Check presented notifications on app boot to catch background TunnelUrlUpdate
        // without requiring the user to tap on the notification.
        let foundTunnelUrl: string | null = null;
        try {
          const presented = await Notifications.getPresentedNotificationsAsync().catch(() => []);
          for (const notification of presented) {
            const data = notification.request.content.data as any;
            if (data && data.type === 'TunnelUrlUpdate' && data.tunnelUrl) {
              console.log('[App Boot] Found active TunnelUrlUpdate in presented notifications:', data.tunnelUrl);
              foundTunnelUrl = data.tunnelUrl;
              break;
            }
          }
        } catch (notifErr) {
          console.warn('Error reading presented notifications on boot:', notifErr);
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
        console.error('Error loading initial pairing state:', err);
        if (!resolved) {
          clearTimeout(timeoutId);
          resolved = true;
          setScreen('pairing');
        }
      }
    };

    checkPairingStatus();
  }, []);

  const handlePairSuccess = async () => {
    const url = await ApiService.getHostUrl();
    const fallbackUrl = await ApiService.getFallbackHostUrl();
    setHostUrl(url);
    setFallbackHostUrl(fallbackUrl);
    setScreen('agents');
  };

  const handleSelectAgent = (agent: Agent) => {
    setSelectedAgent(agent);
    setScreen('conversations');
  };

  const handleSelectConversation = (conversationId: string) => {
    setSelectedConversationId(conversationId);
    setScreen('conversation');
  };

  const handleNewConversation = () => {
    setSelectedConversationId(null);
    setScreen('conversation');
  };

  const handleUnpair = async () => {
    try {
      await ApiService.clearHostUrl();
      await CryptoService.clearIdentity();
    } catch (e) {
      console.error('Error clearing pairing state:', e);
    }
    setHostUrl(null);
    setFallbackHostUrl(null);
    setSelectedAgent(null);
    setSelectedConversationId(null);
    setScreen('pairing');
  };

  const handleBackToAgents = () => {
    setSelectedAgent(null);
    setScreen('agents');
  };

  const handleBackToConversations = () => {
    setSelectedConversationId(null);
    setScreen('conversations');
  };

  if (screen === 'loading') {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} style={{ marginBottom: 16 }} />
        <Text style={styles.loadingText}>A inicializar o Antigravity Companion...</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {screen !== 'pairing' && (
        <SafeAreaView style={isConnected ? styles.safeConnected : styles.safeDisconnected}>
          <View style={styles.statusBarRow}>
            <View style={styles.statusIndicator}>
              <View style={[styles.statusDot, isConnected ? styles.dotConnected : styles.dotDisconnected]} />
              <Text style={styles.statusText}>
                {isConnected ? 'Ligado ao Daemon' : 'A ligar ao Daemon...'}
              </Text>
            </View>
            <TouchableOpacity style={styles.settingsIconBtn} onPress={() => setShowSettingsModal(true)} activeOpacity={0.7}>
              <View style={styles.slidersIcon}>
                <View style={styles.sliderLine}>
                  <View style={[styles.sliderNode, { top: 1 }]} />
                </View>
                <View style={styles.sliderLine}>
                  <View style={[styles.sliderNode, { top: 9 }]} />
                </View>
                <View style={styles.sliderLine}>
                  <View style={[styles.sliderNode, { top: 5 }]} />
                </View>
              </View>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

      {screen === 'pairing' && (
        <PairingScreen onPairSuccess={handlePairSuccess} />
      )}
      {screen === 'agents' && hostUrl && (
        <AgentListScreen
          hostUrl={hostUrl}
          onSelectAgent={handleSelectAgent}
          onUnpair={handleUnpair}
          isConnected={isConnected}
          agentStatusUpdate={agentStatusUpdate}
        />
      )}
      {screen === 'conversations' && selectedAgent && (
        <ConversationListScreen
          agent={selectedAgent}
          onSelectConversation={handleSelectConversation}
          onNewConversation={handleNewConversation}
          onBack={handleBackToAgents}
          onOpenDeletedConversations={() => setScreen('deleted_conversations')}
          pendingApprovals={pendingApprovals}
        />
      )}
      {screen === 'deleted_conversations' && selectedAgent && (
        <DeletedConversationsScreen
          agent={selectedAgent}
          onBack={() => setScreen('conversations')}
        />
      )}
      {screen === 'conversation' && hostUrl && selectedAgent && (
        <ConversationScreen
          agent={selectedAgent}
          conversationId={selectedConversationId}
          hostUrl={hostUrl}
          onBack={handleBackToConversations}
          isConnected={isConnected}
          incomingMessage={incomingMessage}
          activeExecutionState={activeExecutionState}
          activeApproval={activeApproval}
          setActiveApproval={setActiveApproval}
        />
      )}
      {screen === 'models' && (
        <ModelsScreen onBack={() => setScreen('agents')} />
      )}

      {/* Cryptographically Protected Global Approval Modal Overlay */}
      {activeApproval && screen === 'conversation' && selectedConversationId?.toLowerCase() === activeApproval.conversationId?.toLowerCase() && (
        <Modal transparent animationType="slide" visible={!!activeApproval}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Revisão de Plano Necessária</Text>
                <Text style={styles.modalSubtitle}>Identidade Criptográfica Verificada</Text>
              </View>

              <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                <Text style={styles.modalDescription}>
                  O Agente Antigravity gerou um plano de alteração e requer a sua aprovação explícita antes de avançar com o código:
                </Text>

                <View style={planCardStyle}>
                  <Text style={styles.planLabel}>Detalhes do Plano / Passos:</Text>
                  <Text style={styles.planStepsText}>
                    {activeApproval.planStepsJson || 'Nenhum detalhe adicional fornecido.'}
                  </Text>
                </View>

                <View style={styles.securityAlert}>
                  <Text style={styles.securityAlertTitle}>🔒 Segurança Biométrica Ativa</Text>
                  <Text style={styles.securityAlertText}>
                    A sua confirmação irá gerar uma assinatura digital única vinculada à chave simétrica deste dispositivo móvel.
                  </Text>
                </View>
              </ScrollView>

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.rejectButton]}
                  onPress={() => handleApprovalResponse('Rejected')}
                  disabled={processingApproval}
                  activeOpacity={0.8}
                >
                  <Text style={styles.modalButtonText}>Rejeitar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalButton, styles.approveButton]}
                  onPress={() => handleApprovalResponse('Approved')}
                  disabled={processingApproval}
                  activeOpacity={0.8}
                >
                  {processingApproval ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.modalButtonText}>Aprovar</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
      {/* ⚙️ SETTINGS CONFIGURATIONS MODAL OVERLAY */}
      <Modal transparent animationType="fade" visible={showSettingsModal} onRequestClose={() => setShowSettingsModal(false)}>
        <View style={styles.settingsOverlay}>
          <View style={styles.settingsContent}>
            <Text style={styles.settingsTitle}>Configurações</Text>

            {/* Connection Information */}
            <View style={styles.settingsSection}>
              <Text style={styles.settingsLabel}>Ligação Local (LAN)</Text>
              <Text style={styles.settingsValue}>{hostUrl || 'Não configurado'}</Text>
            </View>

            <View style={styles.settingsSection}>
              <Text style={styles.settingsLabel}>Ligação Remota (Túnel)</Text>
              {isEditingTunnel ? (
                <View style={styles.inlineEditRow}>
                  <TextInput
                    style={styles.settingsInput}
                    value={tempTunnelUrl}
                    onChangeText={setTempTunnelUrl}
                    placeholder="https://xxx.loca.lt"
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                  />
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSaveTunnelUrl}>
                    <Text style={styles.saveBtnText}>OK</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsEditingTunnel(false)}>
                    <Text style={styles.cancelBtnText}>X</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.inlineDisplayRow}>
                  <Text style={[styles.settingsValue, { flex: 1, marginRight: 8 }]} numberOfLines={1} ellipsizeMode="middle">
                    {fallbackHostUrl || 'Nenhum túnel ativo'}
                  </Text>
                  <TouchableOpacity style={styles.editBtn} onPress={() => {
                    setTempTunnelUrl(fallbackHostUrl || '');
                    setIsEditingTunnel(true);
                  }}>
                    <Text style={styles.editBtnText}>Editar</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Manual OTA Updates Check */}
            <View style={styles.settingsSection}>
              <Text style={styles.settingsLabel}>Versão da Aplicação</Text>
              <Text style={styles.settingsValue}>v1.0.0 (EAS Preview)</Text>
              
              <TouchableOpacity 
                style={styles.updateBtn} 
                onPress={async () => {
                  setCheckingUpdates(true);
                  if (__DEV__) {
                    Alert.alert(
                      'Modo de Desenvolvimento',
                      'As atualizações automáticas OTA não estão disponíveis em modo de desenvolvimento (Metro).'
                    );
                    setCheckingUpdates(false);
                    return;
                  }
                  if (!Updates.isEnabled) {
                    Alert.alert(
                      'Atualizações Desativadas',
                      'O serviço de atualizações (expo-updates) não está ativo nesta build. Garanta que a app foi compilada com suporte a updates no app.json.'
                    );
                    setCheckingUpdates(false);
                    return;
                  }
                  try {
                    const update = await Updates.checkForUpdateAsync();
                    if (update.isAvailable) {
                      await Updates.fetchUpdateAsync();
                      Alert.alert(
                        '⚡ Antigravity Atualizada',
                        'Uma nova versão do Companion foi descarregada. Pretendes recarregar agora para aplicar?',
                        [
                          { text: 'Recarregar Agora', onPress: async () => {
                            await Updates.reloadAsync();
                          }},
                          { text: 'Mais tarde', style: 'cancel' }
                        ]
                      );
                    } else {
                      Alert.alert('Estar Atualizado', 'Já estás a correr a versão mais recente do Companion!');
                    }
                  } catch (err: any) {
                    Alert.alert('Falha no Update', 'Não foi possível verificar atualizações. Garante que estás ligado à Internet:\n' + err.message);
                  } finally {
                    setCheckingUpdates(false);
                  }
                }}
                disabled={checkingUpdates}
              >
                {checkingUpdates ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.updateBtnText}>Procurar Atualizações</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Models & Quotas Navigation Row */}
            <TouchableOpacity 
              style={styles.modelsBtn} 
              onPress={() => {
                setShowSettingsModal(false);
                setScreen('models');
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.modelsBtnText}>Gerir Modelos & Quotas ⚡</Text>
            </TouchableOpacity>
 
            {/* Unpair Device Section */}
            <TouchableOpacity 
              style={styles.dangerBtn} 
              onPress={async () => {
                Alert.alert(
                  'Desemparelhar Dispositivo',
                  'Tem a certeza que deseja remover este emparelhamento criptográfico?',
                  [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Desemparelhar', style: 'destructive', onPress: async () => {
                      setShowSettingsModal(false);
                      await handleUnpair();
                    }}
                  ]
                );
              }}
            >
              <Text style={styles.dangerBtnText}>Desemparelhar</Text>
            </TouchableOpacity>

            {/* Close Settings Button */}
            <TouchableOpacity style={styles.closeBtn} onPress={() => setShowSettingsModal(false)}>
              <Text style={styles.closeBtnText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}

// Extracted styles to avoid rendering conflict
const planCardStyle = {
  backgroundColor: Colors.surfaceLight,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: Colors.border,
  padding: 16,
  marginBottom: 16,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 15, 17, 0.95)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: '90%',
  },
  modalHeader: {
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.text,
  },
  modalSubtitle: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '700',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  modalBody: {
    padding: 20,
  },
  modalDescription: {
    fontSize: 14,
    color: Colors.textMuted,
    lineHeight: 20,
    marginBottom: 16,
  },
  planLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  planStepsText: {
    fontSize: 14,
    color: Colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    lineHeight: 18,
  },
  securityAlert: {
    backgroundColor: 'rgba(94, 92, 230, 0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(94, 92, 230, 0.2)',
    padding: 12,
    marginBottom: 20,
  },
  securityAlertTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 4,
  },
  securityAlertText: {
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 16,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'space-between',
  },
  modalButton: {
    flex: 0.48,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveButton: {
    backgroundColor: Colors.success,
  },
  rejectButton: {
    backgroundColor: Colors.danger,
  },
  modalButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  safeConnected: {
    backgroundColor: 'rgba(48, 209, 88, 0.08)',
  },
  safeDisconnected: {
    backgroundColor: 'rgba(255, 69, 58, 0.08)',
  },
  statusBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  settingsIconBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  slidersIcon: {
    width: 18,
    height: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sliderLine: {
    width: 2,
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 1,
    position: 'relative',
  },
  sliderNode: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFF',
    position: 'absolute',
    left: -2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  dotConnected: {
    backgroundColor: Colors.success,
  },
  dotDisconnected: {
    backgroundColor: Colors.danger,
  },
  statusText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: Colors.text,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // Settings modal styles
  settingsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 15, 17, 0.96)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  settingsContent: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    width: '100%',
    maxWidth: 380,
    padding: 24,
    gap: 20,
  },
  settingsTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Outfit-Bold' : 'sans-serif-condensed',
    textAlign: 'center',
  },
  settingsSection: {
    gap: 8,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    paddingBottom: 16,
  },
  settingsLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  settingsValue: {
    fontSize: 14,
    color: Colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  updateBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  updateBtnText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
  closeBtn: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: Colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  dangerBtn: {
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.2)',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerBtnText: {
    color: Colors.danger,
    fontWeight: '700',
    fontSize: 14,
  },
  modelsBtn: {
    backgroundColor: 'rgba(94, 92, 230, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(94, 92, 230, 0.2)',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelsBtnText: {
    color: Colors.primaryHover,
    fontWeight: '700',
    fontSize: 14,
  },
  inlineEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  settingsInput: {
    flex: 1,
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    color: Colors.text,
    fontSize: 13,
    marginRight: 6,
  },
  saveBtn: {
    backgroundColor: Colors.success,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 4,
  },
  saveBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  cancelBtn: {
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  cancelBtnText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: 'bold',
  },
  inlineDisplayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editBtn: {
    backgroundColor: 'rgba(94, 92, 230, 0.1)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(94, 92, 230, 0.2)',
  },
  editBtnText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: 'bold',
  },
});
