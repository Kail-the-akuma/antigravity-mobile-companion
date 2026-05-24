import { useEffect, useState, useRef, useCallback, useReducer } from 'react';
import { Alert, Keyboard } from 'react-native';
import { ApiService } from '../../../services/api';
import { sqliteService } from '../../../services/sqlite';
import { chatReducer, initialChatState } from '../reducers/chatReducer';
import { ChatMessage, ApprovalRequest, CompanionEvent } from '../../../hooks/useSignalR';
import { useApprovalEngine } from '../../approval/hooks/useApprovalEngine';

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

  // Recuperação cirúrgica e recursiva de lacunas (Gap Recovery)
  const checkAndRecoverGaps = useCallback(async (activeId: string, incomingEvents: CompanionEvent[], currentLastId: number) => {
    if (incomingEvents.length === 0) return incomingEvents;
    
    const sorted = [...incomingEvents].sort((a, b) => a.sequenceId - b.sequenceId);
    const minIncomingId = sorted[0].sequenceId;
    
    if (minIncomingId > currentLastId + 1) {
      console.log(`[useChatEngine] Lacuna detetada entre #${currentLastId} e #${minIncomingId}. A recuperar gap cirurgicamente...`);
      try {
        const gapEvents = await ApiService.syncEvents(activeId, currentLastId, minIncomingId - 1);
        if (gapEvents && gapEvents.length > 0) {
          console.log(`[useChatEngine] Lacuna recuperada. Obtidos ${gapEvents.length} eventos em falta.`);
          return [...gapEvents, ...incomingEvents];
        }
      } catch (err) {
        console.warn('[useChatEngine] Erro ao recuperar lacuna cirurgicamente:', err);
      }
    }
    return incomingEvents;
  }, []);

  // Sincroniza logs de eventos delta baseados no ponteiro da base de dados local SQLite
  const syncDeltaEvents = useCallback(async (activeId: string, sinceId: number) => {
    try {
      console.log(`[useChatEngine] A sincronizar delta de eventos desde #${sinceId}...`);
      let events = await ApiService.syncEvents(activeId, sinceId);
      
      if (events && events.length > 0) {
        // Recuperação de lacunas cirúrgica
        events = await checkAndRecoverGaps(activeId, events, sinceId);
        
        console.log(`[useChatEngine] Recebidos ${events.length} eventos delta. A gravar na SQLite...`);
        
        // 1. Inserção transacional atómica na SQLite local móvel e atualização do ponteiro de cursor
        const lastId = Math.max(...events.map(e => e.sequenceId));
        await sqliteService.saveSucceededEvents(events.map(e => ({
          sequenceId: e.sequenceId,
          conversationId: e.conversationId,
          eventType: e.eventType,
          payloadJson: e.payloadJson,
          timestamp: e.timestamp,
          eventId: e.eventId || '',
          sourceDeviceId: e.sourceDeviceId || 'PC-IDE',
          correlationId: e.correlationId || '',
          isReplayable: e.isReplayable !== undefined ? e.isReplayable : true,
          schemaVersion: e.schemaVersion || 1
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
  }, [setActiveApproval, checkAndRecoverGaps]);

  // Inicialização atómica no mount (Replay local offline + Delta Sync de rede)
  useEffect(() => {
    const initConversation = async () => {
      try {
        let activeId = conversationId;
        if (!activeId) {
          const conv = await ApiService.createConversation(agent.id, `Conversa com {agent.name}`);
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
            timestamp: e.timestamp,
            eventId: e.eventId,
            sourceDeviceId: e.sourceDeviceId,
            correlationId: e.correlationId,
            isReplayable: e.isReplayable,
            schemaVersion: e.schemaVersion
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

  // Poller Dinâmico de Resiliência com Backoff (8s a 45s)
  const pollerIntervalRef = useRef(8000);
  const pollerTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startDynamicPoller = useCallback(() => {
    if (pollerTimeoutRef.current) {
      clearTimeout(pollerTimeoutRef.current);
    }

    const runPoll = async () => {
      if (conversationId && !initializing) {
        // Sob rede móvel / SignalR desligado, usar polling agressivo constante de 6s
        const currentInterval = isConnected ? pollerIntervalRef.current : 6000;
        console.log(`[Poller] A sincronizar delta... Intervalo atual: ${currentInterval / 1000}s (SignalR Conectado: ${isConnected})`);
        
        const prePollId = lastProcessedIdRef.current;
        try {
          await syncDeltaEvents(conversationId, prePollId);
          if (isConnected) {
            if (lastProcessedIdRef.current > prePollId) {
              pollerIntervalRef.current = 8000;
            } else {
              pollerIntervalRef.current = Math.min(pollerIntervalRef.current + 4000, 45000);
            }
          }
        } catch {
          if (isConnected) {
            pollerIntervalRef.current = Math.min(pollerIntervalRef.current + 8000, 45000);
          }
        }
        pollerTimeoutRef.current = setTimeout(runPoll, currentInterval);
      }
    };

    // Atraso inicial rápido de 2s sob dados móveis para apanhar respostas imediatas
    const initialDelay = isConnected ? pollerIntervalRef.current : 2000;
    pollerTimeoutRef.current = setTimeout(runPoll, initialDelay);
  }, [conversationId, initializing, syncDeltaEvents, isConnected]);

  const resetPollerActivity = useCallback(() => {
    console.log('[Poller] Atividade detetada. Resetando intervalo de poller.');
    pollerIntervalRef.current = 8000;
    startDynamicPoller();
  }, [startDynamicPoller]);

  useEffect(() => {
    startDynamicPoller();
    return () => {
      if (pollerTimeoutRef.current) {
        clearTimeout(pollerTimeoutRef.current);
      }
    };
  }, [startDynamicPoller]);

  // Auto-cura de reconexão de rede (Catch-up de logs)
  useEffect(() => {
    if (isConnected && conversationId && !initializing) {
      console.log(`[useChatEngine] Rede SignalR ativa. A sincronizar deltas desde #${lastProcessedIdRef.current}...`);
      syncDeltaEvents(conversationId, lastProcessedIdRef.current);
      resetPollerActivity();
    }
  }, [isConnected, conversationId, initializing, syncDeltaEvents, resetPollerActivity]);

  // Ouvinte reativo em tempo real de logs de eventos via SignalR
  useEffect(() => {
    if (!incomingEvent || !conversationId) return;
    if (incomingEvent.conversationId !== conversationId) return;

    console.log('[useChatEngine] Evento SignalR em tempo real detetado:', incomingEvent.sequenceId, incomingEvent.eventType);
    
    const processLiveEvent = async () => {
      try {
        const currentLastId = lastProcessedIdRef.current;
        let eventsToProcess = [incomingEvent];
        
        if (incomingEvent.sequenceId > currentLastId + 1) {
          eventsToProcess = await checkAndRecoverGaps(conversationId, [incomingEvent], currentLastId);
        }

        const lastId = Math.max(...eventsToProcess.map(e => e.sequenceId));
        
        await sqliteService.saveSucceededEvents(eventsToProcess.map(e => ({
          sequenceId: e.sequenceId,
          conversationId: e.conversationId,
          eventType: e.eventType,
          payloadJson: e.payloadJson,
          timestamp: e.timestamp,
          eventId: e.eventId || '',
          sourceDeviceId: e.sourceDeviceId || 'PC-IDE',
          correlationId: e.correlationId || '',
          isReplayable: e.isReplayable !== undefined ? e.isReplayable : true,
          schemaVersion: e.schemaVersion || 1
        })), lastId);

        dispatch({ type: 'PROCESS_EVENTS', events: eventsToProcess, conversationId });

        const lastApprovalEvent = [...eventsToProcess]
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
              conversationId: conversationId,
              nonce: payload.Nonce || payload.nonce || '',
              expiresAtUtc: payload.ExpiresAtUtc || payload.expiresAtUtc || ''
            });
          } else {
            setActiveApproval(null);
          }
        }

        resetPollerActivity();
      } catch (e) {
        console.error('[useChatEngine] Erro ao processar evento live:', e);
      }
    };

    processLiveEvent();
    setIncomingEvent(null);
  }, [incomingEvent, conversationId, setIncomingEvent, setActiveApproval, checkAndRecoverGaps, resetPollerActivity]);

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

    // Gerar UUIDv4/UUIDv7 temporário para a mensagem de chat
    const eventId = `chat-${Math.random().toString(36).substring(2, 15)}-${Date.now()}`;

    const optimisticMsg: ChatMessage = {
      id: eventId,
      conversationId,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    dispatch({ type: 'ADD_OPTIMISTIC_MESSAGE', message: optimisticMsg });

    try {
      // Gravação local-first atómica na fila persistente
      await sqliteService.enqueueEvent({
        eventId,
        approvalId: conversationId, // approvalId serve como conversationId para mensagens
        nonce: '',
        action: 'SendMessage',
        timestampUtc: new Date().toISOString(),
        expiresAtUtc: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // futuro
        signature: text, // signature serve como content (conteúdo da mensagem)
        schemaVersion: 1
      });
      
      console.log(`[useChatEngine] Mensagem enfileirada offline com sucesso. EventId: ${eventId}`);
      resetPollerActivity();
    } catch (err: any) {
      console.error('[useChatEngine] Erro ao enfileirar mensagem localmente:', err);
      dispatch({ type: 'REMOVE_MESSAGE', id: optimisticMsg.id });
      setInput(text);
    } finally {
      setSending(false);
    }
  }, [input, conversationId, sending, resetPollerActivity]);

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

  // Instanciar o motor de aprovação unificado para evitar duplicação de lógica biométrica e criptográfica (SRP)
  const { handleApprovalResponse } = useApprovalEngine({
    activeApproval: effectiveApproval,
    setActiveApproval,
    processingApproval,
    setProcessingApproval,
    triggerSync: async () => {
      resetPollerActivity();
    }
  });

  // Submissão e assinatura de resposta de aprovação delegada (respeito absoluto de SRP)
  const handleRespondApproval = useCallback(async (status: 'Approved' | 'Rejected') => {
    await handleApprovalResponse(status);
    setPlanVisible(false);
    setHasPlan(false);
    setPlanData(null);
  }, [handleApprovalResponse]);

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
