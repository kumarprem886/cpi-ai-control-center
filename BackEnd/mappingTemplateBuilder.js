import fs from 'fs';
import path from 'path';
import fse from 'fs-extra';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { ZipArchive } = require('archiver');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = path.join(__dirname, 'generated');
const MAPPING_TEMPLATE_DIR = path.join(__dirname, 'mapping-template', 'base', 'mapping');

// ======================================================
// AI Prompt — complete SAP CPI standard function library
// ======================================================

const AI_FUNCTION_GUIDE = `You are an SAP CPI Message Mapping expert. Given mapping rows from a functional design document, decide the best CPI standard node function for each row.

Below are the ONLY node functions you may choose. Use the exact "type" value shown.
If a rule needs a function that is not on this list, return "custom" and describe it
in "note" — do NOT invent a type name.

STRING
"direct"          1:1 source to target, no transformation.
"constant"        Hardcoded fixed value, no source field. Needs: value
"concat"          Join two fields. Needs: sourcePaths (2), separator
"substring"       Extract part of a string. Needs: startIndex, length
"trim"            Remove leading/trailing whitespace.
"upperCase"       Convert to uppercase.
"lowerCase"       Convert to lowercase.
"replaceString"   Replace occurrences. Needs: sourcePaths (3: value, search, replacement)
"formatByExample" Reformat to match an example pattern. Needs: sourcePaths (2)
"length"          Output the string length.

BOOLEAN
"exists"          True if the source node exists and is non-empty.
"not"             Negate a boolean.
"and" / "or"      Combine two booleans. Needs: sourcePath2
"stringEquals"    True if source equals a value. Needs: operands (the compare value)
"equalsA"         True if two source fields are equal. Needs: sourcePath2
"greaterThan"     True if source > value. Needs: operands
"isNil"           True if the node is xsi:nil.

MATH
"add"             Add two values. Needs: sourcePath2
"subtract"        Subtract second from first. Needs: sourcePath2
"divide"          Divide first by second. Needs: sourcePath2
"abs"             Absolute value.
"round"           Round to the nearest integer.
"formatNumber"    Format with a decimal pattern. Needs: format (e.g. "0.00"), separator

DATE
"currentDate"     Insert the current date. Needs: format
"dateFormat"      Convert between date formats. Needs: fromFormat, toFormat
                  Use Java SimpleDateFormat patterns: yyyy=year, MM=month, dd=day,
                  HH=hour, mm=MINUTES, ss=seconds. Never use mm for month.
"dateBefore"      True if first date is before second. Needs: sourcePath2
"dateAfter"       True if first date is after second. Needs: sourcePath2

CONDITIONAL
"ifWithElse"      If/then/else. Needs: conditionSource, sourcePaths (3)
"ifWithoutElse"   Populate target only if the condition holds, else omit the node.
                  Needs: conditionSource
"createIf"        Create the target node only if the source is present.

CONTEXT / NODE
"useOneAsMany"    Replicate one value across another context. Needs: sourcePaths (3)
"splitByValue"    Start a new context per value.
"collapseContexts" Collapse multiple occurrences into one.
"removeContexts"  Flatten context boundaries.
"countInContext"  Count occurrences in the context.
"copyValue"       Copy a single occurrence by index.
"sort"            Sort values. Needs: descending (true/false)
"sortByKey"       Sort by a key field. Needs: sourcePath2, descending

CONVERSION / LOOKUP
"fixedValues"     Translate values via an inline key-value table. Needs: table
"mapWithDefault"  Pass through, substituting a default when empty. Needs: defaultValue
"valueMapping"    Look up via an external Value Mapping artifact.
                  Needs: sourceAgency, sourceSchema, targetAgency, targetSchema
"getProperty"     Read a named exchange property. Needs: operands (the property name)

DECISION RULES (apply in order, first match wins)
1.  "lookup"/"substitution"/"map X to Y"/"translate"/"code conversion"/key=value list -> "fixedValues"
2.  "concatenate"/"combine"/"join"/"merge" 2+ fields -> "concat"
3.  "uppercase"/"capitalise" -> "upperCase"
4.  "lowercase" -> "lowerCase"
5.  "trim"/"strip" whitespace -> "trim"
6.  "replace"/"substitute string" -> "replaceString"
7.  "substring"/"first N chars"/"extract characters"/"left("/"right(" -> "substring"
8.  A date FORMAT conversion between two different patterns -> "dateFormat"
9.  "current date"/"today"/"system date" -> "currentDate"
10. "if ... then ... else" with both outcomes -> "ifWithElse"
11. "only if"/"if not empty"/"when present"/"suppress if missing" -> "ifWithoutElse"
12. "count" occurrences -> "countInContext"
13. "property"/"exchange property" -> "getProperty"
14. "replicate one value across N rows"/"use one as many" -> "useOneAsMany"
15. "collapse"/"merge all into one" -> "collapseContexts"
16. "split by" -> "splitByValue"
17. "sort" -> "sort"
18. "greater than"/">" -> "greaterThan"
19. "+"/"add"/"sum" -> "add"; "-" -> "subtract"; "/" -> "divide"
20. "round" -> "round"; "format number"/"decimal format" -> "formatNumber"
21. Default a missing value -> "mapWithDefault"
22. Explicit constant/fixed value, no source field -> "constant"
23. Otherwise -> "direct"

IMPORTANT
- If the transformation rule column says "No", "None", "-" or is empty, the type MUST
  be "direct". Never apply a function to such a row.
- A bare date pattern with no source pattern given (e.g. just "mm/dd/yyyy") documents
  the TARGET format. Use "dateFormat" and put that pattern in toFormat.
- Prefer "direct" when a rule is ambiguous. A wrong function is worse than none.

Return ONLY a valid JSON object — no markdown, no code fences:
{
  "decisions": [
    {
      "targetField": "<targetElementName>",
      "type": "<type from list above>",
      "sourcePath": "/root/<sourceElementName>",
      "sourcePaths": ["/root/A", "/root/B"],
      "sourcePath2": "/root/<secondField>",
      "conditionSource": "/root/<field>",
      "operands": ["<literal>"],
      "value": "<constant>",
      "table": {"KEY1": "VAL1"},
      "defaultValue": "<fallback>",
      "separator": "-",
      "startIndex": 0,
      "length": 4,
      "format": "0.00",
      "fromFormat": "yyyy-MM-dd",
      "toFormat": "yyyyMMdd",
      "descending": false,
      "sourceAgency": "", "sourceSchema": "", "targetAgency": "", "targetSchema": ""
    }
  ]
}

Field notes:
- "sourcePath" is the primary source field. "sourcePath2" is a second source field
  for two-input functions. "sourcePaths" lists them all when there are 3+.
- "operands" holds LITERAL values (not field paths) for functions that compare
  against or receive a fixed value: stringEquals, greaterThan, getProperty.
  Example: stringEquals against "TR01" -> "operands": ["TR01"].
- Use "value" only for type "constant".
Include only fields relevant to the chosen type. Every row must have exactly one entry.`;

export async function buildMappingWithAI(rows, callGroqChat) {
  // Only send rows that actually need AI decision — direct and constant are already known
  const rowSummary = rows.map((r, i) => ({
    index: i,
    sourceField: r.sourceElementName || r.sourceFieldName || '',
    targetField: r.targetElementName || r.targetFieldName || '',
    transformationRule: r.transformationRule || '',
    comments: r.comments || '',
    constantValue: r.constantValue || '',
    initialClassification: r.transformationType || 'direct',
  }));

  // Rows where the FD explicitly says "No"/direct or is a constant — AI must NOT override these
  const lockedDirect   = new Set(rows.map((r,i) => r.transformationType === 'direct'   ? i : -1).filter(i=>i>=0));
  const lockedConstant = new Set(rows.map((r,i) => r.transformationType === 'constant' ? i : -1).filter(i=>i>=0));

  const userPrompt = `Mapping rows from FD Excel. Decide the best CPI node function for each.

STRICT RULES:
1. If initialClassification="direct" → type MUST be "direct". Do NOT change it regardless of field name.
2. If initialClassification="constant" → type MUST be "constant". Do NOT change it.
3. Only rows with initialClassification="custom" need your decision.
4. For dateFormat rows: extract fromFormat from the source field name/context (default "yyyy-MM-dd" if unknown), and toFormat from the transformationRule text (e.g. "mm/dd/yyyy" → toFormat="MM/dd/yyyy"). If only one format is mentioned in the rule, use it as toFormat.
5. For upperCase/lowerCase: use type="upperCase" or "lowerCase" only.
6. Return one entry per row in the same index order as input.

${JSON.stringify(rowSummary, null, 2)}

Return decisions JSON — one entry per row in the same order.`;

  try {
    console.log('[MAPPING AI] Sending', rows.length, 'rows to AI...');
    const raw = await callGroqChat(
      [{ role: 'system', content: AI_FUNCTION_GUIDE }, { role: 'user', content: userPrompt }],
      0.1
    );
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const clean = text.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean);
    const decisions = Array.isArray(parsed) ? parsed : (parsed.decisions || []);
    if (!Array.isArray(decisions) || decisions.length === 0) throw new Error('empty decisions');
    // Hard-enforce: AI cannot override direct or constant rows
    decisions.forEach((d, i) => {
      if (lockedDirect.has(i)) {
        d.type = 'direct';
      } else if (lockedConstant.has(i)) {
        d.type = 'constant';
        d.value = rows[i].constantValue || d.value || '';
      }
    });
    console.log('[MAPPING AI] Got', decisions.length, 'decisions');
    return decisions;
  } catch (err) {
    console.warn('[MAPPING AI] Fallback to parser classification:', err.message);
    return rows.map(r => ({
      targetField: r.targetElementName || r.targetFieldName || '',
      type: r.transformationType || 'direct',
      sourcePath: r.sourcePath || (r.sourceElementName ? `/root/${r.sourceElementName}` : null),
      value: r.constantValue || '',
    }));
  }
}

// ======================================================
// ZIP builder
// ======================================================

function resolveTemplateMmapFile() {
  if (!fs.existsSync(MAPPING_TEMPLATE_DIR))
    throw new Error(`Mapping template folder not found: ${MAPPING_TEMPLATE_DIR}`);
  const files = fs.readdirSync(MAPPING_TEMPLATE_DIR).filter(f => f.toLowerCase().endsWith('.mmap'));
  if (!files.length) throw new Error(`No .mmap template in: ${MAPPING_TEMPLATE_DIR}`);
  return path.join(MAPPING_TEMPLATE_DIR, files[0]);
}

export async function buildMappingZip(mappingName, rows, aiDecisions = null) {
  const safeName = sanitizeName(mappingName || 'Generated_Mapping');
  await fse.ensureDir(GENERATED_DIR);
  const tempDir = path.join(GENERATED_DIR, `tmp_mapping_${Date.now()}`);
  const metaDir    = path.join(tempDir, 'META-INF');
  const mappingDir = path.join(tempDir, 'src', 'main', 'resources', 'mapping');
  const xsdDir     = path.join(tempDir, 'src', 'main', 'resources', 'xsd');
  await fse.ensureDir(metaDir);
  await fse.ensureDir(mappingDir);
  await fse.ensureDir(xsdDir);

  // CPI mandatory manifest for message mapping artifact
  const manifest = [
    'Manifest-Version: 1.0',
    'SAP-RuntimeProfile: iflmap',
    `Bundle-SymbolicName: ${safeName}`,
    `Bundle-Name: ${safeName}`,
    'Bundle-Version: 1.0.0',
    'Bundle-ManifestVersion: 2',
    `Origin-Bundle-SymbolicName: ${safeName}`,
    'SAP-NodeType: MessageMapping',
    `Origin-Bundle-Name: ${safeName}`,
    'SAP-BundleType: MessageMapping',
    '',
  ].join('\r\n');
  fs.writeFileSync(path.join(metaDir, 'MANIFEST.MF'), manifest, 'utf-8');

  // metainfo.prop
  const metainfo = `artifactId=${safeName}\nartifactVersion=1.0.0\nartifactType=MessageMapping\n`;
  fs.writeFileSync(path.join(tempDir, 'metainfo.prop'), metainfo, 'utf-8');

  const templateFile = resolveTemplateMmapFile();
  // Source and target root elements must differ: CPI keys its schema registry by
  // element name, so two no-namespace schemas both rooted at "root" collide and
  // only one of the two message structures resolves.
  const srcXsd = 'Source.xsd', tgtXsd = 'Target.xsd';
  const srcRoot = 'SourceRoot', tgtRoot = 'TargetRoot';

  fs.writeFileSync(path.join(mappingDir, `${safeName}.mmap`),
    buildMmapFromTemplate(templateFile, safeName, rows, srcXsd, tgtXsd, srcRoot, tgtRoot, aiDecisions), 'utf-8');
  fs.writeFileSync(path.join(xsdDir, srcXsd), buildXsd(rows, srcRoot, 'source'), 'utf-8');
  fs.writeFileSync(path.join(xsdDir, tgtXsd), buildXsd(rows, tgtRoot, 'target'), 'utf-8');

  const zipPath = path.join(GENERATED_DIR, `${safeName}.zip`);
  await zipFolder(tempDir, zipPath);
  await fse.remove(tempDir);
  return { fileName: `${safeName}.zip`, zipPath };
}

// ======================================================
// XSD builders
// ======================================================

function sanitizeName(n) { return String(n||'').trim().replace(/[^\w.-]/g,'_'); }

function ncName(value) {
  return String(value || '')
    .replace(/[^\w.-]/g, '_')
    .replace(/^(\d)/, '_$1');
}

function buildXsd(rows, rootName, side) {
  const key = side === 'source' ? 'sourceElementName' : 'targetElementName';
  const fields = [...new Set(rows.filter(r=>r[key]).map(r=>ncName(r[key])))]
    .map(n=>`        <xs:element name="${x(n)}" type="xs:string" minOccurs="0"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="${x(rootName)}"><xs:complexType><xs:sequence>
${fields}
  </xs:sequence></xs:complexType></xs:element>
</xs:schema>`;
}

// ======================================================
// .mmap builder
// ======================================================

function buildMmapFromTemplate(templateFile, mappingName, rows, srcXsd, tgtXsd, srcRoot, tgtRoot, aiDecisions) {
  let xml = fs.readFileSync(templateFile, 'utf-8');
  xml = xml.replace(/(<lnkRole[^>]*role="SOURCE_IFR_MESS"[\s\S]*?<key[^>]*typeID="xsd"[^>]*>[\s\S]*?<elem>)([^<]*)(<\/elem>\s*<elem>)([^<]*)(<\/elem>\s*<elem>)([^<]*)(<\/elem>)/,
    `$1${srcXsd}$3src/main/resources/xsd$5${srcRoot}$7`);
  xml = xml.replace(/(<lnkRole[^>]*role="TARGET_IFR_MESS"[\s\S]*?<key[^>]*typeID="xsd"[^>]*>[\s\S]*?<elem>)([^<]*)(<\/elem>\s*<elem>)([^<]*)(<\/elem>\s*<elem>)([^<]*)(<\/elem>)/,
    `$1${tgtXsd}$3src/main/resources/xsd$5${tgtRoot}$7`);
  xml = xml.replace(/(<text label=")([^"]*)("><\/text>)/, `$1${x(mappingName)}$3`);
  xml = xml.replace(/<transformation>[\s\S]*?<\/transformation>/,
    `<transformation>${buildTransformation(rows, srcRoot, tgtRoot, aiDecisions)}</transformation>`);
  return xml;
}

// ======================================================
// Transformation dispatcher
// ======================================================

// The AI prompt asks for paths under a generic "/root/", so swap in the real
// source root before the path reaches a brick.
function rebase(p, srcRoot) {
  if (!p) return null;
  return String(p).replace(/^\/[^/]+/, `/${srcRoot}`);
}

function buildTransformation(rows, srcRoot, tgtRoot, aiDecisions) {
  const bricks = [bDirect(`/${tgtRoot}`, `/${srcRoot}`, 200, 40, 50, 40)];

  const dm = new Map();
  if (Array.isArray(aiDecisions))
    for (const d of aiDecisions) if (d.targetField) dm.set(String(d.targetField).trim(), d);

  // CPI renders each target field on its own local canvas, so every row's
  // bricks use the same base y rather than a running offset.
  const y = 40;
  for (const row of rows) {
    if (!row.targetPath && !row.targetElementName) continue;

    const dst    = `/${tgtRoot}/${ncName(row.targetElementName || String(row.targetPath).split('/').pop())}`;
    const defSrc = row.sourceElementName ? `/${srcRoot}/${ncName(row.sourceElementName)}` : null;
    const key    = row.targetElementName || dst.split('/').pop();
    const d      = dm.get(key) || dm.get(String(key).trim());
    const type   = d?.type || row.transformationType || 'direct';
    const src    = rebase(d?.sourcePath, srcRoot) || defSrc;

    const dd = d && {
      ...d,
      sourcePath2:     rebase(d.sourcePath2, srcRoot),
      conditionSource: rebase(d.conditionSource, srcRoot),
      sourcePaths:     Array.isArray(d.sourcePaths) ? d.sourcePaths.map(p => rebase(p, srcRoot)) : undefined
    };

    let brick = dispatch(type, dst, src, defSrc, dd, y);
    if (brick) bricks.push(brick);
  }
  return bricks.join('');
}

function bDirect(dst, src, dX, dY, sX, sY) {
  return `<brick gid="0" path="${x(dst)}" type="Dst"><viewData x="${dX}" y="${dY}"/><arg><brick gid="0" path="${x(src)}" type="Src"><viewData x="${sX}" y="${sY}"/></brick></arg><group/></brick>`;
}

function bConst(dst, value, y) {
  return `<brick gid="0" path="${x(dst)}" type="Dst"><viewData x="200" y="${y}"/><arg><brick fname="const" fns="dflt" type="Func"><viewData x="120" y="${y}"/><bindings><param name="value"><value>${x(value)}</value></param></bindings></brick></arg><group/></brick>`;
}

// Single source-field input function
// A literal operand is its own nested const brick in CPI; an inline
// <arg><value> is not valid and the whole function fails to load.
function cArg(val, y) {
  return `<brick fname="const" fns="dflt" type="Func"><viewData x="60" y="${y}"/><bindings><param name="value"><value>${x(val ?? '')}</value></param></bindings></brick>`;
}


// FD authors write date patterns loosely ("mm/dd/yyyy", "YYYYMMDD"), but CPI
// feeds them to Java SimpleDateFormat where mm=minutes and YYYY=week-year.
function normalizeDatePattern(fmt, fallback) {
  const f = String(fmt || '').trim();
  if (!f) return fallback;
  let out = f.replace(/Y/g, 'y').replace(/D/g, 'd');
  if (!/M/.test(out)) out = out.replace(/m+/g, (m) => 'M'.repeat(m.length));
  return out;
}

// ======================================================
// Verified CPI standard-function registry
//
// Every fname, param spelling and arity below was extracted from real
// SAP-authored .mmap files (bricks carrying fns="dflt"). Anything absent from
// that corpus is deliberately NOT here: emitting a brick CPI cannot resolve
// makes the entire mapping fail to load, so unknown types fall back to a
// plain direct mapping instead.
//
// Non-obvious points the corpus settled:
//   - substring/formatNumber take their operands as params, not as pins.
//   - const and currentDate take ZERO args.
//   - subtract is "sub", divide is "div", equalsS is "stringEquals",
//     ValueMapping is "valuemap", splitByValue is "SplitByValue".
//   - concat's separator param is misspelled "delimeter" by SAP.
// ======================================================

const CALEND = '<calend_props><fd>1</fd><md>1</md><le>true</le></calend_props>';

// Marks a param whose value is raw XML rather than escaped text.
const nested = (xml) => ({ __raw: xml });

function sortOrder(d) {
  return `<sort_order asc="${d?.descending ? 'false' : 'true'}"/>`;
}

function propsTable(table) {
  return `<properties>${Object.entries(table || {})
    .map(([k, v]) => `<property name="${x(k)}">${x(v)}</property>`).join('')}</properties>`;
}

const dateParams = (d) => ({
  calend: nested(CALEND),
  iform: normalizeDatePattern(d?.fromFormat, 'yyyy-MM-dd'),
  oform: normalizeDatePattern(d?.toFormat, 'yyyyMMdd')
});

const FN_REGISTRY = {
  trim:            { fname: 'trim',            args: 1 },
  length:          { fname: 'length',          args: 1 },
  upperCase:       { fname: 'toUpperCase',     args: 1 },
  lowerCase:       { fname: 'toLowerCase',     args: 1 },
  concat:          { fname: 'concat',          args: 2, params: (d) => ({ delimeter: d?.separator ?? '' }) },
  substring:       { fname: 'substring',       args: 1, params: (d) => ({ start: String(d?.startIndex ?? 0), count: String(d?.length ?? 255) }) },
  replaceString:   { fname: 'replaceString',   args: 3 },
  formatByExample: { fname: 'formatByExample', args: 2 },

  exists:          { fname: 'exists',          args: 1 },
  not:             { fname: 'not',             args: 1 },
  and:             { fname: 'and',             args: 2 },
  or:              { fname: 'or',              args: 2 },
  stringEquals:    { fname: 'stringEquals',    args: 2 },
  equalsA:         { fname: 'equalsA',         args: 2 },
  greaterThan:     { fname: 'greater',         args: 2 },
  isNil:           { fname: 'isNil',           args: 1 },

  add:             { fname: 'add',             args: 2 },
  subtract:        { fname: 'sub',             args: 2 },
  divide:          { fname: 'div',             args: 2 },
  abs:             { fname: 'abs',             args: 1 },
  round:           { fname: 'round',           args: 1 },
  formatNumber:    { fname: 'formatNumber',    args: 1, params: (d) => ({ nformat: d?.format ?? '0.00', separator: d?.separator ?? '.' }) },

  currentDate:     { fname: 'currentDate',     args: 0, params: (d) => ({ calend: nested(CALEND), oform: normalizeDatePattern(d?.format, 'yyyyMMdd') }) },
  dateFormat:      { fname: 'TransformDate',   args: 1, params: dateParams },
  dateBefore:      { fname: 'DateBefore',      args: 2, params: dateParams },
  dateAfter:       { fname: 'DateAfter',       args: 2, params: dateParams },

  ifWithElse:      { fname: 'iF',              args: 3 },
  ifWithoutElse:   { fname: 'ifWithoutElse',   args: 2, params: () => ({ keepss: 'false' }) },
  createIf:        { fname: 'createIf',        args: 1 },

  useOneAsMany:     { fname: 'useOneAsMany',     args: 3 },
  splitByValue:     { fname: 'SplitByValue',     args: 1, params: () => ({ type: '0' }) },
  collapseContexts: { fname: 'collapseContexts', args: 1 },
  removeContexts:   { fname: 'removeContexts',   args: 1 },
  countInContext:   { fname: 'count',            args: 1 },
  copyValue:        { fname: 'CopyValue',        args: 1, params: () => ({ nnumber: '0' }) },
  sort:             { fname: 'sort',             args: 1, params: (d) => ({ comparator: nested('<sort_comp type="cs"/>'), order: nested(sortOrder(d)) }) },
  sortByKey:        { fname: 'sortByKey',        args: 2, params: (d) => ({ comparator: nested('<sort_comp type="cs"/>'), order: nested(sortOrder(d)) }) },

  fixedValues:     { fname: 'FixValues',      args: 1, params: (d) => ({ table: nested(propsTable(d?.table)), vmdefault: 'false', vmstrategy: '1' }) },
  mapWithDefault:  { fname: 'mapWithDefault', args: 1, params: (d) => ({ default_value: d?.defaultValue ?? '' }) },
  // The property NAME is the argument, supplied as a nested const brick;
  // getProperty never reads a source field.
  getProperty:     { fname: 'getProperty',    args: 1, literalArgs: true },
  valueMapping:    { fname: 'valuemap',       args: 1, params: (d) => ({
                      agency1: d?.sourceAgency ?? '', agency2: d?.targetAgency ?? '',
                      context: '', dstns: '', dsttype: '',
                      schema1: d?.sourceSchema ?? '', schema2: d?.targetSchema ?? '',
                      srcns: '', srctype: '', vmdefault: 'false', vmstrategy: '1'
                    }) }
};

function renderParams(params) {
  const keys = Object.keys(params || {}).sort();
  if (!keys.length) return '';
  const body = keys.map((k) => {
    const v = params[k];
    const val = v && v.__raw !== undefined ? v.__raw : x(v ?? '');
    return `<param name="${x(k)}"><value>${val}</value></param>`;
  }).join('');
  return `<bindings>${body}</bindings>`;
}

// Pad to the function's declared arity with const bricks so the pin count
// always matches what CPI expects for that fname.
function renderArgs(spec, srcPaths, d, y) {
  const literals = Array.isArray(d?.operands) ? d.operands : [];
  const out = [];
  for (let i = 0; i < spec.args; i++) {
    const p = srcPaths[i];
    const inner = p
      ? `<brick gid="0" path="${x(p)}" type="Src"><viewData x="50" y="${y + i * 40}"/></brick>`
      : cArg(literals[i - srcPaths.length] ?? '', y + i * 40);
    out.push(`<arg${i ? ` pin="${i}"` : ''}>${inner}</arg>`);
  }
  return out.join('');
}

function bFunc(dst, spec, srcPaths, d, y) {
  return `<brick gid="0" path="${x(dst)}" type="Dst"><viewData x="200" y="${y}"/><arg><brick fname="${spec.fname}" fns="dflt" type="Func"><viewData x="145" y="${y}"/>${renderArgs(spec, srcPaths, d, y)}${renderParams(spec.params?.(d))}</brick></arg><group/></brick>`;
}

// Types the AI may return that have no fname confirmed by the corpus. A direct
// mapping keeps the artifact loadable; a guessed fname would not.
export const UNVERIFIED_TYPES = new Set([
  'indexOf', 'lastIndexOf', 'contains', 'startsWith', 'endsWith', 'reverseString',
  'numberToString', 'splitByRegExp', 'notExists', 'notEqualS', 'lessThan',
  'greaterThanOrEqual', 'lessThanOrEqual', 'multiply', 'modulo', 'floor',
  'ceiling', 'max', 'min', 'average', 'index', 'firstInContext', 'lastInContext',
  'createContext', 'currentTime', 'currentDateTime', 'addDays', 'addMonths',
  'addYears', 'getYear', 'getMonth', 'getDay', 'getHour', 'getMinute',
  'getSecond', 'getVariable', 'getHeader'
]);

function dispatch(type, dst, src, defSrc, d, y) {
  if (type === 'constant') return bConst(dst, d?.value ?? '', y);

  const spec = FN_REGISTRY[type];
  const fallback = () => (defSrc ? bDirect(dst, defSrc, 200, y, 50, y) : null);
  if (!spec) return fallback();

  const srcPaths = spec.literalArgs ? [] : (Array.isArray(d?.sourcePaths) && d.sourcePaths.length
    ? d.sourcePaths
    : [d?.conditionSource, src, d?.sourcePath2]
  ).filter(Boolean).slice(0, spec.args);

  if (spec.args > 0 && !srcPaths.length && !spec.literalArgs) return fallback();
  return bFunc(dst, spec, srcPaths, d, y);
}


// ======================================================
// ZIP utilities
// ======================================================

async function zipFolder(sourceDir, outputZipPath) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputZipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', reject);
    archive.pipe(output);
    addDir(archive, sourceDir, '');
    archive.finalize();
  });
}

function addDir(archive, dir, prefix) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const zip  = prefix ? `${prefix}/${entry}` : entry;
    if (fs.statSync(full).isDirectory()) addDir(archive, full, zip);
    else archive.append(fs.readFileSync(full), { name: zip });
  }
}

// ======================================================
// XML escape
// ======================================================

function x(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

export function buildGroovyScript(mappingName) {
  return `// Groovy placeholder for ${mappingName} — use the generated .mmap instead.\n`;
}
