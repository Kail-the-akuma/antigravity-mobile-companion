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
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAgent]}>
      {/* Agent avatar — only for agent messages */}
      {!isUser && (
        <View style={styles.agentAvatar}>
          <Text style={styles.agentAvatarEmoji}>{agentEmoji}</Text>
        </View>
      )}

      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAgent]}>
        {role === 'user-ide' && (
          <View style={styles.ideBadge}>
            <Text style={styles.ideBadgeText}>💻 ENVIADO DO IDE</Text>
          </View>
        )}
        <Text style={[styles.content, isUser ? styles.contentUser : styles.contentAgent]}>
          {displayContent}
        </Text>

        {isLongMessage && (
          <TouchableOpacity
            style={styles.expandButton}
            onPress={() => setModalVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.expandButtonText}>Ler Resposta Completa ↗</Text>
          </TouchableOpacity>
        )}

        <Text style={[styles.time, isUser ? styles.timeUser : styles.timeAgent]}>
          {formattedTime}
        </Text>
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
    alignItems: 'flex-end',
    marginVertical: 4,
    paddingHorizontal: 16,
  },
  rowUser: {
    justifyContent: 'flex-end',
  },
  rowAgent: {
    justifyContent: 'flex-start',
  },
  agentAvatar: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginBottom: 2,
  },
  agentAvatarEmoji: {
    fontSize: 16,
  },
  bubble: {
    maxWidth: '75%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleAgent: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderBottomLeftRadius: 4,
  },
  content: {
    fontSize: 15,
    lineHeight: 21,
  },
  contentUser: {
    color: '#FFFFFF',
  },
  contentAgent: {
    color: Colors.text,
  },
  time: {
    fontSize: 11,
    marginTop: 4,
  },
  timeUser: {
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'right',
  },
  timeAgent: {
    color: Colors.textMuted,
  },
  ideBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  ideBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.85)',
    letterSpacing: 0.6,
  },
  expandButton: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(94, 92, 230, 0.12)',
    borderRadius: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(94, 92, 230, 0.2)',
  },
  expandButtonText: {
    color: Colors.primary,
    fontSize: 12,
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
