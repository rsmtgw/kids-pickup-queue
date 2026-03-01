export interface Child {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl?: string;
  grade?: string;
  notes?: string;
  parentIds: string[];
}

export interface Parent {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  childIds: string[];
  vehicleInfo?: {
    make: string;
    model: string;
    color: string;
    licensePlate: string;
  };
}

export interface QueueEntry {
  id: string;
  childId: string;
  parentId: string;
  position: number;
  checkInTime: Date;
  estimatedPickupTime?: Date;
  status: 'waiting' | 'ready' | 'completed' | 'cancelled';
  notes?: string;
}

export interface QueueState {
  entries: QueueEntry[];
  totalInQueue: number;
  averageWaitTime: number;
  lastUpdate: Date;
}

export interface Notification {
  id: string;
  recipientId: string;
  type: 'position_update' | 'ready_for_pickup' | 'general';
  message: string;
  timestamp: Date;
  read: boolean;
}

export interface AppState {
  user: Parent | null;
  userRole: 'parent' | 'staff' | 'admin';
  children: Child[];
  queue: QueueState;
  notifications: Notification[];
}
