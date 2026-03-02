import { Child, Parent, QueueEntry, QueueState, Notification } from '../types';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:8000/api';

// ── Kids REST API ──────────────────────────────────────────────────────────────
export interface KidDTO {
  id?: number;
  name: string;
  grade: string;
  parent_name: string;
  parent_phone: string;
  parent_email?: string;
  pickup_code: string;
  created_at?: string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${init?.method ?? 'GET'} ${path} → ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const kidsApi = {
  getAll:   ()                                            => apiFetch<KidDTO[]>('/kids'),
  getById:  (id: number)                                  => apiFetch<KidDTO>(`/kids/${id}`),
  byCode:   (code: string)                                => apiFetch<{ kid: KidDTO; parent: any; scan: any }>(`/kids/by-code/${encodeURIComponent(code)}`),
  create:   (kid: Omit<KidDTO, 'id' | 'created_at'>)     => apiFetch<KidDTO>('/kids', { method: 'POST',   body: JSON.stringify(kid) }),
  update:   (id: number, kid: Partial<KidDTO>)            => apiFetch<KidDTO>(`/kids/${id}`, { method: 'PUT', body: JSON.stringify(kid) }),
  remove:   (id: number)                                  => apiFetch<void>(`/kids/${id}`, { method: 'DELETE' }),
};

// ── Scan API ───────────────────────────────────────────────────────────────────
export interface ScanRecord {
  id:           number;
  kid_id:       number;
  name:         string;
  pillar:       number;
  seq:          number;       // server-assigned arrival sequence number
  scanned_at:   string;
  car_arrived:  boolean;      // true when visualization car reached the pillar
  picked_up:    boolean;      // true when pillar manager confirmed kid boarded
  picked_up_at: string | null;
  queue_status: 'waiting' | 'pickup' | 'done';
}

export interface QueueStatus {
  started: boolean;
  waiting: number;
  pickup:  number;
  done:    number;
}

export interface ScanIn {
  kid_id: number;
  name:   string;
  pillar?: number;  // omit to let server auto-assign
}

export const scanApi = {
  /** Send kid details to server; server assigns the sequence number and stores the record. */
  scan:              (data: ScanIn)   => apiFetch<ScanRecord>('/scan', { method: 'POST', body: JSON.stringify(data) }),
  /** Get all scan assignments ordered by seq (useful for a scoreboard / log view). */
  getAll:            ()               => apiFetch<ScanRecord[]>('/scan'),
  /** Get the scan record for a specific kid by their id. */
  getById:           (kidId: number)  => apiFetch<ScanRecord>(`/scan/${kidId}`),
  /** Get all scan records assigned to a specific pillar. */
  getByPillar:       (pillar: number) => apiFetch<ScanRecord[]>(`/pillar/${pillar}`),
  /** Called when the car reaches the scanner point — assigns the next pillar in the cycle. */
  assignPillar:      (kidId: number)  => apiFetch<ScanRecord>(`/scan/${kidId}/assign-pillar`, { method: 'POST' }),
  /** Called by visualization when a car arrives at a pillar pickup spot. */
  notifyCarArrived:  (kidId: number)  => apiFetch<ScanRecord>(`/scan/${kidId}/car-arrived`, { method: 'POST' }),
  /** Called by pillar manager to confirm kid has boarded the car. */
  confirmPickup:     (kidId: number)  => apiFetch<ScanRecord>(`/scan/${kidId}/pickup`, { method: 'POST' }),
  /** Reset scan records (call on visualization restart). */
  reset:             ()               => apiFetch<void>('/scan', { method: 'DELETE' }),
};

export const queueApi = {
  /** Start pickup session — moves first N records from waiting → pickup queue. */
  startPickup: () => apiFetch<{ started: boolean; pickup: ScanRecord[] }>('/queue/start', { method: 'POST' }),
  /** All cars waiting on main road. */
  getWaiting:  () => apiFetch<ScanRecord[]>('/queue/waiting'),
  /** Cars currently active in the pickup lane. */
  getPickup:   () => apiFetch<ScanRecord[]>('/queue/pickup'),
  /** Summary counts. */
  getStatus:   () => apiFetch<QueueStatus>('/queue/status'),
};

// ── AI Queue Analysis API ──────────────────────────────────────────────────────
export interface AiParentAlert {
  should_alert: boolean;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface AiPillarStat {
  total: number;
  done: number;
  waiting: number;
  avg_pickup_sec: number;
}

export interface QueueMetrics {
  total_scanned: number;
  waiting: number;
  in_pickup: number;
  done: number;
  avg_pickup_time_sec: number;
  max_pickup_time_sec: number;
  min_pickup_time_sec: number;
  avg_current_wait_sec: number;
  throughput_per_min: number;
  pillar_count: number;
  pillar_stats: Record<string, AiPillarStat>;
  pickup_started: boolean;
}

export interface AiAnalysis {
  optimal_batch_size: number;
  recommended_countdown_sec: number;
  queue_health: 'green' | 'yellow' | 'red';
  estimated_wait_for_new_car_sec: number;
  parent_alert: AiParentAlert;
  recommendations: string[];
  bottleneck: string;
  summary: string;
  metrics: QueueMetrics;
}

export interface AiChatResponse {
  answer: string;
  metrics: QueueMetrics;
}

export const aiApi = {
  /** Get raw queue metrics (no AI call). */
  getMetrics: () => apiFetch<QueueMetrics>('/ai/metrics'),
  /** Get AI analysis with recommendations & parent alerts. */
  analyze:    () => apiFetch<AiAnalysis>('/ai/analyze'),
  /** Ask a free-form question to AI with live queue context. */
  chat:       (question: string) => apiFetch<AiChatResponse>('/ai/chat', { method: 'POST', body: JSON.stringify({ question }) }),
};

// ── Parent Portal API ──────────────────────────────────────────────────────────

export interface ParentDTO {
  id: number;
  name: string;
  phone: string;
  email: string;
  location_lat: number;
  location_lng: number;
  location_address: string;
  distance_km: number;
  travel_time_min: number;
  travel_time_traffic_min: number;
  traffic_condition: 'light' | 'moderate' | 'heavy' | 'unknown';
  travel_source: 'google_maps' | 'haversine_estimate' | 'haversine_fallback' | 'pending';
  kid_id: number;
  logged_in: boolean;
}

export interface ParentLoginResponse {
  parent: ParentDTO;
  kid: KidDTO;
}

export interface KidQueueInfo {
  kid_id: number;
  kid_name: string;
  scanned: boolean;
  scan: ScanRecord | null;
}

export interface ParentQueueStatusResponse {
  parent: ParentDTO;
  kid_status: KidQueueInfo;
}

export interface TravelTimeInfo {
  travel_time_sec: number;
  travel_time_traffic_sec: number;
  travel_time_min: number;
  travel_time_traffic_min: number;
  distance_m: number;
  distance_km: number;
  traffic_condition: 'light' | 'moderate' | 'heavy' | 'unknown';
  source: string;
}

export interface WhenToLeaveResponse {
  should_leave_now: boolean;
  leave_in_minutes: number;
  estimated_arrival_min: number;
  estimated_wait_at_school_min: number;
  queue_position_when_arrive: number;
  message: string;
  reasoning: string;
  teacher_prep_time_min: number;
  traffic_condition: string;
  travel_time_with_traffic_min: number;
  queue_pressure: string;
  optimal_departure_window_min?: number;
  parent: { id: number; name: string; distance_km: number; location?: { lat: number; lng: number } };
  travel_info?: TravelTimeInfo;
  metrics: QueueMetrics;
}

export interface TeacherSequenceItem extends ScanRecord {
  grade: string;
  parent_name: string;
  parent_id: number | null;
  est_minutes_until_called?: number;
  teacher_action?: string;
}

export interface TeacherSequenceResponse {
  current_at_pillars: TeacherSequenceItem[];
  prepare_next: TeacherSequenceItem[];
  recently_completed: TeacherSequenceItem[];
  avg_pickup_time_sec: number;
}

export const parentApi = {
  /** Login by kid name → returns parent + their kids */
  login:         (kidName: string) => apiFetch<ParentLoginResponse>('/parent/login', { method: 'POST', body: JSON.stringify({ kid_name: kidName }) }),
  /** Get parent details with kids */
  get:           (parentId: number) => apiFetch<ParentLoginResponse>(`/parent/${parentId}`),
  /** Update parent's GPS location */
  updateLocation: (parentId: number, lat: number, lng: number, address?: string) =>
    apiFetch<ParentDTO>(`/parent/${parentId}/location`, { method: 'PUT', body: JSON.stringify({ lat, lng, address }) }),
  /** Get queue status for this parent's kids */
  queueStatus:   (parentId: number) => apiFetch<ParentQueueStatusResponse>(`/parent/${parentId}/queue-status`),
  /** AI recommendation: when should this parent leave */
  whenToLeave:   (parentId: number) => apiFetch<WhenToLeaveResponse>(`/parent/${parentId}/when-to-leave`),
  /** Get real-time travel time for a parent */
  travelTime:    (parentId: number) => apiFetch<TravelTimeInfo & { parent_id: number; parent_name: string }>(`/parent/${parentId}/travel-time`),
  /** List all parents */
  getAll:        () => apiFetch<ParentDTO[]>('/parents'),
};

// ── Travel Time API ────────────────────────────────────────────────────────────

export interface TravelTimeSummary {
  parents: Array<{
    parent_id: number;
    parent_name: string;
    distance_km: number;
    travel_time_min: number;
    travel_time_traffic_min: number;
    traffic_condition: string;
    travel_source: string;
    location: { lat: number; lng: number };
  }>;
  traffic_summary: TrafficSummary;
  avg_travel_time_min: number;
  max_travel_time_min: number;
  school_location: { lat: number; lng: number };
}

export interface SmartScheduleResponse {
  schedule: AiScheduleItem[];
  total_waves: number;
  wave_interval_min: number;
  already_scanned: number;
  yet_to_schedule: number;
  traffic_summary: TrafficSummary;
  avg_travel_time_min: number;
  max_travel_time_min: number;
  queue_pressure: string;
  target_queue_size: { min: number; max: number };
  throughput_per_min: number;
  summary: string;
  metrics: QueueMetrics;
  school_location: { lat: number; lng: number };
}

export const travelTimeApi = {
  /** Refresh travel times for ALL parents (batch) */
  refreshAll:   () => apiFetch<{ parents: any[]; traffic_summary: TrafficSummary }>('/travel-time/refresh-all', { method: 'POST' }),
  /** Get travel time summary for all parents */
  summary:      () => apiFetch<TravelTimeSummary>('/travel-time/summary'),
};

export const smartScheduleApi = {
  /** AI smart scheduling agent — traffic-aware optimal departure times */
  getSchedule:  () => apiFetch<SmartScheduleResponse>('/ai/smart-schedule'),
};

export const teacherApi = {
  /** Get ordered sequence of kids for teachers to prepare */
  getSequence: () => apiFetch<TeacherSequenceResponse>('/teacher/sequence'),
};

// ── Parent Admin API ───────────────────────────────────────────────────────────

export interface ParentAdminKidInfo {
  kid_id: number;
  kid_name: string;
  grade: string;
  scan: ScanRecord | null;
}

export interface ParentAdminEntry {
  parent: ParentDTO;
  kid: ParentAdminKidInfo;
  est_drive_min: number;
  travel_time_min: number;
  travel_time_traffic_min: number;
  traffic_condition: 'light' | 'moderate' | 'heavy' | 'unknown';
  travel_source: string;
}

export interface TrafficSummary {
  light: number;
  moderate: number;
  heavy: number;
  unknown?: number;
}

export interface ParentAdminOverview {
  parents: ParentAdminEntry[];
  metrics: QueueMetrics;
  traffic_summary: TrafficSummary;
}

export interface AiScheduleItem {
  parent_id: number;
  parent_name: string;
  leave_in_minutes: number;
  wave: number;
  reason: string;
  travel_time_traffic_min?: number;
  traffic_condition?: string;
  estimated_arrival_min?: number;
  traffic_buffer_min?: number;
}

export interface AiScheduleResponse {
  schedule: AiScheduleItem[];
  total_waves: number;
  wave_interval_min: number;
  summary: string;
  metrics: QueueMetrics;
  traffic_summary?: TrafficSummary;
  queue_pressure?: string;
  avg_travel_time_min?: number;
  max_travel_time_min?: number;
  fallback?: boolean;
}

export interface StartParentResponse {
  already_scanned: boolean;
  scan: ScanRecord;
  message: string;
}

export interface StartAllParentsResponse {
  results: { parent_id: number; kid_name: string; status: string }[];
  total_scanned: number;
}

export interface ScheduleItem {
  kid_id: number;
  name: string;
  arrival_time_iso: string;
}

export const parentAdminApi = {
  /** All parents with kids, distances (no AI) */
  overview:           () => apiFetch<ParentAdminOverview>('/parent-admin/overview'),
  /** AI batch departure schedule */
  aiRecommendations:  () => apiFetch<AiScheduleResponse>('/parent-admin/ai-recommendations'),
  /** Instantly scan a single parent's kid (skip driving). autoStartPickup=false to defer pickup start. */
  startParent:        (parentId: number, autoStartPickup = true) => apiFetch<StartParentResponse>(`/parent-admin/start-parent/${parentId}?auto_start_pickup=${autoStartPickup}`, { method: 'POST' }),
  /** Instantly scan ALL parents' kids (bulk) */
  startAllParents:    () => apiFetch<StartAllParentsResponse>('/parent-admin/start-all-parents', { method: 'POST' }),
  /** Remove parents whose travel time exceeds max_minutes */
  pruneByTravelTime:  (maxMinutes = 5) => apiFetch<{ removed: number; kept: number; max_minutes: number }>(`/dev/prune-far-parents?max_minutes=${maxMinutes}`, { method: 'POST' }),
  /** Hand over optimized schedule to backend for autonomous arrivals */
  applySchedule:      (items: ScheduleItem[]) => apiFetch<{ status: string; count: number }>('/parent-admin/apply-schedule', { 
    method: 'POST', 
    body: JSON.stringify(items) 
  }),
};
// ───────────────────────────────────────────────────────────────────────────────

class ApiService {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
  }

  private async fetch(endpoint: string, options: RequestInit = {}) {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(this.token && { Authorization: `Bearer ${this.token}` }),
      ...options.headers,
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return response.json();
  }

  // Auth endpoints
  async login(email: string, password: string) {
    return this.fetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async logout() {
    return this.fetch('/auth/logout', { method: 'POST' });
  }

  // Parent endpoints
  async getParentProfile(parentId: string): Promise<Parent> {
    return this.fetch(`/parents/${parentId}`);
  }

  async updateParentProfile(parentId: string, data: Partial<Parent>): Promise<Parent> {
    return this.fetch(`/parents/${parentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Child endpoints
  async getChildren(parentId: string): Promise<Child[]> {
    return this.fetch(`/parents/${parentId}/children`);
  }

  async getChild(childId: string): Promise<Child> {
    return this.fetch(`/children/${childId}`);
  }

  // Queue endpoints
  async getQueueState(): Promise<QueueState> {
    return this.fetch('/queue/state');
  }

  async checkIn(childId: string, parentId: string): Promise<QueueEntry> {
    return this.fetch('/queue/checkin', {
      method: 'POST',
      body: JSON.stringify({ childId, parentId }),
    });
  }

  async getQueuePosition(entryId: string): Promise<number> {
    return this.fetch(`/queue/position/${entryId}`);
  }

  async completePickup(entryId: string): Promise<void> {
    return this.fetch(`/queue/complete/${entryId}`, {
      method: 'POST',
    });
  }

  async cancelCheckIn(entryId: string): Promise<void> {
    return this.fetch(`/queue/cancel/${entryId}`, {
      method: 'DELETE',
    });
  }

  // Admin endpoints
  async getAllQueueEntries(): Promise<QueueEntry[]> {
    return this.fetch('/admin/queue');
  }

  async updateQueueStatus(entryId: string, status: string): Promise<QueueEntry> {
    return this.fetch(`/admin/queue/${entryId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async sendNotification(recipientId: string, message: string): Promise<void> {
    return this.fetch('/admin/notifications', {
      method: 'POST',
      body: JSON.stringify({ recipientId, message }),
    });
  }

  async getStatistics() {
    return this.fetch('/admin/statistics');
  }

  // Notification endpoints
  async getNotifications(userId: string): Promise<Notification[]> {
    return this.fetch(`/notifications/${userId}`);
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    return this.fetch(`/notifications/${notificationId}/read`, {
      method: 'POST',
    });
  }
}

export default new ApiService();
