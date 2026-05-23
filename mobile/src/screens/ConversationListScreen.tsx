import React, { useEffect, useState, useCallback } from 'react';
import {
  Text,
  View,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { Colors } from '../theme/colors';
import { ApiService } from '../services/api';
import { ConversationCard, Conversation } from '../components/ConversationCard';
import { styles } from './ConversationListScreen.styles';

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
  onOpenDeletedConversations: () => void;
  pendingApprovals?: Record<string, any>;
}

export const ConversationListScreen: React.FC<ConversationListScreenProps> = ({
  agent,
  onSelectConversation,
  onNewConversation,
  onBack,
  onOpenDeletedConversations,
  pendingApprovals,
}) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchConversations = useCallback(async () => {
    try {
      const data = await ApiService.getConversations();
      // Filter conversations for the selected agent
      const filtered = data
        .filter((c: any) => c.agentId === agent.id)
        .map((c: any) => ({
          ...c,
          isPinned: c.isPinned ?? false,
        }));
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

  const handleTogglePin = async (id: string) => {
    try {
      // Optimistic update
      setConversations(prev =>
        prev
          .map(c => (c.id === id ? { ...c, isPinned: !c.isPinned } : c))
          .sort((a, b) => {
            const aPinned = a.isPinned ? 1 : 0;
            const bPinned = b.isPinned ? 1 : 0;
            if (aPinned !== bPinned) return bPinned - aPinned;
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          })
      );
      await ApiService.togglePinConversation(id);
    } catch (err) {
      console.error('Error toggling pin:', err);
      Alert.alert('Erro', 'Não foi possível atualizar o estado de fixação.');
      fetchConversations();
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert(
      'Eliminar Conversa',
      'Tens a certeza que pretendes eliminar esta conversa? Esta ação removerá a conversa do telemóvel permanentemente.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              // Optimistic update
              setConversations(prev => prev.filter(c => c.id !== id));
              await ApiService.deleteConversation(id);
            } catch (err) {
              console.error('Error deleting conversation:', err);
              Alert.alert('Erro', 'Não foi possível eliminar a conversa.');
              fetchConversations();
            }
          },
        },
      ],
      { cancelable: true }
    );
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
            <View style={styles.statusBadgeRow}>
              <View style={styles.onlineDot} />
              <Text style={styles.headerSubtitle}>Ativo localmente</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity onPress={onOpenDeletedConversations} style={styles.trashButton} activeOpacity={0.7}>
          <Text style={styles.trashText}>🗑️</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchConversations(); }}
            tintColor={Colors.primary}
          />
        }
        ListHeaderComponent={
          <>
            {/* New Conversation Button */}
            <TouchableOpacity
              style={styles.newConvButton}
              onPress={onNewConversation}
              activeOpacity={0.85}
            >
              <View style={styles.newConvGlow} />
              <View style={styles.newConvEmojiContainer}>
                <Text style={styles.newConvEmoji}>⚡</Text>
              </View>
              <View style={styles.newConvTextContainer}>
                <Text style={styles.newConvTitle}>Nova Conversa</Text>
                <Text style={styles.newConvSubtitle}>Inicia um novo ciclo de agente no teu workspace</Text>
              </View>
              <Text style={styles.newConvArrow}>›</Text>
            </TouchableOpacity>

            <Text style={styles.sectionTitle}>Histórico de Conversas</Text>
          </>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingText}>A carregar conversas...</Text>
            </View>
          ) : (
            <View style={styles.centered}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyTitle}>Sem conversas ainda</Text>
              <Text style={styles.emptyText}>
                Começa uma nova conversa com o {agent.name} para interagir com o teu ambiente local.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <ConversationCard
            conversation={item}
            onSelect={onSelectConversation}
            onTogglePin={handleTogglePin}
            onDelete={handleDelete}
            hasPendingApproval={pendingApprovals ? !!pendingApprovals[item.id.toLowerCase()] : false}
          />
        )}
      />
    </View>
  );
};
