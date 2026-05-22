import { useEffect, useState } from 'react';

export const useSignalR = (hubUrl: string) => {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Placeholder for actual SignalR connection logic
    console.log(`Connecting to SignalR Hub: ${hubUrl}`);
    setIsConnected(true);
    return () => {
      console.log('Disconnecting from SignalR Hub');
    };
  }, [hubUrl]);

  return { isConnected };
};
