# SQLite Database Setup

## Database Structure

The app now has a complete SQLite database with the following tables:

### Tables

1. **users** - Admin/staff/parent accounts
   - id, email, password_hash, role, name, phone, created_at

2. **kids** - Kids information
   - id, name, grade, parent_name, parent_phone, parent_email, pickup_code, created_at

3. **pickup_logs** - Historical pickup records
   - id, kid_id, picked_up_by, pickup_code, pickup_time, pillar_number, notes

4. **queue_state** - Daily queue management
   - id, kid_id, position_in_queue, pillar_assigned, status, queue_date, created_at, updated_at

## Usage in React Components

### 1. Initialize Database (App.tsx or main component)

```typescript
import { useDatabase } from './services/databaseHooks';

function App() {
  const { isReady, error } = useDatabase();
  
  if (!isReady) return <div>Loading...</div>;
  if (error) return <div>Database Error: {error}</div>;
  
  return <YourApp />;
}
```

### 2. Manage Kids

```typescript
import { useKids } from './services/databaseHooks';

function KidsPage() {
  const { kids, loading, addKid, updateKid, deleteKid } = useKids();
  
  const handleAddKid = async () => {
    await addKid({
      name: 'John Doe',
      grade: '3rd Grade',
      parent_name: 'Jane Doe',
      parent_phone: '555-1234',
      parent_email: 'jane@example.com',
      pickup_code: 'ABC123'
    });
  };
  
  return (
    <div>
      {kids.map(kid => (
        <div key={kid.id}>{kid.name} - {kid.pickup_code}</div>
      ))}
    </div>
  );
}
```

### 3. Manage Queue

```typescript
import { useQueue } from './services/databaseHooks';

function QueuePage() {
  const { queue, loading, addToQueue, updateStatus, clearQueue } = useQueue();
  
  const handleCheckIn = async (kidId: number) => {
    const position = queue.length + 1;
    await addToQueue(kidId, position);
  };
  
  const handleCallNext = async (queueId: number, pillar: number) => {
    await updateStatus(queueId, 'called', pillar);
  };
  
  return (
    <div>
      {queue.map(item => (
        <div key={item.id}>
          {item.kid_name} - Position: {item.position_in_queue} - Status: {item.status}
        </div>
      ))}
    </div>
  );
}
```

### 4. Pickup History

```typescript
import { usePickupHistory } from './services/databaseHooks';

function HistoryPage() {
  const { history, loading, logPickup } = usePickupHistory();
  
  const handleLogPickup = async (kidId: number, code: string) => {
    await logPickup({
      kid_id: kidId,
      picked_up_by: 'Parent Name',
      pickup_code: code,
      pillar_number: 3,
      notes: 'On time pickup'
    });
  };
  
  return (
    <div>
      {history.map(log => (
        <div key={log.id}>
          {log.kid_name} picked up at {log.pickup_time}
        </div>
      ))}
    </div>
  );
}
```

## Direct Database Access

For custom queries, use the database service directly:

```typescript
import { db } from './services/database';

async function customQuery() {
  await db.initialize();
  
  const kid = await db.getKidByPickupCode('ABC123');
  const stats = await db.getPickupStats('2026-01-01', '2026-01-31');
}
```

## Available Methods

### Kids
- `db.addKid(kid)` - Add new kid
- `db.getKids()` - Get all kids
- `db.getKidById(id)` - Get kid by ID
- `db.getKidByPickupCode(code)` - Find kid by pickup code
- `db.updateKid(id, data)` - Update kid info
- `db.deleteKid(id)` - Delete kid

### Queue
- `db.addToQueue(kidId, position, date)` - Add kid to queue
- `db.getTodayQueue()` - Get today's queue with kid names
- `db.updateQueueStatus(id, status, pillar?)` - Update queue status
- `db.clearTodayQueue()` - Clear today's queue

### Pickup Logs
- `db.logPickup(log)` - Log a pickup
- `db.getPickupHistory(kidId?, limit)` - Get pickup history
- `db.getPickupStats(startDate, endDate)` - Get pickup statistics

### Users
- `db.addUser(user)` - Add new user
- `db.getUserByEmail(email)` - Get user by email

## Integration with Existing PickupVisualization

To connect the visualization with real data:

```typescript
import { useQueue } from '../services/databaseHooks';

function PickupVisualization() {
  const { queue, updateStatus } = useQueue();
  
  // Use real queue data instead of mock kids
  const activeQueue = queue.filter(item => item.status !== 'completed');
  
  // When car reaches pillar, update status
  const handlePickup = async (queueId: number, pillar: number) => {
    await updateStatus(queueId, 'picking_up', pillar);
    
    // After animation completes
    setTimeout(async () => {
      await updateStatus(queueId, 'completed');
    }, 3000);
  };
  
  return (
    // Your visualization with real data
  );
}
```

## Testing

To test the database:
1. Run the app: `npm run dev`
2. Go to Kids Management page
3. Add a few kids
4. Check browser DevTools → Application → IndexedDB (web) or native SQLite on mobile
