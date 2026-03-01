import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButton, IonIcon, IonSpinner, IonChip, IonLabel,
} from '@ionic/react';
import { checkmarkCircle, carOutline, hourglassOutline, personOutline, refreshOutline } from 'ionicons/icons';
import { useState, useEffect, useRef, useCallback } from 'react';
import { scanApi, ScanRecord } from '../services/api';
import './PillarManager.css';

const PILLARS = [1, 2, 3, 4, 5];

const PillarManager: React.FC = () => {
  const [selectedPillar, setSelectedPillar] = useState<number | null>(null);
  const [scans, setScans]                   = useState<ScanRecord[]>([]);       // single-pillar
  const [allScans, setAllScans]             = useState<ScanRecord[]>([]);       // all-pillar (auto mode)
  const [loading, setLoading]               = useState(false);
  const [confirming, setConfirming]         = useState<Set<number>>(new Set());
  const [flashMsg, setFlashMsg]             = useState('');
  const [autoPickup, setAutoPickup]         = useState<boolean>(() => {
    try { const v = localStorage.getItem('pillar-auto-pickup'); return v === null ? true : v === 'true'; } catch { return true; }
  });
  const timerRef             = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoTimerRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoConfirmedRef     = useRef<Set<number>>(new Set());
  // Per-car countdown: store the timestamp when each kid's countdown started
  const countdownStartRef    = useRef<Map<number, number>>(new Map());   // kidId → Date.now() at start
  const pendingTimeoutsRef   = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const PICKUP_DELAY_S = 10;

  // Live clock — ticks every second to drive BOTH wait timers and countdown displays
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Derive countdown remaining seconds from `now` — no per-kid setIntervals needed
  const getCountdown = (kidId: number): number | null => {
    const start = countdownStartRef.current.get(kidId);
    if (start === undefined) return null;
    const elapsed = Math.floor((now - start) / 1000);
    const remaining = PICKUP_DELAY_S - elapsed;
    return remaining > 0 ? remaining : null;
  };

  const formatElapsed = (isoString: string): string => {
    const diff = Math.max(0, now - new Date(isoString).getTime());
    const totalSec = Math.floor(diff / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  /** Per-pillar timer — shows elapsed since the oldest un-picked-up kid at that pillar was scanned */
  const getPillarTimer = (pillarScans: ScanRecord[]): string => {
    let oldest = Infinity;
    for (const s of pillarScans) {
      if (!s.picked_up) {
        const t = new Date(s.scanned_at).getTime();
        if (t < oldest) oldest = t;
      }
    }
    if (oldest === Infinity) return '';
    const diff = Math.max(0, now - oldest);
    const totalSec = Math.floor(diff / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const flash = (msg: string) => {
    setFlashMsg(msg);
    setTimeout(() => setFlashMsg(''), 3000);
  };

  const refresh = useCallback(async (pillar: number) => {
    try {
      const data = await scanApi.getByPillar(pillar);
      setScans(data);
    } catch { /* server may be offline */ }
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const data = await scanApi.getAll();
      setAllScans(data);
    } catch { /* server may be offline */ }
  }, []);

  // Auto-refresh every 3 s while a pillar is selected (manual mode)
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (selectedPillar === null || autoPickup) return;

    autoConfirmedRef.current.clear();
    setLoading(true);
    scanApi.getByPillar(selectedPillar)
      .then(data => { setScans(data); })
      .catch(() => {})
      .finally(() => setLoading(false));

    timerRef.current = setInterval(() => refresh(selectedPillar), 3000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [selectedPillar, autoPickup, refresh]);

  // Auto-pickup mode: poll ALL scans every 3 s regardless of pillar selection
  useEffect(() => {
    if (autoTimerRef.current) clearInterval(autoTimerRef.current);
    if (!autoPickup) { setAllScans([]); return; }

    autoConfirmedRef.current.clear();
    refreshAll();
    autoTimerRef.current = setInterval(refreshAll, 3000);
    return () => { if (autoTimerRef.current) clearInterval(autoTimerRef.current); };
  }, [autoPickup, refreshAll]);

  const handleConfirm = async (kidId: number, name: string) => {
    setConfirming(prev => new Set(prev).add(kidId));
    try {
      await scanApi.confirmPickup(kidId);
      const update = (s: ScanRecord) => s.kid_id === kidId
        ? { ...s, picked_up: true, picked_up_at: new Date().toISOString() } : s;
      setScans(prev => prev.map(update));
      setAllScans(prev => prev.map(update));
      flash(`✓ ${name} picked up!`);
    } catch {
      // Remove from autoConfirmedRef so the next allScans poll can reschedule
      autoConfirmedRef.current.delete(kidId);
      flash(`Retrying ${name}…`);
    } finally {
      setConfirming(prev => { const s = new Set(prev); s.delete(kidId); return s; });
    }
  };

  // Persist autoPickup preference
  const toggleAutoPickup = (val: boolean) => {
    setAutoPickup(val);
    try { localStorage.setItem('pillar-auto-pickup', String(val)); } catch { /* ignore */ }
  };

  // Cancel all pending countdown timers (called when auto mode is turned off)
  const cancelAllCountdowns = useCallback(() => {
    pendingTimeoutsRef.current.forEach(id => clearTimeout(id));
    pendingTimeoutsRef.current.clear();
    countdownStartRef.current.clear();
  }, []);

  // Cancel a single car's countdown (called after confirm resolves)
  const cancelCountdown = useCallback((kidId: number) => {
    const t = pendingTimeoutsRef.current.get(kidId);
    if (t !== undefined) { clearTimeout(t); pendingTimeoutsRef.current.delete(kidId); }
    countdownStartRef.current.delete(kidId);
  }, []);

  // Auto-confirm cars that have arrived — with 10-second countdown before confirming
  useEffect(() => {
    if (!autoPickup) return;
    allScans.forEach(s => {
      if (s.car_arrived && !s.picked_up && !autoConfirmedRef.current.has(s.kid_id)) {
        autoConfirmedRef.current.add(s.kid_id);

        // Record when countdown started — the `now` tick computes remaining from this
        countdownStartRef.current.set(s.kid_id, Date.now());

        const t = setTimeout(async () => {
          cancelCountdown(s.kid_id);
          // Re-check latest state before confirming — backend may already have picked_up=true
          try {
            const fresh = await scanApi.getById(s.kid_id);
            if (fresh.picked_up) {
              // Already confirmed externally — just update local state
              const update = (r: ScanRecord) => r.kid_id === s.kid_id
                ? { ...r, picked_up: true, picked_up_at: fresh.picked_up_at } : r;
              setScans(prev => prev.map(update));
              setAllScans(prev => prev.map(update));
              return;
            }
          } catch { /* ignore pre-check failure, proceed with confirm */ }
          handleConfirm(s.kid_id, s.name);
        }, PICKUP_DELAY_S * 1000);
        pendingTimeoutsRef.current.set(s.kid_id, t);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allScans, autoPickup]);

  // Cancel all countdowns when auto-pickup is switched off
  useEffect(() => {
    if (!autoPickup) cancelAllCountdowns();
  }, [autoPickup, cancelAllCountdowns]);

  // ── Stats (manual mode uses scans; auto mode uses allScans) ─────────────────
  const activeScans = autoPickup ? allScans : scans;
  const total       = activeScans.length;
  const pickedUp    = activeScans.filter(s => s.picked_up).length;
  const carArrived  = activeScans.filter(s => s.car_arrived && !s.picked_up).length;
  const inQueue     = activeScans.filter(s => !s.car_arrived && !s.picked_up).length;

  // ── Status helpers ──────────────────────────────────────────────────────────
  const statusLabel = (s: ScanRecord) => {
    if (s.picked_up)   return { label: 'Picked Up',    color: 'success',  icon: checkmarkCircle };
    if (s.car_arrived) return { label: 'Car Arrived!', color: 'warning',  icon: carOutline };
    return               { label: 'Waiting',           color: 'medium',   icon: hourglassOutline };
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar color="primary">
          <IonTitle>
            Pillar Manager{selectedPillar ? ` — Pillar P${selectedPillar}` : ''}
          </IonTitle>
          {selectedPillar && (
            <IonButton slot="end" fill="clear" color="light" size="small"
              onClick={() => refresh(selectedPillar)}>
              <IonIcon icon={refreshOutline} />
            </IonButton>
          )}
        </IonToolbar>
      </IonHeader>

      <IonContent className="pillar-manager-content">

        {/* ── Pillar Selector ─────────────────────────────────── */}
        <div className="pillar-selector">
          {autoPickup
            ? <p className="pillar-selector-label" style={{ color: '#10dc60' }}>Auto Pickup ON — all pillars monitored</p>
            : <p className="pillar-selector-label">Select Your Pillar</p>
          }
          <div className="pillar-buttons" style={{ opacity: autoPickup ? 0.35 : 1, pointerEvents: autoPickup ? 'none' : 'auto' }}>
            {PILLARS.map(p => (
              <button
                key={p}
                className={`pillar-btn${selectedPillar === p ? ' active' : ''}`}
                onClick={() => setSelectedPillar(p)}
              >
                P{p}
              </button>
            ))}
          </div>
          {/* Auto-pickup toggle */}
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
              userSelect: 'none', fontSize: 14,
            }}>
              <input
                type="checkbox"
                checked={autoPickup}
                onChange={e => toggleAutoPickup(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#10dc60' }}
              />
              <span style={{ color: autoPickup ? '#10dc60' : '#92949c', fontWeight: autoPickup ? 'bold' : 'normal' }}>
                Auto Pickup
              </span>
            </label>
            {autoPickup && (
              <span style={{
                fontSize: 11, color: '#10dc60',
                background: '#10dc6018', border: '1px solid #10dc6044',
                borderRadius: 6, padding: '2px 8px',
              }}>ON — no pillar selection needed</span>
            )}
          </div>
        </div>

        {/* ── Auto mode: all-pillar live view ──────────────────── */}
        {autoPickup && (
          <>
            <div className="pm-stats-bar">
              <div className="pm-stat total"><span className="stat-num">{total}</span><span className="stat-lbl">Total</span></div>
              <div className="pm-stat queue"><span className="stat-num">{inQueue}</span><span className="stat-lbl">Waiting</span></div>
              <div className="pm-stat arrived"><span className="stat-num">{carArrived}</span><span className="stat-lbl">Arriving</span></div>
              <div className="pm-stat done"><span className="stat-num">{pickedUp}</span><span className="stat-lbl">Picked Up</span></div>
            </div>
            {flashMsg && <div className="pm-flash">{flashMsg}</div>}
            {total === 0 && (
              <div className="pm-empty">No scanned kids yet. Scan kids in the <strong>Scan</strong> tab.</div>
            )}
            {PILLARS.map(p => {
              const pScans = allScans.filter(s => s.pillar === p);
              if (pScans.length === 0) return null;
              const pDone    = pScans.filter(s => s.picked_up).length;
              const pArrived = pScans.filter(s => s.car_arrived && !s.picked_up).length;
              return (
                <div key={p} style={{ margin: '0 12px 12px' }}>
                  <div style={{
                    fontSize: 11, fontWeight: 'bold', letterSpacing: 1,
                    color: '#3880ff', padding: '4px 0 2px',
                    borderBottom: '1px solid #3880ff33', marginBottom: 4,
                  }}>
                    PILLAR P{p} — {pDone}/{pScans.length} done
                    {pArrived > 0 ? ` · ${pArrived} confirming…` : ''}
                  </div>                  {getPillarTimer(pScans) && (
                    <div style={{
                      fontFamily: 'monospace', fontSize: 16, fontWeight: 'bold',
                      color: '#3880ff', background: 'rgba(56,128,255,0.08)',
                      borderRadius: 8, padding: '4px 10px', marginBottom: 6,
                      letterSpacing: 1, display: 'inline-block',
                    }}>⏱ {getPillarTimer(pScans)}</div>
                  )}                  <div className="pm-card-list" style={{ marginTop: 0 }}>
                    {pScans.map(s => {
                      const st = statusLabel(s);
                      return (
                        <div key={s.kid_id}
                          className={`pm-kid-card${s.car_arrived && !s.picked_up ? ' car-arrived-pulse' : ''}${s.picked_up ? ' done' : ''}`}>
                          <div className="pm-card-left">
                            <div className="pm-seq-badge">#{s.seq}</div>
                            <div className="pm-kid-info">
                              <span className="pm-kid-name">{s.name}</span>
                              <IonChip color={st.color as any} outline={!s.car_arrived || s.picked_up} className="pm-status-chip">
                                <IonIcon icon={st.icon} /><IonLabel>{st.label}</IonLabel>
                              </IonChip>
                            </div>
                          </div>
                          <div className="pm-card-right">
                            {s.picked_up
                              ? <IonIcon icon={checkmarkCircle} className="done-check" />
                              : s.car_arrived
                              ? confirming.has(s.kid_id)
                                ? <span style={{ color: '#10dc60', fontSize: 12, fontStyle: 'italic' }}><IonSpinner name="dots" /></span>
                                : getCountdown(s.kid_id) !== null
                                ? <span style={{
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    color: '#ffd534', fontSize: 13, fontWeight: 'bold',
                                  }}>
                                    <span style={{
                                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                      width: 26, height: 26, borderRadius: '50%',
                                      border: '2px solid #ffd534', fontSize: 12, fontWeight: 'bold',
                                    }}>{getCountdown(s.kid_id)}</span>
                                    s
                                  </span>
                                : <span style={{ color: '#10dc60', fontSize: 12, fontStyle: 'italic' }}>Confirming…</span>
                              : <span className="pm-waiting-label">Waiting for car…</span>
                            }
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* ── Manual mode: no pillar selected ──────────────────── */}
        {!autoPickup && selectedPillar === null && (
          <div className="no-pillar-hint">
            <IonIcon icon={personOutline} className="hint-icon" />
            <p>Choose your pillar to see assigned kids</p>
          </div>
        )}

        {/* ── Manual mode: pillar selected ─────────────────────── */}
        {!autoPickup && selectedPillar !== null && (
          <>
            {/* ── Stats Bar ───────────────────────────────────── */}
            <div className="pm-stats-bar">
              <div className="pm-stat total">
                <span className="stat-num">{total}</span>
                <span className="stat-lbl">Assigned</span>
              </div>
              <div className="pm-stat queue">
                <span className="stat-num">{inQueue}</span>
                <span className="stat-lbl">Waiting</span>
              </div>
              <div className="pm-stat arrived">
                <span className="stat-num">{carArrived}</span>
                <span className="stat-lbl">Car Arrived</span>
              </div>
              <div className="pm-stat done">
                <span className="stat-num">{pickedUp}</span>
                <span className="stat-lbl">Picked Up</span>
              </div>
            </div>

            {/* Per-pillar timer */}
            {getPillarTimer(scans) && (
              <div style={{
                fontFamily: 'monospace', fontSize: 18, fontWeight: 'bold',
                color: '#3880ff', background: 'rgba(56,128,255,0.08)',
                borderRadius: 8, padding: '6px 14px', margin: '0 16px 8px',
                letterSpacing: 1, display: 'inline-block',
              }}>⏱ {getPillarTimer(scans)}</div>
            )}

            {/* Flash message */}
            {flashMsg && <div className="pm-flash">{flashMsg}</div>}

            {/* ── Completion banner ───────────────────────────── */}
            {total > 0 && pickedUp === total && (
              <div className="pm-complete-banner">
                <IonIcon icon={checkmarkCircle} />
                &nbsp;All {total} kids at Pillar P{selectedPillar} have been picked up!
              </div>
            )}

            {loading && scans.length === 0 && (
              <div className="pm-loading"><IonSpinner /><span>Loading…</span></div>
            )}

            {!loading && scans.length === 0 && (
              <div className="pm-empty">
                No kids assigned to Pillar P{selectedPillar} yet.<br />
                Scan kids in the <strong>Scan</strong> tab to assign them.
              </div>
            )}

            {/* ── Kid Cards ───────────────────────────────────── */}
            <div className="pm-card-list">
              {scans.map(s => {
                const st = statusLabel(s);
                return (
                  <div
                    key={s.kid_id}
                    className={`pm-kid-card${s.car_arrived && !s.picked_up ? ' car-arrived-pulse' : ''}${s.picked_up ? ' done' : ''}`}
                  >
                    <div className="pm-card-left">
                      <div className="pm-seq-badge">#{s.seq}</div>
                      <div className="pm-kid-info">
                        <span className="pm-kid-name">{s.name}</span>
                        <IonChip
                          color={st.color as any}
                          outline={!s.car_arrived || s.picked_up}
                          className="pm-status-chip"
                        >
                          <IonIcon icon={st.icon} />
                          <IonLabel>{st.label}</IonLabel>
                        </IonChip>
                      </div>
                    </div>

                    <div className="pm-card-right">
                      {s.picked_up ? (
                        <IonIcon icon={checkmarkCircle} className="done-check" />
                      ) : s.car_arrived ? (
                        <IonButton
                          color="success"
                          size="default"
                          className="confirm-btn"
                          disabled={confirming.has(s.kid_id)}
                          onClick={() => handleConfirm(s.kid_id, s.name)}
                        >
                          {confirming.has(s.kid_id)
                            ? <IonSpinner name="dots" />
                            : <><IonIcon icon={checkmarkCircle} slot="start" />Confirm Pickup</>
                          }
                        </IonButton>
                      ) : (
                        <span className="pm-waiting-label">Waiting for car…</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default PillarManager;
