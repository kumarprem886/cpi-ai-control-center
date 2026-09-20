import { useState } from 'react';
import { Upload, FileArchive, Loader2, Download, Brain, ArrowRight, X, Sparkles, Cpu, Table2 } from 'lucide-react';
import { generateMappingZip, previewMappingSheet, API_ORIGIN } from '../api';

// ── CPI node function badge metadata ──────────────────────────────────────
const FUNC_META = {
  direct:            { label: 'Direct',           color: 'bg-green-100 text-green-700 border-green-200',    group: 'direct'  },
  constant:          { label: 'Constant',          color: 'bg-blue-100 text-blue-700 border-blue-200',      group: 'value'   },
  concat:            { label: 'Concat',            color: 'bg-violet-100 text-violet-700 border-violet-200', group: 'string' },
  substring:         { label: 'Substring',         color: 'bg-violet-100 text-violet-700 border-violet-200', group: 'string' },
  trim:              { label: 'Trim',              color: 'bg-violet-100 text-violet-700 border-violet-200', group: 'string' },
  upperCase:         { label: 'UpperCase',         color: 'bg-violet-100 text-violet-700 border-violet-200', group: 'string' },
  lowerCase:         { label: 'LowerCase',         color: 'bg-violet-100 text-violet-700 border-violet-200', group: 'string' },
  replaceString:     { label: 'Replace',           color: 'bg-violet-100 text-violet-700 border-violet-200', group: 'string' },
  length:            { label: 'Length',            color: 'bg-violet-100 text-violet-700 border-violet-200', group: 'string' },
  indexOf:           { label: 'IndexOf',           color: 'bg-violet-100 text-violet-700 border-violet-200', group: 'string' },
  lastIndexOf:       { label: 'LastIndexOf',       color: 'bg-violet-100 text-violet-700 border-violet-200', group: 'string' },
  contains:          { label: 'Contains',          color: 'bg-violet-100 text-violet-700 border-violet-200', group: 'string' },
  startsWith:        { label: 'StartsWith',        color: 'bg-violet-100 text-violet-700 border-violet-200', group: 'string' },
  endsWith:          { label: 'EndsWith',          color: 'bg-violet-100 text-violet-700 border-violet-200', group: 'string' },
  reverseString:     { label: 'Reverse',           color: 'bg-violet-100 text-violet-700 border-violet-200', group: 'string' },
  numberToString:    { label: 'NumToString',       color: 'bg-violet-100 text-violet-700 border-violet-200', group: 'string' },
  formatByExample:   { label: 'FormatByExample',   color: 'bg-violet-100 text-violet-700 border-violet-200', group: 'string' },
  splitByRegExp:     { label: 'SplitByRegExp',     color: 'bg-violet-100 text-violet-700 border-violet-200', group: 'string' },
  exists:            { label: 'Exists',            color: 'bg-yellow-100 text-yellow-700 border-yellow-200', group: 'bool'  },
  notExists:         { label: 'NotExists',         color: 'bg-yellow-100 text-yellow-700 border-yellow-200', group: 'bool'  },
  and:               { label: 'AND',               color: 'bg-yellow-100 text-yellow-700 border-yellow-200', group: 'bool'  },
  or:                { label: 'OR',                color: 'bg-yellow-100 text-yellow-700 border-yellow-200', group: 'bool'  },
  not:               { label: 'NOT',               color: 'bg-yellow-100 text-yellow-700 border-yellow-200', group: 'bool'  },
  stringEquals:      { label: 'StringEquals',      color: 'bg-yellow-100 text-yellow-700 border-yellow-200', group: 'bool'  },
  equalsA:           { label: 'Equals',            color: 'bg-yellow-100 text-yellow-700 border-yellow-200', group: 'bool'  },
  notEqualS:         { label: 'NotEqual',          color: 'bg-yellow-100 text-yellow-700 border-yellow-200', group: 'bool'  },
  greaterThan:       { label: 'GreaterThan',       color: 'bg-yellow-100 text-yellow-700 border-yellow-200', group: 'bool'  },
  lessThan:          { label: 'LessThan',          color: 'bg-yellow-100 text-yellow-700 border-yellow-200', group: 'bool'  },
  greaterThanOrEqual:{ label: 'GreaterOrEqual',    color: 'bg-yellow-100 text-yellow-700 border-yellow-200', group: 'bool'  },
  lessThanOrEqual:   { label: 'LessOrEqual',       color: 'bg-yellow-100 text-yellow-700 border-yellow-200', group: 'bool'  },
  add:               { label: 'Add',               color: 'bg-cyan-100 text-cyan-700 border-cyan-200',       group: 'math'  },
  subtract:          { label: 'Subtract',          color: 'bg-cyan-100 text-cyan-700 border-cyan-200',       group: 'math'  },
  multiply:          { label: 'Multiply',          color: 'bg-cyan-100 text-cyan-700 border-cyan-200',       group: 'math'  },
  divide:            { label: 'Divide',            color: 'bg-cyan-100 text-cyan-700 border-cyan-200',       group: 'math'  },
  modulo:            { label: 'Modulo',            color: 'bg-cyan-100 text-cyan-700 border-cyan-200',       group: 'math'  },
  round:             { label: 'Round',             color: 'bg-cyan-100 text-cyan-700 border-cyan-200',       group: 'math'  },
  floor:             { label: 'Floor',             color: 'bg-cyan-100 text-cyan-700 border-cyan-200',       group: 'math'  },
  ceiling:           { label: 'Ceiling',           color: 'bg-cyan-100 text-cyan-700 border-cyan-200',       group: 'math'  },
  abs:               { label: 'Abs',               color: 'bg-cyan-100 text-cyan-700 border-cyan-200',       group: 'math'  },
  max:               { label: 'Max',               color: 'bg-cyan-100 text-cyan-700 border-cyan-200',       group: 'math'  },
  min:               { label: 'Min',               color: 'bg-cyan-100 text-cyan-700 border-cyan-200',       group: 'math'  },
  average:           { label: 'Average',           color: 'bg-cyan-100 text-cyan-700 border-cyan-200',       group: 'math'  },
  formatNumber:      { label: 'FormatNumber',      color: 'bg-cyan-100 text-cyan-700 border-cyan-200',       group: 'math'  },
  currentDate:       { label: 'CurrentDate',       color: 'bg-orange-100 text-orange-700 border-orange-200', group: 'date'  },
  currentTime:       { label: 'CurrentTime',       color: 'bg-orange-100 text-orange-700 border-orange-200', group: 'date'  },
  currentDateTime:   { label: 'CurrentDateTime',   color: 'bg-orange-100 text-orange-700 border-orange-200', group: 'date'  },
  dateFormat:        { label: 'DateFormat',        color: 'bg-orange-100 text-orange-700 border-orange-200', group: 'date'  },
  addDays:           { label: 'AddDays',           color: 'bg-orange-100 text-orange-700 border-orange-200', group: 'date'  },
  addMonths:         { label: 'AddMonths',         color: 'bg-orange-100 text-orange-700 border-orange-200', group: 'date'  },
  addYears:          { label: 'AddYears',          color: 'bg-orange-100 text-orange-700 border-orange-200', group: 'date'  },
  getYear:           { label: 'GetYear',           color: 'bg-orange-100 text-orange-700 border-orange-200', group: 'date'  },
  getMonth:          { label: 'GetMonth',          color: 'bg-orange-100 text-orange-700 border-orange-200', group: 'date'  },
  getDay:            { label: 'GetDay',            color: 'bg-orange-100 text-orange-700 border-orange-200', group: 'date'  },
  getHour:           { label: 'GetHour',           color: 'bg-orange-100 text-orange-700 border-orange-200', group: 'date'  },
  getMinute:         { label: 'GetMinute',         color: 'bg-orange-100 text-orange-700 border-orange-200', group: 'date'  },
  getSecond:         { label: 'GetSecond',         color: 'bg-orange-100 text-orange-700 border-orange-200', group: 'date'  },
  ifWithElse:        { label: 'IF (with else)',    color: 'bg-pink-100 text-pink-700 border-pink-200',       group: 'cond'  },
  ifWithoutElse:     { label: 'IF (no else)',      color: 'bg-pink-100 text-pink-700 border-pink-200',       group: 'cond'  },
  useOneAsMany:      { label: 'UseOneAsMany',      color: 'bg-teal-100 text-teal-700 border-teal-200',       group: 'ctx'   },
  splitByValue:      { label: 'SplitByValue',      color: 'bg-teal-100 text-teal-700 border-teal-200',       group: 'ctx'   },
  collapseContexts:  { label: 'CollapseContexts',  color: 'bg-teal-100 text-teal-700 border-teal-200',       group: 'ctx'   },
  removeContexts:    { label: 'RemoveContexts',    color: 'bg-teal-100 text-teal-700 border-teal-200',       group: 'ctx'   },
  createContext:     { label: 'CreateContext',     color: 'bg-teal-100 text-teal-700 border-teal-200',       group: 'ctx'   },
  mapWithDefault:    { label: 'MapWithDefault',    color: 'bg-teal-100 text-teal-700 border-teal-200',       group: 'ctx'   },
  countInContext:    { label: 'CountInContext',    color: 'bg-teal-100 text-teal-700 border-teal-200',       group: 'ctx'   },
  index:             { label: 'Index',             color: 'bg-teal-100 text-teal-700 border-teal-200',       group: 'ctx'   },
  firstInContext:    { label: 'FirstInContext',    color: 'bg-teal-100 text-teal-700 border-teal-200',       group: 'ctx'   },
  lastInContext:     { label: 'LastInContext',     color: 'bg-teal-100 text-teal-700 border-teal-200',       group: 'ctx'   },
  sort:              { label: 'Sort',              color: 'bg-teal-100 text-teal-700 border-teal-200',       group: 'ctx'   },
  fixedValues:       { label: 'FixedValues',       color: 'bg-indigo-100 text-indigo-700 border-indigo-200', group: 'value' },
  valueMapping:      { label: 'ValueMapping',      color: 'bg-indigo-100 text-indigo-700 border-indigo-200', group: 'value' },
  getProperty:       { label: 'GetProperty',       color: 'bg-indigo-100 text-indigo-700 border-indigo-200', group: 'value' },
  getVariable:       { label: 'GetVariable',       color: 'bg-indigo-100 text-indigo-700 border-indigo-200', group: 'value' },
};

function FuncBadge({ type }) {
  const m = FUNC_META[type] || { label: type || 'Direct', color: 'bg-slate-100 text-slate-600 border-slate-200' };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${m.color}`}>{m.label}</span>;
}

// Classification badge for raw sheet preview
const CLASS_COLORS = {
  direct:   'bg-green-100 text-green-700 border-green-200',
  constant: 'bg-blue-100 text-blue-700 border-blue-200',
  custom:   'bg-amber-100 text-amber-700 border-amber-200',
};

function ClassBadge({ type }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border capitalize ${CLASS_COLORS[type] || CLASS_COLORS.direct}`}>
      {type}
    </span>
  );
}

const RESULT_FILTERS = [
  { key: 'all',    label: 'All' },
  { key: 'string', label: 'String' },
  { key: 'bool',   label: 'Boolean' },
  { key: 'math',   label: 'Math' },
  { key: 'date',   label: 'Date' },
  { key: 'cond',   label: 'Conditional' },
  { key: 'ctx',    label: 'Context' },
  { key: 'value',  label: 'Value Mapping' },
  { key: 'direct', label: 'Direct' },
];

export default function MappingGenerator({ addToast }) {
  const [file, setFile]               = useState(null);
  const [mappingName, setMappingName] = useState('');
  const [previewing, setPreviewing]   = useState(false);
  const [sheetRows, setSheetRows]     = useState(null);   // raw Excel preview
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState(null);
  const [filter, setFilter]           = useState('all');

  // Auto-preview as soon as file is selected
  const handleFileChange = async (f) => {
    setFile(f);
    setResult(null);
    setSheetRows(null);
    if (!f) return;
    try {
      setPreviewing(true);
      const fd = new FormData();
      fd.append('templateFile', f);
      const { data } = await previewMappingSheet(fd);
      setSheetRows(data.rows || []);
    } catch (err) {
      addToast?.(err.response?.data?.error || 'Could not read sheet — check column headers', 'error');
      setSheetRows(null);
    } finally {
      setPreviewing(false);
    }
  };

  const handleGenerate = async () => {
    if (!file) { addToast?.('Please upload a mapping template file first', 'error'); return; }
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
      addToast?.(err.response?.data?.error || err.message || 'Failed to generate mapping ZIP', 'error');
    } finally {
      setLoading(false);
    }
  };

  const resultRows = result?.preview || [];
  const filteredResultRows = resultRows.filter(r => {
    if (filter === 'all') return true;
    if (filter === 'direct') return !r.aiFunction || r.aiFunction === 'direct';
    return FUNC_META[r.aiFunction]?.group === filter;
  });

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <Brain size={20} className="text-purple-600" />
          <h2 className="text-xl font-bold text-slate-800">AI Mapping Generator</h2>
          <span className="ml-1 text-xs bg-purple-100 text-purple-700 border border-purple-200 rounded-full px-2 py-0.5 font-medium">AI-Powered</span>
        </div>
        <p className="text-sm text-slate-500 mb-5">
          Upload your FD/mapping Excel. The sheet is previewed instantly. Then click Generate — AI picks the right CPI node function per row and outputs a ready-to-import <code className="bg-slate-100 px-1 rounded">.mmap</code>.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-2">Mapping Name</label>
            <input value={mappingName} onChange={e => setMappingName(e.target.value)}
              placeholder="e.g. GoodsMovement_S4_to_SFA"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-300" />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-2">Upload Mapping Template</label>
            <label className="w-full flex items-center gap-3 border-2 border-dashed border-slate-300 bg-slate-50 rounded-xl py-3 px-4 cursor-pointer hover:border-purple-400 hover:bg-purple-50 transition-colors">
              <Upload size={16} className="text-purple-600 flex-shrink-0" />
              <span className="text-sm text-slate-600 truncate">{file ? file.name : 'Choose Excel / CSV mapping template'}</span>
              {file && (
                <button onClick={e => { e.preventDefault(); setFile(null); setSheetRows(null); setResult(null); }}
                  className="ml-auto text-slate-400 hover:text-slate-600 flex-shrink-0"><X size={14} /></button>
              )}
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => handleFileChange(e.target.files?.[0] || null)} />
            </label>
          </div>
        </div>

        <button onClick={handleGenerate} disabled={loading || !file || previewing}
          className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-6 py-3 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {loading ? 'AI is analysing rows…' : 'Generate Mapping ZIP'}
        </button>
      </div>

      {/* Sheet Preview — shown immediately after file upload */}
      {(previewing || sheetRows) && !result && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <Table2 size={16} className="text-slate-500" />
            <h3 className="font-bold text-slate-800">Sheet Preview</h3>
            {sheetRows && (
              <span className="text-xs bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">{sheetRows.length} rows</span>
            )}
            {previewing && <Loader2 size={14} className="animate-spin text-purple-400 ml-1" />}
          </div>

          {sheetRows && sheetRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500">#</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500">Source Field</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500">Technical Name</th>
                    <th className="text-center py-2 px-3 text-xs font-semibold text-slate-500">→</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500">Target Field</th>
                    <th className="text-center py-2 px-3 text-xs font-semibold text-slate-500">Mandatory</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500">Transformation Rule</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500">Classification</th>
                  </tr>
                </thead>
                <tbody>
                  {sheetRows.map((row, i) => (
                    <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                      row.classification === 'constant' ? 'bg-blue-50/20' :
                      row.classification === 'custom'   ? 'bg-amber-50/20' : ''
                    }`}>
                      <td className="py-2 px-3 text-xs text-slate-400">{i + 1}</td>
                      <td className="py-2 px-3 font-medium text-slate-700 whitespace-nowrap">{row.sourceFieldName || '—'}</td>
                      <td className="py-2 px-3 font-mono text-xs text-slate-400">{row.technicalName || '—'}</td>
                      <td className="py-2 px-3 text-center text-slate-400"><ArrowRight size={12} /></td>
                      <td className="py-2 px-3 font-medium text-slate-700 whitespace-nowrap">{row.targetFieldName || '—'}</td>
                      <td className="py-2 px-3 text-center">
                        {row.mandatory
                          ? <span className="text-xs text-red-600 font-medium">Yes</span>
                          : <span className="text-xs text-slate-400">No</span>}
                      </td>
                      <td className="py-2 px-3 text-xs text-slate-500 max-w-[200px] truncate">
                        {row.constantValue
                          ? <code className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-mono">{row.constantValue}</code>
                          : row.transformationRule
                            ? <span>{row.transformationRule}</span>
                            : <span className="text-slate-300">—</span>
                        }
                      </td>
                      <td className="py-2 px-3"><ClassBadge type={row.classification} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Result — shown after AI generation */}
      {result && (
        <>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex flex-wrap items-center gap-6 justify-between">
              <div className="flex flex-wrap gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-slate-800">{resultRows.length}</div>
                  <div className="text-xs text-slate-500">Total</div>
                </div>
                {Object.entries(result.summary?.breakdown || {}).map(([t, count]) => (
                  <div key={t} className="text-center">
                    <div className="text-2xl font-bold text-slate-700">{count}</div>
                    <div className="text-xs text-slate-500 capitalize">{FUNC_META[t]?.label || t}</div>
                  </div>
                ))}
              </div>
              <a href={`${API_ORIGIN}${result.downloadUrl}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors">
                <Download size={14} />
                Download {result.fileName}
              </a>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Cpu size={16} className="text-indigo-500" />
                <h3 className="font-bold text-slate-800">AI Node Function Decisions</h3>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {RESULT_FILTERS.map(f => (
                  <button key={f.key} onClick={() => setFilter(f.key)}
                    className={`text-xs px-3 py-1 rounded-full font-medium capitalize transition-colors ${
                      filter === f.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}>
                    {f.key === 'all' ? `All (${resultRows.length})` : f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500">Source Field</th>
                    <th className="text-center py-2 px-3 text-xs font-semibold text-slate-500">→</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500">Target Field</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500">CPI Node Function</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500">Value / Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResultRows.map((row, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="py-2 px-3 font-medium text-slate-700 whitespace-nowrap">{row.sourceField || row.sourceFieldName || '—'}</td>
                      <td className="py-2 px-3 text-center text-slate-400"><ArrowRight size={12} /></td>
                      <td className="py-2 px-3 font-medium text-slate-700 whitespace-nowrap">{row.targetField || row.targetFieldName || '—'}</td>
                      <td className="py-2 px-3"><FuncBadge type={row.aiFunction || row.transformationType || 'direct'} /></td>
                      <td className="py-2 px-3 text-xs text-slate-500 max-w-[220px] truncate">
                        {row.constantValue
                          ? <code className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-mono">{row.constantValue}</code>
                          : row.transformationRule
                            ? <span className="text-slate-400 italic">{row.transformationRule}</span>
                            : <span className="text-green-600">1:1</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredResultRows.length === 0 && (
                <div className="text-center text-sm text-slate-400 py-8">No fields match this filter.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
