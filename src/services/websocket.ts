import { io, Socket } from 'socket.io-client';
import { QueueEntry, Notification } from '../types';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:8000';

class WebSocketService {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<Function>> = new Map();

  connect(token?: string) {
    if (this.socket?.connected) {
      return;
    }

    this.socket = io(SOCKET_URL, {
      auth: {
        token,
      },
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      console.log('WebSocket connected');
    });

    this.socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
    });

    // Queue events
    this.socket.on('queue:updated', (data: QueueEntry[]) => {
      this.emit('queue:updated', data);
    });

    this.socket.on('queue:position_changed', (data: { entryId: string; newPosition: number }) => {
      this.emit('queue:position_changed', data);
    });

    this.socket.on('queue:child_ready', (data: { entryId: string; childId: string }) => {
      this.emit('queue:child_ready', data);
    });

    // Notification events
    this.socket.on('notification:new', (data: Notification) => {
      this.emit('notification:new', data);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: Function) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  private emit(event: string, data: any) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach(callback => callback(data));
    }
  }

  // Send events
  joinParentRoom(parentId: string) {
    this.socket?.emit('join:parent', { parentId });
  }

  joinAdminRoom() {
    this.socket?.emit('join:admin');
  }

  leaveRoom(room: string) {
    this.socket?.emit('leave:room', { room });
  }
}

export default new WebSocketService();
