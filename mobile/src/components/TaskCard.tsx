import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Colors } from '../theme/colors';

interface TaskCardProps {
  prompt: string;
  status: string;
  createdAt: string;
  onPress?: () => void;
}

export const TaskCard: React.FC<TaskCardProps> = ({ prompt, status, createdAt, onPress }) => {
  const getStatusColor = () => {
    switch (status.toLowerCase()) {
      case 'running':
        return Colors.primary;
      case 'complete':
      case 'approved':
        return Colors.success;
      case 'failed':
      case 'rejected':
        return Colors.danger;
      case 'pending':
      case 'timeout':
        return Colors.warning;
      default:
        return Colors.textMuted;
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <Text style={styles.prompt} numberOfLines={2}>
          {prompt}
        </Text>
        <Text style={styles.time}>{formatTime(createdAt)}</Text>
      </View>
      <View style={styles.footer}>
        <View style={[styles.badge, { borderColor: getStatusColor(), backgroundColor: getStatusColor() + '1A' }]}>
          <View style={[styles.dot, { backgroundColor: getStatusColor() }]} />
          <Text style={[styles.statusText, { color: getStatusColor() }]}>{status}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  prompt: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
    flex: 1,
    marginRight: 12,
    lineHeight: 22,
  },
  time: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
