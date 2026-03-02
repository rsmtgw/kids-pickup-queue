import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonIcon,
  IonSpinner,
  IonToast,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonInput,
  IonItem,
  IonBadge,
  IonChip,
} from '@ionic/react';
import {
  qrCodeOutline,
  checkmarkCircle,
  closeCircleOutline,
  personOutline,
  schoolOutline,
  scanOutline,
  keypadOutline,
  refreshOutline,
  timeOutline,
} from 'ionicons/icons';
import { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner, Html5QrcodeScanType } from 'html5-qrcode';
import { scanApi } from '../services/api';
import './ParentScan.css';

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:8000/api';

interface KidLookupResult {
  kid: {
    id: number;
    name: string;
    grade: string;
    parent_name: string;
    parent_phone: string;
    pickup_code: string;
  };
  parent: { id: number; name: string } | null;
  scan: { seq: number; queue_status: string; pillar: number } | null;
}

type PageState = 'scanner' | 'confirming' | 'success' | 'already';

const ParentScan: React.FC = () => {
  const [pageState, setPageState]     = useState<PageState>('scanner');
  const [manualCode, setManualCode]   = useState('');
  const [lookupResult, setLookupResult] = useState<KidLookupResult | null>(null);
  const [scanResult, setScanResult]   = useState<{ seq: number; pillar: number } | null>(null);
  const [loading, setLoading]         = useState(false);
  const [toastMsg, setToastMsg]       = useState('');
  const [toastColor, setToastColor]   = useState<'success' | 'danger'>('success');
  const [showToast, setShowToast]     = useState(false);
  const [useManual, setUseManual]     = useState(false);

  const scannerRef  = useRef<Html5QrcodeScanner | null>(null);
  const scannerElId = 'ps-qr-reader';

  const flash = (msg: string, color: 'success' | 'danger' = 'success') => {
    setToastMsg(msg);
    setToastColor(color);
    setShowToast(true);
  };

  // ── Init / destroy camera scanner ────────────────────────────────────────
  useEffect(() => {
    if (pageState !== 'scanner' || useManual) return;

    const scanner = new Html5QrcodeScanner(
      scannerElId,
      {
        fps: 10,
        qrbox: { width: 260, height: 160 },
        supportedScanTypes: [
          Html5QrcodeScanType.SCAN_TYPE_CAMERA,
        ],
        rememberLastUsedCamera: true,
      },
      false,
    );

    scanner.render(
      (decodedText) => {
        // decodedText is the raw value encoded in the barcode/QR (= pickup_code)
        scanner.clear().catch(() => {});
        handleCodeDetected(decodedText.trim().toUpperCase());
      },
      () => { /* ignore per-frame decode errors */ },
    );

    scannerRef.current = scanner;
    return () => {
      scanner.clear().catch(() => {});
      scannerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageState, useManual]);

  // ── Lookup kid by code ───────────────────────────────────────────────────
  const handleCodeDetected = async (code: string) => {
    if (!code) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/kids/by-code/${encodeURIComponent(code)}`);
      if (!res.ok) {
        flash(`No kid found with code "${code}". Check the code and try again.`, 'danger');
        setLoading(false);
        return;
      }
      const data: KidLookupResult = await res.json();
      setLookupResult(data);
      if (data.scan) {
        setPageState('already');
      } else {
        setPageState('confirming');
      }
    } catch {
      flash('Server unreachable. Is the backend running?', 'danger');
    } finally {
      setLoading(false);
    }
  };

  const handleManualSubmit = () => {
    const code = manualCode.trim().toUpperCase();
    if (code.length < 3) { flash('Enter a valid pickup code', 'danger'); return; }
    handleCodeDetected(code);
  };

  // ── Submit check-in ──────────────────────────────────────────────────────
  const handleCheckIn = async () => {
    if (!lookupResult) return;
    setLoading(true);
    try {
      const record = await scanApi.scan({
        kid_id: lookupResult.kid.id,
        name:   lookupResult.kid.name,
      });
      setScanResult({ seq: record.seq, pillar: record.pillar });
      setPageState('success');
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('409') || msg.includes('already')) {
        flash('This kid is already checked in.', 'danger');
      } else {
        flash('Check-in failed. Please try again.', 'danger');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Reset to scanner ─────────────────────────────────────────────────────
  const handleReset = () => {
    setPageState('scanner');
    setLookupResult(null);
    setScanResult(null);
    setManualCode('');
    setUseManual(false);
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar color="primary">
          <IonIcon icon={qrCodeOutline} slot="start" className="ps-header-icon" />
          <IonTitle>Parent Scan</IonTitle>
          {pageState !== 'scanner' && (
            <IonButton slot="end" fill="clear" color="light" onClick={handleReset}>
              <IonIcon icon={refreshOutline} slot="icon-only" />
            </IonButton>
          )}
        </IonToolbar>
      </IonHeader>

      <IonContent className="ps-content">

        {/* ── SCANNER STATE ─────────────────────────────────────────────── */}
        {pageState === 'scanner' && (
          <div className="ps-scanner-wrapper">
            <p className="ps-hint">Point the camera at your child's QR / barcode</p>

            {!useManual ? (
              <>
                {/* html5-qrcode mounts here */}
                <div id={scannerElId} className="ps-qr-reader" />

                <div className="ps-divider">
                  <span>or enter code manually</span>
                </div>
              </>
            ) : null}

            {/* Manual entry (always visible below scanner) */}
            <div className="ps-manual-row">
              <IonItem lines="full" className="ps-manual-item">
                <IonIcon icon={keypadOutline} slot="start" color="primary" />
                <IonInput
                  placeholder="e.g. AB3X7Z"
                  value={manualCode}
                  onIonInput={e => setManualCode((e.detail.value ?? '').toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && handleManualSubmit()}
                  maxlength={12}
                  clearInput
                />
              </IonItem>
              <IonButton
                expand="block"
                className="ps-manual-btn"
                disabled={loading || manualCode.trim().length < 3}
                onClick={handleManualSubmit}
              >
                {loading
                  ? <IonSpinner name="crescent" />
                  : <><IonIcon icon={scanOutline} slot="start" />Look Up Code</>}
              </IonButton>
            </div>
          </div>
        )}

        {/* ── CONFIRMING STATE ─────────────────────────────────────────── */}
        {(pageState === 'confirming' || pageState === 'already') && lookupResult && (
          <div className="ps-card-wrapper">
            <IonCard className={`ps-kid-card ${pageState === 'already' ? 'already' : ''}`}>
              <IonCardHeader>
                <div className="ps-kid-avatar">
                  {lookupResult.kid.name.charAt(0).toUpperCase()}
                </div>
                <IonCardTitle className="ps-kid-name">{lookupResult.kid.name}</IonCardTitle>
              </IonCardHeader>

              <IonCardContent>
                <div className="ps-kid-details">
                  <div className="ps-detail-row">
                    <IonIcon icon={schoolOutline} color="primary" />
                    <span>{lookupResult.kid.grade}</span>
                  </div>
                  <div className="ps-detail-row">
                    <IonIcon icon={personOutline} color="secondary" />
                    <span>{lookupResult.kid.parent_name}</span>
                  </div>
                  <div className="ps-detail-row">
                    <IonIcon icon={qrCodeOutline} color="medium" />
                    <IonBadge color="light" className="ps-code-badge">
                      {lookupResult.kid.pickup_code}
                    </IonBadge>
                  </div>
                </div>

                {pageState === 'already' && lookupResult.scan && (
                  <div className="ps-already-msg">
                    <IonIcon icon={checkmarkCircle} color="success" />
                    <span>
                      Already checked in — queue position&nbsp;
                      <strong>#{lookupResult.scan.seq}</strong>
                      &nbsp;· Status:&nbsp;
                      <IonChip color={
                        lookupResult.scan.queue_status === 'done' ? 'success'
                        : lookupResult.scan.queue_status === 'pickup' ? 'warning'
                        : 'primary'
                      } className="ps-status-chip">
                        {lookupResult.scan.queue_status}
                      </IonChip>
                    </span>
                  </div>
                )}

                {pageState === 'confirming' && (
                  <>
                    <p className="ps-confirm-hint">Is this the right child?</p>
                    <div className="ps-action-row">
                      <IonButton
                        className="ps-cancel-btn"
                        fill="outline"
                        color="medium"
                        onClick={handleReset}
                      >
                        <IonIcon icon={closeCircleOutline} slot="start" />
                        Wrong Kid
                      </IonButton>
                      <IonButton
                        className="ps-checkin-btn"
                        color="success"
                        disabled={loading}
                        onClick={handleCheckIn}
                      >
                        {loading
                          ? <IonSpinner name="crescent" />
                          : <><IonIcon icon={checkmarkCircle} slot="start" />Check In</>}
                      </IonButton>
                    </div>
                  </>
                )}

                {pageState === 'already' && (
                  <IonButton expand="block" className="ps-scan-another" onClick={handleReset}>
                    <IonIcon icon={qrCodeOutline} slot="start" />
                    Scan Another
                  </IonButton>
                )}
              </IonCardContent>
            </IonCard>
          </div>
        )}

        {/* ── SUCCESS STATE ────────────────────────────────────────────── */}
        {pageState === 'success' && lookupResult && scanResult && (
          <div className="ps-success-wrapper">
            <div className="ps-success-icon">
              <IonIcon icon={checkmarkCircle} color="success" />
            </div>
            <h2 className="ps-success-title">Checked In!</h2>
            <p className="ps-success-name">{lookupResult.kid.name}</p>

            <IonCard className="ps-success-card">
              <IonCardContent>
                <div className="ps-success-stat">
                  <IonIcon icon={timeOutline} color="primary" />
                  <div>
                    <p className="ps-stat-label">Queue Position</p>
                    <p className="ps-stat-value">#{scanResult.seq}</p>
                  </div>
                </div>
                <div className="ps-success-stat">
                  <IonIcon icon={personOutline} color="secondary" />
                  <div>
                    <p className="ps-stat-label">Parent</p>
                    <p className="ps-stat-value">{lookupResult.kid.parent_name}</p>
                  </div>
                </div>
                <div className="ps-success-stat">
                  <IonIcon icon={schoolOutline} color="tertiary" />
                  <div>
                    <p className="ps-stat-label">Grade</p>
                    <p className="ps-stat-value">{lookupResult.kid.grade}</p>
                  </div>
                </div>
              </IonCardContent>
            </IonCard>

            <p className="ps-success-hint">
              You'll be called when your child reaches a pickup pillar.
            </p>

            <IonButton expand="block" className="ps-scan-another" onClick={handleReset}>
              <IonIcon icon={qrCodeOutline} slot="start" />
              Scan Another Kid
            </IonButton>
          </div>
        )}

        <IonToast
          isOpen={showToast}
          message={toastMsg}
          duration={3000}
          color={toastColor}
          onDidDismiss={() => setShowToast(false)}
          position="top"
        />
      </IonContent>
    </IonPage>
  );
};

export default ParentScan;
