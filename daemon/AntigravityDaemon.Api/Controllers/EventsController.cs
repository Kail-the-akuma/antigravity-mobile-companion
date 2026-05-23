using Microsoft.AspNetCore.Mvc;
using AntigravityDaemon.Data;
using AntigravityDaemon.Core.Models;
using AntigravityDaemon.Api.Filters;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace AntigravityDaemon.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class EventsController : ControllerBase
    {
        private readonly DaemonDbContext _context;

        public EventsController(DaemonDbContext context)
        {
            _context = context;
        }

        // GET: api/events/sync
        [HttpGet("sync")]
        [AuthorizeDevice]
        public async Task<ActionResult<IEnumerable<CompanionEvent>>> SyncEvents([FromQuery] Guid conversationId, [FromQuery] long sinceId)
        {
            var events = await _context.CompanionEvents
                .Where(e => e.ConversationId == conversationId && e.SequenceId > sinceId)
                .OrderBy(e => e.SequenceId)
                .ToListAsync();

            return Ok(events);
        }
    }
}
