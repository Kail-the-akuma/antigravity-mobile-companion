import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import { Colors } from './src/theme/colors';
import { PairingScreen } from './src/screens/PairingScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { ApiService } from './src/services/api';
import { CryptoService } from './src/services/crypto';

export default function App() {
  const [screen, setScreen] = useState<'loading' | 'pairing' | 'dashboard'>('loading');

  useEffect(() => {
    const checkPairingStatus = async () => {
      try {
        const hostUrl = await ApiService.getHostUrl();
        const identity = await CryptoService.getIdentity();

        if (hostUrl && identity) {
          setScreen('dashboard');
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
        {screen === 'pairing' ? (
          <PairingScreen onPairSuccess={() => setScreen('dashboard')} />
        ) : (
          <DashboardScreen onUnpair={() => setScreen('pairing')} />
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
