export type CompanionEventType =
  | 'AgentStarted'
  | 'GenerationStarted'
  | 'AgentPaused'
  | 'AgentFinished'
  | 'PromptSent'
  | 'ApprovalRequested'
  | 'ApprovalApproved'
  | 'ApprovalRejected';

export interface PromptSentPayload {
  content: string;
  id?: string;
}

export interface ApprovalRequestedPayload {
  id: string;
  taskId: string;
  planStepsJson: string;
  status: string;
  createdAt: string;
  nonce: string;
  expiresAtUtc: string;
}

/**
 * Efetua o parsing e a validação do payload do evento de Prompt enviado pelo IDE.
 * Devolve o DTO tipado em caso de sucesso ou null se o formato for inválido.
 */
export const parsePromptSent = (payloadJson: string): PromptSentPayload | null => {
  try {
    if (!payloadJson) return null;
    const data = JSON.parse(payloadJson);
    return {
      content: data.Content || data.content || '',
      id: data.Id || data.id,
    };
  } catch (e) {
    console.warn('[Protocol] Falha no parse do payload de PromptSent:', e);
    return null;
  }
};

/**
 * Efetua o parsing e a validação do payload do evento de solicitação de aprovação biométrica.
 * Devolve o DTO tipado em caso de sucesso ou null se a estrutura for inválida.
 */
export const parseApprovalRequested = (payloadJson: string): ApprovalRequestedPayload | null => {
  try {
    if (!payloadJson) return null;
    const data = JSON.parse(payloadJson);
    
    const id = data.id || data.Id;
    if (!id) return null;

    return {
      id: id,
      taskId: data.taskId || data.TaskId || '',
      planStepsJson: data.planStepsJson || data.PlanStepsJson || '[]',
      status: data.status || data.Status || 'Pending',
      createdAt: data.createdAt || data.CreatedAt || new Date().toISOString(),
      nonce: data.nonce || data.Nonce || '',
      expiresAtUtc: data.expiresAtUtc || data.ExpiresAtUtc || '',
    };
  } catch (e) {
    console.warn('[Protocol] Falha no parse do payload de ApprovalRequested:', e);
    return null;
  }
};

export interface AgentFinishedPayload {
  id: string;
  role: 'user' | 'agent' | 'user-ide';
  content: string;
  timestamp: string;
}

export const parseAgentFinished = (payloadJson: string): AgentFinishedPayload | null => {
  try {
    if (!payloadJson) return null;
    const data = JSON.parse(payloadJson);
    return {
      id: data.id || data.Id || '',
      role: (data.role || data.Role || 'agent') as 'user' | 'agent' | 'user-ide',
      content: data.content || data.Content || '',
      timestamp: data.timestamp || data.Timestamp || new Date().toISOString(),
    };
  } catch (e) {
    console.warn('[Protocol] Falha no parse do payload de AgentFinished:', e);
    return null;
  }
};
