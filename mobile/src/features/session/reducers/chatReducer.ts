import { ChatMessage, ApprovalRequest, CompanionEvent } from '../../../hooks/useSignalR';
import { CompanionEventType, parsePromptSent, parseApprovalRequested, parseAgentFinished } from '../protocol/parsers';

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
  | { type: 'RESET_STATE' };

export const initialChatState: ChatState = {
  messages: [],
  activeApproval: null,
  isThinking: false,
  lastProcessedEventId: 0,
};

type ProjectionHandler = (state: ChatState, event: CompanionEvent) => ChatState;

// Dicionário fortemente tipado de Projeções de Eventos (Event Registry)
// Garante autocomplete e exhaustiveness estrita em tempo de compilação
const eventHandlers: Record<CompanionEventType, ProjectionHandler> = {
  AgentStarted: (state) => ({ 
    ...state, 
    isThinking: true 
  }),
  
  GenerationStarted: (state) => ({ 
    ...state, 
    isThinking: true 
  }),
  
  AgentPaused: (state) => ({ 
    ...state, 
    isThinking: false 
  }),
  
  AgentFinished: (state, event) => {
    const payload = parseAgentFinished(event.payloadJson);
    if (!payload) return { ...state, isThinking: false };

    const msgId = payload.id || `agent-${event.sequenceId}`;
    if (state.messages.some((m) => m.id === msgId)) {
      return { ...state, isThinking: false };
    }

    return {
      ...state,
      messages: [...state.messages, {
        id: msgId,
        conversationId: event.conversationId,
        role: 'agent' as const,
        content: payload.content,
        timestamp: payload.timestamp || event.timestamp || new Date().toISOString(),
      }].slice(-6),
      isThinking: false
    };
  },
  
  ApprovalApproved: (state) => ({ 
    ...state, 
    activeApproval: null, 
    isThinking: false 
  }),
  
  ApprovalRejected: (state) => ({ 
    ...state, 
    activeApproval: null, 
    isThinking: false 
  }),
  
  PromptSent: (state, event) => {
    const payload = parsePromptSent(event.payloadJson);
    if (!payload) return state;
    
    const msgId = payload.id || `prompt-${event.sequenceId}`;
    // Evita duplicar mensagens na projeção reativa caso já exista otimista
    if (state.messages.some((m) => m.id === msgId)) {
      return { ...state, isThinking: true };
    }
    
    return {
      ...state,
      messages: [...state.messages, {
        id: msgId,
        conversationId: event.conversationId,
        role: (payload.role || 'user-ide') as 'user' | 'agent' | 'user-ide',
        content: payload.content,
        timestamp: event.timestamp || new Date().toISOString(),
      }].slice(-6), // Otimização controlada de tamanho de ecrã móvel
      isThinking: true
    };
  },

  ApprovalRequested: (state, event) => {
    const payload = parseApprovalRequested(event.payloadJson);
    if (!payload) return state;
    
    return {
      ...state,
      activeApproval: {
        id: payload.id,
        taskId: payload.taskId,
        planStepsJson: payload.planStepsJson,
        status: payload.status,
        createdAt: payload.createdAt,
        conversationId: event.conversationId,
        nonce: payload.nonce,
        expiresAtUtc: payload.expiresAtUtc
      },
      isThinking: false
    };
  }
};

/**
 * Redutor determinístico do Chat (chatReducer)
 * Projeta linearmente o histórico de eventos imutáveis no estado reativo de UI.
 */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
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
        isThinking: action.message.role === 'user' // Define isThinking = true optimistamente no envio do utilizador
      };
      
    case 'REMOVE_MESSAGE':
      return {
        ...state,
        messages: state.messages.filter((m) => m.id !== action.id),
      };
      
    case 'PROCESS_EVENTS': {
      let newState = { ...state };
      
      // Ordenação temporal monotónica estrita por sequenceId
      const sortedEvents = [...action.events].sort((a, b) => a.sequenceId - b.sequenceId);

      for (const event of sortedEvents) {
        if (event.conversationId !== action.conversationId) continue;
        
        // Garantia de Idempotência: ignora eventos já processados na linha do tempo
        if (event.sequenceId <= newState.lastProcessedEventId) continue;

        console.log(`[chatReducer] Projetar Evento: #${event.sequenceId} (${event.eventType})`);
        
        const handler = eventHandlers[event.eventType as CompanionEventType];
        if (handler) {
          newState = handler(newState, event);
        } else {
          console.warn(`[chatReducer] Evento desconhecido ou sem handler de projeção: ${event.eventType}`);
        }

        newState.lastProcessedEventId = event.sequenceId;
      }
      
      return newState;
    }
    
    case 'RESET_STATE':
      return initialChatState;
      
    default:
      return state;
  }
}
