import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
  Alert,
  Platform,
  StatusBar,
  KeyboardAvoidingView,
} from 'react-native';
import { Colors } from '../theme/colors';
import { ApiService } from '../services/api';
import { CryptoService } from '../services/crypto';
import { useSignalR, TaskItem } from '../hooks/useSignalR';
import { TaskCard } from '../components/TaskCard';
import * as LocalAuthentication from 'expo-local-authentication';

interface DashboardScreenProps {
  onUnpair: () => void;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ onUnpair }) => {
  const [hostUrl, setHostUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [sendingPrompt, setSendingPrompt] = useState(false);
  const [processingApproval, setProcessingApproval] = useState(false);

  // Load host URL initially
  useEffect(() => {
    const loadHost = async () => {
      const url = await ApiService.getHostUrl();
      setHostUrl(url);
    };
    loadHost();
  }, []);

  // Initialize SignalR Hub Connection (WebSockets)
  const hubUrl = hostUrl ? `${hostUrl}/hubs/companion` : null;
  const { isConnected, tasks, setTasks, activeApproval, setActiveApproval } = useSignalR(hubUrl);

  // Fetch all tasks initially on mount/host load
  useEffect(() => {
    if (!hostUrl) return;

    const fetchTasks = async () => {
      try {
        setLoadingTasks(true);
        const data = await ApiService.request('/api/tasks');
        // Sort descending by creation date
        const sorted = (data as TaskItem[]).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        setTasks(sorted);
      } catch (err: any) {
        console.error('Error fetching tasks:', err);
      } finally {
        setLoadingTasks(false);
      }
    };

    fetchTasks();
  }, [hostUrl, setTasks]);

  // Handle unpairing the device
  const handleUnpair = async () => {
    Alert.alert(
      'Remover Emparelhamento',
      'Tem a certeza que deseja desemparelhar esta aplicação companion do Host?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desemparelhar',
          style: 'destructive',
          onPress: async () => {
            await CryptoService.clearIdentity();
            await ApiService.clearHostUrl();
            onUnpair();
          },
        },
      ]
    );
  };

  // Remotely inject a new prompt/task into the Antigravity workspace
  const handleSendPrompt = async () => {
    if (!prompt.trim()) return;

    setSendingPrompt(true);
    try {
      const newTask = await ApiService.request('/api/tasks', 'POST', {
        prompt: prompt.trim(),
      });
      
      // Update local state immediately with the newly created task
      setTasks((prev) => [newTask, ...prev]);
      setPrompt('');
      Alert.alert('Sucesso', 'Tarefa iniciada e enviada com sucesso para o terminal local!');
    } catch (err: any) {
      console.error('Error sending prompt:', err);
      Alert.alert('Erro', err.message || 'Falha ao injetar a tarefa.');
    } finally {
      setSendingPrompt(false);
    }
  };

  // Perform biometrics verification and sign the approval response
  const handleApprovalResponse = async (status: 'Approved' | 'Rejected') => {
    if (!activeApproval) return;

    setProcessingApproval(true);
    try {
      // 1. Trigger Local Authentication (Fingerprint / Face ID / Passcode)
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

      // 2. Obtain Identity and cryptographically sign the approval payload using the Symmetric SecretKey
      const identity = await CryptoService.getIdentity();
      if (!identity) {
        throw new Error('Identidade do dispositivo não encontrada.');
      }

      const timestamp = new Date().toISOString();
      const nonce = Math.random().toString(36).substring(2, 15);
      const approvalMsg = `approval:${activeApproval.id}:${status}`;
      
      // Generate unique high-entropy signature for verification
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

      // Clear the overlay and update task in list
      setActiveApproval(null);
      Alert.alert(
        status === 'Approved' ? 'Aprovado' : 'Rejeitado',
        `O plano de execução foi ${status === 'Approved' ? 'aprovado' : 'rejeitado'} com sucesso!`
      );
    } catch (err: any) {
      console.error('Error processing approval response:', err);
      Alert.alert('Erro', err.message || 'Erro ao submeter resposta de aprovação.');
    } finally {
      setProcessingApproval(false);
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Antigravity</Text>
            <View style={styles.connectionBadge}>
              <View
                style={[
                  styles.connectionDot,
                  { backgroundColor: isConnected ? Colors.success : Colors.danger },
                ]}
              />
              <Text style={styles.connectionText}>
                {isConnected ? 'Sincronizado' : 'Desconectado'}
              </Text>
            </View>
          </View>
          <TouchableOpacity style={styles.unpairButton} onPress={handleUnpair} activeOpacity={0.8}>
            <Text style={styles.unpairButtonText}>Desligar</Text>
          </TouchableOpacity>
        </View>

        {/* Task Feed */}
        <View style={styles.feedContainer}>
          <Text style={styles.sectionTitle}>Feed de Atividades</Text>
          {loadingTasks ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingText}>A carregar tarefas...</Text>
            </View>
          ) : tasks.length === 0 ? (
            <View style={styles.centered}>
              <Text style={styles.emptyText}>Nenhuma tarefa ativa ou registada.</Text>
            </View>
          ) : (
            <FlatList
              data={tasks}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TaskCard
                  prompt={item.prompt}
                  status={item.status}
                  createdAt={item.createdAt}
                />
              )}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>

        {/* Remote Prompt Sender Input Area */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Envie um comando para o workspace..."
            placeholderTextColor={Colors.textMuted}
            value={prompt}
            onChangeText={setPrompt}
            multiline
            maxHeight={100}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!prompt.trim() || sendingPrompt) && styles.sendButtonDisabled]}
            onPress={handleSendPrompt}
            disabled={!prompt.trim() || sendingPrompt}
            activeOpacity={0.8}
          >
            {sendingPrompt ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.sendButtonText}>Executar</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Cryptographically Protected Approval Modal Overlay */}
      {activeApproval && (
        <Modal transparent animationType="slide" visible={!!activeApproval}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Revisão de Plano Necessária</Text>
                <Text style={styles.modalSubtitle}>Identidade Criptográfica Verificada</Text>
              </View>

              <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                <Text style={styles.modalDescription}>
                  O Agente Antigravity gerou um plano de alteração e requer a sua aprovação explícita antes de avançar com o código:
                </Text>

                <View style={styles.planCard}>
                  <Text style={styles.planLabel}>Detalhes do Plano / Passos:</Text>
                  <Text style={styles.planStepsText}>
                    {activeApproval.planStepsJson || 'Nenhum detalhe adicional fornecido.'}
                  </Text>
                </View>

                <View style={styles.securityAlert}>
                  <Text style={styles.securityAlertTitle}>🔒 Segurança Biométrica Ativa</Text>
                  <Text style={styles.securityAlertText}>
                    A sua confirmação irá gerar uma assinatura digital única vinculada à chave simétrica deste dispositivo móvel.
                  </Text>
                </View>
              </ScrollView>

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.rejectButton]}
                  onPress={() => handleApprovalResponse('Rejected')}
                  disabled={processingApproval}
                  activeOpacity={0.8}
                >
                  <Text style={styles.modalButtonText}>Rejeitar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalButton, styles.approveButton]}
                  onPress={() => handleApprovalResponse('Approved')}
                  disabled={processingApproval}
                  activeOpacity={0.8}
                >
                  {processingApproval ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.modalButtonText}>Aprovar</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) + 12 : 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: 0.5,
  },
  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  connectionText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  unpairButton: {
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.2)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  unpairButtonText: {
    color: Colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  feedContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textMuted,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: 14,
    marginTop: 10,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: 20,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    borderTopWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 15,
    marginRight: 12,
  },
  sendButton: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 15, 17, 0.95)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: '90%',
  },
  modalHeader: {
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.text,
  },
  modalSubtitle: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '700',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  modalBody: {
    padding: 20,
  },
  modalDescription: {
    fontSize: 14,
    color: Colors.textMuted,
    lineHeight: 20,
    marginBottom: 16,
  },
  planCard: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 16,
  },
  planLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  planStepsText: {
    fontSize: 14,
    color: Colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    lineHeight: 18,
  },
  securityAlert: {
    backgroundColor: 'rgba(94, 92, 230, 0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(94, 92, 230, 0.2)',
    padding: 12,
    marginBottom: 20,
  },
  securityAlertTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 4,
  },
  securityAlertText: {
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 16,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'space-between',
  },
  modalButton: {
    flex: 0.48,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveButton: {
    backgroundColor: Colors.success,
  },
  rejectButton: {
    backgroundColor: Colors.danger,
  },
  modalButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
