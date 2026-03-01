import { useState, useEffect, useCallback, useRef } from 'react';
import {
  IonContent, IonPage, IonHeader, IonToolbar, IonTitle,
} from '@ionic/react';
import {
  parentApi, teacherApi,
  type ParentDTO, type KidDTO, type KidQueueInfo,
  type WhenToLeaveResponse, type TeacherSequenceResponse,
} from '../services/api';
import './ParentPortal.css';

/* ════════════════════════════════════════════════════════════════════════════
   Parent Portal — personalized pickup page
   ════════════════════════════════════════════════════════════════════════════ */

type Tab = 'dashboard' | 'teacher';

const ParentPortal: React.FC = () => {
  /* ── Auth state ──────────────────────────────────────────────────────── */
  const [parent, setParent]       = useState<ParentDTO | null>(null);
  const [kid, setKid]             = useState<KidDTO | null>(null);
  const [loginName, setLoginName] = useState('');
  const [loginErr, setLoginErr]   = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  /* ── Dashboard state ─────────────────────────────────────────────────── */
  const [tab, setTab]                     = useState<Tab>('dashboard');
  const [kidStatus, setKidStatus]         = useState<KidQueueInfo | null>(null);
  const [aiLeave, setAiLeave]             = useState<WhenToLeaveResponse | null>(null);
  const [aiBusy, setAiBusy]               = useState(false);
  const [locUpdating, setLocUpdating]     = useState(false);
  const [teacherSeq, setTeacherSeq]       = useState<TeacherSequenceResponse | null>(null);
  const [teacherBusy, setTeacherBusy]     = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Login handler ───────────────────────────────────────────────────── */
  const handleLogin = useCallback(async () => {
    const name = loginName.trim();
    if (!name) return;
    setLoginBusy(true);
    setLoginErr('');
    try {
      const res = await parentApi.login(name);
      setParent(res.parent);
      setKid(res.kid);
    } catch (e: any) {
      setLoginErr(e?.message?.includes('404') ? 'No kid found with that name.' : (e?.message ?? 'Login failed'));
    } finally {
      setLoginBusy(false);
    }
  }, [loginName]);

  /* ── Geolocation ─────────────────────────────────────────────────────── */
  const captureLocation = useCallback(async () => {
    if (!parent) return;
    if (!navigator.geolocation) { alert('Geolocation not supported'); return; }
    setLocUpdating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const updated = await parentApi.updateLocation(parent.id, pos.coords.latitude, pos.coords.longitude);
          setParent(updated);
        } catch { /* ignore */ }
        setLocUpdating(false);
      },
      () => { alert('Location permission denied'); setLocUpdating(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [parent]);

  /* ── Fetch kid's queue status (poll every 10s) ───────────────────────── */
  const fetchKidStatus = useCallback(async () => {
    if (!parent) return;
    try {
      const res = await parentApi.queueStatus(parent.id);
      setKidStatus(res.kid_status);
    } catch { /* ignore */ }
  }, [parent]);

  useEffect(() => {
    if (!parent) return;
    fetchKidStatus();
    pollRef.current = setInterval(fetchKidStatus, 10_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [parent, fetchKidStatus]);

  /* ── AI when-to-leave ────────────────────────────────────────────────── */
  const askAi = useCallback(async () => {
    if (!parent) return;
    setAiBusy(true);
    try {
      const res = await parentApi.whenToLeave(parent.id);
      setAiLeave(res);
    } catch (e: any) {
      alert('AI error: ' + (e?.message ?? 'unknown'));
    } finally {
      setAiBusy(false);
    }
  }, [parent]);

  /* ── Teacher sequence ────────────────────────────────────────────────── */
  const fetchTeacher = useCallback(async () => {
    setTeacherBusy(true);
    try {
      setTeacherSeq(await teacherApi.getSequence());
    } catch { /* ignore */ }
    setTeacherBusy(false);
  }, []);

  useEffect(() => {
    if (tab === 'teacher') fetchTeacher();
  }, [tab, fetchTeacher]);

  /* ── Logout ──────────────────────────────────────────────────────────── */
  const logout = () => {
    setParent(null);
    setKid(null);
    setKidStatus(null);
    setAiLeave(null);
    setTeacherSeq(null);
    setLoginName('');
    setTab('dashboard');
  };

  /* ════════════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════════════ */

  /* ── Login screen ────────────────────────────────────────────────────── */
  if (!parent) {
    return (
      <IonPage>
        <IonContent fullscreen className="parent-portal">
          <div className="pp-login">
            <div className="pp-login-card">
              <div className="pp-icon">👨‍👧‍👦</div>
              <h1>Parent Portal</h1>
              <p className="pp-subtitle">Enter your child's name to log in</p>
              <input
                className="pp-login-input"
                type="text"
                placeholder="e.g. Emma Smith"
                value={loginName}
                onChange={e => setLoginName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
                autoFocus
              />
              <button className="pp-login-btn" onClick={handleLogin} disabled={loginBusy || !loginName.trim()}>
                {loginBusy ? 'Logging in…' : 'Log In'}
              </button>
              {loginErr && <div className="pp-login-error">{loginErr}</div>}
            </div>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  /* ── Dashboard ───────────────────────────────────────────────────────── */
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar color="dark">
          <IonTitle>Parent Portal</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="parent-portal">
        <div className="pp-dashboard">
          {/* Header */}
          <div className="pp-header">
            <h2>Welcome, {parent.name} 👋</h2>
            <button className="pp-logout" onClick={logout}>Log out</button>
          </div>

          {/* Tabs */}
          <div className="pp-tabs">
            <button className={`pp-tab ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>
              🏠 My Dashboard
            </button>
            <button className={`pp-tab ${tab === 'teacher' ? 'active' : ''}`} onClick={() => setTab('teacher')}>
              👩‍🏫 Teacher Sequence
            </button>
          </div>

          {/* ── TAB: Dashboard ───────────────────────────────────────── */}
          {tab === 'dashboard' && (
            <>
              {/* My Kid */}
              <div className="pp-card">
                <h3>👧 My Kid</h3>
                <div className="pp-kids-grid">
                  {kid && (() => {
                    const status = kidStatus
                      ? kidStatus.scan
                        ? kidStatus.scan.queue_status === 'done'
                          ? 'done'
                          : kidStatus.scan.queue_status === 'pickup'
                            ? 'scanned'
                            : 'waiting'
                        : 'not-scanned'
                      : 'not-scanned';
                    const statusLabel = status === 'done' ? '✅ Picked Up'
                      : status === 'scanned' ? '🚗 At Pillar'
                      : status === 'waiting' ? '⏳ In Queue'
                      : '🔲 Not Scanned';
                    return (
                      <div className="pp-kid-card" key={kid.id}>
                        <p className="kid-name">{kid.name}</p>
                        <p className="kid-grade">{kid.grade}</p>
                        <span className={`kid-status ${status}`}>{statusLabel}</span>
                        {kidStatus?.scan && (
                          <div style={{ marginTop: 8, fontSize: 11, color: '#888' }}>
                            Seq #{kidStatus.scan.seq} · Pillar P{kidStatus.scan.pillar}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Location & Travel Time */}
              <div className="pp-card">
                <h3>📍 My Location & Travel Time</h3>
                <div className="pp-location">
                  <div className="pp-location-info">
                    <span className="loc-label">
                      {parent.location_address || 'Location not set'}
                    </span>
                    <span className="loc-detail">
                      {parent.distance_km > 0
                        ? `${parent.distance_km} km from school`
                        : 'Update your location for travel estimates'}
                    </span>
                    {parent.travel_time_traffic_min > 0 && (
                      <span className="loc-detail" style={{ marginTop: 4 }}>
                        🚗 <strong>{parent.travel_time_traffic_min} min</strong> drive (with traffic)
                        {parent.travel_time_min > 0 && parent.travel_time_min !== parent.travel_time_traffic_min && (
                          <span style={{ color: '#888' }}> · {parent.travel_time_min} min without</span>
                        )}
                      </span>
                    )}
                    {parent.traffic_condition && parent.traffic_condition !== 'unknown' && (
                      <span className={`traffic-badge traffic-${parent.traffic_condition}`}>
                        {parent.traffic_condition === 'heavy' ? '🔴' : parent.traffic_condition === 'moderate' ? '🟡' : '🟢'}
                        {' '}{parent.traffic_condition.charAt(0).toUpperCase() + parent.traffic_condition.slice(1)} Traffic
                      </span>
                    )}
                    {parent.travel_source && parent.travel_source !== 'pending' && (
                      <span style={{ fontSize: 10, color: '#999', marginTop: 2, display: 'block' }}>
                        Source: {parent.travel_source === 'google_maps' ? '🗺️ Google Maps' : '📐 Estimated'}
                      </span>
                    )}
                  </div>
                  <button className="pp-loc-btn" onClick={captureLocation} disabled={locUpdating}>
                    {locUpdating ? 'Updating…' : '📡 Update Location'}
                  </button>
                </div>
              </div>

              {/* AI Departure Recommendation */}
              <div className={`pp-card pp-ai-card ${aiLeave ? (aiLeave.should_leave_now ? 'leave-now' : 'wait') : ''}`}>
                <h3>🤖 AI: When Should I Leave?</h3>

                {aiLeave ? (
                  <>
                    <div className={`pp-ai-msg ${aiLeave.should_leave_now ? 'leave-now' : 'wait'}`}>
                      {aiLeave.message}
                    </div>
                    <div className="pp-ai-details">
                      <div className="pp-ai-detail">
                        <div className="label">Leave in</div>
                        <div className="value">{aiLeave.leave_in_minutes} min</div>
                      </div>
                      <div className="pp-ai-detail">
                        <div className="label">Drive Time (traffic)</div>
                        <div className="value">{aiLeave.travel_time_with_traffic_min ?? aiLeave.estimated_arrival_min} min</div>
                      </div>
                      <div className="pp-ai-detail">
                        <div className="label">Traffic</div>
                        <div className="value">
                          {aiLeave.traffic_condition === 'heavy' ? '🔴' : aiLeave.traffic_condition === 'moderate' ? '🟡' : '🟢'}
                          {' '}{aiLeave.traffic_condition ?? 'unknown'}
                        </div>
                      </div>
                      <div className="pp-ai-detail">
                        <div className="label">Est. Wait at School</div>
                        <div className="value">{aiLeave.estimated_wait_at_school_min} min</div>
                      </div>
                      <div className="pp-ai-detail">
                        <div className="label">Queue Position</div>
                        <div className="value">#{aiLeave.queue_position_when_arrive}</div>
                      </div>
                      <div className="pp-ai-detail">
                        <div className="label">Queue Pressure</div>
                        <div className="value">
                          {aiLeave.queue_pressure === 'high' ? '🔴' : aiLeave.queue_pressure === 'medium' ? '🟡' : '🟢'}
                          {' '}{aiLeave.queue_pressure ?? 'low'}
                        </div>
                      </div>
                      {aiLeave.optimal_departure_window_min !== undefined && (
                        <div className="pp-ai-detail">
                          <div className="label">Departure Window</div>
                          <div className="value">Next {aiLeave.optimal_departure_window_min} min</div>
                        </div>
                      )}
                      <div className="pp-ai-detail">
                        <div className="label">Teacher Prep</div>
                        <div className="value">{aiLeave.teacher_prep_time_min} min</div>
                      </div>
                    </div>
                    <div className="pp-ai-reasoning">
                      💡 {aiLeave.reasoning}
                    </div>
                    {aiLeave.travel_info && (
                      <div style={{ fontSize: 10, color: '#999', marginTop: 8 }}>
                        Data: {aiLeave.travel_info.source === 'google_maps' ? '🗺️ Google Maps real-time traffic' : '📐 Estimated (set GOOGLE_MAPS_API_KEY for live traffic)'}
                      </div>
                    )}
                  </>
                ) : (
                  <p style={{ color: '#888', fontSize: 13 }}>
                    Ask AI to calculate the best time to leave based on your distance and the current queue.
                  </p>
                )}

                <button className="pp-ai-btn" onClick={askAi} disabled={aiBusy}>
                  {aiBusy ? '🧠 Analyzing…' : (aiLeave ? '🔄 Refresh Recommendation' : '🚀 Ask AI When to Leave')}
                </button>
              </div>
            </>
          )}

          {/* ── TAB: Teacher Sequence ────────────────────────────────── */}
          {tab === 'teacher' && (
            <>
              <div className="pp-card">
                <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>🚗 Currently at Pillars</span>
                  <button className="pp-loc-btn" onClick={fetchTeacher} disabled={teacherBusy} style={{ fontSize: 11 }}>
                    {teacherBusy ? 'Loading…' : '🔄 Refresh'}
                  </button>
                </h3>
                {teacherBusy && !teacherSeq && (
                  <div className="pp-loading"><div className="pp-spinner" /><br />Loading sequence…</div>
                )}
                {teacherSeq && (
                  <div className="pp-teacher-list">
                    {teacherSeq.current_at_pillars.length === 0 && (
                      <div style={{ color: '#666', fontSize: 13, padding: 12 }}>No cars at pillars yet</div>
                    )}
                    {teacherSeq.current_at_pillars.map(s => (
                      <div className="pp-teacher-row prepare-now" key={s.id}>
                        <div className="seq-badge">P{s.pillar}</div>
                        <div className="row-info">
                          <div className="row-name">{s.name}</div>
                          <div className="row-meta">{s.grade} · Car {s.car_arrived ? 'arrived' : 'en route'}</div>
                        </div>
                        <span className="action-badge prepare-now">AT PILLAR</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pp-card">
                <h3>📋 Prepare Next (Teacher Queue)</h3>
                <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
                  Teachers: bring these kids to the pickup area in order. Time estimates are based on avg pickup speed of{' '}
                  {teacherSeq ? `${teacherSeq.avg_pickup_time_sec}s` : '…'} per car.
                </p>
                {teacherSeq && (
                  <div className="pp-teacher-list">
                    {teacherSeq.prepare_next.length === 0 && (
                      <div style={{ color: '#666', fontSize: 13, padding: 12 }}>No kids waiting</div>
                    )}
                    {teacherSeq.prepare_next.map(s => {
                      const cls = s.teacher_action === 'PREPARE NOW' ? 'prepare-now'
                        : s.teacher_action === 'GET READY' ? 'get-ready' : 'upcoming';
                      return (
                        <div className={`pp-teacher-row ${cls}`} key={s.id}>
                          <div className="seq-badge">#{s.seq}</div>
                          <div className="row-info">
                            <div className="row-name">{s.name}</div>
                            <div className="row-meta">
                              {s.grade} · Pillar P{s.pillar} · ~{s.est_minutes_until_called} min
                            </div>
                          </div>
                          <span className={`action-badge ${cls}`}>{s.teacher_action}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {teacherSeq && teacherSeq.recently_completed.length > 0 && (
                <div className="pp-card">
                  <h3>✅ Recently Completed</h3>
                  <div className="pp-teacher-list">
                    {teacherSeq.recently_completed.map(s => (
                      <div className="pp-teacher-row upcoming" key={s.id} style={{ opacity: 0.5 }}>
                        <div className="seq-badge">#{s.seq}</div>
                        <div className="row-info">
                          <div className="row-name">{s.name}</div>
                          <div className="row-meta">{s.grade} · P{s.pillar} · Done</div>
                        </div>
                        <span className="action-badge upcoming">DONE</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default ParentPortal;
