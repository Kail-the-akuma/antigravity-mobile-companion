import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  StatusBar,
  KeyboardAvoidingView,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import { Colors } from '../theme/colors';
import { ApiService } from '../services/api';
import { useSignalR, ChatMessage } from '../hooks/useSignalR';
import { MessageBubble } from '../components/MessageBubble';
import { CryptoService } from '../services/crypto';
import * as LocalAuthentication from 'expo-local-authentication';

interface Agent {
  id: string;
  name: string;
  iconEmoji: string;
  isOnline: boolean;
}

interface ConversationScreenProps {
  agent: Agent;
  conversationId: string | null;
  hostUrl: string;
  onBack: () => void;
}

export const ConversationScreen: React.FC<ConversationScreenProps> = ({
  agent,
  conversationId: initialConversationId,
  hostUrl,
  onBack,
}) => {
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [agentTyping, setAgentTyping] = useState(false);
  const [processingApproval, setProcessingApproval] = useState(false);

  const flatListRef = useRef<FlatList>(null);

  const hubUrl = `${hostUrl}/hubs/companion`;
  const { isConnected, incomingMessage, activeApproval, setActiveApproval } = useSignalR(hubUrl);

  // Perform biometrics verification and sign the approval response
  const handleApprovalResponse = async (status: 'Approved' | 'Rejected') => {
    if (!activeApproval) return;

    setProcessingApproval(true);
    try {
      // 1. Trigger Local Authentication (Fingerprint / Face ID / Passcode)
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

      // 2. Obtain Identity and cryptographically sign the approval payload
      const identity = await CryptoService.getIdentity();
      if (!identity) {
        throw new Error('Identidade do dispositivo não encontrada.');
      }

      const timestamp = new Date().toISOString();
      const nonce = Math.random().toString(36).substring(2, 15);
      const approvalMsg = `approval:${activeApproval.id}:${status}`;
      
      // Generate unique signature
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

      // Clear the overlay
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

  // Initialize conversation on mount
  useEffect(() => {
    const initConversation = async () => {
      try {
        let activeId = initialConversationId;
        if (!activeId) {
          const conv = await ApiService.createConversation(agent.id, `Conversa com ${agent.name}`);
          activeId = conv.id;
          setConversationId(activeId);
        }

        // Fetch existing messages if any
        const existingMessages = await ApiService.getMessages(activeId);
        const mapped = existingMessages.map((m: any) => ({
          id: m.id,
          conversationId: m.conversationId,
          role: m.role as 'user' | 'agent',
          content: m.content,
          timestamp: m.timestamp,
        }));
        setMessages(mapped.slice(-10));
      } catch (err: any) {
        console.error('Error initializing conversation:', err);
      } finally {
        setInitializing(false);
      }
    };

    initConversation();
  }, [agent.id, agent.name, initialConversationId]);

  // Scroll to bottom when conversation is opened and finished loading
  useEffect(() => {
    if (!initializing && messages.length > 0) {
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [initializing, messages.length]);

  // Handle real-time messages from SignalR
  useEffect(() => {
    if (!incomingMessage || !conversationId) return;
    if (incomingMessage.conversationId !== conversationId) return;

    setAgentTyping(false);
    setMessages((prev) => {
      // Deduplicate — skip if already in state
      if (prev.find((m) => m.id === incomingMessage.id)) return prev;
      return [...prev, incomingMessage].slice(-10);
    });

    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, [incomingMessage, conversationId]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !conversationId || sending) return;

    const text = input.trim();
    setInput('');
    setSending(true);

    // Optimistic update — show user message immediately
    const optimisticMsg: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      conversationId,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg].slice(-10));
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      await ApiService.sendMessage(conversationId, text);
      setAgentTyping(true); // Show typing indicator while agent "thinks"
    } catch (err: any) {
      console.error('Error sending message:', err);
      // Remove optimistic message on failure
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
      setInput(text);
    } finally {
      setSending(false);
    }
  }, [input, conversationId, sending]);

  if (initializing) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>A iniciar conversa...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} activeOpacity={0.7}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>

        <View style={styles.agentInfo}>
          <Text style={styles.agentEmoji}>{agent.iconEmoji}</Text>
          <View>
            <Text style={styles.agentName}>{agent.name}</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: isConnected ? Colors.success : Colors.danger }]} />
              <Text style={styles.statusText}>
                {isConnected ? (agent.isOnline ? 'Online' : 'Hub ligado') : 'Desconectado'}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MessageBubble
              role={item.role}
              content={item.content}
              timestamp={item.timestamp}
              agentEmoji={agent.iconEmoji}
            />
          )}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={Platform.OS === 'android'}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Text style={styles.emptyChatEmoji}>{agent.iconEmoji}</Text>
              <Text style={styles.emptyChatTitle}>Conversa com {agent.name}</Text>
              <Text style={styles.emptyChatText}>
                Envia uma mensagem para começar. O agente irá responder em tempo real.
              </Text>
            </View>
          }
          ListFooterComponent={
            agentTyping ? (
              <View style={styles.typingIndicator}>
                <View style={styles.typingBubble}>
                  <ActivityIndicator size="small" color={Colors.textMuted} />
                  <Text style={styles.typingText}>A pensar...</Text>
                </View>
              </View>
            ) : null
          }
        />

        {/* Input */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder={`Mensagem para ${agent.name}...`}
            placeholderTextColor={Colors.textMuted}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={2000}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!input.trim() || sending) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!input.trim() || sending}
            activeOpacity={0.8}
          >
            {sending ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.sendIcon}>↑</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Cryptographically Protected Approval Modal Overlay */}
      {activeApproval && (
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
    </View>
  );
};

// Extracted plan card style to be dynamic or flat safely
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
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: Colors.textMuted,
    marginTop: 12,
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) + 12 : 56,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  backArrow: {
    fontSize: 32,
    color: Colors.primary,
    lineHeight: 36,
  },
  agentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  agentEmoji: {
    fontSize: 28,
    marginRight: 10,
  },
  agentName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 5,
  },
  statusText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  messageList: {
    paddingVertical: 16,
    flexGrow: 1,
  },
  emptyChat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 80,
  },
  emptyChatEmoji: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyChatTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
  },
  emptyChatText: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  typingIndicator: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  typingText: {
    color: Colors.textMuted,
    fontSize: 13,
    marginLeft: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    borderTopWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 15,
    marginRight: 10,
    maxHeight: 120,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendIcon: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '700',
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
});
