using Microsoft.EntityFrameworkCore;
using AntigravityDaemon.Core.Models;
using System;

namespace AntigravityDaemon.Data
{
    public class DaemonDbContext : DbContext
    {
        public DaemonDbContext(DbContextOptions<DaemonDbContext> options) : base(options)
        {
        }

        public DbSet<TaskItem> Tasks => Set<TaskItem>();
        public DbSet<ApprovalRequest> Approvals => Set<ApprovalRequest>();
        public DbSet<TrustedDevice> TrustedDevices => Set<TrustedDevice>();
        public DbSet<AgentProfile> Agents => Set<AgentProfile>();
        public DbSet<Conversation> Conversations => Set<Conversation>();
        public DbSet<ConversationMessage> ConversationMessages => Set<ConversationMessage>();
        public DbSet<CompanionEvent> CompanionEvents => Set<CompanionEvent>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // CompanionEvent constraints
            modelBuilder.Entity<CompanionEvent>()
                .HasKey(e => e.SequenceId);
            modelBuilder.Entity<CompanionEvent>()
                .HasIndex(e => e.EventId)
                .IsUnique();

            // Configure relation: Task has many Approvals
            modelBuilder.Entity<ApprovalRequest>()
                .HasOne(a => a.Task)
                .WithMany()
                .HasForeignKey(a => a.TaskId)
                .OnDelete(DeleteBehavior.Cascade);

            // Configure relation: Approval has one Conversation
            modelBuilder.Entity<ApprovalRequest>()
                .HasOne(a => a.Conversation)
                .WithMany()
                .HasForeignKey(a => a.ConversationId)
                .OnDelete(DeleteBehavior.SetNull);

            // Task entity constraints
            modelBuilder.Entity<TaskItem>()
                .HasKey(t => t.Id);

            // TrustedDevices entity constraints
            modelBuilder.Entity<TrustedDevice>()
                .HasKey(d => d.Id);

            // AgentProfile constraints
            modelBuilder.Entity<AgentProfile>()
                .HasKey(a => a.Id);

            // Conversation → Agent (one-to-many)
            modelBuilder.Entity<Conversation>()
                .HasKey(c => c.Id);
            modelBuilder.Entity<Conversation>()
                .HasOne(c => c.Agent)
                .WithMany()
                .HasForeignKey(c => c.AgentId)
                .OnDelete(DeleteBehavior.Restrict);

            // ConversationMessage → Conversation (one-to-many)
            modelBuilder.Entity<ConversationMessage>()
                .HasKey(m => m.Id);
            modelBuilder.Entity<ConversationMessage>()
                .HasOne(m => m.Conversation)
                .WithMany(c => c.Messages)
                .HasForeignKey(m => m.ConversationId)
                .OnDelete(DeleteBehavior.Cascade);

            // Seed: pre-register the Antigravity agent
            var antigravityId = new Guid("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
            modelBuilder.Entity<AgentProfile>().HasData(new AgentProfile
            {
                Id = antigravityId,
                Name = "Antigravity",
                Description = "AI Coding Assistant — executa tarefas, analisa código e gera planos de implementação no teu workspace local.",
                IconEmoji = "⚡",
                Capabilities = "[\"Code Generation\",\"File Editing\",\"Task Execution\",\"Plan Approval\"]",
                IsOnline = false,
                LastPing = DateTime.UtcNow,
                RegisteredAt = DateTime.UtcNow,
            });
        }
    }
}
