using Microsoft.EntityFrameworkCore;
using AntigravityDaemon.Data;
using AntigravityDaemon.Api.Hubs;
using AntigravityDaemon.Core.Services;
using AntigravityDaemon.Api.Services;
using AntigravityDaemon.Api.Core.Monitoring.Services;
using System.Diagnostics;
using System.Linq;

// Clean up duplicate instances and their localtunnel child processes on startup
CleanupDuplicateProcesses();

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://0.0.0.0:5117");

static int? GetPidFromRunningInstance()
{
    try
    {
        using var client = new System.Net.Http.HttpClient();
        client.Timeout = TimeSpan.FromMilliseconds(500); // Resposta rápida ou desiste
        var response = client.GetAsync("http://127.0.0.1:5117/api/pairing/pid").GetAwaiter().GetResult();
        if (response.IsSuccessStatusCode)
        {
            var content = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            // Parsing simples de JSON sem bibliotecas externas
            var match = System.Text.RegularExpressions.Regex.Match(content, @"""pid""\s*:\s*(\d+)");
            if (match.Success && int.TryParse(match.Groups[1].Value, out int pid))
            {
                return pid;
            }
        }
    }
    catch
    {
        // Sem instância ativa ou timeout
    }
    return null;
}

static void CleanupDuplicateProcesses()
{
    try
    {
        var current = Process.GetCurrentProcess();
        int currentId = current.Id;

        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine("🔍 [Startup] A procurar processos fantasma ou instâncias duplicadas do Daemon...");
        Console.ResetColor();

        int? targetPid = null;

        // Método A: Consultar o endpoint HTTP da instância ativa na porta 5117
        int? activePid = GetPidFromRunningInstance();
        if (activePid.HasValue && activePid.Value != currentId)
        {
            targetPid = activePid.Value;
            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine($"✅ [Startup] Detetada instância ativa via HTTP (PID: {targetPid})");
            Console.ResetColor();
        }

        // Método B: Fallback para leitura do ficheiro PID se a porta estiver ocupada mas sem resposta HTTP
        string pidFilePath = System.IO.Path.Combine(System.IO.Directory.GetCurrentDirectory(), "antigravity_companion.pid");
        if (!targetPid.HasValue && System.IO.File.Exists(pidFilePath))
        {
            try
            {
                string content = System.IO.File.ReadAllText(pidFilePath).Trim();
                if (int.TryParse(content, out int filePid) && filePid != currentId)
                {
                    targetPid = filePid;
                    Console.ForegroundColor = ConsoleColor.Cyan;
                    Console.WriteLine($"🔍 [Startup] Lido PID {targetPid} do ficheiro 'antigravity_companion.pid'");
                    Console.ResetColor();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Startup] Não foi possível ler o ficheiro PID: {ex.Message}");
            }
        }

        // Se identificámos um PID duplicado, terminamos de forma segura e cirúrgica
        if (targetPid.HasValue)
        {
            try
            {
                var p = Process.GetProcessById(targetPid.Value);
                
                // VERIFICAÇÃO DE SEGURANÇA ESTATUTÁRIA: Garantir que apenas matamos processos do Antigravity
                // para NUNCA terminar processos de terceiros que possam ter reutilizado o mesmo PID!
                string name = p.ProcessName.ToLower();
                bool isOurProcess = name.Contains("dotnet") || 
                                    name.Contains("antigravitydaemon") || 
                                    name.Contains("antigravity");

                if (isOurProcess)
                {
                    Console.ForegroundColor = ConsoleColor.Yellow;
                    Console.WriteLine($"⚠️  [Startup] A terminar instância fantasma/duplicada ({p.ProcessName}, PID: {p.Id}) de forma segura...");
                    Console.ResetColor();

                    // Termina o processo e a sua árvore de processos (incluindo localtunnel node.exe) de forma nativa e sem privilégios elevados
                    p.Kill(entireProcessTree: true);
                    p.Dispose();

                    // Pausa curta para o SO libertar sockets e ficheiros
                    System.Threading.Thread.Sleep(600);
                }
                else
                {
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine($"❌ [Startup] Segurança: O processo PID {targetPid} ({p.ProcessName}) não pertence ao Antigravity. Ignorado.");
                    Console.ResetColor();
                }
            }
            catch (ArgumentException)
            {
                // O processo já não está em execução
                Console.WriteLine($"[Startup] Processo fantasma PID {targetPid} já não se encontra ativo.");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Startup] Não foi possível terminar o processo PID {targetPid}: {ex.Message}");
            }
        }

        // Escrever o nosso PID atual para o ficheiro para futuras inicializações
        try
        {
            System.IO.File.WriteAllText(pidFilePath, currentId.ToString());
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Startup] Erro ao registar PID em ficheiro: {ex.Message}");
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Startup] Erro durante a limpeza de processos: {ex.Message}");
    }
}

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

// Enable CORS for local cross-origin connections (e.g., from Expo Web at port 8081)
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy.SetIsOriginAllowed(origin => true) // Dynamic origin matching to support credentials over HTTP/HTTPS
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials(); // Required for SignalR WebSocket handshake negotiation
    });
});

// Add Workspace and LLM services
builder.Services.AddHttpClient();
builder.Services.AddSingleton<IWorkspaceService, WorkspaceService>();
builder.Services.AddTransient<ILlmService, LlmService>();
builder.Services.AddSingleton<IAgentCliBridge, AgentCliBridge>();
builder.Services.AddScoped<ITranscriptSyncService, TranscriptSyncService>();
builder.Services.AddHostedService<TranscriptWatcherService>();
builder.Services.AddScoped<IQuotaMonitoringService, QuotaMonitoringService>();


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

app.UseCors("AllowAll");

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
        bool companionEventsTableExists = false;
        bool nonceColumnExists = false;
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

            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='CompanionEvents'";
                companionEventsTableExists = Convert.ToInt64(cmd.ExecuteScalar()) > 0;
            }

            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Approvals') WHERE name='Nonce'";
                nonceColumnExists = Convert.ToInt64(cmd.ExecuteScalar()) > 0;
            }
        }

        schemaUpToDate = agentsTableExists && remoteIdColumnExists && isPinnedColumnExists && isDeletedColumnExists && pushTokenColumnExists && conversationIdColumnExists && companionEventsTableExists && nonceColumnExists;
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
    AntigravityDaemon.Api.TunnelManager.StartTunnel(5117, app.Services);

    // Automatically launch the dashboard in native standalone App Mode using Chrome or Edge
    try
    {
        Console.ForegroundColor = ConsoleColor.Magenta;
        Console.WriteLine("🖥️  LAUNCHING DASHBOARD IN STANDALONE APP MODE...");
        Console.ResetColor();

        // Try launching Google Chrome in dedicated App Mode (borderless, standalone window)
        var psi = new System.Diagnostics.ProcessStartInfo
        {
            FileName = "cmd",
            Arguments = "/c start chrome --app=http://127.0.0.1:5117/index.html",
            CreateNoWindow = true,
            UseShellExecute = false
        };
        System.Diagnostics.Process.Start(psi);
    }
    catch
    {
        try
        {
            // Fallback: Try launching Microsoft Edge in dedicated App Mode
            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "cmd",
                Arguments = "/c start msedge --app=http://127.0.0.1:5117/index.html",
                CreateNoWindow = true,
                UseShellExecute = false
            };
            System.Diagnostics.Process.Start(psi);
        }
        catch (Exception browserEx)
        {
            // Last resort fallback: Standard default system browser tab
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "http://127.0.0.1:5117/index.html",
                    UseShellExecute = true
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

// Keep the daemon running in headless console mode, hosting the API and listening for shutdown
Console.ForegroundColor = ConsoleColor.Green;
Console.WriteLine("🚀 Antigravity Companion Daemon is active and hosting.");
Console.WriteLine("Press Ctrl+C inside this terminal window to shut down the server cleanly.");
Console.ResetColor();
app.WaitForShutdown();


