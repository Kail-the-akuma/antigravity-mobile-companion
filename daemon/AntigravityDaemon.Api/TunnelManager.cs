using System;
using System.Diagnostics;
using System.Text.RegularExpressions;

namespace AntigravityDaemon.Api
{
    public static class TunnelManager
    {
        private static Process? _tunnelProcess;
        public static string? PublicTunnelUrl { get; private set; }

        public static void StartTunnel(int port)
        {
            try
            {
                Console.ForegroundColor = ConsoleColor.Cyan;
                Console.WriteLine($"🚇 [Tunnel] Starting localtunnel on port {port}...");
                Console.ResetColor();

                var psi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = $"/c npx localtunnel --port {port}",
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
