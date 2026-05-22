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
} from 'react-native';
import { Colors } from '../theme/colors';
import { ApiService } from '../services/api';

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  lastMessage: string;
}

interface Agent {
  id: string;
  name: string;
  iconEmoji: string;
}

interface ConversationListScreenProps {
  agent: Agent;
  onSelectConversation: (conversationId: string) => void;
  onNewConversation: () => void;
  onBack: () => void;
}

export const ConversationListScreen: React.FC<ConversationListScreenProps> = ({
  agent,
  onSelectConversation,
  onNewConversation,
  onBack,
}) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchConversations = useCallback(async () => {
    try {
      const data = await ApiService.getConversations();
      // Filter conversations for the selected agent
      const filtered = data.filter((c: any) => c.agentId === agent.id);
      setConversations(filtered);
    } catch (err: any) {
      console.error('Error fetching conversations:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [agent.id]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const formatTime = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      
      if (diffMins < 1) return 'Agora';
      if (diffMins < 60) return `Há ${diffMins} min`;
      if (diffHours < 24) return `Há ${diffHours} h`;
      
      return date.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
    } catch {
      return '';
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} activeOpacity={0.7}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>

        <View style={styles.agentInfo}>
          <Text style={styles.agentEmoji}>{agent.iconEmoji}</Text>
          <View>
            <Text style={styles.headerTitle}>{agent.name}</Text>
            <Text style={styles.headerSubtitle}>Conversas Ativas</Text>
          </View>
        </View>
      </View>

      {/* New Conversation Button */}
      <TouchableOpacity
        style={styles.newConvButton}
        onPress={onNewConversation}
        activeOpacity={0.8}
      >
        <Text style={styles.newConvEmoji}>⚡</Text>
        <View style={styles.newConvTextContainer}>
          <Text style={styles.newConvTitle}>Nova Conversa</Text>
          <Text style={styles.newConvSubtitle}>Inicia um novo ciclo de agente no workspace</Text>
        </View>
        <Text style={styles.newConvArrow}>›</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Histórico de Conversas</Text>

      {/* List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>A carregar conversas...</Text>
        </View>
      ) : conversations.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyEmoji}>💬</Text>
          <Text style={styles.emptyTitle}>Sem conversas ainda</Text>
          <Text style={styles.emptyText}>
            Começa uma nova conversa com {agent.name} para interagir com o seu ambiente local.
          </Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.convCard}
              onPress={() => onSelectConversation(item.id)}
              activeOpacity={0.8}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.convCardTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.timeText}>{formatTime(item.updatedAt)}</Text>
              </View>
              <Text style={styles.lastMessageText} numberOfLines={2}>
                {item.lastMessage || 'Nenhuma mensagem recente'}
              </Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchConversations(); }}
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
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) + 12 : 56,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  backArrow: {
    fontSize: 32,
    color: Colors.primary,
    lineHeight: 36,
  },
  agentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  agentEmoji: {
    fontSize: 28,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  newConvButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    marginHorizontal: 20,
    marginTop: 20,
    padding: 16,
  },
  newConvEmoji: {
    fontSize: 28,
    marginRight: 14,
  },
  newConvTextContainer: {
    flex: 1,
  },
  newConvTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  newConvSubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  newConvArrow: {
    fontSize: 24,
    color: Colors.primary,
    fontWeight: '600',
    marginLeft: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textMuted,
    marginHorizontal: 20,
    marginTop: 28,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  convCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  convCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
    marginRight: 10,
  },
  timeText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  lastMessageText: {
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 18,
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
  },
});
