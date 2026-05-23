using Microsoft.AspNetCore.SignalR;
using System.Threading.Tasks;

namespace AntigravityDaemon.Api.Hubs
{
    public class CompanionHub : Hub
    {
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, bool> _activeConnections = 
            new System.Collections.Concurrent.ConcurrentDictionary<string, bool>();

        public static bool HasActiveConnections => !_activeConnections.IsEmpty;

        public override async Task OnConnectedAsync()
        {
            _activeConnections.TryAdd(Context.ConnectionId, true);
            await base.OnConnectedAsync();
            System.Console.WriteLine($"Client connected to CompanionHub: {Context.ConnectionId}");
        }

        public override async Task OnDisconnectedAsync(System.Exception? exception)
        {
            _activeConnections.TryRemove(Context.ConnectionId, out _);
            System.Console.WriteLine($"Client disconnected from CompanionHub: {Context.ConnectionId}");
            await base.OnDisconnectedAsync(exception);
        }

        // Task lifecycle events
        public async Task BroadcastTaskUpdate(string taskId, string status, string planJson)
        {
            await Clients.All.SendAsync("ReceiveTaskUpdate", taskId, status, planJson);
        }

        // Plan approval request
        public async Task SendApprovalRequest(string approvalId, string taskId, string planStepsJson)
        {
            await Clients.All.SendAsync("ReceiveApprovalRequest", approvalId, taskId, planStepsJson);
        }

        // Conversation message delivery
        public async Task BroadcastMessage(string conversationId, string messageId, string role, string content, string timestamp)
        {
            await Clients.All.SendAsync("ReceiveMessage", conversationId, messageId, role, content, timestamp);
        }

        // Agent online/offline status
        public async Task BroadcastAgentStatus(string agentId, bool isOnline)
        {
            await Clients.All.SendAsync("AgentStatusChanged", agentId, isOnline);
        }

        // Active agent execution state (from desktop IDE or background runner)
        public async Task BroadcastAgentExecutionState(string conversationId, string prompt, bool isActive)
        {
            await Clients.All.SendAsync("ReceiveAgentExecutionState", conversationId, prompt, isActive);
        }
    }
}
