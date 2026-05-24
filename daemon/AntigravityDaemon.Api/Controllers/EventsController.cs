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
        public async Task<ActionResult<IEnumerable<CompanionEvent>>> SyncEvents(
            [FromQuery] Guid conversationId, 
            [FromQuery] long sinceId,
            [FromQuery] long? upToId = null)
        {
            var query = _context.CompanionEvents
                .Where(e => e.ConversationId == conversationId && e.SequenceId > sinceId);

            if (upToId.HasValue)
            {
                query = query.Where(e => e.SequenceId <= upToId.Value);
            }

            var events = await query
                .OrderBy(e => e.SequenceId)
                .ToListAsync();

            return Ok(events);
        }
    }
}
