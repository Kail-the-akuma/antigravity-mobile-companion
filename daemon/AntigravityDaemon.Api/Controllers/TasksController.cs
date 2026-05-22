using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using AntigravityDaemon.Data;
using AntigravityDaemon.Core.Models;
using AntigravityDaemon.Api.Hubs;
using AntigravityDaemon.Api.Filters;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace AntigravityDaemon.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class TasksController : ControllerBase
    {
        private readonly DaemonDbContext _context;
        private readonly IHubContext<CompanionHub> _hubContext;

        public TasksController(DaemonDbContext context, IHubContext<CompanionHub> hubContext)
        {
            _context = context;
            _hubContext = hubContext;
        }

        // GET: api/tasks
        [HttpGet]
        [AuthorizeDevice]
        public async Task<ActionResult<IEnumerable<TaskItem>>> GetTasks()
        {
            return await _context.Tasks.ToListAsync();
        }

        public record CreateTaskRequest(string Prompt);

        // POST: api/tasks (Injected remotely from the Mobile Companion App)
        [HttpPost]
        [AuthorizeDevice]
        public async Task<ActionResult<TaskItem>> CreateTask([FromBody] CreateTaskRequest request)
        {
            var taskItem = new TaskItem
            {
                Prompt = request.Prompt,
                Status = "Running",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            _context.Tasks.Add(taskItem);
            await _context.SaveChangesAsync();

            // Broadcast the new task to the mobile client in real-time
            await _hubContext.Clients.All.SendAsync("ReceiveTaskUpdate", taskItem.Id.ToString(), taskItem.Status, taskItem.PlanJson);

            return CreatedAtAction(nameof(GetTasks), new { id = taskItem.Id }, taskItem);
        }

        public record UpdateTaskStatusRequest(string Status, string PlanJson, string ModifiedFilesJson);

        // POST: api/tasks/{id}/status (Called locally by the Antigravity Agent to update its state)
        [HttpPost("{id}/status")]
        public async Task<IActionResult> UpdateTaskStatus(Guid id, [FromBody] UpdateTaskStatusRequest request)
        {
            var taskItem = await _context.Tasks.FindAsync(id);
            if (taskItem == null)
            {
                return NotFound();
            }

            taskItem.Status = request.Status;
            taskItem.PlanJson = request.PlanJson ?? taskItem.PlanJson;
            taskItem.ModifiedFilesJson = request.ModifiedFilesJson ?? taskItem.ModifiedFilesJson;
            taskItem.UpdatedAt = DateTime.UtcNow;

            await _context.SaveChangesAsync();

            // Broadcast the state update to all mobile clients in real-time
            await _hubContext.Clients.All.SendAsync("ReceiveTaskUpdate", taskItem.Id.ToString(), taskItem.Status, taskItem.PlanJson);

            return Ok(taskItem);
        }
    }
}
