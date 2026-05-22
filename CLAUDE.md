# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MyApp is a cross-platform social media downloader application built with:
- **Frontend**: React Native (Expo SDK 54) with Expo Router for file-based routing
- **Backend**: Node.js/Express server (port 3000) for media extraction and proxying downloads
- **Platforms**: Supports YouTube, Instagram, Facebook, Snapchat, LinkedIn

The app features:
- URL paste → media extraction → download workflow
- Download history with playback support
- User profile management
- Dark mode support
- Web and native (Android/iOS) download implementations

### Download Types per Platform
- **Instagram, Facebook, Snapchat, LinkedIn**: Video, Images, Audio
- **YouTube**: Video, Audio, Complete Playlist (audio & video)

## Development Setup

### Prerequisites
- Node.js (LTS recommended)
- Expo CLI: `npm install -g expo-cli`
- For mobile testing: Expo Go app (Android/iOS) or development build

### Installation
```bash
npm install
```

### Running the Application

1. **Start the backend server** (required for extraction):
```bash
npm run backend
# Server runs on http://0.0.0.0:3000
```

2. **Start Expo development server** (in another terminal):
```bash
npx expo start
```

The Expo dev server will output QR codes and options to run on:
- Android emulator: `npx expo run:android`
- iOS simulator: `npx expo run:ios`
- Web browser: `npm run web`

### Other Commands
```bash
# Lint code
npm run lint
```

## Architecture

### Frontend Structure
```
app/
├── _layout.tsx          # Root layout with ThemeProvider
├── (tabs)/              # Tab-based navigation group
│   ├── _layout.tsx      # Tab bar configuration
│   ├── index.tsx        # Home screen - URL input & extraction results
│   ├── downloads.tsx    # Download history management
│   └── settings.tsx     # User profile & app settings
├── +not-found.tsx       # 404 screen
└── index.tsx            # Redirect to (tabs)
hooks/
└── use-color-scheme.ts  # Custom hook for SSR-safe theme detection
```

**Key patterns**:
- Expo Router uses file-based routing with `(tabs)` for grouped screens
- Custom hook `useColorScheme()` in `@/hooks/use-color-scheme` for theming (SSR-safe)
- AsyncStorage for local persistence (downloads, user profile)
- Platform-specific handling: Web uses backend proxy for downloads, native uses `expo-file-system`

### Backend Structure
```
server.js                          # Express server (playlist handling, download proxy)
src/controllers/media.controller.js # URL routing to platform extractors
src/extractors/
├── youtube.js                     # YouTube extraction + shared yt-dlp helpers
├── instagram.js                   # Instagram extraction
├── facebook.js                    # Facebook extraction
├── snapchat.js                    # Snapchat extraction
└── linkedin.js                    # LinkedIn extraction
```

**Key endpoints**:
- `POST /api/media/analyze` - Main extraction endpoint. Accepts URL, returns metadata + download options
- `GET /api/media/download` - Proxy download endpoint (handles CORS for web, streams content)
- `GET /api/media/playlist-items` - YouTube playlist items endpoint

**Extraction strategy**: Multi-layered fallbacks per platform:
1. YouTube: yt-dlp (primary, async non-blocking)
2. Instagram: yt-dlp → btch igdl → btch AIO
3. Facebook: yt-dlp → btch AIO
4. Snapchat: yt-dlp → btch AIO
5. LinkedIn: yt-dlp → btch AIO

### Data Flow

1. User pastes URL in Home screen
2. App POSTs to `http://${devIp}:3000/api/media/analyze` (devIp auto-detected from Expo debuggerHost)
3. Backend extracts media info, returns `{ status, data: { type, title, thumbnail, options[] } }`
4. Frontend displays options with download buttons
5. Download triggers:
   - **Web**: Fetches via `/api/media/download?url=...` proxy → triggers browser download
   - **Native**: Uses `expo-file-system` resumable download → saves to MediaLibrary/Share

6. Completed downloads saved to AsyncStorage under key `'downloads'` as array of:
```typescript
{ id, title, status, type, size, uri? }
```

### Context & State
- No Redux/Context providers currently; state managed locally with useState/useReducer
- AsyncStorage for persistence across app restarts
- Theme: Uses React Navigation's ThemeProvider with system `useColorScheme()`

### Network Configuration
- Backend server hardcoded to port 3000
- Frontend auto-detects development machine IP via `Constants.expoConfig?.hostUri`
- For production/release builds, fallback to hardcoded `SERVER_IP` in `app/(tabs)/index.tsx`
- CORS enabled on backend for cross-origin requests

## Code Conventions

### Styling
- StyleSheet.create at component bottom
- Theme colors computed per-screen using `useColorScheme()`:
```typescript
const themeColors = {
  bg: isDark ? '#050B14' : '#F2F2F7',
  text: isDark ? '#FFFFFF' : '#000000',
  subText: isDark ? '#8FA1B3' : '#6B7280',
  // ...
};
```
- Ionicons from `@expo/vector-icons` for icons
- Gradient backgrounds using `expo-linear-gradient`

### TypeScript
- Loose typing (`any`) common in existing code - prefer stricter types for new code
- Props and state typed inline
- No formal type definitions for backend responses (implicit any)

### Error Handling
- Backend: Multi-fallback approach, logs to console, returns JSON `{ status, message }`
- Frontend: `try/catch` with `alert()` for user-visible errors

### Platform Detection
Platform detection for social media URLs:
```typescript
const getPlatformInfo = (inputUrl: string) => {
  if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) return { name: 'logo-youtube', color: '#FF0000', platform: 'youtube' };
  if (urlLower.includes('instagram.com')) return { ... platform: 'instagram' };
  if (urlLower.includes('facebook.com') || urlLower.includes('fb.watch')) return { ... platform: 'facebook' };
  if (urlLower.includes('linkedin.com')) return { ... platform: 'linkedin' };
  if (urlLower.includes('snapchat.com')) return { ... platform: 'snapchat' };
  // ...
};
```

## Testing Notes

No formal test suite exists. Manual testing flow:
1. Start backend on port 3000
2. Start Expo dev server
3. Test with live URLs from supported platforms
4. Verify downloads complete and appear in Downloads tab
5. Test on web and native (if available) as download logic differs

### Manual Testing Checklist
- [ ] YouTube video extraction (HD options, audio-only)
- [ ] YouTube playlist extraction (full playlist audio & video)
- [ ] Instagram post (single image, video, carousel)
- [ ] Facebook video/public post
- [ ] Snapchat story/spotlight
- [ ] LinkedIn video
- [ ] Web download workflow (CORS proxy)
- [ ] Native Android download (file system permissions)
- [ ] Native iOS download (media library permissions)
- [ ] Download history persistence
- [ ] Media playback from history
- [ ] Dark mode transitions

## Important Files to Know

- `server.js` - Express server, YouTube playlist handling, download proxy
- `src/controllers/media.controller.js` - URL routing to platform extractors
- `src/extractors/*.js` - Per-platform extraction logic
- `app/(tabs)/index.tsx` - Main UI, extraction triggering, download management
- `app/(tabs)/downloads.tsx` - History storage/retrieval, playback modal
- `app/(tabs)/settings.tsx` - User profile & app preferences
- `package.json` - Scripts and dependencies (Expo, React Native, extraction libraries)
- `app.json` - Expo configuration (permissions, plugins, schemes)
- `hooks/use-color-scheme.ts` - Theme detection hook (SSR-safe)

## Known Constraints

- Backend must be running for extraction to work; frontend auto-detects dev machine IP
- Web downloads require backend proxy to avoid CORS
- Native downloads use `expo-file-system` and require media library permissions
- No authentication system currently active
- Some extraction fallbacks rely on third-party APIs (btch-downloader) which may change or rate-limit
- yt-dlp.exe is bundled for Windows as ultimate YouTube fallback
- Backend server IP hardcoded for release builds - must be updated per deployment

## Maintenance Tips

- Adding new platform: Add detection in `media.controller.js`, create extractor in `src/extractors/`
- Update extraction libraries: Check versions of `btch-downloader` for compatibility
- Port conflicts: Backend hardcoded to 3000 - change if needed in `server.js`
- Expo SDK updates: Check breaking changes in expo-router, expo-file-system, react-native-reanimated
- Production build: Update `SERVER_IP` constant in `app/(tabs)/index.tsx` to point to deployed backend

## Environment Configuration

**Development:**
- No environment variables required
- Backend: `npm run backend` starts on port 3000
- Frontend auto-connects to dev machine IP

**Production/Release:**
- Update `SERVER_IP` in `app/(tabs)/index.tsx` to deployed backend URL
- Ensure backend CORS allows app origins
- For native builds, consider using a domain name instead of IP

## Dependencies Overview

### Frontend (Expo)
- `expo-router` - File-based routing
- `expo-av` - Audio/video playback
- `expo-file-system` - Native file downloads
- `expo-media-library` - Save to device gallery
- `expo-sharing` - Share files via system dialog
- `@react-native-async-storage/async-storage` - Local persistence
- `react-native-reanimated` - Animations
- `expo-linear-gradient` - Gradient visual effects

### Backend (Node.js)
- `express` - HTTP server
- `cors` - Cross-origin support
- `btch-downloader` - Multi-platform extraction (IG, FB, etc.)
- Bundled `yt-dlp.exe` - YouTube and universal fallback for complex videos

## Common Issues & Solutions

**"Backend connection failed"** - Ensure backend is running on port 3000, phone/computer on same network

**YouTube extraction fails** - yt-dlp may fail on age-restricted/cipher-protected videos; app will retry with browser cookies

**Web download triggers nothing** - Check browser console for CORS errors; verify backend proxy endpoint is accessible

**Native downloads not appearing in gallery** - Ensure media library permissions granted; check "MyApp" album in DCIM

**App crashes on extraction** - Backend may have thrown error; check server console for details

**iOS downloads fail** - Ensure `expo-media-library` permissions configured in `app.json` and Info.plist
