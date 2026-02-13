# PharmStation Mobile App

**Framework**: React Native  
**Package Name**: `@pharmstation/mobile`

## Overview

The mobile application for PharmStation built with React Native. This provides quick logging and photo-based entry capabilities for iOS and Android devices.

## What Goes Here

### Mobile-Optimized Features
- **Quick RP Sign-In/Out**: One-tap RP login widget
- **Photo-Based Entry**: Snap photos of invoices/prescriptions for later processing
- **Fridge Logging**: Log temperature while standing at the fridge
- **Handover Notes**: View and create sticky notes on mobile
- **Quick Views**: View register balances, recent entries
- **Push Notifications**: Overdue tasks, urgent handover notes
- **Offline Sync**: All features work offline, sync when online

### NOT Included in Mobile (Too Complex)
- Full CD register entry (use web/desktop for detailed entry)
- Complex reconciliation workflows
- Full SOP library management
- Advanced exports

## Tech Stack

- **Framework**: React Native 0.73+
- **Language**: TypeScript
- **Navigation**: React Navigation
- **State Management**: Zustand or React Context
- **Forms**: React Hook Form + Zod
- **UI Components**: React Native Paper or custom
- **Camera**: react-native-camera or expo-camera
- **Offline Storage**: AsyncStorage + SQLite
- **Business Logic**: `@pharmstation/core`
- **Types**: `@pharmstation/types`

## Project Structure

```
apps/mobile/
├── src/
│   ├── components/        # React Native components
│   │   ├── ui/           # Reusable UI components
│   │   ├── forms/        # Form components
│   │   └── camera/       # Camera components
│   ├── screens/          # App screens
│   │   ├── auth/         # Login, signup
│   │   ├── rp-log/       # RP logging screen
│   │   ├── camera/       # Photo capture screens
│   │   ├── fridge/       # Fridge log
│   │   └── handover/     # Handover notes
│   ├── navigation/       # React Navigation setup
│   ├── store/           # Zustand stores
│   ├── services/        # API services, sync
│   ├── utils/           # Helper functions
│   └── types/           # TypeScript types
├── android/             # Android native code
├── ios/                # iOS native code
├── app.json            # React Native config
├── metro.config.js     # Metro bundler config
├── tsconfig.json       # TypeScript config
├── package.json        # Dependencies
└── README.md          # This file
```

## Platform Support

- **iOS**: iOS 14+
- **Android**: Android 8.0+ (API level 26+)

## Setup Instructions

**Note**: This is a scaffold. Actual setup will be documented once development begins.

### Prerequisites
- Node.js 20+
- pnpm 9+
- For iOS: Xcode 14+, CocoaPods
- For Android: Android Studio, JDK 11+

### Installation (Coming Soon)
```bash
# From monorepo root
pnpm install

# iOS: Install pods
cd apps/mobile/ios && pod install && cd ../../..

# Run on iOS
pnpm --filter @pharmstation/mobile ios

# Run on Android
pnpm --filter @pharmstation/mobile android
```

## Key Features to Implement

### Phase 3: Mobile App
- [ ] Authentication (biometric login)
- [ ] Quick RP sign-in/out widget
- [ ] Camera integration for photos
- [ ] Photo upload to cloud
- [ ] Fridge log (temperature entry)
- [ ] Handover notes (view, create)
- [ ] Quick view: CD balances
- [ ] Quick view: Recent entries
- [ ] Offline storage (AsyncStorage + SQLite)
- [ ] Background sync
- [ ] Push notifications
- [ ] Biometric authentication (Face ID, Touch ID, fingerprint)

## Mobile-Specific Considerations

### UI/UX
- **Touch Targets**: Minimum 44x44 pts (iOS) / 48x48 dp (Android)
- **Safe Areas**: Respect notch, home indicator, status bar
- **Gestures**: Swipe to delete, pull to refresh, etc.
- **Loading States**: Skeleton screens, spinners
- **Error Handling**: User-friendly error messages

### Performance
- **Fast Startup**: <2 seconds to interactive
- **Smooth Scrolling**: 60 FPS
- **Small Bundle**: <50MB
- **Memory**: <100MB
- **Battery**: Efficient, no background drain

### Offline Support
- Local SQLite database for critical data
- Queue changes for sync
- Visual indicator of online/offline status
- Graceful degradation when offline

### Camera
- High-quality photo capture
- Flash support
- Focus and exposure control
- Gallery access for existing photos
- Photo cropping and rotation

### Notifications
- Local notifications (no backend needed)
- Push notifications (Firebase Cloud Messaging)
- Badge counts
- Notification actions

## Testing (Future)

- **Unit Tests**: Jest
- **Component Tests**: React Native Testing Library
- **E2E Tests**: Detox or Maestro
- **Device Testing**: iOS Simulator, Android Emulator, real devices

## Build & Distribution

### Development Builds
```bash
# iOS
pnpm --filter @pharmstation/mobile ios

# Android
pnpm --filter @pharmstation/mobile android
```

### Production Builds

**iOS**:
```bash
# Build for App Store
cd apps/mobile/ios
xcodebuild -workspace PharmStation.xcworkspace \
           -scheme PharmStation \
           -configuration Release
```

**Android**:
```bash
# Build APK
cd apps/mobile/android
./gradlew assembleRelease

# Build AAB (for Play Store)
./gradlew bundleRelease
```

### App Store Submission
- **iOS**: App Store Connect
- **Android**: Google Play Console

### Metadata
- Screenshots (required for both stores)
- App description
- Keywords
- Privacy policy
- Support URL

## Code Sharing with Web

### Shared Code
- `@pharmstation/core`: Business logic, validation
- `@pharmstation/types`: TypeScript types
- API client logic (adapted for mobile)

### Platform-Specific
- UI components (React Native vs. React)
- Navigation (React Navigation vs. Next.js routing)
- Storage (AsyncStorage vs. localStorage)
- Camera (native vs. web APIs)

## Security

- Secure storage for tokens (react-native-keychain)
- Certificate pinning
- Biometric authentication
- No sensitive data in logs
- Obfuscation for production builds

## Accessibility

- VoiceOver (iOS) and TalkBack (Android) support
- Sufficient color contrast
- Accessible labels for all interactive elements
- Font scaling support

## Links

- [Product Vision](../../documentation/product/PRODUCT_VISION.md)
- [React Native Mobile Plan](../../documentation/technical/react-native-mobile-plan.md)
- [Phase 3: Mobile & Desktop](../../documentation/product/phase-3-mobile-desktop.md)
- [Offline Sync Strategy](../../documentation/technical/offline-sync-strategy.md)
