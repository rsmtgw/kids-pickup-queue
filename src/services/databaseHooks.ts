import { useEffect, useState } from 'react';
import { db, PickupLog, QueueState } from './database';
import { kidsApi, KidDTO } from './api';

// Re-export KidDTO as Kid so existing imports don't need to change
export type Kid = KidDTO;

// useDatabase: no longer manages SQLite — just signals ready immediately.
// Kept for backward compatibility with pages that call it.
export function useDatabase() {
  return { isReady: true, error: null };
}

export function useKids() {
  const [kids, setKids] = useState<Kid[]>([]);
  const [loading, setLoading] = useState(true);

  const loadKids = async () => {
    setLoading(true);
    try {
      const data = await kidsApi.getAll();
      setKids(data);
    } catch (err) {
      // Server not running — silent fallback (PickupVisualization has built-in fallback data)
      console.warn('Kids API unreachable, falling back to local data:', err);
      setKids([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadKids(); }, []);

  const addKid = async (kid: Omit<Kid, 'id' | 'created_at'>) => {
    await kidsApi.create(kid);
    await loadKids();
  };

  const updateKid = async (id: number, kid: Partial<Kid>) => {
    await kidsApi.update(id, kid);
    await loadKids();
  };

  const deleteKid = async (id: number) => {
    await kidsApi.remove(id);
    await loadKids();
  };

  return { kids, loading, addKid, updateKid, deleteKid, reload: loadKids };
}

export function useQueue() {
  const [queue, setQueue] = useState<(QueueState & { kid_name: string })[]>([]);
  const [loading, setLoading] = useState(true);

  const loadQueue = async () => {
    setLoading(true);
    try {
      const data = await db.getTodayQueue();
      setQueue(data);
    } catch (error) {
      console.error('Error loading queue:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQueue();
  }, []);

  const addToQueue = async (kidId: number, position: number) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      await db.addToQueue(kidId, position, today);
      await loadQueue();
    } catch (error) {
      console.error('Error adding to queue:', error);
      throw error;
    }
  };

  const updateStatus = async (id: number, status: QueueState['status'], pillar?: number) => {
    try {
      await db.updateQueueStatus(id, status, pillar);
      await loadQueue();
    } catch (error) {
      console.error('Error updating queue status:', error);
      throw error;
    }
  };

  const clearQueue = async () => {
    try {
      await db.clearTodayQueue();
      await loadQueue();
    } catch (error) {
      console.error('Error clearing queue:', error);
      throw error;
    }
  };

  return { queue, loading, addToQueue, updateStatus, clearQueue, reload: loadQueue };
}

export function usePickupHistory(kidId?: number) {
  const [history, setHistory] = useState<(PickupLog & { kid_name: string })[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const data = await db.getPickupHistory(kidId);
      setHistory(data);
    } catch (error) {
      console.error('Error loading history:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [kidId]);

  const logPickup = async (log: Omit<PickupLog, 'id' | 'pickup_time'>) => {
    try {
      await db.logPickup(log);
      await loadHistory();
    } catch (error) {
      console.error('Error logging pickup:', error);
      throw error;
    }
  };

  return { history, loading, logPickup, reload: loadHistory };
}
