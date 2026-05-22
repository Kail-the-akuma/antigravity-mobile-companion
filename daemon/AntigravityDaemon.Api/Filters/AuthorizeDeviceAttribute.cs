using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Http;
using System;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using AntigravityDaemon.Data;
using Microsoft.EntityFrameworkCore;

namespace AntigravityDaemon.Api.Filters
{
    [AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
    public class AuthorizeDeviceAttribute : ActionFilterAttribute
    {
        private static readonly ConcurrentDictionary<string, DateTime> _validatedNonces = new();

        public override async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
        {
            var request = context.HttpContext.Request;

            // 1. Extract headers
            if (!request.Headers.TryGetValue("X-Device-Id", out var deviceIdVal) ||
                !request.Headers.TryGetValue("X-Timestamp", out var timestampVal) ||
                !request.Headers.TryGetValue("X-Nonce", out var nonceVal) ||
                !request.Headers.TryGetValue("X-Signature", out var signatureVal))
            {
                context.Result = new UnauthorizedObjectResult("Missing required cryptographic headers (X-Device-Id, X-Timestamp, X-Nonce, X-Signature).");
                return;
            }

            string deviceId = deviceIdVal.ToString();
            string timestamp = timestampVal.ToString();
            string nonce = nonceVal.ToString();
            string clientSignature = signatureVal.ToString();

            // 2. Prevent replay attacks (check if timestamp is within 5 minutes)
            if (!DateTime.TryParse(timestamp, null, System.Globalization.DateTimeStyles.RoundtripKind, out var parsedTimestamp))
            {
                if (!long.TryParse(timestamp, out var unixSeconds))
                {
                    context.Result = new UnauthorizedObjectResult("Invalid timestamp format.");
                    return;
                }
                parsedTimestamp = DateTimeOffset.FromUnixTimeSeconds(unixSeconds).UtcDateTime;
            }

            var timeDifference = DateTime.UtcNow - parsedTimestamp.ToUniversalTime();
            if (Math.Abs(timeDifference.TotalMinutes) > 5)
            {
                context.Result = new UnauthorizedObjectResult("Request timestamp is too old or in the future. Clock may be out of sync.");
                return;
            }

            // 3. Prevent replay attacks (Nonce tracking)
            // Perform automatic bound pruning of expired nonces first
            var now = DateTime.UtcNow;
            foreach (var kvp in _validatedNonces)
            {
                if ((now - kvp.Value).TotalMinutes > 5)
                {
                    _validatedNonces.TryRemove(kvp.Key, out _);
                }
            }

            if (_validatedNonces.ContainsKey(nonce))
            {
                context.Result = new UnauthorizedObjectResult("Cryptographic nonce has already been used. Replay attempt rejected.");
                return;
            }

            // 4. Find device and secret key in DB
            var dbContext = context.HttpContext.RequestServices.GetRequiredService<DaemonDbContext>();
            if (!Guid.TryParse(deviceId, out var deviceIdGuid))
            {
                context.Result = new UnauthorizedObjectResult("Invalid device ID format.");
                return;
            }

            var device = await dbContext.TrustedDevices.FindAsync(deviceIdGuid);
            if (device == null)
            {
                context.Result = new UnauthorizedObjectResult("Device is not paired or authorized.");
                return;
            }

            // 5. Read the raw request body safely by enabling buffering
            request.EnableBuffering();
            string rawBody = string.Empty;
            if (request.ContentLength > 0)
            {
                request.Body.Position = 0;
                using (var reader = new System.IO.StreamReader(request.Body, Encoding.UTF8, leaveOpen: true))
                {
                    rawBody = await reader.ReadToEndAsync();
                }
                request.Body.Position = 0; // Reset position for model binding/subsequent reads
            }

            // Also keep the serialized payload as a robust fallback
            string payload = string.Empty;
            foreach (var key in context.ActionArguments.Keys)
            {
                var arg = context.ActionArguments[key];
                if (arg != null && arg.GetType().IsClass && arg.GetType() != typeof(string))
                {
                    payload = System.Text.Json.JsonSerializer.Serialize(arg, new System.Text.Json.JsonSerializerOptions
                    {
                        PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
                        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
                    });
                    break;
                }
            }

            // 6. Verify signature: support raw body, unicode-decoded and raw re-serialized payloads
            string decodedPayload = System.Text.RegularExpressions.Regex.Replace(
                payload,
                @"\\u([0-9a-fA-F]{4})",
                m => ((char)int.Parse(m.Groups[1].Value, System.Globalization.NumberStyles.HexNumber)).ToString()
            );

            bool signaturesMatch = false;
            string localSignature = "";

            // Try first with raw request body (most reliable, matches client JSON.stringify byte-for-byte)
            string messageRawBody = $"{rawBody}|{timestamp}|{nonce}|{device.SecretKey}";
            using (var sha256 = SHA256.Create())
            {
                var hashBytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(messageRawBody));
                localSignature = BitConverter.ToString(hashBytes).Replace("-", "").ToLower();
                byte[] clientSigBytes = Encoding.UTF8.GetBytes(clientSignature.ToLowerInvariant());
                byte[] localSigBytes = Encoding.UTF8.GetBytes(localSignature);
                signaturesMatch = CryptographicOperations.FixedTimeEquals(clientSigBytes, localSigBytes);
            }

            // Fallback 1: Try with decodedPayload
            if (!signaturesMatch)
            {
                string messageDecoded = $"{decodedPayload}|{timestamp}|{nonce}|{device.SecretKey}";
                using (var sha256 = SHA256.Create())
                {
                    var hashBytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(messageDecoded));
                    localSignature = BitConverter.ToString(hashBytes).Replace("-", "").ToLower();
                    byte[] clientSigBytes = Encoding.UTF8.GetBytes(clientSignature.ToLowerInvariant());
                    byte[] localSigBytes = Encoding.UTF8.GetBytes(localSignature);
                    signaturesMatch = CryptographicOperations.FixedTimeEquals(clientSigBytes, localSigBytes);
                }
            }

            // Fallback 2: Try with raw re-serialized payload
            if (!signaturesMatch)
            {
                string messageRaw = $"{payload}|{timestamp}|{nonce}|{device.SecretKey}";
                using (var sha256 = SHA256.Create())
                {
                    var hashBytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(messageRaw));
                    localSignature = BitConverter.ToString(hashBytes).Replace("-", "").ToLower();
                    byte[] clientSigBytes = Encoding.UTF8.GetBytes(clientSignature.ToLowerInvariant());
                    byte[] localSigBytes = Encoding.UTF8.GetBytes(localSignature);
                    signaturesMatch = CryptographicOperations.FixedTimeEquals(clientSigBytes, localSigBytes);
                }
            }

            // Console debugging for transparent diagnostics
            Console.WriteLine("\n[Cryptographic Signature Debug]");
            Console.WriteLine($"  - Method:        {request.Method}");
            Console.WriteLine($"  - Path:          {request.Path}");
            Console.WriteLine($"  - Raw Payload:   '{payload}'");
            Console.WriteLine($"  - Dec Payload:   '{decodedPayload}'");
            Console.WriteLine($"  - Client Sig:    {clientSignature}");
            Console.WriteLine($"  - Computed Sig:  {localSignature}");
            Console.WriteLine(signaturesMatch 
                ? "  - Result:        ✅ MATCH" 
                : "  - Result:        ❌ MISMATCH");

            if (!signaturesMatch)
            {
                context.Result = new UnauthorizedObjectResult("Cryptographic signature mismatch. Verification failed.");
                return;
            }

            // Register validated nonce to fully block replay attacks
            _validatedNonces[nonce] = now;

            await next();
        }
    }
}
