using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using AntigravityDaemon.Data;
using AntigravityDaemon.Core.Models;
using AntigravityDaemon.Api.Hubs;
using AntigravityDaemon.Api.Filters;
using Microsoft.EntityFrameworkCore;
using System;
using System.Threading.Tasks;

namespace AntigravityDaemon.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ApprovalsController : ControllerBase
    {
        private readonly DaemonDbContext _context;
        private readonly IHubContext<CompanionHub> _hubContext;

        public ApprovalsController(DaemonDbContext context, IHubContext<CompanionHub> hubContext)
        {
            _context = context;
            _hubContext = hubContext;
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

            var approval = new ApprovalRequest
            {
                TaskId = resolvedTaskId,
                PlanStepsJson = payload.PlanStepsJson,
                Status = "Pending",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            _context.Approvals.Add(approval);
            await _context.SaveChangesAsync();

            // Broadcast the approval request to the Mobile Companion App via WebSockets
            await _hubContext.Clients.All.SendAsync("ReceiveApprovalRequest", approval.Id.ToString(), approval.TaskId.ToString(), approval.PlanStepsJson);

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
            var approval = new ApprovalRequest
            {
                TaskId = task.Id,
                PlanStepsJson = "[\n  \"1. Criar novo ficheiro de testes em tests/auth.spec.ts\",\n  \"2. Implementar mocks de base de dados para utilizador\",\n  \"3. Executar testes e validar cobertura de 95%\"\n]",
                Status = "Pending",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            _context.Approvals.Add(approval);
            await _context.SaveChangesAsync();

            // Broadcast the new task to the mobile client
            await _hubContext.Clients.All.SendAsync("ReceiveTaskUpdate", task.Id.ToString(), task.Status, task.PlanJson);

            // Broadcast the approval request
            await _hubContext.Clients.All.SendAsync("ReceiveApprovalRequest", approval.Id.ToString(), approval.TaskId.ToString(), approval.PlanStepsJson);

            return Ok(new
            {
                message = "Simulação iniciada! Verifique o ecrã do seu telemóvel.",
                taskId = task.Id,
                approvalId = approval.Id
            });
        }

        public record RespondApprovalPayload(string Status, string Signature);

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

            if (approval.Status != "Pending")
            {
                return BadRequest("Approval request has already been processed.");
            }

            approval.Status = payload.Status; // Approved, Rejected
            approval.Signature = payload.Signature ?? string.Empty;
            approval.UpdatedAt = DateTime.UtcNow;

            await _context.SaveChangesAsync();

            return Ok(new { message = $"Approval request processed as: {payload.Status}" });
        }
    }
}
