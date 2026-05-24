using System;
using System.ComponentModel.DataAnnotations;

namespace AntigravityDaemon.Core.Models
{
    public class CompanionEvent
    {
        [Key]
        public long SequenceId { get; set; }

        public Guid EventId { get; set; }

        public Guid ConversationId { get; set; }

        public string EventType { get; set; } = string.Empty;

        public string PayloadJson { get; set; } = string.Empty;

        public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;

        public string SourceDeviceId { get; set; } = "PC-IDE";

        public string CorrelationId { get; set; } = string.Empty;

        public bool IsReplayable { get; set; } = true;

        public int SchemaVersion { get; set; } = 1;
    }
}
