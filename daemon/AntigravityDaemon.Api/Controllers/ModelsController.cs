using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using AntigravityDaemon.Api.Filters;
using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Collections.Generic;

namespace AntigravityDaemon.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ModelsController : ControllerBase
    {
        private readonly IConfiguration _configuration;

        public ModelsController(IConfiguration configuration)
        {
            _configuration = configuration;
        }

        // GET: api/models/quota — retrieves credits, overages toggle state, and active model quotas
        [HttpGet("quota")]
        [AuthorizeDevice]
        public IActionResult GetQuota()
        {
            // Read settings from config with default values matching the reference mockup
            int availableCredits = 18;
            if (int.TryParse(_configuration["ModelSettings:AvailableCredits"], out int creds))
            {
                availableCredits = creds;
            }

            bool enableOverages = true;
            if (bool.TryParse(_configuration["ModelSettings:EnableOverages"], out bool overages))
            {
                enableOverages = overages;
            }

            var modelQuotas = new List<object>
            {
                new { name = "Gemini 3.5 Flash (Medium)", remainingSegments = 1, totalSegments = 5, refreshTime = "Refreshes in 3 hours, 39 minutes", isDepleted = false },
                new { name = "Gemini 3.5 Flash (High)", remainingSegments = 1, totalSegments = 5, refreshTime = "Refreshes in 3 hours, 39 minutes", isDepleted = false },
                new { name = "Gemini 3.1 Pro (Low)", remainingSegments = 2, totalSegments = 5, refreshTime = "Refreshes in 3 hours, 39 minutes", isDepleted = false },
                new { name = "Gemini 3.1 Pro (High)", remainingSegments = 2, totalSegments = 5, refreshTime = "Refreshes in 3 hours, 39 minutes", isDepleted = false },
                new { name = "Claude Sonnet 4.6 (Thinking)", remainingSegments = 0, totalSegments = 5, refreshTime = "Refreshes in 4 days, 1 hour", isDepleted = true },
                new { name = "Claude Opus 4.6 (Thinking)", remainingSegments = 0, totalSegments = 5, refreshTime = "Refreshes in 4 days, 1 hour", isDepleted = true },
                new { name = "GPT-OSS 120B (Medium)", remainingSegments = 0, totalSegments = 5, refreshTime = "Refreshes in 4 days, 1 hour", isDepleted = true }
            };

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

        // POST: api/models/overages — dynamically toggles and persists overages status in appsettings.json
        [HttpPost("overages")]
        [AuthorizeDevice]
        public async Task<IActionResult> SetOverages([FromBody] OveragesRequest request)
        {
            try
            {
                string appSettingsPath = Path.Combine(Directory.GetCurrentDirectory(), "appsettings.json");
                if (System.IO.File.Exists(appSettingsPath))
                {
                    var jsonString = await System.IO.File.ReadAllTextAsync(appSettingsPath);
                    var jsonNode = JsonNode.Parse(jsonString);

                    if (jsonNode != null)
                    {
                        // Ensure ModelSettings exists
                        if (jsonNode["ModelSettings"] == null)
                        {
                            jsonNode["ModelSettings"] = new JsonObject();
                        }

                        // Ensure AvailableCredits is initialized if missing
                        if (jsonNode["ModelSettings"]["AvailableCredits"] == null)
                        {
                            jsonNode["ModelSettings"]["AvailableCredits"] = 18;
                        }

                        jsonNode["ModelSettings"]["EnableOverages"] = request.EnableOverages;

                        var options = new JsonSerializerOptions { WriteIndented = true };
                        await System.IO.File.WriteAllTextAsync(appSettingsPath, jsonNode.ToJsonString(options));
                        
                        return Ok(new { success = true, enableOverages = request.EnableOverages });
                    }
                }

                return BadRequest("Could not locate appsettings.json file to write settings.");
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }
    }
}
