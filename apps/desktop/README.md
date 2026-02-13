# PharmStation Desktop App

**Framework**: Tauri  
**Package Name**: `@pharmstation/desktop`

## Overview

The desktop application for PharmStation built with Tauri. This provides an offline-first, high-performance native desktop experience for pharmacy compliance management.

## What Goes Here

### All Web Features (Feature Parity)
- Everything from the web app
- Optimized for desktop use
- Offline-first architecture
- Native OS integration

### Desktop-Specific Features
- **Offline Mode**: Works completely without internet
- **Local Database**: SQLite for local storage
- **Background Sync**: Automatic syncing when online
- **Print Optimization**: Better print layouts for registers
- **Barcode Scanner**: USB barcode scanner integration
- **Auto-Updates**: Tauri updater for seamless updates
- **System Tray**: Quick access from system tray
- **Keyboard Shortcuts**: Advanced keyboard navigation

## Tech Stack

- **Framework**: Tauri 2.x
- **Frontend**: Same as web app (Next.js or SPA build)
- **Backend**: Rust
- **Local Database**: SQLite (via Tauri SQL plugin)
- **IPC**: Tauri commands for Rust <-> JS communication

## Project Structure

```
apps/desktop/
├── src-tauri/               # Rust backend
│   ├── src/
│   │   ├── main.rs         # Main entry point
│   │   ├── commands.rs     # Tauri commands (API for frontend)
│   │   ├── db.rs           # SQLite database operations
│   │   ├── sync.rs         # Sync with Supabase
│   │   └── scanner.rs      # Barcode scanner integration
│   ├── icons/              # App icons
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri configuration
├── src/                    # Frontend (shares with web)
│   └── (same structure as web app or symlink)
├── package.json            # Node dependencies
└── README.md              # This file
```

## Platform Support

- **Windows**: Windows 10+
- **macOS**: macOS 11+
- **Linux**: Ubuntu 20.04+, Fedora 36+, Debian 11+ (optional)

## Setup Instructions

**Note**: This is a scaffold. Actual setup will be documented once development begins.

### Prerequisites
- Node.js 20+
- pnpm 9+
- Rust 1.70+
- Platform-specific build tools:
  - Windows: Microsoft C++ Build Tools
  - macOS: Xcode Command Line Tools
  - Linux: `build-essential`, `libwebkit2gtk-4.0-dev`, etc.

### Installation (Coming Soon)
```bash
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# From monorepo root
pnpm install

# Run in development mode
pnpm --filter @pharmstation/desktop tauri dev

# Build for production
pnpm --filter @pharmstation/desktop tauri build
```

## Tauri Configuration

See `src-tauri/tauri.conf.json` for configuration:
- App identifiers
- Window settings (size, title, icons)
- Permissions and capabilities
- Auto-updater configuration
- Build settings per platform

## Rust Backend (src-tauri)

### Tauri Commands
Expose Rust functions to frontend via Tauri commands:

```rust
// commands.rs
#[tauri::command]
async fn get_cd_entries(pharmacy_id: String) -> Result<Vec<CDEntry>, String> {
    // Query local SQLite database
}

#[tauri::command]
async fn sync_to_cloud() -> Result<(), String> {
    // Sync local database to Supabase
}

#[tauri::command]
async fn read_barcode() -> Result<String, String> {
    // Read from USB barcode scanner
}
```

### Local Database (SQLite)
- Same schema as Supabase (for compatibility)
- Stores all data locally for offline use
- Syncs changes bidirectionally with Supabase

### Sync Strategy
- See [Offline Sync Strategy](../../documentation/technical/offline-sync-strategy.md)
- Background sync when online
- Conflict resolution (last-write-wins or custom)
- Queue unsent changes

## Frontend Integration

### Using Tauri Commands
```typescript
import { invoke } from '@tauri-apps/api/tauri';

// Call Rust backend
const entries = await invoke<CDEntry[]>('get_cd_entries', { 
  pharmacyId: 'abc123' 
});

// Trigger sync
await invoke('sync_to_cloud');
```

### File System Access
```typescript
import { open } from '@tauri-apps/api/dialog';
import { readTextFile } from '@tauri-apps/api/fs';

// Open file dialog
const selected = await open({ multiple: false });

// Read file
const content = await readTextFile(selected);
```

## Features to Implement

### Phase 1
- [ ] Basic Tauri setup
- [ ] SQLite database integration
- [ ] Frontend integration (web app or SPA)
- [ ] Offline functionality

### Phase 3: Full Desktop App
- [ ] All web features working offline
- [ ] Background sync
- [ ] Print optimization
- [ ] Barcode scanner integration
- [ ] System tray icon
- [ ] Auto-updates
- [ ] Multi-window support
- [ ] Keyboard shortcuts
- [ ] Native notifications

## Build & Distribution

### Development Build
```bash
pnpm --filter @pharmstation/desktop tauri dev
```

### Production Build
```bash
pnpm --filter @pharmstation/desktop tauri build
```

### Installers Generated
- **Windows**: `.msi` installer, `.exe` portable
- **macOS**: `.dmg` disk image, `.app` bundle
- **Linux**: `.deb`, `.AppImage`

### Code Signing (Production)
- Windows: Code signing certificate
- macOS: Apple Developer ID
- Linux: Optional GPG signing

### Auto-Updates
- Tauri updater plugin
- Check for updates on startup
- Download and install in background
- Notify user when ready

## Security Considerations

- Local database encryption (optional)
- Secure storage for credentials (Tauri secure storage)
- Certificate pinning for API calls
- Sandboxed environment (Tauri security model)

## Performance Targets

- App startup: <2 seconds
- UI responsiveness: 60 FPS
- Database queries: <50ms
- Memory usage: <200MB
- Disk space: <150MB

## Testing (Future)

- Rust unit tests: `cargo test`
- Integration tests: Tauri test harness
- E2E tests: Same as web (Playwright)

## Links

- [Product Vision](../../documentation/product/PRODUCT_VISION.md)
- [Tauri Desktop Architecture](../../documentation/technical/tauri-desktop-architecture.md)
- [Offline Sync Strategy](../../documentation/technical/offline-sync-strategy.md)
- [Web App README](../web/README.md)
