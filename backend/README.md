# Kids Pickup Queue - Backend API

This document outlines the backend API structure for the Kids Pickup Queue system.

## Technology Stack

- **Framework**: FastAPI (Python) or Express.js (Node.js)
- **Database**: PostgreSQL or MongoDB
- **Real-time**: Socket.io
- **Authentication**: JWT tokens
- **SMS**: Twilio or similar service

## Database Schema

### Users Table
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20),
    role VARCHAR(20), -- 'parent', 'staff', 'admin'
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Children Table
```sql
CREATE TABLE children (
    id UUID PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    grade VARCHAR(50),
    photo_url VARCHAR(500),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Parent_Children Table
```sql
CREATE TABLE parent_children (
    parent_id UUID REFERENCES users(id),
    child_id UUID REFERENCES children(id),
    PRIMARY KEY (parent_id, child_id)
);
```

### Vehicles Table
```sql
CREATE TABLE vehicles (
    id UUID PRIMARY KEY,
    parent_id UUID REFERENCES users(id),
    make VARCHAR(50),
    model VARCHAR(50),
    color VARCHAR(30),
    license_plate VARCHAR(20),
    is_primary BOOLEAN DEFAULT false
);
```

### Queue_Entries Table
```sql
CREATE TABLE queue_entries (
    id UUID PRIMARY KEY,
    child_id UUID REFERENCES children(id),
    parent_id UUID REFERENCES users(id),
    position INTEGER,
    check_in_time TIMESTAMP DEFAULT NOW(),
    status VARCHAR(20), -- 'waiting', 'ready', 'completed', 'cancelled'
    completed_at TIMESTAMP,
    notes TEXT
);
```

### Notifications Table
```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    recipient_id UUID REFERENCES users(id),
    type VARCHAR(50),
    message TEXT,
    timestamp TIMESTAMP DEFAULT NOW(),
    read BOOLEAN DEFAULT false
);
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `POST /api/auth/refresh` - Refresh token

### Parent Endpoints
- `GET /api/parents/:id` - Get parent profile
- `PUT /api/parents/:id` - Update parent profile
- `GET /api/parents/:id/children` - Get parent's children

### Children Endpoints
- `GET /api/children/:id` - Get child details
- `POST /api/children` - Add new child
- `PUT /api/children/:id` - Update child
- `DELETE /api/children/:id` - Remove child

### Queue Endpoints
- `GET /api/queue/state` - Get current queue state
- `POST /api/queue/checkin` - Check in to queue
- `DELETE /api/queue/cancel/:id` - Cancel check-in
- `GET /api/queue/position/:id` - Get queue position

### Admin Endpoints
- `GET /api/admin/queue` - Get all queue entries
- `PATCH /api/admin/queue/:id` - Update queue entry
- `POST /api/admin/queue/:id/complete` - Mark pickup complete
- `POST /api/admin/notifications` - Send notification
- `GET /api/admin/statistics` - Get system statistics

### Notification Endpoints
- `GET /api/notifications/:userId` - Get user notifications
- `POST /api/notifications/:id/read` - Mark as read

## WebSocket Events

### Client → Server
- `join:parent` - Join parent's room
- `join:admin` - Join admin room
- `leave:room` - Leave room

### Server → Client
- `queue:updated` - Queue state changed
- `queue:position_changed` - Position in queue changed
- `queue:child_ready` - Child ready for pickup
- `notification:new` - New notification

## Environment Variables

```env
# Server
PORT=8000
NODE_ENV=production

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/kids_queue

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRATION=24h

# Twilio (SMS)
TWILIO_ACCOUNT_SID=your-sid
TWILIO_AUTH_TOKEN=your-token
TWILIO_PHONE_NUMBER=+1234567890

# CORS
CORS_ORIGIN=http://localhost:5173
```

## Deployment

```bash
# Install dependencies
npm install

# Run migrations
npm run migrate

# Start server
npm start

# Start with PM2 (production)
pm2 start server.js --name kids-queue-api
```
