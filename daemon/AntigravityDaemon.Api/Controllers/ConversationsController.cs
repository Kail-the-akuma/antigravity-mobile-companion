using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using AntigravityDaemon.Data;
using AntigravityDaemon.Core.Models;
using AntigravityDaemon.Core.Services;
using AntigravityDaemon.Api.Hubs;
using AntigravityDaemon.Api.Filters;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

namespace AntigravityDaemon.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ConversationsController : ControllerBase
    {
        private readonly DaemonDbContext _context;
        private readonly IHubContext<CompanionHub> _hubContext;
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly IWorkspaceService _workspaceService;
        private static readonly System.Threading.SemaphoreSlim _syncSemaphore = new System.Threading.SemaphoreSlim(1, 1);

        public ConversationsController(
            DaemonDbContext context, 
            IHubContext<CompanionHub> hubContext, 
            IServiceScopeFactory scopeFactory,
            IWorkspaceService workspaceService)
        {
            _context = context;
            _hubContext = hubContext;
            _scopeFactory = scopeFactory;
            _workspaceService = workspaceService;
        }

        // GET: api/conversations — list all conversations (most recent first)
        [HttpGet]
        [AuthorizeDevice]
        public async Task<ActionResult<IEnumerable<object>>> GetConversations()
        {
            await SyncLocalConversationsAsync();

            var conversations = await _context.Conversations
                .Include(c => c.Agent)
                .OrderByDescending(c => c.UpdatedAt)
                .Select(c => new
                {
                    c.Id,
                    c.Title,
                    c.CreatedAt,
                    c.UpdatedAt,
                    AgentId = c.AgentId,
                    AgentName = c.Agent!.Name,
                    AgentEmoji = c.Agent!.IconEmoji,
                    LastMessage = c.Messages
                        .OrderByDescending(m => m.Timestamp)
                        .Select(m => m.Content)
                        .FirstOrDefault() ?? "",
                })
                .ToListAsync();

            return Ok(conversations);
        }

        public record CreateConversationRequest(Guid AgentId, string? Title);

        // POST: api/conversations — start a new conversation with an agent
        [HttpPost]
        [AuthorizeDevice]
        public async Task<ActionResult<Conversation>> CreateConversation([FromBody] CreateConversationRequest request)
        {
            var agent = await _context.Agents.FindAsync(request.AgentId);
            if (agent == null)
                return BadRequest("Agent not found.");

            var conversation = new Conversation
            {
                AgentId = request.AgentId,
                Title = request.Title ?? $"Conversa com {agent.Name}",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };

            _context.Conversations.Add(conversation);
            await _context.SaveChangesAsync();

            return CreatedAtAction(nameof(GetConversations), new { id = conversation.Id }, new
            {
                conversation.Id,
                conversation.Title,
                conversation.AgentId,
                conversation.CreatedAt,
                conversation.UpdatedAt,
                AgentName = agent.Name,
                AgentEmoji = agent.IconEmoji,
            });
        }

        // GET: api/conversations/{id}/messages — fetch message history
        [HttpGet("{id}/messages")]
        [AuthorizeDevice]
        public async Task<ActionResult<IEnumerable<ConversationMessage>>> GetMessages(Guid id)
        {
            var conversation = await _context.Conversations.FindAsync(id);
            if (conversation == null) return NotFound();

            var messages = await _context.ConversationMessages
                .Where(m => m.ConversationId == id)
                .OrderBy(m => m.Timestamp)
                .ToListAsync();

            return Ok(messages);
        }

        public record SendMessageRequest(string Content);

        // POST: api/conversations/{id}/messages — user sends a message
        [HttpPost("{id}/messages")]
        [AuthorizeDevice]
        public async Task<IActionResult> SendMessage(Guid id, [FromBody] SendMessageRequest request)
        {
            var conversation = await _context.Conversations
                .Include(c => c.Agent)
                .FirstOrDefaultAsync(c => c.Id == id);

            if (conversation == null) return NotFound();

            // 1. Save user message
            var userMessage = new ConversationMessage
            {
                ConversationId = id,
                Role = "user",
                Content = request.Content,
                Timestamp = DateTime.UtcNow,
            };
            _context.ConversationMessages.Add(userMessage);

            // 2. Update conversation timestamp
            conversation.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();

            // 3. Process agent response in background
            var agentName = conversation.Agent?.Name ?? "Antigravity";
            var convId = id;

            _ = Task.Run(async () =>
            {
                try
                {
                    using var scope = _scopeFactory.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<DaemonDbContext>();
                    var hub = scope.ServiceProvider.GetRequiredService<IHubContext<CompanionHub>>();

                    var conv = await db.Conversations.FindAsync(convId);
                    if (conv == null) return;

                    string? remoteId = conv.RemoteConversationId;
                    bool isNew = string.IsNullOrEmpty(remoteId);

                    if (isNew)
                    {
                        remoteId = await RunAgentNewConversationAsync(request.Content);
                        conv.RemoteConversationId = remoteId;
                        conv.UpdatedAt = DateTime.UtcNow;
                        await db.SaveChangesAsync();
                    }
                    else
                    {
                        await RunAgentSendMessageAsync(remoteId!, request.Content);
                    }

                    string agentReply = await PollAgentResponseAsync(remoteId!, request.Content);

                    var agentMessage = new ConversationMessage
                    {
                        ConversationId = convId,
                        Role = "agent",
                        Content = agentReply,
                        Timestamp = DateTime.UtcNow,
                    };

                    db.ConversationMessages.Add(agentMessage);
                    conv.UpdatedAt = DateTime.UtcNow;
                    await db.SaveChangesAsync();

                    // Broadcast via SignalR to update the mobile app
                    await hub.Clients.All.SendAsync(
                        "ReceiveMessage",
                        convId.ToString(),
                        agentMessage.Id.ToString(),
                        "agent",
                        agentMessage.Content,
                        agentMessage.Timestamp.ToString("o")
                    );
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error in background agent loop: {ex}");
                }
            });

            return Ok(userMessage);
        }

        private static async Task<string> RunAgentCliAsync(string[] arguments)
        {
            string lsAddress = await ResolveAntigravityLsAddressAsync();
            string csrfToken = await ResolveAntigravityCsrfTokenAsync();

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
            
            startInfo.EnvironmentVariables["ANTIGRAVITY_LS_ADDRESS"] = lsAddress;
            startInfo.EnvironmentVariables["ANTIGRAVITY_CSRF_TOKEN"] = csrfToken;

            // Clear any internal parent environment variables that might interfere with language_server.exe
            var keysToRemove = new List<string>();
            foreach (string key in startInfo.EnvironmentVariables.Keys)
            {
                if (key.StartsWith("ANTIGRAVITY_", StringComparison.OrdinalIgnoreCase) &&
                    key != "ANTIGRAVITY_LS_ADDRESS" &&
                    key != "ANTIGRAVITY_CSRF_TOKEN")
                {
                    keysToRemove.Add(key);
                }
            }

            foreach (var key in keysToRemove)
            {
                startInfo.EnvironmentVariables.Remove(key);
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

        private static async Task<string> ResolveAntigravityLsAddressAsync()
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
                if (System.IO.File.Exists(logPath))
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
                if (System.IO.File.Exists(mainLogPath))
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

        private static async Task<string> ResolveAntigravityCsrfTokenAsync()
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
                if (System.IO.File.Exists(path))
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

        private static async Task<string> RunAgentNewConversationAsync(string prompt)
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

        private static async Task RunAgentSendMessageAsync(string remoteId, string content)
        {
            await RunAgentCliAsync(new[] { "send-message", remoteId, content });
        }

        public class TranscriptLine
        {
            public int step_index { get; set; }
            public string? source { get; set; }
            public string? type { get; set; }
            public string? status { get; set; }
            public string? content { get; set; }
            public string? created_at { get; set; }
            public object? tool_calls { get; set; }
        }

        private static async Task<string> PollAgentResponseAsync(string remoteId, string expectedContent)
        {
            string logPath = $@"C:\Users\Hugo\.gemini\antigravity\brain\{remoteId}\.system_generated\logs\transcript.jsonl";

            int existCheck = 0;
            while (!System.IO.File.Exists(logPath) && existCheck < 20)
            {
                await Task.Delay(500);
                existCheck++;
            }

            if (!System.IO.File.Exists(logPath))
            {
                throw new FileNotFoundException($"Transcript log file not found at {logPath}");
            }

            int timeoutSeconds = 120;
            var startTime = DateTime.UtcNow;

            while ((DateTime.UtcNow - startTime).TotalSeconds < timeoutSeconds)
            {
                List<string> lines = new List<string>();
                using (var fs = new FileStream(logPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (var reader = new StreamReader(fs))
                {
                    string? line;
                    while ((line = await reader.ReadLineAsync()) != null)
                    {
                        if (!string.IsNullOrWhiteSpace(line))
                        {
                            lines.Add(line);
                        }
                    }
                }

                int sentMessageIndex = -1;
                List<TranscriptLine> parsedLines = new List<TranscriptLine>();

                for (int i = 0; i < lines.Count; i++)
                {
                    try
                    {
                        var parsed = JsonSerializer.Deserialize<TranscriptLine>(lines[i]);
                        if (parsed != null)
                        {
                            parsedLines.Add(parsed);

                            if (sentMessageIndex == -1 && parsed.content != null && parsed.content.Contains(expectedContent))
                            {
                                sentMessageIndex = parsedLines.Count - 1;
                            }
                        }
                    }
                    catch
                    {
                    }
                }

                if (sentMessageIndex == -1 && parsedLines.Any())
                {
                    var lastUserInput = parsedLines.LastOrDefault(l => l.source == "USER_EXPLICIT" || l.source == "SYSTEM");
                    if (lastUserInput != null)
                    {
                        sentMessageIndex = parsedLines.IndexOf(lastUserInput);
                    }
                }

                if (sentMessageIndex != -1)
                {
                    var linesAfter = parsedLines.Skip(sentMessageIndex + 1).ToList();
                    if (linesAfter.Any())
                    {
                        var lastLine = linesAfter.Last();

                        bool lastIsModelReply = lastLine.source == "MODEL" &&
                                                lastLine.status == "DONE" &&
                                                !string.IsNullOrEmpty(lastLine.content) &&
                                                (lastLine.type == "PLANNER_RESPONSE" || lastLine.type == null);

                        if (lastIsModelReply)
                        {
                            bool hasToolCalls = false;
                            if (lastLine.tool_calls != null)
                            {
                                using var doc = JsonDocument.Parse(JsonSerializer.Serialize(lastLine.tool_calls));
                                if (doc.RootElement.ValueKind == JsonValueKind.Array && doc.RootElement.GetArrayLength() > 0)
                                {
                                    hasToolCalls = true;
                                }
                            }

                            if (!hasToolCalls)
                            {
                                return lastLine.content!;
                            }
                        }
                    }
                }

                await Task.Delay(1000);
            }

            throw new TimeoutException("Timed out waiting for Antigravity agent response.");
        }

        private async Task SyncLocalConversationsAsync()
        {
            await _syncSemaphore.WaitAsync();
            try
            {
                string brainPath = @"C:\Users\Hugo\.gemini\antigravity\brain";
                if (!Directory.Exists(brainPath)) return;

                var directories = Directory.GetDirectories(brainPath);
                var antigravityId = new Guid("a1b2c3d4-e5f6-7890-abcd-ef1234567890");

                foreach (var dir in directories)
                {
                    var dirName = Path.GetFileName(dir);
                    if (!Guid.TryParse(dirName, out Guid remoteGuid)) continue;

                    // Check if we already have this remote conversation in DB
                    var existingConv = await _context.Conversations
                        .Include(c => c.Messages)
                        .FirstOrDefaultAsync(c => c.RemoteConversationId == dirName);

                    string transcriptPath = Path.Combine(dir, ".system_generated", "logs", "transcript.jsonl");
                    if (!System.IO.File.Exists(transcriptPath)) continue;

                    // Parse transcript messages
                    var messages = new List<ConversationMessage>();
                    try
                    {
                        using var fs = new FileStream(transcriptPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                        using var reader = new StreamReader(fs);
                        string? line;
                        while ((line = await reader.ReadLineAsync()) != null)
                        {
                            if (string.IsNullOrWhiteSpace(line)) continue;
                            try
                            {
                                var parsed = JsonSerializer.Deserialize<TranscriptLine>(line);
                                if (parsed == null) continue;

                                // 1. User input message
                                if (parsed.source == "USER_EXPLICIT" && parsed.type == "USER_INPUT" && parsed.status == "DONE")
                                {
                                    string content = parsed.content ?? string.Empty;
                                    // Strip <USER_REQUEST>...</USER_REQUEST> tags if present
                                    int startTag = content.IndexOf("<USER_REQUEST>");
                                    int endTag = content.IndexOf("</USER_REQUEST>");
                                    if (startTag >= 0 && endTag > startTag)
                                    {
                                        content = content.Substring(startTag + "<USER_REQUEST>".Length, endTag - (startTag + "<USER_REQUEST>".Length)).Trim();
                                    }

                                    DateTime timestamp = DateTime.UtcNow;
                                    if (!string.IsNullOrEmpty(parsed.created_at) && DateTime.TryParse(parsed.created_at, out var parsedTime))
                                    {
                                        timestamp = parsedTime.ToUniversalTime();
                                    }

                                    messages.Add(new ConversationMessage
                                    {
                                        Role = "user",
                                        Content = content,
                                        Timestamp = timestamp
                                    });
                                }
                                // 2. Model response
                                else if (parsed.source == "MODEL" && parsed.status == "DONE" && !string.IsNullOrEmpty(parsed.content))
                                {
                                    bool hasToolCalls = false;
                                    if (parsed.tool_calls != null)
                                    {
                                        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(parsed.tool_calls));
                                        if (doc.RootElement.ValueKind == JsonValueKind.Array && doc.RootElement.GetArrayLength() > 0)
                                        {
                                            hasToolCalls = true;
                                        }
                                    }

                                    if (!hasToolCalls && (parsed.type == "PLANNER_RESPONSE" || parsed.type == null))
                                    {
                                        DateTime timestamp = DateTime.UtcNow;
                                        if (!string.IsNullOrEmpty(parsed.created_at) && DateTime.TryParse(parsed.created_at, out var parsedTime))
                                        {
                                            timestamp = parsedTime.ToUniversalTime();
                                        }

                                        messages.Add(new ConversationMessage
                                        {
                                            Role = "agent",
                                            Content = parsed.content,
                                            Timestamp = timestamp
                                        });
                                    }
                                }
                            }
                            catch
                            {
                                // Ignore single line deserialization errors
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Error reading transcript log for {dirName}: {ex}");
                        continue;
                    }

                    if (messages.Count == 0) continue;

                    // Derive the title from the first user request, truncated to 40 characters
                    string firstUserMsg = messages.FirstOrDefault(m => m.Role == "user")?.Content ?? "Nova Conversa";
                    string derivedTitle = firstUserMsg.Length > 40 ? firstUserMsg.Substring(0, 37) + "..." : firstUserMsg;

                    // Determine the earliest and latest timestamps
                    DateTime createdAt = messages.Min(m => m.Timestamp);
                    DateTime updatedAt = messages.Max(m => m.Timestamp);

                    if (existingConv == null)
                    {
                        // Create new conversation
                        var newConv = new Conversation
                        {
                            Id = remoteGuid, // Maintain identity
                            AgentId = antigravityId,
                            Title = derivedTitle,
                            CreatedAt = createdAt,
                            UpdatedAt = updatedAt,
                            RemoteConversationId = dirName
                        };

                        foreach (var msg in messages)
                        {
                            msg.ConversationId = newConv.Id;
                            newConv.Messages.Add(msg);
                        }

                        _context.Conversations.Add(newConv);
                    }
                    else
                    {
                        // Sync messages for existing conversation to make sure any new messages are added
                        foreach (var msg in messages)
                        {
                            bool exists = existingConv.Messages.Any(em => 
                                em.Role == msg.Role && 
                                em.Content == msg.Content && 
                                Math.Abs((em.Timestamp.ToUniversalTime() - msg.Timestamp.ToUniversalTime()).TotalSeconds) < 5);

                            if (!exists)
                            {
                                msg.ConversationId = existingConv.Id;
                                _context.ConversationMessages.Add(msg);
                            }
                        }
                        existingConv.UpdatedAt = updatedAt;
                        existingConv.Title = derivedTitle;
                    }
                }

                await _context.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in SyncLocalConversationsAsync: {ex}");
            }
            finally
            {
                _syncSemaphore.Release();
            }
        }
    }
}
