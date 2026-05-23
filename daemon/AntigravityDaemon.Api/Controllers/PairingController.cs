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

        public static (string Token, string Ip, int Port, DateTime ExpiresAt) GenerateToken(int port = 5117)
        {
            var random = new Random();
            _activePairingToken = random.Next(100000, 999999).ToString();
            // Valid for 60 minutes for local pairing and development convenience
            _tokenExpiry = DateTime.UtcNow.AddMinutes(60);

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

            return (_activePairingToken, localIp, port, _tokenExpiry);
        }

        // Endpoint to fetch current pairing status and registered devices
        [HttpGet("status")]
        public async Task<IActionResult> GetStatus()
        {
            bool isDeviceOnline = Hubs.CompanionHub.HasActiveConnections;
            var devices = await _context.TrustedDevices.Select(d => new {
                id = d.Id,
                deviceName = d.DeviceName,
                hasPushToken = !string.IsNullOrEmpty(d.PushToken),
                isOnline = isDeviceOnline
            }).ToListAsync();

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
            catch {}

            // If token is expired or not set, initialize it
            if (string.IsNullOrEmpty(_activePairingToken) || DateTime.UtcNow > _tokenExpiry)
            {
                GenerateToken(5117);
            }

            return Ok(new
            {
                token = _activePairingToken,
                ip = localIp,
                port = 5117,
                expiresAt = _tokenExpiry,
                devices = devices,
                tunnelUrl = AntigravityDaemon.Api.TunnelManager.PublicTunnelUrl
            });
        }

        // Endpoint to fetch the current process ID safely for startup verification
        [HttpGet("pid")]
        public IActionResult GetPid()
        {
            return Ok(new { pid = Environment.ProcessId });
        }

        // Endpoint to initialize pairing (returns local info to build a QR Code)
        [HttpPost("init")]
        public IActionResult InitPairing()
        {
            var (token, ip, port, expiresAt) = GenerateToken(5117);
            return Ok(new
            {
                token = token,
                ip = ip,
                port = port,
                expiresAt = expiresAt
            });
        }

        public record ConfirmPairingRequest(string Token, string DeviceName, string DeviceId, string SecretKey);

        // Endpoint for the Mobile App to confirm pairing and register its symmetric secret key
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

            if (!Guid.TryParse(request.DeviceId, out var deviceIdGuid))
            {
                return BadRequest("invalid DeviceId format.");
            }

            // Register trusted device
            var device = new TrustedDevice
            {
                Id = deviceIdGuid,
                DeviceName = request.DeviceName,
                SecretKey = request.SecretKey
            };

            _context.TrustedDevices.Add(device);
            await _context.SaveChangesAsync();

            // Reset token once paired successfully
            _activePairingToken = string.Empty;

            return Ok(new
            {
                message = "Device paired successfully!",
                deviceId = device.Id,
                tunnelUrl = AntigravityDaemon.Api.TunnelManager.PublicTunnelUrl
            });
        }

        public record RegisterPushTokenRequest(string DeviceId, string PushToken);

        // Endpoint to register the push token for a paired device
        [HttpPost("push-token")]
        public async Task<IActionResult> RegisterPushToken([FromBody] RegisterPushTokenRequest request)
        {
            if (!Guid.TryParse(request.DeviceId, out var deviceIdGuid))
            {
                return BadRequest("invalid DeviceId format.");
            }

            var device = await _context.TrustedDevices.FindAsync(deviceIdGuid);
            if (device == null)
            {
                return NotFound("Device not found.");
            }

            device.PushToken = request.PushToken;
            await _context.SaveChangesAsync();

            return Ok(new { message = "Push token registered successfully." });
        }

        // DELETE: api/pairing/devices/{id} — deletes a trusted device by its ID
        [HttpDelete("devices/{id}")]
        public async Task<IActionResult> RemoveDevice(Guid id)
        {
            var device = await _context.TrustedDevices.FindAsync(id);
            if (device == null)
            {
                return NotFound("Dispositivo não encontrado.");
            }

            _context.TrustedDevices.Remove(device);
            await _context.SaveChangesAsync();

            return Ok(new { success = true, message = "Dispositivo desemparelhado com sucesso." });
        }
    }
}
