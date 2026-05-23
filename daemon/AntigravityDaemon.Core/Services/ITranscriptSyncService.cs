using System;
using System.Threading.Tasks;

namespace AntigravityDaemon.Core.Services
{
    public interface ITranscriptSyncService
    {
        Task<string> PollAgentResponseAsync(string remoteId, string expectedContent, int lastStepIndex = -1);
        Task SyncLocalConversationsAsync();
        string SanitizeMessageContent(string content, string role);
        Task WriteLastPromptToFileAsync(string agentName, Guid convId, string prompt);
        void SetAgentExecuting(Guid conversationId, bool isActive);
        bool IsAgentExecuting(Guid conversationId);
    }
}
