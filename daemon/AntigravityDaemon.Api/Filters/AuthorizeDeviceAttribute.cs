using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Http;
using System;
using System.IO;
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

            // 3. Find device and secret key in DB
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

            // 4. Read body payload
            string payload = string.Empty;
            request.EnableBuffering();
            request.Body.Position = 0;
            using (var reader = new StreamReader(request.Body, Encoding.UTF8, leaveOpen: true))
            {
                payload = await reader.ReadToEndAsync();
                request.Body.Position = 0; // Reset position so the next component/controller can read it
            }

            // 5. Verify signature: payload + "|" + timestamp + "|" + nonce + "|" + secretKey
            string message = $"{payload}|{timestamp}|{nonce}|{device.SecretKey}";
            
            using (var sha256 = SHA256.Create())
            {
                var hashBytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(message));
                var localSignature = BitConverter.ToString(hashBytes).Replace("-", "").ToLower();

                // Console debugging for transparent diagnostics
                Console.WriteLine("\n[Cryptographic Signature Debug]");
                Console.WriteLine($"  - Method:        {request.Method}");
                Console.WriteLine($"  - Path:          {request.Path}");
                Console.WriteLine($"  - Payload:       '{payload}'");
                Console.WriteLine($"  - Client Sig:    {clientSignature}");
                Console.WriteLine($"  - Computed Sig:  {localSignature}");
                Console.WriteLine(string.Equals(localSignature, clientSignature, StringComparison.OrdinalIgnoreCase) 
                    ? "  - Result:        ✅ MATCH" 
                    : "  - Result:        ❌ MISMATCH");

                if (!string.Equals(localSignature, clientSignature, StringComparison.OrdinalIgnoreCase))
                {
                    context.Result = new UnauthorizedObjectResult("Cryptographic signature mismatch. Verification failed.");
                    return;
                }
            }

            await next();
        }
    }
}
