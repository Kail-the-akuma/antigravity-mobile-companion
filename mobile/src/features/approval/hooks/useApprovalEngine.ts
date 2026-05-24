import { Alert } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { CryptoService } from '../../../services/crypto';
import { ApprovalRequest } from '../../../hooks/useSignalR';
import { sqliteService } from '../../../services/sqlite';
import { generateUuidV7 } from '../../../utils/uuidv7';

interface UseApprovalEngineProps {
  activeApproval: ApprovalRequest | null;
  setActiveApproval: React.Dispatch<React.SetStateAction<ApprovalRequest | null>>;
  processingApproval: boolean;
  setProcessingApproval: (p: boolean) => void;
  setPendingApprovals?: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  triggerSync?: () => Promise<void>;
}

export const useApprovalEngine = ({
  activeApproval,
  setActiveApproval,
  processingApproval,
  setProcessingApproval,
  setPendingApprovals,
  triggerSync,
}: UseApprovalEngineProps) => {

  const handleApprovalResponse = async (status: 'Approved' | 'Rejected') => {
    if (!activeApproval || processingApproval) return;

    setProcessingApproval(true);
    try {
      // 1. Verificação de Expiração no Telemóvel (Semântica de Validade)
      const expiresAt = activeApproval.expiresAtUtc ? new Date(activeApproval.expiresAtUtc) : null;
      if (expiresAt && Date.now() > expiresAt.getTime()) {
        Alert.alert(
          'Plano Expirado', 
          'Esta solicitação de aprovação expirou por limite temporal de segurança e já não pode ser assinada.'
        );
        setActiveApproval(null);
        setProcessingApproval(false);
        return;
      }

      // 2. Autenticação Biométrica Nativa (FaceID / TouchID / Código)
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

      // 3. Obtenção da Identidade e Assinatura Criptográfica (Protocolo V1)
      const identity = await CryptoService.getIdentity();
      if (!identity) {
        throw new Error('Identidade do dispositivo não encontrada no enclave seguro.');
      }

      const timestampUtc = new Date().toISOString();
      const serverNonce = activeApproval.nonce || '';
      
      // Constrói o bloco de payload a assinar (integrando approvalId, nonce do servidor e ação)
      const approvalMsg = `approval:${activeApproval.id}:${status}`;
      
      const approvalSignature = await CryptoService.signRequest(
        approvalMsg,
        timestampUtc,
        serverNonce,
        identity.secretKey
      );

      // 4. Geração do eventId (UUID v7) e Gravação na Fila SQLite Local
      const eventId = generateUuidV7();
      const expiresAtUtc = activeApproval.expiresAtUtc || new Date(Date.now() + 5 * 60 * 1000).toISOString();

      console.log(`[ApprovalEngine] A gravar evento local autoritativo ${eventId} (UUID v7)...`);
      await sqliteService.enqueueEvent({
        eventId,
        approvalId: activeApproval.id,
        nonce: serverNonce,
        action: status,
        timestampUtc,
        expiresAtUtc,
        signature: approvalSignature,
        schemaVersion: 1
      });

      // 5. Limpeza do Mapa de Aprovações Pendentes e Fecho do Modal de UI
      if (activeApproval.conversationId && setPendingApprovals) {
        setPendingApprovals(prev => {
          const updated = { ...prev };
          delete updated[activeApproval.conversationId!.toLowerCase()];
          return updated;
        });
      }

      setActiveApproval(null);

      // 6. Disparo assíncrono imediato de sincronização de rede
      if (triggerSync) {
        console.log('[ApprovalEngine] Gatilho de transmissão imediata para a fila de sincronização.');
        triggerSync().catch(e => console.error('[ApprovalEngine] Erro ao despachar sincronização imediata:', e));
      }

      Alert.alert(
        status === 'Approved' ? 'Aprovação Registada' : 'Rejeição Registada',
        status === 'Approved'
          ? 'O plano de execução foi aprovado. A sua assinatura foi colocada na fila local e está a ser sincronizada com o PC.'
          : 'O plano de execução foi rejeitado localmente com sucesso!'
      );
    } catch (err: any) {
      console.error('[useApprovalEngine] Erro ao processar resposta de aprovação:', err);
      Alert.alert('Erro Criptográfico', err.message || 'Erro ao submeter resposta de aprovação.');
    } finally {
      setProcessingApproval(false);
    }
  };

  return {
    handleApprovalResponse,
  };
};
