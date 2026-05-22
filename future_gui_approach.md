# Future GUI & Portability Approach

This document outlines the architectural blueprint for transitioning the Antigravity Mobile Companion Daemon into a full desktop application with a premium GUI.

---

## 1. Core Technology Stack
- **Desktop Wrapper**: **Photino.NET** (hybrid C# + web framework). High-performance, native OS browser window (WebView2 on Windows) using the same .NET 8 background process as the daemon.
- **Frontend Framework**: React + Vite (HTML5, Vanilla CSS dark/light theme, custom glassmorphic styling).
- **Interprocess Communication**: Direct C# method bindings or internal SignalR WebSocket loop.

---

## 2. Dynamic Configurations & Portability
- **Config Storage**: Centralized JSON configuration file located under `%APPDATA%/AntigravityCompanion/config.json`.
- **Path Picker**: Native directory selector integrated into the settings panel of the GUI.
- **Hot Path Syncing**: Dynamic re-initialization of the `FileSystemWatcher` when the target workspace path is modified without requiring an application restart.

---

## 3. Real-Time Status & Diagnostics
- **Live Device Status**: Querying active SignalR connection states inside `OnConnectedAsync` / `OnDisconnectedAsync` to render glowing online indicators.
- **Dynamic Toggle**: Sleek visual switch to start/stop the local Kestrel web API server dynamically.
- **Log Streamer**: Live console card dashboard showing processed prompts and daemon status.

---

## 4. Frictionless Iteration Strategy
- **Split-Mode Webview (`#if DEBUG`)**:
  - In **Debug** mode, the webview loads assets directly from `http://localhost:5173` (Vite dev server) allowing hot-reloads in < 100ms.
  - In **Release** mode, it compiles assets as embedded resources inside the self-contained folder.
- **XCOPY Portability**: Publish self-contained executable packages (`-r win-x64 --self-contained`) so the app runs instantly out of a folder on any Windows machine with zero setup.
