import { useState, useEffect, useRef, useCallback } from 'react';
import { aiApi, type AiAnalysis, type QueueMetrics } from '../services/api';

type ChatMsg = { role: 'user' | 'ai'; text: string };

/* ── Styles ─────────────────────────────────────────────────────────────────── */
const PANEL: React.CSSProperties = {
  background: '#12122a', border: '1px solid #ffffff18', borderRadius: 10,
  padding: 14, margin: '0 16px 8px', fontFamily: 'Inter, system-ui, sans-serif',
  color: '#ccc', fontSize: 13,
};
const HEADER_BTN: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
  background: '#1a1a3a', border: '1px solid #ffffff12', borderRadius: 8,
  padding: '8px 14px', cursor: 'pointer', color: '#ccc', fontSize: 13,
};
const BADGE = (bg: string, fg: string): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 10px', borderRadius: 99,
  fontWeight: 700, fontSize: 11, letterSpacing: 0.5,
  background: bg, color: fg,
});
const healthColor: Record<string, { bg: string; fg: string }> = {
  green:  { bg: '#10dc6022', fg: '#10dc60' },
  yellow: { bg: '#ffce0022', fg: '#ffce00' },
  red:    { bg: '#f0414122', fg: '#f04141' },
};
const severityColor: Record<string, { bg: string; fg: string }> = {
  info:     { bg: '#3880ff22', fg: '#3880ff' },
  warning:  { bg: '#ffce0022', fg: '#ffce00' },
  critical: { bg: '#f0414122', fg: '#f04141' },
};

/* ── Component ──────────────────────────────────────────────────────────────── */
const AiDashboard: React.FC = () => {
  const [open, setOpen]           = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [analysis, setAnalysis]   = useState<AiAnalysis | null>(null);
  const [metrics, setMetrics]     = useState<QueueMetrics | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Chat state */
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput]       = useState('');
  const [chatLoading, setChatLoading]   = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  /* Scroll chat to bottom on new messages */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  /* Fetch raw metrics (cheap, no AI) */
  const fetchMetrics = useCallback(async () => {
    try {
      const m = await aiApi.getMetrics();
      setMetrics(m);
    } catch { /* ignore – server might be offline */ }
  }, []);

  /* Fetch full AI analysis */
  const fetchAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const a = await aiApi.analyze();
      setAnalysis(a);
      setMetrics(a.metrics);
    } catch (e: any) {
      setError(e?.message ?? 'AI analysis failed');
    } finally {
      setLoading(false);
    }
  }, []);

  /* Load metrics when panel opens */
  useEffect(() => {
    if (open) fetchMetrics();
  }, [open, fetchMetrics]);

  /* Auto-refresh metrics every 10s when enabled */
  useEffect(() => {
    if (autoRefresh && open) {
      intervalRef.current = setInterval(fetchMetrics, 10_000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, open, fetchMetrics]);

  /* Send chat question */
  const sendChat = useCallback(async () => {
    const q = chatInput.trim();
    if (!q || chatLoading) return;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: q }]);
    setChatLoading(true);
    try {
      const res = await aiApi.chat(q);
      setChatMessages(prev => [...prev, { role: 'ai', text: res.answer }]);
    } catch (e: any) {
      setChatMessages(prev => [...prev, { role: 'ai', text: `Error: ${e?.message ?? 'Failed to get response'}` }]);
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatLoading]);

  /* ── Render ───────────────────────────────────────────────────────────────── */
  return (
    <div style={{ margin: '0 16px 4px' }}>
      {/* Toggle button */}
      <button onClick={() => setOpen(v => !v)} style={HEADER_BTN}>
        <span style={{ fontSize: 16 }}>🤖</span>
        <span style={{ fontWeight: 600 }}>AI Queue Optimizer</span>
        {analysis && (
          <span style={BADGE(
            healthColor[analysis.queue_health]?.bg ?? '#ffffff22',
            healthColor[analysis.queue_health]?.fg ?? '#ccc',
          )}>
            {analysis.queue_health.toUpperCase()}
          </span>
        )}
        {analysis?.parent_alert?.should_alert && (
          <span style={BADGE(
            severityColor[analysis.parent_alert.severity]?.bg ?? '#ffce0022',
            severityColor[analysis.parent_alert.severity]?.fg ?? '#ffce00',
          )}>
            ⚠ PARENT ALERT
          </span>
        )}
        <span style={{ marginLeft: 'auto', color: '#ffffff44', fontSize: 11 }}>
          {open ? '▲ hide' : '▼ show'}
        </span>
      </button>

      {/* Panel body */}
      {open && (
        <div style={PANEL}>
          {/* Action bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={fetchAnalysis}
              disabled={loading}
              style={{
                padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: '#3880ff', color: '#fff', fontWeight: 600, fontSize: 12,
                opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? '⏳ Analyzing…' : '🧠 Analyze with AI'}
            </button>
            <button
              onClick={fetchMetrics}
              style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid #ffffff22',
                background: 'transparent', color: '#aaa', fontSize: 12, cursor: 'pointer',
              }}
            >
              🔄 Refresh Metrics
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888', cursor: 'pointer' }}>
              <input
                type="checkbox" checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
                style={{ accentColor: '#3880ff' }}
              />
              Auto-refresh (10s)
            </label>
          </div>

          {error && (
            <div style={{ background: '#f0414122', color: '#f04141', padding: '8px 12px', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>
              {error}
            </div>
          )}

          {/* ── Metrics Grid ─────────────────────────────────────────────── */}
          {metrics && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 12 }}>
              <MetricCard label="Total Scanned" value={metrics.total_scanned} color="#3880ff" />
              <MetricCard label="Waiting" value={metrics.waiting} color="#ffce00" />
              <MetricCard label="In Pickup" value={metrics.in_pickup} color="#ff6b35" />
              <MetricCard label="Done" value={metrics.done} color="#10dc60" />
              <MetricCard label="Avg Pickup" value={`${metrics.avg_pickup_time_sec}s`} color="#a78bfa" />
              <MetricCard label="Throughput" value={`${metrics.throughput_per_min}/min`} color="#06d6a0" />
              <MetricCard label="Avg Wait" value={`${metrics.avg_current_wait_sec}s`} color="#f9844a" />
              <MetricCard label="Max Pickup" value={`${metrics.max_pickup_time_sec}s`} color="#f04141" />
            </div>
          )}

          {/* ── Per-Pillar Stats ──────────────────────────────────────────── */}
          {metrics?.pillar_stats && Object.keys(metrics.pillar_stats).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600, letterSpacing: 0.5 }}>PILLAR BREAKDOWN</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(metrics.pillar_stats).map(([name, ps]) => (
                  <div key={name} style={{
                    flex: '1 1 100px', background: '#ffffff08', borderRadius: 6,
                    padding: '6px 10px', fontSize: 11, lineHeight: 1.6,
                  }}>
                    <div style={{ fontWeight: 700, color: '#3880ff' }}>{name}</div>
                    <div>Done: {ps.done}/{ps.total}</div>
                    <div>Waiting: {ps.waiting}</div>
                    <div>Avg: {ps.avg_pickup_sec}s</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── AI Analysis Results ──────────────────────────────────────── */}
          {analysis && (
            <>
              {/* Summary */}
              <div style={{
                background: healthColor[analysis.queue_health]?.bg ?? '#ffffff08',
                border: `1px solid ${healthColor[analysis.queue_health]?.fg ?? '#ffffff22'}33`,
                borderRadius: 8, padding: '10px 14px', marginBottom: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={BADGE(
                    healthColor[analysis.queue_health]?.bg ?? '#ffffff22',
                    healthColor[analysis.queue_health]?.fg ?? '#ccc',
                  )}>
                    {analysis.queue_health === 'green' ? '✅' : analysis.queue_health === 'yellow' ? '⚠️' : '🔴'}
                    {' '}{analysis.queue_health.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 12, color: '#aaa' }}>Queue Health</span>
                </div>
                <div style={{ fontSize: 13, color: '#ddd', lineHeight: 1.5 }}>{analysis.summary}</div>
              </div>

              {/* Parent Alert */}
              {analysis.parent_alert?.should_alert && (
                <div style={{
                  background: severityColor[analysis.parent_alert.severity]?.bg ?? '#ffce0022',
                  border: `1px solid ${severityColor[analysis.parent_alert.severity]?.fg ?? '#ffce00'}55`,
                  borderRadius: 8, padding: '10px 14px', marginBottom: 10,
                  animation: analysis.parent_alert.severity === 'critical' ? 'viz-countdown-pulse 1s ease-in-out infinite' : undefined,
                }}>
                  <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4, color: severityColor[analysis.parent_alert.severity]?.fg }}>
                    📢 PARENT ALERT — {analysis.parent_alert.severity.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 13, color: '#ddd', lineHeight: 1.5 }}>
                    {analysis.parent_alert.message}
                  </div>
                </div>
              )}

              {/* Key numbers */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <KeyVal label="Optimal Batch" value={analysis.optimal_batch_size} />
                <KeyVal label="Countdown" value={`${analysis.recommended_countdown_sec}s`} />
                <KeyVal label="Est. Wait" value={`${analysis.estimated_wait_for_new_car_sec}s`} />
                <KeyVal label="Bottleneck" value={analysis.bottleneck} />
              </div>

              {/* Recommendations */}
              {analysis.recommendations?.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <div style={{ fontSize: 11, color: '#888', fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>
                    AI RECOMMENDATIONS
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {analysis.recommendations.map((r, i) => (
                      <li key={i} style={{ fontSize: 12, color: '#bbb', lineHeight: 1.6 }}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {/* Empty state */}
          {!analysis && !metrics && !loading && chatMessages.length === 0 && (
            <div style={{ color: '#ffffff33', textAlign: 'center', padding: '16px 0', fontSize: 12 }}>
              Click "Analyze with AI" or ask a question below.
            </div>
          )}

          {/* ── Chat Section ─────────────────────────────────────────── */}
          <div style={{ marginTop: 12, borderTop: '1px solid #ffffff12', paddingTop: 10 }}>
            <div style={{ fontSize: 11, color: '#888', fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>💬 ASK AI</div>

            {/* Chat messages */}
            {chatMessages.length > 0 && (
              <div style={{
                maxHeight: 220, overflowY: 'auto', marginBottom: 8,
                background: '#0a0a1e', borderRadius: 6, padding: '8px 10px',
              }}>
                {chatMessages.map((msg, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 8, marginBottom: 8,
                    flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                  }}>
                    <div style={{
                      fontSize: 16, flexShrink: 0, marginTop: 2,
                    }}>{msg.role === 'user' ? '👤' : '🤖'}</div>
                    <div style={{
                      background: msg.role === 'user' ? '#3880ff22' : '#ffffff08',
                      border: `1px solid ${msg.role === 'user' ? '#3880ff33' : '#ffffff12'}`,
                      borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      padding: '8px 12px', fontSize: 12, lineHeight: 1.6,
                      color: '#ddd', maxWidth: '85%', whiteSpace: 'pre-wrap',
                    }}>{msg.text}</div>
                  </div>
                ))}
                {chatLoading && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 16 }}>🤖</span>
                    <div style={{
                      background: '#ffffff08', border: '1px solid #ffffff12',
                      borderRadius: '12px 12px 12px 2px',
                      padding: '8px 12px', fontSize: 12, color: '#888',
                    }}>Thinking...</div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}

            {/* Input */}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendChat(); }}
                placeholder="Ask about queue times, recommendations, when to leave..."
                disabled={chatLoading}
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 6,
                  border: '1px solid #ffffff22', background: '#0a0a1e',
                  color: '#ddd', fontSize: 12, outline: 'none',
                }}
              />
              <button
                onClick={sendChat}
                disabled={chatLoading || !chatInput.trim()}
                style={{
                  padding: '8px 16px', borderRadius: 6, border: 'none',
                  background: chatLoading || !chatInput.trim() ? '#333' : '#3880ff',
                  color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer',
                  opacity: chatLoading || !chatInput.trim() ? 0.5 : 1,
                }}
              >Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Helper Components ──────────────────────────────────────────────────────── */
const MetricCard: React.FC<{ label: string; value: string | number; color: string }> = ({ label, value, color }) => (
  <div style={{
    background: '#ffffff08', borderRadius: 6, padding: '8px 10px',
    borderLeft: `3px solid ${color}`,
  }}>
    <div style={{ fontSize: 10, color: '#888', letterSpacing: 0.3, marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'monospace' }}>{value}</div>
  </div>
);

const KeyVal: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div style={{
    background: '#ffffff08', borderRadius: 6, padding: '6px 12px',
    display: 'flex', gap: 6, alignItems: 'center',
  }}>
    <span style={{ fontSize: 10, color: '#888' }}>{label}:</span>
    <span style={{ fontSize: 13, fontWeight: 600, color: '#ddd' }}>{value}</span>
  </div>
);

export default AiDashboard;
