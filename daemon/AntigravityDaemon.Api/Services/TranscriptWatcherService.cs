using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using AntigravityDaemon.Core.Services;

namespace AntigravityDaemon.Api.Services
{
    public class TranscriptWatcherService : BackgroundService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<TranscriptWatcherService> _logger;
        private FileSystemWatcher? _watcher;
        private readonly string _brainPath = @"C:\Users\Hugo\.gemini\antigravity\brain";
        private DateTime _lastSyncTime = DateTime.MinValue;
        private readonly TimeSpan _debounceThreshold = TimeSpan.FromMilliseconds(500);

        public TranscriptWatcherService(IServiceProvider serviceProvider, ILogger<TranscriptWatcherService> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        protected override Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!Directory.Exists(_brainPath))
            {
                _logger.LogWarning($"[Watcher] Brain path does not exist: {_brainPath}. Watcher not started.");
                return Task.CompletedTask;
            }

            _logger.LogInformation($"[Watcher] Starting recursive FileSystemWatcher on {_brainPath}...");

            _watcher = new FileSystemWatcher(_brainPath)
            {
                Filter = "transcript.jsonl",
                IncludeSubdirectories = true,
                NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.CreationTime
            };

            _watcher.Changed += (s, e) => OnFileEvent(e.FullPath, stoppingToken);
            _watcher.Created += (s, e) => OnFileEvent(e.FullPath, stoppingToken);

            _watcher.EnableRaisingEvents = true;

            // Stop raising events when cancelled
            stoppingToken.Register(() => {
                if (_watcher != null)
                {
                    _watcher.EnableRaisingEvents = false;
                    _watcher.Dispose();
                }
            });

            return Task.CompletedTask;
        }

        private void OnFileEvent(string fullPath, CancellationToken cancellationToken)
        {
            // Debounce events to prevent thrashing on rapid successive writes
            if (DateTime.UtcNow - _lastSyncTime < _debounceThreshold)
            {
                return;
            }
            _lastSyncTime = DateTime.UtcNow;

            _logger.LogInformation($"[Watcher] Change detected in transcript: {fullPath}");

            // Run in a separate thread pool thread so we don't block the watcher callback
            _ = Task.Run(async () =>
            {
                try
                {
                    // Delay for lock-avoidance to let the writing process release file locks
                    await Task.Delay(250, cancellationToken);

                    using var scope = _serviceProvider.CreateScope();
                    var syncService = scope.ServiceProvider.GetRequiredService<ITranscriptSyncService>();
                    await syncService.SyncLocalConversationsAsync();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[Watcher] Error executing sync triggered by FileSystemWatcher.");
                }
            }, cancellationToken);
        }
    }
}
