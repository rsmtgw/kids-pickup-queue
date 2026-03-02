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
  useIonViewDidEnter,
  useIonViewWillLeave,
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
  videocamOutline,
  videocamOffOutline,
} from 'ionicons/icons';
import { useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
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
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError]   = useState('');

  const scannerRef  = useRef<Html5Qrcode | null>(null);
  const scannerElId = 'ps-qr-reader';

  const flash = (msg: string, color: 'success' | 'danger' = 'success') => {
    setToastMsg(msg);
    setToastColor(color);
    setShowToast(true);
  };

  // ── Start camera when page becomes visible (Ionic lifecycle) ────────────
  useIonViewDidEnter(() => {
    if (pageState === 'scanner') startCamera();
  });

  // ── Stop camera when navigating away ────────────────────────────────────
  useIonViewWillLeave(() => {
    stopCamera();
  });

  const startCamera = async () => {
    setCameraError('');
    // Small delay lets Ionic fully paint the div before we attach
    await new Promise(r => setTimeout(r, 200));
    const el = document.getElementById(scannerElId);
    if (!el) return;

    try {
      const qr = new Html5Qrcode(scannerElId, {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.DATA_MATRIX,
        ],
      });
      scannerRef.current = qr;

      await qr.start(
        { facingMode: 'environment' },   // rear camera
        {
          fps: 12,
          qrbox: { width: 280, height: 160 },
        },
        (decodedText) => {
          stopCamera();
          handleCodeDetected(decodedText.trim().toUpperCase());
        },
        () => { /* per-frame decode failures are normal — ignore */ },
      );
      setCameraActive(true);
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('notallowed')) {
        setCameraError('Camera permission denied. Please allow camera access in your browser settings, then tap "Start Camera" again.');
      } else if (msg.toLowerCase().includes('notfound') || msg.toLowerCase().includes('no camera')) {
        setCameraError('No camera found on this device. Use manual code entry below.');
      } else {
        setCameraError(`Camera error: ${msg}`);
      }
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    const qr = scannerRef.current;
    if (!qr) return;
    scannerRef.current = null;
    qr.isScanning
      ? qr.stop().then(() => qr.clear()).catch(() => {})
      : qr.clear();
    setCameraActive(false);
  };

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
    stopCamera();
    setPageState('scanner');
    setLookupResult(null);
    setScanResult(null);
    setManualCode('');
    setCameraError('');
    // restart camera after short delay so div re-renders first
    setTimeout(startCamera, 300);
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
            <p className="ps-hint">Point the rear camera at your child's QR code or barcode</p>

            {/* Camera viewport — html5-qrcode renders the video stream here */}
            <div id={scannerElId} className="ps-qr-reader" />

            {/* Camera controls */}
            <div className="ps-cam-controls">
              {!cameraActive ? (
                <IonButton
                  expand="block"
                  color="primary"
                  className="ps-cam-btn"
                  onClick={startCamera}
                  disabled={loading}
                >
                  <IonIcon icon={videocamOutline} slot="start" />
                  Start Camera
                </IonButton>
              ) : (
                <IonButton
                  expand="block"
                  fill="outline"
                  color="medium"
                  className="ps-cam-btn"
                  onClick={stopCamera}
                >
                  <IonIcon icon={videocamOffOutline} slot="start" />
                  Stop Camera
                </IonButton>
              )}
            </div>

            {/* Camera error */}
            {cameraError && (
              <div className="ps-cam-error">
                <IonIcon icon={videocamOffOutline} color="danger" />
                <p>{cameraError}</p>
              </div>
            )}

            <div className="ps-divider"><span>or enter code manually</span></div>

            {/* Manual entry */}
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
