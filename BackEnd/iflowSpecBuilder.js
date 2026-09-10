function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonObject(text) {
  const direct = safeJsonParse(text);
  if (direct) return direct;

  const cleaned = String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;

  return safeJsonParse(match[0]);
}

function sanitizeIflowName(name) {
  return String(name || '')
    .trim()
    .replace(/[^\w.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function defaultIflowNameFromPrompt(prompt) {
  const cleaned = String(prompt || '')
    .trim()
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 50);

  return sanitizeIflowName(cleaned || 'Generated_IFlow');
}

function normalizeStepType(type) {
  const t = String(type || '').trim().toUpperCase();

  const aliases = {
    'CSV2XML': 'CSV_TO_XML',
    'CSV-TO-XML': 'CSV_TO_XML',
    'CSV TO XML': 'CSV_TO_XML',

    'XML2CSV': 'XML_TO_CSV',
    'XML-TO-CSV': 'XML_TO_CSV',
    'XML TO CSV': 'XML_TO_CSV',

    'REQUEST-REPLY': 'REQUEST_REPLY',
    'REQUEST REPLY': 'REQUEST_REPLY',

    'CONTENT MODIFIER': 'CONTENT_MODIFIER',
    'CONTENT-MODIFIER': 'CONTENT_MODIFIER',

    'CONTENT ENRICHER': 'CONTENT_ENRICHER',
    'CONTENT-ENRICHER': 'CONTENT_ENRICHER',

    'MESSAGE MAPPING': 'MESSAGE_MAPPING',
    'MESSAGE-MAPPING': 'MESSAGE_MAPPING',
    'MMAP': 'MESSAGE_MAPPING',
    'MAPPING': 'MESSAGE_MAPPING',

    'SCRIPT': 'GROOVY_SCRIPT',
    'GROOVY': 'GROOVY_SCRIPT',
    'GROOVY SCRIPT': 'GROOVY_SCRIPT',

    'MAIL': 'MAIL_ADAPTER',
    'MAIL ADAPTER': 'MAIL_ADAPTER',
    'MAIL-ADAPTER': 'MAIL_ADAPTER',
    'EMAIL ADAPTER': 'MAIL_ADAPTER',

    'DATASTORE': 'DATA_STORE',
    'DATA STORE': 'DATA_STORE',
    'DATA-STORE': 'DATA_STORE',

    'ROUTING': 'ROUTER',
    'ROUTER STEP': 'ROUTER',

    'FILTER STEP': 'FILTER',

    'SPLIT': 'SPLITTER',
    'GENERAL SPLITTER': 'SPLITTER',
    'ITERATING SPLITTER': 'SPLITTER'
  };

  return aliases[t] || t;
}

function promptMentions(prompt, phrases = []) {
  const q = String(prompt || '').toLowerCase();
  return phrases.some((p) => q.includes(String(p).toLowerCase()));
}

function extractExplicitIflowName(prompt) {
  const text = String(prompt || '');

  const match =
    text.match(/iflow name should be\s+([A-Za-z0-9_.-]+)/i) ||
    text.match(/iflow name is\s+([A-Za-z0-9_.-]+)/i) ||
    text.match(/named\s+([A-Za-z0-9_.-]+)/i) ||
    text.match(/iflow\s+name\s*[:=]\s*([A-Za-z0-9_.-]+)/i);

  return match ? sanitizeIflowName(match[1]) : null;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSpec(rawSpec, prompt) {
  const spec = { ...(rawSpec || {}) };

  const explicitName = extractExplicitIflowName(prompt);

  spec.iflowName = sanitizeIflowName(
    explicitName || spec.iflowName || defaultIflowNameFromPrompt(prompt)
  );

  spec.description = String(
    spec.description || 'Generated SAP CPI iFlow'
  ).trim();

  spec.steps = ensureArray(spec.steps).map((step) => {
    const normalizedType = normalizeStepType(step?.type);

    return {
      ...step,
      type: normalizedType,
      name: String(step?.name || normalizedType.replace(/_/g, ' ')).trim()
    };
  });

  // Keep only explicitly requested capabilities
  spec.steps = spec.steps.filter((step) => {
    switch (step.type) {
      case 'CSV_TO_XML':
        return promptMentions(prompt, [
          'csv to xml',
          'csv2xml',
          'convert csv to xml'
        ]);

      case 'XML_TO_CSV':
        return promptMentions(prompt, [
          'xml to csv',
          'xml2csv',
          'convert xml to csv'
        ]);

      case 'REQUEST_REPLY':
        return promptMentions(prompt, [
          'request reply',
          'request-reply',
          'external call',
          'call receiver',
          'odata call'
        ]);

      case 'CONTENT_MODIFIER':
        return promptMentions(prompt, ['content modifier']);

      case 'CONTENT_ENRICHER':
        return promptMentions(prompt, ['content enricher']);

      case 'MESSAGE_MAPPING':
        return promptMentions(prompt, [
          'mapping',
          'message mapping',
          '.mmap',
          'mmap'
        ]);

      case 'GROOVY_SCRIPT':
        return promptMentions(prompt, [
          'groovy',
          'script',
          'groovy script'
        ]);

      case 'MAIL_ADAPTER':
        return promptMentions(prompt, [
          'mail adapter',
          'email adapter',
          'smtp'
        ]);

      case 'ROUTER':
        return promptMentions(prompt, ['router']);

      case 'FILTER':
        return promptMentions(prompt, ['filter']);

      case 'SPLITTER':
        return promptMentions(prompt, [
          'splitter',
          'general splitter',
          'iterating splitter',
          'split'
        ]);

      case 'DATA_STORE':
        return promptMentions(prompt, [
          'data store',
          'datastore'
        ]);

      default:
        return false;
    }
  });

  // Guarantee structure
  if (!spec.mapping || typeof spec.mapping !== 'object') {
    spec.mapping = {};
  }

  if (!Array.isArray(spec.scripts)) {
    spec.scripts = [];
  }

  if (!Array.isArray(spec.messageFlows)) {
    spec.messageFlows = [];
  }

  // Exception subprocess detection
  const wantsExceptionSubprocess = promptMentions(prompt, [
    'exception process',
    'exception subprocess',
    'exception sub process',
    'error subprocess',
    'error handling',
    'exception handling'
  ]);

  spec.exceptionSubprocess = {
    enabled: true,
    mailAdapter:
      !!spec.exceptionSubprocess?.mailAdapter ||
      promptMentions(prompt, ['mail adapter', 'email adapter', 'smtp'])
  };

  // Mapping object should exist only when explicitly requested
  if (
    !promptMentions(prompt, [
      'mapping',
      'message mapping',
      '.mmap',
      'mmap'
    ])
  ) {
    spec.mapping = {
      mmapFile: '',
      sourceXsd: '',
      targetXsd: ''
    };
  } else {
    spec.mapping = {
      mmapFile: String(spec.mapping.mmapFile || '').trim(),
      sourceXsd: String(spec.mapping.sourceXsd || '').trim(),
      targetXsd: String(spec.mapping.targetXsd || '').trim(),
      mmapContent: spec.mapping.mmapContent || '',
      sourceXsdContent: spec.mapping.sourceXsdContent || '',
      targetXsdContent: spec.mapping.targetXsdContent || ''
    };
  }

  return spec;
}

function buildFallbackSpec(prompt) {
  const explicitName = extractExplicitIflowName(prompt);

  return normalizeSpec(
    {
      iflowName: explicitName || defaultIflowNameFromPrompt(prompt),
      description: String(prompt || 'Generated SAP CPI iFlow'),
      steps: [],
      exceptionSubprocess: {
        enabled: true,
        mailAdapter: false
      },
      mapping: {
        mmapFile: '',
        sourceXsd: '',
        targetXsd: ''
      },
      scripts: [],
      messageFlows: []
    },
    prompt
  );
}

export async function buildSpecFromPrompt(prompt, callGroqChat) {
  const safePrompt = String(prompt || '').trim();

  if (!safePrompt) {
    throw new Error('Prompt is required');
  }

  const systemPrompt = `
You are an SAP CPI iFlow planning assistant.

Your job:
Convert the user's plain English request into STRICT JSON only.

Return ONLY valid JSON.
Do NOT return markdown.
Do NOT add explanation text.

IMPORTANT BEHAVIOR RULES:
1. Add a step ONLY if the user explicitly asks for that step.
2. Do NOT assume JSON to XML, XML to CSV, CSV to XML, Request Reply, Content Modifier, Content Enricher, Message Mapping, Groovy Script, Mail Adapter, Router, Filter, Splitter, Data Store, or Exception Subprocess unless the user explicitly mentions them.
3. If the user only asks for a generic production-ready SAP CPI iFlow ZIP, then return a MINIMAL base flow with:
   - no transformation steps
   - no request reply
   - no implicit mapping
   - no mail adapter
   - always include exception subprocess (exceptionSubprocess.enabled = true)
4. Do NOT invent business systems like S4, Salesforce, ORDERS05, OData, HTTP, HTTPS unless the user explicitly mentions them.
5. Keep output minimal and strict.
6. Always set exceptionSubprocess.enabled = true. This is mandatory for every generated iFlow.

JSON structure:
{
  "iflowName": "My_IFlow_Name",
  "description": "short technical description",
  "steps": [
    {
      "type": "CSV_TO_XML | XML_TO_CSV | REQUEST_REPLY | CONTENT_MODIFIER | CONTENT_ENRICHER | MESSAGE_MAPPING | GROOVY_SCRIPT | MAIL_ADAPTER | ROUTER | FILTER | SPLITTER | DATA_STORE",
      "name": "Human readable step name"
    }
  ],
  "exceptionSubprocess": {
    "enabled": true,
    "mailAdapter": false
  },
  "mapping": {
    "mmapFile": "",
    "sourceXsd": "",
    "targetXsd": ""
  },
  "scripts": [],
  "messageFlows": []
}

Rules:
1. Use only the supported step types listed above.
2. Generate a valid iflowName using underscores instead of spaces.
3. For generic prompts, steps should be an empty array.
`;

  const userPrompt = `
User request:
${safePrompt}
`;

  try {
    const raw = await callGroqChat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      0.1
    );

    const parsed = extractJsonObject(raw);

    if (!parsed) {
      return buildFallbackSpec(safePrompt);
    }

    return normalizeSpec(parsed, safePrompt);
  } catch (err) {
    console.warn('[IFLOW_SPEC] Falling back to minimal spec:', err.message);
    return buildFallbackSpec(safePrompt);
  }
}