import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart2, CheckCircle2, Clock, Zap, RefreshCw,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { apiClient } from '../api';

// ── Constants ────────────────────────────────────────────────────────────────

const DATE_RANGES = [
  { label: 'Last 7 days',  days: 7  },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

const STATUS_COLORS = {
  COMPLETED:  '#22c55e',
  FAILED:     '#ef4444',
  PROCESSING: '#3b82f6',
  ESCALATED:  '#f59e0b',
};

const DURATION_BUCKETS = [
  { label: '<100ms',   min: 0,      max: 100    },
  { label: '100-500ms',min: 100,    max: 500    },
  { label: '500ms-1s', min: 500,    max: 1000   },
  { label: '1-5s',     min: 1000,   max: 5000   },
  { label: '5-30s',    min: 5000,   max: 30000  },
  { label: '>30s',     min: 30000,  max: Infinity},
];

// ── Mock / sample data (shown when no real data) ──────────────────────────────

const SAMPLE_TREND = [
  { date:'2026-09-04', COMPLETED:120, FAILED:8,  PROCESSING:14 },
  { date:'2026-09-05', COMPLETED:98,  FAILED:12, PROCESSING:9  },
  { date:'2026-09-06', COMPLETED:145, FAILED:6,  PROCESSING:20 },
  { date:'2026-09-07', COMPLETED:160, FAILED:14, PROCESSING:11 },
  { date:'2026-09-08', COMPLETED:132, FAILED:9,  PROCESSING:18 },
  { date:'2026-09-09', COMPLETED:174, FAILED:5,  PROCESSING:7  },
  { date:'2026-09-10', COMPLETED:189, FAILED:11, PROCESSING:15 },
];

const SAMPLE_STATUS_PIE = [
  { name:'COMPLETED',  value:1018 },
  { name:'FAILED',     value:65   },
  { name:'PROCESSING', value:94   },
  { name:'ESCALATED',  value:23   },
];

const SAMPLE_IFLOWS = [
  { name:'S4_to_ECC_Invoice',  count:245 },
  { name:'SFTP_Doc_Transfer',  count:198 },
  { name:'ECC_PO_Sync',        count:177 },
  { name:'CRM_Order_Push',     count:154 },
  { name:'MDG_Material_Sync',  count:132 },
  { name:'HR_Payroll_Feed',    count:110 },
  { name:'Ariba_PO_Reply',     count:98  },
  { name:'Concur_Expense',     count:84  },
  { name:'SuccessFactors_Sync',count:71  },
  { name:'BW_Delta_Extract',   count:55  },
];

const SAMPLE_DURATION = [
  { label:'<100ms',    count:310 },
  { label:'100-500ms', count:524 },
  { label:'500ms-1s',  count:289 },
  { label:'1-5s',      count:175 },
  { label:'5-30s',     count:87  },
  { label:'>30s',      count:15  },
];

const SAMPLE_ERRORS = [
  { iflow:'S4_to_ECC_Invoice',  count:24, lastFailed:'2026-09-10', error:'HTTP 500 Internal Server Error' },
  { iflow:'SFTP_Doc_Transfer',  count:18, lastFailed:'2026-09-09', error:'Connection timed out'           },
  { iflow:'CRM_Order_Push',     count:12, lastFailed:'2026-09-10', error:'Authentication failed'          },
  { iflow:'Ariba_PO_Reply',     count:7,  lastFailed:'2026-09-08', error:'Invalid SOAP response'          },
  { iflow:'BW_Delta_Extract',   count:4,  lastFailed:'2026-09-07', error:'Mapping exception'              },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseDuration(msg) {
  if (!msg) return null;
  const start = msg.LogStart ? new Date(msg.LogStart).getTime() : null;
  const end   = msg.LogEnd   ? new Date(msg.LogEnd).getTime()   : null;
  if (start && end && end > start) return end - start;
  return null;
}

function filterByDays(messages, days) {
  const cutoff = Date.now() - days * 86400000;
  return messages.filter(m => {
    const t = m.LogStart ? new Date(m.LogStart).getTime() : 0;
    return t >= cutoff;
  });
}

function buildTrendData(messages) {
  const byDate = messages.reduce((acc, m) => {
    const date = m.LogStart?.split('T')[0] || 'Unknown';
    if (!acc[date]) acc[date] = { date, COMPLETED: 0, FAILED: 0, PROCESSING: 0 };
    acc[date][m.Status] = (acc[date][m.Status] || 0) + 1;
    return acc;
  }, {});
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

function buildPieData(messages) {
  const counts = messages.reduce((acc, m) => {
    acc[m.Status] = (acc[m.Status] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([name, value]) => ({ name, value }));
}

function buildIflowData(messages) {
  const counts = messages.reduce((acc, m) => {
    const name = m.IntegrationFlowName || 'Unknown';
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function buildDurationData(messages) {
  const buckets = DURATION_BUCKETS.map(b => ({ label: b.label, count: 0 }));
  messages.forEach(m => {
    const ms = parseDuration(m);
    if (ms === null) return;
    const idx = DURATION_BUCKETS.findIndex(b => ms >= b.min && ms < b.max);
    if (idx >= 0) buckets[idx].count++;
  });
  return buckets;
}

function buildErrorData(messages) {
  const failed = messages.filter(m => m.Status === 'FAILED');
  const map = {};
  failed.forEach(m => {
    const key = m.IntegrationFlowName || 'Unknown';
    if (!map[key]) map[key] = { iflow: key, count: 0, lastFailed: null, errors: {} };
    map[key].count++;
    const ts = m.LogStart || '';
    if (!map[key].lastFailed || ts > map[key].lastFailed) map[key].lastFailed = ts?.split('T')[0] || '—';
    const err = m.ErrorInformation || m.ErrorMessage || '—';
    map[key].errors[err] = (map[key].errors[err] || 0) + 1;
  });
  return Object.values(map)
    .map(e => ({
      ...e,
      error: Object.entries(e.errors).sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
    }))
    .sort((a, b) => b.count - a.count);
}

function calcKpis(messages, stats) {
  const total = messages.length;
  const completed = messages.filter(m => m.Status === 'COMPLETED').length;
  const successRate = total > 0 ? Math.round((completed / total) * 100) : null;

  const durations = messages.map(parseDuration).filter(Boolean);
  const avgMs = durations.length > 0
    ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length)
    : null;

  // Peak hour: find the hour bucket with most messages
  const hourCounts = messages.reduce((acc, m) => {
    if (!m.LogStart) return acc;
    const hr = new Date(m.LogStart).getHours();
    acc[hr] = (acc[hr] || 0) + 1;
    return acc;
  }, {});
  let peakHour = null;
  if (Object.keys(hourCounts).length > 0) {
    const hr = parseInt(Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0][0]);
    peakHour = `${hr.toString().padStart(2, '0')}:00`;
  }

  return {
    total: total > 0 ? total.toLocaleString() : stats?.messagesToday ?? '—',
    successRate: successRate !== null ? `${successRate}%` : (stats?.successRate != null ? `${stats.successRate}%` : '—'),
    avgMs: avgMs !== null ? `${avgMs.toLocaleString()} ms` : '—',
    peakHour: peakHour ?? '—',
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ title, value, icon: Icon, iconBg, iconColor, delay, isSample }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }} whileHover={{ y: -3 }}
      className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-slate-500 font-medium mb-1">{title}</div>
          <div className="text-2xl font-bold text-slate-800">
            {value}
            {isSample && <span className="ml-2 text-xs font-normal text-slate-400">(sample)</span>}
          </div>
        </div>
        <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
          <Icon size={20} className={iconColor} />
        </div>
      </div>
    </motion.div>
  );
}

const TOOLTIP_STYLE = { borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: 12 };
const AXIS_TICK    = { fontSize: 11, fill: '#94a3b8' };

// ── Main component ────────────────────────────────────────────────────────────

export default function Analytics({ addToast }) {
  const [messages, setMessages]       = useState([]);
  const [stats, setStats]             = useState(null);
  const [loading, setLoading]         = useState(true);
  const [range, setRange]             = useState(30); // days
  const [isSample, setIsSample]       = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [msgRes, statsRes] = await Promise.allSettled([
        apiClient.get('/messages?top=200'),
        apiClient.get('/dashboard-stats'),
      ]);
      const msgs  = msgRes.status  === 'fulfilled' ? (msgRes.value.data?.results  ?? msgRes.value.data  ?? []) : [];
      const st    = statsRes.status === 'fulfilled' ? (statsRes.value.data ?? null) : null;
      setMessages(Array.isArray(msgs) ? msgs : []);
      setStats(st);
      setIsSample(msgs.length === 0);
    } catch (err) {
      addToast?.('Failed to load analytics: ' + (err.message || 'Unknown error'), 'error');
      setIsSample(true);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Derive chart data
  const filtered = filterByDays(messages, range);
  const useSample = isSample || filtered.length === 0;

  const trendData    = useSample ? SAMPLE_TREND    : buildTrendData(filtered);
  const pieData      = useSample ? SAMPLE_STATUS_PIE : buildPieData(filtered);
  const iflowData    = useSample ? SAMPLE_IFLOWS   : buildIflowData(filtered);
  const durationData = useSample ? SAMPLE_DURATION : buildDurationData(filtered);
  const errorData    = useSample ? SAMPLE_ERRORS   : buildErrorData(filtered);
  const kpis         = useSample
    ? { total: '1,200', successRate: '84%', avgMs: '342 ms', peakHour: '10:00' }
    : calcKpis(filtered, stats);

  const SampleBadge = () => useSample
    ? <span className="text-xs bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full ml-2">Sample Data</span>
    : null;

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Analytics</h1>
          <p className="text-sm text-slate-500 mt-0.5">Integration performance insights</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
            {DATE_RANGES.map(r => (
              <button
                key={r.days}
                onClick={() => setRange(r.days)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  range === r.days
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 bg-white border border-slate-200 shadow-sm text-slate-600 px-3 py-1.5 rounded-xl text-xs font-medium hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </motion.div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard title="Total Messages"         value={loading ? '…' : kpis.total}       icon={BarChart2}    iconBg="bg-indigo-50" iconColor="text-indigo-600" delay={0}    isSample={useSample} />
        <KpiCard title="Success Rate"           value={loading ? '…' : kpis.successRate} icon={CheckCircle2} iconBg="bg-green-50"  iconColor="text-green-600"  delay={0.05} isSample={useSample} />
        <KpiCard title="Avg Processing Time"    value={loading ? '…' : kpis.avgMs}       icon={Clock}        iconBg="bg-blue-50"   iconColor="text-blue-600"   delay={0.1}  isSample={useSample} />
        <KpiCard title="Peak Hour"              value={loading ? '…' : kpis.peakHour}    icon={Zap}          iconBg="bg-amber-50"  iconColor="text-amber-600"  delay={0.15} isSample={useSample} />
      </div>

      {/* Message Trend — full width */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <h2 className="font-bold text-slate-800">Message Volume Over Time</h2>
            <SampleBadge />
          </div>
          <div className="flex items-center gap-4">
            {[['#22c55e','Completed'],['#ef4444','Failed'],['#3b82f6','Processing']].map(([c, l]) => (
              <div key={l} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />
                <span className="text-xs text-slate-500">{l}</span>
              </div>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="h-56 bg-slate-100 rounded-xl animate-pulse" />
        ) : (
          <ResponsiveContainer width="100%" height={224}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="COMPLETED"  stroke="#22c55e" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="FAILED"     stroke="#ef4444" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="PROCESSING" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </motion.div>

      {/* Status Distribution + Top iFlows */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Status Distribution */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6"
        >
          <div className="flex items-center mb-4">
            <h2 className="font-bold text-slate-800">Status Distribution</h2>
            <SampleBadge />
          </div>
          {loading ? (
            <div className="h-56 bg-slate-100 rounded-xl animate-pulse" />
          ) : (
            <>
              <div className="relative">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%" cy="50%"
                      innerRadius={55} outerRadius={85}
                      paddingAngle={3} dataKey="value"
                    >
                      {pieData.map(entry => (
                        <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#6366f1'} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="text-2xl font-bold text-slate-800">
                    {pieData.reduce((s, d) => s + d.value, 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-slate-400">Total</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 mt-3">
                {pieData.map(d => {
                  const total = pieData.reduce((s, x) => s + x.value, 0);
                  const pct   = total > 0 ? Math.round((d.value / total) * 100) : 0;
                  return (
                    <div key={d.name} className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[d.name] || '#6366f1' }} />
                      <span className="text-xs text-slate-500">{d.name}</span>
                      <span className="text-xs font-semibold text-slate-700">{d.value.toLocaleString()}</span>
                      <span className="text-xs text-slate-400">({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </motion.div>

        {/* Top iFlows by Volume */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6"
        >
          <div className="flex items-center mb-4">
            <h2 className="font-bold text-slate-800">Top iFlows by Volume</h2>
            <SampleBadge />
          </div>
          {loading ? (
            <div className="h-56 bg-slate-100 rounded-xl animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={iflowData} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis
                  type="category" dataKey="name"
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false} tickLine={false}
                  width={130}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="#6366f1" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>
      </div>

      {/* Processing Time Distribution */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
        className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6"
      >
        <div className="flex items-center mb-4">
          <h2 className="font-bold text-slate-800">Processing Time Distribution</h2>
          <SampleBadge />
        </div>
        {loading ? (
          <div className="h-48 bg-slate-100 rounded-xl animate-pulse" />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={durationData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="count" fill="#3b82f6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </motion.div>

      {/* Error Analysis Table */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
        className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6"
      >
        <div className="flex items-center mb-4">
          <h2 className="font-bold text-slate-800">Error Analysis</h2>
          <SampleBadge />
        </div>
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded-xl animate-pulse" />)}
          </div>
        ) : errorData.length === 0 ? (
          <div className="text-sm text-slate-500 bg-slate-50 rounded-xl p-6 text-center">
            No failed messages in the selected range.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-100">
                  <th className="pb-3 text-xs font-semibold text-slate-500 pr-4">iFlow Name</th>
                  <th className="pb-3 text-xs font-semibold text-slate-500 pr-4">Error Count</th>
                  <th className="pb-3 text-xs font-semibold text-slate-500 pr-4">Last Failed</th>
                  <th className="pb-3 text-xs font-semibold text-slate-500">Most Common Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {errorData.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 pr-4 font-medium text-slate-700 max-w-xs truncate">{row.iflow}</td>
                    <td className="py-3 pr-4">
                      <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                        {row.count}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-slate-500 text-xs">{row.lastFailed || '—'}</td>
                    <td className="py-3 text-slate-500 text-xs max-w-xs truncate" title={row.error}>{row.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

    </div>
  );
}
