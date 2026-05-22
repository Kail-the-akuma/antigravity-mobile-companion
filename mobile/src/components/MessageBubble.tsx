import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';

interface MessageBubbleProps {
  role: 'user' | 'agent';
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
  const isUser = role === 'user';
  const formattedTime = new Date(timestamp).toLocaleTimeString('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const displayContent = role === 'agent' && content.length > 1500
    ? content.substring(0, 1400) + '\n\n... *(Conteúdo longo omitido no telemóvel por performance)*'
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
        <Text style={[styles.content, isUser ? styles.contentUser : styles.contentAgent]}>
          {displayContent}
        </Text>
        <Text style={[styles.time, isUser ? styles.timeUser : styles.timeAgent]}>
          {formattedTime}
        </Text>
      </View>
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
});
