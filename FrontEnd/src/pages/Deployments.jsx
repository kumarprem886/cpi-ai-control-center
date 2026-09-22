import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Rocket, RefreshCw, Loader2, AlertTriangle,
  ChevronDown, ChevronUp, Clock, Search, Trash2,
  Activity, CheckCircle2, XCircle, PauseCircle
} from 'lucide-react';
import apiClient from '../api';

const STATUS_FILTERS = ['ALL', 'STARTED', 'STOPPED', 'ERROR'];

const STATUS_STYLES = {
  STARTED:  'bg-emerald-100 text-emerald-700',
  STOPPED:  'bg-slate-100 text-slate-600',
  ERROR:    'bg-red-100 text-red-700',
  STARTING: 'bg-amber-100 text-amber-700',
};

const TYPE_STYLES = {
  IFlow:        'bg-indigo-100 text-indigo-700',
  ValueMapping: 'bg-purple-100 text-purple-700',
};

function StatusPill({ status }) {
  const cls = STATUS_STYLES[status] || 'bg-slate-100 text-slate-500';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {status || 'UNKNOWN'}
    </span>
  );
}

function TypeBadge({ type }) {
  const cls = TYPE_STYLES[type] || 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {type || '—'}
    </span>
  );
}

function ExpandedRow({ artifact, colSpan }) {
  const isError = artifact.Status === 'ERROR';
  return (
    <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <td colSpan={colSpan} className="px-5 py-4 bg-indigo-50/50 border-b border-slate-100">
        {isError && artifact.ErrorInformation ? (
          <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium mb-1">Error Information</div>
              <div className="font-mono text-xs break-all">{artifact.ErrorInformation}</div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              ['ID', artifact.Id],
              ['Name', artifact.Name],
              ['Type', artifact.Type],
              ['Status', artifact.Status],
              ['Version', artifact.Version],
              ['Deployed By', artifact.DeployedBy],
              ['Deployed On', artifact.DeployedOn ? new Date(artifact.DeployedOn).toLocaleString() : null],
              ['Error Info', artifact.ErrorInformation],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label}>
                <div className="text-xs text-slate-400 font-medium mb-0.5">{label}</div>
                <div className="text-xs text-slate-700 break-all font-mono bg-white border border-slate-100 rounded-lg px-2 py-1">{value}</div>
              </div>
            ))}
          </div>
        )}
      </td>
    </motion.tr>
  );
}

function SummaryCard({ icon: Icon, label, count, colorClass, bgClass }) {
  return (
    <div className={`${bgClass} rounded-2xl border shadow-sm px-5 py-4 flex items-center gap-3`}>
      <div className={`p-2 rounded-xl ${colorClass} bg-white/60`}>
        <Icon size={16} />
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-800">{count}</div>
        <div className="text-xs text-slate-500 font-medium">{label}</div>
      </div>
    </div>
  );
}

export default function Deployments({ addToast }) {
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [expandedRow, setExpandedRow] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [undeploying, setUndeploying] = useState(null);
  const intervalRef = useRef(null);

  const fetchArtifacts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/runtime-artifacts');
      setArtifacts(res.data.results || []);
      setLastRefreshed(new Date());
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setError(msg);
      addToast?.('Failed to load deployments: ' + msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchArtifacts();
    intervalRef.current = setInterval(fetchArtifacts, 30000);
    return () => clearInterval(intervalRef.current);
  }, [fetchArtifacts]);

  const handleUndeploy = async (artifact, e) => {
    e.stopPropagation();
    if (!window.confirm(`Undeploy "${artifact.Name}"?`)) return;
    setUndeploying(artifact.Id);
    try {
      await apiClient.delete(`/cpi/artifacts/undeploy/${artifact.Id}`);
      addToast?.(`"${artifact.Name}" undeployed successfully`, 'success');
      await fetchArtifacts();
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      addToast?.('Undeploy failed: ' + msg, 'error');
    } finally {
      setUndeploying(null);
    }
  };

  const toggleRow = (id) => setExpandedRow(prev => prev === id ? null : id);

  const filtered = artifacts.filter(a => {
    const matchSearch = !search ||
      (a.Name || '').toLowerCase().includes(search.toLowerCase()) ||
      (a.Id || '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'ALL' || a.Status === statusFilter;
    return matchSearch && matchStatus;
  });

  const total   = artifacts.length;
  const running = artifacts.filter(a => a.Status === 'STARTED').length;
  const failed  = artifacts.filter(a => a.Status === 'ERROR').length;
  const stopped = artifacts.filter(a => a.Status === 'STOPPED').length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full">
      {/* Gradient header */}
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">Deployments</h1>
            <p className="text-indigo-200 text-sm mt-0.5">Live runtime artifact status</p>
          </div>
          <div className="flex items-center gap-3">
            {lastRefreshed && (
              <div className="flex items-center gap-1.5 text-xs text-indigo-200 bg-white/10 border border-white/20 px-3 py-1.5 rounded-xl">
                <Clock size={11} />
                {lastRefreshed.toLocaleTimeString()}
              </div>
            )}
            <button
              onClick={fetchArtifacts}
              className="flex items-center gap-2 text-sm font-medium bg-white text-indigo-700 hover:bg-indigo-50 px-4 py-2 rounded-xl shadow-sm transition-colors"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard icon={Activity}      label="Total Deployed" count={total}   bgClass="bg-white border-slate-200"      colorClass="text-slate-500" />
          <SummaryCard icon={CheckCircle2}  label="Running"        count={running} bgClass="bg-emerald-50 border-emerald-200" colorClass="text-emerald-600" />
          <SummaryCard icon={XCircle}       label="Failed"         count={failed}  bgClass="bg-red-50 border-red-200"        colorClass="text-red-600" />
          <SummaryCard icon={PauseCircle}   label="Stopped"        count={stopped} bgClass="bg-slate-50 border-slate-200"    colorClass="text-slate-500" />
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertTriangle size={16} className="flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Search + filter bar */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or ID…"
              className="w-full pl-8 pr-4 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 text-slate-700"
          >
            {STATUS_FILTERS.map(f => (
              <option key={f} value={f}>{f === 'ALL' ? 'All Statuses' : f}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-3 text-slate-400">
              <Loader2 size={24} className="animate-spin" />
              <span className="text-sm">Loading deployments…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Rocket size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No deployed artifacts found</p>
              {search || statusFilter !== 'ALL' ? (
                <p className="text-xs mt-1">Try clearing the search or filter</p>
              ) : null}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left py-3 px-5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Name</th>
                    <th className="text-left py-3 px-5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Type</th>
                    <th className="text-left py-3 px-5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Status</th>
                    <th className="text-left py-3 px-5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Version</th>
                    <th className="text-left py-3 px-5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Deployed By</th>
                    <th className="text-left py-3 px-5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Deployed On</th>
                    <th className="text-left py-3 px-5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Actions</th>
                    <th className="py-3 px-5 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((artifact, i) => {
                    const rowId = artifact.Id || i;
                    const isExpanded = expandedRow === rowId;
                    const isUndeploying = undeploying === artifact.Id;
                    return (
                      <>
                        <tr
                          key={rowId}
                          className={`border-b border-slate-50 cursor-pointer transition-colors
                            ${isExpanded ? 'bg-indigo-50' : i % 2 === 0 ? 'hover:bg-slate-50' : 'bg-slate-50/50 hover:bg-slate-100/70'}`}
                          onClick={() => toggleRow(rowId)}
                        >
                          <td className="py-3 px-5 font-medium text-slate-800 max-w-[200px] truncate">
                            {artifact.Name || '—'}
                          </td>
                          <td className="py-3 px-5">
                            <TypeBadge type={artifact.Type} />
                          </td>
                          <td className="py-3 px-5">
                            <StatusPill status={artifact.Status} />
                          </td>
                          <td className="py-3 px-5 text-slate-500 text-xs font-mono">
                            {artifact.Version || '—'}
                          </td>
                          <td className="py-3 px-5 text-slate-500">
                            {artifact.DeployedBy || '—'}
                          </td>
                          <td className="py-3 px-5 text-slate-400 text-xs whitespace-nowrap">
                            {artifact.DeployedOn ? new Date(artifact.DeployedOn).toLocaleString() : '—'}
                          </td>
                          <td className="py-3 px-5" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={e => handleUndeploy(artifact, e)}
                              disabled={isUndeploying}
                              className="flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isUndeploying
                                ? <Loader2 size={12} className="animate-spin" />
                                : <Trash2 size={12} />}
                              Undeploy
                            </button>
                          </td>
                          <td className="py-3 px-5 text-slate-400">
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </td>
                        </tr>
                        <AnimatePresence>
                          {isExpanded && (
                            <ExpandedRow key={rowId + '_exp'} artifact={artifact} colSpan={8} />
                          )}
                        </AnimatePresence>
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

