using System;
using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Net.Http;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;

namespace AntigravityDaemon.Api
{
    public static class TunnelManager
    {
        private static Process? _tunnelProcess;
        public static string? PublicTunnelUrl { get; private set; }

        public static void StartTunnel(int port, IServiceProvider services)
        {
            try
            {
                Console.ForegroundColor = ConsoleColor.Cyan;
                Console.WriteLine($"🚇 [Tunnel] Starting localtunnel on port {port}...");
                Console.ResetColor();

                var psi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = $"/c npx localtunnel --port {port} --local-host 127.0.0.1",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                _tunnelProcess = new Process { StartInfo = psi };
                _tunnelProcess.OutputDataReceived += (sender, e) =>
                {
                    if (!string.IsNullOrEmpty(e.Data))
                    {
                        Console.WriteLine($"🚇 [Tunnel Output] {e.Data}");
                        if (e.Data.Contains("your url is:"))
                        {
                            var match = Regex.Match(e.Data, @"https?://[^\s]+");
                            if (match.Success)
                            {
                                PublicTunnelUrl = match.Value.Trim();
                                Console.ForegroundColor = ConsoleColor.Green;
                                Console.WriteLine($"🚇 [Tunnel] Public URL generated: {PublicTunnelUrl}");
                                Console.ResetColor();

                                // Send active push notification to update all registered telemóveis in the background!
                                SendTunnelUpdatePush(services, PublicTunnelUrl);
                            }
                        }
                    }
                };
                _tunnelProcess.ErrorDataReceived += (sender, e) =>
                {
                    if (!string.IsNullOrEmpty(e.Data))
                    {
                        Console.ForegroundColor = ConsoleColor.Red;
                        Console.WriteLine($"🚇 [Tunnel Error] {e.Data}");
                        Console.ResetColor();
                    }
                };

                _tunnelProcess.Start();
                _tunnelProcess.BeginOutputReadLine();
                _tunnelProcess.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"🚇 [Tunnel] Failed to start tunnel process: {ex.Message}");
                Console.ResetColor();
            }
        }

        private static void SendTunnelUpdatePush(IServiceProvider services, string newUrl)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    // Delay slightly to let the Kestrel webserver settle
                    await Task.Delay(1500);

                    using (var scope = services.CreateScope())
                    {
                        var db = scope.ServiceProvider.GetRequiredService<AntigravityDaemon.Data.DaemonDbContext>();
                        var pushTokens = db.TrustedDevices
                            .Where(d => d.PushToken != null && d.PushToken != "")
                            .Select(d => d.PushToken)
                            .ToList();

                        if (pushTokens.Any())
                        {
                            var clientFactory = scope.ServiceProvider.GetRequiredService<IHttpClientFactory>();
                            var client = clientFactory.CreateClient();
                            var payloadList = pushTokens.Select(token => new
                            {
                                to = token,
                                sound = "default",
                                title = "⚡ Antigravity - Ligação Atualizada",
                                body = "O terminal Antigravity foi reiniciado e o túnel seguro foi atualizado.",
                                data = new
                                {
                                    type = "TunnelUrlUpdate",
                                    tunnelUrl = newUrl
                                }
                            }).ToList();

                            var json = System.Text.Json.JsonSerializer.Serialize(payloadList);
                            var content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
                            var response = await client.PostAsync("https://exp.host/--/api/v2/push/send", content);
                            
                            if (response.IsSuccessStatusCode)
                            {
                                Console.ForegroundColor = ConsoleColor.Green;
                                Console.WriteLine($"🚇 [Tunnel Push] Dynamic URL update notification successfully sent to {pushTokens.Count} companion device(s) via Expo!");
                                Console.ResetColor();
                            }
                            else
                            {
                                Console.ForegroundColor = ConsoleColor.Yellow;
                                Console.WriteLine($"🚇 [Tunnel Push] Expo Push Server returned status: {response.StatusCode}");
                                Console.ResetColor();
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine($"🚇 [Tunnel Push Error] Failed to send dynamic update push: {ex.Message}");
                    Console.ResetColor();
                }
            });
        }

        public static void StopTunnel()
        {
            try
            {
                if (_tunnelProcess != null && !_tunnelProcess.HasExited)
                {
                    Console.WriteLine("🚇 [Tunnel] Stopping localtunnel process...");
                    
                    // Kill process tree cleanly
                    _tunnelProcess.Kill(entireProcessTree: true);
                    _tunnelProcess.Dispose();
                    _tunnelProcess = null;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"🚇 [Tunnel] Error stopping tunnel: {ex.Message}");
            }
        }
    }
}
