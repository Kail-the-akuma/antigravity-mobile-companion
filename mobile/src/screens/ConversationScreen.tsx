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
import { ChatMessage, ApprovalRequest, CompanionEvent } from '../hooks/useSignalR';
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
  incomingEvent: CompanionEvent | null;
  setIncomingEvent: React.Dispatch<React.SetStateAction<CompanionEvent | null>>;
  activeExecutionState: { conversationId: string; prompt: string; isActive: boolean } | null;
  activeApproval: ApprovalRequest | null;
  setActiveApproval: React.Dispatch<React.SetStateAction<ApprovalRequest | null>>;
}

export interface ChatState {
  messages: ChatMessage[];
  activeApproval: ApprovalRequest | null;
  isThinking: boolean;
  lastProcessedEventId: number;
}

export type ChatAction =
  | { type: 'SET_INITIAL_MESSAGES'; messages: ChatMessage[] }
  | { type: 'ADD_OPTIMISTIC_MESSAGE'; message: ChatMessage }
  | { type: 'REMOVE_MESSAGE'; id: string }
  | { type: 'PROCESS_EVENTS'; events: CompanionEvent[]; conversationId: string }
  | { type: 'SET_ACTIVE_APPROVAL'; approval: ApprovalRequest | null }
  | { type: 'SET_THINKING'; isThinking: boolean }
  | { type: 'RESET_STATE' };

const initialChatState: ChatState = {
  messages: [],
  activeApproval: null,
  isThinking: false,
  lastProcessedEventId: 0,
};

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_INITIAL_MESSAGES':
      return {
        ...state,
        messages: action.messages,
      };
    case 'ADD_OPTIMISTIC_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, action.message].slice(-6),
      };
    case 'REMOVE_MESSAGE':
      return {
        ...state,
        messages: state.messages.filter((m) => m.id !== action.id),
      };
    case 'SET_ACTIVE_APPROVAL':
      return {
        ...state,
        activeApproval: action.approval,
      };
    case 'SET_THINKING':
      return {
        ...state,
        isThinking: action.isThinking,
      };
    case 'PROCESS_EVENTS': {
      let newState = { ...state };
      const sortedEvents = [...action.events].sort((a, b) => a.sequenceId - b.sequenceId);
      let stateChanged = false;
      let newMessages = [...newState.messages];

      for (const event of sortedEvents) {
        if (event.conversationId !== action.conversationId) continue;
        if (event.sequenceId <= newState.lastProcessedEventId) continue;

        stateChanged = true;
        console.log(`[chatReducer] Applying Event Log: #${event.sequenceId} (${event.eventType})`);

        switch (event.eventType) {
          case 'AgentStarted':
            newState.isThinking = true;
            break;
          case 'PromptSent':
            newState.isThinking = true;
            if (event.payloadJson) {
              try {
                const payload = JSON.parse(event.payloadJson);
                const msgId = payload.Id || payload.id || `prompt-${event.sequenceId}`;
                if (!newMessages.find((m) => m.id === msgId)) {
                  newMessages.push({
                    id: msgId,
                    conversationId: event.conversationId,
                    role: 'user',
                    content: payload.Content || payload.content || '',
                    timestamp: event.timestamp || new Date().toISOString(),
                  });
                }
              } catch (e) {
                console.warn('Failed to parse PromptSent payload:', e);
              }
            }
            break;
          case 'GenerationStarted':
            newState.isThinking = true;
            break;
          case 'ApprovalRequested':
            if (event.payloadJson) {
              try {
                const payload = JSON.parse(event.payloadJson);
                newState.activeApproval = {
                  id: payload.Id || payload.id,
                  taskId: payload.TaskId || payload.taskId || '',
                  planStepsJson: payload.PlanStepsJson || payload.planStepsJson || '',
                  status: payload.Status || payload.status || 'Pending',
                  createdAt: payload.CreatedAt || payload.createdAt || event.timestamp,
                  conversationId: event.conversationId,
                };
              } catch (e) {
                console.warn('Failed to parse ApprovalRequested payload:', e);
              }
            }
            newState.isThinking = false;
            break;
          case 'ApprovalApproved':
          case 'ApprovalRejected':
            newState.activeApproval = null;
            break;
          case 'AgentPaused':
          case 'AgentFinished':
            newState.isThinking = false;
            break;
        }

        newState.lastProcessedEventId = event.sequenceId;
      }

      if (stateChanged) {
        newState.messages = newMessages.slice(-6);
      }
      return newState;
    }
    case 'RESET_STATE':
      return initialChatState;
    default:
      return state;
  }
}

export const ConversationScreen: React.FC<ConversationScreenProps> = ({
  agent,
  conversationId: initialConversationId,
  hostUrl,
  onBack,
  isConnected,
  incomingMessage,
  incomingEvent,
  setIncomingEvent,
  activeExecutionState,
  activeApproval,
  setActiveApproval,
}) => {
  const insets = useSafeAreaInsets();
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const [state, dispatch] = React.useReducer(chatReducer, initialChatState);
  const { messages, activeApproval: localApproval, isThinking: agentTyping } = state;

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

  const loadHistory = useCallback(async (activeId: string) => {
    try {
      const existingMessages = await ApiService.getMessages(activeId);
      const mapped = existingMessages.map((m: any) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role as 'user' | 'agent' | 'user-ide',
        content: m.content,
        timestamp: m.timestamp,
      }));
      dispatch({ type: 'SET_INITIAL_MESSAGES', messages: mapped.slice(-6) });
    } catch (err) {
      console.warn('[ConversationScreen] Error fetching message history:', err);
    }
  }, []);

  const syncDeltaEvents = useCallback(async (activeId: string, sinceId: number) => {
    try {
      console.log(`[ConversationScreen] Syncing delta events since #${sinceId}...`);
      const events = await ApiService.syncEvents(activeId, sinceId);
      if (events && events.length > 0) {
        console.log(`[ConversationScreen] Received ${events.length} delta events. Processing...`);
        dispatch({ type: 'PROCESS_EVENTS', events, conversationId: activeId });

        // Update global active approval state if latest delta modified it
        const lastApprovalEvent = [...events]
          .reverse()
          .find(e => e.eventType === 'ApprovalRequested' || e.eventType === 'ApprovalApproved' || e.eventType === 'ApprovalRejected');
        
        if (lastApprovalEvent) {
          if (lastApprovalEvent.eventType === 'ApprovalRequested' && lastApprovalEvent.payloadJson) {
            const payload = JSON.parse(lastApprovalEvent.payloadJson);
            setActiveApproval({
              id: payload.Id || payload.id,
              taskId: payload.TaskId || payload.taskId || '',
              planStepsJson: payload.PlanStepsJson || payload.planStepsJson || '',
              status: payload.Status || payload.status || 'Pending',
              createdAt: payload.CreatedAt || payload.createdAt || lastApprovalEvent.timestamp,
              conversationId: activeId,
            });
          } else {
            setActiveApproval(null);
          }
        }
      }
    } catch (err) {
      console.warn('[ConversationScreen] Error syncing delta events:', err);
    }
  }, [setActiveApproval]);

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
        await loadHistory(activeId!);

        // Sincronizar delta de logs de eventos desde o início para calibrar o estado reativo
        await syncDeltaEvents(activeId!, 0);
      } catch (err: any) {
        console.error('Error initializing conversation:', err);
      } finally {
        setInitializing(false);
      }
    };

    initConversation();
  }, [agent.id, agent.name, initialConversationId, loadHistory, syncDeltaEvents]);

  // Sync delta events automatically on reconnection (self-healing)
  useEffect(() => {
    if (isConnected && conversationId && !initializing) {
      console.log(`[ConversationScreen] Connection active/restored. Sourcing delta events from sequence #${state.lastProcessedEventId}...`);
      syncDeltaEvents(conversationId, state.lastProcessedEventId);
    }
  }, [isConnected, conversationId, initializing, state.lastProcessedEventId, syncDeltaEvents]);

  // Handle real-time incoming events from SignalR
  useEffect(() => {
    if (!incomingEvent || !conversationId) return;
    if (incomingEvent.conversationId !== conversationId) return;

    console.log('[ConversationScreen] Live Event received:', incomingEvent.sequenceId, incomingEvent.eventType);
    dispatch({ type: 'PROCESS_EVENTS', events: [incomingEvent], conversationId });

    // Keep global App.tsx activeApproval aligned
    if (incomingEvent.eventType === 'ApprovalRequested' && incomingEvent.payloadJson) {
      try {
        const payload = JSON.parse(incomingEvent.payloadJson);
        setActiveApproval({
          id: payload.Id || payload.id,
          taskId: payload.TaskId || payload.taskId || '',
          planStepsJson: payload.PlanStepsJson || payload.planStepsJson || '',
          status: payload.Status || payload.status || 'Pending',
          createdAt: payload.CreatedAt || payload.createdAt || incomingEvent.timestamp,
          conversationId: conversationId,
        });
      } catch (e) {
        console.warn('Failed to parse approval payload for sync:', e);
      }
    } else if (incomingEvent.eventType === 'ApprovalApproved' || incomingEvent.eventType === 'ApprovalRejected') {
      setActiveApproval(null);
    }

    // Acknowledge event processing and clear it in App.tsx to prevent duplicate processing
    setIncomingEvent(null);
  }, [incomingEvent, conversationId, setIncomingEvent, setActiveApproval]);

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

    dispatch({ type: 'SET_THINKING', isThinking: false });
    
    // Evitar duplicados na lista de mensagens
    if (!messages.find((m) => m.id === incomingMessage.id)) {
      dispatch({ type: 'ADD_OPTIMISTIC_MESSAGE', message: incomingMessage });
    }

    // Recheck plan when a message arrives
    checkPlanAvailability();

    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, [incomingMessage, conversationId, messages, checkPlanAvailability]);

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
    dispatch({ type: 'ADD_OPTIMISTIC_MESSAGE', message: optimisticMsg });
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      await ApiService.sendMessage(conversationId, text);
      dispatch({ type: 'SET_THINKING', isThinking: true }); // Show typing indicator while agent "thinks"
    } catch (err: any) {
      console.error('Error sending message:', err);
      // Remove optimistic message on failure
      dispatch({ type: 'REMOVE_MESSAGE', id: optimisticMsg.id });
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

  const effectiveApproval = localApproval || activeApproval;
  const handleRespondApproval = useCallback(async (status: 'Approved' | 'Rejected') => {
    if (!effectiveApproval || processingApproval) {
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

      await ApiService.request(`/api/approvals/${effectiveApproval.id}/respond`, 'POST', {
        status,
        signature,
      });

      Alert.alert(
        status === 'Approved' ? 'Aprovado' : 'Rejeitado',
        status === 'Approved' 
          ? 'Plano de alterações assinado e aprovado! O agente irá continuar a trabalhar no computador.'
          : 'Plano de alterações rejeitado.'
      );

      dispatch({ type: 'SET_ACTIVE_APPROVAL', approval: null });
      setActiveApproval(null);
      setPlanVisible(false);
      setHasPlan(false);
      setPlanData(null);
    } catch (err: any) {
      Alert.alert('Erro', `Erro ao responder: ${err.message}`);
    } finally {
      setProcessingApproval(false);
    }
  }, [effectiveApproval, processingApproval, setActiveApproval]);

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
        activeApproval={effectiveApproval}
        onRespondApproval={handleRespondApproval}
        processingApproval={processingApproval}
      />
    </View>
  );
};
