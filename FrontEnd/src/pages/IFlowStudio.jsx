import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Package, GitBranch, ChevronRight,
  Loader2, AlertTriangle, RefreshCw, X, Plus,
  Upload, Trash2, CheckSquare, Square, CheckCircle2, XCircle, FolderUp,
} from 'lucide-react';
import { getPackages, getPackageIflows, deployIflows, undeployIflows, getArtifactsByType, deployArtifact, getRuntimeArtifacts, importZipToCpi } from '../api';

const ARTIFACT_TABS = [
  { key: 'iflows',             label: 'iFlows' },
  { key: 'valuemappings',      label: 'Value Mappings' },
  { key: 'scriptcollections',  label: 'Script Collections' },
  { key: 'messagemappings',    label: 'Message Mappings' },
  { key: 'functionlibraries',  label: 'Function Libraries' },
  { key: 'all-artifacts',      label: 'All' },
];

const STATUS_STYLES = {
  STARTED:   'bg-emerald-100 text-emerald-700 border border-emerald-200',
  STOPPED:   'bg-slate-100 text-slate-600 border border-slate-200',
  ERROR:     'bg-red-100 text-red-700 border border-red-200',
  FAILED:    'bg-red-100 text-red-700 border border-red-200',
  STARTING:  'bg-amber-100 text-amber-700 border border-amber-200',
  DEPLOYING: 'bg-blue-100 text-blue-700 border border-blue-200',
};

function StatusPill({ status }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] || 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'STARTED' ? 'bg-emerald-500' : status === 'FAILED' || status === 'ERROR' ? 'bg-red-500' : 'bg-slate-400'}`} />
      {status || 'UNKNOWN'}
    </span>
  );
}

function DeployStatusPill({ deployed, runtimeStatus }) {
  if (deployed) {
    const s = runtimeStatus || 'STARTED';
    return <StatusPill status={s} />;
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      Not Deployed
    </span>
  );
}

function TypeBadge({ type }) {
  if (!type) return <span className="text-slate-400 text-xs">—</span>;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-600 border border-indigo-100">
      {type}
    </span>
  );
}

function PackageSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="h-36 bg-slate-100 rounded-2xl animate-pulse" />
      ))}
    </div>
  );
}

// Result row shown after bulk action
function BulkResultBanner({ result, onClose }) {
  if (!result) return null;
  const { type, results = [] } = result;
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-700 text-sm capitalize">
          {type} Results — {succeeded} succeeded{failed > 0 ? `, ${failed} failed` : ''}
        </h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
      </div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {results.map((r, i) => (
          <div key={i} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${r.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {r.success ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            <span className="font-medium">{r.id}</span>
            {!r.success && <span className="text-red-500 ml-1">— {r.error}</span>}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export default function IFlowStudio({ addToast }) {
  const [packages, setPackages]             = useState([]);
  const [loading, setLoading]               = useState(true);
  const [search, setSearch]                 = useState('');
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [iflows, setIflows]                 = useState([]);
  const [iflowsLoading, setIflowsLoading]   = useState(false);
  const [error, setError]                   = useState('');
  const [selected, setSelected]             = useState(new Set()); // selected iflow IDs
  const [bulkLoading, setBulkLoading]       = useState(null);      // 'deploy' | 'undeploy'
  const [bulkResult, setBulkResult]         = useState(null);
  const [activeTab, setActiveTab]           = useState('iflows');
  const [artifactCache, setArtifactCache]   = useState({});  // { [tabKey]: [] }
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactDeploying, setArtifactDeploying] = useState(null); // artifact id being deployed
  const [deployedIds, setDeployedIds]       = useState(new Set()); // IDs of runtime-deployed artifacts
  const [importModal, setImportModal]       = useState(false);
  const [importForm, setImportForm]         = useState({ artifactId: '', artifactName: '', artifactType: 'IFlow', file: null });
  const [importLoading, setImportLoading]   = useState(false);

  const fetchPackages = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getPackages('', 100);
      setPackages(res.data.results || []);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setError(msg);
      addToast?.('Failed to load packages: ' + msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { fetchPackages(); }, [fetchPackages]);

  const selectPackage = async (pkg) => {
    setSelectedPackage(pkg);
    setIflows([]);
    setSelected(new Set());
    setBulkResult(null);
    setActiveTab('iflows');
    setArtifactCache({});
    setDeployedIds(new Set());
    setIflowsLoading(true);
    try {
      const [iflowRes, runtimeRes] = await Promise.allSettled([
        getPackageIflows(pkg.Id),
        getRuntimeArtifacts(),
      ]);
      const iflowList = iflowRes.status === 'fulfilled' ? (iflowRes.value.data.results || []) : [];
      const runtimeList = runtimeRes.status === 'fulfilled' ? (runtimeRes.value.data.results || []) : [];
      setIflows(iflowList);
      setDeployedIds(new Set(runtimeList.map(r => r.Id)));
      if (iflowRes.status === 'rejected') {
        addToast?.('Failed to load iFlows: ' + (iflowRes.reason?.response?.data?.error || iflowRes.reason?.message), 'error');
      }
    } finally {
      setIflowsLoading(false);
    }
  };

  const handleTabChange = async (tabKey) => {
    setActiveTab(tabKey);
    if (tabKey === 'iflows') return;
    if (artifactCache[tabKey]) return; // already loaded
    setArtifactLoading(true);
    try {
      const results = await getArtifactsByType(selectedPackage.Id, tabKey);
      setArtifactCache(prev => ({ ...prev, [tabKey]: results }));
    } catch (err) {
      addToast?.('Failed to load artifacts: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
      setArtifactLoading(false);
    }
  };

  const handleDeployArtifact = async (artifact) => {
    setArtifactDeploying(artifact.Id);
    try {
      await deployArtifact(artifact.Id, 'active');
      addToast?.(`Deployed ${artifact.Name || artifact.Id}`, 'success');
    } catch (err) {
      addToast?.('Deploy failed: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
      setArtifactDeploying(null);
    }
  };

  // ── Selection helpers ────────────────────────────────────────────────────────
  const toggleOne = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleAll = () => {
    if (selected.size === iflows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(iflows.map(f => f.Id)));
    }
  };

  const allChecked  = iflows.length > 0 && selected.size === iflows.length;
  const someChecked = selected.size > 0 && selected.size < iflows.length;

  // ── Bulk actions ─────────────────────────────────────────────────────────────
  const handleBulk = async (action) => {
    if (selected.size === 0) return;
    setBulkLoading(action);
    setBulkResult(null);
    try {
      const ids = [...selected];
      const { data } = action === 'deploy'
        ? await deployIflows(ids)
        : await undeployIflows(ids);
      setBulkResult({ type: action, ...data });
      addToast?.(
        `${action === 'deploy' ? 'Deploy' : 'Undeploy'}: ${data.succeeded}/${data.total} succeeded`,
        data.failed > 0 ? 'error' : 'success'
      );
      setSelected(new Set());
      // Refresh runtime status after deploy/undeploy
      getRuntimeArtifacts().then(r => setDeployedIds(new Set((r.data.results || []).map(x => x.Id)))).catch(() => {});
    } catch (err) {
      addToast?.((err.response?.data?.error || err.message), 'error');
    } finally {
      setBulkLoading(null);
    }
  };

  const filtered = packages.filter(p =>
    !search ||
    p.Name?.toLowerCase().includes(search.toLowerCase()) ||
    p.Id?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white">iFlow Studio</h1>
            <p className="text-indigo-200 text-sm mt-0.5">Browse integration packages and iFlows</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search packages…"
                className="w-64 bg-white/10 text-white placeholder-indigo-300 border border-white/20 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:bg-white/20" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-indigo-300 hover:text-white">
                  <X size={13} />
                </button>
              )}
            </div>
            <button onClick={async () => { await fetchPackages(); if (selectedPackage) selectPackage(selectedPackage); }}
              className="flex items-center gap-2 text-sm font-medium text-indigo-100 bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-2 rounded-xl transition-colors">
              <RefreshCw size={14} /> Refresh
            </button>
            <button className="flex items-center gap-2 text-sm font-medium text-indigo-700 bg-white hover:bg-indigo-50 px-4 py-2 rounded-xl shadow-sm transition-colors">
              <Plus size={14} /> New iFlow
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertTriangle size={16} className="flex-shrink-0" /> {error}
          </div>
        )}

        {/* Packages grid */}
        {loading ? <PackageSkeleton /> : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Package size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">{search ? 'No packages match your search' : 'No packages found'}</p>
          </div>
        ) : (
          <div>
            <p className="text-sm text-slate-500 mb-3">{filtered.length} package{filtered.length !== 1 ? 's' : ''} found</p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map(pkg => (
                <motion.button key={pkg.Id} onClick={() => selectPackage(pkg)} whileHover={{ y: -3 }}
                  className={`text-left bg-white rounded-2xl border p-5 shadow-sm transition-all
                    ${selectedPackage?.Id === pkg.Id ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-indigo-300'}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                      <Package size={18} className="text-indigo-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-semibold text-slate-800 text-sm truncate">{pkg.Name || pkg.Id}</div>
                        {pkg.Version && (
                          <span className="text-xs bg-slate-100 text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded font-medium flex-shrink-0">v{pkg.Version}</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 truncate">ID: {pkg.Id}</div>
                      {pkg.Description && (
                        <div className="text-xs text-slate-500 mt-1.5 line-clamp-2 leading-snug">{pkg.Description.replace(/<[^>]*>/g, '').trim()}</div>
                      )}
                    </div>
                    <ChevronRight size={14} className={`flex-shrink-0 mt-0.5 ${selectedPackage?.Id === pkg.Id ? 'text-indigo-500' : 'text-slate-300'}`} />
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        )}

        {/* Bulk result banner */}
        <BulkResultBanner result={bulkResult} onClose={() => setBulkResult(null)} />

        {/* iFlows panel */}
        <AnimatePresence>
          {selectedPackage && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

              {/* Panel header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-2">
                  <GitBranch size={16} className="text-indigo-500" />
                  <h2 className="text-base font-semibold text-slate-700">
                    {selectedPackage.Name}
                  </h2>
                  {activeTab === 'iflows' && iflows.length > 0 && (
                    <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-medium">{iflows.length}</span>
                  )}
                  {activeTab !== 'iflows' && artifactCache[activeTab] && (
                    <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-medium">{artifactCache[activeTab].length}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* Bulk action buttons — only show when items selected on iFlows tab */}
                  {activeTab === 'iflows' && selected.size > 0 && (
                    <AnimatePresence>
                      <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
                        className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 font-medium">{selected.size} selected</span>
                        <button onClick={() => handleBulk('deploy')} disabled={!!bulkLoading}
                          className="flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                          {bulkLoading === 'deploy' ? <Loader2 size={11} className="animate-spin"/> : <Upload size={11}/>}
                          {bulkLoading === 'deploy' ? 'Deploying…' : 'Deploy'}
                        </button>
                        <button onClick={() => handleBulk('undeploy')} disabled={!!bulkLoading}
                          className="flex items-center gap-1.5 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                          {bulkLoading === 'undeploy' ? <Loader2 size={11} className="animate-spin"/> : <Trash2 size={11}/>}
                          {bulkLoading === 'undeploy' ? 'Undeploying…' : 'Undeploy'}
                        </button>
                        <button onClick={() => setSelected(new Set())}
                          className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                          Clear
                        </button>
                      </motion.div>
                    </AnimatePresence>
                  )}
                  <button onClick={() => setImportModal(true)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors">
                    <FolderUp size={13} /> Import ZIP
                  </button>
                  <button onClick={() => { setSelectedPackage(null); setSelected(new Set()); setBulkResult(null); setActiveTab('iflows'); setArtifactCache({}); }}
                    className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Artifact type tabs */}
              <div className="px-6 pt-4 pb-2 flex gap-1 flex-wrap">
                {ARTIFACT_TABS.map(t => (
                  <button key={t.key} onClick={() => handleTabChange(t.key)}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${activeTab === t.key ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* iFlows tab content */}
              {activeTab === 'iflows' && (
                iflowsLoading ? (
                  <div className="flex items-center justify-center py-12 gap-3 text-slate-400">
                    <Loader2 size={20} className="animate-spin" />
                    <span className="text-sm">Loading iFlows…</span>
                  </div>
                ) : iflows.length === 0 ? (
                  <div className="text-center py-10 text-slate-400">
                    <GitBranch size={32} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No iFlows found in this package</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="py-3 px-4 w-10">
                            <button onClick={toggleAll} className="text-slate-400 hover:text-indigo-600 transition-colors">
                              {allChecked
                                ? <CheckSquare size={16} className="text-indigo-600"/>
                                : someChecked
                                  ? <CheckSquare size={16} className="text-indigo-400"/>
                                  : <Square size={16}/>}
                            </button>
                          </th>
                          <th className="text-left py-3 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Name</th>
                          <th className="text-left py-3 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Status</th>
                          <th className="text-left py-3 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Version</th>
                          <th className="text-left py-3 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Type</th>
                          <th className="py-3 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wide text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {iflows.map((iflow, i) => {
                          const isChecked = selected.has(iflow.Id);
                          return (
                            <tr key={iflow.Id || i}
                              onClick={() => toggleOne(iflow.Id)}
                              className={`border-b border-slate-50 cursor-pointer transition-colors
                                ${isChecked ? 'bg-indigo-50/60' : i % 2 === 0 ? 'hover:bg-slate-50' : 'bg-slate-50/40 hover:bg-slate-100/60'}`}>
                              <td className="py-3 px-4" onClick={e => { e.stopPropagation(); toggleOne(iflow.Id); }}>
                                {isChecked
                                  ? <CheckSquare size={16} className="text-indigo-600"/>
                                  : <Square size={16} className="text-slate-300"/>}
                              </td>
                              <td className="py-3 px-3 font-medium text-slate-700">{iflow.Name || iflow.Id}</td>
                              <td className="py-3 px-3">
                                <DeployStatusPill deployed={deployedIds.has(iflow.Id)} runtimeStatus={iflow.Status} />
                              </td>
                              <td className="py-3 px-3 text-slate-500 text-xs">{iflow.Version || '—'}</td>
                              <td className="py-3 px-3"><TypeBadge type={iflow.ArtifactType || iflow.Type} /></td>
                              <td className="py-3 px-3 text-right" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => { setSelected(new Set([iflow.Id])); handleBulk('deploy'); }}
                                    disabled={!!bulkLoading}
                                    className="text-xs text-emerald-700 hover:text-emerald-900 font-medium bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40">
                                    Deploy
                                  </button>
                                  <button
                                    onClick={() => { setSelected(new Set([iflow.Id])); handleBulk('undeploy'); }}
                                    disabled={!!bulkLoading}
                                    className="text-xs text-red-600 hover:text-red-800 font-medium bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40">
                                    Undeploy
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {/* Selection tip */}
                    {selected.size === 0 && (
                      <div className="px-6 py-3 border-t border-slate-50 text-xs text-slate-400 flex items-center gap-1.5">
                        <CheckSquare size={12}/> Click rows or the checkbox to select iFlows for bulk deploy / undeploy
                      </div>
                    )}
                  </div>
                )
              )}

              {/* Non-iFlow artifact tabs */}
              {activeTab !== 'iflows' && (
                artifactLoading ? (
                  <div className="flex items-center justify-center py-12 gap-3 text-slate-400">
                    <Loader2 size={20} className="animate-spin" />
                    <span className="text-sm">Loading artifacts…</span>
                  </div>
                ) : !artifactCache[activeTab] ? null : artifactCache[activeTab].length === 0 ? (
                  <div className="text-center py-10 text-slate-400">
                    <GitBranch size={32} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No artifacts found</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Name</th>
                          <th className="text-left py-3 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Version</th>
                          {activeTab === 'all-artifacts' && (
                            <th className="text-left py-3 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Artifact Type</th>
                          )}
                          <th className="py-3 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wide text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {artifactCache[activeTab].map((artifact, i) => (
                          <tr key={artifact.Id || i}
                            className={`border-b border-slate-50 transition-colors ${i % 2 === 0 ? 'hover:bg-slate-50' : 'bg-slate-50/40 hover:bg-slate-100/60'}`}>
                            <td className="py-3 px-4 font-medium text-slate-700">{artifact.Name || artifact.Id}</td>
                            <td className="py-3 px-3 text-slate-500 text-xs">{artifact.Version || '—'}</td>
                            {activeTab === 'all-artifacts' && (
                              <td className="py-3 px-3"><TypeBadge type={artifact.ArtifactType || artifact.Type} /></td>
                            )}
                            <td className="py-3 px-3 text-right">
                              <button
                                onClick={() => handleDeployArtifact(artifact)}
                                disabled={artifactDeploying === artifact.Id}
                                className="text-xs text-emerald-700 hover:text-emerald-900 font-medium bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 flex items-center gap-1 ml-auto">
                                {artifactDeploying === artifact.Id ? <Loader2 size={10} className="animate-spin"/> : <Upload size={10}/>}
                                Deploy
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Import ZIP Modal ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {importModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setImportModal(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">

              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <FolderUp size={18} className="text-indigo-600" />
                  <span className="text-lg font-bold text-slate-800">Import Artifact ZIP</span>
                </div>
                <button onClick={() => setImportModal(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
              </div>
              <p className="text-xs text-slate-500 mb-1">
                Package: <span className="font-semibold text-slate-700">{selectedPackage?.Name}</span>
              </p>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Artifact ID *</label>
                  <input value={importForm.artifactId}
                    onChange={e => setImportForm(f => ({ ...f, artifactId: e.target.value }))}
                    placeholder="e.g. MyIntegrationFlow"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Artifact Name *</label>
                  <input value={importForm.artifactName}
                    onChange={e => setImportForm(f => ({ ...f, artifactName: e.target.value }))}
                    placeholder="e.g. My Integration Flow"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Artifact Type</label>
                  <select value={importForm.artifactType}
                    onChange={e => setImportForm(f => ({ ...f, artifactType: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
                    {['IFlow', 'ValueMapping', 'ScriptCollection', 'MessageMapping', 'FunctionLibrary'].map(t => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">ZIP File *</label>
                  <input type="file" accept=".zip"
                    onChange={e => {
                      const file = e.target.files?.[0] || null;
                      if (file) {
                        // Auto-populate ID and Name from filename (strip .zip, spaces → underscores)
                        const baseName = file.name.replace(/\.zip$/i, '');
                        const artifactId   = baseName.replace(/\s+/g, '_');
                        const artifactName = baseName;
                        setImportForm(f => ({
                          ...f,
                          file,
                          artifactId:   f.artifactId   || artifactId,
                          artifactName: f.artifactName || artifactName,
                        }));
                      } else {
                        setImportForm(f => ({ ...f, file: null }));
                      }
                    }}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-600 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 focus:outline-none" />
                  {importForm.file && (
                    <p className="text-xs text-slate-400 mt-1">{importForm.file.name} ({(importForm.file.size / 1024).toFixed(1)} KB)</p>
                  )}
                </div>
              </div>

              <div className="flex gap-3 mt-5">
                <button onClick={() => setImportModal(false)}
                  className="flex-1 border border-slate-200 text-slate-600 rounded-lg py-2 text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  disabled={importLoading || !importForm.artifactId || !importForm.artifactName || !importForm.file}
                  onClick={async () => {
                    setImportLoading(true);
                    try {
                      const result = await importZipToCpi(
                        selectedPackage.Id,
                        importForm.artifactId,
                        importForm.artifactName,
                        importForm.artifactType,
                        importForm.file,
                      );
                      const action = result?.cpiData?.action || '';
                      addToast?.(action === 'update' ? 'Artifact updated successfully!' : 'Artifact imported successfully!', 'success');
                      setImportModal(false);
                      setImportForm({ artifactId: '', artifactName: '', artifactType: 'IFlow', file: null });
                      // Refresh iFlows list
                      selectPackage(selectedPackage);
                    } catch (err) {
                      addToast?.('Import failed: ' + (err.response?.data?.error || err.message), 'error');
                    } finally {
                      setImportLoading(false);
                    }
                  }}
                  className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                  {importLoading ? <Loader2 size={14} className="animate-spin" /> : <FolderUp size={14} />}
                  {importLoading ? 'Importing…' : 'Import'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
