# Kids Pickup Queue - Quick Start Guide

## 🚀 Getting Started

This guide will help you set up and run the Kids Pickup Queue application.

## Prerequisites

- Node.js (v18 or later)
- npm or yarn
- A code editor (VS Code recommended)
- (Optional) Android Studio or Xcode for mobile development

## Installation

```bash
# Navigate to the project directory
cd c:\code\portal\kids-pickup-queue

# Install dependencies
npm install
```

## Running the Application

### Development Mode (Web Browser)

```bash
npm run dev
```

The app will open at `http://localhost:5173`

### Building for Production

```bash
npm run build
```

### Adding Mobile Platforms

```bash
# Add Android
npx cap add android

# Add iOS (macOS only)
npx cap add ios

# Sync changes
npx cap sync

# Open in native IDE
npx cap open android
npx cap open ios
```

## Project Structure

```
kids-pickup-queue/
├── src/
│   ├── pages/              # Main app screens
│   │   ├── QueueDisplay.tsx       # Real-time queue with animations
│   │   ├── CheckIn.tsx            # Parent check-in interface
│   │   ├── AdminDashboard.tsx     # Staff admin panel
│   │   └── Profile.tsx            # User profile & settings
│   ├── services/          # API and WebSocket services
│   ├── types/             # TypeScript interfaces
│   ├── theme/             # CSS styling and animations
│   └── App.tsx            # Main app component
├── public/                # Static assets
├── backend/               # Backend API documentation
└── package.json           # Dependencies
```

## Features Implemented

### ✅ Parent Features
- Check-in interface with child selection
- Real-time queue position tracking
- Visual animations for queue updates
- Push notifications when child is ready
- Profile management

### ✅ Staff/Admin Features
- Real-time queue dashboard
- Queue management (complete pickups, send notifications)
- Statistics overview
- Vehicle information display
- Parent contact details

### ✅ Queue Display Features
- Animated position changes
- Color-coded status indicators
- Estimated wait times
- Pull-to-refresh
- "Next up" highlighting
- Smooth transitions

### ✅ Animations
- Slide in/out animations
- Position change animations
- Pulse effects for ready status
- Bounce animations for alerts
- Gradient backgrounds

## Customization

### Colors & Theme
Edit [src/theme/variables.css](src/theme/variables.css) to customize:
- Primary/secondary colors
- Gradient colors
- Card shadows and borders

### Animations
Edit [src/theme/animations.css](src/theme/animations.css) to adjust:
- Animation speeds
- Transition effects
- Custom animations

## Backend Setup

The backend API structure is documented in [backend/README.md](backend/README.md).

Key features needed:
- RESTful API endpoints
- WebSocket support for real-time updates
- SMS notifications (Twilio)
- PostgreSQL database
- JWT authentication

## Testing

```bash
# Run unit tests
npm run test.unit

# Run e2e tests
npm run test.e2e
```

## Deployment

### Web Deployment
1. Build the app: `npm run build`
2. Deploy `dist/` folder to your hosting service

### Mobile App Stores
1. Build native apps: `npx cap sync`
2. Open in Xcode/Android Studio
3. Configure signing certificates
4. Build and submit to stores

## Environment Variables

Create a `.env` file:

```env
REACT_APP_API_URL=http://localhost:8000/api
REACT_APP_SOCKET_URL=http://localhost:8000
```

## Troubleshooting

### Dependencies Won't Install
```bash
rm -rf node_modules package-lock.json
npm install
```

### Build Errors
```bash
npm run build -- --verbose
```

### Capacitor Sync Issues
```bash
npx cap sync --inline
```

## Next Steps

1. **Set up backend API** - Follow backend/README.md
2. **Configure notifications** - Set up push notification certificates
3. **Add authentication** - Implement login/registration
4. **Connect real data** - Replace mock data with API calls
5. **Test on devices** - Build and test on actual mobile devices

## Resources

- [Ionic Documentation](https://ionicframework.com/docs)
- [React Documentation](https://react.dev)
- [Capacitor Documentation](https://capacitorjs.com/docs)
- [Framer Motion](https://www.framer.com/motion/)

## Support

For questions or issues:
1. Check the documentation
2. Review the code comments
3. Test with mock data first
4. Verify all dependencies are installed

---

**Happy Coding! 🎉**
