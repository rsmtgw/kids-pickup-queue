// ParentAdmin – map + list view for admin
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { IonContent, IonPage, IonHeader, IonToolbar, IonTitle } from '@ionic/react';
import {
  parentAdminApi, queueApi, smartScheduleApi, travelTimeApi,
  type ParentAdminOverview, type ParentAdminEntry,
  type AiScheduleResponse, type AiScheduleItem,
  type SmartScheduleResponse, type ScheduleItem,
} from '../services/api';
import './ParentAdmin.css';

/* ── Map defaults (used only if backend doesn't provide school_location) ─ */
const DEFAULT_SCHOOL_LAT = 33.4484;
const DEFAULT_SCHOOL_LNG = -112.0740;

/* ── Debug: 6 hardcoded Monterrey parent locations (remove after routing is confirmed) ─ */
const DEBUG_SCHOOL = { lat: 25.7591, lng: -100.4437 };  // dummy school ~1 km away
const DEBUG_PARENT_COORDS: [number, number, string][] = [
  [25.765278, -100.459806, 'Test Parent 1'],
  [25.765294, -100.459672, 'Test Parent 2'],
  [25.773669, -100.458067, 'Test Parent 3'],
  [25.772791, -100.462641, 'Test Parent 4'],
  [25.776341, -100.453651, 'Test Parent 5'],
  [25.778034, -100.450052, 'Test Parent 6'],
];

/* ── Route geometry utilities ────────────────────────────────────── */
function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const lat1 = a[0] * Math.PI / 180, lat2 = b[0] * Math.PI / 180;
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLng = (b[1] - a[1]) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Interpolate a position (lat,lng) at `frac` of the total route distance. */
function interpolateAlongRoute(pts: [number, number][], frac: number, school: { lat: number; lng: number }): [number, number] {
  if (pts.length === 0) return [school.lat, school.lng];
  if (pts.length === 1) return pts[0];
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = haversineM(pts[i - 1], pts[i]); segs.push(d); total += d; }
  let target = Math.min(1, Math.max(0, frac)) * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i]) {
      const t = segs[i] === 0 ? 0 : target / segs[i];
      return [pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])];
    }
    target -= segs[i];
  }
  return pts[pts.length - 1];
}

/** Return the sub-route starting at `frac` of total distance (remaining portion). */
function sliceRouteAfter(pts: [number, number][], frac: number, school: { lat: number; lng: number }): [number, number][] {
  if (pts.length < 2) return pts.length ? pts : [[school.lat, school.lng]];
  const cumDists: number[] = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { total += haversineM(pts[i - 1], pts[i]); cumDists.push(total); }
  const target = Math.min(1, Math.max(0, frac)) * total;
  for (let i = 1; i < pts.length; i++) {
    if (cumDists[i] >= target) {
      const segLen = cumDists[i] - cumDists[i - 1];
      const t = segLen === 0 ? 0 : (target - cumDists[i - 1]) / segLen;
      const interp: [number, number] = [pts[i-1][0] + t*(pts[i][0]-pts[i-1][0]), pts[i-1][1] + t*(pts[i][1]-pts[i-1][1])];
      return [interp, ...pts.slice(i)];
    }
  }
  return [pts[pts.length - 1]];
}

/* ════════════════════════════════════════════════════════════════════════════
   ParentsMapView — Leaflet map with real road routes, live movement + status filter
   ════════════════════════════════════════════════════════════════════════════ */

type MapFilter = 'all' | 'waiting' | 'scheduled' | 'en-route' | 'arrived';

const MAP_FILTERS: { key: MapFilter; emoji: string; label: string }[] = [
  { key: 'all',       emoji: '🗺️', label: 'All' },
  { key: 'waiting',   emoji: '⏸️', label: 'Waiting' },
  { key: 'scheduled', emoji: '🌊', label: 'Scheduled' },
  { key: 'en-route',  emoji: '🚗', label: 'En Route' },
  { key: 'arrived',   emoji: '✅', label: 'Arrived' },
];

const ParentsMapView: React.FC<{
  entries: ParentAdminEntry[];
  schedule: AiScheduleResponse | null;
  startedIds: Set<number>;
  enRouteIds: Set<number>;
  countdowns: Record<number, number>;
  schoolLocation?: { lat: number; lng: number } | null;
}> = ({ entries, schedule, startedIds, enRouteIds, countdowns, schoolLocation }) => {
  const mapRef        = useRef<HTMLDivElement>(null);
  const mapInstRef    = useRef<L.Map | null>(null);
  const initialFitDoneRef = useRef(false);
  const markersRef    = useRef<Record<number, L.Marker>>({});
  const routeLineRef  = useRef<Record<number, L.Polyline>>({});  // faint full route
  const remainLineRef = useRef<Record<number, L.Polyline>>({});  // vivid remaining portion
  const routesRef     = useRef<Record<number, [number, number][]>>({});  // OSRM geometry

  const [filter, setFilter] = useState<MapFilter>('all');
  const [counts, setCounts] = useState<Record<MapFilter, number>>(
    { all: 0, waiting: 0, scheduled: 0, 'en-route': 0, arrived: 0 }
  );
  const [routeStatus, setRouteStatus] = useState<'loading' | 'done'>('loading');

  const scheduleMap = useMemo(() => {
    const m: Record<number, AiScheduleItem> = {};
    schedule?.schedule?.forEach(s => (m[s.parent_id] = s));
    return m;
  }, [schedule]);

  /* ── Effect 1: init map tiles once ─────────────────────────────────────── */
  useEffect(() => {
    if (!mapRef.current || mapInstRef.current) return;
    const initSchool = schoolLocation ?? { lat: DEFAULT_SCHOOL_LAT, lng: DEFAULT_SCHOOL_LNG };
    const map = L.map(mapRef.current, { center: [initSchool.lat, initSchool.lng], zoom: 13 });
    mapInstRef.current = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const schoolIcon = L.divIcon({
      className: '',
      html: `<div style="width:42px;height:42px;background:#1e40af;border-radius:50%;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;font-size:22px">🏫</div>`,
      iconSize: [42, 42], iconAnchor: [21, 21],
    });
    L.marker([initSchool.lat, initSchool.lng], { icon: schoolIcon })
      .addTo(map)
      .bindPopup('<div style="font-family:sans-serif;font-weight:700;font-size:14px">🏫 School — Pickup Destination</div>');
    return () => { map.remove(); mapInstRef.current = null; };
  }, []);

  // Update map center and school marker when backend `schoolLocation` changes
  useEffect(() => {
    const map = mapInstRef.current;
    if (!map || !schoolLocation) return;
    try { map.setView([schoolLocation.lat, schoolLocation.lng]); } catch {}
    map.eachLayer((layer: any) => {
      try {
        if (layer?.getPopup && String(layer.getPopup()?.getContent()).includes('School')) {
          layer.setLatLng([schoolLocation.lat, schoolLocation.lng]);
        }
      } catch {}
    });
  }, [schoolLocation]);

  /* ── Effect 2: rebuild markers + fetch OSRM road routes when entries change ─ */
  /* NOTE: entries is memoized in ParentAdmin so this does NOT run every second.
     IMPORTANT: routesRef is NOT cleared on re-run — routes are cached across renders
     so the car never falls back to a straight line while an already-loaded route exists. */
  useEffect(() => {
    const map = mapInstRef.current;
    if (!map) return;

    Object.values(markersRef.current).forEach(m => m.remove());
    Object.values(routeLineRef.current).forEach(l => l.remove());
    Object.values(remainLineRef.current).forEach(l => l.remove());
    markersRef.current    = {};
    routeLineRef.current  = {};
    remainLineRef.current = {};
    // ⚠️  Do NOT clear routesRef.current — preserve OSRM geometry across overview refreshes
    // But DO remove stale routes for parent IDs that are no longer in the entries list
    const currentIds = new Set(entries.map(e => e.parent.id));
    for (const id of Object.keys(routesRef.current).map(Number)) {
      if (!currentIds.has(id)) delete routesRef.current[id];
    }

    const schoolLoc = schoolLocation ?? { lat: DEFAULT_SCHOOL_LAT, lng: DEFAULT_SCHOOL_LNG };
    console.log('[OSRM] Effect2 | schoolLoc=', schoolLoc, '| entries=', entries.length, '| cached routes=', Object.keys(routesRef.current).length);
    const bounds: [number, number][] = [[schoolLoc.lat, schoolLoc.lng]];
    for (const entry of entries) {
      const { location_lat: lat, location_lng: lng } = entry.parent;
      if (!lat || !lng) continue;
      bounds.push([lat, lng]);
      markersRef.current[entry.parent.id] = L.marker([lat, lng], {
        icon: L.divIcon({ className: '', html: '<div style="width:0;height:0"></div>', iconSize: [0, 0] }),
      }).addTo(map);
      routeLineRef.current[entry.parent.id]  = L.polyline([], { color: '#94a3b8', weight: 1.5, dashArray: '6 4', opacity: 0 }).addTo(map);
      remainLineRef.current[entry.parent.id] = L.polyline([], { color: '#2563eb', weight: 3.5, opacity: 0 }).addTo(map);
    }
    if (bounds.length > 1 && !initialFitDoneRef.current) {
      map.fitBounds(bounds, { padding: [35, 35] });
      initialFitDoneRef.current = true;
    }

    /* Fetch OSRM road routes — only for entries that don't already have a cached route */
    const validEntries = entries.filter(
      e => e.parent.location_lat && e.parent.location_lng && !routesRef.current[e.parent.id]
    );
    if (validEntries.length === 0) {
      setRouteStatus('done');
      return;
    }
    setRouteStatus('loading');
    const fetchRoutes = async () => {
      const BATCH = 20;
      for (let i = 0; i < validEntries.length; i += BATCH) {
        const batch = validEntries.slice(i, i + BATCH);
        await Promise.all(batch.map(async entry => {
          const { location_lat: lat, location_lng: lng } = entry.parent;
          try {
            const url = `http://localhost:8000/api/osrm-route?origin_lng=${lng}&origin_lat=${lat}&dest_lng=${schoolLoc.lng}&dest_lat=${schoolLoc.lat}`;
            console.log('[OSRM] fetching route for', entry.parent.name, '| url=', url);
            const res  = await fetch(url);
            if (!res.ok) {
              console.warn('[OSRM] FAILED', entry.parent.name, 'status=', res.status, res.statusText);
              return;
            }
            const data = await res.json();
            if (data.routes?.[0]?.geometry?.coordinates?.length > 0) {
              const pts = data.routes[0].geometry.coordinates.map(
                ([ln, la]: [number, number]) => [la, ln] as [number, number]
              );
              routesRef.current[entry.parent.id] = pts;
              console.log('[OSRM] SUCCESS', entry.parent.name, '| points=', pts.length);
            } else {
              console.warn('[OSRM] NO GEOMETRY', entry.parent.name, data);
            }
          } catch (err) {
            console.warn('[OSRM] ERROR', entry.parent.name, err);
          }
        }));
        if (i + BATCH < validEntries.length) await new Promise(r => setTimeout(r, 80));
      }
      setRouteStatus('done');
    };
    fetchRoutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  /* ── Effect 3: update marker icon / position / route lines (runs every second) ─ */
  useEffect(() => {
    const map = mapInstRef.current;
    if (!map) return;
    const newCounts: Record<MapFilter, number> = { all: entries.length, waiting: 0, scheduled: 0, 'en-route': 0, arrived: 0 };

    for (const entry of entries) {
      const marker     = markersRef.current[entry.parent.id];
      const routeLine  = routeLineRef.current[entry.parent.id];
      const remainLine = remainLineRef.current[entry.parent.id];
      if (!marker) continue;

      const tc      = entry.traffic_condition || 'unknown';
      const tcColor = tc === 'light' ? '#16a34a' : tc === 'moderate' ? '#d97706' : tc === 'heavy' ? '#dc2626' : '#64748b';
      const s           = scheduleMap[entry.parent.id];
      const isArrived   = startedIds.has(entry.parent.id);
      const isEnRoute   = enRouteIds.has(entry.parent.id);
      const cd          = countdowns[entry.parent.id];
      const hasSchedule = !!s;
      const isDepart    = !isArrived && !isEnRoute && cd !== undefined;

      if (isArrived)        newCounts.arrived++;
      else if (isEnRoute)   newCounts['en-route']++;
      else if (hasSchedule) newCounts.scheduled++;
      else                  newCounts.waiting++;

      // ── Marker appearance ───────────────────────────────────────────
      let bgColor: string, label: string, pulse = false, size = 26;
      if (isArrived)        { bgColor = '#16a34a'; label = '✓';          size = 28; }
      else if (isEnRoute)   { bgColor = '#2563eb'; label = '🚗';       pulse = true; size = 32; }
      else if (isDepart)    { bgColor = '#d97706'; label = s ? `W${s.wave}` : '⏱'; size = 28; }
      else if (hasSchedule) { bgColor = '#7c3aed'; label = `W${s.wave}`; size = 26; }
      else                  { bgColor = tcColor;   label = '•';          size = 22; }

      marker.setIcon(L.divIcon({
        className: '',
        html: `<div${pulse ? ' class="pa-map-pulse"' : ''} style="width:${size}px;height:${size}px;background:${bgColor};border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;font-size:${size > 28 ? 14 : 10}px;font-weight:700;color:#fff">${label}</div>`,
        iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      }));

      // ── Position + road route lines ─────────────────────────────────
      const homeLat    = entry.parent.location_lat;
      const homeLng    = entry.parent.location_lng;
      // Use real OSRM road geometry if available, else straight-line fallback
      const schoolLoc = schoolLocation ?? { lat: DEFAULT_SCHOOL_LAT, lng: DEFAULT_SCHOOL_LNG };
      const cachedRoute = routesRef.current[entry.parent.id];
      const routePts: [number, number][] = cachedRoute ?? [[homeLat, homeLng], [schoolLoc.lat, schoolLoc.lng]];
      if (isEnRoute && !cachedRoute) {
        console.warn('[OSRM] FALLBACK straight-line for', entry.parent.name, '| no cached route | schoolLoc=', schoolLoc);
      } else if (isEnRoute && cachedRoute) {
        console.log('[OSRM] using road route for', entry.parent.name, '| pts=', cachedRoute.length);
      }

      if (isArrived) {
        marker.setLatLng([schoolLoc.lat, schoolLoc.lng]);
        routeLine?.setStyle({ opacity: 0 });
        remainLine?.setStyle({ opacity: 0 });
      } else if (isEnRoute && cd !== undefined) {
        // Fractional progress along the route
        const totalSecs = (entry.travel_time_traffic_min ?? entry.est_drive_min ?? 5) * 60;
        const frac      = Math.min(1, Math.max(0, 1 - cd / Math.max(totalSecs, 1)));
        // Move marker along actual road
        marker.setLatLng(interpolateAlongRoute(routePts, frac, schoolLoc));
        // Faint gray = already-traveled portion (full route as background)
        routeLine?.setLatLngs(routePts);
        routeLine?.setStyle({ opacity: 0.2, color: '#94a3b8', weight: 2, dashArray: '6 4' });
        // Vivid blue = remaining road ahead
        const remaining = sliceRouteAfter(routePts, frac, schoolLoc);
        remainLine?.setLatLngs(remaining);
        remainLine?.setStyle({ opacity: 0.9, color: '#2563eb', weight: 4, dashArray: '0' });
      } else if (isDepart) {
        marker.setLatLng([homeLat, homeLng]);
        routeLine?.setLatLngs(routePts);
        routeLine?.setStyle({ opacity: 0.45, color: '#d97706', weight: 2, dashArray: '8 5' });
        remainLine?.setStyle({ opacity: 0 });
      } else if (hasSchedule) {
        marker.setLatLng([homeLat, homeLng]);
        routeLine?.setLatLngs(routePts);
        routeLine?.setStyle({ opacity: 0.3, color: '#7c3aed', weight: 1.5, dashArray: '6 4' });
        remainLine?.setStyle({ opacity: 0 });
      } else {
        marker.setLatLng([homeLat, homeLng]);
        routeLine?.setStyle({ opacity: 0 });
        remainLine?.setStyle({ opacity: 0 });
      }

      // ── Popup ─────────────────────────────────────────────────────
      const statusHtml = isArrived
        ? '<span style="color:#16a34a">✅ Arrived &amp; Scanned</span>'
        : isEnRoute
        ? `<span style="color:#2563eb">🚗 En Route${
            cd !== undefined ? ` · arrives in ${Math.floor(cd / 60)}:${String(cd % 60).padStart(2, '0')}` : ''}</span>`
        : isDepart
        ? `<span style="color:#d97706">⏱️ Departs in ${Math.floor(cd! / 60)}:${String(cd! % 60).padStart(2, '0')}</span>`
        : hasSchedule
        ? `<span style="color:#7c3aed">🌊 Wave ${s.wave} scheduled</span>`
        : '<span style="color:#64748b">⏸️ Idle / Waiting</span>';
      marker.bindPopup(`<div style="font-family:sans-serif;font-size:13px;min-width:205px;line-height:1.85">
        <strong style="font-size:14px">${entry.parent.name}</strong><br>
        <span style="color:#64748b;font-size:11px">${entry.parent.phone}</span>
        <hr style="margin:6px 0;border:none;border-top:1px solid #e2e8f0">
        📏 <strong>${entry.parent.distance_km} km</strong> from school<br>
        🕑 <strong>${entry.travel_time_traffic_min ?? entry.est_drive_min} min</strong> drive (with traffic)<br>
        ${tc !== 'unknown' ? `🚦 Traffic: <strong style="color:${tcColor}">${tc.charAt(0).toUpperCase() + tc.slice(1)}</strong><br>` : ''}
        ${s ? `🌊 Wave <strong>${s.wave}</strong> · leave in <strong>${s.leave_in_minutes} min</strong><br>` : ''}
        ${statusHtml}
      </div>`);

      // ── Filter visibility ────────────────────────────────────────────
      const visible =
        filter === 'all' ||
        (filter === 'arrived'   && isArrived) ||
        (filter === 'en-route'  && isEnRoute) ||
        (filter === 'scheduled' && hasSchedule && !isArrived && !isEnRoute) ||
        (filter === 'waiting'   && !hasSchedule && !isArrived && !isEnRoute);
      if (visible) { if (!map.hasLayer(marker)) marker.addTo(map); }
      else { if (map.hasLayer(marker)) marker.remove(); routeLine?.setStyle({ opacity: 0 }); remainLine?.setStyle({ opacity: 0 }); }
    }
    setCounts(newCounts);
  }, [entries, filter, startedIds, enRouteIds, countdowns, scheduleMap, routeStatus]);

  return (
    <div className="pa-map-wrap">
      {/* ── Filter bar ──────────────────────────────────────────────── */}
      <div className="pa-map-filterbar">
        {MAP_FILTERS.map(f => (
          <button key={f.key} className={`pa-map-filter-btn ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
            {f.emoji} {f.label}
            <span className="pa-map-filter-count">{counts[f.key]}</span>
          </button>
        ))}
        {routeStatus === 'loading' && (
          <span style={{ marginLeft: 6, fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="pa-spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Loading road routes…
          </span>
        )}
        <span className="pa-map-legend-group">
          <span className="pa-legend-dot" style={{ background: '#2563eb' }} /> En Route
          <span className="pa-legend-dot" style={{ background: '#7c3aed', marginLeft: 10 }} /> Scheduled
          <span className="pa-legend-dot" style={{ background: '#d97706', marginLeft: 10 }} /> Departing
          <span className="pa-legend-dot" style={{ background: '#16a34a', marginLeft: 10 }} /> Arrived
          <span className="pa-legend-dot" style={{ background: '#1e40af', marginLeft: 10 }} /> School
        </span>
      </div>
      <div ref={mapRef} className="pa-map-container" />
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════════
   Parent Admin — view all parents, distances, AI departure schedule,
   "Start All" to begin the recommended wave departures.
   ════════════════════════════════════════════════════════════════════════════ */

const ParentAdmin: React.FC = () => {
  const [viewMode,       setViewMode]       = useState<'list' | 'map'>('list');
  const [debugMode,      setDebugMode]      = useState(false);
  const [overview,       setOverview]       = useState<ParentAdminOverview | null>(null);
  const [schedule,       setSchedule]       = useState<AiScheduleResponse | null>(null);
  const [smartSchedule,  setSmartSchedule]  = useState<SmartScheduleResponse | null>(null);
  const [loading,        setLoading]        = useState(false);
  const [aiLoading,      setAiLoading]      = useState(false);
  const [smartLoading,   setSmartLoading]   = useState(false);
  const [refreshingTT,   setRefreshingTT]   = useState(false);
  const [started,     setStarted]     = useState(false);
  const [startedIds,  setStartedIds]  = useState<Set<number>>(new Set());       // parent_ids already scanned (pillar assigned)
  const [enRouteIds,  setEnRouteIds]  = useState<Set<number>>(new Set());       // parent_ids departed but not yet arrived
  const [startingId,  setStartingId]  = useState<number | null>(null);          // currently starting this parent
  const [startingAll, setStartingAll] = useState(false);
  const [pruning,     setPruning]     = useState(false);
  const [countdowns,     setCountdowns]     = useState<Record<number, number>>({});  // parent_id → secs until scan/arrival
  const [autoScanActive, setAutoScanActive] = useState(false);
  const [schoolLocation, setSchoolLocation] = useState<{ lat: number; lng: number } | null>(null);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutsRef   = useRef<Record<string | number, ReturnType<typeof setTimeout>>>({});
  const startTimeRef  = useRef<number>(0);
  const delaysRef     = useRef<Record<number, number>>({});       // parent_id → total secs until arrival (leave + drive)
  const departDelaysRef = useRef<Record<number, number>>({});     // parent_id → secs until departure
  const driveTimesRef = useRef<Record<number, number>>({});       // parent_id → drive time in secs
  const pickupStartedRef = useRef(false);                        // whether pickup queue has been started
  /* ── Fetch overview on mount ─────────────────────────────────────────── */
  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await parentAdminApi.overview();
      setOverview(res);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  // Fetch travel-time summary to obtain authoritative school_location from backend
  useEffect(() => {
    let mounted = true;
    travelTimeApi.summary().then(s => {
      if (!mounted) return;
      if (s?.school_location && typeof s.school_location.lat === 'number') {
        setSchoolLocation({ lat: s.school_location.lat, lng: s.school_location.lng });
      }
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  /* ── Cleanup timers on unmount ───────────────────────────────────────── */
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      Object.values(timeoutsRef.current).forEach(t => clearTimeout(t));
    };
  }, []);

  /* ── Reset when Visualization screen fires pickup-reset ─────────────── */
  useEffect(() => {
    const onReset = () => {
      // Clear all running timers
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      Object.values(timeoutsRef.current).forEach(t => clearTimeout(t));
      timeoutsRef.current = {};
      // Reset refs
      delaysRef.current       = {};
      departDelaysRef.current = {};
      driveTimesRef.current   = {};
      pickupStartedRef.current = false;
      startTimeRef.current    = 0;
      // Reset all state
      setSchedule(null);
      setSmartSchedule(null);
      setStarted(false);
      setStartedIds(new Set());
      setEnRouteIds(new Set());
      setStartingId(null);
      setStartingAll(false);
      setCountdowns({});
      setAutoScanActive(false);
      setOverview(null);
      // Re-fetch fresh overview from backend
      parentAdminApi.overview().then(ov => setOverview(ov)).catch(() => {});
    };
    window.addEventListener('pickup-reset', onReset);
    return () => window.removeEventListener('pickup-reset', onReset);
  }, []);

  /* ── Auto-refresh overview while scanning active ─────────────────────── */
  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => {
      parentAdminApi.overview().then(ov => setOverview(ov)).catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [started]);

  /* ── Fetch AI recommendations ────────────────────────────────────────── */
  const fetchAi = useCallback(async () => {
    setAiLoading(true);
    try {
      const res = await parentAdminApi.aiRecommendations();
      setSchedule(res);
      setSmartSchedule(null);
    } catch (e: any) {
      alert('AI error: ' + (e?.message ?? 'unknown'));
    }
    setAiLoading(false);
  }, []);

  /* ── Fetch Smart (traffic-aware, deterministic) schedule ─────────────── */
  const fetchSmartSchedule = useCallback(async () => {
    setSmartLoading(true);
    try {
      const res = await smartScheduleApi.getSchedule();
      setSmartSchedule(res);
      // Also set as the main schedule for "Start All" to use
      setSchedule({
        schedule: res.schedule,
        total_waves: res.total_waves,
        wave_interval_min: res.wave_interval_min,
        summary: res.summary,
        metrics: res.metrics,
        traffic_summary: res.traffic_summary,
        avg_travel_time_min: res.avg_travel_time_min,
        queue_pressure: res.queue_pressure,
        fallback: false,
      });
    } catch (e: any) {
      alert('Smart schedule error: ' + (e?.message ?? 'unknown'));
    }
    setSmartLoading(false);
  }, []);

  /* ── Prune parents with travel time > 5 min ────────────────────────────── */
  const handlePrune = useCallback(async () => {
    if (!window.confirm('Remove all parents whose travel time exceeds 5 minutes? This cannot be undone without re-seeding.')) return;
    setPruning(true);
    try {
      const res = await parentAdminApi.pruneByTravelTime(5);
      alert(`✂️ Pruned ${res.removed} parents. ${res.kept} parents remaining.`);
      const ov = await parentAdminApi.overview();
      setOverview(ov);
      setSchedule(null);
      setSmartSchedule(null);
    } catch (e: any) {
      alert('Prune error: ' + (e?.message ?? 'unknown'));
    }
    setPruning(false);
  }, []);

  /* ── Refresh travel times for all parents ────────────────────────────── */
  const refreshTravelTimes = useCallback(async () => {
    setRefreshingTT(true);
    try {
      await travelTimeApi.refreshAll();
      // Reload overview to get updated travel times
      const ov = await parentAdminApi.overview();
      setOverview(ov);
    } catch (e: any) {
      alert('Travel time refresh error: ' + (e?.message ?? 'unknown'));
    }
    setRefreshingTT(false);
  }, []);



  /* ── Start a single parent (auto-scan their kid) ─────────────────────── */
  const handleStartParent = useCallback(async (parentId: number) => {
    setStartingId(parentId);
    try {
      await parentAdminApi.startParent(parentId);
      setStartedIds(prev => new Set(prev).add(parentId));
      setEnRouteIds(prev => { const n = new Set(prev); n.delete(parentId); return n; });
      // Cancel scheduled arrival+departure timeouts if parent manually started
      if (timeoutsRef.current[parentId]) {
        clearTimeout(timeoutsRef.current[parentId]);
        delete timeoutsRef.current[parentId];
      }
      if (timeoutsRef.current[`depart_${parentId}`]) {
        clearTimeout(timeoutsRef.current[`depart_${parentId}`]);
        delete timeoutsRef.current[`depart_${parentId}`];
      }
      delete delaysRef.current[parentId];
      setCountdowns(prev => { const n = { ...prev }; delete n[parentId]; return n; });
      const res = await parentAdminApi.overview();
      setOverview(res);
    } catch (e: any) {
      alert('Start error: ' + (e?.message ?? 'unknown'));
    }
    setStartingId(null);
  }, []);

  /* ── Start All (timed auto-scan via backend autonomous loop) ───────────── */
  /*
   * REFACTORED: Instead of using frontend setTimeout (which pauses when app is backgrounded/
   * device locks), we now: 
   *   1. Compute absolute ISO arrival timestamps.
   *   2. POST them to /api/parent-admin/apply-schedule.
   *   3. The backend heartbeat thread fires scan_kid() at the right moment — server-driven.
   *   4. Frontend only maintains display countdowns (for UI), not actual scan triggers.
   *
   * Departure "en-route" markers still use a local setTimeout since they're purely cosmetic.
   */
  const handleStartAll = useCallback(async () => {
    if (!schedule || !overview) { alert('Please generate AI Schedule first!'); return; }

    setStartingAll(true);
    setStarted(true);
    setAutoScanActive(true);

    const items = schedule.schedule;
    const minLeave = Math.min(...items.map(s => s.leave_in_minutes));
    const nowMs = Date.now();

    // Look up drive time for each parent:
    // Priority: schedule item's traffic-aware time → overview traffic time → est_drive_min
    const driveLookup: Record<number, number> = {};
    const scheduleItemMap: Record<number, AiScheduleItem> = {};
    for (const item of items) scheduleItemMap[item.parent_id] = item;
    for (const entry of overview.parents) {
      const schedItem = scheduleItemMap[entry.parent.id];
      driveLookup[entry.parent.id] = schedItem?.travel_time_traffic_min
        ?? entry.travel_time_traffic_min
        ?? entry.est_drive_min;
    }

    // Build per-parent timing:
    //   departSecs  = (leave_in_minutes - minLeave) * 60   → when they leave home
    //   driveSecs   = est_drive_min * 60                   → how long to drive
    //   arrivalSecs = departSecs + driveSecs               → when they arrive & get scanned
    const arrivalDelays:  Record<number, number> = {};  // parent_id → secs until arrival
    const departDelays:   Record<number, number> = {};  // parent_id → secs until departure
    const driveTimes:     Record<number, number> = {};  // parent_id → drive secs
    timeoutsRef.current = {};
    pickupStartedRef.current = false;

    // Build the schedule payload for the backend   
    const backendScheduleItems: ScheduleItem[] = [];

    for (const item of items) {
      const parent = overview.parents.find(p => p.parent.id === item.parent_id);
      if (!parent) continue;

      const departSecs  = Math.round((item.leave_in_minutes - minLeave) * 60);
      const driveSecs   = Math.round((driveLookup[item.parent_id] ?? 2) * 60);
      const arrivalSecs = departSecs + driveSecs;

      departDelays[item.parent_id]  = departSecs;
      driveTimes[item.parent_id]    = driveSecs;
      arrivalDelays[item.parent_id] = arrivalSecs;

      // Compute absolute UTC ISO arrival timestamp for the backend
      const arrivalMs  = nowMs + arrivalSecs * 1000;
      const arrivalIso = new Date(arrivalMs).toISOString().replace('T', 'T').slice(0, 19);
      
      backendScheduleItems.push({
        kid_id: parent.kid.kid_id,
        name: parent.kid.kid_name,
        arrival_time_iso: arrivalIso,
      });

      // Departure marker: still cosmetic-only, so a local setTimeout is fine
      const departTimeout = setTimeout(() => {
        setEnRouteIds(prev => new Set(prev).add(item.parent_id));
      }, departSecs * 1000);
      timeoutsRef.current[`depart_${item.parent_id}`] = departTimeout;

      // Arrival marker: update UI when we expect arrival (based on countdown reaching 0)
      const arrivalTimeout = setTimeout(() => {
        setStartedIds(prev => new Set(prev).add(item.parent_id));
        setEnRouteIds(prev => { const n = new Set(prev); n.delete(item.parent_id); return n; });
      }, arrivalSecs * 1000);
      timeoutsRef.current[item.parent_id] = arrivalTimeout;
    }

    // Send schedule to backend for server-side autonomous arrival processing
    try {
      const result = await parentAdminApi.applySchedule(backendScheduleItems);
      console.log(`[AUTONOMOUS] Schedule sent to backend: ${result.count} arrivals queued`);
      // Start the pickup queue so the first backend scan immediately enters pickup
      await queueApi.startPickup();
    } catch (e: any) {
      alert('Failed to send autonomous schedule to backend: ' + (e?.message ?? 'unknown'));
      setStartingAll(false);
      setAutoScanActive(false);
      return;
    }

    startTimeRef.current   = nowMs;
    delaysRef.current       = arrivalDelays;
    departDelaysRef.current = departDelays;
    driveTimesRef.current   = driveTimes;

    // Initialize countdown display (secs until arrival for each parent)
    const cds: Record<number, number> = {};
    for (const [pid, delay] of Object.entries(arrivalDelays)) {
      cds[Number(pid)] = delay;
    }
    setCountdowns(cds);

    // Start 1-second display ticker for countdowns
    // Shows departure countdown for waiting parents, arrival countdown for en-route parents
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const newCds: Record<number, number> = {};

      for (const [pidStr, arrDelay] of Object.entries(delaysRef.current)) {
        const pid = Number(pidStr);
        const arrRemaining = arrDelay - elapsed;
        if (arrRemaining > 0) {
          // If parent hasn't departed yet, show time until departure
          const depDelay = departDelaysRef.current[pid] ?? 0;
          const depRemaining = depDelay - elapsed;
          if (depRemaining > 0) {
            newCds[pid] = depRemaining;   // countdown to departure
          } else {
            newCds[pid] = arrRemaining;   // countdown to arrival
          }
        }
      }

      setCountdowns(newCds);

      if (Object.keys(newCds).length === 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setAutoScanActive(false);
      }
    }, 1000);

    setStartingAll(false);
  }, [schedule, overview]);

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  const maxDist = overview ? Math.max(...overview.parents.map(p => p.parent.distance_km), 1) : 20;

  function scheduleForParent(parentId: number): AiScheduleItem | undefined {
    return schedule?.schedule?.find(s => s.parent_id === parentId);
  }

  function waveCls(w: number): string {
    if (w <= 5) return `wave-${w}`;
    return 'wave-default';
  }

  function fmtCountdown(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /* sort parents by wave then leave_in_minutes if schedule exists, else by distance */
  /* Memoized so map receives stable reference — prevents fitBounds on every countdown tick */
  const sortedParents = useMemo<ParentAdminEntry[]>(() => {
    if (!overview) return [];
    return [...overview.parents].sort((a, b) => {
      const sa = schedule?.schedule?.find(s => s.parent_id === a.parent.id);
      const sb = schedule?.schedule?.find(s => s.parent_id === b.parent.id);
      if (sa && sb) {
        if (sa.wave !== sb.wave) return sa.wave - sb.wave;
        return sa.leave_in_minutes - sb.leave_in_minutes;
      }
      return b.parent.distance_km - a.parent.distance_km;
    });
  }, [overview, schedule]);

  /* Debug entries — 6 hardcoded Monterrey parents that bypass the backend */
  const debugEntries = useMemo<ParentAdminEntry[]>(() =>
    DEBUG_PARENT_COORDS.map(([lat, lng, name], i) => ({
      parent: {
        id: 9000 + i + 1,
        name,
        phone: '',
        email: '',
        location_lat: lat,
        location_lng: lng,
        location_address: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        distance_km: haversineM([lat, lng], [DEBUG_SCHOOL.lat, DEBUG_SCHOOL.lng]) / 1000,
        travel_time_min: 10,
        travel_time_traffic_min: 10,
        traffic_condition: 'light' as const,
        travel_source: 'haversine_estimate' as const,
        kid_id: 9000 + i + 1,
        logged_in: true,
      },
      kid: { kid_id: 9000 + i + 1, kid_name: `Kid ${i + 1}`, grade: '1st', scan: null },
      est_drive_min: 10,
      travel_time_min: 10,
      travel_time_traffic_min: 10,
      traffic_condition: 'light' as const,
      travel_source: 'haversine_estimate',
    }))
  , []);

  /* ════════════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════════════ */
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar color="dark">
          <IonTitle>Parent Admin</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="parent-admin">
        {loading && !overview && (
          <div className="pa-loading"><div className="pa-spinner" /><br />Loading parents…</div>
        )}

        {overview && (
          <>
            {/* ── Header ──────────────────────────────────────────────── */}
            <div className="pa-header">
              <h2>👨‍👧‍👦 Parent Admin Dashboard</h2>
              <div className="pa-header-actions">
                <button className="pa-btn pa-btn-outline" onClick={fetchOverview} disabled={loading}>
                  🔄 Refresh
                </button>
                <div className="pa-view-toggle">
                  <button
                    className={`pa-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                    onClick={() => setViewMode('list')}
                  >📋 List</button>
                  <button
                    className={`pa-toggle-btn ${viewMode === 'map' ? 'active' : ''}`}
                    onClick={() => setViewMode('map')}
                  >🗺️ Map</button>
                </div>
                <button
                  className={`pa-btn ${debugMode ? 'pa-btn-green' : 'pa-btn-outline'}`}
                  onClick={() => setDebugMode(m => !m)}
                  title="Toggle 6 hardcoded Monterrey test parents to isolate OSRM routing"
                >
                  {debugMode ? '🔴 Debug ON' : '🐞 Debug Routes'}
                </button>
                <button className="pa-btn pa-btn-outline" onClick={handlePrune} disabled={pruning} title="Remove parents whose travel time is over 5 minutes">
                  {pruning ? '⏳ Pruning…' : '✂️ Prune >5 min'}
                </button>
                <button className="pa-btn pa-btn-outline" onClick={refreshTravelTimes} disabled={refreshingTT} title="Fetch real-time traffic data from Google Maps">
                  {refreshingTT ? '⏳ Refreshing…' : '🗺️ Refresh Traffic'}
                </button>
                <button className="pa-btn pa-btn-primary" onClick={fetchSmartSchedule} disabled={smartLoading} title="Traffic-aware schedule (deterministic)">
                  {smartLoading ? '⏳ Computing…' : '🚦 Smart Schedule'}
                </button>
                <button className="pa-btn pa-btn-primary" onClick={fetchAi} disabled={aiLoading} title="AI (Gemini) schedule">
                  {aiLoading ? '🧠 Analyzing…' : '🤖 AI Schedule'}
                </button>
                {!started && (
                  <button className="pa-btn pa-btn-green" onClick={handleStartAll} disabled={startingAll || !schedule}>
                    {startingAll ? '⏳ Starting…' : !schedule ? '🚀 Start All (Get Schedule ↑)' : '🚀 Start All (Timed)'}
                  </button>
                )}
              </div>
            </div>

            {/* ── Stats ───────────────────────────────────────────────── */}
            <div className="pa-stats">
              <div className="pa-stat">
                <div className="stat-val">{overview.parents.length}</div>
                <div className="stat-lbl">Total Parents</div>
              </div>
              <div className="pa-stat">
                <div className="stat-val">{overview.parents.length}</div>
                <div className="stat-lbl">Total Kids</div>
              </div>
              <div className="pa-stat">
                <div className="stat-val">
                  {(overview.parents.reduce((s, p) => s + p.parent.distance_km, 0) / overview.parents.length).toFixed(1)} km
                </div>
                <div className="stat-lbl">Avg Distance</div>
              </div>
              <div className="pa-stat">
                <div className="stat-val">
                  {(overview.parents.reduce((s, p) => s + (p.travel_time_traffic_min || p.est_drive_min), 0) / overview.parents.length).toFixed(1)} min
                </div>
                <div className="stat-lbl">Avg Drive (Traffic)</div>
              </div>
              {overview.traffic_summary && (
                <>
                  <div className="pa-stat">
                    <div className="stat-val" style={{ color: '#4caf50' }}>🟢 {overview.traffic_summary.light}</div>
                    <div className="stat-lbl">Light Traffic</div>
                  </div>
                  <div className="pa-stat">
                    <div className="stat-val" style={{ color: '#ff9800' }}>🟡 {overview.traffic_summary.moderate}</div>
                    <div className="stat-lbl">Moderate</div>
                  </div>
                  <div className="pa-stat">
                    <div className="stat-val" style={{ color: '#f44336' }}>🔴 {overview.traffic_summary.heavy}</div>
                    <div className="stat-lbl">Heavy</div>
                  </div>
                </>
              )}
              {schedule && (
                <div className="pa-stat">
                  <div className="stat-val">{schedule.total_waves}</div>
                  <div className="stat-lbl">AI Waves</div>
                </div>
              )}
            </div>

            {/* ── AI Summary Banner ───────────────────────────────────── */}
            {schedule && (
              <div className="pa-ai-banner">
                <div className="ai-icon">{smartSchedule ? '🚦' : '🤖'}</div>
                <div className="ai-body">
                  <div className="ai-summary">{schedule.summary}</div>
                  <div className="ai-meta">
                    {schedule.total_waves} waves · {schedule.wave_interval_min} min between waves · {schedule.schedule.length} parents scheduled
                    {schedule.traffic_summary && (
                      <span style={{ marginLeft: 10 }}>
                        · 🟢 {schedule.traffic_summary.light} 🟡 {schedule.traffic_summary.moderate} 🔴 {schedule.traffic_summary.heavy}
                      </span>
                    )}
                    {schedule.queue_pressure && (
                      <span style={{ marginLeft: 8 }}>
                        · Queue pressure:{' '}
                        <strong style={{ color: schedule.queue_pressure === 'high' ? '#f44336' : schedule.queue_pressure === 'medium' ? '#ff9800' : '#4caf50' }}>
                          {schedule.queue_pressure}
                        </strong>
                      </span>
                    )}
                    {schedule.fallback && <span style={{ marginLeft: 8, color: '#888' }}>(traffic-aware fallback)</span>}
                  </div>
                </div>
              </div>
            )}

            {/* ── Started Banner ──────────────────────────────────────── */}
            {started && (
              <div className="pa-started-banner">
                <h3>{autoScanActive ? '⏱️ Pickup In Progress — Cars Traveling' : '✅ All Cars Arrived & Scanned'}</h3>
                <p>
                  {autoScanActive
                    ? `${enRouteIds.size} en-route · ${startedIds.size} arrived/scanned of ${schedule?.schedule.length ?? '?'} total`
                    : "All parents' kids have been scanned. Switch to the Visualization tab to see cars."}
                </p>
              </div>
            )}

            {/* ── Map / Table toggle view ──────────────────────────── */}
            {viewMode === 'map' ? (
              <>
                {debugMode && (
                  <div style={{ background: '#fef3c7', border: '2px solid #d97706', borderRadius: 8, padding: '6px 14px', marginBottom: 8, fontSize: 13, color: '#92400e', fontWeight: 600 }}>
                    🐞 DEBUG MODE — showing 6 hardcoded Monterrey test parents. School pinned at {DEBUG_SCHOOL.lat}, {DEBUG_SCHOOL.lng}
                  </div>
                )}
                <ParentsMapView
                  entries={debugMode ? debugEntries : sortedParents}
                  schedule={debugMode ? null : schedule}
                  startedIds={debugMode ? new Set<number>() : startedIds}
                  enRouteIds={debugMode ? new Set<number>() : enRouteIds}
                  countdowns={debugMode ? {} : countdowns}
                  schoolLocation={debugMode ? DEBUG_SCHOOL : (schoolLocation ?? undefined)}
                />
              </>
            ) : (
            <div className="pa-table-wrap">
              <table className="pa-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Seq #</th>
                    <th>Parent</th>
                    <th>Kid</th>
                    <th>Distance</th>
                    <th>Drive (Traffic)</th>
                    <th>Traffic</th>
                    {schedule && <th>Wave</th>}
                    {schedule && <th>Leave In</th>}
                    {schedule && <th>Arrives In</th>}
                    {schedule && <th>Reason</th>}
                    {schedule && <th>Start Time</th>}
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedParents.map((entry, idx) => {
                    const s = scheduleForParent(entry.parent.id);
                    const isStarted = startedIds.has(entry.parent.id);
                    const hasScanned = !!entry.kid?.scan;

                    return (
                      <tr key={entry.parent.id}>
                        <td style={{ color: '#666' }}>{idx + 1}</td>
                        {/* Virtual sequence number based on estimated arrival order */}
                        <td style={{ color: '#666' }}>
                          {(() => {
                            const s = scheduleForParent(entry.parent.id);
                            if (!s) return '—';
                            const arrivalKey = (item: AiScheduleItem) =>
                              item.estimated_arrival_min ?? (item.leave_in_minutes + (item.travel_time_traffic_min ?? 0));
                            return 1 + sortedParents.filter(e => {
                              const sp = scheduleForParent(e.parent.id);
                              return sp && arrivalKey(sp) < arrivalKey(s);
                            }).length;
                          })()}
                        </td>
                        <td>
                          <span className={`pa-status-dot ${hasScanned ? 'started' : isStarted ? 'started' : enRouteIds.has(entry.parent.id) ? 'en-route' : s ? 'waiting' : 'idle'}`} />
                          <strong>{entry.parent.name}</strong>
                          <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                            {entry.parent.phone}
                          </div>
                        </td>
                        <td>
                          <div className="pa-kid-chips">
                            {entry.kid && (
                              <span className="pa-kid-chip" key={entry.kid.kid_id}>
                                {entry.kid.kid_name} <span style={{ color: '#666' }}>· {entry.kid.grade}</span>
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="pa-dist-bar">
                            <span>{entry.parent.distance_km} km</span>
                            <div className="bar">
                              <div className="bar-fill" style={{ width: `${(entry.parent.distance_km / maxDist) * 100}%` }} />
                            </div>
                          </div>
                        </td>
                        <td>{entry.travel_time_traffic_min || entry.est_drive_min} min</td>
                        <td>
                          <span className={`pa-traffic-badge traffic-${entry.traffic_condition || 'unknown'}`}>
                            {entry.traffic_condition === 'heavy' ? '🔴' : entry.traffic_condition === 'moderate' ? '🟡' : entry.traffic_condition === 'light' ? '🟢' : '⚪'}
                            {' '}{(entry.traffic_condition || 'N/A').charAt(0).toUpperCase() + (entry.traffic_condition || 'N/A').slice(1)}
                          </span>
                        </td>
                        {schedule && (
                          <td>
                            {s ? (
                              <span className={`pa-wave-badge ${waveCls(s.wave)}`}>
                                Wave {s.wave}
                              </span>
                            ) : <span style={{ color: '#444' }}>—</span>}
                          </td>
                        )}
                        {schedule && (
                          <td>
                            {s ? (
                              <span className={`pa-leave-timer ${s.leave_in_minutes === 0 ? 'now' : s.leave_in_minutes <= 5 ? 'soon' : 'later'}`}>
                                {s.leave_in_minutes === 0 ? 'NOW' : `${s.leave_in_minutes} min`}
                              </span>
                            ) : '—'}
                          </td>
                        )}
                        {schedule && (
                          <td>
                            {s ? (() => {
                              const arrMin = s.estimated_arrival_min
                                ?? +(s.leave_in_minutes + (s.travel_time_traffic_min ?? entry.travel_time_traffic_min ?? entry.est_drive_min)).toFixed(1);
                              return (
                                <span className={`pa-leave-timer ${arrMin <= 1 ? 'now' : arrMin <= 5 ? 'soon' : 'later'}`}>
                                  {arrMin <= 0 ? 'NOW' : `${arrMin} min`}
                                </span>
                              );
                            })() : '—'}
                          </td>
                        )}
                                                {schedule && (
                                                  <td>
                                                    {s ? (
                                                      <span className="pa-leave-timer" style={{ fontWeight: 500 }}>
                                                        {/* Start time: now + leave_in_minutes */}
                                                        {(() => {
                                                          const now = new Date();
                                                          const start = new Date(now.getTime() + (s.leave_in_minutes * 60000));
                                                          return start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                                        })()}
                                                      </span>
                                                    ) : '—'}
                                                  </td>
                                                )}
                        {schedule && (
                          <td style={{ fontSize: 11, color: '#888', maxWidth: 200 }}>
                            {s ? (
                              <>
                                {s.reason ?? '—'}
                                {s.traffic_buffer_min ? (
                                  <span style={{ color: '#f87171', marginLeft: 4 }}>
                                    +{s.traffic_buffer_min}m buffer
                                  </span>
                                ) : null}
                              </>
                            ) : '—'}
                          </td>
                        )}
                        <td>
                          {entry.kid?.scan ? (
                            <span className={`pa-leave-timer ${entry.kid.scan.queue_status === 'done' ? 'now' : 'soon'}`}>
                              {entry.kid.scan.queue_status === 'done' ? '✅ Done'
                                : entry.kid.scan.queue_status === 'pickup' ? '🚗 At Pillar'
                                : `⏳ Seq #${entry.kid.scan.seq}`}
                            </span>
                          ) : startedIds.has(entry.parent.id) ? (
                            <span className="pa-leave-timer now">✅ Arrived & Scanned</span>
                          ) : enRouteIds.has(entry.parent.id) ? (
                            <span className="pa-leave-timer soon">
                              🚗 En Route{countdowns[entry.parent.id] !== undefined
                                ? ` · arrives ${fmtCountdown(countdowns[entry.parent.id])}`
                                : ''}
                            </span>
                          ) : countdowns[entry.parent.id] !== undefined ? (
                            <span className="pa-leave-timer later">⏱️ departs {fmtCountdown(countdowns[entry.parent.id])}</span>
                          ) : (
                            <button
                              className="pa-btn pa-btn-green"
                              style={{ padding: '4px 12px', fontSize: 12 }}
                              onClick={() => handleStartParent(entry.parent.id)}
                              disabled={startingId === entry.parent.id}
                            >
                              {startingId === entry.parent.id ? '⏳…' : '▶ Start'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )} {/* end map/list toggle */}
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default ParentAdmin;
