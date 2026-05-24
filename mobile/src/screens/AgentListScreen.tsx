import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  StatusBar,
  RefreshControl,
  Alert,
} from 'react-native';
import { Colors } from '../theme/colors';
import { ApiService } from '../services/api';
import { CryptoService } from '../services/crypto';
import { AgentCard } from '../components/AgentCard';
interface Agent {
  id: string;
  name: string;
  description: string;
  iconEmoji: string;
  isOnline: boolean;
  capabilities: string;
  lastPing: string;
}

interface AgentListScreenProps {
  hostUrl: string;
  onSelectAgent: (agent: Agent) => void;
  onUnpair: () => void;
  isConnected: boolean;
  agentStatusUpdate: { agentId: string; isOnline: boolean } | null;
}

export const AgentListScreen: React.FC<AgentListScreenProps> = ({
  hostUrl,
  onSelectAgent,
  onUnpair,
  isConnected,
  agentStatusUpdate,
}) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAgents = useCallback(async () => {
    try {
      const data = await ApiService.getAgents();
      setAgents(data);
    } catch (err: any) {
      console.error('Error fetching agents:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Live agent status updates from SignalR prop
  useEffect(() => {
    if (!agentStatusUpdate) return;
    setAgents((prev) =>
      prev.map((a) =>
        a.id === agentStatusUpdate.agentId
          ? { ...a, isOnline: agentStatusUpdate.isOnline }
          : a
      )
    );
  }, [agentStatusUpdate]);

  const handleUnpair = () => {
    Alert.alert(
      'Remover Emparelhamento',
      'Tem a certeza que deseja desemparelhar esta aplicação?',
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

  const parseCapabilities = (capJson: string): string[] => {
    try {
      return JSON.parse(capJson);
    } catch {
      return [];
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Agentes</Text>
          <View style={styles.connectionBadge}>
            <View
              style={[
                styles.connectionDot,
                { backgroundColor: isConnected ? Colors.success : Colors.danger },
              ]}
            />
            <Text style={styles.connectionText}>
              {isConnected ? 'Hub Ligado' : 'Desconectado'}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.unpairButton} onPress={handleUnpair} activeOpacity={0.8}>
          <Text style={styles.unpairButtonText}>Desligar</Text>
        </TouchableOpacity>
      </View>

      {/* Subtitle */}
      <Text style={styles.subtitle}>Selecione um agente para iniciar uma conversa</Text>

      {/* Agent List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>A carregar agentes...</Text>
        </View>
      ) : agents.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyEmoji}>🤖</Text>
          <Text style={styles.emptyTitle}>Nenhum agente registado</Text>
          <Text style={styles.emptyText}>
            Inicia o daemon Antigravity para que os agentes apareçam aqui.
          </Text>
          <TouchableOpacity style={styles.refreshButton} onPress={() => { setLoading(true); fetchAgents(); }}>
            <Text style={styles.refreshButtonText}>Atualizar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={agents}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <AgentCard
              name={item.name}
              description={item.description}
              iconEmoji={item.iconEmoji}
              isOnline={item.isOnline}
              capabilities={parseCapabilities(item.capabilities)}
              onPress={() => onSelectAgent(item)}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchAgents(); }}
              tintColor={Colors.primary}
            />
          }
        />
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
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
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
  subtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: 14,
    marginTop: 10,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  refreshButton: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  refreshButtonText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
