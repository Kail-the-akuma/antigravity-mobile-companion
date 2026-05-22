using System.Collections.Generic;
using System.Threading.Tasks;

namespace AntigravityDaemon.Core.Services
{
    public interface IWorkspaceService
    {
        string GetWorkspacePath();
        Task<string> ReadFileAsync(string relativePath);
        Task<List<string>> ListFilesAsync();
        Task<string> ExecuteCommandAsync(string command);
    }
}
