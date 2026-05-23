using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using AntigravityDaemon.Data;
using AntigravityDaemon.Core.Models;
using AntigravityDaemon.Api.Hubs;
using AntigravityDaemon.Api.Filters;
using Microsoft.EntityFrameworkCore;
using System;
using System.Threading.Tasks;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace AntigravityDaemon.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ApprovalsController : ControllerBase
    {
        private readonly DaemonDbContext _context;
        private readonly IHubContext<CompanionHub> _hubContext;
        private readonly IHttpClientFactory _httpClientFactory;

        public ApprovalsController(DaemonDbContext context, IHubContext<CompanionHub> hubContext, IHttpClientFactory httpClientFactory)
        {
            _context = context;
            _hubContext = hubContext;
            _httpClientFactory = httpClientFactory;
        }

        public record RequestApprovalPayload(Guid? TaskId, string PlanStepsJson, string? Prompt);

        // POST: api/approvals/request (Called locally by the Antigravity Agent to pause and wait for approval)
        [HttpPost("request")]
        public async Task<IActionResult> RequestApproval([FromBody] RequestApprovalPayload payload)
        {
            Guid resolvedTaskId;

            if (!payload.TaskId.HasValue || payload.TaskId.Value == Guid.Empty)
            {
                // Create a new TaskItem dynamically for this agent request
                var newTask = new TaskItem
                {
                    Prompt = payload.Prompt ?? "Solicitação de Permissão",
                    Status = "Running",
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                };

                _context.Tasks.Add(newTask);
                await _context.SaveChangesAsync();
                resolvedTaskId = newTask.Id;

                // Broadcast the new task to the mobile client in real-time
                await _hubContext.Clients.All.SendAsync("ReceiveTaskUpdate", newTask.Id.ToString(), newTask.Status, newTask.PlanJson);
            }
            else
            {
                resolvedTaskId = payload.TaskId.Value;
                var taskExists = await _context.Tasks.AnyAsync(t => t.Id == resolvedTaskId);
                if (!taskExists)
                {
                    return BadRequest("Task not found.");
                }
            }

            // Find the active executing conversation in the DB (the most recently updated conversation)
            var activeConversation = await _context.Conversations
                .OrderByDescending(c => c.UpdatedAt)
                .FirstOrDefaultAsync();
            Guid? conversationId = activeConversation?.Id;

            // Gera nonce seguro de uso único (128 bits de entropia) e data de validade de 5 minutos
            byte[] nonceBytes = new byte[16];
            using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create())
            {
                rng.GetBytes(nonceBytes);
            }
            string serverNonce = Convert.ToBase64String(nonceBytes);
            DateTime expiresAt = DateTime.UtcNow.AddMinutes(5);

            var approval = new ApprovalRequest
            {
                TaskId = resolvedTaskId,
                PlanStepsJson = payload.PlanStepsJson,
                ConversationId = conversationId,
                Status = "Pending",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
                Nonce = serverNonce,
                ExpiresAt = expiresAt
            };

            _context.Approvals.Add(approval);
            await _context.SaveChangesAsync();

            if (conversationId.HasValue)
            {
                var newEvent = new CompanionEvent
                {
                    ConversationId = conversationId.Value,
                    EventType = "ApprovalRequested",
                    PayloadJson = JsonSerializer.Serialize(new {
                        id = approval.Id,
                        taskId = approval.TaskId,
                        planStepsJson = approval.PlanStepsJson,
                        status = approval.Status,
                        createdAt = approval.CreatedAt,
                        conversationId = approval.ConversationId?.ToString(),
                        nonce = approval.Nonce,
                        expiresAtUtc = approval.ExpiresAt?.ToString("o")
                    }),
                    Timestamp = DateTime.UtcNow
                };
                _context.CompanionEvents.Add(newEvent);
                await _context.SaveChangesAsync();
                await _hubContext.Clients.All.SendAsync("ReceiveEvent", newEvent);
            }

            // Broadcast the approval request to the Mobile Companion App via WebSockets (com nonce e expiração)
            await _hubContext.Clients.All.SendAsync("ReceiveApprovalRequest", 
                approval.Id.ToString(), 
                approval.TaskId.ToString(), 
                approval.PlanStepsJson, 
                conversationId?.ToString(),
                approval.Nonce,
                approval.ExpiresAt?.ToString("o"));

            // Fire and forget push notification delivery to all registered device tokens
            var pushTokens = await _context.TrustedDevices
                .Where(d => d.PushToken != null && d.PushToken != "")
                .Select(d => d.PushToken)
                .ToListAsync();

            if (pushTokens.Any())
            {
                _ = Task.Run(async () =>
                {
                    try
                    {
                        var client = _httpClientFactory.CreateClient();
                        var payloadList = pushTokens.Select(token => new
                        {
                            to = token,
                            sound = "default",
                            title = "⚡ Antigravity - Pedido de Aprovação",
                            body = payload.Prompt ?? "Solicitação de permissão ativa para o projeto.",
                            data = new
                            {
                                type = "ReceiveApprovalRequest",
                                approvalId = approval.Id.ToString(),
                                taskId = approval.TaskId.ToString(),
                                planStepsJson = approval.PlanStepsJson,
                                conversationId = conversationId?.ToString()
                            }
                        }).ToList();

                        var json = JsonSerializer.Serialize(payloadList);
                        var content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
                        await client.PostAsync("https://exp.host/--/api/v2/push/send", content);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Failed to send push notification: {ex.Message}");
                    }
                });
            }

            // Block and poll the database for user response (Long Polling Pattern)
            int timeoutSeconds = 120; // 2 minutes timeout
            while (timeoutSeconds > 0)
            {
                await Task.Delay(1000);
                
                // Reload the entity state from the database
                await _context.Entry(approval).ReloadAsync();

                if (approval.Status != "Pending")
                {
                    return Ok(new
                    {
                        status = approval.Status,
                        signature = approval.Signature,
                        updatedAt = approval.UpdatedAt
                    });
                }

                timeoutSeconds--;
            }

            // If timeout reached, mark it as Rejected due to timeout
            approval.Status = "Timeout";
            approval.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();

            return StatusCode(408, new { message = "Timeout waiting for user response." });
        }

        // POST: api/approvals/simulate (Helper endpoint to test end-to-end flow with a single click)
        [HttpPost("simulate")]
        public async Task<IActionResult> SimulateApproval()
        {
            // 1. Create a mock task
            var task = new TaskItem
            {
                Prompt = "Refatorar módulo de autenticação e adicionar testes unitários",
                Status = "Running",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            _context.Tasks.Add(task);
            await _context.SaveChangesAsync();

            // 2. Create approval request
            var activeConversation = await _context.Conversations
                .OrderByDescending(c => c.UpdatedAt)
                .FirstOrDefaultAsync();
            Guid? conversationId = activeConversation?.Id;

            // Gera nonce simulado e data de validade de 5 minutos
            byte[] nonceBytes = new byte[16];
            using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create())
            {
                rng.GetBytes(nonceBytes);
            }
            string serverNonce = Convert.ToBase64String(nonceBytes);
            DateTime expiresAt = DateTime.UtcNow.AddMinutes(5);

            var approval = new ApprovalRequest
            {
                TaskId = task.Id,
                PlanStepsJson = "[\n  \"1. Criar novo ficheiro de testes em tests/auth.spec.ts\",\n  \"2. Implementar mocks de base de dados para utilizador\",\n  \"3. Executar testes e validar cobertura de 95%\"\n]",
                ConversationId = conversationId,
                Status = "Pending",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
                Nonce = serverNonce,
                ExpiresAt = expiresAt
            };
            _context.Approvals.Add(approval);
            await _context.SaveChangesAsync();

            // Broadcast the new task to the mobile client
            await _hubContext.Clients.All.SendAsync("ReceiveTaskUpdate", task.Id.ToString(), task.Status, task.PlanJson);

            // Broadcast the approval request (com nonce e expiração)
            await _hubContext.Clients.All.SendAsync("ReceiveApprovalRequest", 
                approval.Id.ToString(), 
                approval.TaskId.ToString(), 
                approval.PlanStepsJson, 
                conversationId?.ToString(),
                approval.Nonce,
                approval.ExpiresAt?.ToString("o"));

            // Fire and forget push notification simulation delivery
            var pushTokens = await _context.TrustedDevices
                .Where(d => d.PushToken != null && d.PushToken != "")
                .Select(d => d.PushToken)
                .ToListAsync();

            if (pushTokens.Any())
            {
                _ = Task.Run(async () =>
                {
                    try
                    {
                        var client = _httpClientFactory.CreateClient();
                        var payloadList = pushTokens.Select(token => new
                        {
                            to = token,
                            sound = "default",
                            title = "⚡ Antigravity - Pedido de Aprovação (Simulação)",
                            body = "Solicitação de permissão ativa (Simulação).",
                            data = new
                            {
                                type = "ReceiveApprovalRequest",
                                approvalId = approval.Id.ToString(),
                                taskId = approval.TaskId.ToString(),
                                planStepsJson = approval.PlanStepsJson,
                                conversationId = conversationId?.ToString()
                            }
                        }).ToList();

                        var json = JsonSerializer.Serialize(payloadList);
                        var content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
                        await client.PostAsync("https://exp.host/--/api/v2/push/send", content);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Failed to send push notification simulation: {ex.Message}");
                    }
                });
            }

            return Ok(new
            {
                message = "Simulação iniciada! Verifique o ecrã do seu telemóvel.",
                taskId = task.Id,
                approvalId = approval.Id
            });
        }

        public record RespondApprovalPayload(
            string Status, 
            string Signature,
            string? EventId = null,
            string? TimestampUtc = null,
            string? Nonce = null
        );

        // POST: api/approvals/{id}/respond (Called remotely by the Mobile Companion App to approve/reject)
        [HttpPost("{id}/respond")]
        [AuthorizeDevice]
        public async Task<IActionResult> RespondApproval(Guid id, [FromBody] RespondApprovalPayload payload)
        {
            var approval = await _context.Approvals.FindAsync(id);
            if (approval == null)
            {
                return NotFound("Approval request not found.");
            }

            // 1. Idempotência absoluta (Garantia de Ack para retransmissões de rede transientes)
            if (approval.Status != "Pending")
            {
                if (approval.Signature == payload.Signature || approval.Status == payload.Status)
                {
                    return Ok(new { message = "Already processed successfully." });
                }
                return BadRequest("Approval request has already been processed with a different status or signature.");
            }

            // 2. Semântica de Expiração
            if (approval.ExpiresAt.HasValue && DateTime.UtcNow > approval.ExpiresAt.Value)
            {
                approval.Status = "Timeout";
                approval.UpdatedAt = DateTime.UtcNow;
                await _context.SaveChangesAsync();
                return StatusCode(408, new { message = "This approval request has expired." });
            }

            // 3. Validação do Nonce do Servidor (Proteção contra Replay-Attacks)
            if (!string.IsNullOrEmpty(approval.Nonce) && approval.Nonce != payload.Nonce)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"[ALERT] Cryptographic Nonce mismatch for approval {id}. Replay-attack suspected!");
                Console.ResetColor();
                return BadRequest("Invalid cryptographic nonce. Permission denied.");
            }

            approval.Status = payload.Status; // Approved, Rejected
            approval.Signature = payload.Signature ?? string.Empty;
            approval.UpdatedAt = DateTime.UtcNow;

            if (approval.ConversationId.HasValue)
            {
                var newEvent = new CompanionEvent
                {
                    ConversationId = approval.ConversationId.Value,
                    EventType = approval.Status == "Approved" ? "ApprovalApproved" : "ApprovalRejected",
                    PayloadJson = JsonSerializer.Serialize(new {
                        id = approval.Id,
                        taskId = approval.TaskId,
                        status = approval.Status,
                        signature = approval.Signature,
                        updatedAt = approval.UpdatedAt,
                        eventId = payload.EventId // Regista o UUID v7 do telemóvel para auditabilidade
                    }),
                    Timestamp = DateTime.UtcNow
                };
                _context.CompanionEvents.Add(newEvent);
            }

            await _context.SaveChangesAsync();

            if (approval.ConversationId.HasValue)
            {
                var savedEvent = await _context.CompanionEvents
                    .OrderByDescending(e => e.SequenceId)
                    .FirstOrDefaultAsync(e => e.ConversationId == approval.ConversationId.Value);
                if (savedEvent != null)
                {
                    await _hubContext.Clients.All.SendAsync("ReceiveEvent", savedEvent);
                }
            }

            return Ok(new { message = $"Approval request processed as: {payload.Status}" });
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

        [HttpGet("/api/conversations/{id}/implementation-plan")]
        [AuthorizeDevice]
        public async Task<IActionResult> GetImplementationPlan(Guid id)
        {
            var conversation = await _context.Conversations.FindAsync(id);
            if (conversation == null) return NotFound("Conversation not found.");

            string remoteId = conversation.RemoteConversationId ?? id.ToString();
            string planPath = Path.Combine(@"C:\Users\Hugo\.gemini\antigravity\brain", remoteId, "implementation_plan.md");

            if (!System.IO.File.Exists(planPath))
            {
                return NotFound("Implementation plan not found.");
            }

            try
            {
                var lines = await System.IO.File.ReadAllLinesAsync(planPath);
                
                string goal = "";
                string reviewRequired = "";
                string openQuestions = "";
                var proposedChanges = new List<object>();
                string verificationPlan = "";
                var comments = new List<object>();

                string currentSection = "";
                string currentComponent = "Geral";

                foreach (var line in lines)
                {
                    string trimmed = line.Trim();
                    if (trimmed.StartsWith("## "))
                    {
                        currentSection = trimmed.Substring(3).Trim();
                        continue;
                    }
                    else if (trimmed.StartsWith("# ") && string.IsNullOrEmpty(goal))
                    {
                        goal = trimmed.Substring(2).Trim() + "\n";
                        currentSection = "Goal";
                        continue;
                    }
                    else if (trimmed.StartsWith("### "))
                    {
                        currentComponent = trimmed.Substring(4).Trim();
                        continue;
                    }

                    if (currentSection == "Goal")
                    {
                        goal += line + "\n";
                    }
                    else if (currentSection == "User Review Required")
                    {
                        reviewRequired += line + "\n";
                    }
                    else if (currentSection == "Open Questions")
                    {
                        openQuestions += line + "\n";
                    }
                    else if (currentSection == "Proposed Changes")
                    {
                        if (trimmed.StartsWith("#### "))
                        {
                            string raw = trimmed.Substring(5).Trim();
                            string action = "MODIFY";
                            if (raw.StartsWith("[NEW]")) action = "NEW";
                            else if (raw.StartsWith("[DELETE]")) action = "DELETE";

                            int linkStartIndex = raw.IndexOf('(');
                            int linkEndIndex = raw.LastIndexOf(')');
                            string filePath = "";
                            string fileName = "";

                            if (linkStartIndex != -1 && linkEndIndex != -1 && linkEndIndex > linkStartIndex)
                            {
                                filePath = raw.Substring(linkStartIndex + 1, linkEndIndex - linkStartIndex - 1);
                                int textStartIndex = raw.IndexOf('[');
                                int textEndIndex = raw.IndexOf(']');
                                int secondBracketStart = raw.IndexOf('[', textEndIndex + 1);
                                int secondBracketEnd = raw.IndexOf(']', textEndIndex + 1);
                                if (secondBracketStart != -1 && secondBracketEnd != -1 && secondBracketEnd > secondBracketStart)
                                {
                                    fileName = raw.Substring(secondBracketStart + 1, secondBracketEnd - secondBracketStart - 1);
                                }
                                else
                                {
                                    fileName = Path.GetFileName(filePath);
                                }
                            }

                            proposedChanges.Add(new
                            {
                                component = currentComponent,
                                action = action,
                                fileName = fileName,
                                filePath = filePath
                            });
                        }
                    }
                    else if (currentSection == "Verification Plan")
                    {
                        verificationPlan += line + "\n";
                    }
                    else if (currentSection.Contains("Feedback do Telemóvel") || currentSection.Contains("Feedback"))
                    {
                        if (trimmed.StartsWith("- "))
                        {
                            string rawComment = trimmed.Substring(2).Trim();
                            string section = "general";
                            string author = "Utilizador";
                            string text = rawComment;

                            if (rawComment.StartsWith("**["))
                            {
                                int closeBracket = rawComment.IndexOf("]**:");
                                if (closeBracket != -1)
                                {
                                    section = rawComment.Substring(3, closeBracket - 3);
                                    text = rawComment.Substring(closeBracket + 4).Trim();
                                }
                            }

                            comments.Add(new
                            {
                                section = section,
                                author = author,
                                text = text
                            });
                        }
                    }
                }

                return Ok(new
                {
                    goal = goal.Trim(),
                    reviewRequired = reviewRequired.Trim(),
                    openQuestions = openQuestions.Trim(),
                    proposedChanges = proposedChanges,
                    verificationPlan = verificationPlan.Trim(),
                    comments = comments
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Error parsing implementation plan: {ex.Message}");
            }
        }

        public record AddCommentPayload(string Section, string CommentText);

        [HttpPost("/api/conversations/{id}/implementation-plan/comments")]
        [AuthorizeDevice]
        public async Task<IActionResult> AddImplementationPlanComment(Guid id, [FromBody] AddCommentPayload payload)
        {
            if (string.IsNullOrWhiteSpace(payload.CommentText))
            {
                return BadRequest("Comment text cannot be empty.");
            }

            var conversation = await _context.Conversations.FindAsync(id);
            if (conversation == null) return NotFound("Conversation not found.");

            string remoteId = conversation.RemoteConversationId ?? id.ToString();
            string planPath = Path.Combine(@"C:\Users\Hugo\.gemini\antigravity\brain", remoteId, "implementation_plan.md");

            if (!System.IO.File.Exists(planPath))
            {
                return NotFound("Implementation plan not found.");
            }

            try
            {
                string planContent = await System.IO.File.ReadAllTextAsync(planPath);
                string feedbackHeader = "## 💬 Feedback do Telemóvel";
                
                string newCommentLine = $"- **[{payload.Section}]**: {payload.CommentText}";

                if (planContent.Contains(feedbackHeader))
                {
                    int headerIndex = planContent.IndexOf(feedbackHeader);
                    string before = planContent.Substring(0, headerIndex + feedbackHeader.Length);
                    string after = planContent.Substring(headerIndex + feedbackHeader.Length);
                    
                    planContent = before + "\n" + newCommentLine + after;
                }
                else
                {
                    planContent = planContent.TrimEnd() + "\n\n" + feedbackHeader + "\n" + newCommentLine + "\n";
                }

                await System.IO.File.WriteAllTextAsync(planPath, planContent);

                string logsDir = Path.Combine(@"C:\Users\Hugo\.gemini\antigravity\brain", remoteId, ".system_generated", "logs");
                string logPath = Path.Combine(logsDir, "transcript.jsonl");

                if (System.IO.File.Exists(logPath))
                {
                    int nextStepIndex = 1;
                    try
                    {
                        var lastLines = await System.IO.File.ReadAllLinesAsync(logPath);
                        for (int i = lastLines.Length - 1; i >= 0; i--)
                        {
                            var line = lastLines[i];
                            if (string.IsNullOrWhiteSpace(line)) continue;
                            var parsed = JsonSerializer.Deserialize<TranscriptLine>(line);
                            if (parsed != null)
                            {
                                nextStepIndex = parsed.step_index + 1;
                                break;
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Error determining step index: {ex.Message}");
                    }

                    var newLogEntry = new
                    {
                        step_index = nextStepIndex,
                        source = "USER_EXPLICIT",
                        type = "USER_INPUT",
                        status = "DONE",
                        content = $"💬 [Comentário do Telemóvel - {payload.Section}]: {payload.CommentText}",
                        created_at = DateTime.UtcNow.ToString("o")
                    };

                    string jsonLine = JsonSerializer.Serialize(newLogEntry) + "\n";
                    await System.IO.File.AppendAllTextAsync(logPath, jsonLine);

                    var commentMessage = new ConversationMessage
                    {
                        ConversationId = id,
                        Role = "user-ide",
                        Content = $"💬 **Comentário do Telemóvel ({payload.Section})**: {payload.CommentText}",
                        Timestamp = DateTime.UtcNow
                    };
                    _context.ConversationMessages.Add(commentMessage);
                    conversation.UpdatedAt = DateTime.UtcNow;
                    await _context.SaveChangesAsync();

                    await _hubContext.Clients.All.SendAsync(
                        "ReceiveMessage",
                        id.ToString(),
                        commentMessage.Id.ToString(),
                        "user-ide",
                        commentMessage.Content,
                        commentMessage.Timestamp.ToString("o")
                    );
                }

                return Ok(new { message = "Comment successfully added." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Error writing comment: {ex.Message}");
            }
        }
    }
}
