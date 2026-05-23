import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { Colors } from '../theme/colors';

interface MessageBubbleProps {
  role: 'user' | 'agent' | 'user-ide';
  content: string;
  timestamp: string;
  agentEmoji?: string;
}

export const MessageBubble: React.FC<MessageBubbleProps> = React.memo(({
  role,
  content,
  timestamp,
  agentEmoji = '⚡',
}) => {
  const [modalVisible, setModalVisible] = useState(false);
  const isUser = role === 'user' || role === 'user-ide';
  const formattedTime = new Date(timestamp).toLocaleTimeString('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const isLongMessage = role === 'agent' && content.length > 1200;
  const displayContent = isLongMessage
    ? content.substring(0, 1000) + '...'
    : content;

  return (
    <View style={styles.row}>
      <View style={styles.timelineCard}>
        <View style={styles.timelineHeader}>
          <View style={styles.metaLeft}>
            <Text style={styles.authorBadge}>
              {role === 'user-ide'
                ? '💻 IDE COMMAND'
                : isUser
                ? '👤 OPERADOR MÓVEL'
                : `🤖 AGENTE ${agentEmoji}`}
            </Text>
          </View>
          <Text style={styles.timelineTime}>{formattedTime}</Text>
        </View>

        <View style={styles.timelineContentContainer}>
          <Text selectable style={[styles.content, isUser ? styles.contentUser : styles.contentAgent]}>
            {displayContent}
          </Text>

          {isLongMessage && (
            <TouchableOpacity
              style={styles.expandButton}
              onPress={() => setModalVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.expandButtonText}>Análise Completa do Plano ↗</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Full Screen Reader Modal for Long Messages */}
      {isLongMessage && (
        <Modal
          visible={modalVisible}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setModalVisible(false)}
        >
          <SafeAreaView style={styles.modalOverlay}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Resposta Completa</Text>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                style={styles.closeButton}
                activeOpacity={0.7}
              >
                <Text style={styles.closeButtonText}>Fechar</Text>
              </TouchableOpacity>
            </View>

            <ScrollView 
              contentContainerStyle={styles.modalBody}
              showsVerticalScrollIndicator={true}
            >
              <Text selectable style={styles.fullText}>
                {content}
              </Text>
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginVertical: 6,
    paddingHorizontal: 16,
    width: '100%',
  },
  timelineCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderBottomWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  metaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  authorBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: 0.8,
  },
  timelineTime: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  timelineContentContainer: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  content: {
    fontSize: 14,
    lineHeight: 20,
    color: Colors.text,
  },
  contentUser: {
    color: Colors.text,
  },
  contentAgent: {
    color: Colors.text,
  },
  expandButton: {
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(94, 92, 230, 0.08)',
    borderRadius: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(94, 92, 230, 0.15)',
  },
  expandButtonText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.text,
  },
  closeButton: {
    backgroundColor: Colors.surfaceLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  closeButtonText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  modalBody: {
    padding: 20,
    paddingBottom: 40,
  },
  fullText: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.text,
  },
});
