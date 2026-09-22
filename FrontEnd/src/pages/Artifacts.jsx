import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, RefreshCw, Loader2, AlertTriangle, Rocket, PowerOff,
  CheckCircle2, XCircle, MinusCircle, Package, FileCode, Braces, Table2, Library,
} from 'lucide-react';
import { searchArtifacts, bulkDeployArtifacts, bulkUndeployArtifacts } from '../api';

const TYPES = [
  { id: 'ALL',              label: 'All types',        icon: Package },
  { id: 'IFlow',            label: 'iFlows',           icon: FileCode },
  { id: 'MessageMapping',   label: 'Message Mappings', icon: Table2 },
  { id: 'ValueMapping',     label: 'Value Mappings',   icon: Braces },
  { id: 'ScriptCollection', label: 'Script Colls.',    icon: Library },
  { id: 'FunctionLibrary',  label: 'Function Libs.',   icon: Library },
];

function TypeBadge({ type }) {
  const map = {
    IFlow: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    MessageMapping: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    ValueMapping: 'bg-amber-50 text-amber-700 border-amber-200',
    ScriptCollection: 'bg-sky-50 text-sky-700 border-sky-200',
    FunctionLibrary: 'bg-violet-50 text-violet-700 border-violet-200',
  };
  return (
    <span className={`px-2 py-0.5 text-[11px] font-medium rounded-md border ${map[type] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
      {type}
    </span>
  );
}

export default function Artifacts({ addToast }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('ALL');
  const [packageId, setPackageId] = useState('ALL');
  const [rows, setRows] = useState([]);
  const [packages, setPackages] = useState([]);
  const [counts, setCounts] = useState({});
  const [runtimeAvailable, setRuntimeAvailable] = useState(true);
  const [failedPackages, setFailedPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [outcomes, setOutcomes] = useState(null);

  const load = useCallback(async (opts = {}) => {
    setLoading(true);
    setError('');
    try {
      const data = await searchArtifacts({ q: query, type, packageId, refresh: opts.refresh || false });
      setRows(data.results || []);
      setPackages(data.packages || []);
      setCounts(data.counts || {});
      setRuntimeAvailable(data.runtimeAvailable !== false);
      setFailedPackages(data.failedPackages || []);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message;
      setError(String(msg));
      addToast?.('Artifact search failed: ' + msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [query, type, packageId, addToast]);

  // Debounce so typing does not fire a request per keystroke.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; load(); return; }
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  // A selection referring to rows no longer listed would act on invisible
  // artifacts, so drop anything that fell out of the current result set.
  useEffect(() => {
    setSelected(prev => {
      const visible = new Set(rows.map(r => r.id));
      const next = new Set([...prev].filter(id => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const allVisibleSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(rows.map(r => r.id)));

  const act = async (action) => {
    const picked = rows.filter(r => selected.has(r.id));
    if (!picked.length) return;

    const verb = action === 'deploy' ? 'Deploy' : 'Undeploy';

    // Undeploying something already stopped is a no-op that CPI answers with a
    // bare 404. Say so up front instead of reporting it as a failure after.
    const actionable = action === 'undeploy' && runtimeAvailable
      ? picked.filter(r => r.deployed)
      : picked;
    const noop = picked.length - actionable.length;

    if (!actionable.length) {
      addToast?.(`Nothing to undeploy — ${noop === 1 ? 'that artifact is' : 'those artifacts are'} not deployed`, 'info');
      return;
    }

    const names = actionable.slice(0, 8).map(r => '  • ' + r.name).join('\n');
    const more = actionable.length > 8 ? `\n  …and ${actionable.length - 8} more` : '';
    const skipNote = noop ? `\n\n${noop} already not deployed and will be skipped.` : '';
    if (!window.confirm(`${verb} ${actionable.length} artifact(s)?\n\n${names}${more}${skipNote}`)) return;

    setBusy(action);
    setOutcomes(null);
    try {
      const payload = actionable.map(r => ({ id: r.id, version: r.version }));
      const data = action === 'deploy'
        ? await bulkDeployArtifacts(payload)
        : await bulkUndeployArtifacts(payload);

      const okCount = action === 'deploy' ? data.deployed : data.undeployed;
      setOutcomes({ action, outcomes: data.outcomes || [] });

      const skipped = (data.skipped || 0) + noop;
      const skipText = skipped ? `, ${skipped} skipped` : '';

      if (data.failed) {
        addToast?.(`${verb}: ${okCount} succeeded, ${data.failed} failed${skipText}`, 'warning');
      } else {
        addToast?.(`${verb}ed ${okCount} artifact(s)${skipText}`, 'success');
        setSelected(new Set());
      }
      await load({ refresh: true });
    } catch (e) {
      const msg = e?.response?.data?.error || e.message;
      addToast?.(`${verb} failed: ` + msg, 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Artifacts</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Search design-time artifacts across every package, then deploy or undeploy the ones you select.
          Use <code className="px-1 py-0.5 bg-slate-100 rounded text-[12px]">*</code> and{' '}
          <code className="px-1 py-0.5 bg-slate-100 rounded text-[12px]">?</code> as wildcards; several
          words must all match.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertTriangle size={16} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {!runtimeAvailable && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <span>
            This tenant has no runtime location provisioned, so deployed status cannot be read.
            Search and deploy still work, but the Status column will show as unknown.
          </span>
        </div>
      )}

      {failedPackages.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <span>Could not read {failedPackages.length} package(s): {failedPackages.join(', ')}</span>
        </div>
      )}

      {/* Type filter */}
      <div className="flex flex-wrap gap-2">
        {TYPES.map(({ id, label, icon: Icon }) => {
          const active = type === id;
          const n = counts[id];
          return (
            <button
              key={id}
              onClick={() => setType(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border transition ${
                active
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
              }`}
            >
              <Icon size={13} />
              {label}
              {n !== undefined && (
                <span className={active ? 'text-indigo-100' : 'text-slate-400'}>({n})</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search + package filter */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search name, ID, package or description — wildcards: demo*, send?, *em*"
            className="w-full pl-8 pr-4 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
        <select
          value={packageId}
          onChange={e => setPackageId(e.target.value)}
          className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 text-slate-700"
        >
          <option value="ALL">All packages</option>
          {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button
          onClick={() => load({ refresh: true })}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-xl bg-white hover:border-indigo-300 disabled:opacity-50"
          title="Rebuild the artifact index from CPI"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-500">
          {selected.size > 0 ? `${selected.size} selected` : `${rows.length} artifact(s)`}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => act('deploy')}
            disabled={!selected.size || Boolean(busy)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-indigo-600 text-white disabled:opacity-40 hover:bg-indigo-700"
          >
            {busy === 'deploy' ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
            Deploy
          </button>
          <button
            onClick={() => act('undeploy')}
            disabled={!selected.size || Boolean(busy)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-white text-red-600 border border-red-200 disabled:opacity-40 hover:bg-red-50"
          >
            {busy === 'undeploy' ? <Loader2 size={14} className="animate-spin" /> : <PowerOff size={14} />}
            Undeploy
          </button>
        </div>
      </div>

      {/* Per-artifact results of the last bulk action */}
      {outcomes && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1.5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Last {outcomes.action} result
          </p>
          {outcomes.outcomes.map(o => (
            <div key={o.id} className="flex items-start gap-2 text-sm">
              {o.ok
                ? <CheckCircle2 size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                : o.skipped
                  ? <MinusCircle size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />
                  : <XCircle size={14} className="text-red-600 mt-0.5 flex-shrink-0" />}
              <span className="font-mono text-xs text-slate-700">{o.id}</span>
              {!o.ok && (
                <span className={`text-xs ${o.skipped ? 'text-slate-500' : 'text-red-600'}`}>
                  — {o.error}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-slate-400">
            <Loader2 size={24} className="animate-spin" />
            <span className="text-sm">Searching artifacts…</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <p className="text-sm font-medium">No artifacts found</p>
            {(query || type !== 'ALL' || packageId !== 'ALL') && (
              <p className="text-xs mt-1">Try a different word, or widen the type and package filters</p>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    className="rounded border-slate-300"
                    title="Select all shown"
                  />
                </th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Package</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr
                  key={r.id}
                  onClick={() => toggle(r.id)}
                  className={`cursor-pointer transition ${selected.has(r.id) ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      onClick={e => e.stopPropagation()}
                      className="rounded border-slate-300"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{r.name}</div>
                    <div className="font-mono text-[11px] text-slate-400">{r.id}</div>
                  </td>
                  <td className="px-4 py-3"><TypeBadge type={r.type} /></td>
                  <td className="px-4 py-3 text-slate-600">{r.packageName}</td>
                  <td className="px-4 py-3 text-slate-500">{r.version}</td>
                  <td className="px-4 py-3">
                    {!runtimeAvailable ? (
                      <span className="text-xs text-slate-400">unknown</span>
                    ) : r.deployed ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <CheckCircle2 size={12} /> {r.deployedStatus || 'Deployed'}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Not deployed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
