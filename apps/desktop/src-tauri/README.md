# Tauri Rust Backend

**Directory**: `apps/desktop/src-tauri/`

## Overview

This directory contains the Rust backend for the PharmStation desktop application built with Tauri.

## What Goes Here

### Rust Source Code (`src/`)
- **main.rs**: Application entry point, window setup, command registration
- **commands.rs**: Tauri commands exposed to frontend (API layer)
- **db.rs**: SQLite database operations (local storage)
- **sync.rs**: Bidirectional sync with Supabase backend
- **scanner.rs**: USB barcode scanner integration
- **models.rs**: Rust data structures matching TypeScript types
- **utils.rs**: Helper functions

### Configuration
- **Cargo.toml**: Rust dependencies and project metadata
- **tauri.conf.json**: Tauri application configuration
  - App identifiers
  - Window settings
  - Permissions
  - Build settings
  - Auto-updater configuration

### Icons (`icons/`)
- Platform-specific app icons
- Generated from master icon using Tauri CLI

### Build Artifacts
- **target/**: Compiled Rust code and final binaries (gitignored)

## Rust Dependencies

Expected dependencies in `Cargo.toml`:

```toml
[dependencies]
tauri = { version = "2", features = [".."] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
rusqlite = { version = "0.31", features = ["bundled"] }
reqwest = { version = "0.11", features = ["json"] }
```

## Key Tauri Features to Use

### Commands
Expose Rust functions to the frontend:
```rust
#[tauri::command]
async fn example_command(param: String) -> Result<String, String> {
    Ok(format!("Received: {}", param))
}
```

### State Management
Share state across commands:
```rust
struct AppState {
    db: Mutex<Connection>,
}

#[tauri::command]
async fn use_state(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    // Use db
    Ok(())
}
```

### Events
Emit events from Rust to frontend:
```rust
app.emit_all("sync-status", SyncStatus { progress: 50 })?;
```

### File System
Use Tauri's file system API for secure file access

### System Tray
Create system tray icon with menu

## SQLite Database

### Schema
- Mirror Supabase schema for compatibility
- Local-first: all data stored locally
- Sync flags: track synced vs. unsynced records

### Tables (Example)
```sql
CREATE TABLE cd_entries (
    id TEXT PRIMARY KEY,
    pharmacy_id TEXT NOT NULL,
    drug_name TEXT NOT NULL,
    strength TEXT NOT NULL,
    quantity REAL NOT NULL,
    balance REAL NOT NULL,
    entry_date TEXT NOT NULL,
    entry_type TEXT NOT NULL, -- 'receipt' or 'supply'
    patient_name TEXT,
    prescriber_name TEXT,
    synced INTEGER DEFAULT 0, -- 0 = not synced, 1 = synced
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

## Sync Strategy

1. **On Startup**: Fetch latest from Supabase if online
2. **During Use**: Write to local SQLite immediately
3. **Background Sync**: Periodically sync unsynced records
4. **Conflict Resolution**: Last-write-wins or custom logic

## Barcode Scanner Integration

- Detect USB HID barcode scanners
- Read barcode data
- Expose via Tauri command
- Support common scanner protocols

## Build Process

### Development
```bash
cargo tauri dev
```

### Production
```bash
cargo tauri build
```

### Platform-Specific Builds
- Windows: MSI installer, portable EXE
- macOS: DMG disk image, APP bundle
- Linux: DEB package, AppImage

## Security

- Tauri's security model (minimal permissions)
- Content Security Policy (CSP)
- Secure IPC between frontend and backend
- No eval() or remote code execution
- Sandboxed webview

## Testing

```bash
# Run Rust tests
cargo test

# Run with specific features
cargo test --features "test-mode"
```

## Development Guidelines

### Error Handling
- Use `Result<T, String>` for Tauri commands
- Provide helpful error messages
- Log errors to console (dev) or file (prod)

### Async Operations
- Use `tokio` for async runtime
- Mark Tauri commands as `async` when needed
- Use `tokio::spawn` for background tasks

### Performance
- Keep commands fast (<100ms)
- Use database indexes
- Batch operations where possible

## Links

- [Tauri Documentation](https://tauri.app/)
- [Tauri Desktop Architecture](../../../documentation/technical/tauri-desktop-architecture.md)
- [Desktop App README](../README.md)
