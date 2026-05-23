import { useEffect, useState, useRef, useCallback } from 'react';
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
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'agent' | 'user-ide';
  content: string;
  timestamp: string;
}

export const useSignalR = (hubUrl: string | null, fallbackHubUrl: string | null = null) => {
  const [isConnected, setIsConnected] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [activeApproval, setActiveApproval] = useState<ApprovalRequest | null>(null);
  const [incomingMessage, setIncomingMessage] = useState<ChatMessage | null>(null);
  const [agentStatusUpdate, setAgentStatusUpdate] = useState<{ agentId: string; isOnline: boolean } | null>(null);
  const [activeExecutionState, setActiveExecutionState] = useState<{ conversationId: string; prompt: string; isActive: boolean } | null>(null);
  const connectionRef = useRef<signalR.HubConnection | null>(null);

  useEffect(() => {
    if (!hubUrl) return;

    let activeConnection: signalR.HubConnection | null = null;
    let isShutDown = false;

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

      connection.on('ReceiveApprovalRequest', (id: string, taskId: string, planStepsJson: string, conversationId?: string) => {
        setActiveApproval({
          id,
          taskId,
          planStepsJson,
          status: 'Pending',
          createdAt: new Date().toISOString(),
          conversationId,
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

      connection.onclose(() => {
        if (!isShutDown) setIsConnected(false);
      });
      connection.onreconnecting(() => {
        if (!isShutDown) setIsConnected(false);
      });
      connection.onreconnected(() => {
        if (!isShutDown) setIsConnected(true);
      });

      return connection;
    };

    const startConnection = async () => {
      if (isShutDown) return;

      console.log(`[SignalR] Attempting local hub connection: ${hubUrl}`);
      activeConnection = buildAndSetupConnection(hubUrl, false);
      connectionRef.current = activeConnection;

      try {
        const startPromise = activeConnection.start();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Local SignalR connection timeout')), 3500)
        );

        await Promise.race([startPromise, timeoutPromise]);
        console.log('[SignalR] Connected to local SignalR Hub successfully');
        setIsConnected(true);
      } catch (err) {
        console.warn('[SignalR] Local connection failed:', err);
        if (isShutDown) return;

        // Clean up failed local connection
        if (activeConnection) {
          activeConnection.stop().catch(() => {});
          activeConnection = null;
        }

        // Try public fallback tunnel hub connection if available
        if (fallbackHubUrl) {
          console.log(`[SignalR] Local failed. Retrying with remote public fallback: ${fallbackHubUrl}`);
          activeConnection = buildAndSetupConnection(fallbackHubUrl, true);
          connectionRef.current = activeConnection;

          try {
            await activeConnection.start();
            console.log('[SignalR] Connected to remote public SignalR Hub successfully!');
            setIsConnected(true);
          } catch (fallbackErr) {
            console.warn('[SignalR] Remote fallback connection also failed. Retrying in 5 seconds...', fallbackErr);
            setIsConnected(false);
            if (!isShutDown) {
              setTimeout(startConnection, 5000);
            }
          }
        } else {
          setIsConnected(false);
          if (!isShutDown) {
            setTimeout(startConnection, 5000);
          }
        }
      }
    };

    startConnection();

    return () => {
      isShutDown = true;
      if (connectionRef.current) {
        connectionRef.current.stop().catch(() => {});
        connectionRef.current = null;
      }
    };
  }, [hubUrl, fallbackHubUrl]);

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
  };
};
