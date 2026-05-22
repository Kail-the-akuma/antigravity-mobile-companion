using Microsoft.AspNetCore.SignalR;
using System.Threading.Tasks;

namespace AntigravityDaemon.Api.Hubs
{
    public class CompanionHub : Hub
    {
        public override async Task OnConnectedAsync()
        {
            await base.OnConnectedAsync();
            // Client connected
            System.Console.WriteLine($"Client connected to CompanionHub: {Context.ConnectionId}");
        }

        public override async Task OnDisconnectedAsync(System.Exception? exception)
        {
            // Client disconnected
            System.Console.WriteLine($"Client disconnected from CompanionHub: {Context.ConnectionId}");
            await base.OnDisconnectedAsync(exception);
        }

        // Method to send status update to clients
        public async Task BroadcastTaskUpdate(string taskId, string status, string planJson)
        {
            await Clients.All.SendAsync("ReceiveTaskUpdate", taskId, status, planJson);
        }

        // Method to send approval request to clients
        public async Task SendApprovalRequest(string approvalId, string taskId, string planStepsJson)
        {
            await Clients.All.SendAsync("ReceiveApprovalRequest", approvalId, taskId, planStepsJson);
        }
    }
}
