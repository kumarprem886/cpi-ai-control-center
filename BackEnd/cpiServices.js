import axios from 'axios';

const MPL_TOP = Number(process.env.MPL_TOP || 300);
const CERT_ALERT_DAYS = Number(process.env.CERT_ALERT_DAYS || 30);

const cpiClient = axios.create({
  baseURL: process.env.CPI_BASE_URL || '',
  auth: {
    username: process.env.CPI_USERNAME || '',
    password: process.env.CPI_PASSWORD || '',
  },
  timeout: 30000,
  headers: { Accept: 'application/json' },
});

function toArray(data) {
  if (Array.isArray(data)) return data;
  return data?.d?.results || data?.value || [];
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
  const candidates = [
    item.DurationInMs,
    item.Duration,
    item.ProcessingTimeInMs,
    item.ResponseTime,
    item.TotalProcessingTime,
  ];

  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
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

export async function fetchRuntimeArtifacts() {
  const { data } = await cpiClient.get('/api/v1/IntegrationRuntimeArtifacts');
  return toArray(data);
}

export async function fetchPackages() {
  const { data } = await cpiClient.get('/api/v1/IntegrationPackages');
  return toArray(data);
}

export async function fetchMessageProcessingLogs(
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

  const url = `/api/v1/MessageProcessingLogs?$top=${encodeURIComponent(
    top
  )}&$orderby=LogStart desc${filterQuery}`;

  const { data } = await cpiClient.get(url);
  return toArray(data);
}

export async function fetchKeystoreEntries() {
  const { data } = await cpiClient.get('/api/v1/KeystoreEntries');
  return toArray(data);
}

export async function fetchCredentials() {
  const { data } = await cpiClient.get('/api/v1/UserCredentials');
  return toArray(data);
}

export async function countDeployedIflows() {
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

export async function listDeployedIflows(limit = 200) {
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

export async function getSlowestIflows(top = 5, mplTop = MPL_TOP) {
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
  };
}

export async function getExpiringCertificates(withinDays = CERT_ALERT_DAYS) {
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

export async function getFailedMessages(top = 20) {
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

export async function getSummary() {
  const [packages, runtime, logs] = await Promise.all([
    fetchPackages(),
    fetchRuntimeArtifacts(),
    fetchMessageProcessingLogs(Math.min(MPL_TOP, 200)),
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
export async function deployIflow(iflowId) {
  // SAP CPI deploy API
  const { data } = await cpiClient.post(
    `/api/v1/DeployIntegrationDesigntimeArtifact?Id='${encodeURIComponent(iflowId)}'&Version='active'`
  );
  return data;
}

export async function undeployIflow(iflowId) {
  // SAP CPI undeploy = DELETE runtime artifact
  const { data } = await cpiClient.delete(
    `/api/v1/IntegrationRuntimeArtifacts('${encodeURIComponent(iflowId)}')`
  );
  return data;
}

export async function batchDeploy(iflowIds) {
  const results = [];
  for (const id of iflowIds) {
    try {
      await deployIflow(id.trim());
      results.push({ id, status: 'deployed', success: true });
    } catch (err) {
      const msg = err.response?.data?.error?.message?.value || err.response?.data?.message || err.message;
      results.push({ id, status: 'failed', success: false, error: msg });
    }
  }
  return results;
}

export async function batchUndeploy(iflowIds) {
  const results = [];
  for (const id of iflowIds) {
    try {
      await undeployIflow(id.trim());
      results.push({ id, status: 'undeployed', success: true });
    } catch (err) {
      const msg = err.response?.data?.error?.message?.value || err.response?.data?.message || err.message;
      results.push({ id, status: 'failed', success: false, error: msg });
    }
  }
  return results;
}

export async function whereUsed(alias) {
  const packages = await fetchPackages();
  const matches = [];

  const aliasLower = String(alias || '').toLowerCase().trim();

  for (const pkg of packages) {
    const pkgId = pkg.Id || pkg.id;
    if (!pkgId) continue;

    let iflows = [];
    try {
      const { data } = await cpiClient.get(
        `/api/v1/IntegrationPackages('${encodeURIComponent(pkgId)}')/IntegrationDesigntimeArtifacts`
      );
      iflows = toArray(data);
    } catch { continue; }

    for (const iflow of iflows) {
      const iflowId = iflow.Id || iflow.id;
      const iflowName = iflow.Name || iflow.name || iflowId;
      if (!iflowId) continue;

      let configs = [];
      try {
        const { data: cfgData } = await cpiClient.get(
          `/api/v1/IntegrationDesigntimeArtifacts(Id='${encodeURIComponent(iflowId)}',Version='active')/Configurations`
        );
        configs = toArray(cfgData);
      } catch { /* no configs or access denied — skip */ }

      const found = configs.some(c => {
        const val = String(c.Value || c.value || '').toLowerCase();
        const key = String(c.ParameterKey || c.Key || c.key || '').toLowerCase();
        return val.includes(aliasLower) || key.includes(aliasLower);
      });

      if (found) {
        const usedIn = configs
          .filter(c => String(c.Value || c.value || '').toLowerCase().includes(aliasLower))
          .map(c => ({ parameter: c.ParameterKey || c.Key || c.key, value: c.Value || c.value }));

        matches.push({
          package: pkg.Name || pkgId,
          packageId: pkgId,
          iflow: iflowName,
          iflowId,
          usedIn,
        });
      }
    }
  }

  return {
    operation: 'where_used',
    alias,
    count: matches.length,
    matches,
  };
}
