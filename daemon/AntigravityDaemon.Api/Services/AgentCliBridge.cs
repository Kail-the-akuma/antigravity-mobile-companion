using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using AntigravityDaemon.Core.Services;

namespace AntigravityDaemon.Api.Services
{
    public class AgentCliBridge : IAgentCliBridge
    {
        public async Task<string> RunAgentCliAsync(string[] arguments)
        {
            string lsAddress = await ResolveAntigravityLsAddressAsync();
            string csrfToken = await ResolveAntigravityCsrfTokenAsync();
            string? projectId = await ResolveAntigravityProjectIdAsync();

            var startInfo = new ProcessStartInfo
            {
                FileName = @"C:\Users\Hugo\AppData\Local\Programs\Antigravity\resources\bin\language_server.exe",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            startInfo.ArgumentList.Add("agentapi");
            foreach (var arg in arguments)
            {
                startInfo.ArgumentList.Add(arg);
            }
            
            // Clear and explicitly populate environment variables to isolate from parent IDE session
            startInfo.EnvironmentVariables.Clear();
            foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
            {
                string key = entry.Key?.ToString() ?? string.Empty;
                string val = entry.Value?.ToString() ?? string.Empty;

                if (string.IsNullOrEmpty(key)) continue;

                if (key.StartsWith("ANTIGRAVITY_", StringComparison.OrdinalIgnoreCase) ||
                    key.StartsWith("AGY_", StringComparison.OrdinalIgnoreCase))
                {
                    // Do NOT copy ANY Antigravity env vars here. We will set them explicitly below.
                    continue;
                }

                startInfo.EnvironmentVariables[key] = val;
            }

            startInfo.EnvironmentVariables["ANTIGRAVITY_LS_ADDRESS"] = lsAddress;
            startInfo.EnvironmentVariables["ANTIGRAVITY_CSRF_TOKEN"] = csrfToken;
            
            if (!string.IsNullOrEmpty(projectId))
            {
                startInfo.EnvironmentVariables["ANTIGRAVITY_PROJECT_ID"] = projectId;
                
                // Only propagate ANTIGRAVITY_SOURCE_METADATA if we actually have a project ID to avoid the gRPC missing project_id error!
                string? sourceMetadata = Environment.GetEnvironmentVariable("ANTIGRAVITY_SOURCE_METADATA");
                if (!string.IsNullOrEmpty(sourceMetadata))
                {
                    startInfo.EnvironmentVariables["ANTIGRAVITY_SOURCE_METADATA"] = sourceMetadata;
                }
            }

            using var process = new Process { StartInfo = startInfo };
            process.Start();

            string output = await process.StandardOutput.ReadToEndAsync();
            string error = await process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();

            if (process.ExitCode != 0)
            {
                throw new Exception($"language_server.exe agentapi failed with exit code {process.ExitCode}. Output: {output}. Error: {error}");
            }

            return output;
        }

        public async Task<string> ResolveAntigravityLsAddressAsync()
        {
            // 1. Check current process env
            string? envAddress = Environment.GetEnvironmentVariable("ANTIGRAVITY_LS_ADDRESS");
            if (!string.IsNullOrEmpty(envAddress))
            {
                return envAddress;
            }

            // 2. Check User environment variables
            string? userAddress = Environment.GetEnvironmentVariable("ANTIGRAVITY_LS_ADDRESS", EnvironmentVariableTarget.User);
            if (!string.IsNullOrEmpty(userAddress))
            {
                return userAddress;
            }

            // 3. Check Machine environment variables
            string? machineAddress = Environment.GetEnvironmentVariable("ANTIGRAVITY_LS_ADDRESS", EnvironmentVariableTarget.Machine);
            if (!string.IsNullOrEmpty(machineAddress))
            {
                return machineAddress;
            }

            // 4. Try parsing language_server.log
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string defaultLogPath = Path.Combine(appData, "Antigravity", "logs", "language_server.log");

            // Secure best practice: check absolute candidate paths with read-only/share-read flags
            var candidatePaths = new List<string>();
            if (!string.IsNullOrEmpty(appData))
            {
                candidatePaths.Add(defaultLogPath);
            }
            candidatePaths.Add(@"C:\Users\Hugo\AppData\Roaming\Antigravity\logs\language_server.log");

            foreach (var logPath in candidatePaths)
            {
                if (File.Exists(logPath))
                {
                    try
                    {
                        using var fs = new FileStream(logPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                        using var reader = new StreamReader(fs);
                        string? line;
                        string? foundPort = null;
                        while ((line = await reader.ReadLineAsync()) != null)
                        {
                            if (line.Contains("Language server listening on random port at") && line.Contains("for HTTP"))
                            {
                                int idxStart = line.IndexOf("port at ") + "port at ".Length;
                                int idxEnd = line.IndexOf(" for HTTP");
                                if (idxStart > 0 && idxEnd > idxStart)
                                {
                                    string portStr = line.Substring(idxStart, idxEnd - idxStart).Trim();
                                    if (int.TryParse(portStr, out _))
                                    {
                                        foundPort = portStr;
                                    }
                                }
                            }
                        }

                        if (!string.IsNullOrEmpty(foundPort))
                        {
                            return $"localhost:{foundPort}";
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Error reading language server log at {logPath}: {ex}");
                    }
                }
            }

            // 5. Secondary fallback: main.log (parse DevTools/dynamic URL)
            string defaultMainLogPath = Path.Combine(appData, "Antigravity", "logs", "main.log");
            var mainCandidatePaths = new List<string>();
            if (!string.IsNullOrEmpty(appData))
            {
                mainCandidatePaths.Add(defaultMainLogPath);
            }
            mainCandidatePaths.Add(@"C:\Users\Hugo\AppData\Roaming\Antigravity\logs\main.log");

            foreach (var mainLogPath in mainCandidatePaths)
            {
                if (File.Exists(mainLogPath))
                {
                    try
                    {
                        using var fs = new FileStream(mainLogPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                        using var reader = new StreamReader(fs);
                        string? line;
                        string? foundPort = null;
                        while ((line = await reader.ReadLineAsync()) != null)
                        {
                            if (line.Contains("Port changed! Reloading all windows with URL: https://127.0.0.1:"))
                            {
                                int idxStart = line.IndexOf("127.0.0.1:") + "127.0.0.1:".Length;
                                int idxEnd = line.IndexOf("/", idxStart);
                                if (idxStart > 0 && idxEnd > idxStart)
                                {
                                    string portStr = line.Substring(idxStart, idxEnd - idxStart).Trim();
                                    if (int.TryParse(portStr, out int portVal))
                                    {
                                        foundPort = (portVal + 1).ToString();
                                    }
                                }
                            }
                        }

                        if (!string.IsNullOrEmpty(foundPort))
                        {
                            return $"localhost:{foundPort}";
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Error reading main log at {mainLogPath}: {ex}");
                    }
                }
            }

            throw new Exception("ANTIGRAVITY_LS_ADDRESS is not set and could not be resolved from environment variables or active logs. Please make sure Antigravity IDE is running.");
        }

        public async Task<string> ResolveAntigravityCsrfTokenAsync()
        {
            // 1. Check current process environment variable
            string? envToken = Environment.GetEnvironmentVariable("ANTIGRAVITY_CSRF_TOKEN");
            if (!string.IsNullOrEmpty(envToken))
            {
                return envToken;
            }

            // 2. Check User environment variables
            string? userToken = Environment.GetEnvironmentVariable("ANTIGRAVITY_CSRF_TOKEN", EnvironmentVariableTarget.User);
            if (!string.IsNullOrEmpty(userToken))
            {
                return userToken;
            }

            // 3. Check Machine environment variables
            string? machineToken = Environment.GetEnvironmentVariable("ANTIGRAVITY_CSRF_TOKEN", EnvironmentVariableTarget.Machine);
            if (!string.IsNullOrEmpty(machineToken))
            {
                return machineToken;
            }

            // 4. Try parsing main.log (parse spawned --csrf_token argument)
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string defaultMainLogPath = Path.Combine(appData, "Antigravity", "logs", "main.log");

            var candidatePaths = new List<string>();
            if (!string.IsNullOrEmpty(appData))
            {
                candidatePaths.Add(defaultMainLogPath);
            }
            candidatePaths.Add(@"C:\Users\Hugo\AppData\Roaming\Antigravity\logs\main.log");

            foreach (var path in candidatePaths)
            {
                if (File.Exists(path))
                {
                    try
                    {
                        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                        using var reader = new StreamReader(fs);
                        string? line;
                        string? foundToken = null;
                        while ((line = await reader.ReadLineAsync()) != null)
                        {
                            if (line.Contains("--csrf_token"))
                            {
                                int idxStart = line.IndexOf("--csrf_token ") + "--csrf_token ".Length;
                                if (idxStart > "--csrf_token ".Length)
                                {
                                    int idxEnd = line.IndexOf(" ", idxStart);
                                    string tokenVal = idxEnd > idxStart 
                                        ? line.Substring(idxStart, idxEnd - idxStart).Trim() 
                                        : line.Substring(idxStart).Trim();
                                    if (!string.IsNullOrEmpty(tokenVal))
                                    {
                                        foundToken = tokenVal;
                                    }
                                }
                            }
                        }

                        if (!string.IsNullOrEmpty(foundToken))
                        {
                            return foundToken;
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Error reading main log at {path} for CSRF token: {ex}");
                    }
                }
            }

            throw new Exception("ANTIGRAVITY_CSRF_TOKEN is not set and could not be resolved from environment variables or active logs.");
        }

        public Task<string?> ResolveAntigravityProjectIdAsync()
        {
            // 1. Process environment
            string? envProjectId = Environment.GetEnvironmentVariable("ANTIGRAVITY_PROJECT_ID");
            if (!string.IsNullOrEmpty(envProjectId))
            {
                return Task.FromResult<string?>(envProjectId);
            }

            // 2. User environment
            string? userProjectId = Environment.GetEnvironmentVariable("ANTIGRAVITY_PROJECT_ID", EnvironmentVariableTarget.User);
            if (!string.IsNullOrEmpty(userProjectId))
            {
                return Task.FromResult<string?>(userProjectId);
            }

            // 3. Machine environment
            string? machineProjectId = Environment.GetEnvironmentVariable("ANTIGRAVITY_PROJECT_ID", EnvironmentVariableTarget.Machine);
            if (!string.IsNullOrEmpty(machineProjectId))
            {
                return Task.FromResult<string?>(machineProjectId);
            }

            return Task.FromResult<string?>(null);
        }

        public async Task<string> RunAgentNewConversationAsync(string prompt)
        {
            string output = await RunAgentCliAsync(new[] { "new-conversation", prompt });

            using var doc = JsonDocument.Parse(output);
            var root = doc.RootElement;
            if (root.TryGetProperty("response", out var response) &&
                response.TryGetProperty("newConversation", out var newConv) &&
                newConv.TryGetProperty("conversationId", out var idProp))
            {
                return idProp.GetString()!;
            }

            throw new Exception($"Could not extract conversationId from output: {output}");
        }

        public async Task RunAgentSendMessageAsync(string remoteId, string content)
        {
            await RunAgentCliAsync(new[] { "send-message", remoteId, content });
        }
    }
}
