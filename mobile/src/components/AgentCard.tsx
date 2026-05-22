import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Colors } from '../theme/colors';

interface AgentCardProps {
  name: string;
  description: string;
  iconEmoji: string;
  isOnline: boolean;
  capabilities: string[]; // parsed from JSON
  onPress: () => void;
}

export const AgentCard: React.FC<AgentCardProps> = ({
  name,
  description,
  iconEmoji,
  isOnline,
  capabilities,
  onPress,
}) => {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      {/* Avatar + Status indicator */}
      <View style={styles.avatarContainer}>
        <View style={styles.avatar}>
          <Text style={styles.avatarEmoji}>{iconEmoji}</Text>
        </View>
        <View style={[styles.statusDot, { backgroundColor: isOnline ? Colors.success : Colors.textMuted }]} />
      </View>

      {/* Info */}
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{name}</Text>
          <Text style={[styles.statusLabel, { color: isOnline ? Colors.success : Colors.textMuted }]}>
            {isOnline ? 'Online' : 'Offline'}
          </Text>
        </View>
        <Text style={styles.description} numberOfLines={2}>
          {description}
        </Text>

        {/* Capability pills */}
        {capabilities.length > 0 && (
          <View style={styles.pills}>
            {capabilities.slice(0, 3).map((cap, i) => (
              <View key={i} style={styles.pill}>
                <Text style={styles.pillText}>{cap}</Text>
              </View>
            ))}
            {capabilities.length > 3 && (
              <View style={styles.pill}>
                <Text style={styles.pillText}>+{capabilities.length - 3}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Chevron */}
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 26,
  },
  statusDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: Colors.background,
  },
  info: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  name: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  description: {
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 18,
    marginBottom: 8,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  pill: {
    backgroundColor: 'rgba(94, 92, 230, 0.12)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(94, 92, 230, 0.2)',
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  pillText: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 24,
    color: Colors.textMuted,
    marginLeft: 8,
  },
});
