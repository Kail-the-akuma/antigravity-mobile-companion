import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Text,
  View,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
  Modal,
  ScrollView,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { Colors } from '../theme/colors';
import { ApiService } from '../services/api';
import { ChatMessage, ApprovalRequest } from '../hooks/useSignalR';
import { MessageBubble } from '../components/MessageBubble';
import { PlanReviewer } from '../components/PlanReviewer';
import { styles } from './ConversationScreen.styles';

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
  isConnected: boolean;
  incomingMessage: ChatMessage | null;
  activeExecutionState: { conversationId: string; prompt: string; isActive: boolean } | null;
  activeApproval: ApprovalRequest | null;
  setActiveApproval: React.Dispatch<React.SetStateAction<ApprovalRequest | null>>;
}

export const ConversationScreen: React.FC<ConversationScreenProps> = ({
  agent,
  conversationId: initialConversationId,
  hostUrl,
  onBack,
  isConnected,
  incomingMessage,
  activeExecutionState,
  activeApproval,
  setActiveApproval,
}) => {
  const insets = useSafeAreaInsets();
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [agentTyping, setAgentTyping] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // Implementation Plan states
  const [hasPlan, setHasPlan] = useState(false);
  const [planData, setPlanData] = useState<any>(null);
  const [planVisible, setPlanVisible] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  const [processingApproval, setProcessingApproval] = useState(false);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const flatListRef = useRef<FlatList>(null);

  // SignalR states and handlers passed down via props

  const checkPlanAvailability = useCallback(async (showLoading = false) => {
    if (!conversationId) return;
    if (showLoading) setLoadingPlan(true);
    try {
      const data = await ApiService.getImplementationPlan(conversationId);
      setPlanData(data);
      setHasPlan(true);
    } catch (err) {
      setHasPlan(false);
      setPlanData(null);
    } finally {
      if (showLoading) setLoadingPlan(false);
    }
  }, [conversationId]);

  useEffect(() => {
    checkPlanAvailability();
  }, [conversationId, checkPlanAvailability]);

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
        const existingMessages = await ApiService.getMessages(activeId!);
        const mapped = existingMessages.map((m: any) => ({
          id: m.id,
          conversationId: m.conversationId,
          role: m.role as 'user' | 'agent' | 'user-ide',
          content: m.content,
          timestamp: m.timestamp,
        }));
        setMessages(mapped.slice(-6));
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
      return [...prev, incomingMessage].slice(-6);
    });

    // Recheck plan when a message arrives
    checkPlanAvailability();

    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, [incomingMessage, conversationId, checkPlanAvailability]);

  // Scroll to bottom when desktop agent starts executing
  useEffect(() => {
    if (activeExecutionState && activeExecutionState.conversationId === conversationId && activeExecutionState.isActive) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 250);
    }
    // Check plan changes when agent execution state updates
    checkPlanAvailability();
  }, [activeExecutionState, conversationId, checkPlanAvailability]);

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
    setMessages((prev) => [...prev, optimisticMsg].slice(-6));
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

  const postPlanComment = useCallback(async (section: string, text: string) => {
    if (!conversationId || postingComment) return;
    setPostingComment(true);
    try {
      await ApiService.postPlanComment(conversationId, section, text);
      await checkPlanAvailability();
      Alert.alert('Sucesso', 'Comentário submetido e sincronizado com o computador!');
    } catch (err: any) {
      Alert.alert('Erro', `Não foi possível enviar o comentário: ${err.message}`);
      throw err;
    } finally {
      setPostingComment(false);
    }
  }, [conversationId, postingComment, checkPlanAvailability]);

  const handleRespondApproval = useCallback(async (status: 'Approved' | 'Rejected') => {
    if (!activeApproval || processingApproval) {
      Alert.alert('Aviso', 'Nenhuma solicitação de aprovação ativa encontrada ou em processamento.');
      return;
    }
    setProcessingApproval(true);
    try {
      let signature = 'signed-by-companion-mobile';

      if (status === 'Approved') {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();

        if (hasHardware && isEnrolled) {
          const authResult = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Autentique para assinar e aprovar o plano de execução',
            fallbackLabel: 'Usar código',
          });

          if (!authResult.success) {
            Alert.alert('Autenticação cancelada', 'O plano não foi assinado e a aprovação foi interrompida.');
            return;
          }
          signature = `biometric-signature-approved-${Date.now()}`;
        }
      }

      await ApiService.request(`/api/approvals/${activeApproval.id}/respond`, 'POST', {
        status,
        signature,
      });

      Alert.alert(
        status === 'Approved' ? 'Aprovado' : 'Rejeitado',
        status === 'Approved' 
          ? 'Plano de alterações assinado e aprovado! O agente irá continuar a trabalhar no computador.'
          : 'Plano de alterações rejeitado.'
      );

      setActiveApproval(null);
      setPlanVisible(false);
      setHasPlan(false);
      setPlanData(null);
    } catch (err: any) {
      Alert.alert('Erro', `Erro ao responder: ${err.message}`);
    } finally {
      setProcessingApproval(false);
    }
  }, [activeApproval, processingApproval, setActiveApproval]);

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

      {/* PLAN NOTIFICATION BANNER: Sitting beautifully below the header and above the FlatList */}
      {hasPlan && (
        <TouchableOpacity
          style={styles.reviewBanner}
          onPress={() => {
            checkPlanAvailability(true);
            setPlanVisible(true);
          }}
          activeOpacity={0.85}
        >
          <Text style={styles.reviewBannerEmoji}>📝</Text>
          <View style={styles.reviewBannerTextContainer}>
            <Text style={styles.reviewBannerText}>Rever Plano de Alterações</Text>
            <Text style={styles.reviewBannerSubtext}>Toque para analisar o plano de código, comentar ou aprovar</Text>
          </View>
          <Text style={styles.reviewBannerArrow}>›</Text>
        </TouchableOpacity>
      )}

      {/* Messages & Input Box avoids keyboard */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 102 : 0}
      >
        {/* Messages */}
        <FlatList
          ref={flatListRef}
          style={{ flex: 1 }}
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
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={5}
          removeClippedSubviews={true}
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
            <>
              {activeExecutionState && activeExecutionState.conversationId === conversationId && activeExecutionState.isActive ? (
                <View style={styles.executionCard}>
                  <View style={styles.executionHeader}>
                    <ActivityIndicator size="small" color={Colors.primary} style={{ marginRight: 8 }} />
                    <Text style={styles.executionTitle}>Agente em Execução (Ambiente Remoto)</Text>
                  </View>
                  <Text style={styles.executionPrompt}>
                    "{activeExecutionState.prompt}"
                  </Text>
                  <Text style={styles.executionStatus}>
                    O agente está a processar no computador...
                  </Text>
                </View>
              ) : agentTyping ? (
                <View style={styles.typingIndicator}>
                  <View style={styles.typingBubble}>
                    <ActivityIndicator size="small" color={Colors.textMuted} />
                    <Text style={styles.typingText}>A pensar...</Text>
                  </View>
                </View>
              ) : null}
            </>
          }
        />

        {/* Input */}
        <View style={[styles.inputContainer, { 
          paddingBottom: keyboardVisible 
            ? 12 
            : Platform.OS === 'ios' 
              ? Math.max(insets.bottom, 24) 
              : Math.max(insets.bottom, 16) 
        }]}>
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


      <PlanReviewer
        visible={planVisible}
        onClose={() => setPlanVisible(false)}
        planData={planData}
        loading={loadingPlan}
        postingComment={postingComment}
        onPostComment={postPlanComment}
        activeApproval={activeApproval}
        onRespondApproval={handleRespondApproval}
        processingApproval={processingApproval}
      />
    </View>
  );
};
