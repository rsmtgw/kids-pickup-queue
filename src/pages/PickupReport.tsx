import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButton, IonIcon, IonChip, IonLabel, IonSpinner,
} from '@ionic/react';
import {
  refreshOutline, checkmarkCircle, hourglassOutline, carOutline,
  downloadOutline, timeOutline,
} from 'ionicons/icons';
import { useState, useEffect, useRef, useCallback } from 'react';
import { scanApi, ScanRecord } from '../services/api';
import './PickupReport.css';

type SortKey = 'seq' | 'pillar' | 'picked_up_at' | 'name';

// Must match PILLAR_COLORS in PickupVisualization.tsx
const PILLAR_COLORS: Record<number, string> = {
  1: '#3880ff',
  2: '#10dc60',
  3: '#f04141',
  4: '#ffce00',
  5: '#9b59f5',
};

const fmt = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const duration = (from: string | null | undefined, to: string | null | undefined): string => {
  if (!from || !to) return '—';
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

const statusMeta = (s: ScanRecord) => {
  if (s.picked_up)   return { label: 'Done',     color: 'success' as const, icon: checkmarkCircle };
  if (s.car_arrived) return { label: 'At Pillar', color: 'warning' as const, icon: carOutline };
  return               { label: 'Waiting',        color: 'medium'  as const, icon: hourglassOutline };
};

const PickupReport: React.FC = () => {
  const [records, setRecords]   = useState<ScanRecord[]>([]);
  const [loading, setLoading]   = useState(false);
  const [sortKey, setSortKey]   = useState<SortKey>('seq');
  const [sortAsc, setSortAsc]   = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await scanApi.getAll();
      setRecords(data);
      setLastRefresh(new Date());
    } catch { /* server offline */ }
    finally { if (showSpinner) setLoading(false); }
  }, []);

  // Auto-refresh every 5 s
  useEffect(() => {
    fetch(true);
    timerRef.current = setInterval(() => fetch(false), 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetch]);

  const setSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  };

  const activeRecords = showDone ? records : records.filter(r => !r.picked_up);

  const sorted = [...activeRecords].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'seq')         cmp = a.seq - b.seq;
    else if (sortKey === 'pillar') cmp = a.pillar - b.pillar;
    else if (sortKey === 'name')   cmp = a.name.localeCompare(b.name);
    else if (sortKey === 'picked_up_at') {
      const ta = a.picked_up_at ? new Date(a.picked_up_at).getTime() : Infinity;
      const tb = b.picked_up_at ? new Date(b.picked_up_at).getTime() : Infinity;
      cmp = ta - tb;
    }
    return sortAsc ? cmp : -cmp;
  });

  const total    = records.length;
  const done     = records.filter(r => r.picked_up).length;
  const atPillar = records.filter(r => r.car_arrived && !r.picked_up).length;
  const waiting  = records.filter(r => !r.car_arrived && !r.picked_up).length;

  // Live queue slices — derived from scan records, no extra API calls needed.
  // En route  = scanned, car not yet arrived at pillar  → ramp + right lane
  // At pillar = car_arrived=true, not yet picked up     → left lane awaiting confirm
  const lqEnRoute  = records.filter(r => !r.picked_up && !r.car_arrived).sort((a, b) => a.seq - b.seq);
  const lqAtPillar = records.filter(r => !r.picked_up &&  r.car_arrived).sort((a, b) => a.pillar - b.pillar);
  const avgMs = (() => {
    const durations = records
      .filter(r => r.picked_up && r.scanned_at && r.picked_up_at)
      .map(r => new Date(r.picked_up_at!).getTime() - new Date(r.scanned_at).getTime())
      .filter(d => d > 0);
    if (durations.length === 0) return null;
    return durations.reduce((s, d) => s + d, 0) / durations.length;
  })();

  const exportCsv = () => {
    const header = 'Seq,Name,Pillar,Scanned At,Car Arrived,Picked Up,Picked Up At,Total Time\n';
    const rows = sorted.map(r =>
      [
        r.seq, `"${r.name}"`, `P${r.pillar}`,
        fmt(r.scanned_at),
        r.car_arrived ? 'Yes' : 'No',
        r.picked_up   ? 'Yes' : 'No',
        fmt(r.picked_up_at),
        duration(r.scanned_at, r.picked_up_at),
      ].join(',')
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `pickup-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const SortArrow = ({ k }: { k: SortKey }) =>
    sortKey === k ? <span style={{ marginLeft: 3 }}>{sortAsc ? '▲' : '▼'}</span> : null;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar color="primary">
          <IonTitle>Pickup Report</IonTitle>
          <div slot="end" style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 8 }}>
            <IonButton
              fill={showDone ? 'solid' : 'outline'}
              color="light"
              size="small"
              onClick={() => setShowDone(v => !v)}
              title={showDone ? 'Hide completed' : 'Show completed'}
              style={{ fontSize: 11, minWidth: 110 }}
            >
              {showDone ? '✓ Show All' : '⏳ Active Only'}
            </IonButton>
            <IonButton fill="clear" color="light" size="small" onClick={exportCsv} title="Export CSV">
              <IonIcon icon={downloadOutline} />
            </IonButton>
            <IonButton fill="clear" color="light" size="small" onClick={() => fetch(true)} title="Refresh">
              {loading ? <IonSpinner name="crescent" style={{ width: 18, height: 18 }} /> : <IonIcon icon={refreshOutline} />}
            </IonButton>
          </div>
        </IonToolbar>
      </IonHeader>

      <IonContent className="report-content">

        {/* ── Summary stats ────────────────────────────────────────── */}
        <div className="report-stats">
          <div className="rstat total">
            <span className="rstat-num">{total}</span>
            <span className="rstat-lbl">Total</span>
          </div>
          <div className="rstat waiting">
            <span className="rstat-num">{waiting}</span>
            <span className="rstat-lbl">Waiting</span>
          </div>
          <div className="rstat arrived">
            <span className="rstat-num">{atPillar}</span>
            <span className="rstat-lbl">At Pillar</span>
          </div>
          <div className="rstat done">
            <span className="rstat-num">{done}</span>
            <span className="rstat-lbl">Done</span>
          </div>
          {avgMs !== null && (
            <div className="rstat avg">
              <IonIcon icon={timeOutline} style={{ fontSize: 13, marginBottom: 2 }} />
              <span className="rstat-num">
                {avgMs < 60000
                  ? `${Math.round(avgMs / 1000)}s`
                  : `${Math.floor(avgMs / 60000)}m ${Math.round((avgMs % 60000) / 1000)}s`}
              </span>
              <span className="rstat-lbl">Avg time</span>
            </div>
          )}
        </div>

        {lastRefresh && (
          <div className="report-refresh-hint">
            Last updated {lastRefresh.toLocaleTimeString()} · auto-refreshes every 5s
          </div>
        )}

        {/* ── Live Queue ───────────────────────────────────────────── */}
        {records.some(r => !r.picked_up) && (
          <div className="live-queue">
            <div className="lq-title">Live Queue</div>

            {/* Ramp / Right Lane */}
            <div className="lq-row">
              <div className="lq-label">Ramp &amp; Right Lane</div>
              <div className="lq-pills">
                {lqEnRoute.length === 0
                  ? <span className="lq-pill lq-empty">empty</span>
                  : lqEnRoute.map(r => {
                    const pc = PILLAR_COLORS[r.pillar] ?? '#888';
                    return (
                      <span key={r.kid_id} className="lq-pill" style={{
                        background: `${pc}22`,
                        borderColor: `${pc}88`,
                        color: pc,
                      }}>
                        #{r.seq}&nbsp;{r.name.split(' ')[0]}&nbsp;·&nbsp;P{r.pillar}
                      </span>
                    );
                  })
                }
              </div>
            </div>

            {/* Left Lane — one slot per pillar */}
            <div className="lq-row">
              <div className="lq-label">Left Lane</div>
              <div className="lq-pillar-slots">
                {[1, 2, 3, 4, 5].map(p => {
                  const pc   = PILLAR_COLORS[p];
                  const kid  = lqAtPillar.find(r => r.pillar === p);
                  return (
                    <div key={p} className="lq-pillar-slot" style={{
                      borderColor: kid ? `${pc}88` : 'rgba(255,255,255,0.1)',
                      background:  kid ? `${pc}11` : 'rgba(255,255,255,0.03)',
                    }}>
                      <div className="lq-p-header" style={{ color: kid ? `${pc}cc` : 'rgba(255,255,255,0.25)' }}>
                        P{p}
                      </div>
                      {kid ? (
                        <>
                          <div className="lq-p-kid" style={{ color: pc }}>
                            {kid.name.split(' ')[0]}
                          </div>
                          <div className="lq-p-seq">#{kid.seq}</div>
                        </>
                      ) : (
                        <div className="lq-p-kid" style={{ color: 'rgba(255,255,255,0.2)' }}>—</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Table ────────────────────────────────────────────────── */}
        {records.length === 0 && !loading && (
          <div className="report-empty">No scan records yet. Scan kids in the Scan tab.</div>
        )}
        {records.length > 0 && activeRecords.length === 0 && !loading && (
          <div className="report-empty" style={{ color: 'rgba(255,255,255,0.4)' }}>
            All {records.length} kids picked up ✓ — toggle <strong>Show All</strong> to see history.
          </div>
        )}

        {activeRecords.length > 0 && (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th onClick={() => setSort('seq')}    className="sortable">#Seq <SortArrow k="seq" /></th>
                  <th onClick={() => setSort('name')}   className="sortable">Name <SortArrow k="name" /></th>
                  <th onClick={() => setSort('pillar')} className="sortable">Pillar <SortArrow k="pillar" /></th>
                  <th>Scanned</th>
                  <th>Car Arrived</th>
                  <th onClick={() => setSort('picked_up_at')} className="sortable">Picked Up <SortArrow k="picked_up_at" /></th>
                  <th>Total Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => {
                  const meta = statusMeta(r);
                  return (
                    <tr key={r.kid_id} className={r.picked_up ? 'row-done' : r.car_arrived ? 'row-arrived' : ''}>
                      <td className="td-seq">#{r.seq}</td>
                      <td className="td-name">{r.name}</td>
                      <td className="td-pillar">
                        <span className="pillar-badge">P{r.pillar}</span>
                      </td>
                      <td className="td-time">{fmt(r.scanned_at)}</td>
                      <td className="td-time">{r.car_arrived ? <span style={{ color: '#ffc03c' }}>✓ Yes</span> : '—'}</td>
                      <td className="td-time">{fmt(r.picked_up_at)}</td>
                      <td className="td-dur">{duration(r.scanned_at, r.picked_up_at)}</td>
                      <td>
                        <IonChip color={meta.color} outline={!r.picked_up} className="status-chip">
                          <IonIcon icon={meta.icon} />
                          <IonLabel>{meta.label}</IonLabel>
                        </IonChip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </IonContent>
    </IonPage>
  );
};

export default PickupReport;
