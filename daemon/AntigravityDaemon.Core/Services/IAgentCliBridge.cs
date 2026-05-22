using System.Threading.Tasks;

namespace AntigravityDaemon.Core.Services
{
    public interface IAgentCliBridge
    {
        Task<string> RunAgentCliAsync(string[] arguments);
        Task<string> RunAgentNewConversationAsync(string prompt);
        Task RunAgentSendMessageAsync(string remoteId, string content);
        Task<string> ResolveAntigravityLsAddressAsync();
        Task<string> ResolveAntigravityCsrfTokenAsync();
        Task<string?> ResolveAntigravityProjectIdAsync();
    }
}
