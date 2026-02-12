# Phase 3: Mobile & Desktop Apps

**Last Updated**: [TODO]  
**Version**: 1.0

## TODO: Add Content

This document should contain detailed specifications for Phase 3 mobile and desktop applications.

### Suggested Sections

#### 1. Phase 3 Overview
- Timeline: Months 13-18
- Goal: Extend to mobile and desktop platforms
- Use cases for each platform

#### 2. Mobile App (React Native)

**Features**:
- Quick RP sign-in/out (one-tap widget)
- Photo-based entry (snap invoice/prescription for later processing)
- Fridge logging (log temperature while at fridge)
- Handover notes (view and create)
- Offline sync
- Push notifications

**Not in Mobile**:
- Full CD register entry (too complex for mobile typing)
- Full reconciliation workflows
- Full SOP management

**Platforms**:
- iOS (iPhone, iPad)
- Android (phone, tablet)

**Technical**:
- React Native
- Shared codebase with web (React components)
- Offline-first (local SQLite)
- Background sync

#### 3. Desktop App (Tauri)

**Features**:
- Full feature parity with web
- Offline-first (works without internet)
- Local database (SQLite)
- Background sync to Supabase
- Better print layouts
- Barcode scanner support (USB)
- Faster performance for large datasets

**Platforms**:
- Windows
- macOS
- Linux (optional)

**Technical**:
- Tauri (Rust + Web)
- Same web frontend as web app
- Native OS integration
- Auto-updates

#### 4. Offline Sync Strategy
- See [Offline Sync Strategy](../technical/offline-sync-strategy.md)

#### 5. Cross-Platform Consistency
- Same UI/UX across platforms
- Shared component library
- Consistent keyboard shortcuts
- Consistent terminology

#### 6. Platform-Specific Optimizations
- Mobile: Touch-optimized, swipe gestures
- Desktop: Keyboard shortcuts, multi-window
- Web: Browser-based, responsive

---

**Related Documents**:
- [Product Vision](./PRODUCT_VISION.md)
- [React Native Mobile Plan](../technical/react-native-mobile-plan.md)
- [Tauri Desktop Architecture](../technical/tauri-desktop-architecture.md)
