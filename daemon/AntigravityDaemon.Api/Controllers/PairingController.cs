using Microsoft.AspNetCore.Mvc;
using AntigravityDaemon.Data;
using AntigravityDaemon.Core.Models;
using Microsoft.EntityFrameworkCore;
using System;
using System.Threading.Tasks;

namespace AntigravityDaemon.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class PairingController : ControllerBase
    {
        private readonly DaemonDbContext _context;
        private static string _activePairingToken = string.Empty;
        private static DateTime _tokenExpiry = DateTime.MinValue;

        public PairingController(DaemonDbContext context)
        {
            _context = context;
        }

        // Endpoint to initialize pairing (returns local info to build a QR Code)
        [HttpPost("init")]
        public IActionResult InitPairing()
        {
            // Generate a simple secure 6-digit pin/token
            var random = new Random();
            _activePairingToken = random.Next(100000, 999999).ToString();
            _tokenExpiry = DateTime.UtcNow.AddMinutes(5); // Valid for 5 minutes

            // Retrieve local network IP
            string localIp = "127.0.0.1";
            try
            {
                using (System.Net.Sockets.Socket socket = new System.Net.Sockets.Socket(System.Net.Sockets.AddressFamily.InterNetwork, System.Net.Sockets.SocketType.Dgram, 0))
                {
                    socket.Connect("8.8.8.8", 65530);
                    var endPoint = socket.LocalEndPoint as System.Net.IPEndPoint;
                    localIp = endPoint?.Address.ToString() ?? "127.0.0.1";
                }
            }
            catch
            {
                // Fallback to localhost if no network connection
            }

            return Ok(new
            {
                token = _activePairingToken,
                ip = localIp,
                port = 5200, // standard configured port
                expiresAt = _tokenExpiry
            });
        }

        public record ConfirmPairingRequest(string Token, string DeviceName, string PublicKeyPem);

        // Endpoint for the Mobile App to confirm pairing and register its public key
        [HttpPost("confirm")]
        public async Task<IActionResult> ConfirmPairing([FromBody] ConfirmPairingRequest request)
        {
            if (string.IsNullOrEmpty(_activePairingToken) || DateTime.UtcNow > _tokenExpiry)
            {
                return BadRequest("pairing token expired or not initialized.");
            }

            if (request.Token != _activePairingToken)
            {
                return Unauthorized("invalid pairing token.");
            }

            // Register trusted device
            var device = new TrustedDevice
            {
                DeviceName = request.DeviceName,
                PublicKeyPem = request.PublicKeyPem
            };

            _context.TrustedDevices.Add(device);
            await _context.SaveChangesAsync();

            // Reset token once paired successfully
            _activePairingToken = string.Empty;

            return Ok(new
            {
                message = "Device paired successfully!",
                deviceId = device.Id
            });
        }
    }
}
