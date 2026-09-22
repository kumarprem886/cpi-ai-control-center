import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Shield, Lock, Key, AlertTriangle, RefreshCw,
  Loader2, Eye, EyeOff, User, Plus, Trash2, Edit2, X, Check,
  Settings, Globe, FileKey, Hash, ShieldCheck
} from 'lucide-react';
import { getCredentials, getKeystore } from '../api';
import apiClient from '../api';

const TABS = [
  { id: 'credentials',      label: 'User Credentials',    icon: User       },
  { id: 'keystore',         label: 'Keystore Entries',    icon: Lock       },
  { id: 'secure-params',    label: 'Secure Parameters',   icon: Settings   },
  { id: 'oauth-creds',      label: 'OAuth Credentials',   icon: Globe      },
  { id: 'cert-mappings',    label: 'Certificate Mappings',icon: FileKey    },
  { id: 'number-ranges',    label: 'Number Ranges',        icon: Hash       },
  { id: 'access-policies',  label: 'Access Policies',     icon: ShieldCheck},
];

function MaskedValue() {
  const [show, setShow] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-500">
      {show ? 'p@ssw0rd••••' : '••••••••••••'}
      <button onClick={() => setShow(v => !v)} className="text-slate-300 hover:text-slate-500">
        {show ? <EyeOff size={11} /> : <Eye size={11} />}
      </button>
    </span>
  );
}

function TableSkeleton({ cols }) {
  return (
    <div className="space-y-2 p-4">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="grid gap-4 animate-pulse" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {[...Array(cols)].map((__, j) => (
            <div key={j} className="h-8 bg-slate-200 rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ─── Reusable inline Add-form ─────────────────────────────────────────────── */
function AddForm({ fields, onSubmit, onCancel, submitting }) {
  const [vals, setVals] = useState(() => Object.fromEntries(fields.map(f => [f.name, ''])));
  const set = (k, v) => setVals(prev => ({ ...prev, [k]: v }));
  return (
    <form
      onSubmit={e => { e.preventDefault(); onSubmit(vals); }}
      className="flex flex-wrap gap-3 items-end px-4 py-3 bg-indigo-50 border-b border-indigo-100"
    >
      {fields.map(f => (
        <div key={f.name} className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">{f.label}</label>
          <input
            required={!f.optional}
            type={f.type || 'text'}
            placeholder={f.placeholder || f.label}
            value={vals[f.name]}
            onChange={e => set(f.name, e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white w-44"
          />
        </div>
      ))}
      <div className="flex gap-2 mb-0.5">
        <button
          type="submit"
          disabled={submitting}
          className="flex items-center gap-1.5 text-sm font-medium bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 text-sm text-slate-500 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-100"
        >
          <X size={13} /> Cancel
        </button>
      </div>
    </form>
  );
}

/* ─── Secure Parameters ─────────────────────────────────────────────────────── */
function SecureParameters({ addToast }) {
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editRow, setEditRow]     = useState(null); // { index, item }

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/cpi/security/secure-parameters');
      setItems(res.data.results || []);
    } catch (err) {
      addToast('Failed to load secure parameters: ' + (err.response?.data?.error || err.message), 'error');
    } finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleCreate = async (vals) => {
    setSubmitting(true);
    try {
      await apiClient.post('/cpi/security/secure-parameters', vals);
      addToast('Secure parameter created', 'success');
      setShowAdd(false);
      fetch();
    } catch (err) {
      addToast('Create failed: ' + (err.response?.data?.error || err.message), 'error');
    } finally { setSubmitting(false); }
  };

  const handleEdit = async (name, vals) => {
    setSubmitting(true);
    try {
      await apiClient.put(`/api/cpi/security/secure-parameters/${encodeURIComponent(name)}`, vals);
      addToast('Secure parameter updated', 'success');
      setEditRow(null);
      fetch();
    } catch (err) {
      addToast('Update failed: ' + (err.response?.data?.error || err.message), 'error');
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (name) => {
    if (!window.confirm(`Delete secure parameter "${name}"?`)) return;
    try {
      await apiClient.delete(`/api/cpi/security/secure-parameters/${encodeURIComponent(name)}`);
      addToast('Deleted', 'success');
      fetch();
    } catch (err) {
      addToast('Delete failed: ' + (err.response?.data?.error || err.message), 'error');
    }
  };

  const FIELDS = [
    { name: 'ParameterName', label: 'Parameter Name' },
    { name: 'Description',   label: 'Description', optional: true },
    { name: 'Value',         label: 'Value', type: 'password' },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100">
        <Settings size={16} className="text-indigo-500" />
        <h2 className="text-base font-semibold text-slate-700">Secure Parameters</h2>
        <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{items.length} entries</span>
        <button onClick={() => { setShowAdd(v => !v); setEditRow(null); }} className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 px-3 py-1.5 rounded-lg ml-2">
          <Plus size={13} /> Add
        </button>
        <button onClick={fetch} className="flex items-center gap-1.5 text-sm text-slate-500 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg ml-1">
          <RefreshCw size={13} />
        </button>
      </div>

      {showAdd && (
        <AddForm fields={FIELDS} onSubmit={handleCreate} onCancel={() => setShowAdd(false)} submitting={submitting} />
      )}

      {loading ? <TableSkeleton cols={3} /> : items.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Settings size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No secure parameters found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Parameter Name</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Description</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                editRow?.index === i ? (
                  <tr key={item.ParameterName || i} className="border-b border-slate-100 bg-indigo-50">
                    <td colSpan={3} className="p-2">
                      <AddForm
                        fields={[
                          { name: 'Description', label: 'Description', optional: true },
                          { name: 'Value', label: 'New Value', type: 'password' },
                        ]}
                        onSubmit={(vals) => handleEdit(item.ParameterName, vals)}
                        onCancel={() => setEditRow(null)}
                        submitting={submitting}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={item.ParameterName || i} className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer" onClick={() => setEditRow({ index: i, item })}>
                    <td className="py-3 px-4 font-medium text-slate-800 flex items-center gap-2">
                      <Settings size={13} className="text-indigo-400 flex-shrink-0" />
                      {item.ParameterName || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-500">{item.Description || '—'}</td>
                    <td className="py-3 px-4">
                      <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setEditRow({ index: i, item })} className="text-indigo-400 hover:text-indigo-600"><Edit2 size={14} /></button>
                        <button onClick={() => handleDelete(item.ParameterName)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── OAuth Credentials ─────────────────────────────────────────────────────── */
function OAuthCredentials({ addToast }) {
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/cpi/security/oauth-credentials');
      setItems(res.data.results || []);
    } catch (err) {
      addToast('Failed to load OAuth credentials: ' + (err.response?.data?.error || err.message), 'error');
    } finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleCreate = async (vals) => {
    setSubmitting(true);
    try {
      await apiClient.post('/cpi/security/oauth-credentials', vals);
      addToast('OAuth credential created', 'success');
      setShowAdd(false);
      fetch();
    } catch (err) {
      addToast('Create failed: ' + (err.response?.data?.error || err.message), 'error');
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (name) => {
    if (!window.confirm(`Delete OAuth credential "${name}"?`)) return;
    try {
      await apiClient.delete(`/api/cpi/security/oauth-credentials/${encodeURIComponent(name)}`);
      addToast('Deleted', 'success');
      fetch();
    } catch (err) {
      addToast('Delete failed: ' + (err.response?.data?.error || err.message), 'error');
    }
  };

  const FIELDS = [
    { name: 'Name',            label: 'Name' },
    { name: 'GrantType',       label: 'Grant Type' },
    { name: 'TokenServiceUrl', label: 'Token Service URL' },
    { name: 'ClientId',        label: 'Client ID' },
    { name: 'ClientSecret',    label: 'Client Secret', type: 'password' },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100">
        <Globe size={16} className="text-indigo-500" />
        <h2 className="text-base font-semibold text-slate-700">OAuth Credentials</h2>
        <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{items.length} entries</span>
        <button onClick={() => setShowAdd(v => !v)} className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 px-3 py-1.5 rounded-lg ml-2">
          <Plus size={13} /> Add
        </button>
        <button onClick={fetch} className="flex items-center gap-1.5 text-sm text-slate-500 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg ml-1">
          <RefreshCw size={13} />
        </button>
      </div>

      {showAdd && (
        <AddForm fields={FIELDS} onSubmit={handleCreate} onCancel={() => setShowAdd(false)} submitting={submitting} />
      )}

      {loading ? <TableSkeleton cols={3} /> : items.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Globe size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No OAuth credentials found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Name</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Grant Type</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Token Service URL</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide w-16">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.Name || i} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-3 px-4 font-medium text-slate-800 flex items-center gap-2">
                    <Globe size={13} className="text-indigo-400 flex-shrink-0" />
                    {item.Name || '—'}
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium">
                      {item.GrantType || '—'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-500 font-mono text-xs truncate max-w-xs">{item.TokenServiceUrl || '—'}</td>
                  <td className="py-3 px-4">
                    <button onClick={() => handleDelete(item.Name)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Certificate Mappings (read-only) ───────────────────────────────────────── */
function CertificateMappings({ addToast }) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/cpi/security/certificate-mappings');
      setItems(res.data.results || []);
    } catch (err) {
      addToast('Failed to load certificate mappings: ' + (err.response?.data?.error || err.message), 'error');
    } finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100">
        <FileKey size={16} className="text-indigo-500" />
        <h2 className="text-base font-semibold text-slate-700">Certificate Mappings</h2>
        <span className="text-xs text-slate-400 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full ml-1">read-only</span>
        <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{items.length} entries</span>
        <button onClick={fetch} className="flex items-center gap-1.5 text-sm text-slate-500 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg ml-2">
          <RefreshCw size={13} />
        </button>
      </div>

      {loading ? <TableSkeleton cols={3} /> : items.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <FileKey size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No certificate mappings found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">User</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Certificate</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Last Modified By</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.User || i} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-3 px-4 font-medium text-slate-800 flex items-center gap-2">
                    <FileKey size={13} className="text-indigo-400 flex-shrink-0" />
                    {item.User || '—'}
                  </td>
                  <td className="py-3 px-4 text-slate-500 font-mono text-xs">{item.Certificate || '—'}</td>
                  <td className="py-3 px-4 text-slate-500">{item.LastModifiedBy || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Number Ranges ─────────────────────────────────────────────────────────── */
function NumberRanges({ addToast }) {
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/cpi/security/number-ranges');
      setItems(res.data.results || []);
    } catch (err) {
      addToast('Failed to load number ranges: ' + (err.response?.data?.error || err.message), 'error');
    } finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleCreate = async (vals) => {
    setSubmitting(true);
    try {
      await apiClient.post('/cpi/security/number-ranges', vals);
      addToast('Number range created', 'success');
      setShowAdd(false);
      fetch();
    } catch (err) {
      addToast('Create failed: ' + (err.response?.data?.error || err.message), 'error');
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (name) => {
    if (!window.confirm(`Delete number range "${name}"?`)) return;
    try {
      await apiClient.delete(`/api/cpi/security/number-ranges/${encodeURIComponent(name)}`);
      addToast('Deleted', 'success');
      fetch();
    } catch (err) {
      addToast('Delete failed: ' + (err.response?.data?.error || err.message), 'error');
    }
  };

  const FIELDS = [
    { name: 'Name',         label: 'Name' },
    { name: 'Description',  label: 'Description', optional: true },
    { name: 'MinValue',     label: 'Min Value', type: 'number' },
    { name: 'MaxValue',     label: 'Max Value', type: 'number' },
    { name: 'FieldLength',  label: 'Field Length', type: 'number' },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100">
        <Hash size={16} className="text-indigo-500" />
        <h2 className="text-base font-semibold text-slate-700">Number Ranges</h2>
        <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{items.length} entries</span>
        <button onClick={() => setShowAdd(v => !v)} className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 px-3 py-1.5 rounded-lg ml-2">
          <Plus size={13} /> Add
        </button>
        <button onClick={fetch} className="flex items-center gap-1.5 text-sm text-slate-500 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg ml-1">
          <RefreshCw size={13} />
        </button>
      </div>

      {showAdd && (
        <AddForm fields={FIELDS} onSubmit={handleCreate} onCancel={() => setShowAdd(false)} submitting={submitting} />
      )}

      {loading ? <TableSkeleton cols={7} /> : items.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Hash size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No number ranges found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Name</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Description</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Min</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Max</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Current</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Length</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Rotate</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide w-16">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.Name || i} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-3 px-4 font-medium text-slate-800 flex items-center gap-2">
                    <Hash size={13} className="text-indigo-400 flex-shrink-0" />
                    {item.Name || '—'}
                  </td>
                  <td className="py-3 px-4 text-slate-500">{item.Description || '—'}</td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-600">{item.MinValue ?? '—'}</td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-600">{item.MaxValue ?? '—'}</td>
                  <td className="py-3 px-4 font-mono text-xs text-emerald-600 font-semibold">{item.CurrentValue ?? '—'}</td>
                  <td className="py-3 px-4 text-slate-500">{item.FieldLength ?? '—'}</td>
                  <td className="py-3 px-4">
                    {item.Rotate != null ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.Rotate ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
                        {item.Rotate ? 'Yes' : 'No'}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-3 px-4">
                    <button onClick={() => handleDelete(item.Name)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Access Policies ───────────────────────────────────────────────────────── */
function AccessPolicies({ addToast }) {
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/cpi/security/access-policies');
      setItems(res.data.results || []);
    } catch (err) {
      addToast('Failed to load access policies: ' + (err.response?.data?.error || err.message), 'error');
    } finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleCreate = async (vals) => {
    setSubmitting(true);
    try {
      await apiClient.post('/cpi/security/access-policies', vals);
      addToast('Access policy created', 'success');
      setShowAdd(false);
      fetch();
    } catch (err) {
      addToast('Create failed: ' + (err.response?.data?.error || err.message), 'error');
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete access policy "${name}"?`)) return;
    try {
      await apiClient.delete(`/api/cpi/security/access-policies/${encodeURIComponent(id)}`);
      addToast('Deleted', 'success');
      fetch();
    } catch (err) {
      addToast('Delete failed: ' + (err.response?.data?.error || err.message), 'error');
    }
  };

  const FIELDS = [
    { name: 'RoleName',    label: 'Role Name' },
    { name: 'Description', label: 'Description', optional: true },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100">
        <ShieldCheck size={16} className="text-indigo-500" />
        <h2 className="text-base font-semibold text-slate-700">Access Policies</h2>
        <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{items.length} entries</span>
        <button onClick={() => setShowAdd(v => !v)} className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 px-3 py-1.5 rounded-lg ml-2">
          <Plus size={13} /> Add
        </button>
        <button onClick={fetch} className="flex items-center gap-1.5 text-sm text-slate-500 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg ml-1">
          <RefreshCw size={13} />
        </button>
      </div>

      {showAdd && (
        <AddForm fields={FIELDS} onSubmit={handleCreate} onCancel={() => setShowAdd(false)} submitting={submitting} />
      )}

      {loading ? <TableSkeleton cols={2} /> : items.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <ShieldCheck size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No access policies found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Role Name</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Description</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide w-16">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.Id || item.RoleName || i} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-3 px-4 font-medium text-slate-800 flex items-center gap-2">
                    <ShieldCheck size={13} className="text-indigo-400 flex-shrink-0" />
                    {item.RoleName || '—'}
                  </td>
                  <td className="py-3 px-4 text-slate-500">{item.Description || '—'}</td>
                  <td className="py-3 px-4">
                    <button onClick={() => handleDelete(item.Id ?? item.RoleName, item.RoleName)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────────────────── */
export default function Security({ addToast }) {
  const [activeTab, setActiveTab] = useState('credentials');
  const [credentials, setCredentials] = useState([]);
  const [keystore, setKeystore] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [credRes, ksRes] = await Promise.all([
        getCredentials(),
        getKeystore(),
      ]);
      setCredentials(credRes.data.results || []);
      setKeystore(ksRes.data.results || []);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setError(msg);
      addToast('Failed to load security data: ' + msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Security</h1>
          <p className="text-slate-500 mt-1">Credentials and keystore management</p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:border-slate-300 px-4 py-2 rounded-xl"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Warning banner */}
      <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
        <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-amber-500" />
        <div>
          <strong>Read-only view.</strong> Security materials are displayed for reference only.
          Passwords and private key material are never exposed through this dashboard.
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertTriangle size={16} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all
              ${activeTab === id
                ? 'bg-indigo-600 text-white border-transparent shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* Credentials table */}
      {activeTab === 'credentials' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100">
            <User size={16} className="text-indigo-500" />
            <h2 className="text-base font-semibold text-slate-700">User Credentials</h2>
            <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              {credentials.length} entries
            </span>
          </div>
          {loading ? (
            <TableSkeleton cols={4} />
          ) : credentials.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Key size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No user credentials found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Name</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Kind</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Description</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Password</th>
                  </tr>
                </thead>
                <tbody>
                  {credentials.map((cred, i) => (
                    <tr key={cred.Name || i} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-3 px-4 font-medium text-slate-800 flex items-center gap-2">
                        <Shield size={13} className="text-indigo-400 flex-shrink-0" />
                        {cred.Name || '—'}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium">
                          {cred.Kind || cred.Type || 'Credential'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-500">{cred.Description || '—'}</td>
                      <td className="py-3 px-4"><MaskedValue /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Keystore table */}
      {activeTab === 'keystore' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100">
            <Lock size={16} className="text-indigo-500" />
            <h2 className="text-base font-semibold text-slate-700">Keystore Entries</h2>
            <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              {keystore.length} entries
            </span>
          </div>
          {loading ? (
            <TableSkeleton cols={4} />
          ) : keystore.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Lock size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No keystore entries found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Alias</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Type</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Valid Until</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {keystore.map((entry, i) => {
                    const validUntil = entry.ValidNotAfter || entry.ValidUntil;
                    const expired = validUntil && new Date(validUntil) < new Date();
                    return (
                      <tr key={entry.Alias || i} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="py-3 px-4 font-medium text-slate-800 flex items-center gap-2">
                          <Lock size={13} className="text-indigo-400 flex-shrink-0" />
                          {entry.Alias || '—'}
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                            {entry.Type || entry.KeyType || '—'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {validUntil ? (
                            <span className={`text-xs font-medium ${expired ? 'text-red-600' : 'text-emerald-600'}`}>
                              {expired ? '⚠ ' : ''}{new Date(validUntil).toLocaleDateString()}
                            </span>
                          ) : <span className="text-slate-400 text-xs">—</span>}
                        </td>
                        <td className="py-3 px-4 text-slate-500">{entry.Owner || entry.Subject || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* New sections — each renders its own card */}
      {activeTab === 'secure-params'   && <SecureParameters   addToast={addToast} />}
      {activeTab === 'oauth-creds'     && <OAuthCredentials   addToast={addToast} />}
      {activeTab === 'cert-mappings'   && <CertificateMappings addToast={addToast} />}
      {activeTab === 'number-ranges'   && <NumberRanges       addToast={addToast} />}
      {activeTab === 'access-policies' && <AccessPolicies     addToast={addToast} />}
    </motion.div>
  );
}

