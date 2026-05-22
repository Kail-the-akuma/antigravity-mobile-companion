import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';
import { Colors } from '../theme/colors';
import { formatTime } from '../utils/date';

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  lastMessage: string;
  isPinned?: boolean;
}

interface ConversationCardProps {
  conversation: Conversation;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  hasPendingApproval?: boolean;
}

export const ConversationCard: React.FC<ConversationCardProps> = React.memo(({
  conversation,
  onSelect,
  onTogglePin,
  onDelete,
  hasPendingApproval,
}) => {
  const isPinned = conversation.isPinned;

  return (
    <TouchableOpacity
      style={[
        styles.convCard,
        isPinned && styles.convCardPinned,
        hasPendingApproval && styles.convCardPendingApproval
      ]}
      onPress={() => onSelect(conversation.id)}
      activeOpacity={0.9}
    >
      {/* Card Header: Title & Micro-Actions */}
      <View style={styles.cardHeader}>
        <View style={styles.titleContainer}>
          {isPinned && (
            <View style={styles.pinnedBadge}>
              <Text style={styles.pinnedBadgeText}>📌 FIXADA</Text>
            </View>
          )}
          {hasPendingApproval && (
            <View style={styles.actionRequiredBadge}>
              <Text style={styles.actionRequiredBadgeText}>⚠️ AÇÃO REQUERIDA</Text>
            </View>
          )}
          <Text style={styles.convCardTitle} numberOfLines={1}>
            {conversation.title}
          </Text>
        </View>

        {/* Micro Action Buttons */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionIconButton, isPinned && styles.actionPinButtonActive]}
            onPress={() => onTogglePin(conversation.id)}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          >
            <Text style={[styles.actionIconText, isPinned && styles.actionIconTextActive]}>
              📌
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.actionIconButton, styles.actionDeleteButton]}
            onPress={() => onDelete(conversation.id)}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          >
            <Text style={styles.actionIconTextDelete}>
              🗑️
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Card Body: Last Message */}
      <Text style={styles.lastMessageText} numberOfLines={2}>
        {conversation.lastMessage || 'Nenhuma mensagem recente'}
      </Text>

      {/* Card Footer: Timestamp */}
      <View style={styles.cardFooter}>
        <Text style={styles.timeText}>
          Atualizada {formatTime(conversation.updatedAt)}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  convCard: {
    backgroundColor: 'rgba(24, 24, 28, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  convCardPinned: {
    backgroundColor: 'rgba(30, 28, 56, 0.95)',
    borderColor: 'rgba(94, 92, 230, 0.35)',
    shadowColor: Colors.primary,
    shadowOpacity: 0.05,
    shadowRadius: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  titleContainer: {
    flex: 1,
    marginRight: 12,
  },
  pinnedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(94, 92, 230, 0.15)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(94, 92, 230, 0.25)',
  },
  pinnedBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#7977F2',
    letterSpacing: 0.8,
  },
  convCardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.2,
    lineHeight: 22,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  actionPinButtonActive: {
    backgroundColor: 'rgba(94, 92, 230, 0.2)',
    borderColor: 'rgba(94, 92, 230, 0.4)',
  },
  actionDeleteButton: {
    backgroundColor: 'rgba(255, 69, 58, 0.05)',
    borderColor: 'rgba(255, 69, 58, 0.15)',
  },
  actionIconText: {
    fontSize: 14,
    opacity: 0.65,
  },
  actionIconTextActive: {
    opacity: 1.0,
  },
  actionIconTextDelete: {
    fontSize: 14,
    color: Colors.danger,
  },
  lastMessageText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    lineHeight: 20,
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
    paddingTop: 10,
  },
  timeText: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  convCardPendingApproval: {
    borderColor: '#FF9500',
    borderWidth: 2,
    shadowColor: '#FF9500',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  actionRequiredBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 149, 0, 0.15)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 149, 0, 0.35)',
  },
  actionRequiredBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FF9500',
    letterSpacing: 0.8,
  },
});
