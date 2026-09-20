import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, RefreshCw, Loader2, AlertTriangle,
  ChevronDown, ChevronUp, Search, Copy, Check, Inbox
} from 'lucide-react';
import { apiClient } from '../api';

const STATUS_FILTERS = ['ALL', 'COMPLETED', 'FAILED', 'PROCESSING', 'ESCALATED'];
const TOP_OPTIONS = [25, 50, 100, 200];

const STATUS_STYLES = {
  COMPLETED:  { badge: 'bg-green-100 text-green-700 border border-green-200',   dot: 'bg-green-500' },
  FAILED:     { badge: 'bg-red-100 text-red-700 border border-red-200',         dot: 'bg-red-500' },
  PROCESSING: { badge: 'bg-blue-100 text-blue-700 border border-blue-200',      dot: 'bg-blue-500 animate-pulse' },
  ESCALATED:  { badge: 'bg-amber-100 text-amber-700 border border-amber-200',   dot: 'bg-amber-500' },
};

const STATUS_PILL_STYLES = {
  COMPLETED:  'bg-green-50  border-green-200  text-green-700',
  FAILED:     'bg-red-50    border-red-200    text-red-700',
  PROCESSING: 'bg-blue-50   border-blue-200   text-blue-700',
  ESCALATED:  'bg-amber-50  border-amber-200  text-amber-700',
};

const STATUS_DOT = {
  COMPLETED: 'bg-green-500', FAILED: 'bg-red-500',
  PROCESSING: 'bg-blue-500', ESCALATED: 'bg-amber-500',
};

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || { badge: 'bg-slate-100 text-slate-500 border border-slate-200', dot: 'bg-slate-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${s.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status || 'UNKNOWN'}
    </span>
  );
}

function formatDuration(start, end) {
  if (!start || !end) return '—';
  const ms = new Date(end) - new Date(start);
  if (isNaN(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDateTime(val) {
  if (!val) return '—';
  return new Date(val).toLocaleString();
}

function CopyableGuid({ value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-slate-300">—</span>;
  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <span className="group flex items-center gap-1">
      <span className="font-mono text-xs text-slate-400" title={value}>
        {value.slice(0, 12)}…
      </span>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-indigo-600"
        title="Copy Message ID"
      >
        {copied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
      </button>
    </span>
  );
}

function ExpandedDetail({ msg }) {
  const fields = [
    ['Message GUID',           msg.MessageGuid],
    ['Correlation ID',         msg.CorrelationId],
    ['Application Message ID', msg.ApplicationMessageId],
    ['Application Msg Type',   msg.ApplicationMessageType],
    ['Status',                 msg.Status],
    ['Integration Flow',       msg.IntegrationFlowName],
    ['Sender Component',       msg.SenderComponent],
    ['Receiver Component',     msg.ReceiverComponent],
    ['Sender',                 msg.Sender],
    ['Receiver',               msg.Receiver],
    ['Log Start',              msg.LogStart ? formatDateTime(msg.LogStart) : null],
    ['Log End',                msg.LogEnd   ? formatDateTime(msg.LogEnd)   : null],
    ['Duration',               formatDuration(msg.LogStart, msg.LogEnd)],
  ].filter(([, v]) => v && v !== '—');

  return (
    <motion.tr
      initial={{ opacity: 0, scaleY: 0.95 }}
      animate={{ opacity: 1, scaleY: 1 }}
      exit={{ opacity: 0, scaleY: 0.95 }}
      style={{ transformOrigin: 'top' }}
    >
      <td colSpan={9} className="px-5 py-4 bg-indigo-50/50 border-b border-slate-100">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {fields.map(([label, value]) => (
            <div key={label}>
              <div className="text-xs text-slate-400 font-medium mb-0.5">{label}</div>
              <div className="text-xs text-slate-700 break-all font-mono bg-white border border-slate-100 rounded-lg px-2 py-1">{value}</div>
            </div>
          ))}
        </div>
      </td>
    </motion.tr>
  );
}

function SkeletonRows({ count = 8 }) {
  return Array.from({ length: count }).map((_, i) => (
    <tr key={i} className="border-b border-slate-50">
      {Array.from({ length: 9 }).map((__, j) => (
        <td key={j} className="py-3 px-4">
          <div className={`h-3 bg-slate-100 rounded animate-pulse ${j === 1 ? 'w-24' : j === 2 ? 'w-32' : 'w-16'}`} />
        </td>
      ))}
    </tr>
  ));
}

export default function MessageProcessing({ addToast }) {
  const [messages, setMessages]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch]           = useState('');
  const [top, setTop]                 = useState(50);
  const [expandedRow, setExpandedRow] = useState(null);
  const [error, setError]             = useState('');

  const fetchMessages = useCallback(async (filter = statusFilter, topVal = top) => {
    setLoading(true);
    setError('');
    try {
      const params = { top: topVal };
      if (filter !== 'ALL') params.status = filter;
      const res = await apiClient.get('/messages', { params });
      setMessages(res.data.results || []);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setError(msg);
      addToast?.('Failed to load messages: ' + msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, top, addToast]);

  useEffect(() => { fetchMessages(statusFilter, top); }, [statusFilter, top]);

  const filtered = search.trim()
    ? messages.filter(m => (m.IntegrationFlowName || '').toLowerCase().includes(search.trim().toLowerCase()))
    : messages;

  const counts = STATUS_FILTERS.slice(1).reduce((acc, s) => {
    acc[s] = filtered.filter(m => m.Status === s).length;
    return acc;
  }, {});

  const toggleRow = (id) => setExpandedRow(prev => prev === id ? null : id);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <MessageSquare size={20} />
              Message Processing
            </h1>
            <p className="text-indigo-200 text-sm mt-0.5">Detailed message logs and processing history</p>
          </div>
          <button
            onClick={() => fetchMessages(statusFilter, top)}
            className="flex items-center gap-2 text-sm font-medium bg-white text-indigo-700 hover:bg-indigo-50 px-4 py-2 rounded-xl shadow-sm transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Filter bar */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
          {/* Status dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500 whitespace-nowrap">Status</label>
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setExpandedRow(null); }}
              className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {STATUS_FILTERS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 flex-1 min-w-[180px] max-w-xs">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Filter by iFlow name…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          </div>

          {/* Top selector */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500 whitespace-nowrap">Show</label>
            <select
              value={top}
              onChange={e => { setTop(Number(e.target.value)); setExpandedRow(null); }}
              className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {TOP_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        {/* Stats pills */}
        <div className="flex flex-wrap gap-2">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-3 py-2 flex items-center gap-2">
            <span className="text-xs text-slate-500">Total</span>
            <span className="text-sm font-bold text-slate-800">{filtered.length}</span>
          </div>
          {STATUS_FILTERS.slice(1).map(s => (
            <div key={s} className={`rounded-xl border px-3 py-2 flex items-center gap-2 ${STATUS_PILL_STYLES[s]}`}>
              <span className={`w-2 h-2 rounded-full ${STATUS_DOT[s]}`} />
              <span className="text-xs font-medium">{s}</span>
              <span className="text-sm font-bold">{counts[s]}</span>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertTriangle size={16} className="flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {!loading && filtered.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Inbox size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No messages found</p>
              <p className="text-xs mt-1 text-slate-300">Try adjusting the status filter or search term</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="py-3 px-4 w-8"><input type="checkbox" disabled className="accent-indigo-600" /></th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">iFlow Name</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Status</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Log Start</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Log End</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Duration</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Sender</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Receiver</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Message ID</th>
                    <th className="py-3 px-4 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <SkeletonRows count={8} />
                  ) : (
                    filtered.map((msg, i) => {
                      const rowId = msg.MessageGuid || msg.Id || i;
                      const isExpanded = expandedRow === rowId;
                      return (
                        <>
                          <tr
                            key={rowId}
                            className={`border-b border-slate-50 cursor-pointer transition-colors
                              ${isExpanded ? 'bg-indigo-50' : i % 2 === 0 ? 'hover:bg-slate-50' : 'bg-slate-50/40 hover:bg-slate-100/60'}`}
                            onClick={() => toggleRow(rowId)}
                          >
                            <td className="py-3 px-4" onClick={e => e.stopPropagation()}>
                              <input type="checkbox" className="accent-indigo-600" />
                            </td>
                            <td className="py-3 px-4 max-w-[180px]">
                              <span className="font-medium text-slate-800 truncate block" title={msg.IntegrationFlowName}>
                                {msg.IntegrationFlowName || '—'}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <StatusBadge status={msg.Status} />
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-400 whitespace-nowrap">
                              {formatDateTime(msg.LogStart)}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-400 whitespace-nowrap">
                              {formatDateTime(msg.LogEnd)}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-500 font-medium whitespace-nowrap">
                              {formatDuration(msg.LogStart, msg.LogEnd)}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-500">
                              {msg.SenderAdapter || msg.Sender || '—'}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-500">
                              {msg.ReceiverAdapter || msg.Receiver || '—'}
                            </td>
                            <td className="py-3 px-4">
                              <CopyableGuid value={msg.MessageGuid} />
                            </td>
                            <td className="py-3 px-4 text-slate-400">
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </td>
                          </tr>
                          <AnimatePresence>
                            {isExpanded && <ExpandedDetail key={rowId + '_exp'} msg={msg} />}
                          </AnimatePresence>
                        </>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
