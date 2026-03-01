# Kids Pickup Queue System

A modern mobile application for managing kids pickup queues at schools, daycares, and after-school programs.

## Features

- 🎯 Real-time queue display with smooth animations
- 📱 Parent check-in interface
- 👨‍💼 Staff/admin dashboard
- 👶 Child profiles with names and photos
- 🔔 SMS and push notifications
- 📍 Queue position tracking
- ⚡ Real-time updates via WebSocket

## Technology Stack

- **Frontend**: Ionic React with Capacitor
- **Animations**: Framer Motion
- **Real-time**: Socket.io
- **Build Tool**: Vite
- **Language**: TypeScript

## Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Run on Device

```bash
# Add platforms
npx cap add android
npx cap add ios

# Sync and open
npx cap sync
npx cap open android
npx cap open ios
```

## Project Structure

```
src/
├── components/        # Reusable UI components
├── pages/            # App pages/screens
├── services/         # API and business logic
├── hooks/            # Custom React hooks
├── types/            # TypeScript type definitions
└── theme/            # Styling and theme
```

## Usage

### For Parents
1. Open the app and check in when arriving
2. View your position in the queue
3. Receive notifications when it's your turn

### For Staff
1. Access the admin dashboard
2. View all children in queue
3. Mark children as picked up
4. Send notifications to parents

## License

MIT
