using Microsoft.AspNetCore.Mvc;
using AntigravityDaemon.Api.Filters;
using AntigravityDaemon.Api.Core.Monitoring.Services;
using System.Threading.Tasks;

namespace AntigravityDaemon.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ModelsController : ControllerBase
    {
        private readonly IQuotaMonitoringService _quotaService;

        public ModelsController(IQuotaMonitoringService quotaService)
        {
            _quotaService = quotaService;
        }

        // GET: api/models/quota — retrieves credits, overages toggle state, and active model quotas
        [HttpGet("quota")]
        [AuthorizeDevice]
        public IActionResult GetQuota()
        {
            var availableCredits = _quotaService.GetAvailableCredits();
            var enableOverages = _quotaService.GetEnableOverages();
            var modelQuotas = _quotaService.GetModelQuotas();

            return Ok(new
            {
                availableCredits,
                enableOverages,
                modelQuotas
            });
        }

        public class OveragesRequest
        {
            public bool EnableOverages { get; set; }
        }

        // POST: api/models/overages — dynamically toggles and persists overages status
        [HttpPost("overages")]
        [AuthorizeDevice]
        public async Task<IActionResult> SetOverages([FromBody] OveragesRequest request)
        {
            var success = await _quotaService.SetEnableOveragesAsync(request.EnableOverages);
            if (success)
            {
                return Ok(new { success = true, enableOverages = request.EnableOverages });
            }

            return BadRequest("Could not persist configuration changes.");
        }
    }
}
