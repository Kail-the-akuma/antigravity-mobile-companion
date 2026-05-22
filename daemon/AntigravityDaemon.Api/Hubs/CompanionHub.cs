using Microsoft.AspNetCore.SignalR;
using System.Threading.Tasks;

namespace AntigravityDaemon.Api.Hubs
{
    public class CompanionHub : Hub
    {
        public override async Task OnConnectedAsync()
        {
            await base.OnConnectedAsync();
            System.Console.WriteLine($"Client connected to CompanionHub: {Context.ConnectionId}");
        }

        public override async Task OnDisconnectedAsync(System.Exception? exception)
        {
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
    }
}
