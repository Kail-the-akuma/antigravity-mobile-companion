using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using AntigravityDaemon.Core.Services;
using Microsoft.Extensions.Configuration;

namespace AntigravityDaemon.Api.Services
{
    public class WorkspaceService : IWorkspaceService
    {
        private readonly string _workspacePath;
        private static readonly string[] ExcludedDirs = { "node_modules", ".git", ".expo", "bin", "obj", "dist", "build", "out" };

        public WorkspaceService(IConfiguration configuration)
        {
            _workspacePath = configuration["WorkspaceSettings:Path"] ?? @"c:\Users\Hugo\Documents\GitHub\HomeSync";
            if (!Directory.Exists(_workspacePath))
            {
                // Ensure directory exists or create it
                Directory.CreateDirectory(_workspacePath);
            }
        }

        public string GetWorkspacePath() => _workspacePath;

        public async Task<string> ReadFileAsync(string relativePath)
        {
            try
            {
                string safePath = GetSafePath(relativePath);
                if (!File.Exists(safePath))
                {
                    return $"Error: File '{relativePath}' not found in workspace.";
                }

                return await File.ReadAllTextAsync(safePath, Encoding.UTF8);
            }
            catch (Exception ex)
            {
                return $"Error reading file: {ex.Message}";
            }
        }

        public Task<List<string>> ListFilesAsync()
        {
            try
            {
                var files = GetFilesRecursive(_workspacePath)
                    .Select(p => Path.GetRelativePath(_workspacePath, p))
                    .ToList();
                return Task.FromResult(files);
            }
            catch (Exception ex)
            {
                return Task.FromResult(new List<string> { $"Error listing files: {ex.Message}" });
            }
        }

        public async Task<string> ExecuteCommandAsync(string command)
        {
            try
            {
                // Use powershell.exe on Windows for maximum flexibility
                var processInfo = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-NoProfile -Command \"{command.Replace("\"", "\\\"")}\"",
                    WorkingDirectory = _workspacePath,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8
                };

                using var process = new Process { StartInfo = processInfo };
                process.Start();

                string output = await process.StandardOutput.ReadToEndAsync();
                string error = await process.StandardError.ReadToEndAsync();

                await process.WaitForExitAsync();

                var sb = new StringBuilder();
                if (!string.IsNullOrWhiteSpace(output))
                {
                    sb.AppendLine(output.Trim());
                }
                if (!string.IsNullOrWhiteSpace(error))
                {
                    sb.AppendLine("Error output:");
                    sb.AppendLine(error.Trim());
                }

                if (sb.Length == 0)
                {
                    return "Command executed successfully with no output.";
                }

                return sb.ToString().Trim();
            }
            catch (Exception ex)
            {
                return $"Exception executing command: {ex.Message}";
            }
        }

        private string GetSafePath(string relativePath)
        {
            // Normalize slashes
            string normalized = relativePath.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
            
            // Clean path
            string fullPath = Path.GetFullPath(Path.Combine(_workspacePath, normalized));

            // Prevent path traversal
            if (!fullPath.StartsWith(_workspacePath, StringComparison.OrdinalIgnoreCase))
            {
                throw new UnauthorizedAccessException("Path traversal detected! Cannot access files outside the workspace.");
            }

            return fullPath;
        }

        private IEnumerable<string> GetFilesRecursive(string dir)
        {
            var files = new List<string>();
            try
            {
                foreach (string f in Directory.GetFiles(dir))
                {
                    files.Add(f);
                }

                foreach (string d in Directory.GetDirectories(dir))
                {
                    string dirName = Path.GetFileName(d);
                    if (!ExcludedDirs.Contains(dirName, StringComparer.OrdinalIgnoreCase))
                    {
                        files.AddRange(GetFilesRecursive(d));
                    }
                }
            }
            catch
            {
                // Ignore directories we can't access
            }
            return files;
        }
    }
}
