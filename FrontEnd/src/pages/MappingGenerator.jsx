import { useState } from 'react';
import { Upload, FileArchive, Loader2, Download, Brain, ArrowRight, CheckCircle2, Hash, Wrench, X } from 'lucide-react';
import { generateMappingZip, API_ORIGIN } from '../api';

const TYPE_META = {
  direct:   { label: 'Direct',   color: 'bg-green-100 text-green-700 border-green-200',  dot: 'bg-green-500',  desc: 'One-to-one field mapping' },
  constant: { label: 'Constant', color: 'bg-blue-100 text-blue-700 border-blue-200',    dot: 'bg-blue-500',   desc: 'Hardcoded constant value' },
  custom:   { label: 'Custom',   color: 'bg-amber-100 text-amber-700 border-amber-200', dot: 'bg-amber-500',  desc: 'Named rule — needs manual implementation' },
};

function TypeBadge({ type }) {
  const m = TYPE_META[type] || TYPE_META.direct;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${m.color}`}>{m.label}</span>
  );
}

export default function MappingGenerator({ addToast }) {
  const [file, setFile]           = useState(null);
  const [mappingName, setMappingName] = useState('');
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState(null);
  const [filter, setFilter]       = useState('all');

  const handleGenerate = async () => {
    if (!file) {
      addToast?.('Please upload a mapping template file first', 'error');
      return;
    }

    try {
      setLoading(true);
      setResult(null);

      const formData = new FormData();
      formData.append('templateFile', file);
      formData.append('mappingName', mappingName || file.name.replace(/\.[^.]+$/, ''));

      const { data } = await generateMappingZip(formData);
      setResult(data);
      addToast?.(`Mapping ZIP generated — ${data.summary?.total || 0} fields processed`, 'success');
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to generate mapping ZIP';
      addToast?.(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const filteredRows = result?.preview?.filter(r =>
    filter === 'all' ? true : r.transformationType === filter
  ) || [];

  return (
    <div className="p-6 space-y-6">

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <Brain size={20} className="text-purple-600" />
          <h2 className="text-xl font-bold text-slate-800">AI Mapping Generator</h2>
        </div>
        <p className="text-sm text-slate-500 mb-6">
          Upload your SAP FD/mapping Excel (with Source Field, Target Field, Transformation Rules columns).
          The tool auto-detects direct mappings, hardcoded constants, and named transformation rules.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-green-50 border border-green-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 size={15} className="text-green-600" />
              <span className="text-sm font-semibold text-green-800">Direct Mapping</span>
            </div>
            <p className="text-xs text-green-600">Fields with "No" transformation — copied one-to-one in the .mmap</p>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Hash size={15} className="text-blue-600" />
              <span className="text-sm font-semibold text-blue-800">Constant Value</span>
            </div>
            <p className="text-xs text-blue-600">Numeric or coded values (e.g. "315") — hardcoded as Constants in .mmap</p>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wrench size={15} className="text-amber-600" />
              <span className="text-sm font-semibold text-amber-800">Custom Rule (TODO)</span>
            </div>
            <p className="text-xs text-amber-600">Named rules (e.g. "TR01") — placeholder in .mmap, implement UDF in CPI</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-2">Mapping Name</label>
            <input
              value={mappingName}
              onChange={(e) => setMappingName(e.target.value)}
              placeholder="e.g. GoodsMovement_S4_to_SFA"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-300"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-2">Upload Mapping Template</label>
            <label className="w-full flex items-center gap-3 border-2 border-dashed border-slate-300 bg-slate-50 rounded-xl py-3 px-4 cursor-pointer hover:border-purple-400 hover:bg-purple-50 transition-colors">
              <Upload size={16} className="text-purple-600 flex-shrink-0" />
              <span className="text-sm text-slate-600 truncate">
                {file ? file.name : 'Choose Excel / CSV mapping template'}
              </span>
              {file && (
                <button onClick={(e) => { e.preventDefault(); setFile(null); setResult(null); }}
                  className="ml-auto text-slate-400 hover:text-slate-600 flex-shrink-0">
                  <X size={14} />
                </button>
              )}
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); }} />
            </label>
          </div>
        </div>

        <button onClick={handleGenerate} disabled={loading || !file}
          className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-6 py-3 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <FileArchive size={15} />}
          {loading ? 'Generating…' : 'Generate Mapping ZIP'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <>
          {/* Summary bar */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex flex-wrap items-center gap-4 justify-between">
              <div className="flex flex-wrap gap-5">
                <div className="text-center">
                  <div className="text-2xl font-bold text-slate-800">{result.summary?.total || 0}</div>
                  <div className="text-xs text-slate-500">Total Fields</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{result.summary?.direct || 0}</div>
                  <div className="text-xs text-slate-500">Direct</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{result.summary?.constants || 0}</div>
                  <div className="text-xs text-slate-500">Constants</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-amber-500">{result.summary?.custom || 0}</div>
                  <div className="text-xs text-slate-500">Custom (TODO)</div>
                </div>
              </div>

              <a href={`${API_ORIGIN}${result.downloadUrl}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors">
                <Download size={14} />
                Download {result.fileName}
              </a>
            </div>
          </div>

          {/* Preview table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800">Mapping Preview</h3>
              <div className="flex gap-2">
                {['all', 'direct', 'constant', 'custom'].map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium capitalize transition-colors ${
                      filter === f
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}>
                    {f === 'all' ? `All (${result.preview?.length || 0})` : f}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Object</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Source Field</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Tech Name</th>
                    <th className="text-center py-2 px-3 text-xs font-semibold text-slate-500 whitespace-nowrap">→</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Target Field</th>
                    <th className="text-center py-2 px-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Mandatory</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Type</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Value / Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, i) => (
                    <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                      row.transformationType === 'custom' ? 'bg-amber-50/30' :
                      row.transformationType === 'constant' ? 'bg-blue-50/30' : ''
                    }`}>
                      <td className="py-2 px-3 text-xs text-slate-500 truncate max-w-[120px]">{row.sourceObject}</td>
                      <td className="py-2 px-3 font-medium text-slate-700 whitespace-nowrap">{row.sourceField}</td>
                      <td className="py-2 px-3 font-mono text-xs text-slate-500">{row.technicalName}</td>
                      <td className="py-2 px-3 text-center text-slate-400"><ArrowRight size={12} /></td>
                      <td className="py-2 px-3 font-medium text-slate-700 whitespace-nowrap">{row.targetField}</td>
                      <td className="py-2 px-3 text-center">
                        {row.mandatory
                          ? <span className="text-xs text-red-600 font-medium">Yes</span>
                          : <span className="text-xs text-slate-400">No</span>}
                      </td>
                      <td className="py-2 px-3"><TypeBadge type={row.transformationType} /></td>
                      <td className="py-2 px-3 text-xs text-slate-500">
                        {row.transformationType === 'constant' && (
                          <code className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-mono">{row.constantValue}</code>
                        )}
                        {row.transformationType === 'custom' && (
                          <code className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-mono">{row.ruleCode}</code>
                        )}
                        {row.transformationType === 'direct' && (
                          <span className="text-green-600">1:1</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredRows.length === 0 && (
                <div className="text-center text-sm text-slate-400 py-8">No fields match this filter.</div>
              )}
            </div>

            {result.summary?.custom > 0 && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
                <strong>{result.summary.custom} field(s) have custom transformation rules</strong> — these are included in the .mmap as switched-off placeholders.
                Open the mapping in SAP CPI Designer and implement the UDF logic for each marked field.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
