import { useEffect, useState, useRef, useCallback, useReducer } from 'react';
import { Alert, Keyboard } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { ApiService } from '../../../services/api';
import { sqliteService } from '../../../services/sqlite';
import { chatReducer, initialChatState } from '../reducers/chatReducer';
import { ChatMessage, ApprovalRequest, CompanionEvent } from '../../../hooks/useSignalR';

interface Agent {
  id: string;
  name: string;
  iconEmoji: string;
  isOnline: boolean;
}

interface UseChatEngineProps {
  agent: Agent;
  initialConversationId: string | null;
  isConnected: boolean;
  incomingMessage: ChatMessage | null;
  incomingEvent: CompanionEvent | null;
  setIncomingEvent: React.Dispatch<React.SetStateAction<CompanionEvent | null>>;
  activeExecutionState: { conversationId: string; prompt: string; isActive: boolean } | null;
  activeApproval: ApprovalRequest | null;
  setActiveApproval: React.Dispatch<React.SetStateAction<ApprovalRequest | null>>;
}

export const useChatEngine = ({
  agent,
  initialConversationId,
  isConnected,
  incomingMessage,
  incomingEvent,
  setIncomingEvent,
  activeExecutionState,
  activeApproval,
  setActiveApproval,
}: UseChatEngineProps) => {
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // Reducer determinístico do Event Log
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const { messages, activeApproval: localApproval, isThinking: agentTyping } = state;

  // Estados dos Planos e Comentários do IDE
  const [hasPlan, setHasPlan] = useState(false);
  const [planData, setPlanData] = useState<any>(null);
  const [planVisible, setPlanVisible] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  const [processingApproval, setProcessingApproval] = useState(false);

  // Consulta atómica de Planos no Computador
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

  // Carrega histórico "frio" inicial do chat
  const loadHistory = useCallback(async (activeId: string) => {
    try {
      const existingMessages = await ApiService.getMessages(activeId);
      const mapped = existingMessages.map((m: any) => {
        const rawRole = (m.role || m.Role || 'user').toLowerCase();
        let role: 'user' | 'agent' | 'user-ide' = 'user';
        if (rawRole === 'agent') role = 'agent';
        else if (rawRole === 'user-ide' || rawRole === 'useride') role = 'user-ide';

        return {
          id: String(m.id || m.Id || ''),
          conversationId: m.conversationId || m.ConversationId || '',
          role,
          content: m.content || m.Content || '',
          timestamp: m.timestamp || m.Timestamp || new Date().toISOString(),
        };
      });
      dispatch({ type: 'SET_INITIAL_MESSAGES', messages: mapped.slice(-6) });
    } catch (err) {
      console.warn('[useChatEngine] Erro ao obter histórico de mensagens:', err);
    }
  }, []);

  // Sincroniza logs de eventos delta baseados no ponteiro da base de dados local SQLite
  const syncDeltaEvents = useCallback(async (activeId: string, sinceId: number) => {
    try {
      console.log(`[useChatEngine] A sincronizar delta de eventos desde #${sinceId}...`);
      const events = await ApiService.syncEvents(activeId, sinceId);
      if (events && events.length > 0) {
        console.log(`[useChatEngine] Recebidos ${events.length} eventos delta. A gravar na SQLite...`);
        
        // 1. Inserção transacional atómica na SQLite local móvel e atualização do ponteiro de cursor
        const lastId = Math.max(...events.map(e => e.sequenceId));
        await sqliteService.saveSucceededEvents(events.map(e => ({
          sequenceId: e.sequenceId,
          conversationId: e.conversationId,
          eventType: e.eventType,
          payloadJson: e.payloadJson,
          timestamp: e.timestamp
        })), lastId);

        // 2. Aplica projeção reativa de eventos no redutor
        dispatch({ type: 'PROCESS_EVENTS', events, conversationId: activeId });

        // Alinha o estado de aprovação ativo global do telemóvel se o delta o mutou
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
              nonce: payload.Nonce || payload.nonce || '',
              expiresAtUtc: payload.ExpiresAtUtc || payload.expiresAtUtc || ''
            });
          } else {
            setActiveApproval(null);
          }
        }
      }
    } catch (err) {
      console.warn('[useChatEngine] Erro ao sincronizar eventos delta:', err);
    }
  }, [setActiveApproval]);

  // Inicialização atómica no mount (Replay local offline + Delta Sync de rede)
  useEffect(() => {
    const initConversation = async () => {
      try {
        let activeId = conversationId;
        if (!activeId) {
          const conv = await ApiService.createConversation(agent.id, `Conversa com ${agent.name}`);
          activeId = conv.id;
          setConversationId(activeId);
        }

        // 1. Replay instantâneo local de eventos da SQLite (Offline-First)
        console.log(`[useChatEngine] Replaying local events from SQLite for ${activeId}...`);
        const localEvents = await sqliteService.getSucceededEvents(activeId!);
        if (localEvents.length > 0) {
          const mappedEvents = localEvents.map(e => ({
            sequenceId: e.sequenceId,
            conversationId: e.conversationId,
            eventType: e.eventType,
            payloadJson: e.payloadJson,
            timestamp: e.timestamp
          }));
          dispatch({ type: 'PROCESS_EVENTS', events: mappedEvents, conversationId: activeId! });
        }

        // Carrega o histórico frio
        await loadHistory(activeId!);

        // 2. Sync de deltas subsequentes
        const lastIdStr = await sqliteService.getMetadata('lastProcessedEventId');
        const sinceId = lastIdStr ? parseInt(lastIdStr, 10) : 0;
        await syncDeltaEvents(activeId!, sinceId);
      } catch (err: any) {
        console.error('[useChatEngine] Erro ao inicializar motor de chat:', err);
      } finally {
        setInitializing(false);
      }
    };

    initConversation();
  }, [agent.id, agent.name, loadHistory, syncDeltaEvents]);

  // Ponteiro persistente em ref para evitar loops infinitos de dependência
  const lastProcessedIdRef = useRef(state.lastProcessedEventId);
  useEffect(() => {
    lastProcessedIdRef.current = state.lastProcessedEventId;
  }, [state.lastProcessedEventId]);

  // Auto-cura de reconexão de rede (Catch-up de logs)
  useEffect(() => {
    if (isConnected && conversationId && !initializing) {
      console.log(`[useChatEngine] Rede SignalR ativa. A sincronizar deltas desde #${lastProcessedIdRef.current}...`);
      syncDeltaEvents(conversationId, lastProcessedIdRef.current);
    }
  }, [isConnected, conversationId, initializing, syncDeltaEvents]);

  // Ouvinte reativo em tempo real de logs de eventos via SignalR
  useEffect(() => {
    if (!incomingEvent || !conversationId) return;
    if (incomingEvent.conversationId !== conversationId) return;

    console.log('[useChatEngine] Evento SignalR em tempo real detetado:', incomingEvent.sequenceId, incomingEvent.eventType);
    
    // Grava na SQLite local móvel de imediato
    sqliteService.saveSucceededEvents([{
      sequenceId: incomingEvent.sequenceId,
      conversationId: incomingEvent.conversationId,
      eventType: incomingEvent.eventType,
      payloadJson: incomingEvent.payloadJson,
      timestamp: incomingEvent.timestamp
    }], incomingEvent.sequenceId)
    .catch(e => console.error('[useChatEngine] Erro ao gravar evento live na SQLite:', e));

    dispatch({ type: 'PROCESS_EVENTS', events: [incomingEvent], conversationId });

    // Alinha o activeApproval se o evento contiver solicitação
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
          nonce: payload.Nonce || payload.nonce || '',
          expiresAtUtc: payload.ExpiresAtUtc || payload.expiresAtUtc || ''
        });
      } catch (e) {
        console.warn('[useChatEngine] Erro ao processar payload do evento live:', e);
      }
    } else if (incomingEvent.eventType === 'ApprovalApproved' || incomingEvent.eventType === 'ApprovalRejected') {
      setActiveApproval(null);
    }

    setIncomingEvent(null);
  }, [incomingEvent, conversationId, setIncomingEvent, setActiveApproval]);

  // Ouvinte reativo de bolhas de mensagens SignalR
  useEffect(() => {
    if (!incomingMessage || !conversationId) return;
    if (incomingMessage.conversationId !== conversationId) return;
    
    if (!messages.some((m) => m.id === incomingMessage.id)) {
      dispatch({ type: 'ADD_OPTIMISTIC_MESSAGE', message: incomingMessage });
    }

    checkPlanAvailability();
  }, [incomingMessage, conversationId, messages, checkPlanAvailability]);

  // Observa mudanças do desktop executor card
  useEffect(() => {
    if (activeExecutionState && activeExecutionState.conversationId === conversationId && activeExecutionState.isActive) {
      // Check plan changes when agent execution state updates
      checkPlanAvailability();
    }
  }, [activeExecutionState, conversationId, checkPlanAvailability]);

  // Envio de mensagens e atualização otimista da timeline móvel
  const handleSend = useCallback(async () => {
    if (!input.trim() || !conversationId || sending) return;

    const text = input.trim();
    setInput('');
    setSending(true);

    const optimisticMsg: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      conversationId,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    dispatch({ type: 'ADD_OPTIMISTIC_MESSAGE', message: optimisticMsg });

    try {
      await ApiService.sendMessage(conversationId, text);
    } catch (err: any) {
      console.error('[useChatEngine] Erro ao enviar mensagem:', err);
      dispatch({ type: 'REMOVE_MESSAGE', id: optimisticMsg.id });
      setInput(text);
    } finally {
      setSending(false);
    }
  }, [input, conversationId, sending]);

  // Submissão de comentários do plano changeset
  const postPlanComment = useCallback(async (section: string, text: string) => {
    if (!conversationId || postingComment) return;
    setPostingComment(true);
    try {
      await ApiService.postPlanComment(conversationId, section, text);
      await checkPlanAvailability();
      Alert.alert('Sucesso', 'Comentário sincronizado com o computador!');
    } catch (err: any) {
      Alert.alert('Erro', `Não foi possível enviar o comentário: ${err.message}`);
      throw err;
    } finally {
      setPostingComment(false);
    }
  }, [conversationId, postingComment, checkPlanAvailability]);

  const effectiveApproval = localApproval || activeApproval;

  // Submissão e assinatura de resposta de aprovação
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

  return {
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
  };
};
