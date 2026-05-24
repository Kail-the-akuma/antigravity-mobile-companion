using System;
using System.IO;
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
            // Executamos em background para não bloquear a inicialização rápida do servidor Web Kestrel
            _ = Task.Run(async () =>
            {
                try
                {
                    var baseDir = AppDomain.CurrentDomain.BaseDirectory;
                    var binaryPath = Path.Combine(baseDir, "cloudflared.exe");

                    if (!File.Exists(binaryPath))
                    {
                        Console.ForegroundColor = ConsoleColor.Cyan;
                        Console.WriteLine("🚇 [Tunnel] O executável autónomo 'cloudflared.exe' não foi encontrado.");
                        Console.WriteLine("🚇 [Tunnel] A descarregar a versão oficial mais recente diretamente da Cloudflare...");
                        Console.ResetColor();

                        string downloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
                        
                        using (var client = new HttpClient())
                        {
                            client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
                            using (var response = await client.GetAsync(downloadUrl, HttpCompletionOption.ResponseHeadersRead))
                            {
                                response.EnsureSuccessStatusCode();
                                
                                var totalBytes = response.Content.Headers.ContentLength;
                                using (var contentStream = await response.Content.ReadAsStreamAsync())
                                using (var fileStream = new FileStream(binaryPath, FileMode.Create, FileAccess.Write, FileShare.None, 8192, true))
                                {
                                    var buffer = new byte[8192];
                                    long totalRead = 0;
                                    int bytesRead;
                                    int lastReportedPercent = -5;

                                    while ((bytesRead = await contentStream.ReadAsync(buffer, 0, buffer.Length)) > 0)
                                    {
                                        await fileStream.WriteAsync(buffer, 0, bytesRead);
                                        totalRead += bytesRead;

                                        if (totalBytes.HasValue && totalBytes.Value > 0)
                                        {
                                            int pct = (int)((double)totalRead / totalBytes.Value * 100);
                                            if (pct >= lastReportedPercent + 5)
                                            {
                                                Console.Write($"\r🚇 [Tunnel] Progresso do download: {pct}% ({totalRead / 1024 / 1024}MB / {totalBytes.Value / 1024 / 1024}MB)");
                                                lastReportedPercent = pct;
                                            }
                                        }
                                    }
                                    Console.WriteLine();
                                }
                            }
                        }

                        Console.ForegroundColor = ConsoleColor.Green;
                        Console.WriteLine("🚇 [Tunnel] Download concluído com sucesso! O cloudflared.exe está pronto.");
                        Console.ResetColor();
                    }

                    var config = services.GetRequiredService<Microsoft.Extensions.Configuration.IConfiguration>();
                    var token = config["CloudflareTunnelToken"];
                    var customDomain = config["CloudflareTunnelDomain"];
                    bool hasToken = !string.IsNullOrEmpty(token);

                    Console.ForegroundColor = ConsoleColor.Cyan;
                    if (hasToken)
                    {
                        Console.WriteLine($"🚇 [Tunnel] A iniciar o Cloudflare Tunnel dedicado usando o Token...");
                    }
                    else
                    {
                        Console.WriteLine($"🚇 [Tunnel] A iniciar o Cloudflare Quick Tunnel na porta {port}...");
                    }
                    Console.ResetColor();

                    var arguments = hasToken
                        ? $"tunnel --no-autoupdate run --token {token}"
                        : $"tunnel --url http://127.0.0.1:{port}";

                    var psi = new ProcessStartInfo
                    {
                        FileName = binaryPath,
                        Arguments = arguments,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };

                    // Se temos um domínio fixo e token mapeados, definimos a URL estática imediatamente
                    if (hasToken && !string.IsNullOrEmpty(customDomain))
                    {
                        var formattedDomain = customDomain.StartsWith("http") ? customDomain : $"https://{customDomain}";
                        PublicTunnelUrl = formattedDomain;
                        Console.ForegroundColor = ConsoleColor.Green;
                        Console.WriteLine($"🚇 [Tunnel] Túnel Cloudflare estático dedicado ativo: {PublicTunnelUrl}");
                        Console.ResetColor();

                        // Notificar dispositivos emparelhados sobre o túnel ativo permanente
                        SendTunnelUpdatePush(services, PublicTunnelUrl);
                    }

                    var tryCloudflareRegex = new Regex(@"https://[a-zA-Z0-9.-]+\.trycloudflare\.com", RegexOptions.Compiled);

                    _tunnelProcess = new Process { StartInfo = psi };
                    
                    void HandleTunnelLog(string? data, bool isError)
                    {
                        if (string.IsNullOrEmpty(data)) return;

                        if (isError)
                        {
                            Console.ForegroundColor = ConsoleColor.Red;
                            Console.WriteLine($"🚇 [Tunnel Log] {data}");
                            Console.ResetColor();
                        }
                        else
                        {
                            Console.WriteLine($"🚇 [Tunnel Output] {data}");
                        }

                        // Apenas capturar URL dinâmica se não tivermos uma URL estática já definida
                        if (PublicTunnelUrl == null)
                        {
                            var match = tryCloudflareRegex.Match(data);
                            if (match.Success)
                            {
                                PublicTunnelUrl = match.Value.Trim();
                                Console.ForegroundColor = ConsoleColor.Green;
                                Console.WriteLine($"🚇 [Tunnel] URL pública dinâmica gerada: {PublicTunnelUrl}");
                                Console.ResetColor();

                                // Enviar notificação push aos dispositivos emparelhados em background
                                SendTunnelUpdatePush(services, PublicTunnelUrl);
                            }
                        }
                    }

                    _tunnelProcess.OutputDataReceived += (sender, e) => HandleTunnelLog(e.Data, false);
                    _tunnelProcess.ErrorDataReceived += (sender, e) => HandleTunnelLog(e.Data, true);

                    _tunnelProcess.Start();
                    _tunnelProcess.BeginOutputReadLine();
                    _tunnelProcess.BeginErrorReadLine();
                }
                catch (Exception ex)
                {
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine($"🚇 [Tunnel] Erro crítico ao iniciar o processo de túnel: {ex.Message}");
                    Console.ResetColor();
                }
            });
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
