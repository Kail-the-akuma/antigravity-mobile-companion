using System;

namespace AntigravityDaemon.Core.Models
{
    public class AgentProfile
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Name { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string IconEmoji { get; set; } = "🤖";
        public string Capabilities { get; set; } = "[]"; // JSON array of capability strings
        public bool IsOnline { get; set; } = false;
        public DateTime LastPing { get; set; } = DateTime.UtcNow;
        public DateTime RegisteredAt { get; set; } = DateTime.UtcNow;
    }
}
