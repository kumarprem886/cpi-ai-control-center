import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Shield, CheckCircle, XCircle, AlertTriangle, Key,
  Package, Clock, Award, RefreshCw, Loader2, Info
} from 'lucide-react';
import { apiClient } from '../api';

/* ── helpers ── */
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return Math.floor((d - Date.now()) / 86400000);
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return isNaN(d) ? dateStr : d.toLocaleDateString();
}

const SAFE_NAME = /^[A-Za-z0-9_\-]+$/;

/* ── score helper ── */
const WEIGHTS = { pass: 1, warn: 0.5, fail: 0, info: null };

function scoreChecks(checks) {
  const scorable = checks.filter(c => c.status !== 'info');
  const earned = scorable.reduce((acc, c) => acc + WEIGHTS[c.status], 0);
  const max = scorable.length;
  return { score: max ? Math.round((earned / max) * 100) : 100, passing: scorable.filter(c => c.status === 'pass').length, total: max };
}

/* ── status badge ── */
function StatusBadge({ status }) {
  const map = {
    pass: { label: 'PASS', cls: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle size={13} /> },
    warn: { label: 'WARN', cls: 'bg-amber-100 text-amber-700', icon: <AlertTriangle size={13} /> },
    fail: { label: 'FAIL', cls: 'bg-red-100 text-red-700', icon: <XCircle size={13} /> },
    info: { label: 'INFO', cls: 'bg-blue-100 text-blue-700', icon: <Info size={13} /> },
  };
  const s = map[status] || map.info;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${s.cls}`}>
      {s.icon}{s.label}
    </span>
  );
}

/* ── days remaining colour ── */
function DaysCell({ days }) {
  if (days === null) return <span className="text-slate-400">—</span>;
  const cls = days < 0 ? 'text-red-600 font-semibold' : days < 30 ? 'text-red-500 font-semibold' : days < 90 ? 'text-amber-600 font-semibold' : 'text-emerald-600';
  return <span className={cls}>{days < 0 ? `Expired ${Math.abs(days)}d ago` : `${days}d`}</span>;
}

/* ── skeleton ── */
function Skeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-32 bg-slate-200 rounded-2xl" />
      <div className="grid grid-cols-2 gap-4">
        {[...Array(6)].map((_, i) => <div key={i} className="h-24 bg-slate-200 rounded-xl" />)}
      </div>
    </div>
  );
}

export default function Governance() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ksRes, pkgRes, credRes, spRes, raRes] = await Promise.allSettled([
        apiClient.get('/keystore'),
        apiClient.get('/packages'),
        apiClient.get('/credentials'),
        apiClient.get('/cpi/security/secure-parameters'),
        apiClient.get('/runtime-artifacts'),
      ]);

      const value = (r, fallback = []) => r.status === 'fulfilled' ? (r.value?.data ?? fallback) : fallback;

      const ksRaw    = value(ksRes, []);
      const pkgRaw   = value(pkgRes, []);
      const credRaw  = value(credRes, []);
      const spRaw    = value(spRes, []);
      const raRaw    = value(raRes, []);

      // Normalise keystore — API may return { results: [...] } or array
      const keystore = Array.isArray(ksRaw) ? ksRaw : (ksRaw?.results ?? []);
      const packages = Array.isArray(pkgRaw) ? pkgRaw : (pkgRaw?.results ?? []);
      const credArr  = Array.isArray(credRaw) ? credRaw : (credRaw?.results ?? []);
      const spArr    = Array.isArray(spRaw) ? spRaw : (spRaw?.results ?? []);
      const raArr    = Array.isArray(raRaw) ? raRaw : (raRaw?.results ?? []);

      setData({ keystore, packages, credCount: credArr.length, spCount: spArr.length, raCount: raArr.length });
    } catch (e) {
      setError(e.message || 'Failed to load governance data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* ── derive checks ── */
  const checks = data ? buildChecks(data) : [];
  const { score, passing, total } = scoreChecks(checks);

  const scoreColor = score >= 80 ? 'text-emerald-600' : score >= 60 ? 'text-amber-500' : 'text-red-500';
  const barColor   = score >= 80 ? 'bg-emerald-500'  : score >= 60 ? 'bg-amber-400'    : 'bg-red-500';

  /* ── cert table data ── */
  const certRows = data?.keystore
    ?.map(e => ({
      alias: e.Alias || e.alias || '—',
      type: e.Type || e.type || '—',
      from: e.ValidNotBefore || e.validNotBefore || null,
      until: e.ValidNotAfter || e.validNotAfter || null,
      days: daysUntil(e.ValidNotAfter || e.validNotAfter),
    }))
    .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999)) ?? [];

  /* ── package table ── */
  const pkgRows = data?.packages?.map(p => ({
    id: p.Id || p.id || '—',
    name: p.Name || p.name || '—',
    version: p.Version || p.version || '—',
    desc: p.Description || p.description || '',
  })) ?? [];

  return (
    <div className="min-h-screen bg-slate-50 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Shield className="text-indigo-600" size={26} />
            Governance
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">Compliance and policy overview</p>
        </div>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="flex items-center gap-2 text-sm font-medium bg-white border border-slate-200 rounded-xl px-4 py-2 shadow-sm hover:bg-indigo-50 hover:border-indigo-300 transition disabled:opacity-50"
        >
          {loading ? <Loader2 size={15} className="animate-spin text-indigo-500" /> : <RefreshCw size={15} className="text-indigo-500" />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? <Skeleton /> : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">

          {/* Compliance Score Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Award className="text-indigo-500" size={22} />
              <h2 className="text-lg font-semibold text-slate-700">Compliance Score</h2>
            </div>
            <div className="flex items-center gap-8">
              <div className={`text-6xl font-bold ${scoreColor}`}>{score}</div>
              <div className="flex-1 space-y-2">
                <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                  <motion.div
                    className={`h-3 rounded-full ${barColor}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${score}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  />
                </div>
                <p className="text-sm text-slate-500">{passing} of {total} checks passing</p>
              </div>
            </div>
          </div>

          {/* Check Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {checks.map((chk, i) => (
              <motion.div
                key={chk.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex gap-4 items-start"
              >
                <div className="mt-0.5 text-indigo-500">{chk.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-700 text-sm">{chk.title}</span>
                    <StatusBadge status={chk.status} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{chk.description}</p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Certificate Expiry Table */}
          {certRows.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <Clock size={18} className="text-indigo-500" />
                <h2 className="font-semibold text-slate-700">Certificate Expiry</h2>
                <span className="ml-auto text-xs text-slate-400">{certRows.length} entries</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-400 tracking-wide">
                    <tr>
                      {['Alias', 'Type', 'Valid From', 'Valid Until', 'Days Remaining'].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {certRows.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{r.alias}</td>
                        <td className="px-4 py-2.5 text-slate-500">{r.type}</td>
                        <td className="px-4 py-2.5 text-slate-500">{fmtDate(r.from)}</td>
                        <td className="px-4 py-2.5 text-slate-500">{fmtDate(r.until)}</td>
                        <td className="px-4 py-2.5"><DaysCell days={r.days} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Package Overview Table */}
          {pkgRows.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <Package size={18} className="text-indigo-500" />
                <h2 className="font-semibold text-slate-700">Package Overview</h2>
                <span className="ml-auto text-xs text-slate-400">{pkgRows.length} packages</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-400 tracking-wide">
                    <tr>
                      {['ID', 'Name', 'Version', 'Description'].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {pkgRows.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{r.id}</td>
                        <td className="px-4 py-2.5 text-slate-700 font-medium">{r.name}</td>
                        <td className="px-4 py-2.5 text-slate-500">{r.version || '—'}</td>
                        <td className="px-4 py-2.5">
                          {r.desc ? (
                            <span className="text-slate-500 text-xs">{r.desc.slice(0, 80)}{r.desc.length > 80 ? '…' : ''}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                              <AlertTriangle size={11} /> No description
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </motion.div>
      )}
    </div>
  );
}

/* ── build checks from fetched data ── */
function buildChecks({ keystore, packages, credCount, spCount, raCount }) {
  const checks = [];

  // Certificate Expiry
  const certDays = keystore
    .map(e => daysUntil(e.ValidNotAfter || e.validNotAfter))
    .filter(d => d !== null);

  let certStatus = 'pass';
  let certDesc = 'All certificates are valid and not expiring soon.';
  if (certDays.length === 0) {
    certStatus = 'info';
    certDesc = 'No keystore entries found.';
  } else if (certDays.some(d => d < 0)) {
    certStatus = 'fail';
    const n = certDays.filter(d => d < 0).length;
    certDesc = `${n} certificate(s) have already expired.`;
  } else if (certDays.some(d => d < 30)) {
    certStatus = 'warn';
    const n = certDays.filter(d => d < 30).length;
    certDesc = `${n} certificate(s) expire within 30 days.`;
  }
  checks.push({ id: 'cert-expiry', icon: <Clock size={20} />, title: 'Certificate Expiry', status: certStatus, description: certDesc });

  // Credentials in Use
  checks.push({
    id: 'creds',
    icon: <Key size={20} />,
    title: 'Credentials in Use',
    status: credCount > 0 ? 'pass' : 'warn',
    description: credCount > 0
      ? `${credCount} user credential(s) configured.`
      : 'No credentials configured — authentication may not be set up.',
  });

  // Secure Parameters
  checks.push({
    id: 'secure-params',
    icon: <Shield size={20} />,
    title: 'Secure Parameters',
    status: spCount > 0 ? 'pass' : 'warn',
    description: spCount > 0
      ? `${spCount} secure parameter(s) found in secure store.`
      : 'No secure parameters — secrets may be hardcoded in iFlows.',
  });

  // Package Naming
  const badPkgs = packages.filter(p => {
    const name = p.Name || p.name || '';
    return !SAFE_NAME.test(name.replace(/\s/g, '_')) || /[^A-Za-z0-9_\-\s]/.test(name);
  });
  checks.push({
    id: 'pkg-naming',
    icon: <Package size={20} />,
    title: 'Package Naming Convention',
    status: badPkgs.length === 0 ? 'pass' : 'warn',
    description: badPkgs.length === 0
      ? 'All package names follow naming conventions.'
      : `${badPkgs.length} package(s) have names with spaces or special characters.`,
  });

  // Deployed Artifacts
  checks.push({
    id: 'deployed-artifacts',
    icon: <CheckCircle size={20} />,
    title: 'Deployed Artifacts',
    status: 'info',
    description: `${raCount} runtime artifact(s) currently deployed.`,
  });

  // OAuth Usage — check env / heuristics
  const cpiAuthMode = import.meta.env?.VITE_CPI_AUTH_MODE || '';
  const oauthActive = cpiAuthMode.toLowerCase().includes('oauth');
  checks.push({
    id: 'oauth',
    icon: <Award size={20} />,
    title: 'OAuth Usage',
    status: oauthActive ? 'pass' : 'warn',
    description: oauthActive
      ? 'OAuth authentication mode is active.'
      : 'OAuth mode not detected — verify that OAuth is configured for CPI connectivity.',
  });

  return checks;
}
