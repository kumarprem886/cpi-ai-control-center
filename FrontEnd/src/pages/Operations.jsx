import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database, Variable, MessageSquare, Radio, Settings, FileText,
  RefreshCw, Loader2, ChevronDown, ChevronRight, Trash2
} from 'lucide-react';
import { apiClient } from '../api.js';

/* ─── helpers ─────────────────────────────────────────── */

function Spinner() {
  return <Loader2 size={16} className="animate-spin text-slate-400" />;
}

function EmptyState() {
  return <p className="text-center text-slate-400 py-6 text-sm">No data found.</p>;
}

function ErrorState({ msg }) {
  return <p className="text-center text-red-400 py-6 text-sm">Error: {msg}</p>;
}

function Th({ children }) {
  return (
    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-2 bg-slate-50 border-b border-slate-200">
      {children}
    </th>
  );
}

function Td({ children }) {
  return (
    <td className="px-4 py-2 text-sm text-slate-700 border-b border-slate-100 align-top">
      {children}
    </td>
  );
}

function RefreshBtn({ onClick, loading }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg disabled:opacity-50"
    >
      <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
      Refresh
    </button>
  );
}

/* ─── accordion card ──────────────────────────────────── */

function Section({ icon: Icon, title, color, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className={`p-2 rounded-xl ${color}`}>
            <Icon size={16} />
          </span>
          <span className="font-semibold text-slate-800">{title}</span>
        </div>
        {open ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-slate-100"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── 1. Data Stores ──────────────────────────────────── */

function DataStoreEntries({ name }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetch = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get(`/cpi/datastores/${encodeURIComponent(name)}/entries`);
      setEntries(res.data.results || []);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => { fetch(); }, [fetch]);

  const deleteEntry = async (entryId) => {
    try {
      await apiClient.delete(`/cpi/datastores/${encodeURIComponent(name)}/entries/${encodeURIComponent(entryId)}`);
      setEntries(prev => prev.filter(e => e.Id !== entryId));
    } catch (e) {
      alert('Delete failed: ' + (e.response?.data?.error || e.message));
    }
  };

  if (loading) return <div className="flex justify-center py-4"><Spinner /></div>;
  if (error) return <ErrorState msg={error} />;
  if (!entries.length) return <EmptyState />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>Id</Th><Th>MessageId</Th><Th>DueAt</Th><Th>Status</Th><Th></Th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.Id} className="hover:bg-slate-50">
              <Td><span className="font-mono text-xs">{e.Id}</span></Td>
              <Td><span className="font-mono text-xs">{e.MessageId}</span></Td>
              <Td>{e.DueAt}</Td>
              <Td>
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                  e.Status === 'Waiting' ? 'bg-amber-100 text-amber-700' :
                  e.Status === 'Failed'  ? 'bg-red-100 text-red-700' :
                                           'bg-emerald-100 text-emerald-700'
                }`}>{e.Status}</span>
              </Td>
              <Td>
                <button onClick={() => deleteEntry(e.Id)} className="text-red-400 hover:text-red-600">
                  <Trash2 size={14} />
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataStoresSection() {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiClient.get('/cpi/datastores');
      setStores(res.data.results || []);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <Section icon={Database} title="Data Stores" color="bg-blue-50 text-blue-600" defaultOpen>
      <div className="p-4 flex justify-end"><RefreshBtn onClick={fetch} loading={loading} /></div>
      {loading && <div className="flex justify-center py-6"><Spinner /></div>}
      {!loading && error && <ErrorState msg={error} />}
      {!loading && !error && !stores.length && <EmptyState />}
      {!loading && !error && stores.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><Th>Name</Th><Th>Visibility</Th><Th>Type</Th></tr></thead>
            <tbody>
              {stores.map(s => (
                <>
                  <tr
                    key={s.DataStoreName}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => setExpanded(expanded === s.DataStoreName ? null : s.DataStoreName)}
                  >
                    <Td>
                      <div className="flex items-center gap-2">
                        {expanded === s.DataStoreName ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <span className="font-medium text-slate-800">{s.DataStoreName}</span>
                      </div>
                    </Td>
                    <Td>{s.Visibility}</Td>
                    <Td>{s.Type}</Td>
                  </tr>
                  {expanded === s.DataStoreName && (
                    <tr key={s.DataStoreName + '_entries'}>
                      <td colSpan={3} className="bg-slate-50 px-6 py-3">
                        <DataStoreEntries name={s.DataStoreName} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ─── 2. Variables ────────────────────────────────────── */

function VariablesSection() {
  const [vars, setVars] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetch = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiClient.get('/cpi/variables');
      setVars(res.data.results || []);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const deleteVar = async (flowId, varName) => {
    try {
      await apiClient.delete(`/cpi/variables/${encodeURIComponent(flowId)}/${encodeURIComponent(varName)}`);
      setVars(prev => prev.filter(v => !(v.FlowId === flowId && v.VariableName === varName)));
    } catch (e) { alert('Delete failed: ' + (e.response?.data?.error || e.message)); }
  };

  return (
    <Section icon={Variable} title="Variables" color="bg-purple-50 text-purple-600">
      <div className="p-4 flex justify-end"><RefreshBtn onClick={fetch} loading={loading} /></div>
      {loading && <div className="flex justify-center py-6"><Spinner /></div>}
      {!loading && error && <ErrorState msg={error} />}
      {!loading && !error && !vars.length && <EmptyState />}
      {!loading && !error && vars.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><Th>FlowId</Th><Th>VariableName</Th><Th>Value</Th><Th>UpdatedAt</Th><Th></Th></tr></thead>
            <tbody>
              {vars.map((v, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <Td><span className="font-mono text-xs">{v.FlowId}</span></Td>
                  <Td>{v.VariableName}</Td>
                  <Td><span className="font-mono text-xs truncate max-w-xs block">{v.Value}</span></Td>
                  <Td>{v.UpdatedAt}</Td>
                  <Td>
                    <button onClick={() => deleteVar(v.FlowId, v.VariableName)} className="text-red-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ─── 3. Message Store ────────────────────────────────── */

function MessageStoreSection() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetch = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiClient.get('/cpi/message-store-entries?$top=50');
      setItems(res.data.results || []);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <Section icon={MessageSquare} title="Message Store" color="bg-emerald-50 text-emerald-600">
      <div className="p-4 flex justify-end"><RefreshBtn onClick={fetch} loading={loading} /></div>
      {loading && <div className="flex justify-center py-6"><Spinner /></div>}
      {!loading && error && <ErrorState msg={error} />}
      {!loading && !error && !items.length && <EmptyState />}
      {!loading && !error && items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><Th>Id</Th><Th>MessageId</Th><Th>Status</Th><Th>Timestamp</Th></tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <Td><span className="font-mono text-xs">{it.Id}</span></Td>
                  <Td><span className="font-mono text-xs">{it.MessageId}</span></Td>
                  <Td>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      it.Status === 'FAILED' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>{it.Status}</span>
                  </Td>
                  <Td>{it.Timestamp}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ─── 4. JMS Brokers ──────────────────────────────────── */

function JmsBrokersSection() {
  const [brokers, setBrokers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetch = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiClient.get('/cpi/jms-brokers');
      setBrokers(res.data.results || []);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <Section icon={Radio} title="JMS Brokers" color="bg-orange-50 text-orange-600">
      <div className="p-4 flex justify-end"><RefreshBtn onClick={fetch} loading={loading} /></div>
      {loading && <div className="flex justify-center py-6"><Spinner /></div>}
      {!loading && error && <ErrorState msg={error} />}
      {!loading && !error && !brokers.length && <EmptyState />}
      {!loading && !error && brokers.length > 0 && (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {brokers.map((b, i) => (
            <div key={i} className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
              {Object.entries(b).map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm">
                  <span className="text-slate-500 font-medium">{k}</span>
                  <span className="text-slate-800 font-mono text-xs">{String(v)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/* ─── 5. Tenant Configurations ───────────────────────── */

function TenantConfigSection() {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetch = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiClient.get('/cpi/tenant-configurations');
      setConfigs(res.data.results || []);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <Section icon={Settings} title="Tenant Configurations" color="bg-slate-100 text-slate-600">
      <div className="p-4 flex justify-end"><RefreshBtn onClick={fetch} loading={loading} /></div>
      {loading && <div className="flex justify-center py-6"><Spinner /></div>}
      {!loading && error && <ErrorState msg={error} />}
      {!loading && !error && !configs.length && <EmptyState />}
      {!loading && !error && configs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><Th>TenantId</Th><Th>Properties</Th></tr></thead>
            <tbody>
              {configs.map((c, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <Td><span className="font-mono text-xs">{c.TenantId}</span></Td>
                  <Td>
                    <div className="space-y-1">
                      {c.Properties && typeof c.Properties === 'object'
                        ? Object.entries(c.Properties).map(([k, v]) => (
                            <div key={k} className="flex gap-2 text-xs">
                              <span className="text-slate-500 font-medium min-w-24">{k}:</span>
                              <span className="text-slate-700 font-mono">{String(v)}</span>
                            </div>
                          ))
                        : <span className="font-mono text-xs">{String(c.Properties)}</span>
                      }
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ─── 6. Log Files ────────────────────────────────────── */

function LogFilesSection() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetch = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiClient.get('/cpi/log-files');
      setLogs(res.data.results || []);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <Section icon={FileText} title="Log Files" color="bg-rose-50 text-rose-600">
      <div className="p-4 flex justify-end"><RefreshBtn onClick={fetch} loading={loading} /></div>
      {loading && <div className="flex justify-center py-6"><Spinner /></div>}
      {!loading && error && <ErrorState msg={error} />}
      {!loading && !error && !logs.length && <EmptyState />}
      {!loading && !error && logs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><Th>LogFileType</Th><Th>Name</Th><Th>LastModified</Th></tr></thead>
            <tbody>
              {logs.map((l, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <Td>
                    <span className="inline-block px-2 py-0.5 bg-rose-50 text-rose-700 rounded-full text-xs font-medium">
                      {l.LogFileType}
                    </span>
                  </Td>
                  <Td>{l.Name}</Td>
                  <Td>{l.LastModified}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ─── page ────────────────────────────────────────────── */

export default function Operations() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-800">Operations</h1>
        <p className="text-slate-500 mt-1">Monitor and manage runtime operational data</p>
      </div>

      <DataStoresSection />
      <VariablesSection />
      <MessageStoreSection />
      <JmsBrokersSection />
      <TenantConfigSection />
      <LogFilesSection />
    </motion.div>
  );
}


