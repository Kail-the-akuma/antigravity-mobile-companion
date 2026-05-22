import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { DashboardScreen } from './src/screens/DashboardScreen';

export default function App() {
  return (
    <>
      <DashboardScreen />
      <StatusBar style="light" />
    </>
  );
}

