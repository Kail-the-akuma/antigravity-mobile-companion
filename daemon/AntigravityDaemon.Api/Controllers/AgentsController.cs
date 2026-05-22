using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using AntigravityDaemon.Data;
using AntigravityDaemon.Core.Models;
using AntigravityDaemon.Api.Hubs;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace AntigravityDaemon.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AgentsController : ControllerBase
    {
        private readonly DaemonDbContext _context;
        private readonly IHubContext<CompanionHub> _hubContext;

        public AgentsController(DaemonDbContext context, IHubContext<CompanionHub> hubContext)
        {
            _context = context;
            _hubContext = hubContext;
        }

        // GET: api/agents — list all registered agents
        [HttpGet]
        public async Task<ActionResult<IEnumerable<AgentProfile>>> GetAgents()
        {
            var antigravityId = new Guid("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
            var agent = await _context.Agents.FindAsync(antigravityId);
            if (agent != null)
            {
                agent.IsOnline = true;
                agent.LastPing = DateTime.UtcNow;
                await _context.SaveChangesAsync();
            }
            return await _context.Agents.ToListAsync();
        }

        public record RegisterAgentRequest(
            string Name,
            string Description,
            string IconEmoji,
            string Capabilities
        );

        // POST: api/agents/register — agent self-registers (no device auth, called by agent on startup)
        [HttpPost("register")]
        public async Task<ActionResult<AgentProfile>> RegisterAgent([FromBody] RegisterAgentRequest request)
        {
            // Check if agent with same name already exists — update rather than duplicate
            var existing = await _context.Agents
                .FirstOrDefaultAsync(a => a.Name == request.Name);

            if (existing != null)
            {
                existing.Description = request.Description;
                existing.IconEmoji = request.IconEmoji;
                existing.Capabilities = request.Capabilities;
                existing.IsOnline = true;
                existing.LastPing = DateTime.UtcNow;
                await _context.SaveChangesAsync();

                await _hubContext.Clients.All.SendAsync("AgentStatusChanged", existing.Id.ToString(), true);
                return Ok(existing);
            }

            var agent = new AgentProfile
            {
                Name = request.Name,
                Description = request.Description,
                IconEmoji = request.IconEmoji,
                Capabilities = request.Capabilities,
                IsOnline = true,
                LastPing = DateTime.UtcNow,
                RegisteredAt = DateTime.UtcNow,
            };

            _context.Agents.Add(agent);
            await _context.SaveChangesAsync();

            await _hubContext.Clients.All.SendAsync("AgentStatusChanged", agent.Id.ToString(), true);
            return CreatedAtAction(nameof(GetAgents), new { id = agent.Id }, agent);
        }

        // POST: api/agents/{id}/ping — keep-alive, marks agent as online
        [HttpPost("{id}/ping")]
        public async Task<IActionResult> PingAgent(Guid id)
        {
            var agent = await _context.Agents.FindAsync(id);
            if (agent == null) return NotFound();

            var wasOffline = !agent.IsOnline;
            agent.IsOnline = true;
            agent.LastPing = DateTime.UtcNow;
            await _context.SaveChangesAsync();

            if (wasOffline)
            {
                await _hubContext.Clients.All.SendAsync("AgentStatusChanged", agent.Id.ToString(), true);
            }

            return Ok(new { status = "ok", lastPing = agent.LastPing });
        }

        // POST: api/agents/{id}/offline — marks agent as offline (called on graceful shutdown)
        [HttpPost("{id}/offline")]
        public async Task<IActionResult> SetAgentOffline(Guid id)
        {
            var agent = await _context.Agents.FindAsync(id);
            if (agent == null) return NotFound();

            agent.IsOnline = false;
            await _context.SaveChangesAsync();

            await _hubContext.Clients.All.SendAsync("AgentStatusChanged", agent.Id.ToString(), false);
            return Ok();
        }
    }
}
