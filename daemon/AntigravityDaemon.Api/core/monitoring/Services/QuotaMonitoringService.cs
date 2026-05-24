using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;

namespace AntigravityDaemon.Api.Core.Monitoring.Services
{
    public interface IQuotaMonitoringService
    {
        int GetAvailableCredits();
        bool GetEnableOverages();
        IEnumerable<object> GetModelQuotas();
        Task<bool> SetEnableOveragesAsync(bool enableOverages);
    }

    public class QuotaMonitoringService : IQuotaMonitoringService
    {
        private readonly IConfiguration _configuration;

        public QuotaMonitoringService(IConfiguration configuration)
        {
            _configuration = configuration;
        }

        public int GetAvailableCredits()
        {
            if (int.TryParse(_configuration["ModelSettings:AvailableCredits"], out int creds))
            {
                return creds;
            }
            return 18; // Default mockup reference
        }

        public bool GetEnableOverages()
        {
            if (bool.TryParse(_configuration["ModelSettings:EnableOverages"], out bool overages))
            {
                return overages;
            }
            return true; // Default mockup reference
        }

        public IEnumerable<object> GetModelQuotas()
        {
            return new List<object>
            {
                new { name = "Gemini 3.1 Pro (High)", remainingSegments = 2, totalSegments = 5, refreshTime = "Refreshes in 4 hours, 20 minutes", isDepleted = false },
                new { name = "Claude Sonnet 4.6 (Thinking)", remainingSegments = 0, totalSegments = 5, refreshTime = "Refreshes in 2 days, 23 hours", isDepleted = true },
                new { name = "Claude Opus 4.6 (Thinking)", remainingSegments = 0, totalSegments = 5, refreshTime = "Refreshes in 2 days, 23 hours", isDepleted = true },
                new { name = "GPT-OSS 120B (Medium)", remainingSegments = 0, totalSegments = 5, refreshTime = "Refreshes in 2 days, 23 hours", isDepleted = true },
                new { name = "Gemini 3.5 Flash (Medium)", remainingSegments = 2, totalSegments = 5, refreshTime = "Refreshes in 4 hours, 20 minutes", isDepleted = false },
                new { name = "Gemini 3.5 Flash (High)", remainingSegments = 2, totalSegments = 5, refreshTime = "Refreshes in 4 hours, 20 minutes", isDepleted = false },
                new { name = "Gemini 3.1 Pro (Low)", remainingSegments = 1, totalSegments = 5, refreshTime = "Refreshes in 4 hours, 20 minutes", isDepleted = false }
            };
        }

        public async Task<bool> SetEnableOveragesAsync(bool enableOverages)
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
                        if (jsonNode["ModelSettings"] == null)
                        {
                            jsonNode["ModelSettings"] = new JsonObject();
                        }

                        if (jsonNode["ModelSettings"]["AvailableCredits"] == null)
                        {
                            jsonNode["ModelSettings"]["AvailableCredits"] = 18;
                        }

                        jsonNode["ModelSettings"]["EnableOverages"] = enableOverages;

                        var options = new JsonSerializerOptions { WriteIndented = true };
                        await System.IO.File.WriteAllTextAsync(appSettingsPath, jsonNode.ToJsonString(options));
                        return true;
                    }
                }
                return false;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[QuotaMonitoringService] Error writing appsettings: {ex.Message}");
                return false;
            }
        }
    }
}
