import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  ActivityIndicator,
  Modal,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Colors } from '../theme/colors';
import { PairingScreen } from '../screens/PairingScreen';
import { AgentListScreen } from '../screens/AgentListScreen';
import { ConversationListScreen } from '../screens/ConversationListScreen';
import { ConversationScreen } from '../screens/ConversationScreen';
import { DeletedConversationsScreen } from '../screens/DeletedConversationsScreen';
import { ModelsScreen } from '../screens/ModelsScreen';
import { SettingsModal } from '../features/settings/components/SettingsModal';
import { useSignalR } from '../hooks/useSignalR';
import { usePairingState } from '../features/session/hooks/usePairingState';
import { useNotificationEngine } from '../features/session/hooks/useNotificationEngine';
import { useUrlAutoSync } from '../features/session/hooks/useUrlAutoSync';
import { useApprovalEngine } from '../features/approval/hooks/useApprovalEngine';
import { useSyncDispatcher } from '../features/session/hooks/useSyncDispatcher';
import { ApiService } from '../services/api';

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

export const AppNavigator: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('loading');
  const [hostUrl, setHostUrl] = useState<string | null>(null);
  const [fallbackHostUrl, setFallbackHostUrl] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [processingApproval, setProcessingApproval] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, any>>({});
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Initialize global SignalR Hub connection if device is paired
  const hubUrl = hostUrl ? `${hostUrl}/hubs/companion` : null;
  const fallbackHubUrl = fallbackHostUrl ? `${fallbackHostUrl}/hubs/companion` : null;
  const { 
    isConnected, 
    activeApproval, 
    setActiveApproval,
    incomingMessage,
    activeExecutionState,
    agentStatusUpdate,
    incomingEvent,
    setIncomingEvent,
  } = useSignalR(hubUrl, fallbackHubUrl);

  const [debouncedIsConnected, setDebouncedIsConnected] = useState(isConnected);

  useEffect(() => {
    if (isConnected) {
      setDebouncedIsConnected(true);
    } else {
      const timer = setTimeout(() => {
        setDebouncedIsConnected(false);
      }, 4500); // 4.5 segundos de tolerância contra micro-quedas e blink
      return () => clearTimeout(timer);
    }
  }, [isConnected]);

  // Custom session, notifications, connection sync and approval hooks
  const { handleUnpair } = usePairingState({
    setScreen,
    setHostUrl,
    setFallbackHostUrl,
    setSelectedAgent,
    setSelectedConversationId,
  });

  useNotificationEngine({
    hostUrl,
    fallbackHostUrl,
    setFallbackHostUrl,
    screen,
    selectedConversationId,
    setSelectedConversationId,
    setScreen,
    activeApproval,
    setPendingApprovals,
  });

  useUrlAutoSync({
    isConnected,
    hostUrl,
    setHostUrl,
    fallbackHostUrl,
    setFallbackHostUrl,
  });

  // Resilient background delta sync dispatcher
  const { triggerSync } = useSyncDispatcher({ isConnected });

  const { handleApprovalResponse } = useApprovalEngine({
    activeApproval,
    setActiveApproval,
    processingApproval,
    setProcessingApproval,
    setPendingApprovals,
    triggerSync,
  });

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
        <SafeAreaView style={debouncedIsConnected ? styles.safeConnected : styles.safeDisconnected}>
          <View style={styles.statusBarRow}>
            <View style={styles.statusIndicator}>
              <View style={[styles.statusDot, debouncedIsConnected ? styles.dotConnected : styles.dotDisconnected]} />
              <Text style={styles.statusText}>
                {debouncedIsConnected ? 'Ligado ao Daemon' : 'A ligar ao Daemon...'}
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
          incomingEvent={incomingEvent}
          setIncomingEvent={setIncomingEvent}
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

      {/* Settings Modal (Extracted) */}
      <SettingsModal
        visible={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        hostUrl={hostUrl}
        fallbackHostUrl={fallbackHostUrl}
        setFallbackHostUrl={setFallbackHostUrl}
        handleUnpair={handleUnpair}
        onNavigateToModels={() => {
          setShowSettingsModal(false);
          setScreen('models');
        }}
      />
    </View>
  );
};

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
});
