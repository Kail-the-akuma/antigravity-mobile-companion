using System;
using System.Collections.Generic;

namespace AntigravityDaemon.Core.Models
{
    public class Conversation
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid AgentId { get; set; }
        public AgentProfile? Agent { get; set; }
        public string Title { get; set; } = "Nova Conversa";
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
        public string? RemoteConversationId { get; set; }
        public bool IsPinned { get; set; } = false;
        public bool IsDeleted { get; set; } = false;
        public ICollection<ConversationMessage> Messages { get; set; } = new List<ConversationMessage>();
    }
}
