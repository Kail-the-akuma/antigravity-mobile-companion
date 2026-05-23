import { Alert } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { ApiService } from '../../../services/api';
import { CryptoService } from '../../../services/crypto';
import { ApprovalRequest } from '../../../hooks/useSignalR';

interface UseApprovalEngineProps {
  activeApproval: ApprovalRequest | null;
  setActiveApproval: React.Dispatch<React.SetStateAction<ApprovalRequest | null>>;
  processingApproval: boolean;
  setProcessingApproval: (p: boolean) => void;
  setPendingApprovals: React.Dispatch<React.SetStateAction<Record<string, any>>>;
}

export const useApprovalEngine = ({
  activeApproval,
  setActiveApproval,
  processingApproval,
  setProcessingApproval,
  setPendingApprovals,
}: UseApprovalEngineProps) => {

  const handleApprovalResponse = async (status: 'Approved' | 'Rejected') => {
    if (!activeApproval || processingApproval) return;

    setProcessingApproval(true);
    try {
      // 1. Biometrics verification
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

      // 2. Cryptographic signature
      const identity = await CryptoService.getIdentity();
      if (!identity) {
        throw new Error('Identidade do dispositivo não encontrada.');
      }

      const timestamp = new Date().toISOString();
      const nonce = Math.random().toString(36).substring(2, 15);
      const approvalMsg = `approval:${activeApproval.id}:${status}`;
      
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

      // Clear from pending approvals map
      if (activeApproval.conversationId) {
        setPendingApprovals(prev => {
          const updated = { ...prev };
          delete updated[activeApproval.conversationId!.toLowerCase()];
          return updated;
        });
      }

      setActiveApproval(null);
      Alert.alert(
        status === 'Approved' ? 'Aprovado' : 'Rejeitado',
        `O plano de execução foi ${status === 'Approved' ? 'aprovado' : 'rejeitado'} com sucesso!`
      );
    } catch (err: any) {
      console.error('[useApprovalEngine] Error processing approval response:', err);
      Alert.alert('Erro', err.message || 'Erro ao submeter resposta de aprovação.');
    } finally {
      setProcessingApproval(false);
    }
  };

  return {
    handleApprovalResponse,
  };
};
