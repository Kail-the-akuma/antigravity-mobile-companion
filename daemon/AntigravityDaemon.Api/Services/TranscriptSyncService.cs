using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using AntigravityDaemon.Data;
using AntigravityDaemon.Core.Models;
using AntigravityDaemon.Core.Services;
using AntigravityDaemon.Api.Hubs;

namespace AntigravityDaemon.Api.Services
{
    public class TranscriptSyncService : ITranscriptSyncService
    {
        private readonly DaemonDbContext _context;
        private readonly IHubContext<CompanionHub> _hubContext;
        private readonly IWorkspaceService _workspaceService;
        private static readonly System.Threading.SemaphoreSlim _syncSemaphore = new System.Threading.SemaphoreSlim(1, 1);
        private static readonly ConcurrentDictionary<Guid, bool> _activeExecutions = new ConcurrentDictionary<Guid, bool>();

        public TranscriptSyncService(
            DaemonDbContext context,
            IHubContext<CompanionHub> hubContext,
            IWorkspaceService workspaceService)
        {
            _context = context;
            _hubContext = hubContext;
            _workspaceService = workspaceService;
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

        public async Task<string> PollAgentResponseAsync(string remoteId, string expectedContent, int initialLastStepIndex = -1)
        {
            string logPath = $@"C:\Users\Hugo\.gemini\antigravity\brain\{remoteId}\.system_generated\logs\transcript.jsonl";

            int existCheck = 0;
            while (!File.Exists(logPath) && existCheck < 20)
            {
                await Task.Delay(500);
                existCheck++;
            }

            if (!File.Exists(logPath))
            {
                throw new FileNotFoundException($"Transcript log file not found at {logPath}");
            }

            // Capture the last step index in the transcript log before polling starts if not pre-provided
            int lastStepIndex = initialLastStepIndex;
            if (lastStepIndex == -1)
            {
                try
                {
                    var initialLines = await File.ReadAllLinesAsync(logPath);
                    for (int i = initialLines.Length - 1; i >= 0; i--)
                    {
                        var line = initialLines[i];
                        if (string.IsNullOrWhiteSpace(line)) continue;
                        var parsed = JsonSerializer.Deserialize<TranscriptLine>(line);
                        if (parsed != null)
                        {
                            lastStepIndex = parsed.step_index;
                            break;
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[Companion] Warning reading initial transcript lines: {ex.Message}");
                }
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

                            // Match the newly appended message (step_index must be strictly greater than lastStepIndex)
                            if (parsed.step_index > lastStepIndex && 
                                sentMessageIndex == -1 && 
                                parsed.content != null && 
                                parsed.content.Contains(expectedContent))
                            {
                                sentMessageIndex = parsedLines.Count - 1;
                            }
                        }
                    }
                    catch
                    {
                    }
                }

                // If not matched by content, fallback ONLY within the newly appended steps to avoid matching historical logs
                if (sentMessageIndex == -1)
                {
                    for (int i = 0; i < parsedLines.Count; i++)
                    {
                        var pl = parsedLines[i];
                        if (pl.step_index > lastStepIndex && (pl.source == "USER_EXPLICIT" || pl.source == "SYSTEM"))
                        {
                            sentMessageIndex = i;
                            break;
                        }
                    }
                }

                if (sentMessageIndex != -1)
                {
                    var linesAfter = parsedLines.Skip(sentMessageIndex + 1).ToList();
                    if (linesAfter.Any())
                    {
                        // Search backwards for the last valid model response text to avoid being blocked by system logs or tool output steps
                        for (int i = linesAfter.Count - 1; i >= 0; i--)
                        {
                            var candidateLine = linesAfter[i];
                            bool isModelReply = candidateLine.source == "MODEL" &&
                                                candidateLine.status == "DONE" &&
                                                !string.IsNullOrEmpty(candidateLine.content) &&
                                                (candidateLine.type == "PLANNER_RESPONSE" || candidateLine.type == null);

                            if (isModelReply)
                            {
                                bool hasToolCalls = false;
                                if (candidateLine.tool_calls != null)
                                {
                                    using var doc = JsonDocument.Parse(JsonSerializer.Serialize(candidateLine.tool_calls));
                                    if (doc.RootElement.ValueKind == JsonValueKind.Array && doc.RootElement.GetArrayLength() > 0)
                                    {
                                        hasToolCalls = true;
                                    }
                                }

                                if (!hasToolCalls)
                                {
                                    return candidateLine.content!;
                                }
                            }
                        }
                    }
                }

                await Task.Delay(1000);
            }

            throw new TimeoutException("Timed out waiting for Antigravity agent response.");
        }

        public async Task SyncLocalConversationsAsync()
        {
            await _syncSemaphore.WaitAsync();
            try
            {
                var newMessagesToBroadcast = new List<(Guid ConversationId, ConversationMessage Message)>();
                string brainPath = @"C:\Users\Hugo\.gemini\antigravity\brain";
                if (!Directory.Exists(brainPath)) return;

                var directories = Directory.GetDirectories(brainPath);
                var antigravityId = new Guid("a1b2c3d4-e5f6-7890-abcd-ef1234567890");

                foreach (var dir in directories)
                {
                    var dirName = Path.GetFileName(dir);
                    if (!Guid.TryParse(dirName, out Guid remoteGuid)) continue;

                    // Skip syncing this conversation while the agent is actively executing to avoid intermediate updates
                    if (IsAgentExecuting(remoteGuid))
                    {
                        continue;
                    }

                    // Check if we already have this remote conversation in DB
                    var existingConv = await _context.Conversations
                        .Include(c => c.Messages)
                        .FirstOrDefaultAsync(c => c.RemoteConversationId == dirName);

                    if (existingConv != null && existingConv.IsDeleted)
                    {
                        continue;
                    }

                    bool isPinnedLocally = File.Exists(Path.Combine(dir, ".pinned"));
                    string? customTitle = null;
                    string annotationPath = Path.Combine(@"C:\Users\Hugo\.gemini\antigravity\annotations", $"{dirName}.pbtxt");
                    if (File.Exists(annotationPath))
                    {
                        try
                        {
                            string annotationContent = await File.ReadAllTextAsync(annotationPath);
                            if (annotationContent.Contains("pinned:true"))
                            {
                                isPinnedLocally = true;
                            }
                            else if (annotationContent.Contains("pinned:false"))
                            {
                                isPinnedLocally = false;
                            }

                            // Extract title if present: title:"..."
                            int titleIndex = annotationContent.IndexOf("title:\"");
                            if (titleIndex >= 0)
                            {
                                int startQuote = titleIndex + "title:\"".Length;
                                int endQuote = annotationContent.IndexOf("\"", startQuote);
                                if (endQuote > startQuote)
                                {
                                    string extractedTitle = annotationContent.Substring(startQuote, endQuote - startQuote);
                                    if (!string.IsNullOrWhiteSpace(extractedTitle))
                                    {
                                        customTitle = extractedTitle;
                                    }
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"Error reading annotation file {annotationPath}: {ex.Message}");
                        }
                    }

                    string transcriptPath = Path.Combine(dir, ".system_generated", "logs", "transcript.jsonl");
                    if (!File.Exists(transcriptPath)) continue;

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
                                        Role = "user-ide",
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
                                            Content = SanitizeMessageContent(parsed.content, "agent"),
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
                    string finalTitle = customTitle ?? derivedTitle;

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
                            Title = finalTitle,
                            CreatedAt = createdAt,
                            UpdatedAt = updatedAt,
                            RemoteConversationId = dirName,
                            IsPinned = isPinnedLocally
                        };

                        foreach (var msg in messages)
                        {
                            msg.ConversationId = newConv.Id;
                            newConv.Messages.Add(msg);
                            newMessagesToBroadcast.Add((newConv.Id, msg));
                        }

                        _context.Conversations.Add(newConv);
                    }
                    else
                    {
                        // Sync messages for existing conversation to make sure any new messages are added
                        foreach (var msg in messages)
                        {
                            bool exists = existingConv.Messages.Any(em => 
                                ((em.Role == msg.Role) || (em.Role == "user" && msg.Role == "user-ide") || (em.Role == "user-ide" && msg.Role == "user")) && 
                                ((em.Content.Trim() == msg.Content.Trim() && Math.Abs((NormalizeToUtc(em.Timestamp) - NormalizeToUtc(msg.Timestamp)).TotalSeconds) < 120) || 
                                 Math.Abs((NormalizeToUtc(em.Timestamp) - NormalizeToUtc(msg.Timestamp)).TotalSeconds) < 15));

                            if (!exists)
                            {
                                msg.ConversationId = existingConv.Id;
                                existingConv.Messages.Add(msg); // Fix EF Core in-memory tracking duplication bug!
                                _context.ConversationMessages.Add(msg);
                                newMessagesToBroadcast.Add((existingConv.Id, msg));
                            }
                        }
                        existingConv.UpdatedAt = updatedAt;
                        existingConv.Title = finalTitle;
                        existingConv.IsPinned = isPinnedLocally;
                    }
                }

                await _context.SaveChangesAsync();

                // Broadcast newly added messages over SignalR
                foreach (var item in newMessagesToBroadcast)
                {
                    await _hubContext.Clients.All.SendAsync(
                        "ReceiveMessage",
                        item.ConversationId.ToString(),
                        item.Message.Id.ToString(),
                        item.Message.Role,
                        item.Message.Content,
                        item.Message.Timestamp.ToString("o")
                    );

                    // If it's a new user prompt from the IDE, broadcast the execution state as active (thinking)
                    if (item.Message.Role == "user-ide")
                    {
                        await _hubContext.Clients.All.SendAsync(
                            "ReceiveAgentExecutionState",
                            item.ConversationId.ToString(),
                            item.Message.Content,
                            true
                        );
                    }
                }
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

        public async Task WriteLastPromptToFileAsync(string agentName, Guid convId, string prompt)
        {
            try
            {
                string workspacePath = _workspaceService.GetWorkspacePath();
                if (Directory.Exists(workspacePath))
                {
                    string filePath = Path.Combine(workspacePath, "last_companion_prompt.md");
                    string fileContent = $@"# Último Prompt do Telemóvel

**Agente:** {agentName}
**Data:** {DateTime.Now:dd/MM/yyyy HH:mm:ss}
**Conversa ID:** {convId}

## Prompt Enviado:
> {prompt}

---
*Ficheiro gerado automaticamente pelo Antigravity Mobile Companion Daemon.*
";
                    await File.WriteAllTextAsync(filePath, fileContent, System.Text.Encoding.UTF8);
                    
                    Console.ForegroundColor = ConsoleColor.Magenta;
                    Console.WriteLine($"[Companion] 📂 Ficheiro de prompt atualizado no workspace: {filePath}");
                    Console.ResetColor();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Erro ao escrever prompt para o workspace: {ex.Message}");
            }
        }

        public string SanitizeMessageContent(string content, string role)
        {
            if (role != "agent" || string.IsNullOrEmpty(content))
            {
                return content;
            }

            try
            {
                // 1. Strip massive code blocks or replace them
                var lines = content.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.None);
                var sanitizedLines = new List<string>();
                
                bool inCodeBlock = false;
                var currentBlockLines = new List<string>();
                string codeBlockHeader = "";

                foreach (var line in lines)
                {
                    if (line.TrimStart().StartsWith("```"))
                    {
                        if (!inCodeBlock)
                        {
                            inCodeBlock = true;
                            codeBlockHeader = line;
                            currentBlockLines.Clear();
                        }
                        else
                        {
                            inCodeBlock = false;
                            if (currentBlockLines.Count > 15)
                            {
                                sanitizedLines.Add(codeBlockHeader);
                                sanitizedLines.Add("... [Código/Diff de grande dimensão omitido para melhor performance no telemóvel] ...");
                                sanitizedLines.Add("```");
                            }
                            else
                            {
                                sanitizedLines.Add(codeBlockHeader);
                                sanitizedLines.AddRange(currentBlockLines);
                                sanitizedLines.Add("```");
                            }
                        }
                    }
                    else
                    {
                        if (inCodeBlock)
                        {
                            currentBlockLines.Add(line);
                        }
                        else
                        {
                            sanitizedLines.Add(line);
                        }
                    }
                }

                if (inCodeBlock)
                {
                    if (currentBlockLines.Count > 15)
                    {
                        sanitizedLines.Add(codeBlockHeader);
                        sanitizedLines.Add("... [Código/Diff de grande dimensão omitido para melhor performance no telemóvel] ...");
                        sanitizedLines.Add("```");
                    }
                    else
                    {
                        sanitizedLines.Add(codeBlockHeader);
                        sanitizedLines.AddRange(currentBlockLines);
                    }
                }

                string result = string.Join("\n", sanitizedLines);

                return result;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error sanitizing agent message content: {ex.Message}");
                return content.Length > 2000 ? content.Substring(0, 1900) + "\n\n... (Mensagem truncada por limite de tamanho)" : content;
            }
        }

        public void SetAgentExecuting(Guid conversationId, bool isActive)
        {
            _activeExecutions[conversationId] = isActive;
        }

        public bool IsAgentExecuting(Guid conversationId)
        {
            return _activeExecutions.TryGetValue(conversationId, out bool isActive) && isActive;
        }

        private static DateTime NormalizeToUtc(DateTime dt)
        {
            return dt.Kind == DateTimeKind.Unspecified
                ? DateTime.SpecifyKind(dt, DateTimeKind.Utc)
                : dt.ToUniversalTime();
        }
    }
}
