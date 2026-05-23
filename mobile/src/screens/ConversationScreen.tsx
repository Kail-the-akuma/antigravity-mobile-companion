import React, { useRef, useEffect } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../theme/colors';
import { ChatMessage, ApprovalRequest, CompanionEvent } from '../hooks/useSignalR';
import { MessageBubble } from '../components/MessageBubble';
import { PlanReviewer } from '../components/PlanReviewer';
import { useChatEngine } from '../features/session/hooks/useChatEngine';
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

export const ConversationScreen: React.FC<ConversationScreenProps> = ({
  agent,
  conversationId: initialConversationId,
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
  const [keyboardVisible, setKeyboardVisible] = React.useState(false);
  const flatListRef = useRef<FlatList>(null);

  // Monitor do teclado para evitar sobreposições e ajustar insets dinâmicos
  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Consome a orquestração isolada de Bounded Context (SRP) via useChatEngine
  const {
    conversationId,
    messages,
    effectiveApproval,
    agentTyping,
    input,
    setInput,
    sending,
    initializing,
    hasPlan,
    planData,
    planVisible,
    setPlanVisible,
    loadingPlan,
    postingComment,
    processingApproval,
    handleSend,
    postPlanComment,
    handleRespondApproval,
    checkPlanAvailability,
  } = useChatEngine({
    agent,
    initialConversationId,
    isConnected,
    incomingMessage,
    incomingEvent,
    setIncomingEvent,
    activeExecutionState,
    activeApproval,
    setActiveApproval,
  });

  // Auto-scroll reativo ao fundo da timeline quando chegam novas mensagens
  useEffect(() => {
    if (!initializing && messages.length > 0) {
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [initializing, messages.length]);

  if (initializing) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>A inicializar consola de operações...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, keyboardVisible && { paddingTop: Platform.OS === 'ios' ? 12 : 8, paddingBottom: 8 }]}>
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

      {/* PLAN NOTIFICATION BANNER */}
      {hasPlan && !keyboardVisible && (
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 90 : 80}
      >
        {/* Messages List */}
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

        {/* Input Composer */}
        <View style={[styles.inputContainer, { 
          paddingBottom: keyboardVisible 
            ? 12 
            : Platform.OS === 'ios' 
              ? Math.max(insets.bottom, 24) 
              : Math.max(insets.bottom, 16) 
        }]}>
          <TextInput
            style={styles.input}
            placeholder="Injetar prompt no runtime do agente..."
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
