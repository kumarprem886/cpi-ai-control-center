import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { apiClient } from '../api.js';

const ARTIFACT_TYPES = [
  'IFlow',
  'ValueMapping',
  'ScriptCollection',
  'MessageMapping',
  'FunctionLibrary',
];

export default function ImportZipModal({ isOpen, onClose, packages = [] }) {
  const [packageId, setPackageId]       = useState('');
  const [artifactId, setArtifactId]     = useState('');
  const [artifactName, setArtifactName] = useState('');
  const [artifactType, setArtifactType] = useState('IFlow');
  const [file, setFile]                 = useState(null);
  const [loading, setLoading]           = useState(false);
  const [result, setResult]             = useState(null); // { ok, msg }

  const reset = useCallback(() => {
    setPackageId(''); setArtifactId(''); setArtifactName('');
    setArtifactType('IFlow'); setFile(null); setResult(null);
  }, []);

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!packageId || !artifactId || !artifactName || !file) return;

    setLoading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('zipFile', file);
      formData.append('packageId', packageId);
      formData.append('artifactId', artifactId);
      formData.append('artifactName', artifactName);
      formData.append('artifactType', artifactType);

      await apiClient.post('/api/cpi/import-zip', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setResult({ ok: true, msg: 'Imported successfully!' });
      setTimeout(() => { handleClose(); }, 2000);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Import failed';
      setResult({ ok: false, msg });
    } finally {
      setLoading(false);
    }
  };

  const labelCls = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';
  const inputCls =
    'w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/50 z-40"
          />

          {/* Modal */}
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <span className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                    <Upload size={16} />
                  </span>
                  <h2 className="text-lg font-bold text-slate-800">Import ZIP to CPI</h2>
                </div>
                <button
                  onClick={handleClose}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
                {/* Package */}
                <div>
                  <label className={labelCls}>Package <span className="text-red-400">*</span></label>
                  <select
                    value={packageId}
                    onChange={e => setPackageId(e.target.value)}
                    required
                    className={inputCls}
                  >
                    <option value="">— Select package —</option>
                    {packages.map(p => (
                      <option key={p.Id} value={p.Id}>{p.Name}</option>
                    ))}
                  </select>
                </div>

                {/* Artifact ID */}
                <div>
                  <label className={labelCls}>Artifact ID <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    value={artifactId}
                    onChange={e => setArtifactId(e.target.value)}
                    required
                    placeholder="e.g. MyIFlow"
                    className={inputCls}
                  />
                </div>

                {/* Artifact Name */}
                <div>
                  <label className={labelCls}>Artifact Name <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    value={artifactName}
                    onChange={e => setArtifactName(e.target.value)}
                    required
                    placeholder="e.g. My Integration Flow"
                    className={inputCls}
                  />
                </div>

                {/* Artifact Type */}
                <div>
                  <label className={labelCls}>Artifact Type</label>
                  <select
                    value={artifactType}
                    onChange={e => setArtifactType(e.target.value)}
                    className={inputCls}
                  >
                    {ARTIFACT_TYPES.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                {/* ZIP File */}
                <div>
                  <label className={labelCls}>ZIP File <span className="text-red-400">*</span></label>
                  <div className="relative">
                    <input
                      type="file"
                      accept=".zip"
                      required
                      onChange={e => setFile(e.target.files?.[0] || null)}
                      className="block w-full text-sm text-slate-600
                        file:mr-3 file:py-1.5 file:px-4
                        file:rounded-lg file:border-0
                        file:text-xs file:font-semibold
                        file:bg-emerald-50 file:text-emerald-700
                        hover:file:bg-emerald-100
                        cursor-pointer"
                    />
                  </div>
                  {file && (
                    <p className="mt-1 text-xs text-slate-400">
                      {file.name} ({(file.size / 1024).toFixed(1)} KB)
                    </p>
                  )}
                </div>

                {/* Result message */}
                {result && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${
                      result.ok
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-red-50 text-red-700 border border-red-200'
                    }`}
                  >
                    {result.ok
                      ? <CheckCircle size={15} />
                      : <AlertCircle size={15} />
                    }
                    {result.msg}
                  </motion.div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={loading}
                    className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:border-slate-300 rounded-xl disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !packageId || !artifactId || !artifactName || !file}
                    className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {loading && <Loader2 size={14} className="animate-spin" />}
                    {loading ? 'Importing…' : 'Import'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
