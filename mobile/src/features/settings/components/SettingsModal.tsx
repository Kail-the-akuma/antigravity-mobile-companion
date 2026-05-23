import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import * as Updates from 'expo-updates';
import { Colors } from '../../../theme/colors';
import { ApiService } from '../../../services/api';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  hostUrl: string | null;
  fallbackHostUrl: string | null;
  setFallbackHostUrl: (url: string | null) => void;
  handleUnpair: () => Promise<void>;
  onNavigateToModels: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  visible,
  onClose,
  hostUrl,
  fallbackHostUrl,
  setFallbackHostUrl,
  handleUnpair,
  onNavigateToModels,
}) => {
  const [isEditingTunnel, setIsEditingTunnel] = useState(false);
  const [tempTunnelUrl, setTempTunnelUrl] = useState('');
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  const handleSaveTunnelUrl = async () => {
    const cleanUrl = tempTunnelUrl.trim();
    if (cleanUrl) {
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        Alert.alert('Erro de Validação', 'O URL do túnel tem de começar com http:// ou https://');
        return;
      }
    }
    
    try {
      if (cleanUrl) {
        await ApiService.setFallbackHostUrl(cleanUrl);
        setFallbackHostUrl(cleanUrl);
      } else {
        await ApiService.clearFallbackHostUrl();
        setFallbackHostUrl(null);
      }
      setIsEditingTunnel(false);
      Alert.alert('Sucesso', 'Túnel remoto atualizado!');
    } catch (err: any) {
      Alert.alert('Erro', 'Não foi possível guardar o túnel: ' + err.message);
    }
  };

  const handleManualCheckUpdates = async () => {
    setCheckingUpdates(true);
    if (!Updates.isEnabled) {
      Alert.alert(
        'Atualizações Desativadas',
        'O serviço de atualizações (expo-updates) não está ativo nesta build. Garanta que a app foi compilada com suporte a updates no app.json.'
      );
      setCheckingUpdates(false);
      return;
    }
    try {
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        await Updates.fetchUpdateAsync();
        Alert.alert(
          '⚡ Antigravity Atualizada',
          'Uma nova versão do Companion foi descarregada. Pretendes recarregar agora para aplicar?',
          [
            { text: 'Recarregar Agora', onPress: async () => {
              await Updates.reloadAsync();
            }},
            { text: 'Mais tarde', style: 'cancel' }
          ]
        );
      } else {
        Alert.alert('Estar Atualizado', 'Já estás a correr a versão mais recente do Companion!');
      }
    } catch (err: any) {
      Alert.alert('Falha no Update', 'Não foi possível verificar atualizações. Garante que estás ligado à Internet:\n' + err.message);
    } finally {
      setCheckingUpdates(false);
    }
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.settingsOverlay}>
        <View style={styles.settingsContent}>
          <Text style={styles.settingsTitle}>Configurações</Text>

          {/* Connection Information */}
          <View style={styles.settingsSection}>
            <Text style={styles.settingsLabel}>Ligação Local (LAN)</Text>
            <Text style={styles.settingsValue}>{hostUrl || 'Não configurado'}</Text>
          </View>

          <View style={styles.settingsSection}>
            <Text style={styles.settingsLabel}>Ligação Remota (Túnel)</Text>
            {isEditingTunnel ? (
              <View style={styles.inlineEditRow}>
                <TextInput
                  style={styles.settingsInput}
                  value={tempTunnelUrl}
                  onChangeText={setTempTunnelUrl}
                  placeholder="https://xxx.loca.lt"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                <TouchableOpacity style={styles.saveBtn} onPress={handleSaveTunnelUrl}>
                  <Text style={styles.saveBtnText}>OK</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsEditingTunnel(false)}>
                  <Text style={styles.cancelBtnText}>X</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.inlineDisplayRow}>
                <Text style={[styles.settingsValue, { flex: 1, marginRight: 8 }]} numberOfLines={1} ellipsizeMode="middle">
                  {fallbackHostUrl || 'Nenhum túnel ativo'}
                </Text>
                <TouchableOpacity style={styles.editBtn} onPress={() => {
                  setTempTunnelUrl(fallbackHostUrl || '');
                  setIsEditingTunnel(true);
                }}>
                  <Text style={styles.editBtnText}>Editar</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Manual OTA Updates Check */}
          <View style={styles.settingsSection}>
            <Text style={styles.settingsLabel}>Versão da Aplicação</Text>
            <Text style={styles.settingsValue}>v1.0.0 (EAS Preview)</Text>
            
            <TouchableOpacity 
              style={styles.updateBtn} 
              onPress={handleManualCheckUpdates}
              disabled={checkingUpdates}
            >
              {checkingUpdates ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.updateBtnText}>Procurar Atualizações</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Models & Quotas Navigation Row */}
          <TouchableOpacity 
            style={styles.modelsBtn} 
            onPress={onNavigateToModels}
            activeOpacity={0.7}
          >
            <Text style={styles.modelsBtnText}>Gerir Modelos & Quotas ⚡</Text>
          </TouchableOpacity>

          {/* Unpair Device Section */}
          <TouchableOpacity 
            style={styles.dangerBtn} 
            onPress={async () => {
              Alert.alert(
                'Desemparelhar Dispositivo',
                'Tem a certeza que deseja remover este emparelhamento criptográfico?',
                [
                  { text: 'Cancelar', style: 'cancel' },
                  { text: 'Desemparelhar', style: 'destructive', onPress: async () => {
                    await handleUnpair();
                  }}
                ]
              );
            }}
          >
            <Text style={styles.dangerBtnText}>Desemparelhar</Text>
          </TouchableOpacity>

          {/* Close Settings Button */}
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Fechar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  settingsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 15, 17, 0.96)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  settingsContent: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    width: '100%',
    maxWidth: 380,
    padding: 24,
    gap: 20,
  },
  settingsTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Outfit-Bold' : 'sans-serif-condensed',
    textAlign: 'center',
  },
  settingsSection: {
    gap: 8,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    paddingBottom: 16,
  },
  settingsLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  settingsValue: {
    fontSize: 14,
    color: Colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  updateBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  updateBtnText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
  closeBtn: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: Colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  dangerBtn: {
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.2)',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerBtnText: {
    color: Colors.danger,
    fontWeight: '700',
    fontSize: 14,
  },
  modelsBtn: {
    backgroundColor: 'rgba(94, 92, 230, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(94, 92, 230, 0.2)',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelsBtnText: {
    color: Colors.primaryHover,
    fontWeight: '700',
    fontSize: 14,
  },
  inlineEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  settingsInput: {
    flex: 1,
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    color: Colors.text,
    fontSize: 13,
    marginRight: 6,
  },
  saveBtn: {
    backgroundColor: Colors.success,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 4,
  },
  saveBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  cancelBtn: {
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  cancelBtnText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: 'bold',
  },
  inlineDisplayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editBtn: {
    backgroundColor: 'rgba(94, 92, 230, 0.1)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(94, 92, 230, 0.2)',
  },
  editBtnText: {
    color: Colors.primaryHover,
    fontSize: 12,
    fontWeight: '700',
  },
});
