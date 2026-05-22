using System;

namespace AntigravityDaemon.Core.Models
{
    public class TrustedDevice
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string DeviceName { get; set; } = string.Empty;
        public string SecretKey { get; set; } = string.Empty;
        public string? PushToken { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
