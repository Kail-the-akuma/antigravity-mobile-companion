using System;

namespace AntigravityDaemon.Core.Models
{
    public class ConversationMessage
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid ConversationId { get; set; }
        public Conversation? Conversation { get; set; }
        public string Role { get; set; } = "user"; // "user" | "agent"
        public string Content { get; set; } = string.Empty;
        public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    }
}
