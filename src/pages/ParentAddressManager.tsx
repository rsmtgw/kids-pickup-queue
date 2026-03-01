// ParentAddressManager — Admin tool to update parent home addresses via Google Maps Places
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonSearchbar, IonList, IonItem, IonLabel, IonModal,
  IonButton, IonButtons, IonIcon, IonSpinner, IonBadge, IonToast,
} from '@ionic/react';
import { closeOutline, saveOutline, locationOutline, refreshOutline } from 'ionicons/icons';
import { parentApi, type ParentDTO } from '../services/api';
import './ParentAddressManager.css';

/* ── Lazy-load Google Maps JS (with Places library) ─────────────── */
let _gmapsPromise: Promise<void> | null = null;

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (_gmapsPromise) return _gmapsPromise;
  _gmapsPromise = new Promise<void>((resolve, reject) => {
    // Already loaded?
    if ((window as any).google?.maps?.places) { resolve(); return; }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload  = () => resolve();
    script.onerror = () => { _gmapsPromise = null; reject(new Error('Google Maps failed to load')); };
    document.head.appendChild(script);
  });
  return _gmapsPromise;
}

/* ─────────────────────────────────────────────────────────────────── */
interface PendingPlace { lat: number; lng: number; address: string; }

const ParentAddressManager: React.FC = () => {
  const [parents,    setParents]    = useState<ParentDTO[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [mapsKey,    setMapsKey]    = useState('');
  const [mapsReady,  setMapsReady]  = useState(false);
  const [mapsError,  setMapsError]  = useState('');
  const [selected,   setSelected]   = useState<ParentDTO | null>(null);
  const [pending,    setPending]    = useState<PendingPlace | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [toast,      setToast]      = useState('');

  // Map + autocomplete DOM refs
  const mapDivRef   = useRef<HTMLDivElement>(null);
  const acInputRef  = useRef<HTMLInputElement>(null);
  const mapInstRef  = useRef<any>(null);
  const markerRef   = useRef<any>(null);
  const acRef       = useRef<any>(null);

  /* ── Fetch parents list and Maps API key on mount ─────────────── */
  useEffect(() => {
    Promise.all([
      parentApi.getAll(),
      fetch('/api/dev/maps-key').then(r => r.json()),
    ]).then(([plist, keyData]) => {
      setParents(plist);
      const key = keyData?.key || '';
      setMapsKey(key);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  /* ── Load Google Maps SDK once key is known ───────────────────── */
  useEffect(() => {
    if (!mapsKey) return;
    loadGoogleMaps(mapsKey)
      .then(() => setMapsReady(true))
      .catch(e => setMapsError(e.message));
  }, [mapsKey]);

  /* ── Refresh parent list ──────────────────────────────────────── */
  const refreshParents = () => {
    parentApi.getAll().then(setParents).catch(console.error);
  };

  /* ── Init Google Map + Autocomplete after modal animates in ───── */
  const initMapAndAC = useCallback(() => {
    if (!mapsReady || !mapDivRef.current || !acInputRef.current || !selected) return;

    const g = (window as any).google.maps;

    const center = { lat: selected.location_lat, lng: selected.location_lng };

    // Map
    const map = new g.Map(mapDivRef.current, {
      center,
      zoom: 15,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    mapInstRef.current = map;

    // Draggable marker
    const marker = new g.Marker({ map, position: center, draggable: true });
    markerRef.current = marker;

    // Drag end → reverse geocode
    marker.addListener('dragend', () => {
      const pos = marker.getPosition();
      if (!pos) return;
      const lat = pos.lat();
      const lng = pos.lng();
      const geocoder = new g.Geocoder();
      geocoder.geocode({ location: { lat, lng } }, (results: any[], status: string) => {
        const addr = (status === 'OK' && results[0])
          ? results[0].formatted_address
          : `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        setPending({ lat, lng, address: addr });
        if (acInputRef.current) acInputRef.current.value = addr;
      });
    });

    // Places Autocomplete
    const ac = new g.places.Autocomplete(acInputRef.current, {
      fields: ['geometry', 'formatted_address'],
    });
    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      if (!place?.geometry?.location) return;
      const lat     = place.geometry.location.lat();
      const lng     = place.geometry.location.lng();
      const address = place.formatted_address || '';
      setPending({ lat, lng, address });
      map.panTo({ lat, lng });
      map.setZoom(16);
      marker.setPosition({ lat, lng });
    });
    acRef.current = ac;
  }, [mapsReady, selected]);

  /* ── Dismiss / cleanup ────────────────────────────────────────── */
  const handleDismiss = () => {
    setSelected(null);
    setPending(null);
    mapInstRef.current = null;
    markerRef.current  = null;
    acRef.current      = null;
  };

  /* ── Save address ─────────────────────────────────────────────── */
  const handleSave = async () => {
    if (!selected || !pending) return;
    setSaving(true);
    try {
      const updated = await parentApi.updateLocation(
        selected.id, pending.lat, pending.lng, pending.address
      );
      setParents(ps => ps.map(p => p.id === selected.id ? { ...p, ...updated } : p));
      setToast(`✅ ${selected.name}'s address saved`);
      handleDismiss();
    } catch {
      setToast('❌ Failed to save — check console');
    } finally {
      setSaving(false);
    }
  };

  /* ── Filtered list ────────────────────────────────────────────── */
  const filtered = parents.filter(p =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.location_address || '').toLowerCase().includes(search.toLowerCase())
  );

  /* ─────────────────────────────────────────────────────────────── */
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>📍 Parent Addresses</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={refreshParents} title="Refresh">
              <IonIcon icon={refreshOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent>
        {/* ── Key warning ── */}
        {!loading && !mapsKey && (
          <div className="pam-notice">
            ⚠️ Google Maps API key not configured. Go to the <strong>Developer</strong> tab to add it, then return here.
          </div>
        )}
        {mapsError && (
          <div className="pam-notice pam-notice--error">
            ❌ {mapsError}
          </div>
        )}

        <IonSearchbar
          value={search}
          onIonInput={e => setSearch(e.detail.value || '')}
          placeholder="Search by name or address…"
          debounce={200}
        />

        {loading ? (
          <div className="pam-loading"><IonSpinner name="crescent" /> Loading parents…</div>
        ) : (
          <IonList>
            {filtered.map(p => (
              <IonItem
                key={p.id}
                button
                onClick={() => { setSelected(p); setPending(null); }}
                className="pam-parent-item"
              >
                <IonIcon icon={locationOutline} slot="start" color="primary" />
                <IonLabel>
                  <h2>{p.name}</h2>
                  <p className="pam-address">{p.location_address || <em>No address set</em>}</p>
                  <p className="pam-meta">
                    {p.distance_km} km &nbsp;·&nbsp; {p.travel_time_traffic_min} min drive
                    &nbsp;·&nbsp; <span className={`pam-traffic pam-traffic--${p.traffic_condition}`}>{p.traffic_condition}</span>
                  </p>
                </IonLabel>
                <IonBadge slot="end" color="medium">#{p.id}</IonBadge>
              </IonItem>
            ))}
            {filtered.length === 0 && (
              <IonItem>
                <IonLabel className="ion-text-center" color="medium">No parents found</IonLabel>
              </IonItem>
            )}
          </IonList>
        )}

        {/* ══ Address Edit Modal ══════════════════════════════════ */}
        <IonModal
          isOpen={!!selected}
          onDidPresent={initMapAndAC}
          onDidDismiss={handleDismiss}
          className="pam-modal"
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>{selected?.name ?? 'Edit Address'}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={handleDismiss}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="pam-modal-content">
            {/* Current address */}
            <div className="pam-info-row">
              <span className="pam-info-label">Current address:</span>
              <span className="pam-info-value">{selected?.location_address || '—'}</span>
            </div>
            <div className="pam-info-row">
              <span className="pam-info-label">Coordinates:</span>
              <span className="pam-info-value">
                {selected?.location_lat?.toFixed(5)}, {selected?.location_lng?.toFixed(5)}
              </span>
            </div>

            {/* Autocomplete input */}
            <div className="pam-search-wrap">
              <IonIcon icon={locationOutline} className="pam-search-icon" />
              <input
                ref={acInputRef}
                type="text"
                className="pam-ac-input"
                placeholder={mapsReady ? 'Search new address…' : 'Loading Google Maps…'}
                disabled={!mapsReady}
              />
            </div>

            {/* Map */}
            {!mapsReady && !mapsError && (
              <div className="pam-map-placeholder">
                <IonSpinner name="crescent" />
                <span>Loading map…</span>
              </div>
            )}
            <div
              ref={mapDivRef}
              className="pam-map"
              style={{ display: mapsReady ? 'block' : 'none' }}
            />

            {/* Selected address preview */}
            {pending && (
              <div className="pam-pending">
                <div className="pam-pending-label">📍 New address selected:</div>
                <div className="pam-pending-address">{pending.address}</div>
                <div className="pam-pending-coords">
                  {pending.lat.toFixed(6)}, {pending.lng.toFixed(6)}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="pam-actions">
              <IonButton
                expand="block"
                onClick={handleSave}
                disabled={!pending || saving}
                color="primary"
              >
                {saving
                  ? <IonSpinner name="crescent" />
                  : <><IonIcon icon={saveOutline} slot="start" /> Save Address</>
                }
              </IonButton>
              <IonButton expand="block" fill="outline" color="medium" onClick={handleDismiss}>
                Cancel
              </IonButton>
            </div>
          </IonContent>
        </IonModal>

        <IonToast
          isOpen={!!toast}
          message={toast}
          duration={3000}
          onDidDismiss={() => setToast('')}
        />
      </IonContent>
    </IonPage>
  );
};

export default ParentAddressManager;
