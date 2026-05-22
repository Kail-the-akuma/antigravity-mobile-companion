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

        public record RequestApprovalPayload(Guid TaskId, string PlanStepsJson);

        // POST: api/approvals/request (Called locally by the Antigravity Agent to pause and wait for approval)
        [HttpPost("request")]
        public async Task<IActionResult> RequestApproval([FromBody] RequestApprovalPayload payload)
        {
            var taskExists = await _context.Tasks.AnyAsync(t => t.Id == payload.TaskId);
            if (!taskExists)
            {
                return BadRequest("Task not found.");
            }

            var approval = new ApprovalRequest
            {
                TaskId = payload.TaskId,
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
