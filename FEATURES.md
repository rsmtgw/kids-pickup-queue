# Kids Pickup Queue - Feature Overview

## 📱 App Screenshots & Features

### 1. Queue Display Page (Main View)
**Path:** `/queue` - [QueueDisplay.tsx](src/pages/QueueDisplay.tsx)

**Features:**
- Real-time queue display with live updates
- Animated position transitions (slide in/out, smooth movements)
- Color-coded status badges (Waiting, Ready, Completed)
- Position numbers in gradient badges
- Statistics dashboard showing:
  - Total people in queue
  - Average wait time
  - Your current position (highlighted)
- Pull-to-refresh functionality
- Child photo avatars
- Parent vehicle information display
- Estimated wait time calculations
- "NEXT UP!" pulse animation for first position
- "Ready for Pickup" banner with bounce animation

**Animations:**
- `slideInFromRight` - New entries enter from right
- `slideOutToLeft` - Completed entries exit left
- `position-change` - Smooth movement when positions update
- `pulse` - Ready status cards pulse
- `notification-pulse` - Badge pulse for active notifications

---

### 2. Check-In Page
**Path:** `/checkin` - [CheckIn.tsx](src/pages/CheckIn.tsx)

**Features:**
- Beautiful gradient background (purple to violet)
- Info cards showing:
  - Arrival instructions with car icon
  - Average wait time estimate
- Child selection cards with:
  - Child photo avatar
  - Name and grade display
  - Selection highlight with blue border
  - Scale animation on selection
  - "Checked In" badge with checkmark
- Confirmation alert before check-in
- Success toast notification
- Staggered fade-in animation for child cards
- Disabled state for already checked-in children

**Animations:**
- `fadeIn` - Cards fade in on load with stagger
- `scale` - Selected card scales up
- Button slide-up animation when child selected

---

### 3. Admin Dashboard Page
**Path:** `/admin` - [AdminDashboard.tsx](src/pages/AdminDashboard.tsx)

**Features:**
- Today's statistics overview card with gradient background:
  - Total pickups completed
  - Average wait time
  - Current queue count (highlighted)
  - Peak pickup time
- Segmented control to switch between:
  - Active queue
  - Completed pickups
- Queue management cards displaying:
  - Position number in gradient badge
  - Child photo and information
  - Parent contact details
  - Vehicle information (color, make, model, license plate)
  - Time since check-in
  - Action buttons:
    - "Notify" - Send notification to parent
    - "Complete Pickup" - Mark as picked up
- Visual indicators for ready status
- Confirmation alerts for all actions
- Success toast messages

**Animations:**
- Staggered card entrance animations
- Left border color change for ready status
- Background gradient highlight for ready items

---

### 4. Profile Page
**Path:** `/profile` - [Profile.tsx](src/pages/Profile.tsx)

**Features:**
- Gradient header background
- Large profile avatar with shadow and white border
- Contact information section:
  - Email with icon
  - Phone with icon
- Vehicle information card:
  - Make, model, color display
  - License plate number
- My Children section:
  - List of all children with photos
  - Grade level display
- Notification settings:
  - Push notifications toggle
  - SMS alerts toggle
- Logout button

**Design:**
- Split background (gradient top, white bottom)
- Glass-morphism effect on header card
- Icon-based information display
- Clean, modern card layout

---

## 🎨 Animation System

### CSS Animations (theme/animations.css)
1. **slideInFromRight** - Entry animation for new queue items
2. **slideOutToLeft** - Exit animation for removed items
3. **fadeIn** - Gentle fade-in for content
4. **pulse** - Attention-grabbing pulse effect
5. **bounce** - Playful bounce for icons
6. **moveUp** - Position change with highlight
7. **notificationPulse** - Badge pulse with shadow ring

### Framer Motion Animations
- Layout animations for automatic position transitions
- Initial/animate/exit states for enter/leave
- Spring physics for natural movement
- Staggered children animations
- Conditional animations based on status

---

## 🎯 Key Visual Features

### Color Coding
- **Blue** - Primary color, selected states, waiting status
- **Green** - Success, ready for pickup, completed
- **Purple Gradient** - Headers, premium features
- **Yellow** - Warnings, attention needed

### Interactive Elements
- Cards grow/scale on selection
- Buttons have ripple effects (Ionic)
- Smooth transitions on all state changes
- Visual feedback for all actions

### Responsive Design
- Adapts to different screen sizes
- Touch-friendly button sizes
- Readable text at all sizes
- Collapsible headers
-Bottom tab navigation

---

## 🔔 Notification Types

1. **Position Change** - "You moved to position #X!"
2. **Ready for Pickup** - "Child ready at pickup area!"
3. **Next in Line** - "You're next! Get ready."
4. **General Updates** - System announcements

---

## 🚀 Real-time Features

### WebSocket Events
- `queue:updated` - Queue state changes
- `queue:position_changed` - Position updates
- `queue:child_ready` - Child ready notification
- `notification:new` - New notification received

### Live Updates
- Queue positions update automatically
- Statistics refresh in real-time
- Notifications arrive instantly
- No page refresh needed

---

## 📊 Statistics Tracked

- Total pickups per day
- Average wait times
- Current queue length
- Peak traffic times
- Parent response times
- Staff efficiency metrics

---

## 🎭 User Roles

### Parents
- Check in children
- View queue position
- Receive notifications
- Update profile/vehicle info

### Staff/Admin
- Manage entire queue
- Send notifications
- Complete pickups
- View statistics
- Handle emergencies

---

## 💡 Future Enhancements

- Facial recognition check-in
- Weather-based wait time adjustments
- Multi-school support
- Appointment scheduling
- Analytics dashboard
- Parent feedback system
- Emergency alerts

---

## 🚦 Real-Time Traffic & AI Scheduling (Implemented)

### Google Maps Distance Matrix Integration
- **Endpoint**: `GET /api/parent/{id}/travel-time`
- Retrieves real-time travel time using Google Maps Distance Matrix API
- Falls back to haversine estimate with simulated traffic variation when `GOOGLE_MAPS_API_KEY` is not set
- Travel times automatically updated when parent location changes
- **5-minute cache** per parent to avoid excessive API calls

### Environment Variable
```
GOOGLE_MAPS_API_KEY=your_key_here    # Get at console.cloud.google.com
GOOGLE_GEMINI_API_KEY=your_key_here  # Google Gemini API key for AI departure advice
```

### Traffic-Aware Travel Time Fields (ParentDTO)
| Field | Description |
|---|---|
| `travel_time_min` | Drive time without traffic (minutes) |
| `travel_time_traffic_min` | Drive time with current traffic (minutes) |
| `traffic_condition` | `light` / `moderate` / `heavy` / `unknown` |
| `travel_source` | `google_maps` / `haversine_estimate` / `haversine_fallback` |

### New Endpoints
| Endpoint | Purpose |
|---|---|
| `GET /api/parent/{id}/travel-time` | Real-time travel time for one parent |
| `POST /api/travel-time/refresh-all` | Batch-refresh travel times for all parents |
| `GET /api/travel-time/summary` | Traffic overview for all parents |
| `GET /api/ai/smart-schedule` | Deterministic traffic-aware departure schedule |

### AI Smart Scheduling Agent (`GET /api/ai/smart-schedule`)
- Uses real traffic travel times (from Google Maps or estimate)
- Adapts wave spacing to **current queue throughput** — if queue is moving fast, waves are tighter
- **Queue pressure detection**: if too many cars are waiting at school, waves are spaced further apart to let the queue drain
- Adds **traffic buffer** for heavy/moderate traffic parents (2 min / 1 min extra)
- Returns `queue_pressure` (`low` / `medium` / `high`) based on current waiting count

### Traffic-Aware AI Departure Recommendation (`GET /api/parent/{id}/when-to-leave`)
- Now uses real travel time with traffic (not `distance/30*60` estimate)
- Passes traffic condition, queue pressure, and throughput to the AI agent (Google Gemini)
- AI reasons about **when to leave considering real traffic delays**
- Response includes `traffic_condition`, `queue_pressure`, `optimal_departure_window_min`, and full `travel_info`

### Parent Admin Dashboard Enhancements
- **Traffic summary stats**: count of light/moderate/heavy parents
- **Traffic column** in the parent table: per-parent traffic badge
- **Drive (Traffic) column**: shows actual traffic-aware travel time
- **🗺️ Refresh Traffic** button: force-updates all travel times (clears cache)
- **🚦 Smart Schedule** button: uses deterministic traffic-aware scheduler
- Schedule banner shows traffic breakdown and queue pressure

