using Microsoft.EntityFrameworkCore;
using AntigravityDaemon.Core.Models;

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

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // Configure relation: Task has many Approvals
            modelBuilder.Entity<ApprovalRequest>()
                .HasOne(a => a.Task)
                .WithMany()
                .HasForeignKey(a => a.TaskId)
                .OnDelete(DeleteBehavior.Cascade);

            // Task entity constraints
            modelBuilder.Entity<TaskItem>()
                .HasKey(t => t.Id);

            // TrustedDevices entity constraints
            modelBuilder.Entity<TrustedDevice>()
                .HasKey(d => d.Id);
        }
    }
}
