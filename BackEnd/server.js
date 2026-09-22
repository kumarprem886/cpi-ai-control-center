import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import NodeCache from 'node-cache';
import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { ZipArchive } from 'archiver';

import FormData from 'form-data';
import { buildIflowFromTemplate } from './iflowTemplateBuilder.js';
import { batchDeploy, batchUndeploy, whereUsed } from './cpiServices.js';
import { buildSpecFromPrompt } from './iflowSpecBuilder.js';
import { parseMappingTemplate } from './mappingParser.js';
import { buildMappingZip, buildGroovyScript, buildMappingWithAI } from './mappingTemplateBuilder.js';

console.log('ZipArchive type =', typeof ZipArchive);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '.env');
const GENERATED_DIR = path.join(__dirname, 'generated');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

if (!fs.existsSync(GENERATED_DIR)) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

const upload = multer({ dest: UPLOAD_DIR });
const app = express();

const PORT = Number(process.env.PORT || 8081);
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 60);
const MPL_TOP = Number(process.env.MPL_TOP || 300);
const CERT_ALERT_DAYS = Number(process.env.CERT_ALERT_DAYS || 30);
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 60);
const AI_PROVIDER = (process.env.AI_PROVIDER || 'groq').toLowerCase();

const BACKEND_API_KEY =
  process.env.BACKEND_API_KEY || crypto.randomBytes(32).toString('hex');
const GENERATED_BACKEND_API_KEY = !process.env.BACKEND_API_KEY;

if (GENERATED_BACKEND_API_KEY) {
  console.warn(
    '[WARN] BACKEND_API_KEY is not set in .env. A temporary key was generated for this process only.'
  );
  console.warn('[WARN] Temporary BACKEND_API_KEY = ' + BACKEND_API_KEY);
}

// ======================================================
// Middleware
// ======================================================

app.use(helmet({ contentSecurityPolicy: false }));

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  : ['*'];

app.use(
  cors({
    origin: allowedOrigins.includes('*')
      ? true
      : (origin, cb) => {
          if (!origin || allowedOrigins.includes(origin)) {
            return cb(null, true);
          }
          return cb(new Error('Not allowed by CORS'));
        },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  })
);

app.use(express.json({ limit: '3mb' }));
app.use(morgan('dev'));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_PER_MIN,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Rate limit exceeded. Please try again shortly.',
  },
});

app.use('/api', limiter);

const cache = new NodeCache({ stdTTL: CACHE_TTL_SECONDS });

// ── OAuth token cache ─────────────────────────────────────────────────────────
let _oauthTokenCache = { token: null, expiresAt: 0 };

async function fetchOAuthToken() {
  const tokenUrl    = process.env.CPI_OAUTH_TOKEN_URL   || '';
  const clientId    = process.env.CPI_OAUTH_CLIENT_ID   || '';
  const clientSecret= process.env.CPI_OAUTH_CLIENT_SECRET || '';

  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error('OAuth is enabled but CPI_OAUTH_TOKEN_URL / CPI_OAUTH_CLIENT_ID / CPI_OAUTH_CLIENT_SECRET are not set.');
  }

  // SAP OAuth endpoints require client credentials as Basic Auth header
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const { data } = await axios.post(tokenUrl, 'grant_type=client_credentials', {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'Authorization': `Basic ${basicAuth}`,
    },
    timeout: 15000,
  });

  const token      = data.access_token;
  const expiresIn  = Number(data.expires_in || 3600);
  const expiresAt  = Date.now() + (expiresIn - 60) * 1000; // refresh 60s early

  _oauthTokenCache = { token, expiresAt };
  console.log('[OAuth] Token fetched, expires in', expiresIn, 's');
  return token;
}

async function getOAuthToken() {
  if (_oauthTokenCache.token && Date.now() < _oauthTokenCache.expiresAt) {
    return _oauthTokenCache.token;
  }
  return fetchOAuthToken();
}

function invalidateOAuthToken() {
  _oauthTokenCache = { token: null, expiresAt: 0 };
}

// ── CPI axios client with dynamic auth ───────────────────────────────────────
const cpiClient = axios.create({
  baseURL: process.env.CPI_BASE_URL || '',
  timeout: 30000,
  headers: { Accept: 'application/json' },
});

cpiClient.interceptors.request.use(async (config) => {
  // Refresh baseURL in case it was updated via Settings UI
  config.baseURL = process.env.CPI_BASE_URL || config.baseURL;

  const mode = (process.env.CPI_AUTH_MODE || 'basic').toLowerCase();

  if (mode === 'oauth') {
    const token = await getOAuthToken();
    config.headers = config.headers || {};
    config.headers['Authorization'] = `Bearer ${token}`;
  } else {
    // Basic auth
    const user = process.env.CPI_USERNAME || '';
    const pass = process.env.CPI_PASSWORD || '';
    config.headers = config.headers || {};
    config.headers['Authorization'] = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  }

  return config;
});

// On 401 in OAuth mode, invalidate token and retry once
cpiClient.interceptors.response.use(
  (res) => res,
  async (err) => {
    const mode = (process.env.CPI_AUTH_MODE || 'basic').toLowerCase();
    if (mode === 'oauth' && err.response?.status === 401 && !err.config?._retried) {
      invalidateOAuthToken();
      err.config._retried = true;
      const token = await getOAuthToken();
      err.config.headers['Authorization'] = `Bearer ${token}`;
      return axios(err.config);
    }
    return Promise.reject(err);
  }
);

// ======================================================
// Optional API-key protection (keep commented for local)
// ======================================================
// function requireApiKey(req, res, next) {
//   if (req.path === '/health' || req.path === '/status' || req.path === '/docs' || req.path === '/tools') {
//     return next();
//   }
//   const headerKey = req.get('x-api-key');
//   const auth = req.get('authorization') || '';
//   const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
//   const provided = headerKey || bearer;
//   if (!provided || provided !== BACKEND_API_KEY) {
//     return res.status(401).json({
//       success: false,
//       error: 'Unauthorized. Provide x-api-key header or Authorization: Bearer <BACKEND_API_KEY>.',
//     });
//   }
//   return next();
// }
// app.use('/api', requireApiKey);

// ======================================================
// Generic helpers
// ======================================================

function parseEnv(content) {
  const obj = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;

    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();

    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }

    obj[key] = val;
  }
  return obj;
}

function serializeEnv(obj) {
  return (
    Object.entries(obj)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n'
  );
}

function isConfigured() {
  const mode = (process.env.CPI_AUTH_MODE || 'basic').toLowerCase();
  if (mode === 'oauth') {
    return !!(
      process.env.CPI_BASE_URL &&
      process.env.CPI_OAUTH_TOKEN_URL &&
      process.env.CPI_OAUTH_CLIENT_ID &&
      process.env.CPI_OAUTH_CLIENT_SECRET
    );
  }
  return !!(
    process.env.CPI_BASE_URL &&
    process.env.CPI_USERNAME &&
    process.env.CPI_PASSWORD
  );
}

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

  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;

  return safeJsonParse(match[0]);
}

function toArray(data) {
  if (Array.isArray(data)) return data;
  return data?.d?.results || data?.value || [];
}

function num(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function parseDateFlexible(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) return v;

  if (typeof v === 'string') {
    const sapEpoch = v.match(/\/Date\((\d+)\)\//);
    if (sapEpoch) {
      const d = new Date(Number(sapEpoch[1]));
      return isNaN(d) ? null : d;
    }

    const d = new Date(v);
    return isNaN(d) ? null : d;
  }

  return null;
}

function daysUntil(date) {
  const ms = date.getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

function pickExpiryDate(entry) {
  const candidates = [
    entry.ValidTo,
    entry.ValidTill,
    entry.NotAfter,
    entry.ExpiresOn,
    entry.ExpiryDate,
    entry.ExpirationDate,
    entry.CertificateValidityEnd,
    entry.CertificateExpiryDate,
  ];

  for (const c of candidates) {
    const d = parseDateFlexible(c);
    if (d) return d;
  }

  return null;
}

function parseDurationMs(item) {
  const directCandidates = [
    item.DurationInMs,
    item.Duration,
    item.ProcessingTimeInMs,
    item.ResponseTime,
    item.TotalProcessingTime,
  ];

  for (const c of directCandidates) {
    const n = num(c);
    if (n !== null) return n;
  }

  const start = parseDateFlexible(
    item.LogStart || item.StartTime || item.CreatedAt || item.StartTimestamp
  );
  const end = parseDateFlexible(
    item.LogEnd || item.EndTime || item.CompletedAt || item.EndTimestamp
  );

  if (start && end) {
    const diff = end.getTime() - start.getTime();
    if (diff >= 0) return diff;
  }

  return null;
}

function summarizeDataAsText(obj) {
  return JSON.stringify(obj, null, 2);
}

function sanitizeEntryPath(p) {
  const cleaned = String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.\.+/g, '')
    .trim();

  return cleaned || null;
}

function looksLikeZipRequest(prompt) {
  const q = String(prompt || '').toLowerCase();
  return (
    q.includes('.zip') ||
    q.includes('zip file') ||
    q.includes('create zip') ||
    q.includes('downloadable zip') ||
    q.includes('ready to use zip') ||
    q.includes('ready-to-use zip') ||
    q.includes('create a zip')
  );
}

function uniqueFileName(prefix = 'iflow', ext = '.zip') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${stamp}${ext}`;
}

function extractSecurityMaterialName(question) {
  const text = String(question || '').trim();

  let cleaned = text
    .replace(/\?/g, '')
    .replace(/in which iflow/gi, '')
    .replace(/which iflow/gi, '')
    .replace(/where is/gi, '')
    .replace(/where/gi, '')
    .replace(/is been used/gi, '')
    .replace(/is used/gi, '')
    .replace(/used in/gi, '')
    .replace(/security material/gi, '')
    .replace(/security materials/gi, '')
    .replace(/credential/gi, '')
    .replace(/credentials/gi, '')
    .replace(/keystore/gi, '')
    .replace(/alias/gi, '')
    .replace(/deployed/gi, '')
    .replace(/referenced/gi, '')
    .replace(/using/gi, '')
    .trim();

  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned || '';
}

async function cachedGet(key, url) {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const response = await cpiClient.get(url);
  cache.set(key, response.data);
  return response.data;
}

// ======================================================
// CPI fetch helpers
// ======================================================

// CPI error payloads vary between shapes: {error:{message:{value}}},
// {error:{message}}, or a bare {message}. Check all of them rather than
// picking one and silently failing to recognise the rest.
function cpiErrorMessage(err) {
  const d = err?.response?.data;
  const m = d?.error?.message;
  return String(m?.value ?? m ?? d?.message ?? d?.error ?? err?.message ?? '');
}

async function fetchRuntimeArtifacts() {
  try {
    const data = await cachedGet('runtime_artifacts', '/api/v1/IntegrationRuntimeArtifacts');
    return toArray(data);
  } catch (err) {
    const msg = cpiErrorMessage(err);
    // Trial tenants often don't have a provisioned runtime location — return empty gracefully
    if (msg.includes('runtime location') || msg.includes('not supported')) {
      console.warn('[CPI] IntegrationRuntimeArtifacts not available on this tenant:', msg);
      return [];
    }
    throw err;
  }
}

async function fetchPackages() {
  const data = await cachedGet(
    'integration_packages',
    '/api/v1/IntegrationPackages'
  );
  return toArray(data);
}

async function fetchPackageIflows(packageId) {
  const key = `package_iflows_${packageId}`;
  const data = await cachedGet(
    key,
    `/api/v1/IntegrationPackages('${packageId}')/IntegrationDesigntimeArtifacts`
  );
  return toArray(data);
}

async function fetchMessageProcessingLogs(
  top = MPL_TOP,
  status,
  integrationFlowName
) {
  const filters = [];

  if (status) filters.push(`Status eq '${status}'`);
  if (integrationFlowName) {
    filters.push(`IntegrationFlowName eq '${integrationFlowName}'`);
  }

  const filterQuery = filters.length
    ? `&$filter=${encodeURIComponent(filters.join(' and '))}`
    : '';

  const cacheKey = `mpl_${top}_${status || ''}_${integrationFlowName || ''}`;

  const url = `/api/v1/MessageProcessingLogs?$top=${encodeURIComponent(
    top
  )}&$orderby=LogStart desc${filterQuery}`;

  const data = await cachedGet(cacheKey, url);
  return toArray(data);
}

async function fetchKeystoreEntries() {
  const data = await cachedGet('keystore_entries', '/api/v1/KeystoreEntries');
  return toArray(data);
}

async function fetchCredentials() {
  const data = await cachedGet('credentials', '/api/v1/UserCredentials');
  return toArray(data);
}

// ======================================================
// Live CPI operations
// ======================================================

async function countDeployedIflows() {
  const runtime = await fetchRuntimeArtifacts();

  return {
    operation: 'count_deployed_iflows',
    count: runtime.length,
    deployedIflows: runtime.map((r) => ({
      id: r.Id || r.Name || r.SymbolicName,
      name: r.Name || r.Id,
      status: r.Status || 'UNKNOWN',
    })),
  };
}

async function listDeployedIflows(limit = 200) {
  const runtime = await fetchRuntimeArtifacts();

  return {
    operation: 'list_deployed_iflows',
    count: runtime.length,
    items: runtime.slice(0, limit).map((r) => ({
      id: r.Id || r.SymbolicName || null,
      name: r.Name || r.Id || r.SymbolicName || 'UNKNOWN',
      status: r.Status || 'UNKNOWN',
      version: r.Version || null,
      deployedOn: r.DeployedOn || r.DeploymentDate || null,
    })),
  };
}

async function getSlowestIflows(top = 5, mplTop = MPL_TOP) {
  const logs = await fetchMessageProcessingLogs(mplTop);
  const grouped = new Map();

  for (const item of logs) {
    const flow =
      item.IntegrationFlowName ||
      item.IntegrationArtifactName ||
      item.ArtifactName ||
      item.ApplicationMessageId ||
      'UNKNOWN_IFLOW';

    const durationMs = parseDurationMs(item);
    if (durationMs === null) continue;

    if (!grouped.has(flow)) {
      grouped.set(flow, {
        count: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        lastStatus: item.Status || 'UNKNOWN',
      });
    }

    const row = grouped.get(flow);
    row.count += 1;
    row.totalDurationMs += durationMs;
    row.maxDurationMs = Math.max(row.maxDurationMs, durationMs);
    row.lastStatus = item.Status || row.lastStatus;
  }

  const ranked = [...grouped.entries()]
    .map(([flowName, v]) => ({
      flowName,
      sampleCount: v.count,
      averageDurationMs: Math.round(v.totalDurationMs / v.count),
      maxDurationMs: v.maxDurationMs,
      lastStatus: v.lastStatus,
    }))
    .sort((a, b) => b.averageDurationMs - a.averageDurationMs)
    .slice(0, top);

  return {
    operation: 'slowest_iflows',
    basedOnRecentMessages: logs.length,
    top,
    items: ranked,
    note: ranked.length
      ? 'Ranking is based on average processing time in recent message processing logs.'
      : 'No duration information was found in recent message processing logs.',
  };
}

async function getExpiringCertificates(withinDays = CERT_ALERT_DAYS) {
  const entries = await fetchKeystoreEntries();
  const items = [];

  for (const entry of entries) {
    const expiry = pickExpiryDate(entry);
    if (!expiry) continue;

    const remainingDays = daysUntil(expiry);
    if (remainingDays <= withinDays) {
      items.push({
        alias: entry.Alias || entry.Name || entry.id || 'UNKNOWN_ALIAS',
        type: entry.EntryType || entry.Type || 'UNKNOWN',
        owner: entry.Owner || entry.ManagedBy || null,
        validTo: expiry.toISOString(),
        remainingDays,
      });
    }
  }

  items.sort((a, b) => a.remainingDays - b.remainingDays);

  return {
    operation: 'expiring_certificates',
    withinDays,
    count: items.length,
    items,
  };
}

async function getFailedMessages(top = 20) {
  const logs = await fetchMessageProcessingLogs(Math.max(top, 100));

  const failed = logs
    .filter((x) => String(x.Status || '').toUpperCase() === 'FAILED')
    .slice(0, top)
    .map((x) => ({
      messageGuid: x.MessageGuid || x.Id || null,
      integrationFlowName:
        x.IntegrationFlowName ||
        x.IntegrationArtifactName ||
        'UNKNOWN_IFLOW',
      status: x.Status || 'FAILED',
      startedAt: x.LogStart || x.StartTime || null,
      endedAt: x.LogEnd || x.EndTime || null,
      error: x.ErrorMessage || x.AlternateWebLink || x.CustomStatus || null,
    }));

  return {
    operation: 'failed_messages',
    count: failed.length,
    items: failed,
  };
}

async function getSummary() {
  const [packages, runtime, logs] = await Promise.all([
    fetchPackages().catch(() => []),
    fetchRuntimeArtifacts().catch(() => []),
    fetchMessageProcessingLogs(Math.min(MPL_TOP, 200)).catch(() => []),
  ]);

  const completed = logs.filter(
    (x) => String(x.Status || '').toUpperCase() === 'COMPLETED'
  ).length;

  const failed = logs.filter(
    (x) => String(x.Status || '').toUpperCase() === 'FAILED'
  ).length;

  const started = runtime.filter(
    (x) => String(x.Status || '').toUpperCase() === 'STARTED'
  ).length;

  const stopped = runtime.filter(
    (x) => String(x.Status || '').toUpperCase() === 'STOPPED'
  ).length;

  const successRate = logs.length
    ? Math.round((completed / logs.length) * 100)
    : 0;

  return {
    operation: 'summary',
    totalPackages: packages.length,
    totalDeployedIflows: runtime.length,
    totalIflows: runtime.length,
    runtimeStatus: {
      STARTED: started,
      STOPPED: stopped,
      started,
      stopped,
    },
    recentMessagesChecked: logs.length,
    completedMessages: completed,
    failedMessages: failed,
    successRatePct: successRate,
    successRate: successRate,
    messagesToday: logs.length,
    activeAlerts: failed,
    activeFlows: started,
  };
}

async function countCertificates() {
  const entries = await fetchKeystoreEntries();

  const certs = entries.filter((entry) =>
    String(entry.EntryType || entry.Type || '').toLowerCase().includes('cert')
  );

  return {
    operation: 'count_certificates',
    count: certs.length,
    items: certs.map((entry) => ({
      alias: entry.Alias || entry.Name || entry.id || 'UNKNOWN_ALIAS',
      type: entry.EntryType || entry.Type || 'UNKNOWN',
    })),
  };
}

// ✅ security materials = ONLY credentials
async function countSecurityMaterials() {
  const credentials = await fetchCredentials();

  return {
    operation: 'count_security_materials',
    total: credentials.length,
    items: credentials.map((c) => ({
      name: c.Name || c.User || c.id || 'UNKNOWN_CREDENTIAL',
    })),
  };
}

// ✅ keystore entries = ONLY keystore/certificate entries
async function listKeystoreEntries() {
  const keystore = await fetchKeystoreEntries();

  return {
    operation: 'list_keystore_entries',
    count: keystore.length,
    items: keystore.map((k) => ({
      alias: k.Alias || k.Name || k.id || 'UNKNOWN_ALIAS',
      type: k.EntryType || k.Type || 'UNKNOWN',
    })),
  };
}

async function findSecurityMaterialUsage(materialName) {
  if (!materialName) {
    return {
      operation: 'find_security_material_usage',
      error: 'Security material name not provided',
      count: 0,
      iflows: [],
    };
  }

  console.log('[SECURITY_USAGE] Searching for material:', materialName);

  const packages = await fetchPackages();
  const results = [];
  const needle = materialName.toLowerCase();
  let artifactDownloadUnsupported = false;

  for (const pkg of packages) {
    const packageId = pkg.Id || pkg.Name;
    if (!packageId) continue;

    let iflows = [];
    try {
      iflows = await fetchPackageIflows(packageId);
    } catch (err) {
      console.warn(
        '[SECURITY_USAGE] Failed to fetch package iFlows:',
        packageId,
        err.message
      );
      continue;
    }

    for (const art of iflows) {
      const iflowId = art.Id || art.Name;
      if (!iflowId) continue;

      try {
        const response = await cpiClient.get(
          `/api/v1/IntegrationDesigntimeArtifacts(Id='${iflowId}',Version='active')/$value`,
          { responseType: 'arraybuffer' }
        );

        const zip = new AdmZip(Buffer.from(response.data));
        const entries = zip.getEntries();

        let matched = false;
        const matchedFiles = [];

        for (const entry of entries) {
          if (entry.isDirectory) continue;

          const entryName = entry.entryName || '';
          const lowerName = entryName.toLowerCase();

          const isSearchable =
            lowerName.endsWith('.iflw') ||
            lowerName.endsWith('.prop') ||
            lowerName.endsWith('.propdef') ||
            lowerName.endsWith('.xml') ||
            lowerName.endsWith('.groovy') ||
            lowerName.endsWith('.txt') ||
            lowerName.endsWith('.json');

          if (!isSearchable) continue;

          let text = '';
          try {
            text = zip.readAsText(entry, 'utf8');
          } catch {
            continue;
          }

          if (String(text).toLowerCase().includes(needle)) {
            matched = true;
            matchedFiles.push(entryName);
          }
        }

        if (matched) {
          results.push({
            iflowId,
            iflowName: art.Name || iflowId,
            packageId,
            matchedFiles,
          });
        }
      } catch (err) {
        const msg =
          err?.response?.data?.error?.message?.value ||
          err?.response?.data?.message ||
          err.message ||
          'Unknown error';

        if (String(msg).toLowerCase().includes('not implemented')) {
          artifactDownloadUnsupported = true;
        }

        console.warn(
          '[SECURITY_USAGE] Failed reading artifact content:',
          iflowId,
          msg
        );
      }
    }
  }

  return {
    operation: 'find_security_material_usage',
    materialName,
    count: results.length,
    iflows: results,
    artifactDownloadUnsupported,
  };
}

// ======================================================
// AI planner / assistant
// ======================================================

const SUPPORTED_TOOLS = [
  {
    name: 'count_deployed_iflows',
    description:
      'Return how many iFlows are currently deployed in SAP CPI runtime.',
    params: {},
  },
  {
    name: 'list_deployed_iflows',
    description: 'List deployed iFlows with status/version details.',
    params: { limit: 'number optional' },
  },
  {
    name: 'slowest_iflows',
    description:
      'Find the slowest iFlows based on recent Message Processing Logs.',
    params: { top: 'number optional', mplTop: 'number optional' },
  },
  {
    name: 'expiring_certificates',
    description:
      'Find keystore certificates that are expired or expiring soon.',
    params: { withinDays: 'number optional' },
  },
  {
    name: 'count_certificates',
    description:
      'Return how many certificates are deployed in SAP CPI.',
    params: {},
  },
  {
    name: 'count_security_materials',
    description:
      'Return all deployed security materials (user credentials only) in SAP CPI.',
    params: {},
  },
  {
    name: 'list_keystore_entries',
    description: 'Return all deployed keystore entries in SAP CPI.',
    params: {},
  },
  {
    name: 'find_security_material_usage',
    description:
      'Find which iFlows are using a given security material (credential or keystore alias).',
    params: { materialName: 'string' },
  },
  {
    name: 'failed_messages',
    description: 'List recent failed message processing logs.',
    params: { top: 'number optional' },
  },
  {
    name: 'summary',
    description: 'Return runtime/package/message summary dashboard.',
    params: {},
  },
  {
    name: 'knowledge_only',
    description:
      'Use this only when the user asks a generic design/how-to question that does not require live CPI data.',
    params: { prompt: 'string' },
  },
];

const AI_PROVIDERS = {
  groq: {
    label: 'Groq',
    models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
    ],
    defaultModel: 'llama-3.3-70b-versatile',
    keyConfigured: () => !!process.env.GROQ_API_KEY,
  },
};

async function callGroqChat(messages, temperature = 0.1) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not configured.');

  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  const { data } = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model,
      messages,
      temperature,
      max_tokens: 2200,
    },
    {
      timeout: 60000,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return data?.choices?.[0]?.message?.content || '';
}

async function planQuestionWithAI(question) {
  const plannerPrompt = [
    'You are an intent planner for SAP CPI live operations.',
    'Your job is NOT to answer the user question directly.',
    'Select exactly ONE tool from the provided tool list.',
    'Return strict JSON only in this shape:',
    '{"tool":"tool_name","params":{...},"reason":"short reason"}',
    'Use live-data tools whenever the user asks about deployed iflows, slow/long-running flows, certificates, runtime, messages, packages, failures, health, security materials, keystore entries, credentials, or where a security material is used.',
    'Use knowledge_only only for generic guidance questions that do not need live CPI data.',
    'Tool list:',
    JSON.stringify(SUPPORTED_TOOLS, null, 2),
    'User question:',
    question,
  ].join('\n');

  const content = await callGroqChat(
    [
      { role: 'system', content: 'Return JSON only. Do not use markdown.' },
      { role: 'user', content: plannerPrompt },
    ],
    0
  );

  const parsed = extractJsonObject(content);
  if (!parsed || !parsed.tool) {
    throw new Error('Planner could not generate valid JSON plan.');
  }

  return parsed;
}

function heuristicPlan(question) {
  const q = String(question || '').toLowerCase();

  if (
    /(where|which|in which).*(iflow|flow|integration flow)?.*(security material|security materials|credential|credentials|keystore|alias).*(used|using|deployed|referenced)/.test(q) ||
    /(security material|credential|credentials|keystore|alias).*(used|using|deployed|referenced).*(iflow|flow)/.test(q)
  ) {
    return {
      tool: 'find_security_material_usage',
      params: {
        materialName: extractSecurityMaterialName(question),
      },
      reason: 'heuristic security material where-used',
    };
  }

  // ✅ keystore/certificates listing
  if (
    /(show|list|display|what are).*(keystore|keystore entries|certificates)/.test(q) ||
    /(keystore|keystore entries|certificates).*(show|list|display)/.test(q)
  ) {
    return {
      tool: 'list_keystore_entries',
      params: {},
      reason: 'heuristic keystore listing',
    };
  }

  // ✅ security materials = credentials only
  if (
    /(show|list|display|what are).*(security material|security materials|credential|credentials)/.test(q) ||
    /(security material|security materials|credential|credentials).*(show|list|display)/.test(q) ||
    /(how many|count|number of).*(security material|security materials|credential|credentials)/.test(q)
  ) {
    return {
      tool: 'count_security_materials',
      params: {},
      reason: 'heuristic security material listing',
    };
  }

  if (/(how many|count).*(iflow|i flow|integration flow|deployed)/.test(q)) {
    return {
      tool: 'count_deployed_iflows',
      params: {},
      reason: 'heuristic count',
    };
  }

  if (/(how many|count|number of).*(certificate|certificates)/.test(q)) {
    return {
      tool: 'count_certificates',
      params: {},
      reason: 'heuristic certificate count',
    };
  }

  if (
    /(slow|long|taking longer|performance|duration|latency)/.test(q) &&
    /(iflow|flow|integration)/.test(q)
  ) {
    return {
      tool: 'slowest_iflows',
      params: { top: 5, mplTop: MPL_TOP },
      reason: 'heuristic slowest',
    };
  }

  if (
    /(certificate|certificates|keystore|ssl|tls)/.test(q) &&
    /(expire|expiry|expiring|validity)/.test(q)
  ) {
    return {
      tool: 'expiring_certificates',
      params: { withinDays: CERT_ALERT_DAYS },
      reason: 'heuristic certificates',
    };
  }

  if (/(failed|error|errors|failed messages|runtime failures)/.test(q)) {
    return {
      tool: 'failed_messages',
      params: { top: 20 },
      reason: 'heuristic failed messages',
    };
  }

  if (/(summary|dashboard|health|overview|status)/.test(q)) {
    return {
      tool: 'summary',
      params: {},
      reason: 'heuristic summary',
    };
  }

  if (/(list|show).*(iflow|flows)/.test(q)) {
    return {
      tool: 'list_deployed_iflows',
      params: { limit: 200 },
      reason: 'heuristic list deployed iflows',
    };
  }

  return {
    tool: 'knowledge_only',
    params: { prompt: question },
    reason: 'fallback generic guidance',
  };
}

async function planQuestion(question) {
  const q = String(question || '').toLowerCase();

  if (
    /(where|which|in which).*(security material|credential|credentials|keystore|alias)/.test(q) ||
    /(security material|credential|credentials|keystore|alias).*(used|using|deployed|referenced)/.test(q)
  ) {
    return heuristicPlan(question);
  }

  if (process.env.GROQ_API_KEY) {
    try {
      return await planQuestionWithAI(question);
    } catch (err) {
      console.warn(
        '[WARN] AI planner failed, falling back to heuristic planner:',
        err.message
      );
      return heuristicPlan(question);
    }
  }

  return heuristicPlan(question);
}

async function executePlan(plan, question) {
  const tool = plan?.tool;
  const params = plan?.params || {};

  switch (tool) {
    case 'count_deployed_iflows':
      return countDeployedIflows();

    case 'list_deployed_iflows':
      return listDeployedIflows(Number(params.limit || 200));

    case 'slowest_iflows':
      return getSlowestIflows(
        Number(params.top || 5),
        Number(params.mplTop || MPL_TOP)
      );

    case 'expiring_certificates':
      return getExpiringCertificates(
        Number(params.withinDays || CERT_ALERT_DAYS)
      );

    case 'count_certificates':
      return countCertificates();

    case 'count_security_materials':
      return countSecurityMaterials();

    case 'list_keystore_entries':
      return listKeystoreEntries();

    case 'find_security_material_usage':
      return findSecurityMaterialUsage(params.materialName);

    case 'failed_messages':
      return getFailedMessages(Number(params.top || 20));

    case 'summary':
      return getSummary();

    case 'knowledge_only':
    default:
      return {
        operation: 'knowledge_only',
        note: 'This question was classified as non-live/generic guidance.',
        prompt: params.prompt || question,
      };
  }
}

async function buildFinalAnswer(question, toolResult, useGroq) {
  if (toolResult.operation === 'knowledge_only') {
    if (!useGroq || !process.env.GROQ_API_KEY) {
      return 'This question does not match a live CPI monitoring operation currently implemented by the backend. Add a new CPI tool or enable Groq guidance for generic answers.';
    }

    return callGroqChat(
      [
        {
          role: 'system',
          content:
            'You are an SAP CPI assistant. Answer clearly and practically. If the question needs live CPI data that is not available through tools, say so explicitly. Keep it concise.',
        },
        {
          role: 'user',
          content: toolResult.prompt,
        },
      ],
      0.2
    );
  }

  if (!useGroq || !process.env.GROQ_API_KEY) {
    switch (toolResult.operation) {
      case 'count_deployed_iflows':
        return `There are ${toolResult.count} deployed iFlows in SAP CPI runtime.`;

      case 'list_deployed_iflows':
        return `Found ${toolResult.count} deployed iFlows.`;

      case 'slowest_iflows':
        return toolResult.items?.length
          ? `Top slowest iFlows identified from recent message logs: ${toolResult.items
              .map((x) => `${x.flowName} (${x.averageDurationMs} ms avg)`)
              .join(', ')}.`
          : 'No duration information was found in recent message processing logs.';

      case 'expiring_certificates':
        return toolResult.count
          ? `Found ${toolResult.count} certificate/key entries expiring within ${toolResult.withinDays} days.`
          : `No certificate/key entries are expiring within ${toolResult.withinDays} days.`;

      case 'count_certificates':
        return toolResult.count
          ? `There are ${toolResult.count} certificates deployed in the SAP CPI tenant.`
          : 'No certificates are deployed in the SAP CPI tenant.';

      case 'count_security_materials':
        return toolResult.total
          ? `The deployed security materials in SAP CPI are: ${toolResult.items.map((x) => x.name).join(', ')}.`
          : 'No security materials are deployed in the SAP CPI tenant.';

      case 'list_keystore_entries':
        return toolResult.count
          ? `The deployed keystore entries in SAP CPI are: ${toolResult.items.map((x) => `${x.alias} (${x.type})`).join(', ')}.`
          : 'No keystore entries are deployed in the SAP CPI tenant.';

      case 'find_security_material_usage':
        if (toolResult.artifactDownloadUnsupported) {
          return `Security material usage lookup for "${toolResult.materialName}" could not be completed because design-time artifact content download is not supported by the current CPI API access/user configuration.`;
        }
        return toolResult.count
          ? `Security material "${toolResult.materialName}" is used in ${toolResult.count} iFlow(s): ${toolResult.iflows.map((x) => x.iflowName).join(', ')}.`
          : `Security material "${toolResult.materialName}" is not used in any iFlow, or no match was found.`;

      case 'failed_messages':
        return `Found ${toolResult.count} recent failed messages.`;

      case 'summary':
        return `Summary: ${toolResult.totalDeployedIflows} deployed iFlows, ${toolResult.totalPackages} packages, ${toolResult.failedMessages} failed messages in recent logs, success rate ${toolResult.successRatePct}%.`;

      default:
        return 'Operation completed.';
    }
  }

  const prompt = [
    'You are an SAP CPI operations copilot.',
    'Answer the user using ONLY the provided tool result.',
    'Do not invent any values.',
    'If some fields are missing, say that clearly.',
    'User question:',
    question,
    'Tool result JSON:',
    summarizeDataAsText(toolResult),
  ].join('\n');

  return callGroqChat(
    [
      {
        role: 'system',
        content:
          'Be accurate, concise, and factual. Use bullets when helpful.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    0.1
  );
}

// ======================================================
// Legacy prompt handlers for old UI buttons
// ======================================================

function compatibilityPromptGenerate(prompt) {
  return (
    `You are a senior SAP CPI architect.\n\nRequest: ${prompt}\n\n` +
    `## 1. iFlow Architecture\n` +
    `## 2. Sender & Receiver\n` +
    `## 3. Adapter Config\n` +
    `## 4. Message Processing Steps\n` +
    `## 5. Security\n` +
    `## 6. Error Handling\n` +
    `## 7. Deployment Checklist\n` +
    `## 8. Best Practices`
  );
}

function compatibilityPromptAnalyze(errorText) {
  return (
    `You are a SAP CPI error analysis expert.\n\nError:\n${errorText}\n\n` +
    `## 1. Root Cause\n` +
    `## 2. Step-by-Step Fix\n` +
    `## 3. Prevention\n` +
    `## 4. SAP Notes & KBAs`
  );
}

function compatibilityPromptOptimize(codeText) {
  return (
    `You are a SAP CPI performance expert.\n\nCode:\n${codeText}\n\n` +
    `## 1. Issues Found\n` +
    `## 2. Optimized Solution\n` +
    `## 3. Performance Gain\n` +
    `## 4. Best Practices Applied`
  );
}

// ======================================================
// ZIP generation helpers
// ======================================================

async function buildZipSpecFromPrompt(prompt) {
  const zipPrompt = `
You are an SAP CPI artifact generator.

Return ONLY JSON in the following format:

{
  "zipName": "sap-cpi-iflow.zip",
  "files": [
    {
      "path": "iflow.json",
      "content": "file content here"
    }
  ]
}

Rules:
1. Return valid JSON only, no markdown.
2. Create a realistic SAP CPI iFlow starter package for the given request.
3. Include meaningful files such as:
   - iflow.json
   - src/main/resources/integrationflow.xml
   - src/main/resources/scripts/*.groovy
   - src/main/resources/readme.txt
   - src/main/resources/config.properties
4. Make file contents practical and syntactically reasonable.
5. Do not include binaries.
6. Keep file content concise but useful.

User request:
${prompt}
`;

  const raw = await callGroqChat(
    [
      {
        role: 'system',
        content:
          'You are a precise JSON generator. Return JSON only. Do not use markdown.',
      },
      {
        role: 'user',
        content: zipPrompt,
      },
    ],
    0.2
  );

  const parsed = extractJsonObject(raw);

  if (!parsed || !Array.isArray(parsed.files)) {
    throw new Error('AI did not return a valid ZIP specification JSON.');
  }

  return parsed;
}

async function writeZipFromSpec(spec) {
  if (typeof ZipArchive !== 'function') {
    throw new Error(
      'ZipArchive class is not available from archiver package. Please verify archiver@8 is installed correctly.'
    );
  }

  const zipName =
    sanitizeEntryPath(spec.zipName) || uniqueFileName('sap-cpi-iflow', '.zip');

  const fileName = path.basename(zipName).endsWith('.zip')
    ? path.basename(zipName)
    : `${path.basename(zipName)}.zip`;

  const zipPath = path.join(GENERATED_DIR, fileName);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', reject);

    archive.pipe(output);

    for (const file of spec.files || []) {
      const safePath = sanitizeEntryPath(file.path);
      if (!safePath) continue;

      archive.append(String(file.content || ''), { name: safePath });
    }

    archive.finalize();
  });

  return { fileName, zipPath };
}

// ======================================================
// Error handler
// ======================================================

function handleError(res, error, context = 'request') {
  const status = error.response?.status || 500;
  const details = cpiErrorMessage(error) || 'Unexpected error';

  console.error(`[ERROR] ${context}:`, details);

  return res.status(status).json({
    success: false,
    error: details,
    context,
  });
}

// ======================================================
// Base routes
// ======================================================

app.get('/', (_req, res, next) => {
  // When a frontend build is present it owns "/"; fall through to the static
  // middleware registered further down. Backend identity stays on /api/status.
  if (fs.existsSync(path.join(__dirname, 'public'))) return next();
  res.json({
    success: true,
    name: 'SAP CPI AI Backend',
    version: '3.3.0',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/status', (_req, res) => {
  res.json({
    success: true,
    configured: isConfigured(),
    provider: AI_PROVIDER,
    tempApiKeyGenerated: GENERATED_BACKEND_API_KEY,
    docs: '/api/docs',
    tools: '/api/tools',
  });
});

app.get('/api/docs', (_req, res) => {
  res.json({
    success: true,
    endpoints: {
      health: 'GET /api/health',
      tools: 'GET /api/tools',
      assistant: 'POST /api/assistant',
      legacyChat: 'POST /api/ai/chat',
      runtimeArtifacts: 'GET /api/cpi/runtime-artifacts',
      packages: 'GET /api/cpi/packages',
      messages: 'GET /api/cpi/messages?top=50',
      keystore: 'GET /api/cpi/keystore',
      summary: 'GET /api/cpi/summary',
      zipGenerate: 'POST /api/ai/generate',
      zipDownload: 'GET /api/generated/:fileName',
      mappingGenerate: 'POST /api/mapping/generate',
    },
    auth: {
      header: 'x-api-key: <BACKEND_API_KEY>',
      alt: 'Authorization: Bearer <BACKEND_API_KEY>',
    },
  });
});

app.get('/api/tools', (_req, res) => {
  res.json({ success: true, tools: SUPPORTED_TOOLS });
});

app.get('/api/health', async (_req, res) => {
  if (!isConfigured()) {
    return res.status(500).json({
      success: false,
      error:
        'CPI not configured. Set CPI_BASE_URL + (CPI_USERNAME/CPI_PASSWORD for Basic Auth, or CPI_OAUTH_TOKEN_URL/CPI_OAUTH_CLIENT_ID/CPI_OAUTH_CLIENT_SECRET for OAuth).',
    });
  }

  try {
    await cpiClient.get('/api/v1/IntegrationPackages?$top=1');
    return res.json({
      success: true,
      cpi: 'connected',
      aiPlanner: !!process.env.GROQ_API_KEY,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleError(res, error, 'GET /api/health');
  }
});

// ======================================================
// Mapping sheet preview (parse only, no ZIP)
// ======================================================

app.post('/api/mapping/preview-sheet', upload.single('templateFile'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    const rows = parseMappingTemplate(req.file.path, req.file.originalname);
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.json({
      success: true,
      rows: rows.map(r => ({
        sourceObject:       r.sourceObject,
        sourceFieldName:    r.sourceFieldName,
        technicalName:      r.sourceTechnicalName,
        targetFieldName:    r.targetFieldName,
        mandatory:          r.mandatory,
        transformationRule: r.transformationRule,
        comments:           r.comments,
        classification:     r.transformationType,
        constantValue:      r.constantValue,
      })),
    });
  } catch (err) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return handleError(res, err, 'POST /api/mapping/preview-sheet');
  }
});

// ======================================================
// Mapping generation route
// ======================================================

app.post('/api/mapping/generate', upload.single('templateFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'templateFile is required',
      });
    }

    const mappingName = String(req.body?.mappingName || 'Generated_Mapping').trim();

    console.log('[MAPPING] Upload received:', req.file.originalname);
    console.log('[MAPPING] Temp file path:', req.file.path);
    console.log('[MAPPING] Mapping name:', mappingName);

    const rows = parseMappingTemplate(req.file.path, req.file.originalname);
    console.log('[MAPPING] Parsed rows:', rows.length);

    // Ask AI to decide the best CPI node function for each mapping row
    const aiDecisions = await buildMappingWithAI(rows, callGroqChat);
    console.log('[MAPPING] AI decisions received:', aiDecisions.length);

    // Tally by AI-decided type for the response summary
    const countByType = aiDecisions.reduce((acc, d) => {
      acc[d.type] = (acc[d.type] || 0) + 1;
      return acc;
    }, {});
    const direct   = aiDecisions.filter(d => d.type === 'direct');
    const constants = aiDecisions.filter(d => d.type === 'constant');
    const custom   = [];  // no custom rules — AI uses standard functions only

    const result = await buildMappingZip(mappingName, rows, aiDecisions);
    console.log('[MAPPING] ZIP created:', result.fileName);

    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    // Build mapping preview for the UI — merge AI decision per row
    const decisionMap = {};
    for (const d of aiDecisions) if (d.targetField) decisionMap[String(d.targetField).trim()] = d;

    const preview = rows.map(r => {
      const tgt = r.targetElementName || r.targetFieldName || '';
      const d   = decisionMap[String(tgt).trim()];
      return {
        sourceObject:       r.sourceObject,
        sourceField:        r.sourceFieldName || r.sourceElementName,
        targetField:        r.targetFieldName || r.targetElementName,
        aiFunction:         d?.type || r.transformationType || 'direct',
        transformationRule: r.transformationRule || r.comments || '',
        constantValue:      r.constantValue || (d?.type === 'constant' ? d?.value : ''),
        mandatory:          r.mandatory,
      };
    });

    return res.json({
      success: true,
      fileCreated: true,
      fileName: result.fileName,
      downloadUrl: `/api/generated/${encodeURIComponent(result.fileName)}`,
      summary: {
        total:     rows.length,
        direct:    direct.length,
        constants: constants.length,
        custom:    custom.length,
        aiDecided: true,
        breakdown: countByType,
      },
      preview,
    });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('[MAPPING GENERATE ERROR]', error?.message, error?.stack);
    return handleError(res, error, 'POST /api/mapping/generate');
  }
});

// ======================================================
// Download generated ZIP
// ======================================================

app.get('/api/generated/:fileName', (req, res) => {
  try {
    const fileName = path.basename(req.params.fileName);
    const filePath = path.join(GENERATED_DIR, fileName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'Generated file not found',
      });
    }

    return res.download(filePath, fileName);
  } catch (error) {
    return handleError(res, error, 'GET /api/generated/:fileName');
  }
});

// ======================================================
// Modern CPI endpoints
// ======================================================

app.get('/api/cpi/runtime-artifacts', async (_req, res) => {
  try {
    const results = await fetchRuntimeArtifacts();
    return res.json({ success: true, count: results.length, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/runtime-artifacts');
  }
});

app.get('/api/cpi/packages', async (req, res) => {
  try {
    const search = String(req.query.search || '').toLowerCase();
    const top = Number(req.query.top || 50);

    let results = await fetchPackages();

    if (search) {
      results = results.filter(
        (p) =>
          String(p.Name || '').toLowerCase().includes(search) ||
          String(p.Id || '').toLowerCase().includes(search)
      );
    }

    return res.json({
      success: true,
      count: results.length,
      results: results.slice(0, top),
    });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/packages');
  }
});

app.get('/api/cpi/messages', async (req, res) => {
  try {
    const top = Number(req.query.top || 50);
    const status = req.query.status;
    const integrationFlowName = req.query.integrationFlowName;

    const results = await fetchMessageProcessingLogs(
      top,
      status,
      integrationFlowName
    );

    return res.json({ success: true, count: results.length, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/messages');
  }
});

app.get('/api/cpi/keystore', async (_req, res) => {
  try {
    const results = await fetchKeystoreEntries();
    return res.json({ success: true, count: results.length, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/keystore');
  }
});

app.get('/api/cpi/slowest-iflows', async (req, res) => {
  try {
    const top = Number(req.query.top || 5);
    const mplTop = Number(req.query.mplTop || MPL_TOP);
    const result = await getSlowestIflows(top, mplTop);
    return res.json({ success: true, ...result });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/slowest-iflows');
  }
});

app.get('/api/cpi/certificates/expiring', async (req, res) => {
  try {
    const withinDays = Number(req.query.withinDays || CERT_ALERT_DAYS);
    const result = await getExpiringCertificates(withinDays);
    return res.json({ success: true, ...result });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/certificates/expiring');
  }
});

app.get('/api/cpi/summary', async (_req, res) => {
  try {
    const result = await getSummary();
    return res.json({ success: true, ...result });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/summary');
  }
});

// ======================================================
// Legacy UI routes
// ======================================================

app.get('/api/dashboard-stats', async (_req, res) => {
  try {
    const result = await getSummary();
    return res.json({ success: true, ...result });
  } catch (error) {
    return handleError(res, error, 'GET /api/dashboard-stats');
  }
});

app.get('/api/packages', async (req, res) => {
  try {
    const search = String(req.query.search || '').toLowerCase();
    const top = Number(req.query.top || 50);

    let results = await fetchPackages();

    if (search) {
      results = results.filter(
        (p) =>
          String(p.Name || '').toLowerCase().includes(search) ||
          String(p.Id || '').toLowerCase().includes(search)
      );
    }

    return res.json({
      success: true,
      count: results.length,
      results: results.slice(0, top),
    });
  } catch (error) {
    return handleError(res, error, 'GET /api/packages');
  }
});

app.get('/api/packages/:packageId/iflows', async (req, res) => {
  try {
    const { packageId } = req.params;
    const results = await fetchPackageIflows(packageId);

    return res.json({
      success: true,
      count: results.length,
      packageId,
      results,
    });
  } catch (error) {
    return handleError(res, error, 'GET /api/packages/:packageId/iflows');
  }
});

app.get('/api/runtime-artifacts', async (_req, res) => {
  try {
    const results = await fetchRuntimeArtifacts();
    return res.json({ success: true, count: results.length, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/runtime-artifacts');
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const top = Number(req.query.top || 50);
    const status = req.query.status;
    const integrationFlowName = req.query.integrationFlowName;

    const results = await fetchMessageProcessingLogs(
      top,
      status,
      integrationFlowName
    );

    return res.json({ success: true, count: results.length, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/messages');
  }
});

app.get('/api/credentials', async (_req, res) => {
  try {
    const results = await fetchCredentials();
    return res.json({ success: true, count: results.length, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/credentials');
  }
});

app.get('/api/keystore', async (_req, res) => {
  try {
    const results = await fetchKeystoreEntries();
    return res.json({ success: true, count: results.length, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/keystore');
  }
});

// ======================================================
// Config routes
// ======================================================

const ALLOWED_CONFIG_KEYS = [
  'CPI_BASE_URL',
  'CPI_AUTH_MODE',
  'CPI_USERNAME',
  'CPI_PASSWORD',
  'CPI_OAUTH_TOKEN_URL',
  'CPI_OAUTH_CLIENT_ID',
  'CPI_OAUTH_CLIENT_SECRET',
  'PORT',
  'ALLOWED_ORIGINS',
  'AI_PROVIDER',
  'GROQ_API_KEY',
  'GROQ_MODEL',
  'BACKEND_API_KEY',
  'CACHE_TTL_SECONDS',
  'MPL_TOP',
  'CERT_ALERT_DAYS',
  'RATE_LIMIT_PER_MIN',
];

app.get('/api/config', (_req, res) => {
  try {
    const raw = fs.existsSync(ENV_PATH)
      ? fs.readFileSync(ENV_PATH, 'utf-8')
      : '';

    const parsed = parseEnv(raw);

    res.json({
      success: true,
      config: {
        CPI_BASE_URL: parsed.CPI_BASE_URL || process.env.CPI_BASE_URL || '',
        CPI_AUTH_MODE: parsed.CPI_AUTH_MODE || process.env.CPI_AUTH_MODE || 'basic',
        CPI_USERNAME: parsed.CPI_USERNAME || process.env.CPI_USERNAME || '',
        CPI_PASSWORD: parsed.CPI_PASSWORD || process.env.CPI_PASSWORD || '',
        CPI_OAUTH_TOKEN_URL: parsed.CPI_OAUTH_TOKEN_URL || process.env.CPI_OAUTH_TOKEN_URL || '',
        CPI_OAUTH_CLIENT_ID: parsed.CPI_OAUTH_CLIENT_ID || process.env.CPI_OAUTH_CLIENT_ID || '',
        CPI_OAUTH_CLIENT_SECRET: parsed.CPI_OAUTH_CLIENT_SECRET || process.env.CPI_OAUTH_CLIENT_SECRET || '',
        AI_PROVIDER: parsed.AI_PROVIDER || process.env.AI_PROVIDER || 'groq',
        GROQ_API_KEY: parsed.GROQ_API_KEY || process.env.GROQ_API_KEY || '',
        GROQ_MODEL:
          parsed.GROQ_MODEL ||
          process.env.GROQ_MODEL ||
          'llama-3.3-70b-versatile',
        PORT: parsed.PORT || process.env.PORT || '8081',
        ALLOWED_ORIGINS:
          parsed.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || '',
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to read config: ' + err.message,
    });
  }
});

app.post('/api/config', (req, res) => {
  try {
    const updates = req.body || {};
    const invalid = Object.keys(updates).filter(
      (k) => !ALLOWED_CONFIG_KEYS.includes(k)
    );

    if (invalid.length) {
      return res.status(400).json({
        success: false,
        error: 'Unknown keys: ' + invalid.join(', '),
      });
    }

    const raw = fs.existsSync(ENV_PATH)
      ? fs.readFileSync(ENV_PATH, 'utf-8')
      : '';

    const current = parseEnv(raw);

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && value !== null) {
        current[key] = String(value);
        process.env[key] = String(value);
      }
    }

    fs.writeFileSync(ENV_PATH, serializeEnv(current), 'utf-8');
    cache.flushAll();
    // Invalidate cached OAuth token so next request re-fetches with new credentials
    invalidateOAuthToken();

    res.json({
      success: true,
      message: 'Configuration saved and reloaded.',
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to save config: ' + err.message,
    });
  }
});

// ======================================================
// Provider routes
// ======================================================

app.get('/api/ai/providers', (_req, res) => {
  const active = process.env.AI_PROVIDER || 'groq';

  const providers = Object.entries(AI_PROVIDERS).map(([id, p]) => ({
    id,
    label: p.label,
    models: p.models,
    defaultModel: p.defaultModel,
    activeModel: process.env.GROQ_MODEL || p.defaultModel,
    keyConfigured: p.keyConfigured(),
    isActive: id === active,
  }));

  res.json({ success: true, active, providers });
});

app.post('/api/ai/test-provider', async (req, res) => {
  const provider = req.body?.provider || 'groq';

  if (provider !== 'groq') {
    return res.status(400).json({
      success: false,
      error: 'Only groq is supported in this build.',
    });
  }

  try {
    const response = await callGroqChat(
      [
        {
          role: 'user',
          content:
            'Reply with exactly: "SAP CPI AI Control Center connected."',
        },
      ],
      0
    );

    res.json({
      success: true,
      provider,
      response: String(response).trim(),
    });
  } catch (err) {
    handleError(res, err, 'POST /api/ai/test-provider');
  }
});

// ======================================================
// Legacy AI endpoints
// ======================================================

app.post('/api/ai/generate-iflow-from-query', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'prompt is required',
      });
    }

    const spec = await buildSpecFromPrompt(prompt, callGroqChat);
    const result = await buildIflowFromTemplate(spec);

    return res.json({
      success: true,
      provider: 'groq',
      spec,
      fileCreated: true,
      fileName: result.fileName,
      downloadUrl: `/api/generated/${encodeURIComponent(result.fileName)}`,
      response: `iFlow ZIP generated successfully: ${result.fileName}`,
    });
  } catch (error) {
    return handleError(res, error, 'POST /api/ai/generate-iflow-from-query');
  }
});

app.post('/api/ai/generate', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'prompt is required',
      });
    }

    if (looksLikeZipRequest(prompt)) {
      console.log('[ZIP] /api/ai/generate triggered');
      console.log('[ZIP] Prompt:', prompt);

      const spec = await buildSpecFromPrompt(prompt, callGroqChat);
      console.log('[ZIP] Spec JSON:', JSON.stringify(spec, null, 2));

      const result = await buildIflowFromTemplate(spec);
      console.log('[ZIP] Generated file:', result.fileName);
      console.log('[ZIP] Generated path:', result.zipPath);

      return res.json({
        success: true,
        provider: 'groq',
        generator: 'template-builder',
        fileCreated: true,
        fileName: result.fileName,
        downloadUrl: `/api/generated/${encodeURIComponent(result.fileName)}`,
        spec,
        response: `Template-based CPI iFlow ZIP created successfully.\n\nDownload URL: /api/generated/${result.fileName}`,
      });
    }

    const response = await callGroqChat(
      [
        {
          role: 'system',
          content:
            'You are a senior SAP CPI architect. Be clear, practical, and implementation-ready.',
        },
        {
          role: 'user',
          content: compatibilityPromptGenerate(prompt),
        },
      ],
      0.2
    );

    return res.json({
      success: true,
      response,
      provider: 'groq',
    });
  } catch (error) {
    return handleError(res, error, 'POST /api/ai/generate');
  }
});

app.post('/api/ai/generate-zip', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'prompt is required',
      });
    }

    const spec = await buildZipSpecFromPrompt(prompt);
    const { fileName } = await writeZipFromSpec(spec);

    return res.json({
      success: true,
      fileCreated: true,
      fileName,
      downloadUrl: `/api/generated/${encodeURIComponent(fileName)}`,
      response: 'ZIP file created successfully.',
    });
  } catch (error) {
    return handleError(res, error, 'POST /api/ai/generate-zip');
  }
});

app.post('/api/ai/analyze', async (req, res) => {
  try {
    const errorText = String(req.body?.error || '').trim();

    if (!errorText) {
      return res.status(400).json({
        success: false,
        error: 'error field is required',
      });
    }

    const response = await callGroqChat(
      [
        {
          role: 'system',
          content: 'You are a SAP CPI error analysis expert.',
        },
        {
          role: 'user',
          content: compatibilityPromptAnalyze(errorText),
        },
      ],
      0.2
    );

    return res.json({
      success: true,
      response,
      provider: 'groq',
    });
  } catch (error) {
    return handleError(res, error, 'POST /api/ai/analyze');
  }
});

app.post('/api/ai/optimize', async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim();

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'code field is required',
      });
    }

    const response = await callGroqChat(
      [
        {
          role: 'system',
          content: 'You are a SAP CPI performance expert.',
        },
        {
          role: 'user',
          content: compatibilityPromptOptimize(code),
        },
      ],
      0.2
    );

    return res.json({
      success: true,
      response,
      provider: 'groq',
    });
  } catch (error) {
    return handleError(res, error, 'POST /api/ai/optimize');
  }
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    const useGroq = req.body?.useGroq !== false;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'message is required',
      });
    }

    const plan = await planQuestion(message);
    const toolResult = await executePlan(plan, message);

    console.log('[ASSISTANT] Plan:', plan);
    console.log('[ASSISTANT] Tool result:', JSON.stringify(toolResult, null, 2));

    const response = await buildFinalAnswer(message, toolResult, useGroq);

    return res.json({
      success: true,
      provider: process.env.GROQ_API_KEY && useGroq ? 'groq' : 'backend',
      plan,
      toolResult,
      response,
    });
  } catch (error) {
    return handleError(res, error, 'POST /api/ai/chat');
  }
});

// ======================================================
// Main assistant route
// ======================================================

app.post('/api/assistant', async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(500).json({
        success: false,
        error: 'CPI configuration missing in .env.',
      });
    }

    const message = String(req.body?.message || '').trim();
    const useGroq = req.body?.useGroq !== false;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'message is required',
      });
    }

    const plan = await planQuestion(message);
    const toolResult = await executePlan(plan, message);

    console.log('[ASSISTANT] Plan:', plan);
    console.log('[ASSISTANT] Tool result:', JSON.stringify(toolResult, null, 2));

    const response = await buildFinalAnswer(message, toolResult, useGroq);

    return res.json({
      success: true,
      provider: process.env.GROQ_API_KEY && useGroq ? 'groq' : 'backend',
      plan,
      toolResult,
      response,
    });
  } catch (error) {
    return handleError(res, error, 'POST /api/assistant');
  }
});

// ── Deploy / Undeploy iFlows ─────────────────────────────────────────────────
app.post('/api/cpi/deploy', async (req, res) => {
  try {
    const iflowIds = req.body?.iflowIds;
    if (!Array.isArray(iflowIds) || iflowIds.length === 0) {
      return res.status(400).json({ success: false, error: 'iflowIds array is required' });
    }
    const results = await batchDeploy(iflowIds);
    const succeeded = results.filter(r => r.success).length;
    return res.json({
      success: true,
      operation: 'deploy',
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    });
  } catch (error) {
    return handleError(res, error, 'POST /api/cpi/deploy');
  }
});

app.post('/api/cpi/undeploy', async (req, res) => {
  try {
    const iflowIds = req.body?.iflowIds;
    if (!Array.isArray(iflowIds) || iflowIds.length === 0) {
      return res.status(400).json({ success: false, error: 'iflowIds array is required' });
    }
    const results = await batchUndeploy(iflowIds);
    const succeeded = results.filter(r => r.success).length;
    return res.json({
      success: true,
      operation: 'undeploy',
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    });
  } catch (error) {
    return handleError(res, error, 'POST /api/cpi/undeploy');
  }
});

app.get('/api/cpi/where-used', async (req, res) => {
  try {
    const alias = String(req.query.alias || '').trim();
    if (!alias) {
      return res.status(400).json({ success: false, error: 'alias query param is required' });
    }
    const result = await whereUsed(alias);
    return res.json({ success: true, ...result });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/where-used');
  }
});

// ======================================================
// Serve React frontend (production build)
// ======================================================

const FRONTEND_DIST = path.join(__dirname, 'public');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  // SPA fallback — serve index.html for all non-API routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

// ====== NEW ARTIFACT & OPERATIONS ROUTES ======

// -- 1. All Artifact Types per Package --

app.get('/api/cpi/packages/:packageId/valuemappings', async (req, res) => {
  try {
    const { packageId } = req.params;
    const { data } = await cpiClient.get(
      `/api/v1/IntegrationPackages('${packageId}')/IntegrationDesigntimeArtifacts?$filter=ArtifactType eq 'ValueMapping'`
    );
    const results = data?.d?.results || data?.value || [];
    return res.json({ success: true, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/packages/:packageId/valuemappings');
  }
});

app.get('/api/cpi/packages/:packageId/messagemappings', async (req, res) => {
  try {
    const { packageId } = req.params;
    const { data } = await cpiClient.get(
      `/api/v1/IntegrationPackages('${packageId}')/IntegrationDesigntimeArtifacts?$filter=ArtifactType eq 'MessageMapping'`
    );
    const results = data?.d?.results || data?.value || [];
    return res.json({ success: true, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/packages/:packageId/messagemappings');
  }
});

app.get('/api/cpi/packages/:packageId/scriptcollections', async (req, res) => {
  try {
    const { packageId } = req.params;
    const { data } = await cpiClient.get(
      `/api/v1/IntegrationPackages('${packageId}')/IntegrationDesigntimeArtifacts?$filter=ArtifactType eq 'ScriptCollection'`
    );
    const results = data?.d?.results || data?.value || [];
    return res.json({ success: true, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/packages/:packageId/scriptcollections');
  }
});

app.get('/api/cpi/packages/:packageId/functionlibraries', async (req, res) => {
  try {
    const { packageId } = req.params;
    const { data } = await cpiClient.get(
      `/api/v1/IntegrationPackages('${packageId}')/IntegrationDesigntimeArtifacts?$filter=ArtifactType eq 'FunctionLibrary'`
    );
    const results = data?.d?.results || data?.value || [];
    return res.json({ success: true, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/packages/:packageId/functionlibraries');
  }
});

app.get('/api/cpi/packages/:packageId/all-artifacts', async (req, res) => {
  try {
    const { packageId } = req.params;
    const artifactTypes = ['IFlow', 'ValueMapping', 'MessageMapping', 'ScriptCollection', 'FunctionLibrary'];

    const responses = await Promise.allSettled(
      artifactTypes.map((type) =>
        type === 'IFlow'
          ? cpiClient.get(`/api/v1/IntegrationPackages('${packageId}')/IntegrationDesigntimeArtifacts`)
          : cpiClient.get(
              `/api/v1/IntegrationPackages('${packageId}')/IntegrationDesigntimeArtifacts?$filter=ArtifactType eq '${type}'`
            )
      )
    );

    const combined = [];
    for (let i = 0; i < artifactTypes.length; i++) {
      const outcome = responses[i];
      if (outcome.status === 'fulfilled') {
        const items = outcome.value.data?.d?.results || outcome.value.data?.value || [];
        for (const item of items) {
          combined.push({ ...item, artifactType: artifactTypes[i] });
        }
      }
    }

    return res.json({ success: true, results: combined });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/packages/:packageId/all-artifacts');
  }
});

// -- Deploy / Undeploy generic artifacts --

app.post('/api/cpi/artifacts/deploy', async (req, res) => {
  try {
    const id = req.body?.id;
    const version = req.body?.version || 'active';
    if (!id) {
      return res.status(400).json({ success: false, error: 'id is required' });
    }
    const { data } = await cpiClient.post(
      `/api/v1/DeployIntegrationDesigntimeArtifact?Id='${id}'&Version='${version}'`,
      null,
      { headers: { 'Content-Type': 'application/json' } }
    );
    return res.json({ success: true, results: data });
  } catch (error) {
    return handleError(res, error, 'POST /api/cpi/artifacts/deploy');
  }
});

app.delete('/api/cpi/artifacts/undeploy/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await cpiClient.delete(`/api/v1/IntegrationRuntimeArtifacts('${id}')`);
    return res.json({ success: true, message: `Artifact '${id}' undeployed.` });
  } catch (error) {
    return handleError(res, error, 'DELETE /api/cpi/artifacts/undeploy/:id');
  }
});

// ======================================================
// Cross-package artifact search + bulk deploy/undeploy
//
// CPI cannot help here: the design-time artifact collection is only
// reachable through a package navigation, $filter returns 501 on
// IntegrationPackages, and $search is rejected outright. So the index
// below enumerates packages, fans out one request each, and caches the
// flattened result; matching then happens in memory.
// ======================================================

const ARTIFACT_TYPES = ['IFlow', 'ValueMapping', 'MessageMapping', 'ScriptCollection', 'FunctionLibrary'];
const ARTIFACT_INDEX_KEY = 'artifact_index';

async function buildArtifactIndex() {
  const cached = cache.get(ARTIFACT_INDEX_KEY);
  if (cached !== undefined) return cached;

  const packages = await fetchPackages();

  // allSettled so one inaccessible package cannot blank the whole index.
  const perPackage = await Promise.allSettled(
    packages.map((pkg) => {
      const id = pkg.Id || pkg.id;
      return cpiClient
        .get(`/api/v1/IntegrationPackages('${id}')/IntegrationDesigntimeArtifacts`)
        .then((r) => ({ items: toArray(r.data) }));
    })
  );

  const artifacts = [];
  const failedPackages = [];

  perPackage.forEach((outcome, i) => {
    const pkg = packages[i];
    const packageId = pkg.Id || pkg.id || '';
    if (outcome.status !== 'fulfilled') {
      failedPackages.push(packageId);
      return;
    }
    for (const item of outcome.value.items) {
      // ArtifactType is absent on some tenants; IFlow is the practical default.
      const type = item.Type || item.ArtifactType || 'IFlow';
      artifacts.push({
        id: item.Id || '',
        name: item.Name || item.Id || '',
        type: ARTIFACT_TYPES.includes(type) ? type : 'IFlow',
        version: item.Version || 'active',
        description: item.Description || '',
        packageId,
        packageName: pkg.Name || packageId,
      });
    }
  });

  const index = {
    artifacts,
    packageCount: packages.length,
    failedPackages,
    builtAt: new Date().toISOString(),
  };
  cache.set(ARTIFACT_INDEX_KEY, index);
  return index;
}

// Supports * and ? wildcards. Space-separated terms must all match, which
// makes "batch s4" behave the way people expect from a search box.
function buildMatcher(query) {
  const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return null;

  const regexes = terms.map((term) => {
    const escaped = term.replace(/[.+^${}()|[\]\\]/g, (ch) => '\\' + ch);
    const pattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
    // A plain word matches anywhere; once a term carries a wildcard the user
    // is describing the whole value, so anchor it end to end.
    return /[*?]/.test(term) ? new RegExp('^' + pattern + '$') : new RegExp(pattern);
  });

  return (artifact) => {
    const haystacks = [artifact.name, artifact.id, artifact.packageName, artifact.description]
      .map((v) => String(v || '').toLowerCase());
    return regexes.every((re) => haystacks.some((h) => re.test(h)));
  };
}

app.get('/api/cpi/artifacts/search', async (req, res) => {
  try {
    if (String(req.query.refresh) === 'true') cache.del(ARTIFACT_INDEX_KEY);

    const q = String(req.query.q || '').trim();
    const type = String(req.query.type || 'ALL');
    const packageId = String(req.query.packageId || 'ALL');

    const index = await buildArtifactIndex();

    // Deployed state lets the UI show what an action would actually change.
    // Tenants without a provisioned runtime location simply lack it.
    let runtime = [];
    let runtimeAvailable = true;
    try {
      runtime = await fetchRuntimeArtifacts();
    } catch {
      runtimeAvailable = false;
    }
    const deployed = new Map(runtime.map((r) => [r.Id, r]));

    let results = index.artifacts;
    if (type !== 'ALL') results = results.filter((a) => a.type === type);
    if (packageId !== 'ALL') results = results.filter((a) => a.packageId === packageId);

    const matcher = buildMatcher(q);
    if (matcher) results = results.filter(matcher);

    results = results
      .map((a) => {
        const rt = deployed.get(a.id);
        return { ...a, deployed: Boolean(rt), deployedStatus: rt?.Status || null };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const counts = ARTIFACT_TYPES.reduce(
      (acc, t) => {
        acc[t] = index.artifacts.filter((a) => a.type === t).length;
        return acc;
      },
      { ALL: index.artifacts.length }
    );

    return res.json({
      success: true,
      count: results.length,
      totalIndexed: index.artifacts.length,
      counts,
      packages: [...new Map(index.artifacts.map((a) => [a.packageId, a.packageName])).entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      failedPackages: index.failedPackages,
      runtimeAvailable,
      builtAt: index.builtAt,
      results,
    });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/artifacts/search');
  }
});

// Bulk actions report per-artifact outcomes instead of failing the whole
// batch, so one bad artifact cannot hide what did and did not happen.
async function runBulkArtifactAction(items, action) {
  const outcomes = [];
  for (const item of items) {
    const id = typeof item === 'string' ? item : item?.id;
    const version = (typeof item === 'object' && item?.version) || 'active';
    if (!id) {
      outcomes.push({ id: null, ok: false, error: 'missing id' });
      continue;
    }
    try {
      if (action === 'deploy') {
        await cpiClient.post(
          `/api/v1/DeployIntegrationDesigntimeArtifact?Id='${id}'&Version='${version}'`,
          null,
          { headers: { 'Content-Type': 'application/json' } }
        );
      } else {
        await cpiClient.delete(`/api/v1/IntegrationRuntimeArtifacts('${id}')`);
      }
      outcomes.push({ id, ok: true });
    } catch (err) {
      const status = err?.response?.status;
      if (action === 'undeploy' && status === 404) {
        outcomes.push({ id, ok: false, skipped: true, error: 'not currently deployed' });
      } else {
        outcomes.push({ id, ok: false, error: cpiErrorMessage(err) });
      }
    }
  }
  return outcomes;
}

app.post('/api/cpi/artifacts/bulk-deploy', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.artifacts) ? req.body.artifacts : [];
    if (!items.length) {
      return res.status(400).json({ success: false, error: 'artifacts must be a non-empty array' });
    }
    const outcomes = await runBulkArtifactAction(items, 'deploy');
    cache.del('runtime_artifacts');
    const failed = outcomes.filter((o) => !o.ok && !o.skipped);
    return res.json({
      success: failed.length === 0,
      deployed: outcomes.filter((o) => o.ok).length,
      skipped: outcomes.filter((o) => o.skipped).length,
      failed: failed.length,
      outcomes,
    });
  } catch (error) {
    return handleError(res, error, 'POST /api/cpi/artifacts/bulk-deploy');
  }
});

app.post('/api/cpi/artifacts/bulk-undeploy', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.artifacts) ? req.body.artifacts : [];
    if (!items.length) {
      return res.status(400).json({ success: false, error: 'artifacts must be a non-empty array' });
    }
    const outcomes = await runBulkArtifactAction(items, 'undeploy');
    cache.del('runtime_artifacts');
    const failed = outcomes.filter((o) => !o.ok && !o.skipped);
    return res.json({
      success: failed.length === 0,
      undeployed: outcomes.filter((o) => o.ok).length,
      skipped: outcomes.filter((o) => o.skipped).length,
      failed: failed.length,
      outcomes,
    });
  } catch (error) {
    return handleError(res, error, 'POST /api/cpi/artifacts/bulk-undeploy');
  }
});

// -- 2. Security Materials --

app.get('/api/cpi/security/secure-parameters', async (req, res) => {
  try {
    const { data } = await cpiClient.get('/api/v1/SecureParameters');
    const results = data?.d?.results || data?.value || [];
    return res.json({ success: true, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/security/secure-parameters');
  }
});

app.post('/api/cpi/security/secure-parameters', async (req, res) => {
  try {
    const { ParameterName, Description, Value } = req.body || {};
    const { data } = await cpiClient.post('/api/v1/SecureParameters', { ParameterName, Description, Value }, {
      headers: { 'Content-Type': 'application/json' },
    });
    return res.json({ success: true, results: data });
  } catch (error) {
    return handleError(res, error, 'POST /api/cpi/security/secure-parameters');
  }
});

app.put('/api/cpi/security/secure-parameters/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { data } = await cpiClient.put(`/api/v1/SecureParameters('${name}')`, req.body, {
      headers: { 'Content-Type': 'application/json' },
    });
    return res.json({ success: true, results: data });
  } catch (error) {
    return handleError(res, error, 'PUT /api/cpi/security/secure-parameters/:name');
  }
});

app.delete('/api/cpi/security/secure-parameters/:name', async (req, res) => {
  try {
    const { name } = req.params;
    await cpiClient.delete(`/api/v1/SecureParameters('${name}')`);
    return res.json({ success: true, message: `SecureParameter '${name}' deleted.` });
  } catch (error) {
    return handleError(res, error, 'DELETE /api/cpi/security/secure-parameters/:name');
  }
});

app.get('/api/cpi/security/oauth-credentials', async (req, res) => {
  try {
    const { data } = await cpiClient.get('/api/v1/OAuthCredentials');
    const results = data?.d?.results || data?.value || [];
    return res.json({ success: true, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/security/oauth-credentials');
  }
});

app.post('/api/cpi/security/oauth-credentials', async (req, res) => {
  try {
    const { data } = await cpiClient.post('/api/v1/OAuthCredentials', req.body, {
      headers: { 'Content-Type': 'application/json' },
    });
    return res.json({ success: true, results: data });
  } catch (error) {
    return handleError(res, error, 'POST /api/cpi/security/oauth-credentials');
  }
});

app.delete('/api/cpi/security/oauth-credentials/:name', async (req, res) => {
  try {
    const { name } = req.params;
    await cpiClient.delete(`/api/v1/OAuthCredentials('${name}')`);
    return res.json({ success: true, message: `OAuthCredential '${name}' deleted.` });
  } catch (error) {
    return handleError(res, error, 'DELETE /api/cpi/security/oauth-credentials/:name');
  }
});

app.get('/api/cpi/security/certificate-mappings', async (req, res) => {
  try {
    const { data } = await cpiClient.get('/api/v1/CertificateUserMappings');
    const results = data?.d?.results || data?.value || [];
    return res.json({ success: true, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/security/certificate-mappings');
  }
});

app.get('/api/cpi/security/number-ranges', async (req, res) => {
  try {
    const { data } = await cpiClient.get('/api/v1/NumberRanges');
    const results = data?.d?.results || data?.value || [];
    return res.json({ success: true, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/security/number-ranges');
  }
});

app.post('/api/cpi/security/number-ranges', async (req, res) => {
  try {
    const { data } = await cpiClient.post('/api/v1/NumberRanges', req.body, {
      headers: { 'Content-Type': 'application/json' },
    });
    return res.json({ success: true, results: data });
  } catch (error) {
    return handleError(res, error, 'POST /api/cpi/security/number-ranges');
  }
});

app.put('/api/cpi/security/number-ranges/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { data } = await cpiClient.put(`/api/v1/NumberRanges('${name}')`, req.body, {
      headers: { 'Content-Type': 'application/json' },
    });
    return res.json({ success: true, results: data });
  } catch (error) {
    return handleError(res, error, 'PUT /api/cpi/security/number-ranges/:name');
  }
});

app.delete('/api/cpi/security/number-ranges/:name', async (req, res) => {
  try {
    const { name } = req.params;
    await cpiClient.delete(`/api/v1/NumberRanges('${name}')`);
    return res.json({ success: true, message: `NumberRange '${name}' deleted.` });
  } catch (error) {
    return handleError(res, error, 'DELETE /api/cpi/security/number-ranges/:name');
  }
});

app.get('/api/cpi/security/access-policies', async (req, res) => {
  try {
    const { data } = await cpiClient.get('/api/v1/AccessPolicies');
    const results = data?.d?.results || data?.value || [];
    return res.json({ success: true, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/security/access-policies');
  }
});

app.post('/api/cpi/security/access-policies', async (req, res) => {
  try {
    const { data } = await cpiClient.post('/api/v1/AccessPolicies', req.body, {
      headers: { 'Content-Type': 'application/json' },
    });
    return res.json({ success: true, results: data });
  } catch (error) {
    return handleError(res, error, 'POST /api/cpi/security/access-policies');
  }
});

app.delete('/api/cpi/security/access-policies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await cpiClient.delete(`/api/v1/AccessPolicies('${id}')`);
    return res.json({ success: true, message: `AccessPolicy '${id}' deleted.` });
  } catch (error) {
    return handleError(res, error, 'DELETE /api/cpi/security/access-policies/:id');
  }
});

// -- 3. Operational APIs --

app.get('/api/cpi/datastores', async (req, res) => {
  try {
    const { data } = await cpiClient.get('/api/v1/DataStores');
    const results = data?.d?.results || data?.value || [];
    return res.json({ success: true, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/datastores');
  }
});

app.get('/api/cpi/datastores/:name/entries', async (req, res) => {
  try {
    const { name } = req.params;
    const { data } = await cpiClient.get(`/api/v1/DataStores('${name}')/Entries`);
    const results = data?.d?.results || data?.value || [];
    return res.json({ success: true, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/datastores/:name/entries');
  }
});

app.delete('/api/cpi/datastores/:name/entries/:id', async (req, res) => {
  try {
    const { name, id } = req.params;
    await cpiClient.delete(`/api/v1/DataStoreEntries(DataStoreName='${name}',Id='${id}')`);
    return res.json({ success: true, message: `DataStore entry '${id}' deleted from '${name}'.` });
  } catch (error) {
    return handleError(res, error, 'DELETE /api/cpi/datastores/:name/entries/:id');
  }
});

app.get('/api/cpi/message-store-entries', async (req, res) => {
  try {
    const top = req.query.$top ? `?$top=${encodeURIComponent(req.query.$top)}` : '';
    const { data } = await cpiClient.get(`/api/v1/MessageStoreEntries${top}`);
    const results = data?.d?.results || data?.value || [];
    return res.json({ success: true, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/message-store-entries');
  }
});

app.get('/api/cpi/variables', async (req, res) => {
  try {
    const { data } = await cpiClient.get('/api/v1/Variables');
    const results = data?.d?.results || data?.value || [];
    return res.json({ success: true, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/variables');
  }
});

app.delete('/api/cpi/variables/:flowId/:varName', async (req, res) => {
  try {
    const { flowId, varName } = req.params;
    await cpiClient.delete(`/api/v1/Variables(FlowId='${flowId}',VariableName='${varName}')`);
    return res.json({ success: true, message: `Variable '${varName}' in flow '${flowId}' deleted.` });
  } catch (error) {
    return handleError(res, error, 'DELETE /api/cpi/variables/:flowId/:varName');
  }
});

app.get('/api/cpi/tenant-configurations', async (req, res) => {
  try {
    const { data } = await cpiClient.get('/api/v1/TenantConfigurations');
    const results = data?.d?.results || data?.value || [];
    return res.json({ success: true, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/tenant-configurations');
  }
});

app.get('/api/cpi/jms-brokers', async (req, res) => {
  try {
    const { data } = await cpiClient.get('/api/v1/JmsBrokers');
    const results = data?.d?.results || data?.value || [];
    return res.json({ success: true, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/jms-brokers');
  }
});

app.get('/api/cpi/log-files', async (req, res) => {
  try {
    const { data } = await cpiClient.get('/api/v1/LogFiles');
    const results = data?.d?.results || data?.value || [];
    return res.json({ success: true, results });
  } catch (error) {
    return handleError(res, error, 'GET /api/cpi/log-files');
  }
});

// -- 4. Import ZIP to CPI --

app.post('/api/cpi/import-zip', upload.single('zipFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'zipFile is required' });
    }

    const packageId   = String(req.body?.packageId   || '').trim();
    const artifactId  = String(req.body?.artifactId  || '').trim();
    const artifactName = String(req.body?.artifactName || '').trim();
    const artifactType = String(req.body?.artifactType || 'IFlow').trim();

    if (!packageId || !artifactId || !artifactName) {
      return res.status(400).json({ success: false, error: 'packageId, artifactId, and artifactName are required' });
    }

    const zipBuffer = fs.readFileSync(req.file.path);
    const zipBase64 = zipBuffer.toString('base64');

    // Fetch CSRF token — required for OData write operations on SAP CPI
    let csrfToken = '';
    try {
      const csrfRes = await cpiClient.get('/api/v1/IntegrationDesigntimeArtifacts?$top=1', {
        headers: { 'X-CSRF-Token': 'Fetch' },
      });
      csrfToken = csrfRes.headers['x-csrf-token'] || '';
    } catch { /* non-fatal */ }

    const jsonHeaders = {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    };

    // Check if artifact already exists
    let artifactExists = false;
    try {
      await cpiClient.get(
        `/api/v1/IntegrationDesigntimeArtifacts(Id='${encodeURIComponent(artifactId)}',Version='active')`
      );
      artifactExists = true;
    } catch { /* 404 = doesn't exist */ }

    let cpiResponse;
    if (artifactExists) {
      // UPDATE existing artifact — PUT ArtifactContent as base64 JSON
      const r = await cpiClient.put(
        `/api/v1/IntegrationDesigntimeArtifacts(Id='${encodeURIComponent(artifactId)}',Version='active')`,
        { Name: artifactName, ArtifactContent: zipBase64 },
        { headers: jsonHeaders }
      );
      cpiResponse = { status: r.status, data: r.data, action: 'update' };
    } else {
      // CREATE new artifact — POST with JSON + base64 ArtifactContent
      try {
        const r = await cpiClient.post(
          `/api/v1/IntegrationDesigntimeArtifacts`,
          { Id: artifactId, Name: artifactName, PackageId: packageId, ArtifactContent: zipBase64 },
          { headers: jsonHeaders, maxBodyLength: Infinity, maxContentLength: Infinity }
        );
        cpiResponse = { status: r.status, data: r.data, action: 'create' };
      } catch (createErr) {
        const errStatus = createErr.response?.status;
        const errData   = createErr.response?.data;
        const errMsg    = errData?.error?.message?.value || errData?.message || errData?.error || createErr.message;
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        if (errStatus === 403) {
          return res.status(403).json({
            success: false,
            error: `SAP CPI does not allow creating new artifacts via API on this tenant. Please create a blank iFlow named "${artifactId}" inside package "${packageId}" in SAP Integration Suite first, then import again to overwrite it.`,
          });
        }
        return res.status(errStatus || 502).json({ success: false, error: errMsg, cpiStatus: errStatus });
      }
    }

    console.log('[import-zip] CPI response:', cpiResponse.action, cpiResponse.status);

    // Clean up temp file
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.json({
      success: true,
      message: `Artifact '${artifactId}' ${artifactExists ? 'updated' : 'created'} in package '${packageId}'.`,
      cpiStatus: cpiResponse.status,
      cpiData: cpiResponse.data,
    });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return handleError(res, error, 'POST /api/cpi/import-zip');
  }
});

// ====== END NEW ARTIFACT & OPERATIONS ROUTES ======

// ======================================================
// 404 + global error (must be AFTER all routes)
// ======================================================

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

app.use((err, _req, res, _next) => {
  console.error('[GLOBAL ERROR]', err.stack || err.message);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ======================================================
// Startup
// ======================================================

app.listen(PORT, () => {
  console.log(`SAP CPI AI Backend running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  console.log(`Docs  : http://localhost:${PORT}/api/docs`);

  if (GENERATED_BACKEND_API_KEY) {
    console.log(
      'Temporary BACKEND_API_KEY generated. Set BACKEND_API_KEY in .env for permanent use.'
    );
  }
});