import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import { Colors } from './src/theme/colors';
import { PairingScreen } from './src/screens/PairingScreen';
import { AgentListScreen } from './src/screens/AgentListScreen';
import { ConversationScreen } from './src/screens/ConversationScreen';
import { ApiService } from './src/services/api';
import { CryptoService } from './src/services/crypto';

interface Agent {
  id: string;
  name: string;
  description: string;
  iconEmoji: string;
  isOnline: boolean;
  capabilities: string;
  lastPing: string;
}

type Screen = 'loading' | 'pairing' | 'agents' | 'conversation';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [hostUrl, setHostUrl] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  useEffect(() => {
    const checkPairingStatus = async () => {
      try {
        const url = await ApiService.getHostUrl();
        const identity = await CryptoService.getIdentity();

        if (url && identity) {
          setHostUrl(url);
          setScreen('agents');
        } else {
          setScreen('pairing');
        }
      } catch (err) {
        console.error('Error loading initial pairing state:', err);
        setScreen('pairing');
      }
    };

    checkPairingStatus();
  }, []);

  const handlePairSuccess = async () => {
    const url = await ApiService.getHostUrl();
    setHostUrl(url);
    setScreen('agents');
  };

  const handleSelectAgent = (agent: Agent) => {
    setSelectedAgent(agent);
    setScreen('conversation');
  };

  const handleUnpair = () => {
    setHostUrl(null);
    setSelectedAgent(null);
    setScreen('pairing');
  };

  const handleBackToAgents = () => {
    setSelectedAgent(null);
    setScreen('agents');
  };

  if (screen === 'loading') {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <>
      <View style={styles.container}>
        {screen === 'pairing' && (
          <PairingScreen onPairSuccess={handlePairSuccess} />
        )}
        {screen === 'agents' && hostUrl && (
          <AgentListScreen
            hostUrl={hostUrl}
            onSelectAgent={handleSelectAgent}
            onUnpair={handleUnpair}
          />
        )}
        {screen === 'conversation' && hostUrl && selectedAgent && (
          <ConversationScreen
            agent={selectedAgent}
            hostUrl={hostUrl}
            onBack={handleBackToAgents}
          />
        )}
      </View>
      <StatusBar style="light" />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
