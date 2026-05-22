using System.Collections.Generic;
using System.Threading.Tasks;
using AntigravityDaemon.Core.Models;

namespace AntigravityDaemon.Core.Services
{
    public interface ILlmService
    {
        Task<string> GenerateResponseAsync(List<ConversationMessage> messages, string systemPrompt);
    }
}
