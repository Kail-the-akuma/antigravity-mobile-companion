import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { sqliteService, LocalApprovalEvent } from '../../../services/sqlite';
import { ApiService } from '../../../services/api';

interface UseSyncDispatcherProps {
  isConnected: boolean;
}

export const useSyncDispatcher = ({ isConnected }: UseSyncDispatcherProps) => {
  const isSyncingRef = useRef(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const triggerSync = useCallback(async () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    try {
      const pendingEvents = await sqliteService.getPendingEvents();
      if (pendingEvents.length === 0) {
        // Se a fila estiver vazia, paramos o poller periódico para poupar bateria e recursos do telemóvel
        if (intervalRef.current) {
          console.log('[SyncDispatcher] Fila vazia. A desativar poller periódico de resiliência de rede.');
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        isSyncingRef.current = false;
        return;
      }

      // Se existem eventos pendentes e o poller periódico ainda não está ativo, ativamo-lo de imediato
      // Isto garante re-tentativas de transmissão automáticas a cada 10 segundos, mesmo que a rede mude
      // (ex.: Wi-Fi local desliga-se e liga-se a rede celular 4G/5G).
      if (!intervalRef.current) {
        console.log('[SyncDispatcher] Fila local com pendentes. A ativar poller periódico de resiliência de rede (10s).');
        intervalRef.current = setInterval(() => {
          triggerSync();
        }, 10000);
      }

      console.log(`[SyncDispatcher] Encontrados ${pendingEvents.length} eventos pendentes para sincronização.`);

      for (const event of pendingEvents) {
        // 1. Verificação de Expiração Offline
        const expiresAt = new Date(event.expiresAtUtc);
        if (Date.now() > expiresAt.getTime()) {
          console.warn(`[SyncDispatcher] Evento ${event.eventId} (Aprovação: ${event.approvalId}) expirou offline. A descartar...`);
          await sqliteService.removeEvent(event.eventId);
          continue;
        }

        // 2. Tentar Transmissão de Rede
        let success = false;
        try {
          console.log(`[SyncDispatcher] A enviar evento ${event.eventId} (Tipo: ${event.action}, Tentativa: ${event.syncAttempts + 1})...`);
          
          if (event.action === 'SendMessage') {
            await ApiService.sendMessage(event.approvalId, event.signature);
            console.log(`[SyncDispatcher] Mensagem enviada offline com sucesso para conversa ${event.approvalId}`);
          } else {
            const response: any = await ApiService.request(
              `/api/approvals/${event.approvalId}/respond`, 
              'POST', 
              {
                status: event.action,
                signature: event.signature,
                eventId: event.eventId,
                timestampUtc: event.timestampUtc,
                nonce: event.nonce
              }
            );
            console.log(`[SyncDispatcher] ACK de aprovacao recebido para evento ${event.eventId}:`, response);
          }

          success = true;
        } catch (err: any) {
          console.warn(`[SyncDispatcher] Erro ao sincronizar evento ${event.eventId}:`, err.message || err);
          
          // Se o servidor rejeitar explicitamente por erro crítico de dados, limpamos o evento inválido
          // para evitar bloqueios infinitos da fila local!
          if (err.status === 400 || err.status === 409 || err.status === 403) {
            console.error(`[SyncDispatcher] Erro crítico de protocolo (${err.status}). A remover evento inválido da fila.`);
            await sqliteService.removeEvent(event.eventId);
            continue;
          }
        }

        if (success) {
          // Remoção atómica da fila SQLite móvel
          await sqliteService.removeEvent(event.eventId);
        } else {
          // Incrementa tentativa de sincronização
          await sqliteService.incrementAttempts(event.eventId);
          
          // Agenda um ciclo rápido de retry adicional com backoff exponencial
          const backoffTime = Math.min(30000, Math.pow(2, event.syncAttempts) * 1500) + Math.random() * 500;
          console.log(`[SyncDispatcher] Envio falhou. Agendando retry transiente em ${Math.round(backoffTime)}ms...`);
          
          if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
          syncTimeoutRef.current = setTimeout(() => {
            isSyncingRef.current = false;
            triggerSync();
          }, backoffTime);
          
          // Interrompe o processamento em lote para evitar chamadas de rede consecutivas falhadas
          break;
        }
      }
    } catch (e) {
      console.error('[SyncDispatcher] Falha crítica no ciclo de sincronização:', e);
    } finally {
      isSyncingRef.current = false;
    }
  }, []);

  // Monitor reativo de conectividade (SignalR / Rede)
  useEffect(() => {
    if (isConnected) {
      console.log('[SyncDispatcher] Conexão SignalR ativa. Gatilho de sincronização ativa.');
      triggerSync();
    }
  }, [isConnected, triggerSync]);

  // Monitor de alteração de AppState (Foco / Foreground)
  // Se o utilizador desbloquear o telemóvel ou abrir a app após mudar de rede, força o sync imediato!
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        console.log('[SyncDispatcher] App focada em primeiro plano. Forçar triggerSync de resiliência...');
        triggerSync();
      }
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      appStateSubscription.remove();
    };
  }, [triggerSync]);

  // Subscreve ao SQLiteService para despoletar transmissao imediata quando novos itens entram na fila
  useEffect(() => {
    const unsubscribe = sqliteService.subscribe(() => {
      console.log('[SyncDispatcher] Novo evento detetado na fila SQLite. A despoletar triggerSync...');
      triggerSync();
    });

    return () => {
      unsubscribe();
    };
  }, [triggerSync]);

  // Clean-up de temporizadores
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return {
    triggerSync
  };
};
