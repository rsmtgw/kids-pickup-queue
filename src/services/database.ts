import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

// Database Types
export interface Kid {
  id?: number;
  name: string;
  grade: string;
  parent_name: string;
  parent_phone: string;
  parent_email?: string;
  pickup_code: string;
  created_at?: string;
}

export interface User {
  id?: number;
  email: string;
  password_hash: string;
  role: 'admin' | 'staff' | 'parent';
  name: string;
  phone?: string;
  created_at?: string;
}

export interface PickupLog {
  id?: number;
  kid_id: number;
  picked_up_by: string;
  pickup_code: string;
  pickup_time: string;
  pillar_number: number;
  notes?: string;
}

export interface QueueState {
  id?: number;
  kid_id: number;
  position_in_queue: number;
  pillar_assigned?: number;
  status: 'waiting' | 'called' | 'picking_up' | 'completed';
  queue_date: string;
  created_at?: string;
  updated_at?: string;
}

class DatabaseService {
  private sqliteConnection: SQLiteConnection | null = null;
  private db: SQLiteDBConnection | null = null;
  private dbName = 'kids_pickup_queue.db';
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      this.sqliteConnection = new SQLiteConnection(CapacitorSQLite);
      
      // Create or open database
      this.db = await this.sqliteConnection.createConnection(
        this.dbName,
        false,
        'no-encryption',
        1,
        false
      );

      await this.db.open();
      await this.createTables();
      
      this.isInitialized = true;
      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Database initialization error:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not connected');

    const queries = [
      // Users table
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT CHECK(role IN ('admin', 'staff', 'parent')) NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`,

      // Kids table
      `CREATE TABLE IF NOT EXISTS kids (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        grade TEXT NOT NULL,
        parent_name TEXT NOT NULL,
        parent_phone TEXT NOT NULL,
        parent_email TEXT,
        pickup_code TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`,

      // Pickup logs table
      `CREATE TABLE IF NOT EXISTS pickup_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kid_id INTEGER NOT NULL,
        picked_up_by TEXT NOT NULL,
        pickup_code TEXT NOT NULL,
        pickup_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        pillar_number INTEGER,
        notes TEXT,
        FOREIGN KEY (kid_id) REFERENCES kids(id)
      );`,

      // Queue state table
      `CREATE TABLE IF NOT EXISTS queue_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kid_id INTEGER NOT NULL,
        position_in_queue INTEGER NOT NULL,
        pillar_assigned INTEGER,
        status TEXT CHECK(status IN ('waiting', 'called', 'picking_up', 'completed')) DEFAULT 'waiting',
        queue_date DATE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (kid_id) REFERENCES kids(id)
      );`,

      // Create indexes
      `CREATE INDEX IF NOT EXISTS idx_kids_pickup_code ON kids(pickup_code);`,
      `CREATE INDEX IF NOT EXISTS idx_queue_date ON queue_state(queue_date);`,
      `CREATE INDEX IF NOT EXISTS idx_queue_status ON queue_state(status);`,
      `CREATE INDEX IF NOT EXISTS idx_pickup_time ON pickup_logs(pickup_time);`
    ];

    for (const query of queries) {
      await this.db.execute(query);
    }
  }

  // Kids CRUD operations
  async addKid(kid: Omit<Kid, 'id' | 'created_at'>): Promise<number> {
    if (!this.db) throw new Error('Database not connected');

    const query = `INSERT INTO kids (name, grade, parent_name, parent_phone, parent_email, pickup_code) 
                   VALUES (?, ?, ?, ?, ?, ?)`;
    const result = await this.db.run(query, [
      kid.name,
      kid.grade,
      kid.parent_name,
      kid.parent_phone,
      kid.parent_email || null,
      kid.pickup_code
    ]);

    return result.changes?.lastId || 0;
  }

  async getKids(): Promise<Kid[]> {
    if (!this.db) throw new Error('Database not connected');

    const result = await this.db.query('SELECT * FROM kids ORDER BY name');
    return result.values || [];
  }

  async getKidById(id: number): Promise<Kid | null> {
    if (!this.db) throw new Error('Database not connected');

    const result = await this.db.query('SELECT * FROM kids WHERE id = ?', [id]);
    return result.values?.[0] || null;
  }

  async getKidByPickupCode(code: string): Promise<Kid | null> {
    if (!this.db) throw new Error('Database not connected');

    const result = await this.db.query('SELECT * FROM kids WHERE pickup_code = ?', [code]);
    return result.values?.[0] || null;
  }

  async updateKid(id: number, kid: Partial<Kid>): Promise<boolean> {
    if (!this.db) throw new Error('Database not connected');

    const fields = Object.keys(kid).filter(k => k !== 'id' && k !== 'created_at');
    const values = fields.map(f => kid[f as keyof Kid]);
    
    const query = `UPDATE kids SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`;
    const result = await this.db.run(query, [...values, id]);

    return (result.changes?.changes || 0) > 0;
  }

  async deleteKid(id: number): Promise<boolean> {
    if (!this.db) throw new Error('Database not connected');

    const result = await this.db.run('DELETE FROM kids WHERE id = ?', [id]);
    return (result.changes?.changes || 0) > 0;
  }

  // Queue operations
  async addToQueue(kidId: number, position: number, queueDate: string): Promise<number> {
    if (!this.db) throw new Error('Database not connected');

    const query = `INSERT INTO queue_state (kid_id, position_in_queue, queue_date, status) 
                   VALUES (?, ?, ?, 'waiting')`;
    const result = await this.db.run(query, [kidId, position, queueDate]);

    return result.changes?.lastId || 0;
  }

  async getTodayQueue(): Promise<(QueueState & { kid_name: string })[]> {
    if (!this.db) throw new Error('Database not connected');

    const today = new Date().toISOString().split('T')[0];
    const query = `
      SELECT q.*, k.name as kid_name 
      FROM queue_state q 
      JOIN kids k ON q.kid_id = k.id 
      WHERE q.queue_date = ? 
      ORDER BY q.position_in_queue
    `;
    
    const result = await this.db.query(query, [today]);
    return result.values || [];
  }

  async updateQueueStatus(id: number, status: QueueState['status'], pillar?: number): Promise<boolean> {
    if (!this.db) throw new Error('Database not connected');

    let query = 'UPDATE queue_state SET status = ?, updated_at = CURRENT_TIMESTAMP';
    const params: any[] = [status];

    if (pillar !== undefined) {
      query += ', pillar_assigned = ?';
      params.push(pillar);
    }

    query += ' WHERE id = ?';
    params.push(id);

    const result = await this.db.run(query, params);
    return (result.changes?.changes || 0) > 0;
  }

  async clearTodayQueue(): Promise<void> {
    if (!this.db) throw new Error('Database not connected');

    const today = new Date().toISOString().split('T')[0];
    await this.db.run('DELETE FROM queue_state WHERE queue_date = ?', [today]);
  }

  // Pickup logs
  async logPickup(log: Omit<PickupLog, 'id' | 'pickup_time'>): Promise<number> {
    if (!this.db) throw new Error('Database not connected');

    const query = `INSERT INTO pickup_logs (kid_id, picked_up_by, pickup_code, pillar_number, notes) 
                   VALUES (?, ?, ?, ?, ?)`;
    const result = await this.db.run(query, [
      log.kid_id,
      log.picked_up_by,
      log.pickup_code,
      log.pillar_number || null,
      log.notes || null
    ]);

    return result.changes?.lastId || 0;
  }

  async getPickupHistory(kidId?: number, limit: number = 50): Promise<(PickupLog & { kid_name: string })[]> {
    if (!this.db) throw new Error('Database not connected');

    let query = `
      SELECT p.*, k.name as kid_name 
      FROM pickup_logs p 
      JOIN kids k ON p.kid_id = k.id
    `;
    const params: any[] = [];

    if (kidId) {
      query += ' WHERE p.kid_id = ?';
      params.push(kidId);
    }

    query += ' ORDER BY p.pickup_time DESC LIMIT ?';
    params.push(limit);

    const result = await this.db.query(query, params);
    return result.values || [];
  }

  async getPickupStats(startDate: string, endDate: string): Promise<any[]> {
    if (!this.db) throw new Error('Database not connected');

    const query = `
      SELECT 
        DATE(pickup_time) as date,
        COUNT(*) as total_pickups,
        COUNT(DISTINCT kid_id) as unique_kids
      FROM pickup_logs 
      WHERE DATE(pickup_time) BETWEEN ? AND ?
      GROUP BY DATE(pickup_time)
      ORDER BY date DESC
    `;
    
    const result = await this.db.query(query, [startDate, endDate]);
    return result.values || [];
  }

  // User operations
  async addUser(user: Omit<User, 'id' | 'created_at'>): Promise<number> {
    if (!this.db) throw new Error('Database not connected');

    const query = `INSERT INTO users (email, password_hash, role, name, phone) 
                   VALUES (?, ?, ?, ?, ?)`;
    const result = await this.db.run(query, [
      user.email,
      user.password_hash,
      user.role,
      user.name,
      user.phone || null
    ]);

    return result.changes?.lastId || 0;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    if (!this.db) throw new Error('Database not connected');

    const result = await this.db.query('SELECT * FROM users WHERE email = ?', [email]);
    return result.values?.[0] || null;
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
    this.isInitialized = false;
  }
}

// Export singleton instance
export const db = new DatabaseService();
