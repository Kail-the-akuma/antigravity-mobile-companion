import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Colors } from '../theme/colors';
import { CryptoService } from '../services/crypto';
import { ApiService } from '../services/api';

interface PairingScreenProps {
  onPairSuccess: () => void;
}

export const PairingScreen: React.FC<PairingScreenProps> = ({ onPairSuccess }) => {
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('5200');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePair = async () => {
    setError(null);
    if (!ip.trim() || !port.trim() || !token.trim()) {
      setError('Por favor preencha todos os campos.');
      return;
    }

    setLoading(true);
    try {
      // 1. Initialize Cryptographic Identity (generates UUID & 256-bit symmetric SecretKey)
      const { deviceId, secretKey } = await CryptoService.initializeIdentity();

      // 2. Build host URL
      const sanitizedIp = ip.trim();
      const sanitizedPort = port.trim();
      const hostUrl = `http://${sanitizedIp}:${sanitizedPort}`;

      // 3. Confirm pairing request to Daemon
      const response = await fetch(`${hostUrl}/api/pairing/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: token.trim(),
          deviceName: `${Platform.OS === 'ios' ? 'iOS' : 'Android'} Companion`,
          deviceId,
          secretKey,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Token inválido ou expirado.');
      }

      // 4. Save host URL on successful pairing
      await ApiService.setHostUrl(hostUrl);
      onPairSuccess();
    } catch (err: any) {
      console.error('Pairing error:', err);
      setError(err.message || 'Falha ao ligar ao servidor. Verifique a rede local.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.title}>Antigravity</Text>
          <Text style={styles.tagline}>Companion App</Text>
          <Text style={styles.description}>
            Ligue o telemóvel à mesma rede Wi-Fi e introduza os dados do terminal Antigravity.
          </Text>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Endereço IP do Host</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: 192.168.1.100"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numeric"
              value={ip}
              onChangeText={setIp}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Porta</Text>
            <TextInput
              style={styles.input}
              placeholder="5200"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numeric"
              value={port}
              onChangeText={setPort}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>PIN de Emparelhamento (6 dígitos)</Text>
            <TextInput
              style={styles.input}
              placeholder="000000"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numeric"
              maxLength={6}
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handlePair}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.buttonText}>Emparelhar Dispositivo</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: Colors.text,
    textAlign: 'center',
    letterSpacing: 1,
  },
  tagline: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '600',
    textTransform: 'uppercase',
    textAlign: 'center',
    letterSpacing: 2,
    marginBottom: 16,
  },
  description: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  errorText: {
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    color: Colors.danger,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.2)',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: Colors.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: Colors.text,
  },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
