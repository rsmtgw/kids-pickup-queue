import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonIcon } from '@ionic/react';
import { playOutline, pauseOutline, refreshOutline } from 'ionicons/icons';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useDatabase, useKids as useDbKids } from '../services/databaseHooks';
import { scanApi, queueApi, aiApi, type QueueMetrics } from '../services/api';
import AiDashboard from './AiDashboard';
import './PickupVisualization.css';

// â”€â”€â”€ Scene Layout (px) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Scene Layout (px)
const SCENE_W        = 3450;  // school(772) + empty(2316=3×school) + Calz.road(170) + left margin(192)
const SCENE_H        = 900;   // 400px north Calzada above main road + 500px campus/lanes below
const ROAD_Y         = 400;   // main road center — 400px from top gives full visible N/S Calzada strip
const LANE_R_Y       = 815;   // right lane center  (was 490, +325)
const LANE_L_Y       = 773;   // left lane center   (was 448, +325)
const PICKUP_Y       = 735;   // y where cars nudge up to collect kid (was 410, +325)
const TURN_X         = 170;   // x where cars leave main road downward
const PILLAR_COUNT   = 5;
const PILLAR_X_START = 310;
const PILLAR_GAP     = 150;
const CAR_SPEED      = 90;
// X where Calzada Las Mitras (N/S entry road) meets the main queueing road.
// Map proportion: empty ground = 3 × school width.
// School width = SCHOOL_RIGHT_X - SCHOOL_LEFT_X = 964 - 192 = 772px.
// Empty ground = 3 × 772 = 2316px  →  CALZ_X = 964 + 2316 = 3280.
// Calz. Las Mitras road width = 170px  →  SCENE_W = 3280 + 170 = 3450.
const CALZ_X         = 3280;
// Scan station sits just inside the main road entry — cars stop here right after turning.
const SCAN_X         = CALZ_X - 60;   // = 3220  (60px left of junction)
// School spans the FULL campus — left ramp edge to just past P5 cage.
// pillarX(5) = 310 + 4*150 = 910, cage right edge = 910 + 44 = 954 → add 10px padding.
const SCHOOL_LEFT_X  = TURN_X + 22;   // = 192
const SCHOOL_RIGHT_X = 964;            // covers all 5 pillars
// Empty ground: 964 → 3280 = 2316px (3× school)
// Scale bar: school width 772px ≈ 260ft real → 200ft ≈ 300px on screen (nearest round)
const SCALE_BAR_PX   = 300;
// Spawn Y on Calzada: cars appear at the very top edge of the scene and drive south.
// Must be >= 0 so the inner scene (overflow:hidden) doesn't clip the car before it enters.
const CALZ_ENTRY_Y   = 10;    // 10px from scene top — fully visible, not clipped
const CAGE_TOP       = ROAD_Y + 22;          // top of holding cage
const CAGE_H         = 145;                  // cage height
const CAGE_BOTTOM    = CAGE_TOP + CAGE_H;    // = 242

const pillarX = (p: number) => PILLAR_X_START + (p - 1) * PILLAR_GAP;
const PER_PILLAR_QUEUE = 3;                  // kids kept ready in queue PER pillar at all times

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Number of active pickup lanes: 1 (left lane only) or 2 (both LANE_L_Y and LANE_R_Y).
// Controlled by VITE_PICKUP_LANES env var (default 1).
const PICKUP_LANES = parseInt(import.meta.env.VITE_PICKUP_LANES ?? '1', 10);
// Resolves which Y coordinate a car parks at based on its laneSlot.
const carLaneY = (c: { laneSlot: number }) => c.laneSlot === 1 ? LANE_R_Y : LANE_L_Y;
// Y where cars cruise after descending the ramp.
// Single-lane: land directly in the pickup lane (LANE_L_Y). Two-lane: land in through lane first.
const CRUISE_Y = PICKUP_LANES === 1 ? LANE_L_Y : LANE_R_Y;

type Phase =
  | 'waiting'          // parked on main road until "Start Pickup" is pressed
  | 'on-calz'          // travelling south on Calzada Las Mitras toward the main road junction
  | 'to-turn'
  | 'descending' | 'cruising' | 'lane-change'
  | 'collecting'       // car nudging to PICKUP_Y — kid boards
  | 'awaiting-confirm' // car at pillar, waiting for pillar manager to confirm
  | 'returning' | 'exiting';

interface Car {
  id: number;
  seq: number;     // sequence # assigned at scanner (0 = not yet scanned)
  kidId: number;   // id of kid called out at scanner (0 = none yet)
  kidName: string; // name of assigned kid ('' until scanned)
  x: number; y: number; rot: number;
  color: string;
  phase: Phase;
  wait: number;    // ticks to hold before next phase
  pillar: number;
  laneSlot: 0 | 1; // 0 = LANE_L_Y (left pickup lane), 1 = LANE_R_Y (right lane, active in 2-lane mode)
}

interface Kid {
  id: number;
  name: string;
  pillar: number;
  inCage: boolean;   // sitting in holding cage
  inQueue: boolean;  // called out, standing in queue at pillar
  boarding: boolean; // fading into car
}

// One colour per pillar (P1→P5). Cars, cage borders, posts and kid dots all use this.
const PILLAR_COLORS: Record<number, string> = {
  1: '#3880ff', // blue
  2: '#10dc60', // green
  3: '#f04141', // red
  4: '#ffce00', // yellow
  5: '#9b59f5', // purple
};
const TICK_MS    = 600;
const TRANS      = 0.54;

// 50 fallback names used when SQLite is unavailable (browser / dev environment)
const FALLBACK_KIDS = [
  'Emma Smith','Liam Johnson','Olivia Williams','Noah Brown','Ava Jones',
  'Ethan Garcia','Sophia Miller','Mason Davis','Isabella Rodriguez','William Martinez',
  'Mia Hernandez','James Lopez','Charlotte Gonzalez','Benjamin Wilson','Amelia Anderson',
  'Lucas Thomas','Harper Taylor','Henry Moore','Evelyn Jackson','Alexander Martin',
  'Abigail Lee','Michael Perez','Emily Thompson','Daniel White','Elizabeth Harris',
  'Jacob Sanchez','Sofia Clark','Logan Ramirez','Avery Lewis','Jackson Robinson',
  'Ella Walker','Sebastian Young','Scarlett Allen','Jack King','Grace Wright',
  'Aiden Scott','Chloe Torres','Owen Nguyen','Victoria Hill','Samuel Flores',
  'Riley Green','Matthew Adams','Aria Nelson','Joseph Baker','Lily Hall',
  'Levi Rivera','Aubrey Campbell','David Mitchell','Zoey Carter','John Roberts',
];

// Build visualization kids from DB records (or fallback list) — start hidden (inCage: false)
const buildVizKids = (source: { id?: number; name: string }[]): Kid[] =>
  source.map((k, i) => ({
    id: k.id ?? i + 1,
    name: k.name,
    pillar: 0,
    inCage: false, inQueue: false, boarding: false,
  }));

const PickupVisualization: React.FC = () => {
  useDatabase(); // initialises the SQLite connection
  const { kids: dbKids, loading: dbLoading } = useDbKids();

  const [isPlaying, setIsPlaying]         = useState(false);
  const [isDone, setIsDone]               = useState(false);
  const [isPickupStarted, setIsPickupStarted] = useState(false);
  const [cars, setCars]                   = useState<Car[]>([]);
  const [kids, setKids]                   = useState<Kid[]>([]);
  const [queueCounts, setQueueCounts]     = useState({ waiting: 0, pickup: 0, done: 0 });
  // Ref mirror of queueCounts — always current inside async callbacks/closures
  const queueStatusRef = useRef({ waiting: 0, pickup: 0, done: 0 });
  const [queueMetrics, setQueueMetrics]   = useState<QueueMetrics | null>(null);
  const [selectedPillar, setSelectedPillar] = useState<number | null>(null);
  const [showRoadPopup, setShowRoadPopup]   = useState(false);
  const [vizNow, setVizNow]               = useState(Date.now());
  const scanTimesRef                        = useRef<Map<number, string>>(new Map());

  // Tick every second — drives the live wait timers on queue kid labels
  useEffect(() => {
    const iv = setInterval(() => setVizNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const formatVizElapsed = (kidId: number): string => {
    const iso = scanTimesRef.current.get(kidId);
    if (!iso) return '';
    const diff = Math.max(0, vizNow - new Date(iso).getTime());
    const totalSec = Math.floor(diff / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  /** Per-pillar timer — shows elapsed time since the OLDEST queued kid at that pillar was scanned */
  const getPillarTimer = (pillarKids: { id: number }[]): string => {
    let oldest = Infinity;
    for (const k of pillarKids) {
      const iso = scanTimesRef.current.get(k.id);
      if (iso) {
        const t = new Date(iso).getTime();
        if (t < oldest) oldest = t;
      }
    }
    if (oldest === Infinity) return '';
    const diff = Math.max(0, vizNow - oldest);
    const totalSec = Math.floor(diff / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // ── Logging ───────────────────────────────────────────────────────────────
  type LogEntry = { ts: string; level: 'info' | 'warn' | 'error'; msg: string };
  const logsRef       = useRef<LogEntry[]>([]);
  const [logLines, setLogLines]   = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs]   = useState(false);
  const [activeLogTab, setActiveLogTab] = useState<'ui' | 'backend'>('ui');
  const [backendLogs, setBackendLogs]   = useState<Array<{ ts: string; level: string; msg: string }>>([]);
  const logEndRef         = useRef<HTMLDivElement>(null);
  // Scroll wrapper ref — used to auto-pan to the Calzada entry so users see cars arrive
  const sceneScrollRef    = useRef<HTMLDivElement>(null);
  const heldDescendIds      = useRef(new Set<number>()); // dedupe gate-hold-descend warnings
  const heldEntryIds         = useRef(new Set<number>()); // dedupe gate-hold-entry warnings
  const pillarRequestedRef   = useRef(new Set<number>()); // kidIds for which assignPillar was called

  // Build viz kids whenever db kids load; fall back to hardcoded list in browser
  const initialVizKids = useMemo(() => {
    if (dbKids.length > 0) return buildVizKids(dbKids);
    if (!dbLoading) return buildVizKids(FALLBACK_KIDS.map((name, i) => ({ id: i + 1, name })));
    return [];
  }, [dbKids, dbLoading]);

  const nextId              = useRef(1);
  const carsRef             = useRef<Car[]>([]);
  const kidsRef             = useRef<Kid[]>([]);
  const seenScanIds         = useRef<Set<number>>(new Set());
  const pollTick            = useRef(0);
  const lastTickTimeRef     = useRef(0); // used to detect computer-lock gaps
  const carArrivedNotified  = useRef<Set<number>>(new Set());  // kidIds whose car-arrived was sent
  const carAwaitStartRef    = useRef<Map<number, number>>(new Map()); // kidId → timestamp when awaiting-confirm began
  const autoConfirmTimers   = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map()); // kidId → auto-confirm timeout
  const PICKUP_DELAY_S      = 10;
  // Set of kidIds cleared to enter the pickup lane (backend pickup queue)
  const pickupQueueIdsRef   = useRef<Set<number>>(new Set());
  // Kept for UI badge only — movement gating now uses pickupQueueIdsRef
  const isPickupStartedRef  = useRef(false);
  // Set to true between a reset() call and the moment the backend confirms it cleared.
  // The scan poll skips spawning while this is true to prevent re-spawn of stale records.
  const isResettingRef        = useRef(false);
  // Initialise (or re-initialise) when DB kids are ready
  useEffect(() => {
    if (dbLoading || initialVizKids.length === 0) return;
    kidsRef.current = initialVizKids;
    setKids(initialVizKids);
    setIsPlaying(true);
  }, [initialVizKids, dbLoading]);

  // ── Log helper: timestamped ring-buffer (max 500) ─────────────────────────
  const addLog = (level: 'info' | 'warn' | 'error', msg: string) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    const entry: LogEntry = { ts, level, msg };
    const next = [...logsRef.current.slice(-499), entry];
    logsRef.current = next;
    setLogLines(next);
    // Auto-scroll to bottom when log panel is open
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'auto' }), 30);
  };

  // Sync helper: update ref + setState together (avoids StrictMode double-invoke on refs)
  const setKidsSync = (updater: (prev: Kid[]) => Kid[]) => {
    const next = updater(kidsRef.current);
    kidsRef.current = next;
    setKids(next);
  };


  const handleReset = async () => {
    // Block the scan poll from re-spawning stale records while the backend clears.
    isResettingRef.current = true;

    nextId.current = 1;
    carsRef.current = [];
    carArrivedNotified.current.clear();
    carAwaitStartRef.current.clear();
    // Cancel all pending auto-confirm timers
    autoConfirmTimers.current.forEach(t => clearTimeout(t));
    autoConfirmTimers.current.clear();
    pickupQueueIdsRef.current.clear();
    heldDescendIds.current.clear();
    heldEntryIds.current.clear();
    pillarRequestedRef.current.clear();
    pollTick.current = 0;
    isPickupStartedRef.current = false;
    queueStatusRef.current = { waiting: 0, pickup: 0, done: 0 };
    logsRef.current = [];
    setLogLines([]);
    setBackendLogs([]);
    window.dispatchEvent(new CustomEvent('pickup-reset'));
    const source = dbKids.length > 0 ? dbKids : FALLBACK_KIDS.map((name, i) => ({ id: i + 1, name }));
    const freshKids = buildVizKids(source);
    kidsRef.current = freshKids;
    setCars([]);
    setKids(freshKids);
    setIsDone(false);
    setIsPickupStarted(false);
    setIsPlaying(true);

    // Wait for the backend to confirm the scan table is cleared before unblocking
    // the poll.  If the request fails (offline), clear anyway after a short delay.
    try {
      await scanApi.reset();
    } catch {
      // backend offline — continue anyway
    }
    // NOW safe to clear seenScanIds: the backend has no records left, so the
    // next poll will return an empty list and won't re-spawn old cars.
    seenScanIds.current.clear();
    scanTimesRef.current.clear();
    isResettingRef.current = false;
  };

  const [seedingDebug, setSeedingDebug] = useState(false);

  /** Seed 6 test scan records to reproduce queue hang with minimal data */
  const handleSeedDebugScans = async () => {
    setSeedingDebug(true);
    // 1) Reset everything first (awaited — ensures backend is clear before we seed)
    await handleReset();

    // 2) Pick 6 kids from the current visualization list so kid_id references are valid
    const pool = kidsRef.current.length >= 6
      ? kidsRef.current.slice(0, 6)
      : Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `Test Kid ${i + 1}` }));

    // 3) POST 6 scan records one by one (server assigns seq + pillar)
    for (let i = 0; i < pool.length; i++) {
      try {
        await scanApi.scan({ kid_id: pool[i].id, name: pool[i].name });
        addLog('info', `SEED  scan posted: kid_id=${pool[i].id} name='${pool[i].name}'`);
      } catch (e: any) {
        addLog('error', `SEED  failed for kid_id=${pool[i].id}: ${e?.message ?? e}`);
      }
      await new Promise(r => setTimeout(r, 80));
    }

    // 4) Wait for visualization poll to pick up the new scan records, then auto-start
    await new Promise(r => setTimeout(r, 1400));
    addLog('info', 'SEED  auto-starting pickup…');
    // Directly call the same logic as handleStartPickup
    carsRef.current
      .filter(c => c.seq > 0 && (c.phase === 'waiting' || c.phase === 'to-turn'))
      .forEach(c => pickupQueueIdsRef.current.add(c.kidId));
    try {
      const res = await queueApi.startPickup();
      res.pickup.forEach(r => pickupQueueIdsRef.current.add(r.kid_id));
    } catch { /* backend offline — local seed is sufficient */ }
    isPickupStartedRef.current = true;
    setIsPickupStarted(true);
    addLog('info', `SEED  done. localPickupIds=${pickupQueueIdsRef.current.size}  cars=${carsRef.current.length}`);
    setSeedingDebug(false);
  };

  const handleStartPickup = async () => {
    // Pillars are already assigned at scan time via the seq formula — nothing to remap.
    // This handler tells the backend to release the queue and seeds the local pickup-queue
    // ref so parked cars unblock on the next animation tick.
    //
    // IMPORTANT: always add ALL currently queued cars locally as a fallback.
    // The backend's startPickup response may omit some kid_ids (partial list), which
    // would cause the sequence gate to deadlock: seq#2 waits forever for seq#1 which
    // never leaves 'waiting' because it's not in pickupQueueIdsRef.
    carsRef.current
      .filter(c => c.seq > 0 && (c.phase === 'waiting' || c.phase === 'to-turn'))
      .forEach(c => pickupQueueIdsRef.current.add(c.kidId));

    try {
      const res = await queueApi.startPickup();
      // Also seed from backend response (covers any cars not yet in carsRef)
      res.pickup.forEach(r => pickupQueueIdsRef.current.add(r.kid_id));
    } catch { /* server offline — local seed above is sufficient */ }
    isPickupStartedRef.current = true;
    setIsPickupStarted(true);
    // Pan viewport to show Calzada entry so the user sees cars arriving from the main road
    sceneScrollRef.current?.scrollTo({ left: CALZ_X - 320, behavior: 'smooth' });
  };

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      lastTickTimeRef.current = Date.now();

      // Poll /api/scan every 2 ticks (~1.2 s)
      if (++pollTick.current >= 2) {
        pollTick.current = 0;
        scanApi.getAll()
          .then(records => {
            // While reset is in progress, the backend table may not be cleared yet.
            // Ignore all records until the reset resolves and seenScanIds is re-armed.
            if (isResettingRef.current) return;
            records.forEach(rec => {
              if (seenScanIds.current.has(rec.kid_id)) return;
              seenScanIds.current.add(rec.kid_id);
              scanTimesRef.current.set(rec.kid_id, rec.scanned_at);

              // Skip already-confirmed records (stale backend data from a previous session).
              // This prevents picked-up kids from re-spawning as ghost cars after a page
              // reload or when pickup is resumed without calling reset first.
              if (rec.picked_up) {
                addLog('info', `SKIP-SPAWN  #${rec.seq} ${rec.name} already picked_up — not re-spawning`);
                return;
              }

              // Pillar is NOT pre-assigned — it will be assigned dynamically when the car
              // reaches the scanner point (TURN_X).  Use pillar=0 as the sentinel.

              // Move kid into cage so queue promotion can pick them up.
              // pillar=0 means "not yet assigned" — updated when scanner assigns it.
              setKidsSync(ks => {
                const found = ks.some(k => k.id === rec.kid_id);
                if (found) {
                  return ks.map(k =>
                    k.id === rec.kid_id
                      ? { ...k, pillar: 0, inCage: true }
                      : k
                  );
                }
                // Kid missing from local list — insert on-the-fly
                addLog('warn', `KID-NOT-FOUND  kid_id=${rec.kid_id} name='${rec.name}' — adding dynamically`);
                return [...ks, {
                  id:       rec.kid_id,
                  name:     rec.name,
                  pillar:   0,
                  inCage:   true,
                  inQueue:  false,
                  boarding: false,
                }];
              });

              // Spawn car on Calzada Las Mitras — drives south, turns right onto main road.
              // Auto-scroll to show the Calzada entry on the first car spawn so the user
              // can see the car arriving from the main road and passing the scan station.
              if (carsRef.current.length === 0) {
                sceneScrollRef.current?.scrollTo({ left: CALZ_X - 320, behavior: 'smooth' });
              }
              const id = nextId.current++;
              const newCar: Car = {
                id,
                seq:     rec.seq,
                kidId:   rec.kid_id,
                kidName: rec.name,
                x: CALZ_X, y: CALZ_ENTRY_Y, rot: 90,  // facing south (rot=90)
                color:  '#94a3b8',   // neutral gray until pillar assigned at scanner
                phase:  'on-calz',
                wait:   0,
                pillar: 0,           // 0 = unassigned
                laneSlot: 0,
              };
              // If pickup is already running, immediately authorize this car so it
              // doesn't park at TURN_X and wait forever for a release that never comes.
              if (isPickupStartedRef.current) {
                pickupQueueIdsRef.current.add(rec.kid_id);
              }
              carsRef.current = [...carsRef.current, newCar];
              setCars(prev => [...prev, newCar]);
              addLog('info', `SPAWN  #${rec.seq} ${rec.name}  pillar=unassigned  kidId=${rec.kid_id}${isPickupStartedRef.current ? '  [auto-queued]' : ''}`);
            });
          })
          .catch(() => {});
        // Refresh pickup queue: only add new kidIds if pickup is already in progress
        // (prevents stale backend state from silently releasing parked cars early)
        if (isPickupStartedRef.current) {
          queueApi.getPickup()
            .then(pickupRecords => {
              const before = pickupQueueIdsRef.current.size;
              pickupRecords.forEach(r => pickupQueueIdsRef.current.add(r.kid_id));
              const added = pickupQueueIdsRef.current.size - before;
              if (added > 0)
                addLog('info', `PICKUP-QUEUE  +${added} kidIds now (total ${pickupQueueIdsRef.current.size})  ids=[${[...pickupQueueIdsRef.current].join(',')}]`);
            })
            .catch(() => {});
        }
        // Refresh queue status counts for the debug display
        queueApi.getStatus()
          .then((s: any) => {
            queueStatusRef.current = { waiting: s.waiting, pickup: s.pickup, done: s.done };
            setQueueCounts({ waiting: s.waiting, pickup: s.pickup, done: s.done });
            // Auto-start pickup when backend signals started (e.g. from Parent Admin)
            if (s.started && !isPickupStartedRef.current) {
              carsRef.current
                .filter(c => c.seq > 0 && (c.phase === 'waiting' || c.phase === 'to-turn'))
                .forEach(c => pickupQueueIdsRef.current.add(c.kidId));
              queueApi.getPickup()
                .then(pickupRecords => pickupRecords.forEach(r => pickupQueueIdsRef.current.add(r.kid_id)))
                .catch(() => {});
              isPickupStartedRef.current = true;
              setIsPickupStarted(true);
              addLog('info', 'AUTO-START-PICKUP  backend pickup started — releasing queued cars');
            }
          })
          .catch(() => {});
        // Refresh per-pillar throughput metrics
        aiApi.getMetrics().then(setQueueMetrics).catch(() => {});
        // Fetch backend logs (best-effort — silently ignore when server is offline)
        fetch('http://localhost:8000/api/logs?limit=150')
          .then(r => r.ok ? r.json() : [])
          .then((entries: Array<{ ts: string; level: string; msg: string }>) =>
            setBackendLogs(entries)
          )
          .catch(() => {});
      }

      // Handle cars in awaiting-confirm: notify arrival once, then poll for pickup confirmation
      const awaitingCars = carsRef.current.filter(c => c.phase === 'awaiting-confirm');
      awaitingCars.forEach(car => {
        if (!carArrivedNotified.current.has(car.kidId)) {
          carArrivedNotified.current.add(car.kidId);
          carAwaitStartRef.current.set(car.kidId, Date.now());
          scanApi.notifyCarArrived(car.kidId).catch(() => {});
          // Auto-confirm after PICKUP_DELAY_S seconds (mirrors PillarManager auto-pickup)
          const kidId = car.kidId;
          const kidName = car.kidName;
          const t = setTimeout(async () => {
            autoConfirmTimers.current.delete(kidId);
            try {
              const fresh = await scanApi.getById(kidId);
              if (fresh.picked_up) return; // already confirmed externally
            } catch { /* proceed with confirm */ }
            try {
              await scanApi.confirmPickup(kidId);
              addLog('info', `AUTO-CONFIRM  ${kidName.split(' ')[0]} picked up after ${PICKUP_DELAY_S}s`);
            } catch {
              addLog('warn', `AUTO-CONFIRM failed for ${kidName.split(' ')[0]}, will retry on next poll`);
            }
          }, PICKUP_DELAY_S * 1000);
          autoConfirmTimers.current.set(kidId, t);
          // Sequence-order check: is this the lowest-seq car still TRAVELING to a pillar?
          // Exclude 'awaiting-confirm' — those cars have already arrived at their pillar
          // in the correct order (enforced by batchReady gate).  Counting parked-but-
          // unconfirmed cars as "still in lane" causes false OUT-OF-ORDER warnings when
          // a lower-seq car sits at P1 waiting for its kid while a higher-seq car
          // legitimately arrives at a different pillar (e.g. P5) right after.
          const inFlight = carsRef.current
            .filter(c => c.kidId > 0 && (
              c.phase === 'lane-change' ||
              c.phase === 'cruising' || c.phase === 'descending'
            ))
            .map(c => c.seq);
          const minSeq = inFlight.length > 0 ? Math.min(...inFlight) : car.seq;
          const outOfOrder = car.seq > minSeq;
          addLog(
            outOfOrder ? 'warn' : 'info',
            `CAR-ARRIVED  #${car.seq} ${car.kidName.split(' ')[0]}  pillar=P${car.pillar}` +
            (outOfOrder ? `  ⚠️ OUT-OF-ORDER (seq #${minSeq} still in lane)` : '  ✓ in-order')
          );
        }
      });
      if (awaitingCars.length > 0) {
        Promise.all(awaitingCars.map(car =>
          scanApi.getById(car.kidId).catch(() => null)
        )).then(results => {
          const confirmedKidIds = new Set(
            results
              .filter((r): r is NonNullable<typeof r> => r !== null && r.picked_up)
              .map(r => r.kid_id)
          );
          if (confirmedKidIds.size === 0) return;
          // Clean up countdown tracking for confirmed kids
          confirmedKidIds.forEach(id => carAwaitStartRef.current.delete(id));
          // Transition confirmed cars to 'returning' and depart their kids
          setCars(prev => {
            const next = prev.map(c =>
              c.phase === 'awaiting-confirm' && confirmedKidIds.has(c.kidId)
                ? { ...c, phase: 'returning' as Phase, wait: 0 }
                : c
            );
            carsRef.current = next;
            return next;
          });
          // Depart confirmed kids from queue; check if all done
          setKidsSync(ks => {
            const updated = ks.map(k =>
              confirmedKidIds.has(k.id)
                ? { ...k, inQueue: false, boarding: false }
                : k
            );
            // Guard: only declare done when:
            //  1. No cars remain in the scene (carsRef empty)
            //  2. Backend queue is fully exhausted (no waiting or in-pickup kids)
            //     — prevents premature isDone when new cars haven't been spawned yet
            //     because the scan poll hasn't fired since the last batch exited.
            const noMoreCars   = carsRef.current.length === 0;
            const backlogClear = queueStatusRef.current.waiting === 0 &&
                                 queueStatusRef.current.pickup  === 0;
            if (noMoreCars && backlogClear && seenScanIds.current.size > 0) {
              const kidsAllDone = updated
                .filter(k => seenScanIds.current.has(k.id))
                .every(k => !k.inCage && !k.inQueue && !k.boarding);
              if (kidsAllDone) setTimeout(() => { setIsPlaying(false); setIsDone(true); }, 700);
            }
            return updated;
          });
        }).catch(() => {});
      }

      // Pre-compute boarding OUTSIDE setCars (StrictMode safe)
      // Kids only leave the queue when the pillar manager confirms — not here
      const boardingKidIds  = new Set<number>();

      carsRef.current.forEach(car => {
        if (car.wait === 0 && car.phase === 'lane-change' && car.kidId > 0)
          boardingKidIds.add(car.kidId);
      });

      if (boardingKidIds.size > 0)
        setKidsSync(ks => ks.map(k => boardingKidIds.has(k.id) ? { ...k, boarding: true } : k));

      // Promote caged kids into each pillar's queue independently.
      // Goal: keep at least PER_PILLAR_QUEUE kids queued at every pillar.
      // Sort candidates by car seq so the car with the lowest seq always gets
      // its kid promoted first (prevents the lane-change deadlock).
      {
        const kidSeqMap = new Map(carsRef.current.map(c => [c.kidId, c.seq]));
        const toPromoteIds: number[] = [];

        for (let p = 1; p <= PILLAR_COUNT; p++) {
          const inQueueForPillar = kidsRef.current.filter(k => k.pillar === p && k.inQueue).length;
          const slots = Math.max(0, PER_PILLAR_QUEUE - inQueueForPillar);
          if (slots === 0) continue;

          const candidates = kidsRef.current
            .filter(k => k.inCage && k.pillar === p)
            .sort((a, b) => (kidSeqMap.get(a.id) ?? 9999) - (kidSeqMap.get(b.id) ?? 9999))
            .slice(0, slots);

          candidates.forEach(k => toPromoteIds.push(k.id));
        }

        if (toPromoteIds.length > 0) {
          const promoteSet = new Set(toPromoteIds);
          setKidsSync(ks => ks.map(k =>
            promoteSet.has(k.id)
              ? { ...k, inCage: false, inQueue: true }
              : k
          ));
        }
      }

      // ── Pre-compute lane constraints OUTSIDE setCars (StrictMode safe) ──
      const MIN_GAP = 70; // px — slightly wider than a car

      // ══════════════════════════════════════════════════════════════════════
      //  UNIFIED L-SHAPED QUEUE
      //
      //  One sorted "main queue" covers the entire L-shaped approach road:
      //    Calzada Las Mitras (↓ south, increasing Y)
      //    + Main Road        (← west,  decreasing X)
      //
      //  distToRamp(car) = remaining distance until car reaches TURN_X:
      //    on-calz:           (ROAD_Y − y)  +  (CALZ_X − TURN_X)
      //    to-turn / waiting: (x − TURN_X)
      //
      //  mainQueue sorts ascending → index 0 = leader (closest to ramp).
      //  mainQueueMinDistMap[id] = aheadDist + MIN_GAP = minimum distance
      //  this car must keep from the ramp.  Converted back to maxY / minX
      //  inside the FSM cases below.
      // ══════════════════════════════════════════════════════════════════════
      const CALZ_ROAD_LEN = CALZ_X - TURN_X; // 3110 px — full west-leg length

      const distToRamp = (c: Car): number =>
        c.phase === 'on-calz'
          ? (ROAD_Y - c.y) + CALZ_ROAD_LEN
          : Math.max(0, c.x - TURN_X);

      const mainQueue = carsRef.current
        .filter(c => c.phase === 'on-calz' || c.phase === 'to-turn' || c.phase === 'waiting')
        .sort((a, b) => distToRamp(a) - distToRamp(b)); // index 0 = closest to ramp

      // Per-car minimum-distance constraint (= leader's dist + MIN_GAP).
      const mainQueueMinDistMap = new Map<number, number>(); // carId → min distToRamp
      for (let i = 1; i < mainQueue.length; i++) {
        mainQueueMinDistMap.set(mainQueue[i].id, distToRamp(mainQueue[i - 1]) + MIN_GAP);
      }

      // ── Ramp queue: descending cars (↓ increasing Y) ──────────────────────
      const rampQueue = carsRef.current
        .filter(c => c.phase === 'descending')
        .sort((a, b) => b.y - a.y); // highest y = most advanced (closest to CRUISE_Y)
      const maxYMap = new Map<number, number>(); // carId → max allowed y on ramp
      for (let i = 1; i < rampQueue.length; i++) {
        maxYMap.set(rampQueue[i].id, rampQueue[i - 1].y - MIN_GAP);
      }
      const rampTopClear =
        rampQueue.length === 0 || rampQueue[rampQueue.length - 1].y > ROAD_Y + MIN_GAP;

      // ── Ramp-bottom entry gate ─────────────────────────────────────────────
      // Only gates descending → cruising; does NOT block ramp-top admission.
      const entryPointClear = !carsRef.current.some(
        c => c.phase === 'cruising' && c.x < TURN_X + MIN_GAP
      );
      const readyToEnter = rampQueue
        .filter(c => c.y + CAR_SPEED >= CRUISE_Y)
        .sort((a, b) => a.seq - b.seq);
      const firstEntryId = entryPointClear && readyToEnter.length > 0
        ? readyToEnter[0].id : null;
      if (entryPointClear) heldEntryIds.current.clear();
      if (readyToEnter.length > 0 && firstEntryId === null) {
        readyToEnter.forEach(c => {
          if (!heldEntryIds.current.has(c.id)) {
            heldEntryIds.current.add(c.id);
            addLog('warn', `GATE-HOLD-ENTRY  #${c.seq} ${c.kidName.split(' ')[0]} waiting on ramp (entryPointClear=${entryPointClear})`);
          }
        });
      }

      // ── Ramp-admission gate: admit ONE to-turn car per tick onto the ramp ──
      // Only needs rampTopClear — entryPointClear is decoupled (gates ramp bottom only).
      // Include 'waiting' phase: a waiting car that just entered the pickup queue sits
      // near TURN_X (dist≈0) and should be admitted before a 'to-turn' car that's
      // further back — this preserves batch dispatch order (P5→P4→P3→P2→P1).
      const readyToDescend = mainQueue.filter(c =>
        (c.phase === 'to-turn' || c.phase === 'waiting') &&
        pickupQueueIdsRef.current.has(c.kidId) &&
        c.pillar !== 0
      );
      const admittedDescendId: number | null =
        rampTopClear && readyToDescend.length > 0
          ? readyToDescend[0].id
          : null;
      if (admittedDescendId !== null) {
        addLog('info', `GATE-DESCEND  admitting #${readyToDescend[0].seq} onto ramp (x=${Math.round(readyToDescend[0].x)} ramp=${rampQueue.length})`);
        heldDescendIds.current.clear();
        heldEntryIds.current.clear();
      } else if (readyToDescend.length > 0 && !heldDescendIds.current.has(readyToDescend[0].id)) {
        heldDescendIds.current.add(readyToDescend[0].id);
        addLog('warn', `GATE-HOLD-DESCEND  #${readyToDescend[0].seq} waiting (rampTopClear=${rampTopClear} entryPointClear=${entryPointClear})`);
      }

      // Ramp-bottom hold positions: cars that can't enter cruising yet
      // hold spaced MIN_GAP above CRUISE_Y so they don't pile up at the corner.
      // rampQueue is sorted highest-y-first (most advanced index 0).
      // Assign each waiting car a hold slot counting up from the bottom.
      const rampBottomHoldY = new Map<number, number>(); // carId → max y to hold at
      let holdSlot = 0;
      for (const rc of rampQueue) {
        if (rc.id === firstEntryId) continue; // this car IS entering — no hold
        if (rc.y + CAR_SPEED >= CRUISE_Y) {
          // car has reached (or nearly reached) the bottom — assign a hold slot
          rampBottomHoldY.set(rc.id, CRUISE_Y - (holdSlot + 1) * MIN_GAP);
          holdSlot++;
        }
      }

      // ── Lane queue: moving cars only (cruising + lane-change + exiting) ────
      // awaiting-confirm (parked) cars are intentionally excluded here — including
      // them would cap cruising cars targeting P3/P4/P5 behind parked P1/P2 cars,
      // causing a deadlock.  The per-car inline check in case 'cruising' handles
      // parked-car collisions correctly (only stops behind the car's OWN target pillar).
      // exiting cars ARE included: they move east at CAR_SPEED and a cruising car
      // must not overtake them.
      const laneQueue = carsRef.current
        .filter(c => c.phase === 'cruising' || c.phase === 'lane-change' || c.phase === 'exiting')
        .sort((a, b) => b.x - a.x); // highest x = most advanced
      const maxXMap = new Map<number, number>(); // carId → max allowed x in lane
      for (let i = 1; i < laneQueue.length; i++) {
        const ahead  = laneQueue[i - 1];
        const behind = laneQueue[i];
        if (behind.phase === 'cruising') {
          maxXMap.set(behind.id, Math.max(ahead.x - MIN_GAP, behind.x));
        }
      }
      // Pre-sort parked/slow lane cars for the inline cap below.
      // Include exiting cars: they start moving east after pickup and a cruising
      // car must stay MIN_GAP behind until the exiting car clears the area.
      const parkedLaneCars = carsRef.current
        .filter(c => c.phase === 'awaiting-confirm' || c.phase === 'collecting' || c.phase === 'returning' || c.phase === 'exiting')
        .sort((a, b) => a.x - b.x);

      // ── Per-pillar occupancy ───────────────────────────────────────────────
      const occupiedPillarSlots = new Set<string>(
        carsRef.current
          .filter(c => c.phase === 'lane-change' || c.phase === 'collecting' || c.phase === 'awaiting-confirm')
          .map(c => `${c.pillar}-${c.laneSlot}`)
      );

      // ── Exit-lane following-distance (returning / exiting) ─────────────────
      // Include cruising so exiting cars never drive through cars still moving east.
      const allPickupLaneLCars = carsRef.current
        .filter(c =>
          c.laneSlot === 0 && (
            c.phase === 'cruising' || c.phase === 'lane-change' ||
            c.phase === 'awaiting-confirm' ||
            c.phase === 'returning' || c.phase === 'exiting'
          )
        )
        .sort((a, b) => a.x - b.x);
      const leftLaneMaxXMapL = new Map<number, number>();
      for (let i = 0; i < allPickupLaneLCars.length - 1; i++) {
        const cur = allPickupLaneLCars[i];
        const ahead = allPickupLaneLCars[i + 1];
        if (cur.phase === 'returning' || cur.phase === 'exiting') {
          leftLaneMaxXMapL.set(cur.id, Math.max(ahead.x - MIN_GAP, cur.x));
        }
      }
      const allPickupLaneRCars = carsRef.current
        .filter(c =>
          c.laneSlot === 1 && (
            c.phase === 'cruising' || c.phase === 'lane-change' ||
            c.phase === 'awaiting-confirm' ||
            c.phase === 'returning' || c.phase === 'exiting'
          )
        )
        .sort((a, b) => a.x - b.x);
      const leftLaneMaxXMapR = new Map<number, number>();
      for (let i = 0; i < allPickupLaneRCars.length - 1; i++) {
        const cur = allPickupLaneRCars[i];
        const ahead = allPickupLaneRCars[i + 1];
        if (cur.phase === 'returning' || cur.phase === 'exiting') {
          leftLaneMaxXMapR.set(cur.id, Math.max(ahead.x - MIN_GAP, cur.x));
        }
      }

      // Per-pillar lane-change gate
      const leftLaneDepartXsL = carsRef.current
        .filter(c => c.laneSlot === 0 && (c.phase === 'returning' || c.phase === 'exiting'))
        .map(c => c.phase === 'exiting' ? c.x + CAR_SPEED : c.x);
      const LANE_CHANGE_MARGIN = MIN_GAP * 2;
      const leftLaneClearForPillar = new Map<number, boolean>();
      for (let p = 1; p <= PILLAR_COUNT; p++) {
        const px = pillarX(p);
        const blocked = leftLaneDepartXsL.some(mx => Math.abs(mx - px) < LANE_CHANGE_MARGIN);
        leftLaneClearForPillar.set(p, !blocked);
      }

      // Batch coordination: car waits until all lower-seq batch-mates leave cruising
      const batchStart = (car: Car) =>
        Math.floor((car.seq - 1) / PILLAR_COUNT) * PILLAR_COUNT + 1;
      const cruisingSeqSet = new Set(
        carsRef.current.filter(c => c.phase === 'cruising').map(c => c.seq)
      );
      const hasCruisingLowerBatchMate = (car: Car): boolean => {
        const start = batchStart(car);
        for (let s = start; s < car.seq; s++) {
          if (cruisingSeqSet.has(s)) return true;
        }
        return false;
      };

      // Staggered parking slots for to-turn cars not yet in the pickup queue
      let waitingCount = carsRef.current.filter(c => c.phase === 'waiting').length;
      const parkingSlots = new Map<number, number>(); // carId → parked X
      carsRef.current.forEach(car => {
        if (car.phase === 'to-turn' && !pickupQueueIdsRef.current.has(car.kidId)) {
          if (car.x - CAR_SPEED <= TURN_X) {
            parkingSlots.set(car.id, TURN_X + waitingCount * 80);
            waitingCount++;
          }
        }
      });

      // ── Car movement: compute outside setCars to avoid StrictMode double-invoke ──
      // All side-effects (addLog, setKidsSync, carsRef mutation) happen here,
      // then we pass the already-computed value to setCars so the updater is pure.
      {
        const prev = carsRef.current;
        const mapped = prev.map((car): Car => {
          // ── Ramp-admission: clear any residual scan-station wait so the car can drive ──
          // Does NOT teleport — car drives at CAR_SPEED per tick toward TURN_X.
          // The actual phase transition to 'descending' happens in case 'to-turn' below
          // once the car physically arrives at TURN_X.
          if (
            car.phase === 'to-turn' &&
            admittedDescendId === car.id &&
            car.pillar !== 0 &&
            car.wait > 0
          ) {
            return { ...car, wait: 0 }; // clear wait, re-evaluated next tick at full speed
          }

          if (car.wait > 0) return { ...car, wait: car.wait - 1 };
          switch (car.phase) {

            // Parked on main road: resume driving to TURN_X when in pickup queue.
            // Does NOT teleport directly to the ramp — car stays visible on main road.
            // The excluded-from-roadOccupants fix above ensures newly-promoted cars
            // sprint at full CAR_SPEED without the chain constraint slowing them.
            case 'waiting':
              return pickupQueueIdsRef.current.has(car.kidId)
                ? { ...car, phase: 'to-turn' }
                : car;

            case 'to-turn': {
              const nx = car.x - CAR_SPEED;
              // Admitted car ignores following-distance — it has permission to proceed
              // to TURN_X regardless of the car behind it in the main queue.
              const rawMinDist = admittedDescendId === car.id ? 0 : (mainQueueMinDistMap.get(car.id) ?? 0);
              const minX = Math.min(TURN_X + rawMinDist, car.x);
              const clampedNx = Math.max(nx, minX);

              // ── Scan station: car stops at SCAN_X, initiates pillar assignment,
              //    then pauses for 5 ticks (~3 s) so the driver can read the display
              //    before the car moves on toward the turn ramp.
              if (car.x > SCAN_X && clampedNx <= SCAN_X) {
                if (!pillarRequestedRef.current.has(car.kidId)) {
                  pillarRequestedRef.current.add(car.kidId);
                  scanApi.assignPillar(car.kidId).then(rec => {
                    const p = rec.pillar;
                    const col = PILLAR_COLORS[p] ?? '#3880ff';
                    const laneSlot: 0 | 1 = PICKUP_LANES === 2 ? (rec.seq % 2 === 0 ? 1 : 0) : 0;
                    carsRef.current = carsRef.current.map(c =>
                      c.kidId === car.kidId ? { ...c, pillar: p, color: col, laneSlot } : c
                    );
                    setCars(cs => cs.map(c =>
                      c.kidId === car.kidId ? { ...c, pillar: p, color: col, laneSlot } : c
                    ));
                    setKidsSync(ks => ks.map(k =>
                      k.id === car.kidId ? { ...k, pillar: p } : k
                    ));
                    addLog('info', `PILLAR-ASSIGN  #${rec.seq} ${rec.name} → P${p} (scan station)`);
                  }).catch(() => {
                    pillarRequestedRef.current.delete(car.kidId);
                  });
                }
                // Snap to SCAN_X and hold for 5 ticks ≈ 3 s
                return { ...car, x: SCAN_X, wait: 5 };
              }

              if (clampedNx <= TURN_X) {
                // Not yet in pickup queue — park on main road
                if (!pickupQueueIdsRef.current.has(car.kidId)) {
                  const parkX = parkingSlots.get(car.id) ?? TURN_X;
                  return { ...car, x: parkX, phase: 'waiting' };
                }
                // Scan station hasn't responded yet — hold at TURN_X
                if (car.pillar === 0) return { ...car, x: TURN_X };
                // Admitted to ramp — physically arrived at TURN_X, start descending
                if (admittedDescendId === car.id) {
                  addLog('info', `RAMP-ENTER  #${car.seq} ${car.kidName.split(' ')[0]} x=${Math.round(car.x)}→${TURN_X}`);
                  return { ...car, wait: 0, x: TURN_X, y: ROAD_Y, rot: 270, phase: 'descending' };
                }
                // In queue but not yet admitted — hold at TURN_X
                return { ...car, x: TURN_X };
              }
              return { ...car, x: clampedNx };
            }
            case 'descending': {
              const ny = car.y + CAR_SPEED;
              // Vertical gap from ramp-queue following-distance
              const maxYFromGap = maxYMap.get(car.id) ?? CRUISE_Y;
              // Hold slot: if this car is waiting at the bottom for entry clearance,
              // cap it at its assigned hold position above CRUISE_Y to prevent piling up.
              const holdY = rampBottomHoldY.get(car.id);
              const maxY = holdY !== undefined ? Math.min(maxYFromGap, holdY) : maxYFromGap;
              const clampedY = Math.min(ny, maxY);
              if (clampedY >= CRUISE_Y) {
                if (car.id !== firstEntryId) return { ...car, y: Math.min(clampedY, maxY) };
                return { ...car, x: TURN_X, y: CRUISE_Y, rot: 360, phase: 'cruising' };
              }
              return { ...car, y: clampedY };
            }
            case 'cruising': {
              const tx = pillarX(car.pillar);
              const rawCap = maxXMap.get(car.id);
              let cap = rawCap !== undefined ? Math.max(rawCap, car.x) : Infinity;
              // Single-lane: stop behind EVERY parked car ahead — no overtaking.
              // Cars are dispatched in pillar order within a batch, so each car
              // naturally queues behind the one ahead and advances as it departs.
              for (const p of parkedLaneCars) {
                if (p.id === car.id) continue;
                if (p.x <= car.x) continue; // behind us
                const parkedCap = Math.max(p.x - MIN_GAP, car.x);
                if (parkedCap < cap) cap = parkedCap;
              }
              const nx = Math.min(car.x + CAR_SPEED, cap);

              if (nx >= tx) {
                // Pillar lane-slot occupied — hold back at a waiting spot
                if (occupiedPillarSlots.has(`${car.pillar}-${car.laneSlot}`)) {
                  const holdX = Math.min(tx - MIN_GAP, cap);
                  return { ...car, x: holdX };
                }
                const kidReady = kidsRef.current.find(k => k.id === car.kidId)?.inQueue ?? false;
                const batchReady = !hasCruisingLowerBatchMate(car);
                if (car.laneSlot === 1 || PICKUP_LANES === 1) {
                  // Already in correct pickup lane — no lane-change needed
                  return kidReady && batchReady
                    ? { ...car, x: tx, phase: 'awaiting-confirm', wait: 0 }
                    : { ...car, x: Math.min(tx, cap) };
                }
                // 2-lane mode, laneSlot=0: must nudge left into LANE_L — wait for lane-change clearance
                const leftClear = leftLaneClearForPillar.get(car.pillar) ?? true;
                return kidReady && leftClear && batchReady
                  ? { ...car, x: tx, phase: 'lane-change', wait: 1 }
                  : { ...car, x: Math.min(tx, cap) };
              }
              return { ...car, x: nx };
            }
            case 'lane-change':
              // Move into pickup lane — carLaneY keeps laneSlot=1 at LANE_R_Y
              return { ...car, y: carLaneY(car), phase: 'awaiting-confirm', wait: 0 };

            case 'collecting':
              // Safety fallback — should no longer be reached
              return { ...car, y: carLaneY(car), phase: 'awaiting-confirm', wait: 0 };

            case 'awaiting-confirm':
              return car; // stays until pillar manager presses "Confirm Pickup"

            case 'returning': {
              // Only move rightward when there is room ahead in this car's lane.
              const retLaneMap = car.laneSlot === 1 ? leftLaneMaxXMapR : leftLaneMaxXMapL;
              const retCap = retLaneMap.get(car.id) ?? Infinity;
              if (retCap <= car.x + MIN_GAP) return { ...car, y: carLaneY(car) }; // hold
              return { ...car, y: carLaneY(car), phase: 'exiting' };
            }

            case 'exiting': {
              // Follow distance: never drive closer than MIN_GAP to the car ahead.
              const exitLaneMap = car.laneSlot === 1 ? leftLaneMaxXMapR : leftLaneMaxXMapL;
              const rawCap = exitLaneMap.get(car.id);
              const cap = rawCap !== undefined ? Math.max(rawCap, car.x) : Infinity;
              return { ...car, x: Math.min(car.x + CAR_SPEED, cap) };
            }

            // ── Calzada Las Mitras entry: car travels south, turns right onto main road ──
            case 'on-calz': {
              const ny = car.y + CAR_SPEED;
              // Derive maxY from unified mainQueueMinDistMap.
              // rawMinDist ≥ aheadDist + MIN_GAP → car must stay rawMinDist px from ramp.
              // distToRamp for on-calz = (ROAD_Y - y) + CALZ_ROAD_LEN
              // → y ≤ ROAD_Y + CALZ_ROAD_LEN - rawMinDist
              const rawMinDist = mainQueueMinDistMap.get(car.id) ?? 0;
              const maxY = rawMinDist === 0
                ? ROAD_Y  // no follower constraint — proceed freely to junction
                : Math.max(car.y, ROAD_Y + CALZ_ROAD_LEN - rawMinDist);
              const clampedY = Math.min(ny, maxY);
              if (clampedY >= ROAD_Y) {
                // Reached junction — take right turn (west) onto main road.
                // No extra gate needed: mainQueueMinDistMap already holds this car
                // back while the just-turned car is within MIN_GAP of CALZ_X.
                addLog('info', `CALZ-TURN  #${car.seq} ${car.kidName} turned onto main road at x=${CALZ_X}`);
                return { ...car, x: CALZ_X, y: ROAD_Y, rot: 180, phase: 'to-turn', wait: 0 };
              }
              return { ...car, y: clampedY };
            }

            default: return car;
          }
        });
        const next = mapped.filter(car => car.x < SCENE_W + 80);
        // Release inQueue/boarding for any car leaving the scene (normal exit OR unexpected
        // SCENE-EXIT). Without this, a kid whose car exits before confirmation permanently
        // holds a per-pillar queue slot and blocks new promotions, stalling the simulation.
        const departedKidIds = new Set(
          mapped.filter(c => c.x >= SCENE_W + 80 && c.kidId > 0).map(c => c.kidId)
        );
        if (departedKidIds.size > 0) {
          setKidsSync(ks => ks.map(k =>
            departedKidIds.has(k.id)
              ? { ...k, inQueue: false, boarding: false }
              : k
          ));
        }
        // Log phase transitions and unexpected scene exits (exactly once — outside updater)
        prev.forEach(old => {
          const updated = mapped.find(c => c.id === old.id);
          if (!updated) return;
          if (updated.x >= SCENE_W + 80) {
            addLog('warn', `SCENE-EXIT  #${old.seq} ${old.kidName.split(' ')[0]} removed at phase=${old.phase} x=${Math.round(old.x)}`);
          } else if (updated.phase !== old.phase) {
            const flag = (updated.phase === 'exiting' || updated.phase === 'awaiting-confirm') ? '🎯' : '→';
            addLog('info', `PHASE  #${old.seq} ${old.kidName.split(' ')[0]}  ${old.phase} ${flag} ${updated.phase}`);
            // When a confirmed car departs, log pickup order
            if (old.phase === 'awaiting-confirm' && updated.phase === 'returning') {
              const stillAt = mapped
                .filter(c => c.phase === 'awaiting-confirm' && c.kidId > 0)
                .map(c => c.seq);
              const minStill = stillAt.length > 0 ? Math.min(...stillAt) : null;
              const oor = minStill !== null && old.seq > minStill;
              addLog(
                oor ? 'warn' : 'info',
                `PICKUP-DONE  #${old.seq} ${old.kidName.split(' ')[0]}  pillar=P${old.pillar}` +
                (oor
                  ? `  ⚠️ OUT-OF-ORDER (seq #${minStill} still waiting at pillar)`
                  : '  ✓ correct order')
              );
            }
          }
        });
        carsRef.current = next;
        setCars(next); // pure value — no double-invoke from StrictMode
      }
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [isPlaying]);

  // ── Wake-up recovery: re-sync state when screen is unlocked / tab re-focused ─
  // When the computer is locked or the tab is hidden, setInterval is suspended by
  // the browser.  On wake-up, we immediately re-poll the backend so any scans that
  // fired via the server-side heartbeat thread are picked up without delay.
  useEffect(() => {
    if (!isPlaying) return;
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const gapMs = Date.now() - lastTickTimeRef.current;
      if (gapMs < TICK_MS * 2) return; // short blur — ignore
      addLog('info', `WAKE-UP  tab visible after ${Math.round(gapMs / 1000)}s — re-syncing backend state`);
      // Trigger an immediate scan+queue poll on the very next tick.
      pollTick.current = 2;
      // Also fire the polls directly so new cars spawn without waiting for the next interval.
      scanApi.getAll()
        .then(records => {
          if (isResettingRef.current) return;
          records.forEach(rec => {
            if (seenScanIds.current.has(rec.kid_id)) return;
            if (rec.picked_up) return;
            seenScanIds.current.add(rec.kid_id);
            setKidsSync(ks => {
              const found = ks.some(k => k.id === rec.kid_id);
              if (found) return ks.map(k => k.id === rec.kid_id ? { ...k, pillar: 0, inCage: true } : k);
              return [...ks, { id: rec.kid_id, name: rec.name, pillar: 0, inCage: true, inQueue: false, boarding: false }];
            });
            const id = nextId.current++;
            const newCar: Car = {
              id, seq: rec.seq, kidId: rec.kid_id, kidName: rec.name,
              x: CALZ_X, y: CALZ_ENTRY_Y, rot: 90,
              color: '#94a3b8', phase: 'on-calz', wait: 0, pillar: 0, laneSlot: 0,
            };
            if (isPickupStartedRef.current) pickupQueueIdsRef.current.add(rec.kid_id);
            carsRef.current = [...carsRef.current, newCar];
            setCars(prev => [...prev, newCar]);
            addLog('info', `WAKE-SPAWN  #${rec.seq} ${rec.name}  kidId=${rec.kid_id}`);
          });
        })
        .catch(() => {});
      if (isPickupStartedRef.current) {
        queueApi.getPickup()
          .then(pickupRecords => pickupRecords.forEach(r => pickupQueueIdsRef.current.add(r.kid_id)))
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isPlaying]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Pickup Visualization</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="visualization-content">
        {/* DB loading banner */}
        {dbLoading && (
          <div style={{ padding: '6px 16px', background: '#3880ff22', color: '#3880ff', fontSize: 12 }}>
            Loading kids from database...
          </div>
        )}
        {!dbLoading && dbKids.length === 0 && (
          <div style={{ padding: '6px 16px', background: '#ffce0022', color: '#ffce00', fontSize: 12 }}>
            Server offline or no kids found. Using 50 demo kids. Start the backend and Reset to reload.
          </div>
        )}
        {/* Controls */}
        <div style={{ display: 'flex', gap: 8, padding: '8px 16px', alignItems: 'center', flexWrap: 'wrap' }}>
          <IonButton size="small" color={isPlaying ? 'warning' : 'success'}
            disabled={isDone}
            onClick={() => setIsPlaying(p => !p)}>
            <IonIcon icon={isPlaying ? pauseOutline : playOutline} slot="start" />
            {isDone ? 'Done' : isPlaying ? 'Pause' : 'Play'}
          </IonButton>

          {/* ── START PICKUP ── manual button + auto-detect from Parent Admin ── */}
          {!isPickupStarted && !isDone && (
            <IonButton size="small" color="tertiary" onClick={handleStartPickup}
              disabled={cars.filter(c => c.phase === 'waiting').length === 0}>
              Start Pickup
            </IonButton>
          )}
          {isPickupStarted && !isDone && (
            <span style={{
              background: '#10dc6022', color: '#10dc60',
              border: '1px solid #10dc6044', borderRadius: 6,
              padding: '4px 10px', fontSize: 12, fontWeight: 'bold',
            }}>Pickup in progress</span>
          )}

          <IonButton size="small" color="medium" onClick={handleReset}>
            <IonIcon icon={refreshOutline} slot="start" />
            Reset
          </IonButton>

          <IonButton
            size="small"
            color="warning"
            onClick={handleSeedDebugScans}
            disabled={seedingDebug}
            title="Reset + scan 6 test kids + auto-start pickup to reproduce queue hang"
          >
            {seedingDebug ? '⏳ Seeding…' : '🐞 Seed 6 Test Scans'}
          </IonButton>

          {/* ── Queue count debug badge ── */}
          <span style={{
            display: 'flex', gap: 6, alignItems: 'center',
            background: '#ffffff0d', borderRadius: 8, padding: '4px 10px',
            fontSize: 12, fontFamily: 'monospace',
          }}>
            <span style={{ color: '#ffce00' }}>⏳ Waiting: {queueCounts.waiting}</span>
            <span style={{ color: '#aaa' }}>|</span>
            <span style={{ color: '#3880ff' }}>🚗 Pickup: {queueCounts.pickup}</span>
            <span style={{ color: '#aaa' }}>|</span>
            <span style={{ color: '#10dc60' }}>✓ Done: {queueCounts.done}</span>
            <span style={{ color: '#aaa' }}>|</span>
            <span style={{ color: '#ff6b35' }}>🚦 Local pickup IDs: {pickupQueueIdsRef.current.size}</span>
          </span>
          {isDone && (
            <span style={{ color: '#10dc60', fontSize: 13, fontWeight: 'bold' }}>
              All scanned kids picked up!
            </span>
          )}
          {!isPickupStarted && cars.filter(c => c.phase === 'waiting').length > 0 && (
            <span style={{ fontSize: 12, color: '#ffce00', marginLeft: 4 }}>
              {cars.filter(c => c.phase === 'waiting').length} car(s) queued — press Start Pickup or use Parent Admin
            </span>
          )}
          {!isPickupStarted && cars.filter(c => c.phase === 'waiting').length === 0 && (
            <span style={{ fontSize: 12, color: '#888', marginLeft: 4 }}>
              Scan kids in the Scan tab, or use Parent Admin → Start All.
            </span>
          )}
        </div>

        {/* ── Queue sizes HUD strip ── */}
        {isPlaying && (
          <div style={{
            display: 'flex', gap: 6, padding: '3px 16px', alignItems: 'center',
            flexWrap: 'wrap', background: '#00000020', borderBottom: '1px solid #ffffff10',
            fontSize: 11, fontFamily: 'monospace',
          }}>
            <span style={{ color: '#888' }}>Queues:</span>
            {([
              { label: 'Calzada', count: cars.filter(c => c.phase === 'on-calz').length, color: '#60a5fa' },
              { label: 'Main road', count: cars.filter(c => c.phase === 'to-turn' || c.phase === 'waiting').length, color: '#a78bfa' },
              { label: 'Ramp', count: cars.filter(c => c.phase === 'descending').length, color: '#f59e0b' },
              { label: 'Lane', count: cars.filter(c => c.phase === 'cruising' || c.phase === 'lane-change').length, color: '#34d399' },
              { label: 'At pillar', count: cars.filter(c => c.phase === 'awaiting-confirm').length, color: '#f87171' },
              { label: 'Exiting', count: cars.filter(c => c.phase === 'returning' || c.phase === 'exiting').length, color: '#94a3b8' },
            ] as const).map(q => (
              <span key={q.label} style={{
                background: `${q.color}18`, border: `1px solid ${q.color}44`,
                borderRadius: 5, padding: '1px 7px', color: q.color,
              }}>
                {q.label}: <b>{q.count}</b>
              </span>
            ))}
          </div>
        )}

        {/* ── Throughput HUD strip ── */}
        {queueMetrics && (
          <div style={{
            display: 'flex', gap: 6, padding: '4px 16px', alignItems: 'center',
            flexWrap: 'wrap', background: '#ffffff08', borderBottom: '1px solid #ffffff12',
            fontSize: 11, fontFamily: 'monospace',
          }}>
            {/* Overall */}
            <span style={{
              background: '#3880ff22', border: '1px solid #3880ff44',
              borderRadius: 6, padding: '2px 8px', color: '#3880ff', fontWeight: 'bold',
            }}>
              ⚡ {queueMetrics.throughput_per_min.toFixed(2)} cars/min
            </span>
            <span style={{ color: '#666' }}>│</span>
            {/* Per-pillar breakdown */}
            {Array.from({ length: 5 }, (_, i) => i + 1).map(p => {
              const stat = queueMetrics.pillar_stats[`P${p}`];
              const color = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#c77dff'][p - 1];
              return (
                <span key={p} style={{
                  background: `${color}15`, border: `1px solid ${color}40`,
                  borderRadius: 6, padding: '2px 8px', color,
                }}>
                  P{p}: {stat ? stat.done : 0} done
                  {stat && stat.avg_pickup_sec > 0 ? ` · ${stat.avg_pickup_sec.toFixed(0)}s avg` : ''}
                  {stat && stat.waiting > 0 ? ` · ${stat.waiting} waiting` : ''}
                </span>
              );
            })}
            <span style={{ color: '#666' }}>│</span>
            <span style={{ color: '#aaa' }}>
              avg wait {(queueMetrics.avg_current_wait_sec / 60).toFixed(1)}min
            </span>
            <span style={{ color: '#aaa' }}>
              · avg pickup {queueMetrics.avg_pickup_time_sec.toFixed(0)}s
            </span>
            <span style={{ color: '#aaa' }}>
              · {queueMetrics.done}/{queueMetrics.total_scanned} done
            </span>
          </div>
        )}

        {/* ── AI Queue Optimizer Panel ── */}
        <AiDashboard />

        {/* 2-D Scene — horizontally scrollable so all zones render at true map proportions */}
        <div ref={sceneScrollRef} style={{ overflowX: 'auto', overflowY: 'auto', padding: '0 0 8px 0', maxHeight: '92vh' }}>
        {/* 2-D Scene */}
        <div style={{
          position: 'relative', width: SCENE_W, height: SCENE_H,
          background: '#1a1a2e', margin: '0 auto', borderRadius: 12, overflow: 'hidden',
          minWidth: SCENE_W,
        }}>

          {/* ── Ground layer (below all roads, lanes, cages) ── */}

          {/* School campus fill — LEFT side, aligns with real map */}
          <div style={{
            position: 'absolute',
            left: SCHOOL_LEFT_X,
            top: ROAD_Y + 22,
            width: SCHOOL_RIGHT_X - SCHOOL_LEFT_X,
            height: LANE_R_Y - (ROAD_Y + 22) + 18,
            background: '#1c2a1c',
            zIndex: 0,
          }} />
          {/* School building footprint — yellow border matching the map marking */}
          <div style={{
            position: 'absolute',
            left: SCHOOL_LEFT_X,
            top: ROAD_Y + 22,
            width: SCHOOL_RIGHT_X - SCHOOL_LEFT_X,
            height: CAGE_BOTTOM + 65 - (ROAD_Y + 22),
            border: '2px solid #ffc409cc',
            borderRadius: 4,
            background: 'transparent',
            boxShadow: '0 0 16px #ffc40930, inset 0 0 18px #ffc4090a',
            zIndex: 1,
            pointerEvents: 'none',
          }} />
          {/* School name tag — inside top-left of yellow border */}
          <div style={{
            position: 'absolute',
            left: SCHOOL_LEFT_X + 6,
            top: ROAD_Y + 26,
            color: '#ffc409ee',
            fontSize: 8,
            fontWeight: 'bold',
            letterSpacing: 0.8,
            zIndex: 2,
            userSelect: 'none',
            pointerEvents: 'none',
            textShadow: '0 0 8px #ffc40988',
          }}>CAMBRIDGE MONTERREY · Campus Dominio</div>

          {/* Empty / open ground — RIGHT of school, between school and Calz. Las Mitras */}
          <div style={{
            position: 'absolute',
            left: SCHOOL_RIGHT_X,
            top: ROAD_Y + 22,
            width: CALZ_X - SCHOOL_RIGHT_X,
            height: LANE_R_Y - (ROAD_Y + 22) + 18,
            background: 'repeating-linear-gradient(135deg,#22291a 0px,#22291a 8px,#1e2517 8px,#1e2517 16px)',
            borderLeft: '1px dashed #ffffff18',
            zIndex: 0,
          }} />
          {/* Empty ground label — centered in the empty strip */}
          <div style={{
            position: 'absolute',
            left: SCHOOL_RIGHT_X + Math.round((CALZ_X - SCHOOL_RIGHT_X) / 2) - 20,
            top: CAGE_TOP + 30,
            color: '#ffffff22',
            fontSize: 8,
            letterSpacing: 1.5,
            userSelect: 'none',
            pointerEvents: 'none',
            zIndex: 1,
            textAlign: 'center',
            width: 80,
          }}>EMPTY GROUND</div>

          {/* Main horizontal road — clickable to show waiting cars */}
          <div
            onClick={() => setShowRoadPopup(true)}
            title="Click to view cars on main road"
            style={{
            position: 'absolute', left: 0, top: ROAD_Y - 22, width: '100%', height: 44,
            background: '#3a3a3a', borderTop: '2px dashed #ffffff30', borderBottom: '2px dashed #ffffff30',
            cursor: 'pointer',
          }} />
          {/* Road centre dashes */}
          {Array.from({ length: 56 }).map((_, i) => (
            <div key={i} style={{
              position: 'absolute', top: ROAD_Y - 1, left: 60 + i * 62,
              width: 40, height: 2, background: '#ffffff40',
            }} />
          ))}
          <div style={{
            position: 'absolute', top: ROAD_Y - 38, left: 8,
            color: '#ffffff50', fontSize: 10, letterSpacing: 1,
          }}>MAIN ROAD -- cars queue here after scanning{!isPickupStarted ? ' (press Start Pickup or auto from Parent Admin)' : ''}</div>

          {/* Vertical connector (main road down to right lane) */}
          <div style={{
            position: 'absolute', left: TURN_X - 22, top: ROAD_Y, width: 44,
            height: LANE_R_Y - ROAD_Y + 18, background: '#3a3a3a',
          }} />
          {/* Vertical road label */}
          <div style={{
            position: 'absolute',
            left: TURN_X - 18,
            top: ROAD_Y + (LANE_L_Y - ROAD_Y) / 2 - 30,
            width: 12,
            color: '#ffffff40',
            fontSize: 8,
            letterSpacing: 1,
            fontWeight: 'bold',
            textAlign: 'center',
            lineHeight: 1.4,
            wordBreak: 'break-all',
            writingMode: 'vertical-rl' as React.CSSProperties['writingMode'],
            transform: 'rotate(180deg)',
            userSelect: 'none',
            pointerEvents: 'none',
          }}>ENTRY RAMP</div>

          {/* Left (pickup) lane */}
          <div style={{
            position: 'absolute', left: TURN_X, top: LANE_L_Y - 18,
            width: SCENE_W - TURN_X, height: 36,
            background: '#4a4a4a', borderTop: '1px solid #ffffff25',
          }} />
          {/* Right (through-traffic) lane */}
          <div style={{
            position: 'absolute', left: TURN_X, top: LANE_R_Y - 18,
            width: SCENE_W - TURN_X, height: 36,
            background: '#3a3a3a',
          }} />
          {/* Lane divider */}
          <div style={{
            position: 'absolute', left: TURN_X, top: LANE_L_Y + 18,
            width: SCENE_W - TURN_X, height: 2, background: '#ffce0060',
          }} />
          {/* Lane labels */}
          <div style={{
            position: 'absolute', top: LANE_L_Y - 36, left: TURN_X + 8,
            color: '#ffffff50', fontSize: 9, letterSpacing: 1,
          }}>LEFT LANE -- PICKUP</div>
          <div style={{
            position: 'absolute', top: LANE_R_Y + 20, left: TURN_X + 8,
            color: '#ffffff40', fontSize: 9, letterSpacing: 1,
          }}>{PICKUP_LANES === 2 ? 'RIGHT LANE -- PICKUP 2' : 'RIGHT LANE -- THROUGH TRAFFIC'}</div>

          {/* ── Calzada Las Mitras — north/south through road ── */}

          {/* ── NORTH extension: above main road, cars come from north heading south ── */}
          <div style={{
            position: 'absolute',
            left: CALZ_X,
            top: 0,
            width: SCENE_W - CALZ_X,
            height: ROAD_Y - 22,   // from scene top down to main-road top edge
            background: '#3a3a3a',
            borderLeft: '2px solid #ffffff22',
            zIndex: 2,
          }} />
          {/* North centre-line dashes */}
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={`calz-n-dash-${i}`} style={{
              position: 'absolute',
              left: CALZ_X + Math.round((SCENE_W - CALZ_X) / 2),
              top: 6 + i * 18,
              width: 2,
              height: 10,
              background: '#ffffff35',
              zIndex: 3,
            }} />
          ))}
          {/* ↓ entry arrows at the very top — cars approach from north heading south */}
          <div style={{
            position: 'absolute',
            left: CALZ_X + Math.round((SCENE_W - CALZ_X) / 2) - 14,
            top: 2,
            fontSize: 11,
            color: '#ffc409bb',
            fontWeight: 'bold',
            letterSpacing: 3,
            userSelect: 'none',
            zIndex: 4,
          }}>↓ ↓</div>
          {/* "from north" caption */}
          <div style={{
            position: 'absolute',
            left: CALZ_X + 4,
            top: 2,
            fontSize: 7,
            color: '#ffffff30',
            userSelect: 'none',
            whiteSpace: 'nowrap',
            zIndex: 4,
          }}>from north ↓</div>

          {/* Corner fill: the full main-road band at CALZ_X — connects north + south road sections */}
          <div style={{
            position: 'absolute',
            left: CALZ_X,
            top: ROAD_Y - 22,
            width: SCENE_W - CALZ_X,
            height: 44,
            background: '#3a3a3a',
            zIndex: 2,
          }} />
          {/* Right-turn marker: ↙ cars from north turn RIGHT (west) onto main road */}
          <div style={{
            position: 'absolute',
            left: CALZ_X + 4,
            top: ROAD_Y - 32,
            background: '#ffc40922',
            border: '1px solid #ffc40966',
            borderRadius: 6,
            padding: '2px 6px',
            fontSize: 9,
            fontWeight: 'bold',
            color: '#ffc409cc',
            whiteSpace: 'nowrap',
            userSelect: 'none',
            zIndex: 5,
          }}>↙ right turn → west</div>

          {/* ── SOUTH extension: below main road, road continues south ── */}
          <div style={{
            position: 'absolute',
            left: CALZ_X,
            top: ROAD_Y + 22,
            width: SCENE_W - CALZ_X,
            height: SCENE_H - (ROAD_Y + 22),
            background: '#3a3a3a',
            borderLeft: '2px solid #ffffff22',
            zIndex: 2,
          }} />
          {/* South centre-line dashes */}
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={`calz-s-dash-${i}`} style={{
              position: 'absolute',
              left: CALZ_X + Math.round((SCENE_W - CALZ_X) / 2),
              top: ROAD_Y + 50 + i * 68,
              width: 2,
              height: 40,
              background: '#ffffff35',
              zIndex: 3,
            }} />
          ))}
          {/* Road name label on south section — rotated */}
          <div style={{
            position: 'absolute',
            left: CALZ_X + Math.round((SCENE_W - CALZ_X) / 2) + 6,
            top: ROAD_Y + 80,
            fontSize: 8,
            fontWeight: 'bold',
            color: '#ffffff55',
            letterSpacing: 1.5,
            writingMode: 'vertical-rl' as React.CSSProperties['writingMode'],
            transform: 'rotate(180deg)',
            userSelect: 'none',
            pointerEvents: 'none',
            zIndex: 3,
          }}>CALZ. LAS MITRAS</div>
          {/* ↑ south-bound arrows + caption */}
          <div style={{
            position: 'absolute',
            left: CALZ_X + Math.round((SCENE_W - CALZ_X) / 2) - 10,
            bottom: 26,
            fontSize: 15,
            color: '#ffc40988',
            fontWeight: 'bold',
            letterSpacing: 2,
            userSelect: 'none',
            zIndex: 3,
          }}>↑</div>
          <div style={{
            position: 'absolute',
            left: CALZ_X + 4,
            bottom: 8,
            fontSize: 7,
            color: '#ffffff30',
            userSelect: 'none',
            whiteSpace: 'nowrap',
            zIndex: 3,
          }}>from south ↑</div>

          {/* Entry arrow on main road — just left of the junction */}
          <div style={{
            position: 'absolute', top: ROAD_Y - 14, left: SCAN_X - 80, color: '#ffffffaa', fontSize: 16,
          }}>Entry &lt;--</div>

          {/* ── Scale bar (bottom-right), matching map's 200 ft indicator ── */}
          <div style={{
            position: 'absolute', bottom: 10, left: CALZ_X + 4,
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
            userSelect: 'none', pointerEvents: 'none',
          }}>
            {/* Bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              <div style={{ width: 1, height: 8, background: '#ffffff60' }} />
              <div style={{ width: SCALE_BAR_PX, height: 3, background: '#ffffff60' }} />
              <div style={{ width: 1, height: 8, background: '#ffffff60' }} />
            </div>
            <div style={{ fontSize: 8, color: '#ffffff50', letterSpacing: 0.5 }}>200 ft</div>
          </div>

          {/* Scanner marker / scan station gate */}
          <div style={{
            position: 'absolute', left: SCAN_X - 56, top: ROAD_Y - 54,
            background: '#3880ff', color: '#fff', padding: '4px 10px',
            borderRadius: 6, fontSize: 11, fontWeight: 'bold', whiteSpace: 'nowrap',
            boxShadow: '0 0 10px #3880ff88',
          }}>SCAN STATION</div>
          {/* Vertical gate line spanning the full main road band */}
          <div style={{
            position: 'absolute', left: SCAN_X, top: ROAD_Y - 22,
            width: 2, height: 44, background: '#3880ffcc',
            boxShadow: '0 0 6px #3880ff99',
          }} />

          {/* Pillars */}
          {Array.from({ length: PILLAR_COUNT }).map((_, i) => {
            const p = i + 1;
            const px = pillarX(p);
            const pc = PILLAR_COLORS[p];           // pillar colour
            const cageKids  = kids.filter(k => k.pillar === p && k.inCage);
            const queueKids = kids.filter(k => k.pillar === p && k.inQueue).sort((a, b) => a.id - b.id);
            const pillarTimer = getPillarTimer([...cageKids, ...queueKids]);
            return (
              <div key={p}>
                {/* Cage box — clickable to open pillar popup */}
                <div
                  onClick={() => setSelectedPillar(p)}
                  title={`Click to view P${p} queue`}
                  style={{
                  position: 'absolute', left: px - 44, top: CAGE_TOP,
                  width: 88, height: CAGE_H,
                  border: `1.5px solid ${pc}88`,
                  borderRadius: 8, background: `${pc}11`,
                  display: 'flex', flexWrap: 'wrap',
                  alignContent: 'flex-start', padding: 5, gap: 4,
                  boxSizing: 'border-box',
                  cursor: 'pointer',
                  boxShadow: `0 0 8px ${pc}33`,
                }}>
                  {cageKids.map(kid => (
                    <div key={kid.id} style={{ textAlign: 'center', width: 22 }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%',
                        background: `${pc}99`, margin: '0 auto',
                        border: `1px solid ${pc}`,
                      }} />
                      <div style={{ fontSize: 7, color: '#ffffff77', marginTop: 1, whiteSpace: 'nowrap' }}>
                        {kid.name.substring(0, 4)}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Cage label */}
                <div style={{
                  position: 'absolute', left: px - 44, top: CAGE_TOP - 16,
                  color: pc, fontSize: 9, fontWeight: 'bold', letterSpacing: 1,
                  textShadow: `0 0 6px ${pc}88`,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>P{p} CAGE ({cageKids.length})
                  {pillarTimer && (
                    <span style={{
                      fontFamily: 'monospace',
                      fontSize: 10,
                      fontWeight: 'bold',
                      color: '#fff',
                      background: pc,
                      borderRadius: 4,
                      padding: '1px 5px',
                      letterSpacing: 0.5,
                      boxShadow: `0 0 8px ${pc}88`,
                    }}>{pillarTimer}</span>
                  )}
                </div>

                {/* Post */}
                <div style={{
                  position: 'absolute', left: px, top: CAGE_BOTTOM,
                  width: 3, height: (PICKUP_LANES === 2 ? LANE_R_Y : LANE_L_Y) - CAGE_BOTTOM + 18,
                  background: `linear-gradient(to bottom, ${pc}cc, ${pc}44)`,
                  borderRadius: 2,
                }} />

                {/* Queue */}
                {queueKids.length > 0 && (
                  <div style={{
                    position: 'absolute', left: px - 44, top: CAGE_BOTTOM + 4,
                    color: `${pc}99`, fontSize: 8, letterSpacing: 1,
                  }}>IN LINE ({queueKids.length})</div>
                )}
                {queueKids.map((kid, qi) => {
                  const topPos = PICKUP_Y - 42 - qi * 28;
                  return (
                    <div key={kid.id} style={{
                      position: 'absolute', left: px - 11, top: topPos, width: 22,
                      opacity: kid.boarding ? 0 : 1,
                      transform: kid.boarding ? 'scale(0.15) translateY(20px)' : 'scale(1)',
                      transition: 'top 0.4s ease, opacity 0.4s ease, transform 0.4s ease',
                      textAlign: 'center', zIndex: 6,
                    }}>
                      <div style={{
                        position: 'absolute', top: -5, right: -2,
                        background: qi === 0 ? pc : '#ffffff55',
                        color: '#fff', borderRadius: '50%',
                        width: 11, height: 11, fontSize: 7,
                        lineHeight: '11px', textAlign: 'center', fontWeight: 'bold',
                      }}>{qi + 1}</div>
                      <div style={{
                        width: 18, height: 18, borderRadius: '50%',
                        background: qi === 0 ? pc : `${pc}88`,
                        margin: '0 auto',
                        border: qi === 0 ? '2px solid #fffb' : '1px solid #fff3',
                        boxShadow: qi === 0 ? `0 0 8px ${pc}aa` : 'none',
                      }} />
                      <div style={{
                        fontSize: 7, color: qi === 0 ? '#fff' : '#fff9',
                        whiteSpace: 'nowrap', marginTop: 1,
                      }}>{kid.name.substring(0, 5)}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Moving cars */}
          {cars.map(car => {
            const firstName = car.kidName ? car.kidName.split(' ')[0].substring(0, 7) : '';
            // Compute 10-second countdown for cars awaiting confirmation
            let countdown: number | null = null;
            if (car.phase === 'awaiting-confirm') {
              const start = carAwaitStartRef.current.get(car.kidId);
              if (start !== undefined) {
                const elapsed = Math.floor((vizNow - start) / 1000);
                const remaining = PICKUP_DELAY_S - elapsed;
                countdown = remaining > 0 ? remaining : null;
              }
            }
            return (
              <div key={car.id} style={{
                position: 'absolute',
                left: car.x - 22,
                top:  car.y - 14,
                width: 44, height: 28,
                background: car.color,
                borderRadius: 5,
                transform: `rotate(${car.rot}deg)`,
                transition: `left ${TRANS}s linear, top ${TRANS}s linear, transform 0.3s ease`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 'bold', color: '#fff',
                boxShadow: `0 2px 8px ${car.color}88`,
                zIndex: Math.max(10, 100 - car.seq), // lower seq = higher zIndex = visually on top
                flexDirection: 'column', lineHeight: 1.2,
              }}>
                <span style={{ fontSize: 7, opacity: 0.8 }}>#{car.seq} P{car.pillar}</span>
                <span style={{ fontSize: 8, whiteSpace: 'nowrap', maxWidth: 42, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {firstName || '?'}
                </span>
                {/* Scan station badge — visible while car pauses at SCAN_X for pillar assignment */}
                {car.phase === 'to-turn' && car.x === SCAN_X && car.wait > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: -42,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#0d0d1e',
                    border: `2px solid ${
                      car.pillar > 0 ? (PILLAR_COLORS[car.pillar] ?? '#3880ff') : '#3880ff'
                    }`,
                    borderRadius: 6,
                    padding: '3px 8px',
                    fontSize: 10,
                    fontWeight: 'bold',
                    color: car.pillar > 0
                      ? (PILLAR_COLORS[car.pillar] ?? '#3880ff')
                      : '#3880ffcc',
                    whiteSpace: 'nowrap',
                    zIndex: 300,
                    boxShadow: '0 2px 8px #00000088',
                    pointerEvents: 'none',
                    letterSpacing: 0.5,
                  }}>
                    {car.pillar > 0
                      ? `◎ P${car.pillar} · #${car.seq}`
                      : '◎ Scanning…'}
                  </div>
                )}
                {/* 10-second countdown badge */}
                {countdown !== null && (
                  <div style={{
                    position: 'absolute',
                    top: -18,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: countdown <= 3 ? '#f04141' : '#ffce00',
                    color: countdown <= 3 ? '#fff' : '#000',
                    borderRadius: '50%',
                    width: 20,
                    height: 20,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 'bold',
                    boxShadow: '0 2px 6px #00000066',
                    zIndex: 200,
                    fontFamily: 'monospace',
                    animation: countdown <= 3 ? 'viz-countdown-pulse 0.5s ease-in-out infinite' : undefined,
                  }}>
                    {countdown}
                  </div>
                )}
              </div>
            );
          })}

          {/* All-done overlay */}
          {isDone && (
            <div style={{
              position: 'absolute', inset: 0,
              background: '#00000088',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              zIndex: 50,
            }}>
              <div style={{
                background: '#10dc60', color: '#fff',
                borderRadius: 16, padding: '24px 48px',
                textAlign: 'center',
                boxShadow: '0 8px 32px #10dc6088',
              }}>
                <div style={{ fontSize: 36 }}>All kids picked up!</div>
                <div style={{ fontSize: 14, marginTop: 8, opacity: 0.85 }}>
                  {seenScanIds.current.size} kids scanned today
                </div>
              </div>
            </div>
          )}

          {/* Count overlay */}
          <div style={{
            position: 'absolute', bottom: 8, right: 12,
            color: '#ffffff40', fontSize: 11,
          }}>
            Cars: {cars.length} | Scanned: {seenScanIds.current.size}
          </div>

          {/* ── Main road popup ── */}
          {showRoadPopup && (() => {
            const allCars = [...cars].sort((a, b) => a.seq - b.seq);
            const missingCount = seenScanIds.current.size - allCars.length;
            type Group = { label: string; color: string; bg: string; border: string; phases: Phase[] };
            const groups: Group[] = [
              { label: 'ON CALZADA',     color: '#ffc40999', bg: '#ffc40911',    border: '#ffc40933',   phases: ['on-calz'] },
              { label: 'ON MAIN ROAD',   color: '#ffce0099', bg: '#ffffff08',    border: 'transparent', phases: ['waiting', 'to-turn'] },
              { label: 'ENTERING RAMP',  color: '#ff6b3599', bg: '#ff6b3511',    border: '#ff6b3533',   phases: ['descending'] },
              { label: 'IN PICKUP LANE', color: '#10dc6099', bg: '#10dc6011',    border: '#10dc6033',   phases: ['cruising', 'lane-change'] },
              { label: 'AT PILLAR',      color: '#ffce00cc', bg: '#ffce0011',    border: '#ffce0033',   phases: ['collecting', 'awaiting-confirm'] },
              { label: 'DEPARTING',      color: '#7044ffcc', bg: '#7044ff11',    border: '#7044ff33',   phases: ['returning', 'exiting'] },
            ];
            const phaseLabel: Record<Phase, string> = {
              'on-calz': 'on Calzada', 'waiting': 'parked', 'to-turn': 'en route',
              'descending': 'ramp', 'cruising': 'cruising', 'lane-change': 'turning',
              'collecting': 'arriving', 'awaiting-confirm': 'waiting confirm',
              'returning': 'returning', 'exiting': 'exiting',
            };
            return (
              <div
                onClick={() => setShowRoadPopup(false)}
                style={{ position: 'absolute', inset: 0, zIndex: 40 }}>
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    position: 'absolute',
                    left: 8, top: ROAD_Y + 30,
                    width: 270,
                    background: '#1e1e3a',
                    border: '1.5px solid #3880ff88',
                    borderRadius: 12,
                    padding: 14,
                    boxShadow: '0 8px 32px #00000088',
                    zIndex: 41,
                    maxHeight: 440,
                    overflowY: 'auto',
                  }}>
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ color: '#3880ff', fontWeight: 'bold', fontSize: 13 }}>
                      All Cars ({allCars.length}/{seenScanIds.current.size} scanned)
                    </span>
                    <button
                      onClick={() => setShowRoadPopup(false)}
                      style={{ background: 'none', border: 'none', color: '#ffffff88', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>✕</button>
                  </div>

                  {/* Missing car warning */}
                  {missingCount > 0 && (
                    <div style={{
                      marginBottom: 8, padding: '4px 8px', borderRadius: 6,
                      background: '#f0414122', border: '1px solid #f0414155',
                      color: '#f04141', fontSize: 11, fontWeight: 'bold',
                    }}>
                      ⚠ {missingCount} car(s) not in scene — check logs!
                    </div>
                  )}

                  {/* Per-group sections */}
                  {groups.map(g => {
                    const group = allCars.filter(c => (g.phases as string[]).includes(c.phase));
                    if (group.length === 0) return null;
                    return (
                      <div key={g.label} style={{ marginBottom: 10 }}>
                        <div style={{ color: g.color, fontSize: 10, fontWeight: 'bold', marginBottom: 4, letterSpacing: 1 }}>
                          {g.label} ({group.length})
                        </div>
                        {group.map(c => (
                          <div key={c.id} style={{
                            display: 'flex', alignItems: 'center', gap: 7,
                            padding: '4px 6px', borderRadius: 6, marginBottom: 2,
                            background: g.bg, border: `1px solid ${g.border}`,
                          }}>
                            <div style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, background: c.color, border: '1px solid #ffffff44' }} />
                            <span style={{ fontSize: 11, color: '#ffffffaa', flex: 1 }}>#{c.seq} {c.kidName || '?'}</span>
                            <span style={{ fontSize: 9, color: g.color }}>
                              P{c.pillar} · {phaseLabel[c.phase]}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })}

                  {allCars.length === 0 && (
                    <div style={{ color: '#ffffff44', fontSize: 11, textAlign: 'center', padding: '8px 0' }}>
                      No cars in scene
                    </div>
                  )}

                  <div style={{ marginTop: 8, fontSize: 10, color: '#ffffff33', textAlign: 'center' }}>
                    Click anywhere to close
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── Pillar queue popup ── */}
          {selectedPillar !== null && (() => {
            const p = selectedPillar;
            const px = pillarX(p);
            const cageKids  = kids.filter(k => k.pillar === p && k.inCage);
            const queueKids = kids.filter(k => k.pillar === p && k.inQueue).sort((a, b) => a.id - b.id);
            const waitingCars = cars
              .filter(c => c.pillar === p && (c.phase === 'waiting' || c.phase === 'to-turn'))
              .sort((a, b) => a.seq - b.seq);
            const carAtPillar  = cars.find(c => c.pillar === p &&
              (c.phase === 'lane-change' || c.phase === 'collecting' || c.phase === 'awaiting-confirm'));
            // position popup: left of pillar if near right edge, else right
            const popupLeft = px > SCENE_W - 280 ? px - 260 : px + 56;
            return (
              <div
                onClick={() => setSelectedPillar(null)}
                style={{
                  position: 'absolute', inset: 0,
                  zIndex: 40,
                }}>
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    position: 'absolute',
                    left: Math.max(8, Math.min(popupLeft, SCENE_W - 240)),
                    top: CAGE_TOP - 8,
                    width: 230,
                    background: '#1e1e3a',
                    border: '1.5px solid #3880ff88',
                    borderRadius: 12,
                    padding: 14,
                    boxShadow: '0 8px 32px #00000088',
                    zIndex: 41,
                  }}>
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ color: '#3880ff', fontWeight: 'bold', fontSize: 13 }}>Pillar {p} Queue</span>
                    <button
                      onClick={() => setSelectedPillar(null)}
                      style={{
                        background: 'none', border: 'none', color: '#ffffff88',
                        fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: '0 2px',
                      }}>✕</button>
                  </div>

                  {/* Car status */}
                  <div style={{ marginBottom: 8, fontSize: 11, color: '#ffffff66' }}>
                    {carAtPillar
                      ? <span style={{ color: carAtPillar.phase === 'awaiting-confirm' ? '#ffce00' : '#10dc60' }}>
                          🚗 Car #{carAtPillar.seq} {carAtPillar.phase === 'awaiting-confirm' ? '— awaiting confirm' : '— arriving'}
                        </span>
                      : <span>🚗 No car at pillar</span>}
                  </div>

                  {/* Queue section */}
                  {queueKids.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ color: '#10dc6099', fontSize: 10, fontWeight: 'bold', marginBottom: 4, letterSpacing: 1 }}>
                        IN LINE ({queueKids.length})
                      </div>
                      {queueKids.map((kid, qi) => (
                        <div key={kid.id} style={{
                          display: 'flex', alignItems: 'center', gap: 7,
                          padding: '4px 6px', borderRadius: 6, marginBottom: 2,
                          background: qi === 0 ? '#10dc6022' : '#ffffff08',
                          border: qi === 0 ? '1px solid #10dc6044' : '1px solid transparent',
                        }}>
                          <div style={{
                            width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                            background: qi === 0 ? '#ffce00' : '#ffce0055',
                            border: qi === 0 ? '2px solid #fffb' : '1px solid #fff3',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 9, fontWeight: 'bold', color: '#1a1a2e',
                          }}>{qi + 1}</div>
                          <span style={{ fontSize: 11, color: qi === 0 ? '#fff' : '#ffffffaa', flex: 1 }}>
                            {kid.name}
                          </span>
                          {kid.boarding && <span style={{ fontSize: 9, color: '#10dc60' }}>boarding…</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Cage section */}
                  {cageKids.length > 0 && (
                    <div>
                      <div style={{ color: '#ffce0088', fontSize: 10, fontWeight: 'bold', marginBottom: 4, letterSpacing: 1 }}>
                        IN CAGE ({cageKids.length})
                      </div>
                      {cageKids.map(kid => (
                        <div key={kid.id} style={{
                          display: 'flex', alignItems: 'center', gap: 7,
                          padding: '3px 6px', borderRadius: 6, marginBottom: 2,
                          background: '#ffffff06',
                        }}>
                          <div style={{
                            width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                            background: '#ffce0055', border: '1px solid #ffce0044',
                          }} />
                          <span style={{ fontSize: 11, color: '#ffffff77' }}>{kid.name}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Waiting cars section */}
                  {waitingCars.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ color: '#ffce0099', fontSize: 10, fontWeight: 'bold', marginBottom: 4, letterSpacing: 1 }}>
                        WAITING ({waitingCars.length})
                      </div>
                      {waitingCars.map(c => (
                        <div key={c.id} style={{
                          display: 'flex', alignItems: 'center', gap: 7,
                          padding: '3px 6px', borderRadius: 6, marginBottom: 2,
                          background: '#ffffff06',
                        }}>
                          <div style={{
                            width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                            background: c.color, border: '1px solid #ffffff44',
                          }} />
                          <span style={{ fontSize: 11, color: '#ffffffaa', flex: 1 }}>
                            #{c.seq} {c.kidName || '?'}
                          </span>
                          <span style={{ fontSize: 9, color: '#ffce0099' }}>
                            {c.phase === 'waiting' ? 'parked' : 'en route'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {queueKids.length === 0 && cageKids.length === 0 && waitingCars.length === 0 && (
                    <div style={{ color: '#ffffff44', fontSize: 11, textAlign: 'center', padding: '8px 0' }}>
                      No kids assigned to this pillar
                    </div>
                  )}

                  <div style={{ marginTop: 10, fontSize: 10, color: '#ffffff33', textAlign: 'center' }}>
                    Click anywhere to close
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
        {/* close horizontal scroll wrapper */}
        </div>

        {/* ══ Log Panel ══════════════════════════════════════════════════════ */}
        <div style={{
          margin: '8px auto', width: SCENE_W, fontFamily: 'monospace', fontSize: 11,
        }}>
          <div
            onClick={() => setShowLogs(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: '#1e1e3a', borderRadius: showLogs ? '8px 8px 0 0' : 8,
              padding: '6px 14px', cursor: 'pointer',
              border: '1px solid #3880ff44',
            }}>
            <span style={{ color: '#3880ff', fontWeight: 'bold' }}>
              📋 App Logs &nbsp;
              <span style={{ color: '#ffffff66', fontWeight: 'normal' }}>
                {logLines.length} UI · {backendLogs.length} backend
              </span>
            </span>
            <span style={{ color: '#ffffff66' }}>{showLogs ? '▲ hide' : '▼ show'}</span>
          </div>

          {showLogs && (
            <div style={{
              background: '#0d0d1a', border: '1px solid #3880ff33',
              borderTop: 'none', borderRadius: '0 0 8px 8px',
            }}>
              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '1px solid #ffffff11' }}>
                {(['ui', 'backend'] as const).map(tab => (
                  <button key={tab}
                    onClick={() => setActiveLogTab(tab)}
                    style={{
                      flex: 1, padding: '6px 0', border: 'none',
                      background: activeLogTab === tab ? '#1e1e3a' : 'transparent',
                      color: activeLogTab === tab ? '#3880ff' : '#ffffff55',
                      fontWeight: activeLogTab === tab ? 'bold' : 'normal',
                      fontSize: 11, cursor: 'pointer', letterSpacing: 0.5,
                    }}>
                    {tab === 'ui'
                      ? `UI Events (${logLines.length})`
                      : `Backend (${backendLogs.length})`}
                  </button>
                ))}
                <button
                  onClick={() => {
                    logsRef.current = [];
                    setLogLines([]);
                    setBackendLogs([]);
                  }}
                  style={{
                    padding: '6px 14px', border: 'none',
                    background: 'transparent', color: '#ffffff33',
                    fontSize: 11, cursor: 'pointer',
                  }}>Clear</button>
              </div>
              {/* Entries */}
              <div style={{ height: 220, overflowY: 'auto', padding: '4px 8px' }}>
                {activeLogTab === 'ui' ? (
                  logLines.length === 0
                    ? <div style={{ color: '#ffffff33', padding: '8px 0', textAlign: 'center' }}>No events yet</div>
                    : logLines.map((e, i) => (
                        <div key={i} style={{
                          display: 'flex', gap: 6, padding: '1px 0',
                          borderBottom: '1px solid #ffffff08',
                          color: e.level === 'error' ? '#f04141'
                               : e.level === 'warn'  ? '#ffce00'
                               : '#ffffffcc',
                        }}>
                          <span style={{ color: '#ffffff33', flexShrink: 0 }}>{e.ts}</span>
                          <span style={{
                            flexShrink: 0, width: 36, fontWeight: 'bold',
                            color: e.level === 'error' ? '#f04141'
                                 : e.level === 'warn'  ? '#ffce00' : '#3880ff',
                          }}>{e.level.slice(0, 4).toUpperCase()}</span>
                          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{e.msg}</span>
                        </div>
                      ))
                ) : (
                  backendLogs.length === 0
                    ? <div style={{ color: '#ffffff33', padding: '8px 0', textAlign: 'center' }}>No backend logs (server may be offline)</div>
                    : backendLogs.map((e, i) => (
                        <div key={i} style={{
                          display: 'flex', gap: 6, padding: '1px 0',
                          borderBottom: '1px solid #ffffff08',
                          color: e.level === 'ERROR'   ? '#f04141'
                               : e.level === 'WARNING' ? '#ffce00' : '#a0d8ff',
                        }}>
                          <span style={{ color: '#ffffff33', flexShrink: 0 }}>{e.ts}</span>
                          <span style={{
                            flexShrink: 0, width: 36, fontWeight: 'bold',
                            color: e.level === 'ERROR'   ? '#f04141'
                                 : e.level === 'WARNING' ? '#ffce00' : '#10dc60',
                          }}>{e.level.slice(0, 4)}</span>
                          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{e.msg}</span>
                        </div>
                      ))
                )}
                <div ref={logEndRef} />
              </div>
            </div>
          )}
        </div>

      </IonContent>
    </IonPage>
  );
};

export default PickupVisualization;
