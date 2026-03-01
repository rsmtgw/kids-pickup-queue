import React, { useState, useEffect } from "react";
import "./DeveloperTab.css";

const defaultKeys = {
  GOOGLE_MAPS_API_KEY: "",
  GOOGLE_GEMINI_API_KEY: "",
  JWT_SECRET: ""
};
const defaultSettings = {
  NUM_PARENTS: "",
  TRAVEL_TIME_CACHE_TTL: "",
};

export default function DeveloperTab() {
  const [keys, setKeys] = useState(defaultKeys);
  const [settings, setSettings] = useState(defaultSettings);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load existing keys (masked) from backend
    fetch("/api/dev/keys")
      .then((r) => r.json())
      .then((data) => {
        const loadedKeys = { ...defaultKeys };
        const loadedSettings = { ...defaultSettings };
        if (data && data.keys) {
          Object.entries(data.keys).forEach(([k, v]) => {
            const val = v && v.indexOf("...") >= 0 ? "" : v;
            if (k in loadedKeys) loadedKeys[k] = val;
            if (k in loadedSettings) loadedSettings[k] = val;
          });
        }
        setKeys(loadedKeys);
        setSettings(loadedSettings);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.name;
    const value = e.target.value;
    if (name in keys) setKeys({ ...keys, [name]: value });
    else setSettings({ ...settings, [name]: value });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaved(false);
    try {
      const payload = {
        GOOGLE_MAPS_API_KEY: keys.GOOGLE_MAPS_API_KEY || undefined,
        GOOGLE_GEMINI_API_KEY: keys.GOOGLE_GEMINI_API_KEY || undefined,
        JWT_SECRET: keys.JWT_SECRET || undefined,
        NUM_PARENTS: settings.NUM_PARENTS ? Number(settings.NUM_PARENTS) : undefined,
        TRAVEL_TIME_CACHE_TTL: settings.TRAVEL_TIME_CACHE_TTL ? Number(settings.TRAVEL_TIME_CACHE_TTL) : undefined,
      };
      await fetch("/api/dev/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setSaved(true);
    } catch (err) {
      console.error(err);
      setSaved(false);
      alert("Failed to save keys");
    }
  };

  if (loading) return <div className="developer-tab">Loading…</div>;

  return (
    <div className="developer-tab">
      <h2>Developer API Key Management</h2>
      <div className="key-form">
        <label>
          Google Maps API Key:
          <input
            type="text"
            name="GOOGLE_MAPS_API_KEY"
            value={keys.GOOGLE_MAPS_API_KEY}
            onChange={handleChange}
            placeholder="Enter Google Maps API Key"
          />
        </label>
        <label>
          Number of Parents (NUM_PARENTS):
          <input
            type="number"
            name="NUM_PARENTS"
            value={settings.NUM_PARENTS}
            onChange={handleChange}
            placeholder="20"
          />
        </label>
        <label>
          Travel Time Cache TTL (seconds):
          <input
            type="number"
            name="TRAVEL_TIME_CACHE_TTL"
            value={settings.TRAVEL_TIME_CACHE_TTL}
            onChange={handleChange}
            placeholder="3600"
          />
        </label>
        <label>
          Google Gemini API Key:
          <input
            type="text"
            name="GOOGLE_GEMINI_API_KEY"
            value={keys.GOOGLE_GEMINI_API_KEY}
            onChange={handleChange}
            placeholder="Enter Google Gemini API Key"
          />
        </label>
        <label>
          JWT Secret:
          <input
            type="text"
            name="JWT_SECRET"
            value={keys.JWT_SECRET}
            onChange={handleChange}
            placeholder="Enter JWT Secret"
          />
        </label>
        <button onClick={handleSave}>Save Keys</button>
        <button onClick={async () => {
          try {
            const r = await fetch('/api/dev/reseed', { method: 'POST' });
            const j = await r.json();
            alert('Reseeded: ' + (j.num_parents || j.reseeded));
          } catch (e) { console.error(e); alert('Reseed failed'); }
        }} style={{ marginLeft: 8 }}>Reseed Now</button>
        {saved && <div className="save-success">Keys saved!</div>}
      </div>
    </div>
  );
}
