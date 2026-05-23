using System;
using System.ComponentModel.DataAnnotations;

namespace AntigravityDaemon.Core.Models
{
    public class CompanionEvent
    {
        [Key]
        public long SequenceId { get; set; }
        public Guid ConversationId { get; set; }
        public string EventType { get; set; } = string.Empty;
        public string PayloadJson { get; set; } = string.Empty;
        public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    }
}
