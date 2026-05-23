using System;

namespace AntigravityDaemon.Core.Models
{
    public class ApprovalRequest
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid TaskId { get; set; }
        public TaskItem Task { get; set; } = null!;
        public string PlanStepsJson { get; set; } = "[]";
        public Guid? ConversationId { get; set; }
        public Conversation? Conversation { get; set; }
        public string Status { get; set; } = "Pending"; // Pending, Approved, Rejected
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
        public string Signature { get; set; } = string.Empty;
        public string Nonce { get; set; } = string.Empty;
        public DateTime? ExpiresAt { get; set; }
    }
}
