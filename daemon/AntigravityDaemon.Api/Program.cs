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

app.Run();

