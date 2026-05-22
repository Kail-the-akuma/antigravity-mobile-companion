import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
  StatusBar,
} from 'react-native';
import { Colors } from '../theme/colors';
import { ApiService } from '../services/api';
import { formatTime } from '../utils/date';

interface Agent {
  id: string;
  name: string;
  iconEmoji: string;
}

interface DeletedConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  lastMessage: string;
}

interface DeletedConversationsScreenProps {
  agent: Agent;
  onBack: () => void;
}

export const DeletedConversationsScreen: React.FC<DeletedConversationsScreenProps> = ({
  agent,
  onBack,
}) => {
  const [conversations, setConversations] = useState<DeletedConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDeletedConversations = useCallback(async () => {
    try {
      const data = await ApiService.getDeletedConversations();
      // Filter deleted conversations for the selected agent
      const filtered = data
        .filter((c: any) => c.agentId === agent.id)
        .map((c: any) => ({
          ...c,
        }));
      setConversations(filtered);
    } catch (err: any) {
      console.error('Error fetching deleted conversations:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [agent.id]);

  useEffect(() => {
    fetchDeletedConversations();
  }, [fetchDeletedConversations]);

  const handleRestore = async (id: string, title: string) => {
    try {
      // Optimistic update
      setConversations(prev => prev.filter(c => c.id !== id));
      await ApiService.restoreConversation(id);
      Alert.alert('Sucesso', `A conversa "${title}" foi restaurada com sucesso!`);
    } catch (err) {
      console.error('Error restoring conversation:', err);
      Alert.alert('Erro', 'Não foi possível restaurar a conversa.');
      fetchDeletedConversations();
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
          <View style={styles.trashIconContainer}>
            <Text style={styles.trashIconEmoji}>🗑️</Text>
          </View>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>Conversas Eliminadas</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>Recupera conversas de {agent.name}</Text>
          </View>
        </View>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchDeletedConversations(); }}
            tintColor={Colors.primary}
          />
        }
        ListHeaderComponent={
          conversations.length > 0 ? (
            <Text style={styles.sectionTitle}>Seleciona para recuperar</Text>
          ) : null
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingText}>A carregar a lixeira...</Text>
            </View>
          ) : (
            <View style={styles.centered}>
              <Text style={styles.emptyEmoji}>♻️</Text>
              <Text style={styles.emptyTitle}>Lixeira vazia</Text>
              <Text style={styles.emptyText}>
                Não existem conversas eliminadas para este agente no momento.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <View style={styles.convCard}>
            <View style={styles.cardHeader}>
              <View style={styles.titleContainer}>
                <Text style={styles.convCardTitle} numberOfLines={1}>
                  {item.title}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.restoreButton}
                onPress={() => handleRestore(item.id, item.title)}
                activeOpacity={0.7}
              >
                <Text style={styles.restoreButtonText}>♻️ Restaurar</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.lastMessageText} numberOfLines={2}>
              {item.lastMessage || 'Nenhuma mensagem recente'}
            </Text>

            <View style={styles.cardFooter}>
              <Text style={styles.timeText}>
                Atualizada {formatTime(item.updatedAt)}
              </Text>
            </View>
          </View>
        )}
      />
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
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) + 16 : 64,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    backgroundColor: 'rgba(24, 24, 28, 0.85)',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  backArrow: {
    fontSize: 28,
    color: Colors.primary,
    lineHeight: 32,
    fontWeight: '300',
  },
  agentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  trashIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.2)',
  },
  trashIconEmoji: {
    fontSize: 22,
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '500',
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.primary,
    marginTop: 24,
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  convCard: {
    backgroundColor: 'rgba(24, 24, 28, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  titleContainer: {
    flex: 1,
    marginRight: 12,
  },
  convCardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.2,
  },
  restoreButton: {
    backgroundColor: 'rgba(94, 92, 230, 0.15)',
    borderColor: 'rgba(94, 92, 230, 0.3)',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  restoreButtonText: {
    fontSize: 12,
    color: '#7977F2',
    fontWeight: '700',
  },
  lastMessageText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    lineHeight: 20,
    marginBottom: 12,
  },
  cardFooter: {
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
    paddingTop: 10,
  },
  timeText: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
    marginTop: 12,
  },
  emptyEmoji: {
    fontSize: 54,
    marginBottom: 16,
    opacity: 0.8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 20,
  },
});
