using System;

namespace AntigravityDaemon.Core.Models
{
    public class TaskItem
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Prompt { get; set; } = string.Empty;
        public string Status { get; set; } = "Running"; // Running, Completed, PendingApproval, Failed
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
        public string PlanJson { get; set; } = "[]";
        public string ModifiedFilesJson { get; set; } = "[]";
    }
}
