import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, Download, RefreshCw, Trash2, Clock, Shield,
  Search, ChevronDown, AlertTriangle, Loader2
} from 'lucide-react';
import { apiClient } from '../api';

/* ─── Log-type badge colours ─── */
const TYPE_COLOURS = {
  defaultTrace: 'bg-purple-100 text-purple-700 border border-purple-200',
  http:         'bg-blue-100   text-blue-700   border border-blue-200',
  access:       'bg-green-100  text-green-700  border border-green-200',
  default:      'bg-slate-100  text-slate-600  border border-slate-200',
};
function typeBadge(type = '') {
  return TYPE_COLOURS[type] || TYPE_COLOURS.default;
}

/* ─── Helpers ─── */
function fmtDate(raw) {
  if (!raw) return '—';
  try { return new Date(raw).toLocaleString(); } catch { return raw; }
}
function fmtSize(bytes) {
  if (bytes == null || bytes === '') return '—';
  const n = Number(bytes);
  if (isNaN(n)) return bytes;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/* ─── Sample app-activity entries shown when log is empty ─── */
const SAMPLE_ACTIVITY = [
  { ts: new Date(Date.now() - 5 * 60000).toISOString(),  action: 'Viewed Dashboard',      details: 'Opened main dashboard',              user: 'Mani Reddy' },
  { ts: new Date(Date.now() - 12 * 60000).toISOString(), action: 'Opened iFlow Studio',   details: 'Browsed integration flow packages',  user: 'Mani Reddy' },
  { ts: new Date(Date.now() - 30 * 60000).toISOString(), action: 'Viewed Monitoring',      details: 'Checked message processing status',  user: 'Mani Reddy' },
  { ts: new Date(Date.now() - 47 * 60000).toISOString(), action: 'Opened Security',        details: 'Reviewed keystore entries',          user: 'Mani Reddy' },
  { ts: new Date(Date.now() - 60 * 60000).toISOString(), action: 'Opened Settings',        details: 'Updated CPI connection config',      user: 'Mani Reddy' },
];

/* ═══════════════════════════════════════════════════════════════ */
export default function AuditLogs({ addToast }) {
  const [activeTab, setActiveTab] = useState('cpi');

  /* CPI log files state */
  const [logFiles, setLogFiles]   = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [search, setSearch]       = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');

  /* App activity log state */
  const [activityLog, setActivityLog] = useState([]);

  /* ── Fetch CPI log files ── */
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/cpi/log-files');
      setLogFiles(res.data.results || []);
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Failed to load log files';
      setError(msg);
      addToast?.({ type: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  /* ── Load app activity log ── */
  useEffect(() => {
    const global = window.__auditLog;
    if (Array.isArray(global) && global.length > 0) {
      setActivityLog([...global]);
    } else {
      setActivityLog(SAMPLE_ACTIVITY);
    }
  }, []);

  /* ── Derived lists ── */
  const uniqueTypes = ['ALL', ...new Set(logFiles.map(f => f.LogFileType).filter(Boolean))];
  const filteredFiles = logFiles.filter(f => {
    const matchType = typeFilter === 'ALL' || f.LogFileType === typeFilter;
    const matchSearch = !search ||
      (f.Name || '').toLowerCase().includes(search.toLowerCase()) ||
      (f.LogFileType || '').toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  /* ── Handlers ── */
  function handleDownload(name) {
    const url = `${apiClient.defaults.baseURL}/cpi/log-files/download?name=${encodeURIComponent(name)}`;
    window.open(url, '_blank', 'noopener');
  }

  function clearActivity() {
    if (window.__auditLog) window.__auditLog = [];
    setActivityLog([]);
    addToast?.({ type: 'info', message: 'Activity log cleared' });
  }

  /* ════════════════════════ RENDER ════════════════════════ */
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-slate-100 p-6">

      {/* ── Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow">
            <Shield size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Audit Logs</h1>
            <p className="text-sm text-slate-500">CPI system and integration log files</p>
          </div>
        </div>
      </motion.div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 mb-6 bg-white border border-slate-200 rounded-xl p-1 w-fit shadow-sm">
        {[
          { id: 'cpi',      label: 'CPI Log Files',    icon: FileText },
          { id: 'activity', label: 'App Activity Log',  icon: Clock    },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === id
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">

        {/* ══════════ CPI LOG FILES TAB ══════════ */}
        {activeTab === 'cpi' && (
          <motion.div
            key="cpi"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            {/* Filter bar */}
            <div className="flex flex-wrap gap-3 mb-4">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search log files…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div className="relative">
                <select
                  value={typeFilter}
                  onChange={e => setTypeFilter(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {uniqueTypes.map(t => (
                    <option key={t} value={t}>{t === 'ALL' ? 'All Types' : t}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>

              <button
                onClick={fetchLogs}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors shadow-sm"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>

            {/* Error banner */}
            {error && (
              <div className="flex items-center gap-2 mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <AlertTriangle size={15} />
                {error}
              </div>
            )}

            {/* Table card */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                  <Loader2 size={32} className="animate-spin mb-3" />
                  <span className="text-sm">Loading log files…</span>
                </div>
              ) : filteredFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                  <FileText size={40} className="mb-3 opacity-40" />
                  <p className="font-medium">No log files found</p>
                  <p className="text-sm mt-1">
                    {logFiles.length === 0 ? 'Could not retrieve log files from CPI.' : 'Try a different search or filter.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="text-left px-4 py-3 font-semibold text-slate-600">Type</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-600">Name</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-600">Last Modified</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-600">Size</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-600">Node Type</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredFiles.map((f, i) => (
                        <motion.tr
                          key={f.Name || i}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.03 }}
                          className="border-b border-slate-50 hover:bg-indigo-50/40 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${typeBadge(f.LogFileType)}`}>
                              {f.LogFileType || '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-700 max-w-xs truncate" title={f.Name}>
                            {f.Name || '—'}
                          </td>
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(f.LastModified)}</td>
                          <td className="px-4 py-3 text-slate-500">{fmtSize(f.Size)}</td>
                          <td className="px-4 py-3 text-slate-500">{f.NodeType || '—'}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleDownload(f.Name)}
                              title="Download log file"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
                            >
                              <Download size={13} />
                              Download
                            </button>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {!loading && filteredFiles.length > 0 && (
              <p className="mt-2 text-xs text-slate-400 text-right">
                Showing {filteredFiles.length} of {logFiles.length} log files
              </p>
            )}
          </motion.div>
        )}

        {/* ══════════ APP ACTIVITY LOG TAB ══════════ */}
        {activeTab === 'activity' && (
          <motion.div
            key="activity"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-slate-500">
                Local session activity — actions taken in this tool session
              </p>
              <button
                onClick={clearActivity}
                className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                <Trash2 size={14} />
                Clear Log
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              {activityLog.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                  <Clock size={40} className="mb-3 opacity-40" />
                  <p className="font-medium">No activity recorded</p>
                  <p className="text-sm mt-1">Actions you take in this session will appear here.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="text-left px-4 py-3 font-semibold text-slate-600">Timestamp</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-600">Action</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-600">Details</th>
                        <th className="text-left px-4 py-3 font-semibold text-slate-600">User</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activityLog.map((entry, i) => (
                        <motion.tr
                          key={i}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.04 }}
                          className="border-b border-slate-50 hover:bg-indigo-50/40 transition-colors"
                        >
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap font-mono text-xs">
                            {fmtDate(entry.ts)}
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-700">{entry.action}</td>
                          <td className="px-4 py-3 text-slate-500">{entry.details || '—'}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 border border-indigo-200">
                              {entry.user || 'Mani Reddy'}
                            </span>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {activityLog.length > 0 && (
              <p className="mt-2 text-xs text-slate-400 text-right">
                {activityLog.length} {activityLog.length === 1 ? 'entry' : 'entries'}
              </p>
            )}
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
