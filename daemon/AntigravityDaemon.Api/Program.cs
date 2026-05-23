using Microsoft.EntityFrameworkCore;
using AntigravityDaemon.Data;
using AntigravityDaemon.Api.Hubs;
using AntigravityDaemon.Core.Services;
using AntigravityDaemon.Api.Services;
using Photino.NET;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://0.0.0.0:5117");

// Add services to the container.
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        // Prevent circular reference crashes from EF Core navigation properties
        options.JsonSerializerOptions.ReferenceHandler =
            System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles;
    });

// Configure SQLite DbContext pointing to a local database file
builder.Services.AddDbContext<DaemonDbContext>(options =>
    options.UseSqlite("Data Source=antigravity_companion.db", b => b.MigrationsAssembly("AntigravityDaemon.Api")));

// Add SignalR for real-time WebSockets communication
builder.Services.AddSignalR();

// Add Workspace and LLM services
builder.Services.AddHttpClient();
builder.Services.AddSingleton<IWorkspaceService, WorkspaceService>();
builder.Services.AddTransient<ILlmService, LlmService>();
builder.Services.AddSingleton<IAgentCliBridge, AgentCliBridge>();
builder.Services.AddScoped<ITranscriptSyncService, TranscriptSyncService>();
builder.Services.AddHostedService<TranscriptWatcherService>();


// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// Register shutdown hook to clean up localtunnel background processes
app.Lifetime.ApplicationStopping.Register(() =>
{
    AntigravityDaemon.Api.TunnelManager.StopTunnel();
});

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// app.UseHttpsRedirection(); // Removed to allow clean local HTTP connections over LAN without redirection warnings or socket blocks

app.UseDefaultFiles();
app.UseStaticFiles();

app.UseRouting();

app.UseAuthorization();

// Map REST controllers and WebSockets Hub
app.MapControllers();
app.MapHub<CompanionHub>("/hubs/companion");

// Auto-ensure SQLite database is created at startup
// If key tables are missing (schema outdated), wipe and recreate
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<DaemonDbContext>();

    // Check if the Agents table exists and if RemoteConversationId column exists in Conversations table
    var conn = db.Database.GetDbConnection();
    conn.Open();
    bool schemaUpToDate = false;
    try
    {
        bool agentsTableExists;
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='Agents'";
            agentsTableExists = Convert.ToInt64(cmd.ExecuteScalar()) > 0;
        }

        bool remoteIdColumnExists = false;
        bool isPinnedColumnExists = false;
        bool isDeletedColumnExists = false;
        bool pushTokenColumnExists = false;
        bool conversationIdColumnExists = false;
        if (agentsTableExists)
        {
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Conversations') WHERE name='RemoteConversationId'";
                remoteIdColumnExists = Convert.ToInt64(cmd.ExecuteScalar()) > 0;
            }

            if (remoteIdColumnExists)
            {
                using (var cmd = conn.CreateCommand())
                {
                    cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Conversations') WHERE name='IsPinned'";
                    isPinnedColumnExists = Convert.ToInt64(cmd.ExecuteScalar()) > 0;
                }
                using (var cmd = conn.CreateCommand())
                {
                    cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Conversations') WHERE name='IsDeleted'";
                    isDeletedColumnExists = Convert.ToInt64(cmd.ExecuteScalar()) > 0;
                }
            }

            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('TrustedDevices') WHERE name='PushToken'";
                pushTokenColumnExists = Convert.ToInt64(cmd.ExecuteScalar()) > 0;
            }

            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Approvals') WHERE name='ConversationId'";
                conversationIdColumnExists = Convert.ToInt64(cmd.ExecuteScalar()) > 0;
            }
        }

        schemaUpToDate = agentsTableExists && remoteIdColumnExists && isPinnedColumnExists && isDeletedColumnExists && pushTokenColumnExists && conversationIdColumnExists;
    }
    catch
    {
        schemaUpToDate = false;
    }
    finally
    {
        conn.Close();
    }

    if (!schemaUpToDate)
    {
        Console.ForegroundColor = ConsoleColor.Yellow;
        Console.WriteLine("⚠️  Schema desatualizado detetado. A recriar base de dados...");
        Console.ResetColor();
        db.Database.EnsureDeleted();
    }

    db.Database.EnsureCreated();

    // Dynamically mark the seed Antigravity agent as online to prevent companion app offline status
    var antigravityId = new Guid("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    var agent = db.Agents.Find(antigravityId);
    if (agent != null)
    {
        agent.IsOnline = true;
        agent.LastPing = DateTime.UtcNow;
        db.SaveChanges();
    }
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

// Start the ASP.NET Core web server synchronously (blocks until listening starts)
try
{
    Console.ForegroundColor = ConsoleColor.Cyan;
    Console.WriteLine("🌐 Starting web server on http://0.0.0.0:5117...");
    Console.ResetColor();
    app.Start();

    // Start public internet tunnel via localtunnel for out-of-network companion access
    AntigravityDaemon.Api.TunnelManager.StartTunnel(5117);

    // Automatically open the default system web browser to the dashboard as a 100% reliable failsafe
    try
    {
        Console.ForegroundColor = ConsoleColor.Yellow;
        Console.WriteLine("🌐 Opening dashboard in default system browser: http://127.0.0.1:5117/index.html");
        Console.ResetColor();
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
        {
            FileName = "http://127.0.0.1:5117/index.html",
            UseShellExecute = true
        });
    }
    catch (Exception browserEx)
    {
        // Fallback for environments where UseShellExecute has strict privilege controls
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = "cmd",
                Arguments = "/c start http://127.0.0.1:5117/index.html",
                CreateNoWindow = true,
                UseShellExecute = false
            });
        }
        catch
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine($"⚠️ Could not open default browser: {browserEx.Message}");
            Console.ResetColor();
        }
    }
}
catch (Exception ex)
{
    Console.ForegroundColor = ConsoleColor.Red;
    Console.WriteLine($"❌ CRITICAL: Failed to start web server on port 5117: {ex.Message}");
    Console.WriteLine("This is usually because another instance of Antigravity or another app is already using port 5117.");
    Console.WriteLine("Please close any conflicting apps and try again.");
    Console.ResetColor();
    return;
}

// Initialize Photino.NET Window
try
{
    Console.ForegroundColor = ConsoleColor.Magenta;
    Console.WriteLine("🖥️  LAUNCHING NATIVE DESKTOP DASHBOARD...");
    Console.ResetColor();

    var window = new PhotinoWindow()
        .SetTitle("Antigravity Companion - Desktop Control Center")
        .SetUseOsDefaultSize(false)
        .SetSize(1200, 800)
        .Center()
        .Load("http://127.0.0.1:5117/index.html");

    // Start native GUI message loop (blocks until window is closed)
    window.WaitForClose();

    Console.ForegroundColor = ConsoleColor.Yellow;
    Console.WriteLine("🔌 Native GUI window closed. Shutting down daemon backend...");
    Console.ResetColor();

    // Cleanly stop the web server
    app.StopAsync().GetAwaiter().GetResult();
}
catch (Exception ex)
{
    Console.ForegroundColor = ConsoleColor.Red;
    Console.WriteLine($"⚠️  Failed to launch native GUI window: {ex.Message}");
    Console.WriteLine("Continuing to run daemon in headless console mode.");
    Console.ResetColor();
    
    // In case Photino fails (e.g. headless environment or missing WebView2), keep the console app running by waiting on the host
    app.WaitForShutdown();
}


