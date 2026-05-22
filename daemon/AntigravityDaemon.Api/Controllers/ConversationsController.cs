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
using System.IO;
using System.Linq;
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
        private readonly IAgentCliBridge _agentCliBridge;
        private readonly ITranscriptSyncService _transcriptSyncService;

        public ConversationsController(
            DaemonDbContext context, 
            IHubContext<CompanionHub> hubContext, 
            IServiceScopeFactory scopeFactory,
            IAgentCliBridge agentCliBridge,
            ITranscriptSyncService transcriptSyncService)
        {
            _context = context;
            _hubContext = hubContext;
            _scopeFactory = scopeFactory;
            _agentCliBridge = agentCliBridge;
            _transcriptSyncService = transcriptSyncService;
        }

        // GET: api/conversations — list all conversations (most recent first)
        [HttpGet]
        [AuthorizeDevice]
        public async Task<ActionResult<IEnumerable<object>>> GetConversations()
        {
            await _transcriptSyncService.SyncLocalConversationsAsync();

            var conversations = await _context.Conversations
                .Include(c => c.Agent)
                .Where(c => !c.IsDeleted)
                .OrderByDescending(c => c.IsPinned)
                .ThenByDescending(c => c.UpdatedAt)
                .Select(c => new
                {
                    c.Id,
                    c.Title,
                    c.CreatedAt,
                    c.UpdatedAt,
                    AgentId = c.AgentId,
                    AgentName = c.Agent!.Name,
                    AgentEmoji = c.Agent!.IconEmoji,
                    IsPinned = c.IsPinned,
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
                .OrderByDescending(m => m.Timestamp)
                .Take(6)
                .ToListAsync();

            // Order chronologically for client-side display
            var chronologicalMessages = messages.OrderBy(m => m.Timestamp).ToList();

            return Ok(chronologicalMessages);
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

            // Reflect the prompt on the computer terminal inside a premium, highly visible ASCII card
            Console.WriteLine();
            Console.ForegroundColor = ConsoleColor.Magenta;
            Console.WriteLine("┌────────────────────────────────────────────────────────┐");
            Console.WriteLine("│ 📱  ANTIGRAVITY MOBILE COMPANION — PROMPT TRANSMITTED  │");
            Console.WriteLine("├────────────────────────────────────────────────────────┤");
            Console.ResetColor();
            
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine($"  Agente: {agentName}");
            Console.WriteLine($"  Conversa: {convId}");
            Console.WriteLine($"  Data: {DateTime.Now:dd/MM/yyyy HH:mm:ss}");
            Console.WriteLine("├────────────────────────────────────────────────────────┤");
            
            Console.ForegroundColor = ConsoleColor.White;
            string promptText = request.Content;
            if (promptText.Length > 52)
            {
                int index = 0;
                while (index < promptText.Length)
                {
                    int chunk = Math.Min(52, promptText.Length - index);
                    Console.WriteLine($"  > {promptText.Substring(index, chunk)}");
                    index += chunk;
                }
            }
            else
            {
                Console.WriteLine($"  > {promptText}");
            }
            
            Console.ForegroundColor = ConsoleColor.Magenta;
            Console.WriteLine("└────────────────────────────────────────────────────────┘");
            Console.ResetColor();
            Console.WriteLine();

            // Write prompt to last_companion_prompt.md in the workspace
            await _transcriptSyncService.WriteLastPromptToFileAsync(agentName, convId, request.Content);

            _ = Task.Run(async () =>
            {
                try
                {
                    using var scope = _scopeFactory.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<DaemonDbContext>();
                    var hub = scope.ServiceProvider.GetRequiredService<IHubContext<CompanionHub>>();
                    var cliBridge = scope.ServiceProvider.GetRequiredService<IAgentCliBridge>();
                    var syncService = scope.ServiceProvider.GetRequiredService<ITranscriptSyncService>();

                    var conv = await db.Conversations.FindAsync(convId);
                    if (conv == null) return;

                    string? remoteId = conv.RemoteConversationId;
                    bool isNew = string.IsNullOrEmpty(remoteId);

                    if (isNew)
                    {
                        remoteId = await cliBridge.RunAgentNewConversationAsync(request.Content);
                        conv.RemoteConversationId = remoteId;
                        conv.UpdatedAt = DateTime.UtcNow;
                        await db.SaveChangesAsync();
                    }
                    else
                    {
                        await cliBridge.RunAgentSendMessageAsync(remoteId!, request.Content);
                    }

                    string agentReply = await syncService.PollAgentResponseAsync(remoteId!, request.Content);

                    // Log agent response to console
                    Console.ForegroundColor = ConsoleColor.Green;
                    Console.WriteLine("\n==================================================");
                    Console.WriteLine($"[Companion] 🤖 Resposta recebida de {agentName}:");
                    Console.WriteLine($"👉 \"{agentReply}\"");
                    Console.WriteLine("==================================================\n");
                    Console.ResetColor();

                    var sanitizedReply = syncService.SanitizeMessageContent(agentReply, "agent");

                    bool alreadyExists = await db.ConversationMessages.AnyAsync(m =>
                        m.ConversationId == convId &&
                        m.Role == "agent" &&
                        m.Content == sanitizedReply);

                    if (!alreadyExists)
                    {
                        var agentMessage = new ConversationMessage
                        {
                            ConversationId = convId,
                            Role = "agent",
                            Content = sanitizedReply,
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
                    else
                    {
                        Console.WriteLine($"[Companion] 🤖 Resposta duplicada evitada (já guardada pelo sincronizador de ficheiros).");
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error in background agent loop: {ex}");
                }
            });

            return Ok(userMessage);
        }

        public record PushAgentMessageRequest(string Content);

        // POST: api/conversations/remote/{remoteConversationId}/agent-message
        // Allows a local agent session (from the desktop IDE) to push its final report/message to the mobile companion app.
        [HttpPost("remote/{remoteConversationId}/agent-message")]
        public async Task<IActionResult> PushAgentMessage(string remoteConversationId, [FromBody] PushAgentMessageRequest request)
        {
            if (string.IsNullOrEmpty(remoteConversationId))
            {
                return BadRequest("remoteConversationId is required.");
            }

            var conversation = await _context.Conversations
                .Include(c => c.Messages)
                .FirstOrDefaultAsync(c => c.RemoteConversationId == remoteConversationId);

            if (conversation == null)
            {
                // Create a new Conversation for this remote session if it doesn't exist
                var antigravityId = new Guid("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
                var agent = await _context.Agents.FindAsync(antigravityId);
                if (agent == null)
                {
                    return BadRequest("Default agent not found.");
                }

                conversation = new Conversation
                {
                    AgentId = antigravityId,
                    Title = $"Conversa {remoteConversationId.Substring(0, Math.Min(8, remoteConversationId.Length))}...",
                    RemoteConversationId = remoteConversationId,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                };

                _context.Conversations.Add(conversation);
                await _context.SaveChangesAsync();
            }

            // Sync any existing messages from the desktop IDE transcript logs so the mobile app has full context
            await _transcriptSyncService.SyncLocalConversationsAsync();

            // Re-fetch the conversation to get newly synced messages if any
            conversation = await _context.Conversations
                .Include(c => c.Messages)
                .FirstOrDefaultAsync(c => c.RemoteConversationId == remoteConversationId) ?? conversation;

            // Check if the exact message or a highly similar message from the agent already exists within the last 15 seconds to avoid duplicates
            var sanitizedContent = _transcriptSyncService.SanitizeMessageContent(request.Content, "agent");
            var threshold = DateTime.UtcNow.AddSeconds(-15);
            bool isDuplicate = conversation.Messages.Any(m => 
                m.Role == "agent" && 
                m.Timestamp >= threshold && 
                (m.Content == sanitizedContent || m.Content.Contains(sanitizedContent.Substring(0, Math.Min(Math.Max(1, sanitizedContent.Length), 20)))));

            if (isDuplicate)
            {
                return Ok(new { message = "Duplicate message ignored.", conversationId = conversation.Id });
            }

            var agentMessage = new ConversationMessage
            {
                ConversationId = conversation.Id,
                Role = "agent",
                Content = sanitizedContent,
                Timestamp = DateTime.UtcNow
            };

            _context.ConversationMessages.Add(agentMessage);
            conversation.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();

            // Broadcast via SignalR to update the mobile app
            await _hubContext.Clients.All.SendAsync(
                "ReceiveMessage",
                conversation.Id.ToString(),
                agentMessage.Id.ToString(),
                "agent",
                agentMessage.Content,
                agentMessage.Timestamp.ToString("o")
            );

            return Ok(new
            {
                message = "Agent message pushed successfully.",
                conversationId = conversation.Id,
                messageId = agentMessage.Id
            });
        }

        public record AgentExecutingRequest(Guid ConversationId, string Prompt, bool IsActive);

        // POST: api/conversations/remote/agent-executing
        // Allows a local agent session (from the desktop IDE) to notify the mobile companion app of active thinking/processing.
        [HttpPost("remote/agent-executing")]
        public async Task<IActionResult> UpdateAgentExecutingState([FromBody] AgentExecutingRequest request)
        {
            _transcriptSyncService.SetAgentExecuting(request.ConversationId, request.IsActive);

            await _hubContext.Clients.All.SendAsync(
                "ReceiveAgentExecutionState",
                request.ConversationId.ToString(),
                request.Prompt,
                request.IsActive
            );

            if (!request.IsActive)
            {
                // Force a final sync to pick up the completed agent response
                _ = Task.Run(async () =>
                {
                    try
                    {
                        // Brief delay to allow files to finish writing
                        await Task.Delay(500);
                        using var scope = _scopeFactory.CreateScope();
                        var syncService = scope.ServiceProvider.GetRequiredService<ITranscriptSyncService>();
                        await syncService.SyncLocalConversationsAsync();
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Error running final sync: {ex}");
                    }
                });
            }

            return Ok(new { message = "Execution state broadcasted successfully." });
        }

        // DELETE: api/conversations/{id} — soft delete a conversation
        [HttpDelete("{id}")]
        [AuthorizeDevice]
        public async Task<IActionResult> DeleteConversation(Guid id)
        {
            var conversation = await _context.Conversations.FindAsync(id);
            if (conversation == null) return NotFound();

            conversation.IsDeleted = true;
            conversation.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();

            // Broadcast via SignalR so UI can animate removal in real-time
            await _hubContext.Clients.All.SendAsync("ConversationDeleted", id.ToString());

            return Ok(new { message = "Conversa eliminada com sucesso." });
        }

        // GET: api/conversations/deleted — list all deleted conversations
        [HttpGet("deleted")]
        [AuthorizeDevice]
        public async Task<ActionResult<IEnumerable<object>>> GetDeletedConversations()
        {
            var conversations = await _context.Conversations
                .Include(c => c.Agent)
                .Where(c => c.IsDeleted)
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
                    IsPinned = c.IsPinned,
                    LastMessage = c.Messages
                        .OrderByDescending(m => m.Timestamp)
                        .Select(m => m.Content)
                        .FirstOrDefault() ?? "",
                })
                .ToListAsync();

            return Ok(conversations);
        }

        // PUT: api/conversations/{id}/restore — restore a soft deleted conversation
        [HttpPut("{id}/restore")]
        [AuthorizeDevice]
        public async Task<IActionResult> RestoreConversation(Guid id)
        {
            var conversation = await _context.Conversations.FindAsync(id);
            if (conversation == null) return NotFound();

            conversation.IsDeleted = false;
            conversation.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();

            // Broadcast via SignalR so all connected devices can refresh instantly
            await _hubContext.Clients.All.SendAsync("ConversationRestored", id.ToString());

            return Ok(new { message = "Conversa restaurada com sucesso." });
        }

        // PUT: api/conversations/{id}/pin — toggle pin status bidirectionally
        [HttpPut("{id}/pin")]
        [AuthorizeDevice]
        public async Task<IActionResult> TogglePinConversation(Guid id)
        {
            var conversation = await _context.Conversations.FindAsync(id);
            if (conversation == null) return NotFound();

            conversation.IsPinned = !conversation.IsPinned;
            conversation.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();

            // Bidirectional file sync: write or delete .pinned marker in the brain directory
            if (!string.IsNullOrEmpty(conversation.RemoteConversationId))
            {
                try
                {
                    string brainPath = @"C:\Users\Hugo\.gemini\antigravity\brain";
                    string targetFolder = Path.Combine(brainPath, conversation.RemoteConversationId);
                    if (Directory.Exists(targetFolder))
                    {
                        string pinnedPath = Path.Combine(targetFolder, ".pinned");
                        if (conversation.IsPinned)
                        {
                            if (!System.IO.File.Exists(pinnedPath))
                            {
                                await System.IO.File.WriteAllTextAsync(pinnedPath, "");
                            }
                        }
                        else
                        {
                            if (System.IO.File.Exists(pinnedPath))
                            {
                                System.IO.File.Delete(pinnedPath);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error writing/deleting local .pinned file for {conversation.RemoteConversationId}: {ex.Message}");
                }

                // Update .pbtxt annotation file for bidirectional sync with the IDE
                string annotationPath = Path.Combine(@"C:\Users\Hugo\.gemini\antigravity\annotations", $"{conversation.RemoteConversationId}.pbtxt");
                try
                {
                    if (conversation.IsPinned)
                    {
                        if (System.IO.File.Exists(annotationPath))
                        {
                            string content = await System.IO.File.ReadAllTextAsync(annotationPath);
                            if (!content.Contains("pinned:true"))
                            {
                                if (content.Contains("pinned:false"))
                                {
                                    content = content.Replace("pinned:false", "pinned:true");
                                }
                                else
                                {
                                    content = content.TrimEnd() + " pinned:true";
                                }
                                await System.IO.File.WriteAllTextAsync(annotationPath, content);
                            }
                        }
                        else
                        {
                            await System.IO.File.WriteAllTextAsync(annotationPath, "pinned:true");
                        }
                    }
                    else
                    {
                        if (System.IO.File.Exists(annotationPath))
                        {
                            string content = await System.IO.File.ReadAllTextAsync(annotationPath);
                            if (content.Contains("pinned:true"))
                            {
                                content = content.Replace("pinned:true", "pinned:false");
                                await System.IO.File.WriteAllTextAsync(annotationPath, content);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error updating .pbtxt annotation file for {conversation.RemoteConversationId}: {ex.Message}");
                }
            }

            // Broadcast via SignalR so all connected apps know instantly
            await _hubContext.Clients.All.SendAsync("ConversationPinned", id.ToString(), conversation.IsPinned);

            return Ok(new { message = conversation.IsPinned ? "Conversa fixada." : "Conversa desafixada.", isPinned = conversation.IsPinned });
        }
    }
}
