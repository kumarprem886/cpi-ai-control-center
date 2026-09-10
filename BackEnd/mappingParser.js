import XLSX from 'xlsx';

function safe(v) {
  return String(v || '').trim();
}

function normalizeYesNo(value) {
  return safe(value).toLowerCase() === 'yes';
}

function xmlSafeName(value) {
  return safe(value)
    .replace(/[^\w.-]/g, '_')
    .replace(/^(\d)/, '_$1');
}

function normalizeHeader(value) {
  return safe(value)
    .toLowerCase()
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const HEADER_ALIASES = {
  object: ['object'],
  sourceFieldName: ['source field name', 'source field', 'source name'],
  entity: ['entity'],
  table: ['table'],
  technicalName: ['technical name', 'technical field', 'technical field name'],
  fieldDescription: ['field description', 'description'],
  targetFieldName: ['target field name', 'target field', 'target name'],
  mandatory: ['mandatory'],
  transformationRules: ['transformation rules', 'transformation rule', 'logic'],
  asIsIdocField: [
    'as-is idoc field (for reference)',
    'as is idoc field (for reference)',
    'as-is idoc field',
    'as is idoc field'
  ],
  comments: ['comments', 'comment']
};

function matchesAnyAlias(normalizedCell, aliases) {
  return aliases.includes(normalizedCell);
}

function findHeaderRowAndSheet(workbook) {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    const rawRows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: false
    });

    for (let i = 0; i < rawRows.length; i++) {
      const normalized = rawRows[i].map(normalizeHeader);

      const hasSource = normalized.some((h) =>
        matchesAnyAlias(h, HEADER_ALIASES.sourceFieldName)
      );
      const hasTarget = normalized.some((h) =>
        matchesAnyAlias(h, HEADER_ALIASES.targetFieldName)
      );

      if (hasSource && hasTarget) {
        return {
          sheetName,
          headerRowIndex: i,
          rawRows
        };
      }
    }
  }

  return null;
}

function buildHeaderIndexMap(headerRow) {
  const map = {};

  headerRow.forEach((cell, idx) => {
    const normalized = normalizeHeader(cell);

    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (matchesAnyAlias(normalized, aliases) && map[key] === undefined) {
        map[key] = idx;
      }
    }
  });

  return map;
}

function getCell(row, indexMap, key) {
  const idx = indexMap[key];
  if (idx === undefined) return '';
  return safe(row[idx]);
}

function classifyTransformation(rule, comments) {
  const r = safe(rule).toLowerCase();
  const c = safe(comments).trim();

  // Explicit "no transformation" markers → direct
  if (!r || r === 'no' || r === 'none' || r === 'direct' || r === 'n/a' || r === '-') {
    // But check comments for constant value or named rule
    if (c) {
      // Pure number → hardcoded constant
      if (/^\d+(\.\d+)?$/.test(c)) return 'constant';
      // Named rule code like TR01, TR_01, RULE1, etc.
      if (/^(TR|RULE|UDF|FUNC|MAP)\d*/i.test(c)) return 'custom';
      // Short code-like value (no spaces, all caps/numbers) → could be constant
      if (/^[A-Z0-9_-]{1,10}$/.test(c) && c !== c.toLowerCase()) return 'constant';
    }
    return 'direct';
  }

  // Transformation rule column itself has a value
  // Pure number → hardcoded constant
  if (/^\d+(\.\d+)?$/.test(r)) return 'constant';
  // Named rule
  if (/^(TR|RULE|UDF|FUNC|MAP)\d*/i.test(r)) return 'custom';

  // Fallback — has some rule text
  return 'custom';
}

export function parseMappingTemplate(filePath, originalFileName = '') {
  const workbook = XLSX.readFile(filePath);

  console.log('[MAPPING] original file name =', originalFileName);
  console.log('[MAPPING] workbook sheets    =', workbook.SheetNames);

  const found = findHeaderRowAndSheet(workbook);

  if (!found) {
    throw new Error(
      'Could not find a valid header row in any sheet. Expected columns like "Source Field Name" and "Target Field Name".'
    );
  }

  const { sheetName, headerRowIndex, rawRows } = found;
  const headerRow = rawRows[headerRowIndex];
  const indexMap = buildHeaderIndexMap(headerRow);

  console.log('[MAPPING] selected sheet    =', sheetName);
  console.log('[MAPPING] header row index  =', headerRowIndex);
  console.log('[MAPPING] header row        =', headerRow);
  console.log('[MAPPING] header index map  =', indexMap);

  const dataRows = rawRows.slice(headerRowIndex + 1);

  const parsed = dataRows.map((row) => {
    const sourceObject = getCell(row, indexMap, 'object');
    const sourceFieldName = getCell(row, indexMap, 'sourceFieldName');
    const sourceEntity = getCell(row, indexMap, 'entity');
    const sourceTable = getCell(row, indexMap, 'table');
    const sourceTechnicalName = getCell(row, indexMap, 'technicalName');
    const sourceDescription = getCell(row, indexMap, 'fieldDescription');

    const targetFieldName = getCell(row, indexMap, 'targetFieldName');
    const mandatory = normalizeYesNo(getCell(row, indexMap, 'mandatory'));
    const transformationRule = getCell(row, indexMap, 'transformationRules');
    const asIsIdocField = getCell(row, indexMap, 'asIsIdocField');
    const comments = getCell(row, indexMap, 'comments');

    const transformationType = classifyTransformation(transformationRule, comments);
    const constantValue = transformationType === 'constant'
      ? (comments.trim() || transformationRule.trim())
      : null;

    return {
      sourceObject,
      sourceFieldName,
      sourceEntity,
      sourceTable,
      sourceTechnicalName,
      sourceDescription,
      targetFieldName,
      mandatory,
      transformationRule,
      transformationType,   // 'direct' | 'constant' | 'custom'
      constantValue,        // populated when type is 'constant'
      asIsIdocField,
      comments,

      // Flat root-based paths for EOD-safe valid mapping generation
      sourcePath: sourceFieldName ? `/root/${xmlSafeName(sourceFieldName)}` : '',
      targetPath: targetFieldName ? `/root/${xmlSafeName(targetFieldName)}` : '',

      sourceElementName: sourceFieldName ? xmlSafeName(sourceFieldName) : '',
      targetElementName: targetFieldName ? xmlSafeName(targetFieldName) : ''
    };
  }).filter((r) => r.sourceFieldName || r.targetFieldName);

  console.log('[MAPPING] parsed row count  =', parsed.length);
  console.log(
    '[MAPPING] parsed fields     =',
    parsed.map((r) => ({
      source: r.sourceFieldName,
      target: r.targetFieldName
    }))
  );

  if (parsed.length === 0) {
    throw new Error(
      'Header row was found, but no data rows were parsed. Please check if the Excel rows under the header contain Source Field Name and Target Field Name values.'
    );
  }

  return parsed;
}