using Microsoft.EntityFrameworkCore;
using AntigravityDaemon.Data;
using AntigravityDaemon.Api.Hubs;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();

// Configure SQLite DbContext pointing to a local database file
builder.Services.AddDbContext<DaemonDbContext>(options =>
    options.UseSqlite("Data Source=antigravity_companion.db", b => b.MigrationsAssembly("AntigravityDaemon.Api")));

// Add SignalR for real-time WebSockets communication
builder.Services.AddSignalR();

// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.UseRouting();

app.UseAuthorization();

// Map REST controllers and WebSockets Hub
app.MapControllers();
app.MapHub<CompanionHub>("/hubs/companion");

// Auto-ensure SQLite database is created at startup
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<DaemonDbContext>();
    db.Database.EnsureCreated();
}

// Auto-initialize pairing token on startup and print it
var (token, ip, port, expiresAt) = AntigravityDaemon.Api.Controllers.PairingController.GenerateToken(5117);

Console.ForegroundColor = ConsoleColor.Cyan;
Console.WriteLine("========================================================================");
Console.ForegroundColor = ConsoleColor.Green;
Console.WriteLine("🚀 ANTIGRAVITY COMPANION DAEMON ACTIVE & READY");
Console.ForegroundColor = ConsoleColor.Cyan;
Console.WriteLine("========================================================================");
Console.ForegroundColor = ConsoleColor.White;
Console.WriteLine($"📡 HOST LAN IP:    {ip}");
Console.WriteLine($"🔌 PORT:           {port}");
Console.ForegroundColor = ConsoleColor.Yellow;
Console.WriteLine($"🔑 PAIRING PIN:    {token}");
Console.ForegroundColor = ConsoleColor.Gray;
Console.WriteLine($"⏳ EXPIRES AT:     {expiresAt.ToLocalTime()} (Local Time)");
Console.ForegroundColor = ConsoleColor.Cyan;
Console.WriteLine("========================================================================");
Console.ForegroundColor = ConsoleColor.White;
Console.WriteLine("👉 Open the mobile app and enter the credentials above to pair!");
Console.ForegroundColor = ConsoleColor.Cyan;
Console.WriteLine("========================================================================");
Console.ResetColor();

app.Run();

