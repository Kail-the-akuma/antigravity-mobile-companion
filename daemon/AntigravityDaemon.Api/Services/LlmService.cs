using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using AntigravityDaemon.Core.Models;
using AntigravityDaemon.Core.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace AntigravityDaemon.Api.Services
{
    public class LlmService : ILlmService
    {
        private readonly HttpClient _httpClient;
        private readonly IConfiguration _configuration;
        private readonly ILogger<LlmService> _logger;

        public LlmService(HttpClient httpClient, IConfiguration configuration, ILogger<LlmService> logger)
        {
            _httpClient = httpClient;
            _configuration = configuration;
            _logger = logger;
        }

        public async Task<string> GenerateResponseAsync(List<ConversationMessage> messages, string systemPrompt)
        {
            string provider = _configuration["LlmSettings:Provider"] ?? "Simulated";
            string apiKey = _configuration["LlmSettings:ApiKey"] ?? "";
            string model = _configuration["LlmSettings:Model"] ?? "";

            // Check if environment variables exist as overrides
            string envProvider = Environment.GetEnvironmentVariable("LLM_PROVIDER");
            if (!string.IsNullOrEmpty(envProvider)) provider = envProvider;

            string envApiKey = Environment.GetEnvironmentVariable("GEMINI_API_KEY") 
                ?? Environment.GetEnvironmentVariable("OPENAI_API_KEY") 
                ?? Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY")
                ?? Environment.GetEnvironmentVariable("LLM_API_KEY");
            if (!string.IsNullOrEmpty(envApiKey)) apiKey = envApiKey;

            string envModel = Environment.GetEnvironmentVariable("LLM_MODEL");
            if (!string.IsNullOrEmpty(envModel)) model = envModel;

            _logger.LogInformation($"Using LLM Provider: {provider}, Model: {model}");

            if (provider.Equals("Simulated", StringComparison.OrdinalIgnoreCase) || string.IsNullOrEmpty(apiKey) && !provider.Equals("Ollama", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning("No API Key or Simulated provider active. Using local simulation fallback.");
                return GenerateSimulatedReply(messages);
            }

            try
            {
                if (provider.Equals("Gemini", StringComparison.OrdinalIgnoreCase))
                {
                    return await CallGeminiAsync(messages, systemPrompt, apiKey, model);
                }
                else if (provider.Equals("OpenAI", StringComparison.OrdinalIgnoreCase))
                {
                    return await CallOpenAiAsync(messages, systemPrompt, apiKey, model);
                }
                else if (provider.Equals("Anthropic", StringComparison.OrdinalIgnoreCase))
                {
                    return await CallAnthropicAsync(messages, systemPrompt, apiKey, model);
                }
                else if (provider.Equals("Ollama", StringComparison.OrdinalIgnoreCase))
                {
                    return await CallOllamaAsync(messages, systemPrompt, model);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Failed to query LLM Provider '{provider}'. Falling back to simulated reply.");
            }

            return GenerateSimulatedReply(messages);
        }

        private async Task<string> CallGeminiAsync(List<ConversationMessage> messages, string systemPrompt, string apiKey, string model)
        {
            if (string.IsNullOrEmpty(model)) model = "gemini-1.5-flash";
            string url = $"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}";

            var contents = new List<object>();
            foreach (var m in messages)
            {
                contents.Add(new
                {
                    role = m.Role == "user" ? "user" : "model",
                    parts = new[] { new { text = m.Content } }
                });
            }

            var payload = new
            {
                contents = contents,
                systemInstruction = new
                {
                    parts = new[] { new { text = systemPrompt } }
                }
            };

            var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = JsonContent.Create(payload)
            };

            var response = await _httpClient.SendAsync(request);
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadFromJsonAsync<JsonNode>();
            string reply = json?["candidates"]?[0]?["content"]?["parts"]?[0]?["text"]?.ToString();

            return reply ?? "Error: Gemini returned an empty response.";
        }

        private async Task<string> CallOpenAiAsync(List<ConversationMessage> messages, string systemPrompt, string apiKey, string model)
        {
            if (string.IsNullOrEmpty(model)) model = "gpt-4o-mini";
            string url = "https://api.openai.com/v1/chat/completions";

            var msgs = new List<object>
            {
                new { role = "system", content = systemPrompt }
            };

            foreach (var m in messages)
            {
                msgs.Add(new
                {
                    role = m.Role == "user" ? "user" : "assistant",
                    content = m.Content
                });
            }

            var payload = new
            {
                model = model,
                messages = msgs,
                temperature = 0.7
            };

            var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = JsonContent.Create(payload)
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

            var response = await _httpClient.SendAsync(request);
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadFromJsonAsync<JsonNode>();
            string reply = json?["choices"]?[0]?["message"]?["content"]?.ToString();

            return reply ?? "Error: OpenAI returned an empty response.";
        }

        private async Task<string> CallAnthropicAsync(List<ConversationMessage> messages, string systemPrompt, string apiKey, string model)
        {
            if (string.IsNullOrEmpty(model)) model = "claude-3-5-sonnet-20241022";
            string url = "https://api.anthropic.com/v1/messages";

            var msgs = new List<object>();
            foreach (var m in messages)
            {
                msgs.Add(new
                {
                    role = m.Role == "user" ? "user" : "assistant",
                    content = m.Content
                });
            }

            var payload = new
            {
                model = model,
                max_tokens = 4096,
                system = systemPrompt,
                messages = msgs
            };

            var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = JsonContent.Create(payload)
            };
            request.Headers.Add("x-api-key", apiKey);
            request.Headers.Add("anthropic-version", "2023-06-01");

            var response = await _httpClient.SendAsync(request);
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadFromJsonAsync<JsonNode>();
            string reply = json?["content"]?[0]?["text"]?.ToString();

            return reply ?? "Error: Anthropic returned an empty response.";
        }

        private async Task<string> CallOllamaAsync(List<ConversationMessage> messages, string systemPrompt, string model)
        {
            if (string.IsNullOrEmpty(model)) model = "llama3";
            string baseUrl = _configuration["LlmSettings:ApiUrl"] ?? "http://localhost:11434";
            string url = $"{baseUrl.TrimEnd('/')}/api/chat";

            var msgs = new List<object>
            {
                new { role = "system", content = systemPrompt }
            };

            foreach (var m in messages)
            {
                msgs.Add(new
                {
                    role = m.Role == "user" ? "user" : "assistant",
                    content = m.Content
                });
            }

            var payload = new
            {
                model = model,
                messages = msgs,
                stream = false
            };

            var response = await _httpClient.PostAsJsonAsync(url, payload);
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadFromJsonAsync<JsonNode>();
            string reply = json?["message"]?["content"]?.ToString();

            return reply ?? "Error: Ollama returned an empty response.";
        }

        private string GenerateSimulatedReply(List<ConversationMessage> messages)
        {
            var lastUserMessage = messages.FindLast(m => m.Role == "user")?.Content ?? "";
            var lower = lastUserMessage.ToLowerInvariant();

            if (lower.Contains("olá") || lower.Contains("oi") || lower.Contains("hello"))
                return "Olá! Sou o Antigravity. Como o modo simulado está ativo, estou a responder-te offline. Para usares inteligência artificial real, configura a tua API Key no ficheiro `appsettings.json` ou nas variáveis de ambiente!";

            if (lower.Contains("ajuda") || lower.Contains("help"))
                return "Estou em modo Simulado local. Posso simular comandos simples. Configura a tua API Key do Gemini, OpenAI ou Anthropic para que eu possa realmente ler os teus ficheiros locais e executar comandos a partir daqui!";

            if (lower.Contains("status") || lower.Contains("estado"))
                return "🟢 Sistema operacional em modo Simulado local. Workspace: " + (_configuration["WorkspaceSettings:Path"] ?? "Default");

            return $"✅ [Modo Simulado] Recebi: \"{lastUserMessage}\"\n\nInstala uma API Key do LLM para desbloquear o controlo remoto real do teu IDE!";
        }
    }
}
