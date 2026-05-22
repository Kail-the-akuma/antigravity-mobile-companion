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

export const useSignalR = (hubUrl: string | null) => {
  const [isConnected, setIsConnected] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [activeApproval, setActiveApproval] = useState<ApprovalRequest | null>(null);
  const [incomingMessage, setIncomingMessage] = useState<ChatMessage | null>(null);
  const [agentStatusUpdate, setAgentStatusUpdate] = useState<{ agentId: string; isOnline: boolean } | null>(null);
  const [activeExecutionState, setActiveExecutionState] = useState<{ conversationId: string; prompt: string; isActive: boolean } | null>(null);
  const connectionRef = useRef<signalR.HubConnection | null>(null);

  useEffect(() => {
    if (!hubUrl) return;

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl)
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    connectionRef.current = connection;

    const startConnection = async () => {
      try {
        await connection.start();
        console.log('Connected to SignalR Hub successfully');
        setIsConnected(true);
      } catch (err) {
        console.warn('SignalR connection failed, retrying in 5 seconds...', err);
        setIsConnected(false);
        setTimeout(startConnection, 5000);
      }
    };

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

    // New: real-time conversation messages
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

    // New: agent online/offline status changes
    connection.on('AgentStatusChanged', (agentId: string, isOnline: boolean) => {
      setAgentStatusUpdate({ agentId, isOnline });
    });

    // New: Active agent execution state
    connection.on('ReceiveAgentExecutionState', (conversationId: string, prompt: string, isActive: boolean) => {
      console.log('SignalR: ReceiveAgentExecutionState', conversationId, prompt, isActive);
      setActiveExecutionState(isActive ? { conversationId, prompt, isActive } : null);
    });

    connection.onclose(() => setIsConnected(false));
    connection.onreconnecting(() => setIsConnected(false));
    connection.onreconnected(() => setIsConnected(true));

    startConnection();

    return () => {
      if (connectionRef.current) {
        connectionRef.current.stop();
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
  };
};
