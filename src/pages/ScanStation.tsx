import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonSearchbar,
  IonList,
  IonItem,
  IonLabel,
  IonBadge,
  IonButton,
  IonIcon,
  IonSpinner,
  IonToast,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonChip,
  IonRefresher,
  IonRefresherContent,
  RefresherEventDetail,
} from '@ionic/react';
import { scanOutline, checkmarkCircle, timeOutline, refreshOutline, locationOutline } from 'ionicons/icons';
import { useState, useEffect, useCallback } from 'react';
import { kidsApi, scanApi, KidDTO, ScanRecord } from '../services/api';
import './ScanStation.css';

const PILLAR_COLORS: Record<number, string> = {
  1: '#3880ff',
  2: '#10dc60',
  3: '#f04141',
  4: '#ffce00',
  5: '#7044ff',
};

const ScanStation: React.FC = () => {
  const [kids, setKids]             = useState<KidDTO[]>([]);
  const [scans, setScans]           = useState<ScanRecord[]>([]);
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(true);
  const [scanning, setScanning]     = useState<number | null>(null); // id being scanned
  const [scanningAll, setScanningAll] = useState(false);
  const [toastMsg, setToastMsg]     = useState('');
  const [showToast, setShowToast]   = useState(false);
  const [toastColor, setToastColor] = useState<'success' | 'danger'>('success');

  const loadData = useCallback(async () => {
    try {
      const [k, s] = await Promise.all([kidsApi.getAll(), scanApi.getAll()]);
      setKids(k);
      setScans(s);
    } catch {
      flash('Failed to load data. Is the server running?', 'danger');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Auto-refresh scan log every 4 seconds
    const timer = setInterval(() => {
      scanApi.getAll().then(setScans).catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [loadData]);

  const flash = (msg: string, color: 'success' | 'danger' = 'success') => {
    setToastMsg(msg);
    setToastColor(color);
    setShowToast(true);
  };

  const handleScan = async (kid: KidDTO) => {
    if (!kid.id) return;
    setScanning(kid.id);
    try {
      const result = await scanApi.scan({ kid_id: kid.id, name: kid.name });
      setScans(prev => [...prev.filter(s => s.kid_id !== kid.id), result]
        .sort((a, b) => a.seq - b.seq));
      flash(`✓ ${kid.name} → Pillar ${result.pillar}  (seq #${result.seq})`);
    } catch {
      flash(`Failed to scan ${kid.name}`, 'danger');
    } finally {
      setScanning(null);
    }
  };

  const handleReset = async () => {
    try {
      await scanApi.reset();
      setScans([]);
      flash('Scan records reset');
    } catch {
      flash('Reset failed', 'danger');
    }
  };

  const handleScanAll = async () => {
    // Scan every pending kid sequentially with a small delay so server counters stay ordered
    const unscanned = kids.filter(k => !scannedIds.has(k.id!));
    if (unscanned.length === 0) return;
    setScanningAll(true);
    let succeeded = 0;
    for (const kid of unscanned) {
      if (!kid.id) continue;
      try {
        const result = await scanApi.scan({ kid_id: kid.id, name: kid.name });
        setScans(prev => [...prev.filter(s => s.kid_id !== kid.id), result]
          .sort((a, b) => a.seq - b.seq));
        succeeded++;
      } catch {
        // continue scanning remaining kids even if one fails
      }
      // tiny pause so React re-renders between requests
      await new Promise(r => setTimeout(r, 80));
    }
    setScanningAll(false);
    flash(`Scanned ${succeeded} of ${unscanned.length} kids`);
  };

  const handleRefresh = async (e: CustomEvent<RefresherEventDetail>) => {
    await loadData();
    e.detail.complete();
  };

  const scannedIds = new Set(scans.map(s => s.kid_id));

  const filtered = kids.filter(k => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      k.name.toLowerCase().includes(q) ||
      k.pickup_code?.toLowerCase().includes(q) ||
      k.grade?.toLowerCase().includes(q)
    );
  });

  // Split into pending (not yet scanned) and done
  const pending = filtered.filter(k => !scannedIds.has(k.id!));
  const done    = filtered.filter(k =>  scannedIds.has(k.id!));

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar color="primary">
          <IonTitle>
            <IonIcon icon={scanOutline} style={{ marginRight: 8, verticalAlign: 'middle' }} />
            Scan Station
          </IonTitle>
          <IonButton slot="end" fill="clear" color="light" onClick={handleReset}>
            <IonIcon icon={refreshOutline} slot="icon-only" />
          </IonButton>
        </IonToolbar>
        <IonToolbar>
          <IonSearchbar
            value={search}
            onIonInput={e => setSearch(e.detail.value ?? '')}
            placeholder="Search by name, pickup code or grade…"
            debounce={200}
          />
        </IonToolbar>
      </IonHeader>

      <IonContent className="scan-station-content">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        {loading ? (
          <div className="scan-center">
            <IonSpinner name="crescent" />
            <p>Loading kids…</p>
          </div>
        ) : (
          <>
            {/* ── Stats chips + Scan All button ─────────────────── */}
            <div className="scan-stats">
              <IonChip color="primary">
                <IonIcon icon={timeOutline} />
                <IonLabel>{pending.length} pending</IonLabel>
              </IonChip>
              <IonChip color="success">
                <IonIcon icon={checkmarkCircle} />
                <IonLabel>{scannedIds.size} scanned</IonLabel>
              </IonChip>
              <IonChip color="medium">
                <IonLabel>{kids.length} total kids</IonLabel>
              </IonChip>
              {pending.length > 0 && (
                <IonButton
                  size="small"
                  color="warning"
                  disabled={scanningAll}
                  onClick={handleScanAll}
                  style={{ marginLeft: 'auto' }}
                >
                  {scanningAll
                    ? <><IonSpinner name="dots" style={{ width: 16, height: 16, marginRight: 6 }} />Scanning…</>
                    : <><IonIcon icon={scanOutline} slot="start" />Scan All ({pending.length})</>}
                </IonButton>
              )}
            </div>

            {/* ── Pending kids ──────────────────────────────────── */}
            {pending.length > 0 && (
              <IonCard className="scan-card">
                <IonCardHeader>
                  <IonCardTitle className="scan-section-title">
                    Waiting to be scanned
                  </IonCardTitle>
                </IonCardHeader>
                <IonCardContent className="scan-card-body">
                  <IonList lines="full">
                    {pending.map(kid => (
                      <IonItem key={kid.id} className="scan-item">
                        <IonLabel>
                          <h2>{kid.name}</h2>
                          <p>{kid.grade} · Code: <strong>{kid.pickup_code}</strong></p>
                        </IonLabel>
                        <IonButton
                          slot="end"
                          size="default"
                          disabled={scanning === kid.id}
                          onClick={() => handleScan(kid)}
                        >
                          {scanning === kid.id
                            ? <IonSpinner name="dots" />
                            : <><IonIcon icon={scanOutline} slot="start" />Scan</>}
                        </IonButton>
                      </IonItem>
                    ))}
                  </IonList>
                </IonCardContent>
              </IonCard>
            )}

            {/* ── Scan log ──────────────────────────────────────── */}
            {scans.length > 0 && (
              <IonCard className="scan-card">
                <IonCardHeader>
                  <IonCardTitle className="scan-section-title">
                    Scan Log
                    <span className="scan-log-subtitle">auto-refreshes every 4 s</span>
                  </IonCardTitle>
                </IonCardHeader>
                <IonCardContent className="scan-card-body">
                  <IonList lines="full">
                    {[...scans].reverse().map(rec => (
                      <IonItem key={rec.id} className="scan-log-item">
                        <IonBadge slot="start" className="seq-badge">#{rec.seq}</IonBadge>
                        <IonLabel>
                          <h2>{rec.name}</h2>
                          <p>
                            <IonIcon icon={locationOutline} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                            Pillar {rec.pillar}
                            <span className="scan-time">
                              · {new Date(rec.scanned_at).toLocaleTimeString()}
                            </span>
                          </p>
                        </IonLabel>
                        <div
                          slot="end"
                          className="pillar-dot"
                          style={{ background: PILLAR_COLORS[rec.pillar] ?? '#aaa' }}
                          title={`P${rec.pillar}`}
                        />
                        <IonIcon icon={checkmarkCircle} color="success" slot="end" />
                      </IonItem>
                    ))}
                  </IonList>
                </IonCardContent>
              </IonCard>
            )}

            {/* ── Already-scanned kids (collapsed) ─────────────── */}
            {done.length > 0 && (
              <IonCard className="scan-card scan-card-done">
                <IonCardHeader>
                  <IonCardTitle className="scan-section-title done-title">
                    Already scanned ({done.length})
                  </IonCardTitle>
                </IonCardHeader>
                <IonCardContent className="scan-card-body">
                  <IonList lines="none">
                    {done.map(kid => {
                      const rec = scans.find(s => s.kid_id === kid.id);
                      return (
                        <IonItem key={kid.id} className="scan-item-done">
                          <IonLabel>
                            <h2>{kid.name}</h2>
                            <p>{kid.grade}</p>
                          </IonLabel>
                          {rec && (
                            <IonBadge
                              slot="end"
                              style={{ background: PILLAR_COLORS[rec.pillar] ?? '#aaa' }}
                            >
                              P{rec.pillar} · #{rec.seq}
                            </IonBadge>
                          )}
                          <IonIcon icon={checkmarkCircle} color="success" slot="end" style={{ marginLeft: 8 }} />
                        </IonItem>
                      );
                    })}
                  </IonList>
                </IonCardContent>
              </IonCard>
            )}
          </>
        )}

        <IonToast
          isOpen={showToast}
          message={toastMsg}
          duration={2500}
          color={toastColor}
          onDidDismiss={() => setShowToast(false)}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default ScanStation;
