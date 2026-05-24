import { useEffect, useState, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as signalR from '@microsoft/signalr';

export interface TaskItem {
  id: string;
  prompt: string;
  status: string;
  planJson?: string;
  modifiedFilesJson?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequest {
  id: string;
  taskId: string;
  planStepsJson: string;
  status: string;
  createdAt: string;
  conversationId?: string;
  nonce?: string;
  expiresAtUtc?: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'agent' | 'user-ide';
  content: string;
  timestamp: string;
}

export interface CompanionEvent {
  sequenceId: number;
  conversationId: string;
  eventType: string;
  payloadJson: string;
  timestamp: string;
  eventId?: string;
  sourceDeviceId?: string;
  correlationId?: string;
  isReplayable?: boolean;
  schemaVersion?: number;
}

export const useSignalR = (hubUrl: string | null, fallbackHubUrl: string | null = null) => {
  const [isConnected, setIsConnected] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [activeApproval, setActiveApproval] = useState<ApprovalRequest | null>(null);
  const [incomingMessage, setIncomingMessage] = useState<ChatMessage | null>(null);
  const [agentStatusUpdate, setAgentStatusUpdate] = useState<{ agentId: string; isOnline: boolean } | null>(null);
  const [activeExecutionState, setActiveExecutionState] = useState<{ conversationId: string; prompt: string; isActive: boolean } | null>(null);
  const [incomingEvent, setIncomingEvent] = useState<CompanionEvent | null>(null);
  const connectionRef = useRef<signalR.HubConnection | null>(null);

  const hubUrlRef = useRef<string | null>(hubUrl);
  const fallbackHubUrlRef = useRef<string | null>(fallbackHubUrl);

  // Keep refs up-to-date on every render
  hubUrlRef.current = hubUrl;
  fallbackHubUrlRef.current = fallbackHubUrl;

  useEffect(() => {
    if (!hubUrl) return;

    let activeConnection: signalR.HubConnection | null = null;
    let isShutDown = false;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const buildAndSetupConnection = (url: string, isFallback: boolean) => {
      const builder = new signalR.HubConnectionBuilder()
        .withAutomaticReconnect()
        .configureLogging(signalR.LogLevel.Warning);

      if (isFallback) {
        builder.withUrl(url, {
          transport: signalR.HttpTransportType.LongPolling,
          headers: {
            'Bypass-Tunnel-Reminder': 'true'
          }
        });
      } else {
        builder.withUrl(url);
      }

      const connection = builder.build();

      connection.on('ReceiveTaskUpdate', (id: string, status: string, planJson?: string) => {
        setTasks((prevTasks) => {
          const index = prevTasks.findIndex((t) => t.id === id);
          if (index > -1) {
            const updated = [...prevTasks];
            updated[index] = { ...updated[index], status, planJson, updatedAt: new Date().toISOString() };
            return updated;
          }
          return prevTasks;
        });
      });

      connection.on('ReceiveApprovalRequest', (id: string, taskId: string, planStepsJson: string, conversationId?: string, nonce?: string, expiresAtUtc?: string) => {
        setActiveApproval({
          id,
          taskId,
          planStepsJson,
          status: 'Pending',
          createdAt: new Date().toISOString(),
          conversationId,
          nonce: nonce || '',
          expiresAtUtc: expiresAtUtc || new Date(Date.now() + 5 * 60 * 1000).toISOString() // fallback 5 min
        });
      });

      connection.on('ReceiveMessage', (conversationId: string, messageId: string, role: string, content: string, timestamp: string) => {
        setIncomingMessage({
          id: messageId,
          conversationId,
          role: role as 'user' | 'agent' | 'user-ide',
          content,
          timestamp,
        });

        // Auto-clear active desktop execution state when receiving agent responses
        if (role === 'agent') {
          setActiveExecutionState(null);
        }
      });

      connection.on('AgentStatusChanged', (agentId: string, isOnline: boolean) => {
        setAgentStatusUpdate({ agentId, isOnline });
      });

      connection.on('ReceiveAgentExecutionState', (conversationId: string, prompt: string, isActive: boolean) => {
        console.log('SignalR: ReceiveAgentExecutionState', conversationId, prompt, isActive);
        setActiveExecutionState(isActive ? { conversationId, prompt, isActive } : null);
      });

      connection.on('ReceiveEvent', (companionEvent: CompanionEvent) => {
        console.log('[SignalR] ReceiveEvent', companionEvent.sequenceId, companionEvent.eventType);
        setIncomingEvent(companionEvent);
      });

      connection.onclose(() => {
        setIsConnected(false);
        console.log('[SignalR] Transient connection closed silently. Relying on HTTP REST Poller.');
      });

      return connection;
    };

    const startConnection = async () => {
      if (isShutDown) return;

      // Clean up any existing connection first to prevent parallel connection leaks!
      if (connectionRef.current) {
        try {
          console.log('[SignalR] Cleaning up previous connection before starting new connect cycle...');
          const oldConnection = connectionRef.current;
          connectionRef.current = null;
          oldConnection.stop().catch(() => {});
        } catch {}
      }

      const currentHubUrl = hubUrlRef.current;
      if (!currentHubUrl) {
        console.log('[SignalR] No hub URL available in ref. Skipping connection attempt.');
        setIsConnected(false);
        return;
      }

      console.log(`[SignalR] Connecting to transient notification layer: ${currentHubUrl}`);
      activeConnection = buildAndSetupConnection(currentHubUrl, false);
      connectionRef.current = activeConnection;

      try {
        await activeConnection.start();
        console.log('[SignalR] Connected to local transient notification layer successfully');
        setIsConnected(true);
      } catch (err) {
        console.log('[SignalR] Local transient connection failed. Trying remote fallback...');
        if (isShutDown) return;

        // Clean up failed local connection
        if (activeConnection) {
          activeConnection.stop().catch(() => {});
          activeConnection = null;
        }

        // Try public fallback tunnel hub connection if available
        const currentFallbackHubUrl = fallbackHubUrlRef.current;
        if (currentFallbackHubUrl) {
          console.log(`[SignalR] Retrying with remote public fallback: ${currentFallbackHubUrl}`);
          activeConnection = buildAndSetupConnection(currentFallbackHubUrl, true);
          connectionRef.current = activeConnection;

          try {
            await activeConnection.start();
            console.log('[SignalR] Connected to remote public transient notification layer successfully!');
            setIsConnected(true);
          } catch (fallbackErr) {
            console.log('[SignalR] Remote fallback transient connection failed. Passive fallback active.');
            setIsConnected(false);
          }
        } else {
          setIsConnected(false);
        }
      }
    };

    startConnection();

    // AppState monitor for background -> active dynamic reconnection self-healing
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        console.log('[SignalR] App returned to foreground. Checking socket state...');
        const state = connectionRef.current?.state;
        if (state !== signalR.HubConnectionState.Connected && state !== signalR.HubConnectionState.Connecting) {
          console.log(`[SignalR] Socket state is ${state}. Automatically self-healing connection...`);
          startConnection();
        }
      }
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      isShutDown = true;
      appStateSubscription.remove();
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      if (connectionRef.current) {
        connectionRef.current.stop().catch(() => {});
        connectionRef.current = null;
      }
    };
  }, [hubUrl]);

  return {
    isConnected,
    tasks,
    setTasks,
    activeApproval,
    setActiveApproval,
    incomingMessage,
    agentStatusUpdate,
    activeExecutionState,
    setActiveExecutionState,
    incomingEvent,
    setIncomingEvent,
  };
};
