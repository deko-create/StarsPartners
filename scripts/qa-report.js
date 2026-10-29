const fs = require('fs');
const path = require('path');
const { URL, pathToFileURL } = require('url');
const { chromium } = require('playwright');
const { resolveProjectPaths } = require('../tests/helpers/project-paths');
const { sanitizeArtifactTree } = require('./lib/sanitize-artifact-tree');
const { redactText } = require('./lib/redact-secrets');

const cwd = process.cwd();
const baseUrl = process.env.BASE_URL || 'https://gt.bet/';
const projectPaths = resolveProjectPaths({ cwd, baseUrl });
const brandName = (() => {
  try {
    return new URL(baseUrl).hostname || 'brand';
  } catch {
    return 'brand';
  }
})();
const brandSlug =
  String(brandName)
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'brand';
const softPrecheckMode =
  process.env.QA_SOFT_PRECHECK_MODE === '1' || process.env.PW_PRECHECK_SOFT === '1';
const reportDir = projectPaths.testResultsDir;
const artifactsDir = path.join(projectPaths.artifactsDir, 'phase-reports');
const reportPath = path.join(reportDir, 'report.json');
const phaseReportCandidates = [
  {
    phase: 'precheck',
    paths: [
      path.join(artifactsDir, 'precheck-report.json'),
      path.join(reportDir, 'precheck-report.json'),
    ],
  },
  {
    phase: 'home',
    paths: [path.join(artifactsDir, 'home-report.json'), path.join(reportDir, 'home-report.json')],
  },
  {
    phase: 'registration',
    paths: [
      path.join(artifactsDir, 'registration-report.json'),
      path.join(reportDir, 'registration-report.json'),
    ],
  },
  {
    phase: 'auth',
    paths: [path.join(artifactsDir, 'auth-report.json'), path.join(reportDir, 'auth-report.json')],
  },
  {
    phase: 'profile',
    paths: [
      path.join(artifactsDir, 'profile-report.json'),
      path.join(reportDir, 'profile-report.json'),
    ],
  },
  {
    phase: 'deposit',
    paths: [
      path.join(artifactsDir, 'deposit-report.json'),
      path.join(reportDir, 'deposit-report.json'),
    ],
  },
  {
    phase: 'withdraw',
    paths: [
      path.join(artifactsDir, 'withdraw-report.json'),
      path.join(reportDir, 'withdraw-report.json'),
    ],
  },
  {
    phase: 'sidebar',
    paths: [
      path.join(artifactsDir, 'sidebar-report.json'),
      path.join(reportDir, 'sidebar-report.json'),
    ],
  },
  {
    phase: 'sports',
    paths: [
      path.join(artifactsDir, 'sports-report.json'),
      path.join(reportDir, 'sports-report.json'),
    ],
  },
  {
    phase: 'casino',
    paths: [
      path.join(artifactsDir, 'casino-report.json'),
      path.join(reportDir, 'casino-report.json'),
    ],
  },
  {
    phase: 'livecasino',
    paths: [
      path.join(artifactsDir, 'livecasino-report.json'),
      path.join(reportDir, 'livecasino-report.json'),
    ],
  },
  {
    phase: 'security',
    paths: [
      path.join(artifactsDir, 'security-report.json'),
      path.join(reportDir, 'security-report.json'),
    ],
  },
  {
    phase: 'contracts',
    paths: [
      path.join(artifactsDir, 'contracts-report.json'),
      path.join(reportDir, 'contracts-report.json'),
    ],
  },
  {
    phase: 'nightlyextras',
    paths: [
      path.join(artifactsDir, 'nightlyextras-report.json'),
      path.join(reportDir, 'nightlyextras-report.json'),
    ],
  },
  {
    phase: 'a11y',
    paths: [path.join(artifactsDir, 'a11y-report.json'), path.join(reportDir, 'a11y-report.json')],
  },
  {
    phase: 'visual',
    paths: [
      path.join(artifactsDir, 'visual-report.json'),
      path.join(reportDir, 'visual-report.json'),
    ],
  },
  {
    phase: 'main',
    paths: [path.join(artifactsDir, 'main-report.json'), path.join(reportDir, 'main-report.json')],
  },
  {
    phase: 'destructive',
    paths: [
      path.join(artifactsDir, 'destructive-report.json'),
      path.join(reportDir, 'destructive-report.json'),
    ],
  },
];

const outPath = path.join(projectPaths.projectRoot, 'qa-report.md');
const outHtmlPath = path.join(projectPaths.projectRoot, 'qa-report.html');
const analyzeOutPath = path.join(projectPaths.analyzeDir, 'qa-report.md');
const analyzeOutHtmlPath = path.join(projectPaths.analyzeDir, 'qa-report.html');
const autotestReportDir = projectPaths.autotestReportDir;
sanitizeArtifactTree(autotestReportDir);
sanitizeArtifactTree(artifactsDir);
sanitizeArtifactTree(path.join(projectPaths.artifactsDir, 'phase-test-results'));
const brandOutPath = path.join(autotestReportDir, `${brandSlug}.md`);
const brandOutHtmlPath = path.join(autotestReportDir, `${brandSlug}.html`);
const brandOutPdfPath = path.join(autotestReportDir, `${brandSlug}.pdf`);

const registrationCurrentRunPath = path.join(
  projectPaths.artifactsDir,
  'registration-data-current-run.json'
);
const registrationCandidates = [
  registrationCurrentRunPath,
  path.join(projectPaths.testResultsDir, 'registration-data.json'),
  path.join(projectPaths.artifactsDir, 'last-registered-player.json'),
];
const manualLoginPlayerPath = path.join(projectPaths.artifactsDir, 'last-manual-login-player.json');
const registrationNetworkPath = path.join(projectPaths.testResultsDir, 'registration-network.json');
const providerMatrixPath = path.join(
  autotestReportDir,
  'casino',
  'providers-real',
  'providers-real-matrix.json'
);
const providerInventoryPath = path.join(
  autotestReportDir,
  'casino',
  'providers-real',
  'providers-inventory.json'
);
const depositInventoryArtifactPath = path.join(
  autotestReportDir,
  'deposit',
  'deposit-inventory.json'
);
const depositArtifactPath = path.join(autotestReportDir, 'deposit', 'deposit-non-destructive.json');
const authStateHealthArtifactPath = path.join(projectPaths.artifactsDir, 'auth-state-health.json');
const kpiValidationArtifactPath = path.join(projectPaths.artifactsDir, 'kpi-validation.json');
const executionJournalArtifactPath = path.join(projectPaths.artifactsDir, 'run-execution.json');

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

const reportCompact = String(process.env.QA_REPORT_COMPACT || '1')
  .trim()
  .toLowerCase();
const reportCompactMode = !['0', 'false', 'no', 'off'].includes(reportCompact);
const configuredExecutionMode = String(
  process.env.QA_EXECUTION_MODE || process.env.PW_PROJECT_MATRIX || ''
)
  .trim()
  .toLowerCase();
const includeReportGuide = (() => {
  const raw = String(process.env.QA_REPORT_INCLUDE_GUIDE || '1')
    .trim()
    .toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
})();
const sectionDetailRowsLimit = parsePositiveInt(
  process.env.QA_REPORT_SECTION_ROWS,
  reportCompactMode ? 0 : 200
);
const providerMatrixRowsLimit = parsePositiveInt(
  process.env.QA_REPORT_PROVIDER_ROWS,
  reportCompactMode ? (configuredExecutionMode === 'mobile' ? 8 : 9) : 5000
);

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readCurrentRunJson(filePath) {
  const payload = readJson(filePath);
  const expectedRunId = String(process.env.QA_RUN_ID || '').trim();
  if (!payload || !expectedRunId || process.env.QA_REPORT_ONLY === '1') return payload;
  return String(payload.runId || '').trim() === expectedRunId ? payload : null;
}

function readPreviousComparableRun(historyDir, currentRunId, currentTimestamp) {
  try {
    if (!fs.existsSync(historyDir)) return null;
    const currentTime = Date.parse(currentTimestamp || '') || Date.now();
    return (
      fs
        .readdirSync(historyDir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => readJson(path.join(historyDir, name)))
        .filter(Boolean)
        .filter((entry) => !currentRunId || String(entry.runId || '') !== String(currentRunId))
        .filter((entry) => {
          const timestamp = Date.parse(entry.timestamp || '');
          return Number.isFinite(timestamp) && timestamp < currentTime;
        })
        .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0] || null
    );
  } catch {
    return null;
  }
}

function signedDelta(currentValue, previousValue) {
  const current = Number(currentValue);
  const previous = Number(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return current - previous;
}

function formatSignedNumber(value) {
  if (!Number.isFinite(value)) return '-';
  if (value === 0) return '0';
  return `${value > 0 ? '+' : ''}${value}`;
}

function findKpiCheck(kpi, id) {
  const checks = Array.isArray(kpi && kpi.checks) ? kpi.checks : [];
  return checks.find((item) => item && item.id === id) || null;
}

function readFirstJson(paths) {
  for (const filePath of paths) {
    const data = readJson(filePath);
    if (data) return { data, path: filePath };
  }
  return { data: null, path: null };
}

function isManualLoginReadyPlayer(data) {
  if (!data || typeof data !== 'object') return false;
  const email = oneLine(data.email || '');
  const password = oneLine(data.password || '');
  const status = String(data.loginValidationStatus || '')
    .trim()
    .toLowerCase();
  return Boolean(
    email && password && data.manualLoginReady === true && status === 'password-signin-ok'
  );
}

function loadReportSources() {
  const phaseSources = phaseReportCandidates
    .map((entry) => {
      for (const candidatePath of entry.paths) {
        const data = readJson(candidatePath);
        if (data) {
          return { phase: entry.phase, path: candidatePath, data };
        }
      }
      return null;
    })
    .filter(Boolean);

  if (phaseSources.length) return phaseSources;

  const fallback = readJson(reportPath);
  if (fallback) {
    return [{ phase: 'latest', path: reportPath, data: fallback }];
  }

  console.error(`JSON report not found: ${reportPath}`);
  process.exit(1);
}

function stripAnsi(value) {
  const input = String(value || '');
  let output = '';
  let i = 0;

  while (i < input.length) {
    const charCode = input.charCodeAt(i);
    if (charCode === 27) {
      i += 1;
      if (input[i] === '[') {
        i += 1;
        while (i < input.length) {
          const code = input.charCodeAt(i);
          if (code >= 64 && code <= 126) {
            i += 1;
            break;
          }
          i += 1;
        }
      }
      continue;
    }

    output += input[i];
    i += 1;
  }

  return output;
}

function uniquePathParts(parts) {
  const unique = [];
  for (const part of parts || []) {
    const text = oneLine(part);
    if (!text) continue;
    if (unique[unique.length - 1] !== text) unique.push(text);
  }
  return unique;
}

function collectAnnotations(test, results) {
  const seen = new Set();
  const annotations = [];
  const raw = [
    ...(Array.isArray(test.annotations) ? test.annotations : []),
    ...results.flatMap((result) => (Array.isArray(result.annotations) ? result.annotations : [])),
  ];

  for (const annotation of raw) {
    const type = oneLine(annotation && annotation.type ? annotation.type : 'note') || 'note';
    const description = oneLine(
      stripAnsi(annotation && annotation.description ? annotation.description : '')
    );
    const key = `${type}::${description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    annotations.push({ type, description });
  }

  return annotations;
}

function collectResultSteps(steps, depth = 0, acc = []) {
  for (const step of Array.isArray(steps) ? steps : []) {
    const title = oneLine(step && step.title ? step.title : 'Untitled step');
    const error = oneLine((step && step.error && (step.error.message || step.error.value)) || '');
    acc.push({
      title,
      depth,
      duration: Number((step && step.duration) || 0),
      status: error ? 'FAILED' : 'PASSED',
      error,
    });
    collectResultSteps(step && step.steps, depth + 1, acc);
  }
  return acc;
}

function collectTests(suite, phase, acc = [], suitePath = []) {
  if (!suite) return acc;
  const nextSuitePath = suite.title ? [...suitePath, suite.title] : suitePath;

  if (Array.isArray(suite.specs)) {
    for (const spec of suite.specs) {
      const specFile = spec.file || spec.location?.file || '';
      const specTitle = oneLine(spec.title || '');
      const specPath = uniquePathParts([...nextSuitePath, specTitle]);

      for (const t of spec.tests || []) {
        const title = t.title || specTitle || '(untitled)';
        const results = Array.isArray(t.results) ? t.results : [];
        const annotations = collectAnnotations(t, results);
        const final = results[results.length - 1] || {};
        const explicitTitlePath = Array.isArray(t.titlePath)
          ? uniquePathParts(t.titlePath)
          : uniquePathParts([...specPath, t.title]);
        const titlePath = explicitTitlePath.join(' > ') || title;
        const duration = results.reduce((sum, result) => sum + Number(result.duration || 0), 0);
        const steps = collectResultSteps(final.steps);

        acc.push({
          phase,
          title,
          titlePath,
          status: final.status || t.status || 'unknown',
          expectedStatus: t.expectedStatus || 'passed',
          projectName: oneLine(t.projectName || final.projectName || t.projectId || ''),
          location: t.location || spec.location || {},
          file: specFile,
          duration: duration || Number(final.duration || 0),
          retries: Math.max(0, results.length - 1),
          error:
            final.error?.message ||
            final.errors?.[0]?.message ||
            results
              .flatMap((result) => result.errors || [])
              .map((error) => error?.message || '')
              .find(Boolean) ||
            '',
          attachments: Array.isArray(final.attachments) ? final.attachments : [],
          annotations,
          steps,
        });
      }
    }
  }

  if (Array.isArray(suite.suites)) {
    for (const child of suite.suites) collectTests(child, phase, acc, nextSuitePath);
  }

  return acc;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)} s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(1);
  return `${mins}m ${secs}s`;
}

function formatPercent(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return '-';
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function oneLine(value) {
  return redactText(value).replace(/\s+/g, ' ').trim();
}

function credentialValue(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
}

function reportPasswordValue(value) {
  const password = credentialValue(value);
  if (!password) return '';
  return process.env.QA_REPORT_INCLUDE_PLAYER_PASSWORD === '1'
    ? password
    : 'Скрыт (доступен только в приватном отчёте)';
}

const NOTE_TEXT_LIMIT = 180;
const TOP_REASON_TEXT_LIMIT = 140;

function truncateText(value, limit = NOTE_TEXT_LIMIT) {
  const text = oneLine(value);
  if (!text) return '';
  const safeLimit = Math.max(24, Number(limit || NOTE_TEXT_LIMIT));
  return text.length > safeLimit ? `${text.slice(0, safeLimit - 3)}...` : text;
}

function normalizeReason(value, limit = TOP_REASON_TEXT_LIMIT) {
  const raw = oneLine(stripAnsi(value || ''));
  if (!raw) return '';
  const pipedChunks = raw
    .split('|')
    .map((item) => oneLine(item))
    .filter(Boolean);
  const compactRaw = pipedChunks.length >= 2 ? `${pipedChunks[0]} ...` : raw;
  const lowered = compactRaw.toLowerCase();

  if (
    /cloudflare|cf_chl|__cf_chl|just a moment|challenge url detected|challenge text visible/.test(
      lowered
    )
  ) {
    return 'Cloudflare/WAF challenge gate';
  }
  if (/captcha/.test(lowered)) {
    return 'Captcha gate';
  }
  if (
    /provider .* did not pass non-demo launch\/health checks|non-demo launch\/health checks/.test(
      lowered
    )
  ) {
    return 'Provider non-demo launch/health check did not pass';
  }
  if (/credentials_not_valid|wrong login or password/.test(lowered)) {
    return 'Credentials not valid';
  }
  if (/blocked by product|product blocked/.test(lowered)) {
    return 'Product surface blocked';
  }
  if (/authorized sidebar primary navigation|authorized sidebar home/.test(lowered)) {
    return 'Authorized sidebar items blocked (layout/challenge)';
  }
  if (/storagestate|auth state/.test(lowered)) {
    return 'Auth state/storage issue';
  }

  const withNormalizedUrls = compactRaw.replace(/https?:\/\/[^\s|,)]+/gi, (urlValue) => {
    try {
      const parsed = new URL(urlValue);
      return `${parsed.hostname}${parsed.pathname || '/'}`.replace(/\/{2,}/g, '/');
    } catch {
      return 'url';
    }
  });

  const withMaskedTokens = withNormalizedUrls
    .replace(/[A-Za-z0-9._-]{24,}/g, '<token>')
    .replace(/\b\d{7,}\b/g, '<num>');

  return truncateText(withMaskedTokens, limit);
}

function translateProviderNote(value) {
  const note = normalizeReason(value || '-') || '-';
  const exact = new Map([
    ['Cloudflare/WAF challenge gate', 'Защитная проверка Cloudflare/WAF'],
    ['Captcha gate', 'Проверка Captcha'],
    [
      'Provider non-demo launch/health check did not pass',
      'Проверка запуска провайдера без demo не пройдена',
    ],
    ['Credentials not valid', 'Учётные данные недействительны'],
    ['Product surface blocked', 'Интерфейс продукта заблокирован'],
    [
      'Authorized sidebar items blocked (layout/challenge)',
      'Пункты авторизованного меню недоступны из-за интерфейса или challenge',
    ],
    ['Auth state/storage issue', 'Проблема auth state или storage'],
    ['Challenge text is visible.', 'Обнаружен текст защитной проверки'],
  ]);
  if (exact.has(note)) return exact.get(note);

  return note
    .replace(
      /No game cards found for provider\s+["“]?([^"”]+)["”]?\.?/i,
      'Карточки игр провайдера «$1» не найдены.'
    )
    .replace(/Filter panel not visible\.?/gi, 'Панель фильтров не отображается.')
    .replace(
      /Demo-mode action button is not visible on first game cards\.?/gi,
      'Кнопка demo не отображается на первых карточках игр.'
    )
    .replace(
      /Demo availability was not collected in this run\.?/gi,
      'Доступность demo не была собрана в этом прогоне.'
    )
    .replace(
      /No demo games found in sampled games API response for provider\.?/gi,
      'В выборке ответа games API не найдены demo-игры провайдера.'
    );
}

function formatPathForDisplay(filePath) {
  if (!filePath) return '-';
  const rel = oneLine(toRelative(filePath));
  return rel || oneLine(filePath) || '-';
}

function formatLocation(test) {
  const loc = (test && test.location) || {};
  const file = formatPathForDisplay(loc.file || test.file || '');
  const line = Number(loc.line || 0);
  return line > 0 ? `${file}:${line}` : file;
}

function escapeMdCell(value) {
  return redactText(value === undefined || value === null || value === '' ? '-' : value)
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')
    .trim();
}

function escapeCredentialMdCell(value) {
  return String(value === undefined || value === null || value === '' ? '-' : value)
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')
    .trim();
}

function toRelative(filePath) {
  if (!filePath) return '';
  return path.relative(cwd, filePath) || filePath;
}

function escapeHtml(value) {
  return redactText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeCredentialHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isFailureStatus(status) {
  return ['failed', 'timedOut', 'interrupted'].includes(status);
}

function getStatusTotals(tests) {
  const failedTests = tests.filter((t) => isFailureStatus(t.status));
  const failedInfraBlocked = failedTests.filter((t) => {
    const productBlocked = (t.annotations || []).some(
      (ann) => String(ann.type || '').toLowerCase() === 'product-blocked'
    );
    return (
      !productBlocked &&
      (String(t.status || '') === 'timedOut' ||
        (t.annotations || []).some((ann) =>
          ['infra-blocked', 'test-infra-timeout'].includes(String(ann.type || '').toLowerCase())
        ))
    );
  }).length;
  const failedProductBlocked = failedTests.filter((t) =>
    (t.annotations || []).some((ann) => String(ann.type || '').toLowerCase() === 'product-blocked')
  ).length;
  const failedUnclassified = failedTests.filter((t) => {
    const hasInfra = (t.annotations || []).some(
      (ann) => String(ann.type || '').toLowerCase() === 'infra-blocked'
    );
    const hasProduct = (t.annotations || []).some(
      (ann) => String(ann.type || '').toLowerCase() === 'product-blocked'
    );
    return !hasInfra && !hasProduct && String(t.status || '') !== 'timedOut';
  }).length;

  return {
    total: tests.length,
    passed: tests.filter((t) => t.status === 'passed').length,
    failed: failedTests.length,
    failedInfraBlocked,
    failedProductBlocked,
    failedUnclassified,
    skipped: tests.filter((t) => t.status === 'skipped').length,
    flaky: tests.filter((t) => t.status === 'flaky').length,
  };
}

function getRunStatus(totals) {
  if (totals.failed > 0) {
    const infraOnlyFailure =
      Number(totals.failedInfraBlocked || 0) === Number(totals.failed || 0) &&
      Number(totals.failedProductBlocked || 0) === 0 &&
      Number(totals.failedUnclassified || 0) === 0;
    return infraOnlyFailure ? 'INFRA_BLOCKED' : 'FAILED';
  }
  if (totals.total === 0) return 'NO_TESTS';
  if (totals.flaky > 0) return 'PASSED_WITH_FLAKY';
  if (totals.skipped > 0) return 'PASSED_WITH_SKIPS';
  return 'PASSED';
}

function isSoftPrecheckFailure(test) {
  if (!softPrecheckMode) return false;
  if (!test || typeof test !== 'object') return false;
  return String(test.phase || '').toLowerCase() === 'precheck' && isFailureStatus(test.status);
}

function statusRank(status) {
  const order = ['failed', 'flaky', 'skipped', 'timedOut', 'interrupted', 'passed'];
  const idx = order.indexOf(status);
  return idx === -1 ? order.length : idx;
}

function resolveSection(test) {
  const file = String(test.file || '').toLowerCase();
  const title = String(test.titlePath || test.title || '').toLowerCase();
  const haystack = `${file} ${title}`;

  if (/contract|schemathesis|spectral|openapi/.test(haystack)) return 'Contracts';
  if (/live chat|livechat|chat-widget/.test(haystack)) return 'Live Chat';
  if (/sidebar/.test(haystack)) return 'Sidebar';
  if (/signup|registration/.test(haystack)) return 'Registration';
  if (
    /profile-password-security|profile security|account details|security center|\/profile\//.test(
      haystack
    )
  )
    return 'My Profile';
  if (/login|auth|forgot password|forgot-password|reset password|password reset/.test(haystack))
    return 'Login';
  if (/casino|provider|slot|game/.test(haystack)) return 'Casino';
  if (/deposit|withdraw|wallet|payment|cashier/.test(haystack)) return 'Deposit';
  if (/profile|account details|security center/.test(haystack)) return 'My Profile';
  if (/button-sweep|navigation|home|precheck|site regression|full-check/.test(haystack))
    return 'Navigation & Core';
  if (/a11y|accessibility|axe/.test(haystack)) return 'Accessibility';
  if (/visual|screenshot|snapshot/.test(haystack)) return 'Visual';
  if (/sports/.test(haystack)) return 'Sports';
  return 'Other';
}

const SECTION_EXPLANATIONS = {
  'Report Guide':
    'Справочник по структуре отчёта, статусам, флагам, счётчикам и формулам. Он объясняет, как интерпретировать результат без знания реализации тестов.',
  Highlights:
    'Краткий управленческий итог: статус прогона, доля hard-fail/blocked и наиболее частая причина проблем.',
  Summary:
    'Сводные показатели всего прогона: количество тестов, строгие и сырые результаты, диагностические сигналы, повторы и длительность.',
  'Mobile Stability':
    'Стабильность mobile-сценариев: результаты, тайм-ауты, blocked-сигналы и наиболее частые причины ограниченного покрытия.',
  Sections:
    'Агрегация тестов по продуктовым областям. Позволяет увидеть, где сосредоточены ошибки, ограничения покрытия и основное время выполнения.',
  Accessibility: 'Smoke-проверки доступности интерфейса (a11y) и критические находки анализатора.',
  Visual: 'Визуальные smoke-проверки и скриншоты ключевых страниц и пользовательских потоков.',
  Casino: 'Каталог Casino, поиск, фильтры, категории, LOAD MORE, избранное, Recent и запуск игр.',
  Sports:
    'Sportsbook: загрузка виджета, навигация по видам спорта, события, коэффициенты, betslip, metadata и сетевые диагностики.',
  Deposit:
    'Соответствие Deposit UI данным API и открытие рабочей формы каждого видимого платёжного метода.',
  Withdraw:
    'Проверка доступности Withdraw, основных контролов и безопасного открытия формы без выполнения реального вывода.',
  Contracts: 'Проверки API-контрактов auth/payment по OpenAPI с помощью Spectral и Schemathesis.',
  Sidebar:
    'Меню для гостя и авторизованного игрока: состав пунктов, навигация, сервисные действия, языки и ограничения доступа.',
  'Live Chat':
    'Виджет поддержки: launcher, pre-chat форма, отправка сообщения и получение активности/ответа, если destructive-проверка включена.',
  Login: 'Авторизация, проверка сессии и сценарии, которым требуется авторизованный игрок.',
  'My Profile':
    'Доступность profile-маршрутов, account/security, валидации, сохранение данных, visual и accessibility smoke.',
  'Navigation & Core':
    'Precheck, главная страница, ключевая навигация и базовая работоспособность сайта.',
  Registration:
    'Регистрация нового игрока, проверка ответа signup API и подготовка авторизованного состояния для следующих фаз.',
  'Registration & Player':
    'Результат регистрации, источник данных игрока, доступность ручного входа и состояние проверки credentials.',
  'Casino Providers Matrix':
    'Матрица реальных non-demo запусков по каждому провайдеру: сильный/слабый успех, блокировка, отсутствие провайдера и evidence игрового surface.',
  'Deposit Coverage':
    'Сводка Deposit inventory и готовности методов, включая доступность ключевых категорий и причины blocked.',
  'Auth State Health':
    'Свежесть и пригодность storageState, используемого авторизованными тестами, особенно provider/history сценариями.',
  'Run KPI Validation':
    'Контроль валидности прогона: допустимые blocked ratios, минимальное число provider launches, чистый precheck и Deposit UI/API consistency.',
  'Failed Tests':
    'Только hard-fail тесты: ошибка, местоположение, длительность, флаги и ссылки на evidence.',
  'Registration Diagnostics':
    'Сетевые ответы, request failures, console/toast errors и auth responses, собранные при регистрации.',
  Other: 'Тесты, которые не удалось однозначно отнести к одной из основных продуктовых областей.',
};

const FLAG_EXPLANATIONS = [
  {
    flag: 'blocked',
    meaning:
      'Тест завершён с внешней блокировкой: WAF, captcha, отсутствующий маршрут или недоступный интерфейс.',
  },
  {
    flag: 'infra blocked',
    meaning:
      'Покрытие заблокировано инфраструктурой: WAF/challenge, auth state, сессией, сетью или запуском провайдера.',
  },
  {
    flag: 'product blocked',
    meaning:
      'Функция отсутствует, не отрисована или недоступна для взаимодействия в текущем интерфейсе бренда.',
  },
  {
    flag: 'partial',
    meaning: 'Тест собрал полезные данные, но предусмотренное покрытие выполнено не полностью.',
  },
  {
    flag: 'n/a',
    meaning: 'Возможность отмечена как необязательная для бренда и не применяется к этому прогону.',
  },
  {
    flag: 'weak surface',
    meaning:
      'Сценарий запустился, но видимый результат не соответствует строгим критериям успешности.',
  },
  {
    flag: 'provider absent',
    meaning: 'Провайдер включён в целевую матрицу, но не найден на бренде в этом прогоне.',
  },
  {
    flag: 'provider blocked',
    meaning:
      'Запуск провайдера остановлен защитной проверкой, отменённой загрузкой или другим блокером запуска.',
  },
  {
    flag: 'retried',
    meaning: 'Для получения итогового результата потребовался повторный запуск или восстановление.',
  },
];

const COMPACT_REPORT_GUIDE_FLAGS = new Set([
  'blocked',
  'infra blocked',
  'test infra timeout',
  'product blocked',
  'partial',
  'n/a',
]);

function getSectionExplanation(name) {
  return SECTION_EXPLANATIONS[name] || '';
}

function renderSectionIntroMd(name) {
  const explanation = getSectionExplanation(name);
  return explanation ? `${explanation}\n\n` : '';
}

function renderSectionIntroHtml(name) {
  const explanation = getSectionExplanation(name);
  return explanation ? `<p class="section-intro">${escapeHtml(explanation)}</p>` : '';
}

function yesNo(value) {
  return value ? 'Yes' : 'No';
}

function formatKpiVerdict(kpi) {
  if (!kpi) return 'N/A';
  if (
    String(kpi.verdict || '').toLowerCase() === 'inconclusive' ||
    Boolean(kpi.waivers && kpi.waivers.wafGraceApplied)
  ) {
    return 'Inconclusive (WAF grace)';
  }
  if (String(kpi.verdict || '').toLowerCase() === 'failed') return 'Failed';
  if (String(kpi.verdict || '').toLowerCase() === 'passed') return 'Passed';
  return kpi.valid ? 'Passed' : 'Failed';
}

function blockedAwareCount(value, blocked) {
  const numeric = Number(value || 0);
  if (!blocked) return numeric;
  return numeric > 0 ? numeric : 'N/A (blocked)';
}

function blockedAwareList(items, blocked) {
  const list = Array.isArray(items) ? items : [];
  if (list.length > 0) return list.join(', ');
  if (blocked) return 'N/A (blocked)';
  return '-';
}

function uniqueStrings(items) {
  const seen = new Set();
  const values = [];
  for (const item of Array.isArray(items) ? items : []) {
    const value = oneLine(item || '');
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

function blockedAwareBool(value, blocked) {
  if (blocked) return 'N/A (blocked)';
  return value ? 'yes' : 'no';
}

function blockedReasonText(value) {
  const clean = normalizeReason(value, NOTE_TEXT_LIMIT);
  return clean || 'Deposit surface unavailable in current run.';
}

function resolveCoverageMode(uiAvailable, apiAvailable) {
  if (uiAvailable && apiAvailable) return 'ui+api';
  if (uiAvailable) return 'ui-only';
  if (apiAvailable) return 'api-only';
  return 'none';
}

function renderReportGuideMd() {
  const flagRows = reportCompactMode
    ? FLAG_EXPLANATIONS.filter((entry) => COMPACT_REPORT_GUIDE_FLAGS.has(entry.flag))
    : FLAG_EXPLANATIONS;
  return [
    '## Flag Legend',
    '',
    '| Flag | Значение |',
    '| --- | --- |',
    ...flagRows.map((entry) => `| ${escapeMdCell(entry.flag)} | ${escapeMdCell(entry.meaning)} |`),
    '',
  ].join('\n');
}

function renderReportGuideHtml() {
  const flagRows = reportCompactMode
    ? FLAG_EXPLANATIONS.filter((entry) => COMPACT_REPORT_GUIDE_FLAGS.has(entry.flag))
    : FLAG_EXPLANATIONS;
  return `
      <section id="flag-legend">
        <h2>Flag Legend</h2>
        <table>
          <thead>
            <tr>
              <th>Flag</th>
              <th>Значение</th>
            </tr>
          </thead>
          <tbody>
            ${flagRows
              .map(
                (entry) => `
                <tr>
                  <td>${escapeHtml(entry.flag)}</td>
                  <td>${escapeHtml(entry.meaning)}</td>
                </tr>
              `
              )
              .join('')}
          </tbody>
        </table>
      </section>
    `;
}

function attachmentLinksMd(attachments) {
  if (!attachments || !attachments.length) return '-';
  const links = attachments.map((att) => {
    const name = att.name || 'attachment';
    const rel = att.path ? toRelative(att.path) : '';
    if (!rel) return name;
    return `[${name}](${rel})`;
  });
  return links.join(', ');
}

function attachmentLinksHtml(attachments) {
  if (!attachments || !attachments.length) return '<span class="muted">-</span>';
  return attachments
    .map((att) => {
      const name = escapeHtml(att.name || 'attachment');
      const rel = att.path ? toRelative(att.path) : '';
      if (!rel) return `<span>${name}</span>`;
      return `<a href="${escapeHtml(rel)}">${name}</a>`;
    })
    .join('<span class="sep">, </span>');
}

function runStatusBadgeClass(status) {
  if (status === 'FAILED' || status === 'FAILED_KPI' || status === 'INVALID_RUN')
    return 'badge-failed';
  if (status === 'INFRA_BLOCKED') return 'badge-skipped';
  if (status === 'WAF_DEGRADED') return 'badge-skipped';
  if (status === 'PASSED') return 'badge-passed';
  if (status.startsWith('PASSED_WITH')) return 'badge-skipped';
  return 'badge-default';
}

function hasAnnotation(test, type) {
  return (test.annotations || []).some((annotation) => annotation.type === type);
}

function resolveScenarioStatus(test) {
  if (
    String((test && test.status) || '') === 'timedOut' ||
    hasAnnotation(test, 'test-infra-timeout')
  )
    return 'TEST INFRA';
  if (isFailureStatus(test && test.status)) return 'FAILED';
  if (hasAnnotation(test, 'product-blocked')) return 'PRODUCT BLOCKED';
  if (hasAnnotation(test, 'infra-blocked')) return 'INFRA BLOCKED';
  if (hasAnnotation(test, 'blocked') || hasAnnotation(test, 'provider-blocked')) return 'BLOCKED';
  if (hasAnnotation(test, 'not-applicable')) return 'N/A';
  if (hasAnnotation(test, 'partial') || hasAnnotation(test, 'deposit-method-limit'))
    return 'PARTIAL';
  if (String((test && test.status) || '') === 'flaky' || hasAnnotation(test, 'flaky'))
    return 'FLAKY';
  if (String((test && test.status) || '') === 'skipped') return 'SKIPPED';
  if (String((test && test.status) || '') === 'passed') return 'PASSED';
  return String((test && test.status) || 'UNKNOWN').toUpperCase();
}

const ISSUE_ANNOTATION_TYPES = new Set([
  'blocked',
  'infra-blocked',
  'product-blocked',
  'product-warning',
  'provider-blocked',
  'provider-absent',
  'partial',
  'deposit-method-limit',
  'weak-surface',
  'not-applicable',
  'retried',
  'flaky',
]);

function isIssueLikeTest(test) {
  if (isFailureStatus(test && test.status)) return true;
  const annotations = Array.isArray(test && test.annotations) ? test.annotations : [];
  return annotations.some((item) => ISSUE_ANNOTATION_TYPES.has(String(item.type || '').trim()));
}

function sortByImportance(tests) {
  return [...(tests || [])].sort((a, b) => {
    const failureDiff = Number(isFailureStatus(b.status)) - Number(isFailureStatus(a.status));
    if (failureDiff !== 0) return failureDiff;
    const issueDiff = Number(isIssueLikeTest(b)) - Number(isIssueLikeTest(a));
    if (issueDiff !== 0) return issueDiff;
    const blockedDiff = Number(hasAnnotation(b, 'blocked')) - Number(hasAnnotation(a, 'blocked'));
    if (blockedDiff !== 0) return blockedDiff;
    return String(a.titlePath || a.title || '').localeCompare(String(b.titlePath || b.title || ''));
  });
}

function sliceWithMeta(items, limit) {
  const normalized = Array.isArray(items) ? items : [];
  if (limit < 0) {
    return { items: normalized, omitted: 0 };
  }
  const safeLimit = Math.max(0, Number(limit || 0));
  const visible = normalized.slice(0, safeLimit);
  const omitted = Math.max(0, normalized.length - visible.length);
  return { items: visible, omitted };
}

function getFlagLabels(test) {
  const flags = [];
  if (String(test.status || '') === 'timedOut' || hasAnnotation(test, 'test-infra-timeout')) {
    flags.push('test infra timeout');
  }
  if (hasAnnotation(test, 'provider-absent')) {
    flags.push('provider absent');
    if (!hasAnnotation(test, 'not-applicable')) flags.push('n/a');
  }
  if (hasAnnotation(test, 'provider-blocked')) flags.push('provider blocked');
  else if (hasAnnotation(test, 'blocked')) {
    if (hasAnnotation(test, 'infra-blocked')) flags.push('infra blocked');
    else if (hasAnnotation(test, 'product-blocked')) flags.push('product blocked');
    else flags.push('blocked');
  }
  if (hasAnnotation(test, 'product-warning')) flags.push('product warning');
  if (hasAnnotation(test, 'not-applicable')) flags.push('n/a');
  if (hasAnnotation(test, 'weak-surface')) flags.push('weak surface');
  if (hasAnnotation(test, 'partial') || hasAnnotation(test, 'deposit-method-limit'))
    flags.push('partial');
  if (hasAnnotation(test, 'retried') || test.retries > 0 || hasAnnotation(test, 'flaky')) {
    flags.push(`retried x${Math.max(1, test.retries)}`);
  }
  return flags;
}

function flagsMd(test) {
  const flags = getFlagLabels(test);
  return flags.length ? flags.join(', ') : '-';
}

function flagsHtml(test) {
  const flags = getFlagLabels(test);
  if (!flags.length) return '<span class="muted">-</span>';
  return flags.map((flag) => `<span class="mini-flag">${escapeHtml(flag)}</span>`).join('');
}

function noteSummary(test) {
  const annotations = Array.isArray(test.annotations) ? test.annotations : [];
  const reasons = !annotations.length
    ? [normalizeReason(test.error || test.status || '-')]
    : annotations
        .slice(0, 3)
        .map((annotation) => normalizeReason(annotation.description || annotation.type))
        .filter(Boolean);
  const uniqueReasons = [...new Set(reasons)];
  const note = uniqueReasons.join(' | ');
  return truncateText(note || '-', NOTE_TEXT_LIMIT);
}

function firstAnnotationDescription(test, types = []) {
  const wanted = new Set(types.map((type) => String(type)));
  const annotations = Array.isArray(test && test.annotations) ? test.annotations : [];
  const annotation =
    annotations.find((item) => wanted.has(String(item.type || ''))) ||
    annotations.find((item) => item && item.description);
  return oneLine(annotation && annotation.description ? annotation.description : '');
}

function resolveRegistrationCoverage({
  registrationPrimaryTest,
  newPlayerRegisteredInRun,
  registrationDataFromCurrentRun,
  registrationData,
}) {
  if (!registrationPrimaryTest) {
    return {
      state: 'not-found',
      status: 'not-found',
      rawStatus: 'not-found',
      reason: 'Registration success test was not found in the collected reports.',
    };
  }

  const rawStatus = String(registrationPrimaryTest.status || 'unknown');
  const blocked = hasAnnotation(registrationPrimaryTest, 'blocked');
  if (blocked) {
    return {
      state: 'blocked',
      status: 'blocked',
      rawStatus,
      reason:
        normalizeReason(
          firstAnnotationDescription(registrationPrimaryTest, [
            'infra-blocked',
            'product-blocked',
            'blocked',
          ]) || noteSummary(registrationPrimaryTest)
        ) || 'Registration flow was blocked in this run.',
    };
  }

  if (newPlayerRegisteredInRun) {
    return {
      state: 'registered',
      status: rawStatus,
      rawStatus,
      reason: 'New player artifacts were created and validated in this run.',
    };
  }

  if (isFailureStatus(rawStatus)) {
    return {
      state: 'failed',
      status: rawStatus,
      rawStatus,
      reason: noteSummary(registrationPrimaryTest),
    };
  }

  if (rawStatus === 'skipped') {
    return {
      state: 'skipped',
      status: rawStatus,
      rawStatus,
      reason: noteSummary(registrationPrimaryTest),
    };
  }

  if (!registrationDataFromCurrentRun) {
    const hasReusableData = Boolean(
      registrationData && registrationData.email && registrationData.password
    );
    return {
      state: hasReusableData ? 'stale-artifacts' : 'missing-artifacts',
      status: rawStatus,
      rawStatus,
      reason: hasReusableData
        ? 'Registration data exists, but it does not belong to the current run.'
        : 'Registration test did not produce current-run player artifacts.',
    };
  }

  return {
    state: 'unknown',
    status: rawStatus,
    rawStatus,
    reason: noteSummary(registrationPrimaryTest),
  };
}

function getSignalTotals(tests) {
  const degradedTypes = new Set([
    'blocked',
    'infra-blocked',
    'test-infra-timeout',
    'product-blocked',
    'product-warning',
    'provider-blocked',
    'not-applicable',
    'partial',
    'deposit-method-limit',
    'weak-surface',
    'provider-absent',
  ]);
  return {
    blocked: tests.filter((test) => hasAnnotation(test, 'blocked')).length,
    infraBlocked: tests.filter((test) => hasAnnotation(test, 'infra-blocked')).length,
    testInfraTimeout: tests.filter(
      (test) =>
        String(test.status || '') === 'timedOut' || hasAnnotation(test, 'test-infra-timeout')
    ).length,
    productBlocked: tests.filter((test) => hasAnnotation(test, 'product-blocked')).length,
    productWarnings: tests.filter((test) => hasAnnotation(test, 'product-warning')).length,
    notApplicable: tests.filter(
      (test) => hasAnnotation(test, 'not-applicable') || hasAnnotation(test, 'provider-absent')
    ).length,
    partial: tests.filter(
      (test) => hasAnnotation(test, 'partial') || hasAnnotation(test, 'deposit-method-limit')
    ).length,
    retried: tests.filter(
      (test) => hasAnnotation(test, 'retried') || test.retries > 0 || hasAnnotation(test, 'flaky')
    ).length,
    weakSurface: tests.filter((test) => hasAnnotation(test, 'weak-surface')).length,
    providerAbsent: tests.filter((test) => hasAnnotation(test, 'provider-absent')).length,
    strictClean: tests.filter((test) => {
      const title = String(test.title || '');
      const weakOddsSmoke = /odds click.*betslip surface.*interaction smoke/i.test(title);
      return (
        test.status === 'passed' &&
        Number(test.retries || 0) === 0 &&
        !/\bdiagnostics?\b/i.test(title) &&
        (!weakOddsSmoke || hasAnnotation(test, 'strong-evidence')) &&
        !(test.annotations || []).some((annotation) =>
          degradedTypes.has(
            String(annotation && annotation.type ? annotation.type : '').toLowerCase()
          )
        )
      );
    }).length,
  };
}

function extractReason(test) {
  const annotations = Array.isArray(test.annotations) ? test.annotations : [];
  const preferred = annotations.find(
    (item) =>
      [
        'blocked',
        'infra-blocked',
        'test-infra-timeout',
        'product-blocked',
        'product-warning',
        'provider-blocked',
        'not-applicable',
      ].includes(String(item.type || '').toLowerCase()) && oneLine(item.description)
  );
  if (preferred) return normalizeReason(preferred.description);

  const anyDescription = annotations.find((item) => oneLine(item.description));
  if (anyDescription) return normalizeReason(anyDescription.description);

  return normalizeReason(test.error || test.status || 'unknown');
}

function topReasons(tests, limit = 5) {
  const counts = new Map();
  for (const test of tests || []) {
    const reason = extractReason(test);
    if (!reason) continue;
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.reason.localeCompare(b.reason);
    })
    .slice(0, Math.max(1, limit));
}

function resolveMobileTests(allTests, executionMode) {
  const mode = String(executionMode || '')
    .trim()
    .toLowerCase();
  if (mode === 'mobile') return allTests.slice();
  return allTests.filter((test) =>
    String(test.projectName || '')
      .trim()
      .toLowerCase()
      .includes('mobile')
  );
}

function summarizeProviderMatrix(payload, inventoryPayload) {
  const results = Array.isArray(payload && payload.results) ? payload.results : [];
  const summary = payload && payload.summary ? payload.summary : {};
  const normalizeProviderKey = (value) => {
    const key = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
    return key === 'truelab' ? 'truelabs' : key;
  };
  const resultProviderKeys = new Set(
    results.map((item) => normalizeProviderKey((item && item.provider) || '')).filter(Boolean)
  );
  const inventoryProviderNames = Array.isArray(inventoryPayload && inventoryPayload.providers)
    ? inventoryPayload.providers
        .map((item) => String(item && item.name ? item.name : item || '').trim())
        .filter(Boolean)
    : [];
  const discoveredUntested = inventoryProviderNames.filter(
    (provider) => !resultProviderKeys.has(normalizeProviderKey(provider))
  );
  const targetDeclared = Number(
    (payload && (payload.providersTargetCountAll || payload.providersTargetCount)) ||
      results.length ||
      0
  );
  const inventoryProviders = Array.isArray(inventoryPayload && inventoryPayload.providers)
    ? inventoryPayload.providers.length
    : 0;
  const providersDiscovered = Number(
    (payload && payload.providersDiscovered) ||
      (inventoryPayload &&
        (inventoryPayload.providersCount || inventoryPayload.providersDiscovered)) ||
      inventoryProviders ||
      0
  );
  return {
    targetDeclared,
    resultsCaptured: results.length,
    providersDiscovered,
    discoveredUntested,
    total: Number(summary.total || results.length || 0),
    passed: Number(summary.passedStrong || 0) + Number(summary.passedWeakSurface || 0),
    failed: Number(
      summary.failed || results.filter((item) => item.status === 'failed').length || 0
    ),
    blocked: Number(
      summary.blocked || results.filter((item) => item.status === 'blocked').length || 0
    ),
    passedStrong: Number(
      summary.passedStrong || results.filter((item) => item.outcome === 'passed-strong').length || 0
    ),
    passedWeakSurface: Number(
      summary.passedWeakSurface ||
        results.filter((item) => item.outcome === 'passed-weak-surface').length ||
        0
    ),
    blockedProviderAbsent: Number(
      summary.blockedProviderAbsent ||
        results.filter((item) => item.outcome === 'provider-absent').length ||
        0
    ),
    blockedProviderLaunch: Number(
      summary.blockedProviderLaunch ||
        results.filter((item) => item.outcome === 'provider-launch-blocked').length ||
        0
    ),
    blockedInfraWaf: Number(
      summary.blockedInfraWaf ??
        results.filter((item) => item.outcome === 'infra-waf-blocked').length ??
        0
    ),
    blockedOther: Number(
      summary.blockedOther ??
        results.filter(
          (item) =>
            item.status === 'blocked' &&
            !['provider-absent', 'provider-launch-blocked', 'infra-waf-blocked'].includes(
              item.outcome
            )
        ).length ??
        0
    ),
    retriedRecovered: Number(
      summary.retriedRecovered || results.filter((item) => Boolean(item.flakyRecovered)).length || 0
    ),
    optionalStageTimeoutProviders: Number(
      summary.optionalStageTimeoutProviders ||
        results.filter((item) =>
          (item.modes || []).some((mode) =>
            (mode.launches || []).some((launch) =>
              (launch.stageTelemetry || []).some((stage) => stage.status === 'timed-out-optional')
            )
          )
        ).length ||
        0
    ),
    optionalStageTimeouts: Number(
      summary.optionalStageTimeouts ||
        results.reduce(
          (total, item) =>
            total +
            (item.modes || []).reduce(
              (modeTotal, mode) =>
                modeTotal +
                (mode.launches || []).reduce(
                  (launchTotal, launch) =>
                    launchTotal +
                    (launch.stageTelemetry || []).filter(
                      (stage) => stage.status === 'timed-out-optional'
                    ).length,
                  0
                ),
              0
            ),
          0
        ) ||
        0
    ),
  };
}

function summarizeDepositArtifact(payload) {
  const results = Array.isArray(payload && payload.selectionResults)
    ? payload.selectionResults
    : [];
  const realResults = results.filter((item) => item.method && item.method !== '__time_budget__');
  const discoveredCount = Number(
    payload && payload.paymentMethodsDiscoveredCount
      ? payload.paymentMethodsDiscoveredCount
      : Array.isArray(payload && payload.paymentMethodsDiscovered)
        ? payload.paymentMethodsDiscovered.length
        : 0
  );
  const checkedCount = Number(
    payload && payload.paymentMethodsCheckedCount
      ? payload.paymentMethodsCheckedCount
      : Array.isArray(payload && payload.paymentMethodsChecked)
        ? payload.paymentMethodsChecked.length
        : realResults.length
  );
  const uiCoverageAvailable =
    payload && typeof payload.uiCoverageAvailable === 'boolean'
      ? payload.uiCoverageAvailable
      : Number(
          payload && payload.paymentMethodTilesDiscoveredCount
            ? payload.paymentMethodTilesDiscoveredCount
            : 0
        ) > 0;
  const apiCoverageAvailable =
    payload && typeof payload.apiCoverageAvailable === 'boolean'
      ? payload.apiCoverageAvailable
      : Boolean(payload && payload.apiFallback && payload.apiFallback.resolved);
  const discoveredMethods = uniqueStrings(
    Array.isArray(payload && payload.paymentMethodsDiscovered)
      ? payload.paymentMethodsDiscovered
      : Array.isArray(payload && payload.paymentMethodTilesDiscovered)
        ? payload.paymentMethodTilesDiscovered
        : realResults.map((item) => item.method)
  );
  const checkedMethods = uniqueStrings(
    Array.isArray(payload && payload.paymentMethodsChecked)
      ? payload.paymentMethodsChecked
      : realResults.map((item) => item.method)
  );
  const readyMethods = uniqueStrings(
    realResults.filter((item) => item.surfaceReady).map((item) => item.method)
  );
  return {
    discoveredCount,
    checkedCount,
    readyCount: Number(
      payload && payload.paymentMethodsReadyCount
        ? payload.paymentMethodsReadyCount
        : realResults.filter((item) => item.selected && item.surfaceReady).length
    ),
    partialCoverage: Boolean(payload && payload.partialCoverage),
    submitVisible: Boolean(payload && payload.submitVisible),
    submitEnabled: Boolean(payload && payload.submitEnabled),
    source: oneLine((payload && payload.source) || ''),
    sourceMode: oneLine(
      (payload && payload.sourceMode) ||
        resolveCoverageMode(uiCoverageAvailable, apiCoverageAvailable)
    ),
    uiCoverageAvailable,
    apiCoverageAvailable,
    discoveredMethods,
    checkedMethods,
    readyMethods,
    results: realResults,
  };
}

function summarizeDepositInventory(payload) {
  const apiInventory = payload && payload.apiInventory ? payload.apiInventory : {};
  const uiInventory = payload && payload.uiInventory ? payload.uiInventory : {};
  const apiFallback = payload && payload.apiFallback ? payload.apiFallback : {};
  const fallbackAttempts = Array.isArray(apiFallback.attempts) ? apiFallback.attempts : [];
  const uiCoverageAvailable =
    payload && typeof payload.uiCoverageAvailable === 'boolean'
      ? payload.uiCoverageAvailable
      : Number(uiInventory.totalTiles || 0) > 0;
  const apiCoverageAvailable =
    payload && typeof payload.apiCoverageAvailable === 'boolean'
      ? payload.apiCoverageAvailable
      : Number(apiInventory.itemsCount || 0) > 0;
  return {
    apiItemsCount: Number(apiInventory.itemsCount || 0),
    apiCategories: Array.isArray(apiInventory.categories) ? apiInventory.categories : [],
    apiGrouped: Array.isArray(apiInventory.grouped) ? apiInventory.grouped : [],
    uiCategories: Array.isArray(uiInventory.uniqueCategories) ? uiInventory.uniqueCategories : [],
    uiTilesCount: Number(uiInventory.totalTiles || 0),
    sourceMode: oneLine(
      (payload && payload.sourceMode) ||
        resolveCoverageMode(uiCoverageAvailable, apiCoverageAvailable)
    ),
    uiCoverageAvailable,
    apiCoverageAvailable,
    apiFallbackResolved: Boolean(apiFallback && apiFallback.resolved),
    apiFallbackBestCurrency: oneLine(apiFallback.bestCurrency || ''),
    apiFallbackBestStatus: Number(apiFallback.bestStatus || 0),
    apiFallbackAttempts: fallbackAttempts.map((attempt) => ({
      currency: oneLine(attempt.currency || '-'),
      status: Number(attempt.status || 0),
      itemsCount: Number(attempt.itemsCount || 0),
      error: oneLine(attempt.error || ''),
      url: oneLine(attempt.url || ''),
      bodyPreview: oneLine(attempt.bodyPreview || ''),
    })),
    unexpectedUiCategories: Array.isArray(payload && payload.unexpectedUiCategories)
      ? payload.unexpectedUiCategories
      : [],
    missingUiCategories: Array.isArray(payload && payload.missingUiCategories)
      ? payload.missingUiCategories
      : [],
  };
}

const reportSources = loadReportSources();
let tests = [];
for (const source of reportSources) {
  const suites = Array.isArray(source.data.suites) ? source.data.suites : [];
  for (const suite of suites) tests = collectTests(suite, source.phase, tests);
}

tests.sort((a, b) => {
  const byStatus = statusRank(a.status) - statusRank(b.status);
  if (byStatus !== 0) return byStatus;
  if (a.phase !== b.phase) return a.phase.localeCompare(b.phase);
  return a.titlePath.localeCompare(b.titlePath);
});

const totals = getStatusTotals(tests);
const signalTotals = getSignalTotals(tests);
const authStateHealth = readJson(authStateHealthArtifactPath);
const kpiValidation = readJson(kpiValidationArtifactPath);
const executionJournal = readCurrentRunJson(executionJournalArtifactPath);
const failed = tests.filter((t) => isFailureStatus(t.status));
const softPrecheckFailureTests = failed.filter((test) => isSoftPrecheckFailure(test));
const effectiveFailedCount = failed.length - softPrecheckFailureTests.length;
const runStatusBase = getRunStatus({
  ...totals,
  failed: Math.max(0, effectiveFailedCount),
});
function resolveKpiRunStatus(baseStatus, kpi) {
  const failedChecks = Array.isArray(kpi && kpi.failedChecks) ? kpi.failedChecks : [];
  const wafSignals = [
    kpi && kpi.waivers && kpi.waivers.wafGraceApplied,
    kpi && kpi.waivers && kpi.waivers.precheckCloudflareSignal,
    failedChecks.some((item) =>
      /waf|cloudflare|turnstile|captcha|cdn-cgi|__cf_chl|challenge/i.test(
        `${item && item.id ? item.id : ''} ${item && item.detail ? item.detail : ''}`
      )
    ),
  ].some(Boolean);

  if (baseStatus === 'PASSED' && signalTotals.testInfraTimeout > 0 && !wafSignals) {
    return 'TEST_INFRA_TIMEOUT';
  }
  if (baseStatus === 'PASSED' && wafSignals) return 'WAF_DEGRADED';
  if (baseStatus === 'PASSED' && signalTotals.blocked > 0 && (!kpi || kpi.valid !== false)) {
    return 'PASSED_WITH_BLOCKS';
  }
  if (!kpi || kpi.valid !== false) return baseStatus;
  return 'INVALID_RUN';
}
const runStatus = resolveKpiRunStatus(runStatusBase, kpiValidation);
const executionMode = configuredExecutionMode;
const platformLabel = executionMode === 'mobile' ? 'Mobile' : 'Desktop';
const mobileTests = resolveMobileTests(tests, executionMode);
const mobileTotals = getStatusTotals(mobileTests);
const mobileBlockedCount = mobileTests.filter((test) => hasAnnotation(test, 'blocked')).length;
const mobileProviderBlockedCount = mobileTests.filter((test) =>
  hasAnnotation(test, 'provider-blocked')
).length;
const mobileInfraBlockedCount = mobileTests.filter((test) =>
  hasAnnotation(test, 'infra-blocked')
).length;
const mobileTimedOutCount = mobileTests.filter((test) => String(test.status) === 'timedOut').length;
const mobileStabilityTests = mobileTests.filter(
  (test) =>
    isFailureStatus(test.status) ||
    hasAnnotation(test, 'blocked') ||
    hasAnnotation(test, 'provider-blocked')
);
const mobileTopReasons = topReasons(mobileStabilityTests, 6);
const mobileTopReasonsTotal = Math.max(1, mobileStabilityTests.length);
const showMobileStability = executionMode === 'mobile' || mobileTests.length > 0;
const durationMs = reportSources.reduce(
  (sum, src) => sum + Number(src.data.stats?.duration || 0),
  0
);
const executionAttempts = Array.isArray(executionJournal && executionJournal.attempts)
  ? executionJournal.attempts
  : [];
const orchestrationDurationMs = Number(
  (executionJournal && executionJournal.durationMs) || durationMs
);
const orchestrationRetryAttempts = executionAttempts.filter((attempt) => attempt.retry).length;
const orchestrationFailedAttempts = executionAttempts.filter(
  (attempt) => Number(attempt.code || 0) !== 0
).length;
const orchestrationWafAttempts = executionAttempts.filter(
  (attempt) => attempt.wafSignal && Number(attempt.code || 0) !== 0
).length;
const orchestrationPlaywrightAttempts = executionAttempts.filter(
  (attempt) => !attempt.kind || attempt.kind === 'playwright'
).length;
const orchestrationStorageStateAttempts = executionAttempts.filter(
  (attempt) => attempt.kind === 'storage-state'
).length;
const orchestrationStorageStateFailedAttempts = executionAttempts.filter(
  (attempt) => attempt.kind === 'storage-state' && Number(attempt.code || 0) !== 0
).length;
const recoveredPhases = (() => {
  const attemptsByPhase = new Map();
  for (const attempt of executionAttempts) {
    if (attempt.kind && attempt.kind !== 'playwright') continue;
    const phase = oneLine(attempt.phase || 'unknown');
    if (!attemptsByPhase.has(phase)) attemptsByPhase.set(phase, []);
    attemptsByPhase.get(phase).push(attempt);
  }
  return [...attemptsByPhase.entries()]
    .filter(([, attempts]) => {
      const finalAttempt = attempts[attempts.length - 1];
      return (
        attempts.some((attempt) => Number(attempt.code || 0) !== 0) &&
        Number(finalAttempt && finalAttempt.code ? finalAttempt.code : 0) === 0
      );
    })
    .map(([phase]) => phase);
})();
const generatedAt = new Date().toISOString();

const sectionMap = new Map();
for (const testItem of tests) {
  const section = resolveSection(testItem);
  if (!sectionMap.has(section)) sectionMap.set(section, []);
  sectionMap.get(section).push(testItem);
}

const sectionSummary = [...sectionMap.entries()]
  .map(([section, sectionTests]) => ({
    section,
    tests: sectionTests,
    totals: getStatusTotals(sectionTests),
    durationMs: sectionTests.reduce((sum, t) => sum + Number(t.duration || 0), 0),
  }))
  .sort((a, b) => {
    const rankDiff =
      statusRank(a.tests.some((t) => isFailureStatus(t.status)) ? 'failed' : 'passed') -
      statusRank(b.tests.some((t) => isFailureStatus(t.status)) ? 'failed' : 'passed');
    if (rankDiff !== 0) return rankDiff;
    return a.section.localeCompare(b.section);
  });

const blockedRatio = Number(signalTotals.blocked || 0) / Math.max(1, Number(totals.total || 0));
const failedRatio = Number(totals.failed || 0) / Math.max(1, Number(totals.total || 0));
const effectiveFailedRatio =
  Number(Math.max(0, effectiveFailedCount || 0)) / Math.max(1, Number(totals.total || 0));
const topSectionsByBlocked = [...sectionSummary]
  .map((section) => ({
    section: section.section,
    blocked: section.tests.filter((test) => hasAnnotation(test, 'blocked')).length,
    total: section.totals.total,
  }))
  .filter((item) => item.blocked > 0)
  .sort((a, b) => b.blocked - a.blocked)
  .slice(0, 3);
const runIssueTopReasons = topReasons(
  tests.filter(
    (test) =>
      isFailureStatus(test.status) ||
      hasAnnotation(test, 'blocked') ||
      hasAnnotation(test, 'provider-blocked')
  ),
  3
);
const quickHighlights = [];
quickHighlights.push(
  `Run status: ${runStatus}. Hard failed: ${Math.max(0, effectiveFailedCount)}/${totals.total} (${formatPercent(
    effectiveFailedRatio,
    1
  )}).`
);
quickHighlights.push(
  `Raw Playwright passed/completed: ${totals.passed}/${totals.total}; strict clean functional evidence: ${signalTotals.strictClean}/${totals.total}. Blocked/partial/N/A annotations are not product passes.`
);
quickHighlights.push(
  `Blocked signals: ${signalTotals.blocked}/${totals.total} (${formatPercent(blockedRatio, 1)}).`
);
if (softPrecheckMode && softPrecheckFailureTests.length > 0) {
  quickHighlights.push(
    `Soft precheck mode active: ${softPrecheckFailureTests.length} precheck failure(s) were carried as non-blocking diagnostics.`
  );
}
if (topSectionsByBlocked.length) {
  quickHighlights.push(
    `Most blocked section: ${topSectionsByBlocked[0].section} (${topSectionsByBlocked[0].blocked}/${topSectionsByBlocked[0].total}).`
  );
}
if (runIssueTopReasons.length) {
  quickHighlights.push(
    `Top issue reason: ${runIssueTopReasons[0].reason} (${runIssueTopReasons[0].count} tests).`
  );
}

const liveChatSection = sectionSummary.find((item) => item.section === 'Live Chat') || null;
const sidebarSection = sectionSummary.find((item) => item.section === 'Sidebar') || null;
const sectionDetails = sectionSummary.map((section) => {
  const ordered = sortByImportance(section.tests);
  const issueOnly = ordered.filter((test) => isIssueLikeTest(test));
  const sourceRows =
    sectionDetailRowsLimit <= 0
      ? []
      : reportCompactMode
        ? issueOnly.length
          ? issueOnly
          : ordered
        : ordered;
  const sliced = sliceWithMeta(sourceRows, sectionDetailRowsLimit);
  return {
    ...section,
    detailTests: sliced.items,
    detailOmitted: sliced.omitted,
    detailSourceCount: sourceRows.length,
    detailIssueCount: issueOnly.length,
  };
});

const registration = readFirstJson(registrationCandidates);
const registrationData = registration.data;
const manualLoginPlayerFallback = readFirstJson([manualLoginPlayerPath]);
const manualLoginPlayerResolved = isManualLoginReadyPlayer(registrationData)
  ? {
      data: registrationData,
      path: registration.path,
    }
  : isManualLoginReadyPlayer(manualLoginPlayerFallback.data)
    ? manualLoginPlayerFallback
    : { data: null, path: null };
const manualLoginPlayerData = manualLoginPlayerResolved.data;
const manualLoginPlayerDataSource = manualLoginPlayerResolved.path || '-';
const currentManualLoginEmail = credentialValue(
  (manualLoginPlayerData && manualLoginPlayerData.email) ||
    (registrationData && registrationData.email) ||
    ''
);
const currentManualLoginPassword = reportPasswordValue(
  (manualLoginPlayerData && manualLoginPlayerData.password) ||
    (registrationData && registrationData.password) ||
    ''
);
const registrationNetwork = readJson(registrationNetworkPath);
const registrationPrimaryTest =
  tests.find((testItem) => /signup-api-success\.spec\.js$/i.test(testItem.file || '')) ||
  tests.find((testItem) =>
    /sign up api: successful registration returns token and userid/i.test(
      testItem.titlePath || testItem.title || ''
    )
  ) ||
  null;
const registrationCurrentRunPaths = new Set(
  [registrationCurrentRunPath, path.join(cwd, 'test-results', 'registration-data.json')].map(
    (filePath) => path.resolve(filePath)
  )
);
const registrationDataFromCurrentRun = Boolean(
  registrationPrimaryTest &&
  registrationPrimaryTest.status === 'passed' &&
  registrationData &&
  registration.path &&
  registrationCurrentRunPaths.has(path.resolve(registration.path)) &&
  registrationData.email &&
  registrationData.password
);
const newPlayerRegisteredInRun = Boolean(
  registrationPrimaryTest &&
  registrationPrimaryTest.status === 'passed' &&
  registrationDataFromCurrentRun
);
const registrationCoverage = resolveRegistrationCoverage({
  registrationPrimaryTest,
  newPlayerRegisteredInRun,
  registrationDataFromCurrentRun,
  registrationData,
});
const registrationOutcome = {
  testFound: Boolean(registrationPrimaryTest),
  newPlayerRegisteredInRun,
  coverageState: registrationCoverage.state,
  testStatus: registrationCoverage.status,
  rawTestStatus: registrationCoverage.rawStatus,
  blockedReason: registrationCoverage.reason,
  flags: registrationPrimaryTest ? flagsMd(registrationPrimaryTest) : '-',
  note: registrationPrimaryTest
    ? noteSummary(registrationPrimaryTest)
    : 'Registration success test was not found in the collected reports.',
  playerDataAvailable: Boolean(registrationData),
  playerDataSource: registration.path || '-',
  playerDataFromCurrentRun: registrationDataFromCurrentRun,
  playerGeneratedAt:
    registrationData && registrationData.generatedAt ? registrationData.generatedAt : '-',
  playerEmail: registrationData && registrationData.email ? registrationData.email : '-',
  manualLoginReady: Boolean(registrationData && registrationData.manualLoginReady === true),
  loginValidationStatus:
    registrationData && registrationData.loginValidationStatus
      ? registrationData.loginValidationStatus
      : '-',
  loginValidationMethod:
    registrationData && registrationData.loginValidationMethod
      ? registrationData.loginValidationMethod
      : '-',
  loginValidationReason:
    registrationData && registrationData.loginValidationReason
      ? registrationData.loginValidationReason
      : '-',
  loginValidationAt:
    registrationData && registrationData.loginValidationAt
      ? registrationData.loginValidationAt
      : '-',
  lastLoginCheckStatus:
    registrationData && registrationData.lastLoginCheckStatus
      ? registrationData.lastLoginCheckStatus
      : '-',
  lastLoginCheckMethod:
    registrationData && registrationData.lastLoginCheckMethod
      ? registrationData.lastLoginCheckMethod
      : '-',
  lastLoginCheckReason:
    registrationData && registrationData.lastLoginCheckReason
      ? registrationData.lastLoginCheckReason
      : '-',
  lastLoginCheckAt:
    registrationData && registrationData.lastLoginCheckAt ? registrationData.lastLoginCheckAt : '-',
  manualLoginPlayerAvailable: Boolean(manualLoginPlayerData),
  manualLoginPlayerSource: manualLoginPlayerDataSource,
  manualLoginPlayerFromCurrentRun: Boolean(
    manualLoginPlayerData && registration.path && manualLoginPlayerResolved.path
      ? path.resolve(manualLoginPlayerResolved.path) === path.resolve(registration.path)
      : false
  ),
  manualLoginPlayerEmail:
    manualLoginPlayerData && manualLoginPlayerData.email ? manualLoginPlayerData.email : '-',
  manualLoginPlayerGeneratedAt:
    manualLoginPlayerData && manualLoginPlayerData.generatedAt
      ? manualLoginPlayerData.generatedAt
      : '-',
  manualLoginPlayerValidationAt:
    manualLoginPlayerData && manualLoginPlayerData.loginValidationAt
      ? manualLoginPlayerData.loginValidationAt
      : '-',
  currentManualLoginEmail: currentManualLoginEmail || '-',
  currentManualLoginPassword: currentManualLoginPassword || '-',
  sourceTest:
    (registrationData && registrationData.source) ||
    (registrationPrimaryTest &&
      (registrationPrimaryTest.titlePath || registrationPrimaryTest.title)) ||
    '-',
};
if (registrationOutcome.coverageState === 'blocked') {
  quickHighlights.push(`Registration blocked: ${registrationOutcome.blockedReason}`);
} else if (
  registrationOutcome.testFound &&
  !registrationOutcome.newPlayerRegisteredInRun &&
  registrationOutcome.coverageState !== 'registered'
) {
  quickHighlights.push(
    `Registration did not create a current-run player: ${registrationOutcome.blockedReason}`
  );
}
const providerMatrix = readCurrentRunJson(providerMatrixPath);
const providerInventory = readCurrentRunJson(providerInventoryPath);
const providerMatrixSummary = summarizeProviderMatrix(providerMatrix, providerInventory);
const providerMatrixAllResults = Array.isArray(providerMatrix && providerMatrix.results)
  ? providerMatrix.results
  : [];
const providerMatrixOrderedResults = reportCompactMode
  ? [...providerMatrixAllResults].sort((a, b) => {
      const rank = (item) => {
        const status = String(item && item.status ? item.status : '').toLowerCase();
        if (status === 'failed') return 0;
        if (status === 'blocked') return 1;
        if (status === 'passed') return 2;
        return 3;
      };
      const rankDiff = rank(a) - rank(b);
      if (rankDiff !== 0) return rankDiff;
      return String(a.provider || '').localeCompare(String(b.provider || ''));
    })
  : providerMatrixAllResults;
const providerMatrixSlice = sliceWithMeta(providerMatrixOrderedResults, providerMatrixRowsLimit);
const providerMatrixResults = providerMatrixSlice.items;
const providerMatrixOmitted = providerMatrixSlice.omitted;
const depositInventoryArtifact = readCurrentRunJson(depositInventoryArtifactPath);
const depositInventorySummary = summarizeDepositInventory(depositInventoryArtifact);
const depositArtifact = readCurrentRunJson(depositArtifactPath);
const depositSummary = summarizeDepositArtifact(depositArtifact);
const depositInventoryCoverageBlocked = Boolean(
  depositInventoryArtifact && depositInventoryArtifact.blocked
);
const depositMethodCoverageBlocked = Boolean(depositArtifact && depositArtifact.blocked);
const depositInventoryCoverageReason = blockedReasonText(
  (depositInventoryArtifact && depositInventoryArtifact.reason) || ''
);
const depositMethodCoverageReason = blockedReasonText(
  (depositArtifact && depositArtifact.reason) || ''
);
const authStateHealthEntriesMd =
  authStateHealth && Array.isArray(authStateHealth.entries) && authStateHealth.entries.length
    ? authStateHealth.entries.map(
        (entry) =>
          `| ${escapeMdCell(entry.path ? toRelative(entry.path) : '-')} | ${yesNo(entry.exists)} | ${yesNo(
            entry.fresh
          )} | ${escapeMdCell(entry.ageSec == null ? '-' : `${entry.ageSec}s`)} | ${escapeMdCell(
            `${Number(entry.cookiesCount || 0)}/${Number(entry.originsCount || 0)}`
          )} | ${yesNo(entry.hasSessionArtifacts)} | ${escapeMdCell(oneLine(entry.parseError || '-') || '-')} |`
      )
    : ['| - | - | - | - | - | - | - |'];
const authStateHealthMd = authStateHealth
  ? [
      '## Auth State Health',
      '',
      renderSectionIntroMd('Auth State Health').trim(),
      '',
      '| Metric | Value |',
      '| --- | --- |',
      `| Checked At | ${escapeMdCell(authStateHealth.checkedAt || '-')} |`,
      `| Phase | ${escapeMdCell(authStateHealth.phase || '-')} |`,
      `| Max Age | ${escapeMdCell(authStateHealth.maxAgeSec ? `${authStateHealth.maxAgeSec}s` : '-')} |`,
      `| Selected Path | ${escapeMdCell(
        authStateHealth.selectedPath ? toRelative(authStateHealth.selectedPath) : '-'
      )} |`,
      `| Selected Modified At | ${escapeMdCell(authStateHealth.selectedModifiedAt || '-')} |`,
      `| Selected Age | ${escapeMdCell(
        authStateHealth.selectedAgeSec == null ? '-' : `${authStateHealth.selectedAgeSec}s`
      )} |`,
      `| Selected Fresh | ${yesNo(authStateHealth.selectedFresh)} |`,
      `| Selected Session Artifacts | ${yesNo(authStateHealth.selectedHasSessionArtifacts)} |`,
      `| Selected Cookies/Origins | ${escapeMdCell(
        `${Number(authStateHealth.selectedCookiesCount || 0)}/${Number(
          authStateHealth.selectedOriginsCount || 0
        )}`
      )} |`,
      `| Refresh Triggered | ${yesNo(authStateHealth.refreshTriggered)} |`,
      `| Refresh Reason | ${escapeMdCell(oneLine(authStateHealth.refreshReason || '-') || '-')} |`,
      `| Healthy | ${yesNo(authStateHealth.healthy)} |`,
      '',
      '| Candidate Path | Exists | Fresh | Age | Cookies/Origins | Session Artifacts | Parse Error |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...authStateHealthEntriesMd,
      '',
    ].join('\n')
  : '';
const kpiChecks = Array.isArray(kpiValidation && kpiValidation.checks) ? kpiValidation.checks : [];
const kpiFailedChecks = Array.isArray(kpiValidation && kpiValidation.failedChecks)
  ? kpiValidation.failedChecks
  : [];
const isKpiWaivedUnmet = (item) =>
  Boolean(
    item &&
    (item.waived === true ||
      (item.applicable === false && /\bwaived\b/i.test(String(item.detail || ''))))
  );
const kpiWaivedChecks = Array.isArray(kpiValidation && kpiValidation.waivedChecks)
  ? kpiValidation.waivedChecks
  : kpiChecks.filter(isKpiWaivedUnmet);
const qualityGate = (() => {
  const kpiFailed = Boolean(kpiValidation && kpiValidation.valid === false);
  const releaseCriticalBlocked = tests.filter((test) => {
    if (!hasAnnotation(test, 'blocked')) return false;
    const section = resolveSection(test);
    return ['Registration', 'Login', 'Deposit'].includes(section);
  });
  if (effectiveFailedCount > 0 || kpiFailed || releaseCriticalBlocked.length > 0) {
    return {
      verdict: 'NO-GO',
      cssClass: 'decision-no-go',
      summary: `${Math.max(0, effectiveFailedCount)} hard failure(s); ${releaseCriticalBlocked.length} release-critical blocked check(s); KPI: ${formatKpiVerdict(kpiValidation)}. Release confidence is insufficient.`,
    };
  }
  if (
    signalTotals.testInfraTimeout > 0 ||
    signalTotals.blocked > 0 ||
    signalTotals.partial > 0 ||
    signalTotals.weakSurface > 0 ||
    !['PASSED'].includes(runStatus)
  ) {
    return {
      verdict: 'CONDITIONAL',
      cssClass: 'decision-conditional',
      summary: `No hard failures and KPI passed, but ${signalTotals.testInfraTimeout} test-infrastructure timeout(s), ${signalTotals.blocked} blocked signal(s), ${signalTotals.partial} partial check(s), and ${signalTotals.weakSurface} weak-surface signal(s) limit confidence.`,
    };
  }
  return {
    verdict: 'GO',
    cssClass: 'decision-go',
    summary:
      'No hard failures, failed KPI checks, blocked signals, or test-infrastructure timeouts were detected.',
  };
})();
const previousRun = readPreviousComparableRun(
  path.join(projectPaths.artifactsDir, 'history', 'runs'),
  executionJournal && executionJournal.runId,
  generatedAt
);
const previousTotals = (previousRun && previousRun.totals) || {};
const currentProviderPassed = Number(providerMatrixSummary.passed || 0);
const previousProviderPassed = Number(
  (findKpiCheck(previousRun && previousRun.kpi, 'provider-passed') || {}).actual
);
const comparisonMetrics = [
  {
    label: 'Hard failures',
    current: Math.max(0, effectiveFailedCount),
    previous: previousTotals.failed,
    lowerIsBetter: true,
  },
  {
    label: 'Blocked signals',
    current: signalTotals.blocked,
    previous: previousTotals.blockedSignals,
    lowerIsBetter: true,
  },
  {
    label: 'External infrastructure',
    current: signalTotals.infraBlocked,
    previous: previousTotals.infraBlockedSignals,
    lowerIsBetter: true,
  },
  {
    label: 'Test infrastructure timeouts',
    current: signalTotals.testInfraTimeout,
    previous: previousTotals.testInfraTimeoutSignals,
    lowerIsBetter: true,
  },
  {
    label: 'Product limitations',
    current: signalTotals.productBlocked,
    previous: previousTotals.productBlockedSignals,
    lowerIsBetter: true,
  },
  {
    label: 'Not applicable',
    current: signalTotals.notApplicable,
    previous: previousTotals.notApplicableSignals,
    lowerIsBetter: null,
  },
  {
    label: 'Partial coverage',
    current: signalTotals.partial,
    previous: previousTotals.partialSignals,
    lowerIsBetter: true,
  },
  {
    label: 'Provider launches passed',
    current: currentProviderPassed,
    previous: Number.isFinite(previousProviderPassed) ? previousProviderPassed : null,
    lowerIsBetter: false,
  },
].map((item) => ({ ...item, delta: signedDelta(item.current, item.previous) }));
const issueCategories = [
  {
    category: 'Hard failures',
    count: Math.max(0, effectiveFailedCount),
    severity: effectiveFailedCount > 0 ? 'Critical' : 'OK',
    meaning: 'Product assertion failed without an accepted limitation or infrastructure cause.',
    action: effectiveFailedCount > 0 ? 'Block release and investigate failed tests.' : 'No action.',
  },
  {
    category: 'Product limitations',
    count: signalTotals.productBlocked,
    severity: signalTotals.productBlocked > 0 ? 'High' : 'OK',
    meaning: 'Expected user flow is unavailable or incomplete in the product.',
    action: signalTotals.productBlocked > 0 ? 'Create or update product defects.' : 'No action.',
  },
  {
    category: 'Test infrastructure',
    count: signalTotals.testInfraTimeout,
    severity: signalTotals.testInfraTimeout > 0 ? 'High' : 'OK',
    meaning: 'The check timed out or the automation could not collect conclusive evidence.',
    action:
      signalTotals.testInfraTimeout > 0
        ? 'Stabilize the affected test path and rerun.'
        : 'No action.',
  },
  {
    category: 'External infrastructure',
    count: signalTotals.infraBlocked,
    severity: signalTotals.infraBlocked > 0 ? 'Medium' : 'OK',
    meaning: 'WAF, provider, network, or another external dependency limited coverage.',
    action:
      signalTotals.infraBlocked > 0
        ? 'Retry in an allowed environment and preserve evidence.'
        : 'No action.',
  },
  {
    category: 'Partial coverage',
    count: signalTotals.partial,
    severity: signalTotals.partial > 0 ? 'Medium' : 'OK',
    meaning: 'Only part of the intended scenario was verified.',
    action:
      signalTotals.partial > 0
        ? 'Review gaps before treating the run as full coverage.'
        : 'No action.',
  },
  {
    category: 'Not applicable',
    count: signalTotals.notApplicable,
    severity: 'Info',
    meaning: 'The feature or condition does not apply to this brand or platform.',
    action: 'Confirm the exclusion is expected and keep it visible in scope.',
  },
];
const executionStepRows = tests.flatMap((test, testIndex) => {
  const scenarioStatus = resolveScenarioStatus(test);
  const scenarioRow = {
    number: testIndex + 1,
    phase: test.phase || '-',
    section: resolveSection(test),
    type: 'Scenario',
    title: test.title || test.titlePath || '(untitled)',
    status: scenarioStatus,
    duration: Number(test.duration || 0),
    flags: flagsMd(test),
    depth: 0,
  };
  const explicitSteps = (test.steps || []).map((step) => ({
    number: '',
    phase: test.phase || '-',
    section: resolveSection(test),
    type: 'Playwright step',
    title: step.title,
    status: step.status,
    duration: Number(step.duration || 0),
    flags: step.error || '-',
    depth: Number(step.depth || 0) + 1,
  }));
  return [scenarioRow, ...explicitSteps];
});
const explicitStepCount = executionStepRows.filter(
  (item) => item.type === 'Playwright step'
).length;
const testsWithExplicitSteps = tests.filter((test) => (test.steps || []).length > 0).length;
const scenarioStatusCounts = tests.reduce((acc, test) => {
  const status = resolveScenarioStatus(test);
  acc[status] = Number(acc[status] || 0) + 1;
  return acc;
}, {});
const kpiRowsMd = kpiChecks.length
  ? kpiChecks.map(
      (item) =>
        `| ${escapeMdCell(item.label || item.id || '-')} | ${yesNo(item.applicable !== false)} | ${
          isKpiWaivedUnmet(item) ? 'Waived (unmet)' : yesNo(item.passed)
        } | ${escapeMdCell(item.actual)} | ${escapeMdCell(item.threshold)} | ${escapeMdCell(
          oneLine(item.detail || '-') || '-'
        )} |`
    )
  : ['| - | - | - | - | - | - |'];
const kpiValidationMd = kpiValidation
  ? [
      '## Run KPI Validation',
      '',
      renderSectionIntroMd('Run KPI Validation').trim(),
      '',
      '| Metric | Value |',
      '| --- | --- |',
      `| Generated At | ${escapeMdCell(kpiValidation.generatedAt || '-')} |`,
      `| Verdict | ${escapeMdCell(formatKpiVerdict(kpiValidation))} |`,
      `| Failed Checks | ${kpiFailedChecks.length} |`,
      `| Waived Unmet Checks | ${kpiWaivedChecks.length} |`,
      `| Blocked Ratio | ${escapeMdCell(
        formatPercent(
          Number((kpiValidation.totals && kpiValidation.totals.blockedSignals) || 0) /
            Math.max(1, Number((kpiValidation.totals && kpiValidation.totals.total) || 0))
        )
      )} |`,
      `| Infra Blocked Ratio | ${escapeMdCell(
        formatPercent(
          Number((kpiValidation.totals && kpiValidation.totals.infraBlockedSignals) || 0) /
            Math.max(1, Number((kpiValidation.totals && kpiValidation.totals.total) || 0))
        )
      )} |`,
      '',
      '| Check | Applicable | Passed | Actual | Threshold | Detail |',
      '| --- | --- | --- | --- | --- | --- |',
      ...kpiRowsMd,
      '',
    ].join('\n')
  : '';
const mobileTopReasonRowsMd = mobileTopReasons.length
  ? mobileTopReasons.map(
      (entry) =>
        `| ${escapeMdCell(entry.reason)} | ${Number(entry.count || 0)} | ${escapeMdCell(
          formatPercent(Number(entry.count || 0) / mobileTopReasonsTotal, 1)
        )} |`
    )
  : ['| - | 0 | 0.0% |'];
const mobileStabilityMd = showMobileStability
  ? [
      '## Mobile Stability',
      '',
      renderSectionIntroMd('Mobile Stability').trim(),
      '',
      '| Metric | Value |',
      '| --- | --- |',
      `| Execution Mode | ${escapeMdCell(executionMode || '-')} |`,
      `| Mobile Tests | ${mobileTotals.total} |`,
      `| Mobile Passed | ${mobileTotals.passed} |`,
      `| Mobile Failed | ${mobileTotals.failed} |`,
      `| Mobile Timed Out | ${mobileTimedOutCount} |`,
      `| Mobile Blocked Signals | ${mobileBlockedCount} |`,
      `| Mobile Infra Blocked | ${mobileInfraBlockedCount} |`,
      `| Mobile Provider Blocked | ${mobileProviderBlockedCount} |`,
      '',
      '| Top Reason | Count | Share |',
      '| --- | --- | --- |',
      ...mobileTopReasonRowsMd,
      '',
    ].join('\n')
  : '';
const registrationPlayerMd = (() => {
  const primaryEmail =
    registrationOutcome.currentManualLoginEmail ||
    registrationOutcome.manualLoginPlayerEmail ||
    registrationOutcome.playerEmail ||
    '-';
  const primaryPassword = registrationOutcome.currentManualLoginPassword || '-';
  const sourcePath = formatPathForDisplay(registration.path || manualLoginPlayerDataSource || '-');

  return [
    '## Registration & Player',
    '',
    renderSectionIntroMd('Registration & Player').trim(),
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Registration Test Present | ${yesNo(registrationOutcome.testFound)} |`,
    `| Registration Coverage State | ${escapeMdCell(registrationOutcome.coverageState)} |`,
    `| Registration Test Status | ${escapeMdCell(registrationOutcome.testStatus)} |`,
    `| Registration Test Raw Status | ${escapeMdCell(registrationOutcome.rawTestStatus)} |`,
    `| Registration Blocked/Incomplete Reason | ${escapeMdCell(registrationOutcome.blockedReason)} |`,
    `| New Player Registered In This Run | ${yesNo(registrationOutcome.newPlayerRegisteredInRun)} |`,
    `| Player Data Belongs To Current Run | ${yesNo(registrationOutcome.playerDataFromCurrentRun)} |`,
    `| Manual Password Login Ready | ${yesNo(registrationOutcome.manualLoginReady)} |`,
    `| Login Validation Status | ${escapeMdCell(registrationOutcome.loginValidationStatus)} |`,
    `| Login Validation At | ${escapeMdCell(registrationOutcome.loginValidationAt)} |`,
    `| Latest Login Attempt Status | ${escapeMdCell(registrationOutcome.lastLoginCheckStatus)} |`,
    `| Latest Login Attempt Method | ${escapeMdCell(registrationOutcome.lastLoginCheckMethod)} |`,
    `| Latest Login Attempt Reason | ${escapeMdCell(registrationOutcome.lastLoginCheckReason)} |`,
    `| Latest Login Attempt At | ${escapeMdCell(registrationOutcome.lastLoginCheckAt)} |`,
    `| Manual Login Player Available | ${yesNo(registrationOutcome.manualLoginPlayerAvailable)} |`,
    `| Email For Manual Login | ${escapeCredentialMdCell(primaryEmail)} |`,
    `| Password For Manual Login | ${escapeCredentialMdCell(primaryPassword)} |`,
    `| Player Generated At | ${escapeMdCell(registrationOutcome.playerGeneratedAt)} |`,
    `| Data Source | ${escapeMdCell(sourcePath)} |`,
    `| Source Test | ${escapeMdCell(registrationOutcome.sourceTest)} |`,
    '',
  ].join('\n');
})();
const providerMatrixMd =
  providerMatrixAllResults.length || providerMatrix
    ? [
        '## Casino Providers Matrix',
        '',
        renderSectionIntroMd('Casino Providers Matrix').trim(),
        '',
        '| Metric | Value |',
        '| --- | --- |',
        `| Target Providers Declared | ${providerMatrixSummary.targetDeclared} |`,
        `| Provider Results Captured | ${providerMatrixSummary.resultsCaptured} |`,
        `| Providers Discovered On Brand | ${providerMatrixSummary.providersDiscovered || '-'} |`,
        `| Discovered But Not Launch-Tested | ${providerMatrixSummary.discoveredUntested.length} |`,
        `| Discovered But Not Launch-Tested (preview) | ${escapeMdCell(
          providerMatrixSummary.discoveredUntested.slice(0, 12).join(', ') || '-'
        )} |`,
        `| Functional Passed | ${providerMatrixSummary.passed} |`,
        `| Passed Strong | ${providerMatrixSummary.passedStrong} |`,
        `| Passed Weak Surface | ${providerMatrixSummary.passedWeakSurface} |`,
        `| Failed | ${providerMatrixSummary.failed} |`,
        `| Blocked | ${providerMatrixSummary.blocked} |`,
        `| Provider Absent | ${providerMatrixSummary.blockedProviderAbsent} |`,
        `| Provider Launch Blocked | ${providerMatrixSummary.blockedProviderLaunch} |`,
        `| Infrastructure WAF Blocked | ${providerMatrixSummary.blockedInfraWaf} |`,
        `| Blocked Other | ${providerMatrixSummary.blockedOther} |`,
        `| Retried and Recovered | ${providerMatrixSummary.retriedRecovered} |`,
        `| Providers With Optional Stage Timeout | ${providerMatrixSummary.optionalStageTimeoutProviders} |`,
        `| Optional Stage Timeouts | ${providerMatrixSummary.optionalStageTimeouts} |`,
        `| Rows In Report | ${providerMatrixResults.length} |`,
        `| Omitted Rows | ${providerMatrixOmitted} |`,
        '',
        '| Provider | Status | Outcome | Launch | Surface | Controls | Примечание |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...providerMatrixResults.map(
          (item) =>
            `| ${escapeMdCell(item.provider)} | ${escapeMdCell(item.status)} | ${escapeMdCell(
              item.outcome || '-'
            )} | ${escapeMdCell(item.launchState || '-')} | ${escapeMdCell(
              item.gameSurface || '-'
            )} | ${escapeMdCell(item.controlsClicked || 0)} | ${escapeMdCell(
              translateProviderNote(item.reason || '-')
            )} |`
        ),
        ...(providerMatrixOmitted > 0
          ? [
              `| ... | ... | ... | ... | ... | ... | ${escapeMdCell(
                `В компактном отчёте скрыто строк провайдеров: ${providerMatrixOmitted}.`
              )} |`,
            ]
          : []),
        '',
      ].join('\n')
    : `## Casino Providers Matrix\n\n${renderSectionIntroMd('Casino Providers Matrix')}Provider matrix artifact not found.\n\n`;
const depositCoverageMd = (() => {
  const inventoryBlocked = depositInventoryCoverageBlocked;
  const methodsBlocked = depositMethodCoverageBlocked;
  const overallState =
    inventoryBlocked && methodsBlocked
      ? depositInventorySummary.apiCoverageAvailable || depositSummary.apiCoverageAvailable
        ? 'blocked-ui / api-only'
        : 'blocked'
      : inventoryBlocked || methodsBlocked
        ? 'partial'
        : 'ready';
  const reasons = [
    inventoryBlocked ? `Inventory: ${depositInventoryCoverageReason}` : '',
    methodsBlocked ? `Methods: ${depositMethodCoverageReason}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  const apiCategoriesPreview = depositInventorySummary.apiCategories.slice(0, 8);
  const uiCategoriesPreview = depositInventorySummary.uiCategories.slice(0, 8);
  const readyMethodsPreview = depositSummary.results
    .filter((item) => item.surfaceReady)
    .map((item) => item.method)
    .filter(Boolean)
    .slice(0, 8);
  const checkedMethodsPreview = depositSummary.results
    .map((item) => item.method)
    .filter(Boolean)
    .slice(0, 8);
  const availableMethods = depositSummary.discoveredMethods.length
    ? depositSummary.discoveredMethods
    : depositSummary.checkedMethods;
  const availableMethodsMd =
    !reportCompactMode && availableMethods.length
      ? [
          '',
          '### Available Deposit Methods',
          '',
          '| # | Method |',
          '| --- | --- |',
          ...availableMethods.map((method, index) => `| ${index + 1} | ${escapeMdCell(method)} |`),
          '',
        ]
      : [];

  return [
    '## Deposit Coverage',
    '',
    renderSectionIntroMd('Deposit Coverage').trim(),
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Coverage State | ${overallState} |`,
    `| Inventory Blocked | ${yesNo(inventoryBlocked)} |`,
    `| Methods Blocked | ${yesNo(methodsBlocked)} |`,
    `| Blocked Reason | ${escapeMdCell(reasons || '-')} |`,
    `| API Coverage Available | ${yesNo(depositInventorySummary.apiCoverageAvailable || depositSummary.apiCoverageAvailable)} |`,
    `| UI Coverage Available | ${blockedAwareBool(depositInventorySummary.uiCoverageAvailable, inventoryBlocked)} |`,
    `| API Categories | ${depositInventorySummary.apiCategories.length} |`,
    `| UI Categories | ${blockedAwareCount(depositInventorySummary.uiCategories.length, inventoryBlocked)} |`,
    `| Methods Discovered | ${depositSummary.discoveredCount} |`,
    `| Methods Checked | ${depositSummary.checkedCount} |`,
    `| Methods Ready | ${blockedAwareCount(depositSummary.readyCount, methodsBlocked)} |`,
    `| Submit Visible | ${blockedAwareBool(depositSummary.submitVisible, methodsBlocked)} |`,
    `| Submit Enabled | ${blockedAwareBool(depositSummary.submitEnabled, methodsBlocked)} |`,
    `| API Categories (preview) | ${escapeMdCell(blockedAwareList(apiCategoriesPreview, inventoryBlocked))} |`,
    `| UI Categories (preview) | ${escapeMdCell(blockedAwareList(uiCategoriesPreview, inventoryBlocked))} |`,
    `| Ready Methods (preview) | ${escapeMdCell(blockedAwareList(readyMethodsPreview, methodsBlocked))} |`,
    `| Checked Methods (preview) | ${escapeMdCell(blockedAwareList(checkedMethodsPreview, methodsBlocked))} |`,
    `| Available Methods Source | ${escapeMdCell(depositSummary.sourceMode || '-')} |`,
    ...availableMethodsMd,
    '',
  ].join('\n');
})();
const liveChatMd = liveChatSection
  ? [
      '## Live Chat',
      '',
      renderSectionIntroMd('Live Chat').trim(),
      '',
      '| Metric | Value |',
      '| --- | --- |',
      `| Total | ${liveChatSection.totals.total} |`,
      `| Passed | ${liveChatSection.totals.passed} |`,
      `| Failed | ${liveChatSection.totals.failed} |`,
      `| Skipped | ${liveChatSection.totals.skipped} |`,
      `| Blocked | ${liveChatSection.tests.filter((test) => hasAnnotation(test, 'blocked')).length} |`,
      `| Duration | ${formatDuration(liveChatSection.durationMs)} |`,
      '',
      '| Status | Flags | Test | Location | Duration | Note |',
      '| --- | --- | --- | --- | --- | --- |',
      ...liveChatSection.tests.map((t) => {
        const locStr = formatLocation(t);
        return `| ${escapeMdCell(t.status)} | ${escapeMdCell(flagsMd(t))} | ${escapeMdCell(
          t.titlePath || t.title
        )} | ${escapeMdCell(locStr)} | ${escapeMdCell(formatDuration(t.duration))} | ${escapeMdCell(
          noteSummary(t)
        )} |`;
      }),
      '',
    ].join('\n')
  : `## Live Chat\n\n${renderSectionIntroMd('Live Chat')}No live chat tests were present in the collected reports.\n\n`;
const sidebarMd = sidebarSection
  ? [
      '## Sidebar',
      '',
      renderSectionIntroMd('Sidebar').trim(),
      '',
      '| Metric | Value |',
      '| --- | --- |',
      `| Total | ${sidebarSection.totals.total} |`,
      `| Passed | ${sidebarSection.totals.passed} |`,
      `| Failed | ${sidebarSection.totals.failed} |`,
      `| Skipped | ${sidebarSection.totals.skipped} |`,
      `| Blocked | ${sidebarSection.tests.filter((test) => hasAnnotation(test, 'blocked')).length} |`,
      `| Duration | ${formatDuration(sidebarSection.durationMs)} |`,
      '',
      '| Status | Flags | Test | Location | Duration | Note |',
      '| --- | --- | --- | --- | --- | --- |',
      ...sidebarSection.tests.map((t) => {
        const locStr = formatLocation(t);
        return `| ${escapeMdCell(t.status)} | ${escapeMdCell(flagsMd(t))} | ${escapeMdCell(
          t.titlePath || t.title
        )} | ${escapeMdCell(locStr)} | ${escapeMdCell(formatDuration(t.duration))} | ${escapeMdCell(
          noteSummary(t)
        )} |`;
      }),
      '',
    ].join('\n')
  : `## Sidebar\n\n${renderSectionIntroMd('Sidebar')}No sidebar tests were present in the collected reports.\n\n`;

let md = `# QA Report - ${brandName}\n\n`;
md += `Generated: ${generatedAt}\n\n`;
md += `Brand: ${brandName}\n\n`;
md += `Platform: **${platformLabel}**\n\n`;
md += `Run status: **${runStatus}**\n\n`;
md += '## Quality Gate\n\n';
md += `**Decision: ${qualityGate.verdict}**\n\n`;
md += `${qualityGate.summary}\n\n`;
md += '| Decision input | Result |\n';
md += '| --- | --- |\n';
md += `| Hard failures | ${Math.max(0, effectiveFailedCount)} |\n`;
md += `| KPI verdict | ${escapeMdCell(formatKpiVerdict(kpiValidation))} |\n`;
md += `| Blocked signals | ${signalTotals.blocked} |\n`;
md += `| Test infrastructure timeouts | ${signalTotals.testInfraTimeout} |\n`;
md += `| Strict clean evidence | ${signalTotals.strictClean}/${totals.total} |\n\n`;
md += '### Key Findings\n\n';
if (quickHighlights.length) {
  for (const item of quickHighlights) {
    md += `- ${item}\n`;
  }
} else {
  md += '- No run highlights available.\n';
}
md += '\n';
md += '## Previous Run Comparison\n\n';
if (previousRun) {
  md += `Previous run: ${escapeMdCell(previousRun.timestamp || previousRun.runId || '-')}\n\n`;
  md += '| Metric | Current | Previous | Delta |\n';
  md += '| --- | --- | --- | --- |\n';
  for (const item of comparisonMetrics) {
    md += `| ${escapeMdCell(item.label)} | ${escapeMdCell(item.current)} | ${escapeMdCell(
      Number.isFinite(Number(item.previous)) ? item.previous : '-'
    )} | ${escapeMdCell(formatSignedNumber(item.delta))} |\n`;
  }
  md += '\n';
  md +=
    'Deltas show classification changes as well as real product changes; review the issue categories before interpreting them as improvement or regression.\n\n';
} else {
  md += 'No earlier comparable run was found for this brand and platform.\n\n';
}
md += '## Issue Categories\n\n';
md += '| Category | Count | Severity | Meaning | Next action |\n';
md += '| --- | --- | --- | --- | --- |\n';
for (const item of issueCategories) {
  md += `| ${escapeMdCell(item.category)} | ${item.count} | ${escapeMdCell(
    item.severity
  )} | ${escapeMdCell(item.meaning)} | ${escapeMdCell(item.action)} |\n`;
}
md +=
  '\nCounts are diagnostic signals and may overlap; they must not be added together as unique failed tests.\n\n';
md += '## Run Overview\n\n';
md += '| Metric | Value |\n';
md += '| --- | --- |\n';
md += `| Total | ${totals.total} |\n`;
md += `| Raw Playwright Passed/Completed | ${totals.passed} |\n`;
md += `| Strict Clean Functional Evidence | ${signalTotals.strictClean} |\n`;
md += `| Strict Clean Evidence Ratio | ${formatPercent(
  Number(signalTotals.strictClean || 0) / Math.max(1, Number(totals.total || 0)),
  1
)} |\n`;
md += `| Failed | ${totals.failed} |\n`;
md += `| Skipped | ${totals.skipped} |\n`;
md += `| Flaky | ${totals.flaky} |\n`;
md += `| Blocked Signals | ${signalTotals.blocked} |\n`;
md += `| Blocked Ratio | ${formatPercent(blockedRatio, 1)} |\n`;
md += `| Failed Ratio | ${formatPercent(failedRatio, 1)} |\n`;
md += `| Infra Blocked Signals | ${signalTotals.infraBlocked} |\n`;
md += `| Test Infra Timeouts | ${signalTotals.testInfraTimeout} |\n`;
md += `| Product Blocked Signals | ${signalTotals.productBlocked} |\n`;
md += `| Product Warning Signals | ${signalTotals.productWarnings} |\n`;
md += `| N/A Signals | ${signalTotals.notApplicable} |\n`;
md += `| Partial Coverage Signals | ${signalTotals.partial} |\n`;
md += `| Test-level Retried Signals | ${signalTotals.retried} |\n`;
md += `| Orchestration Attempts | ${executionAttempts.length || '-'} |\n`;
md += `| Playwright Attempts | ${orchestrationPlaywrightAttempts || '-'} |\n`;
md += `| storageState Refresh Attempts | ${orchestrationStorageStateAttempts} |\n`;
md += `| Failed storageState Refresh Attempts | ${orchestrationStorageStateFailedAttempts} |\n`;
md += `| Orchestration Retry Attempts | ${orchestrationRetryAttempts} |\n`;
md += `| Failed Attempts Before Final Result | ${orchestrationFailedAttempts} |\n`;
md += `| WAF-affected Attempts | ${orchestrationWafAttempts} |\n`;
md += `| Recovered Phases | ${escapeMdCell(recoveredPhases.join(', ') || '-')} |\n`;
md += `| Weak Surface Signals | ${signalTotals.weakSurface} |\n`;
md += `| Provider Absent Signals | ${signalTotals.providerAbsent} |\n`;
md += `| KPI Verdict | ${escapeMdCell(formatKpiVerdict(kpiValidation))} |\n`;
md += `| KPI Failed Checks | ${
  kpiValidation && Array.isArray(kpiValidation.failedChecks)
    ? kpiValidation.failedChecks.length
    : 'N/A'
} |\n`;
md += `| KPI Waived Unmet Checks | ${kpiWaivedChecks.length} |\n`;
md += `| Registration Coverage State | ${escapeMdCell(registrationOutcome.coverageState)} |\n`;
md += `| New Player Registered In This Run | ${yesNo(registrationOutcome.newPlayerRegisteredInRun)} |\n`;
md += `| Manual Login Player Available | ${yesNo(registrationOutcome.manualLoginPlayerAvailable)} |\n`;
md += `| Report Compact Mode | ${yesNo(reportCompactMode)} |\n`;
md += `| Final Phase Test Duration | ${formatDuration(durationMs)} |\n`;
md += `| End-to-end Orchestration Duration | ${formatDuration(orchestrationDurationMs)} |\n\n`;

md += '## Execution Steps & Statuses\n\n';
md +=
  'Каждый Scenario — выполненный автотест. Вложенные Playwright step — реальные шаги, записанные через `test.step`; для сценариев без такой инструментации внутренние шаги не выдумываются.\n\n';
md += '| Metric | Value |\n';
md += '| --- | --- |\n';
md += `| Executed scenarios | ${tests.length} |\n`;
md += `| Scenarios with explicit Playwright steps | ${testsWithExplicitSteps} |\n`;
md += `| Explicit Playwright steps recorded | ${explicitStepCount} |\n`;
md += `| Scenario PASSED | ${Number(scenarioStatusCounts.PASSED || 0)} |\n`;
md += `| Scenario BLOCKED (all types) | ${
  executionStepRows.filter(
    (item) => item.type === 'Scenario' && /BLOCKED|TEST INFRA/.test(item.status)
  ).length
} |\n`;
md += `| Scenario PARTIAL | ${Number(scenarioStatusCounts.PARTIAL || 0)} |\n`;
md += `| Scenario N/A | ${Number(scenarioStatusCounts['N/A'] || 0)} |\n\n`;
md += '| # | Phase | Section | Type | Step / Scenario | Status | Duration | Flags / Error |\n';
md += '| --- | --- | --- | --- | --- | --- | --- | --- |\n';
for (const item of executionStepRows) {
  const title = `${item.depth > 0 ? `${'↳ '.repeat(item.depth)}` : ''}${item.title}`;
  md += `| ${item.number || ''} | ${escapeMdCell(item.phase)} | ${escapeMdCell(
    item.section
  )} | ${escapeMdCell(item.type)} | ${escapeMdCell(title)} | ${escapeMdCell(
    item.status
  )} | ${escapeMdCell(formatDuration(item.duration))} | ${escapeMdCell(item.flags)} |\n`;
}
md += '\n';

if (mobileStabilityMd) {
  md += mobileStabilityMd;
  md += '\n';
}

md += '## Sections\n\n';
md += renderSectionIntroMd('Sections');
md += '| Section | Total | Passed | Failed | Skipped | Blocked | Partial | Duration |\n';
md += '| --- | --- | --- | --- | --- | --- | --- | --- |\n';
for (const section of sectionSummary) {
  const blockedCount = section.tests.filter((test) => hasAnnotation(test, 'blocked')).length;
  const partialCount = section.tests.filter(
    (test) => hasAnnotation(test, 'partial') || hasAnnotation(test, 'deposit-method-limit')
  ).length;
  md += `| ${escapeMdCell(section.section)} | ${section.totals.total} | ${section.totals.passed} | ${
    section.totals.failed
  } | ${section.totals.skipped} | ${blockedCount} | ${partialCount} | ${escapeMdCell(
    formatDuration(section.durationMs)
  )} |\n`;
}
md += '\n';

if (sectionDetailRowsLimit <= 0) {
  md += '### Section Details\n\n';
  md += 'Detailed section rows are omitted in compact mode.\n\n';
} else {
  for (const section of sectionDetails) {
    md += `### ${section.section}\n\n`;
    md += renderSectionIntroMd(section.section);
    md += '| Status | Flags | Test | Location | Duration | Note |\n';
    md += '| --- | --- | --- | --- | --- | --- |\n';
    for (const t of section.detailTests) {
      const locStr = formatLocation(t);
      md += `| ${escapeMdCell(t.status)} | ${escapeMdCell(flagsMd(t))} | ${escapeMdCell(
        t.titlePath || t.title
      )} | ${escapeMdCell(locStr)} | ${escapeMdCell(formatDuration(t.duration))} | ${escapeMdCell(
        noteSummary(t)
      )} |\n`;
    }
    if (section.detailOmitted > 0) {
      md += `| - | - | _Omitted rows_ | - | - | ${escapeMdCell(
        `Showing ${section.detailTests.length} of ${section.detailSourceCount}; omitted ${section.detailOmitted}.`
      )} |\n`;
    }
    md += '\n';
  }
}

md += registrationPlayerMd;
md += providerMatrixMd;
md += depositCoverageMd;
if (authStateHealthMd) md += authStateHealthMd;
if (kpiValidationMd) md += kpiValidationMd;
md += sidebarMd;
md += liveChatMd;

if (failed.length) {
  md += '## Failed Tests\n\n';
  md += renderSectionIntroMd('Failed Tests');
  let idx = 1;
  for (const t of failed) {
    const locStr = formatLocation(t);
    md += `### ${idx}. ${t.titlePath || t.title}\n\n`;
    md += `- Phase: ${t.phase}\n`;
    md += `- Status: ${t.status}\n`;
    md += `- Location: ${locStr}\n`;
    md += `- Duration: ${formatDuration(t.duration)}\n`;
    md += `- Error: ${oneLine(t.error) || '-'}\n`;
    md += `- Flags: ${flagsMd(t)}\n`;
    md += `- Attachments: ${attachmentLinksMd(t.attachments)}\n\n`;
    idx += 1;
  }
}

if (registrationNetwork) {
  const responseErrors = Array.isArray(registrationNetwork.responseErrors)
    ? registrationNetwork.responseErrors
    : [];
  const failedRequests = Array.isArray(registrationNetwork.failedRequests)
    ? registrationNetwork.failedRequests
    : [];
  const consoleErrors = Array.isArray(registrationNetwork.consoleErrors)
    ? registrationNetwork.consoleErrors
    : [];
  const toastErrors = Array.isArray(registrationNetwork.toastErrors)
    ? registrationNetwork.toastErrors
    : [];
  const authResponses = Array.isArray(registrationNetwork.authResponses)
    ? registrationNetwork.authResponses
    : [];

  md += '## Registration Diagnostics\n\n';

  if (responseErrors.length) {
    md += '### API Errors\n\n';
    for (const err of responseErrors) {
      const req = `${err.method || ''} ${err.url || ''}`.trim();
      const status = `${err.status || ''} ${err.statusText || ''}`.trim();
      md += `- ${req} (${status})${err.body ? ` -> ${oneLine(err.body).slice(0, 200)}` : ''}\n`;
    }
    md += '\n';
  }

  if (failedRequests.length) {
    md += '### Failed Requests\n\n';
    for (const req of failedRequests) {
      md += `- ${(req.method || '').trim()} ${(req.url || '').trim()} ${oneLine(req.errorText || '')}\n`;
    }
    md += '\n';
  }

  if (consoleErrors.length) {
    md += '### Console Errors\n\n';
    for (const message of consoleErrors) {
      md += `- ${oneLine(message)}\n`;
    }
    md += '\n';
  }

  if (toastErrors.length) {
    md += '### Toast Errors\n\n';
    for (const message of toastErrors) {
      md += `- ${oneLine(message)}\n`;
    }
    md += '\n';
  }

  if (authResponses.length) {
    md += '### Auth Responses\n\n';
    for (const response of authResponses) {
      const req = `${response.method || ''} ${response.url || ''}`.trim();
      const status = `${response.status || ''} ${response.statusText || ''}`.trim();
      md += `- ${req} (${status})${response.body ? ` -> ${oneLine(response.body).slice(0, 200)}` : ''}\n`;
    }
    md += '\n';
  }
}

if (registrationNetwork) {
  md = md.replace(
    '## Registration Diagnostics\n\n',
    `## Registration Diagnostics\n\n${renderSectionIntroMd('Registration Diagnostics')}`
  );
}

if (includeReportGuide) {
  md += renderReportGuideMd();
  md += '\n';
}

const comparisonRowsHtml = previousRun
  ? comparisonMetrics
      .map((item) => {
        const deltaClass =
          item.delta === 0 || item.delta == null || item.lowerIsBetter == null
            ? 'delta-neutral'
            : item.delta < 0 === item.lowerIsBetter
              ? 'delta-good'
              : 'delta-bad';
        return `
          <tr>
            <td>${escapeHtml(item.label)}</td>
            <td>${escapeHtml(item.current)}</td>
            <td>${escapeHtml(Number.isFinite(Number(item.previous)) ? item.previous : '-')}</td>
            <td class="${deltaClass}">${escapeHtml(formatSignedNumber(item.delta))}</td>
          </tr>`;
      })
      .join('')
  : '';
const issueCategoryRowsHtml = issueCategories
  .map(
    (item) => `
      <tr>
        <td>${escapeHtml(item.category)}</td>
        <td>${item.count}</td>
        <td>${escapeHtml(item.severity)}</td>
        <td>${escapeHtml(item.meaning)}</td>
        <td>${escapeHtml(item.action)}</td>
      </tr>`
  )
  .join('');
const executionStepRowsHtml = executionStepRows
  .map((item) => {
    const statusClass =
      item.status === 'PASSED'
        ? 'step-passed'
        : item.status === 'FAILED'
          ? 'step-failed'
          : item.status === 'PARTIAL' || item.status === 'N/A' || item.status === 'SKIPPED'
            ? 'step-partial'
            : 'step-blocked';
    const indent = Math.max(0, Number(item.depth || 0));
    return `
      <tr class="${statusClass}">
        <td>${escapeHtml(item.number || '')}</td>
        <td>${escapeHtml(item.phase)}</td>
        <td>${escapeHtml(item.type)}</td>
        <td><span class="step-title" style="padding-left:${indent * 12}px">${
          indent > 0 ? '↳ ' : ''
        }${escapeHtml(item.title)}</span></td>
        <td><span class="step-status">${escapeHtml(item.status)}</span></td>
        <td>${escapeHtml(formatDuration(item.duration))}</td>
        <td>${escapeHtml(item.flags)}</td>
      </tr>`;
  })
  .join('');
const summaryCardsHtml = [
  { label: 'Decision', value: qualityGate.verdict },
  { label: 'KPI Verdict', value: formatKpiVerdict(kpiValidation) },
  { label: 'Tests', value: totals.total },
  { label: 'Hard Failures', value: Math.max(0, effectiveFailedCount) },
  { label: 'Clean Evidence', value: `${signalTotals.strictClean}/${totals.total}` },
  { label: 'Blocked Signals', value: signalTotals.blocked },
  { label: 'Test Infra Timeouts', value: signalTotals.testInfraTimeout },
  { label: 'Not Applicable', value: signalTotals.notApplicable },
  { label: 'End-to-end Duration', value: formatDuration(orchestrationDurationMs) },
]
  .map(
    (item) =>
      `<article class="card"><div class="label">${escapeHtml(item.label)}</div><div class="value">${escapeHtml(item.value)}</div></article>`
  )
  .join('');
const highlightsHtml = quickHighlights.length
  ? `<ul class="highlights-list">${quickHighlights
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('')}</ul>`
  : '<p class="muted">No run highlights available.</p>';
const reportTocItems = [
  { href: '#quality-gate', label: 'Quality Gate' },
  { href: '#previous-run', label: 'Previous Run' },
  { href: '#issue-categories', label: 'Issue Categories' },
  { href: '#summary', label: 'Run Overview' },
  { href: '#execution-steps', label: 'Steps & Statuses' },
  { href: '#mobile-stability', label: 'Mobile Stability' },
  { href: '#sections', label: 'Sections' },
  { href: '#registration-player', label: 'Registration & Player' },
  { href: '#casino-providers-matrix', label: 'Providers' },
  { href: '#deposit-coverage', label: 'Deposit Coverage' },
  { href: '#auth-state-health', label: 'Auth State' },
  { href: '#run-kpi-validation', label: 'KPI Validation' },
  { href: '#sidebar', label: 'Sidebar' },
  { href: '#live-chat', label: 'Live Chat' },
  { href: '#failed-tests', label: 'Failed Tests' },
  { href: '#registration-diagnostics', label: 'Registration Diagnostics' },
  { href: '#flag-legend', label: 'Flag Legend' },
].filter(
  (item) =>
    (showMobileStability || item.href !== '#mobile-stability') &&
    (failed.length > 0 || item.href !== '#failed-tests') &&
    (!reportCompactMode || item.href !== '#registration-diagnostics')
);
const reportTocHtml = `
  <nav class="toc" aria-label="Report sections">
    ${reportTocItems
      .map(
        (item) =>
          `<a class="toc-link" href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`
      )
      .join('')}
  </nav>
`;
const mobileReasonRowsHtml = mobileTopReasons.length
  ? mobileTopReasons
      .map(
        (entry) => `
          <tr>
            <td>${escapeHtml(entry.reason)}</td>
            <td>${Number(entry.count || 0)}</td>
            <td>${escapeHtml(
              formatPercent(Number(entry.count || 0) / mobileTopReasonsTotal, 1)
            )}</td>
          </tr>
        `
      )
      .join('')
  : '<tr><td class="muted">-</td><td>0</td><td>0.0%</td></tr>';
const mobileStabilityHtml = showMobileStability
  ? `
      <section id="mobile-stability">
        <h2>Mobile Stability</h2>
        ${renderSectionIntroHtml('Mobile Stability')}
        <div class="summary-grid">
          ${[
            { label: 'Execution Mode', value: executionMode || '-' },
            { label: 'Mobile Tests', value: mobileTotals.total },
            { label: 'Mobile Passed', value: mobileTotals.passed },
            { label: 'Mobile Failed', value: mobileTotals.failed },
            { label: 'Mobile Timed Out', value: mobileTimedOutCount },
            { label: 'Mobile Blocked', value: mobileBlockedCount },
            { label: 'Mobile Infra Blocked', value: mobileInfraBlockedCount },
            { label: 'Mobile Provider Blocked', value: mobileProviderBlockedCount },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <table>
          <thead>
            <tr>
              <th>Top Reason</th>
              <th>Count</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            ${mobileReasonRowsHtml}
          </tbody>
        </table>
      </section>
    `
  : '';

const sectionRowsHtml = sectionSummary
  .map(
    (section) => `
      <tr>
        <td>${escapeHtml(section.section)}</td>
        <td>${section.totals.total}</td>
        <td>${section.totals.passed}</td>
        <td>${section.totals.failed}</td>
        <td>${section.totals.skipped}</td>
        <td>${section.tests.filter((test) => hasAnnotation(test, 'blocked')).length}</td>
        <td>${
          section.tests.filter(
            (test) => hasAnnotation(test, 'partial') || hasAnnotation(test, 'deposit-method-limit')
          ).length
        }</td>
        <td>${escapeHtml(formatDuration(section.durationMs))}</td>
      </tr>
    `
  )
  .join('');

const sectionBlocksHtml =
  sectionDetailRowsLimit <= 0
    ? ''
    : sectionDetails
        .map((section) => {
          const rows = section.detailTests
            .map((t) => {
              const locStr = formatLocation(t);
              return `
          <tr class="status-${escapeHtml(t.status)}">
            <td><span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td>
            <td>${flagsHtml(t)}</td>
            <td>${escapeHtml(t.titlePath || t.title)}</td>
            <td>${escapeHtml(locStr)}</td>
            <td>${escapeHtml(formatDuration(t.duration))}</td>
            <td>${escapeHtml(noteSummary(t))}</td>
          </tr>
        `;
            })
            .join('');

          return `
      <section>
        <h3>${escapeHtml(section.section)}</h3>
        ${renderSectionIntroHtml(section.section)}
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Flags</th>
              <th>Test</th>
              <th>Location</th>
              <th>Duration</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        ${
          section.detailOmitted > 0
            ? `<p class="muted">Showing ${section.detailTests.length} of ${section.detailSourceCount} rows for this section (omitted ${section.detailOmitted}).</p>`
            : ''
        }
      </section>
    `;
        })
        .join('');

const failedCardsHtml = failed.length
  ? failed
      .map((t) => {
        const locStr = formatLocation(t);
        return `
          <article class="failure-card">
            <h3>${escapeHtml(t.titlePath || t.title)}</h3>
            <div><strong>Phase:</strong> ${escapeHtml(t.phase)}</div>
            <div><strong>Location:</strong> ${escapeHtml(locStr)}</div>
            <div><strong>Duration:</strong> ${escapeHtml(formatDuration(t.duration))}</div>
            <div><strong>Error:</strong> ${escapeHtml(oneLine(t.error) || '-')}</div>
            <div><strong>Flags:</strong> ${flagsHtml(t)}</div>
            <div><strong>Attachments:</strong> ${attachmentLinksHtml(t.attachments)}</div>
          </article>
        `;
      })
      .join('')
  : '<p class="muted">No failed tests.</p>';

const providerMatrixHtml =
  providerMatrixAllResults.length || providerMatrix
    ? `
      <section id="casino-providers-matrix">
        <h2>Casino Providers Matrix</h2>
        ${renderSectionIntroHtml('Casino Providers Matrix')}
        <div class="summary-grid">
          ${[
            { label: 'Target Providers Declared', value: providerMatrixSummary.targetDeclared },
            { label: 'Provider Results Captured', value: providerMatrixSummary.resultsCaptured },
            {
              label: 'Providers Discovered On Brand',
              value: providerMatrixSummary.providersDiscovered || '-',
            },
            {
              label: 'Discovered But Not Launch-Tested',
              value: providerMatrixSummary.discoveredUntested.length,
            },
            { label: 'Functional Passed', value: providerMatrixSummary.passed },
            { label: 'Passed Strong', value: providerMatrixSummary.passedStrong },
            { label: 'Passed Weak Surface', value: providerMatrixSummary.passedWeakSurface },
            { label: 'Blocked', value: providerMatrixSummary.blocked },
            { label: 'Provider Absent', value: providerMatrixSummary.blockedProviderAbsent },
            {
              label: 'Provider Launch Blocked',
              value: providerMatrixSummary.blockedProviderLaunch,
            },
            {
              label: 'Infrastructure WAF Blocked',
              value: providerMatrixSummary.blockedInfraWaf,
            },
            { label: 'Retried Recovered', value: providerMatrixSummary.retriedRecovered },
            {
              label: 'Providers With Optional Stage Timeout',
              value: providerMatrixSummary.optionalStageTimeoutProviders,
            },
            {
              label: 'Optional Stage Timeouts',
              value: providerMatrixSummary.optionalStageTimeouts,
            },
            { label: 'Rows In Report', value: providerMatrixResults.length },
            { label: 'Omitted Rows', value: providerMatrixOmitted },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <table class="provider-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Status</th>
              <th>Outcome</th>
              <th>Launch</th>
              <th>Surface</th>
              <th>Controls</th>
              <th>Примечание</th>
            </tr>
          </thead>
          <tbody>
            ${providerMatrixResults
              .map(
                (item) => `
                  <tr class="status-${escapeHtml(item.status || 'unknown')}">
                    <td>${escapeHtml(item.provider || '-')}</td>
                    <td><span class="badge badge-${escapeHtml(item.status || 'unknown')}">${escapeHtml(
                      item.status || '-'
                    )}</span></td>
                    <td>${escapeHtml(item.outcome || '-')}</td>
                    <td>${escapeHtml(item.launchState || '-')}</td>
                    <td>${escapeHtml(item.gameSurface || '-')}</td>
                    <td>${escapeHtml(item.controlsClicked || 0)}</td>
                    <td>${escapeHtml(translateProviderNote(item.reason || '-'))}</td>
                  </tr>
                `
              )
              .join('')}
            ${
              providerMatrixOmitted > 0
                ? `
                  <tr>
                    <td colspan="7" class="muted">В компактном отчёте скрыто строк провайдеров: ${providerMatrixOmitted}.</td>
                  </tr>
                `
                : ''
            }
          </tbody>
        </table>
      </section>
    `
    : `
      <section id="casino-providers-matrix">
        <h2>Casino Providers Matrix</h2>
        ${renderSectionIntroHtml('Casino Providers Matrix')}
        <p class="muted">Provider matrix artifact not found.</p>
      </section>
    `;

const depositCoverageHtml = (() => {
  const inventoryBlocked = depositInventoryCoverageBlocked;
  const methodsBlocked = depositMethodCoverageBlocked;
  const overallState =
    inventoryBlocked && methodsBlocked
      ? 'blocked'
      : inventoryBlocked || methodsBlocked
        ? 'partial'
        : 'ready';
  const reasons = [
    inventoryBlocked ? `Inventory: ${depositInventoryCoverageReason}` : '',
    methodsBlocked ? `Methods: ${depositMethodCoverageReason}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  const apiCategoriesPreview = depositInventorySummary.apiCategories.slice(0, 8);
  const uiCategoriesPreview = depositInventorySummary.uiCategories.slice(0, 8);
  const readyMethodsPreview = depositSummary.results
    .filter((item) => item.surfaceReady)
    .map((item) => item.method)
    .filter(Boolean)
    .slice(0, 8);
  const checkedMethodsPreview = depositSummary.results
    .map((item) => item.method)
    .filter(Boolean)
    .slice(0, 8);
  const availableMethods = depositSummary.discoveredMethods.length
    ? depositSummary.discoveredMethods
    : depositSummary.checkedMethods;
  const availableMethodsHtml =
    !reportCompactMode && availableMethods.length
      ? `
        <h3>Available Deposit Methods</h3>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Method</th>
            </tr>
          </thead>
          <tbody>
            ${availableMethods
              .map(
                (method, index) => `
                  <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(method)}</td>
                  </tr>
                `
              )
              .join('')}
          </tbody>
        </table>
      `
      : '';

  return `
      <section id="deposit-coverage">
        <h2>Deposit Coverage</h2>
        ${renderSectionIntroHtml('Deposit Coverage')}
        <div class="summary-grid">
          ${[
            { label: 'Coverage State', value: overallState },
            { label: 'Inventory Blocked', value: yesNo(inventoryBlocked) },
            { label: 'Methods Blocked', value: yesNo(methodsBlocked) },
            { label: 'Blocked Reason', value: reasons || '-' },
            {
              label: 'API Coverage Available',
              value: yesNo(
                depositInventorySummary.apiCoverageAvailable || depositSummary.apiCoverageAvailable
              ),
            },
            {
              label: 'UI Coverage Available',
              value: blockedAwareBool(
                depositInventorySummary.uiCoverageAvailable,
                inventoryBlocked
              ),
            },
            {
              label: 'API Categories',
              value: depositInventorySummary.apiCategories.length,
            },
            {
              label: 'UI Categories',
              value: blockedAwareCount(
                depositInventorySummary.uiCategories.length,
                inventoryBlocked
              ),
            },
            {
              label: 'Methods Discovered',
              value: depositSummary.discoveredCount,
            },
            {
              label: 'Methods Checked',
              value: depositSummary.checkedCount,
            },
            {
              label: 'Methods Ready',
              value: blockedAwareCount(depositSummary.readyCount, methodsBlocked),
            },
            {
              label: 'Submit Visible',
              value: blockedAwareBool(depositSummary.submitVisible, methodsBlocked),
            },
            {
              label: 'Submit Enabled',
              value: blockedAwareBool(depositSummary.submitEnabled, methodsBlocked),
            },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <div class="key-grid">
          <div class="key">API Categories (preview)</div><div class="val">${escapeHtml(
            apiCategoriesPreview.join(', ') || '-'
          )}</div>
          <div class="key">UI Categories (preview)</div><div class="val">${escapeHtml(
            blockedAwareList(uiCategoriesPreview, inventoryBlocked)
          )}</div>
          <div class="key">Ready Methods (preview)</div><div class="val">${escapeHtml(
            blockedAwareList(readyMethodsPreview, methodsBlocked)
          )}</div>
          <div class="key">Checked Methods (preview)</div><div class="val">${escapeHtml(
            blockedAwareList(checkedMethodsPreview, methodsBlocked)
          )}</div>
          <div class="key">Available Methods Source</div><div class="val">${escapeHtml(
            depositSummary.sourceMode || '-'
          )}</div>
        </div>
        ${availableMethodsHtml}
      </section>
    `;
})();

const authStateHealthHtml = authStateHealth
  ? `
      <section id="auth-state-health">
        <h2>Auth State Health</h2>
        ${renderSectionIntroHtml('Auth State Health')}
        <div class="summary-grid">
          ${(reportCompactMode
            ? [
                { label: 'Healthy', value: yesNo(authStateHealth.healthy) },
                { label: 'State Fresh', value: yesNo(authStateHealth.selectedFresh) },
                {
                  label: 'Session Artifacts',
                  value: yesNo(authStateHealth.selectedHasSessionArtifacts),
                },
                {
                  label: 'Cookies/Origins',
                  value: `${Number(authStateHealth.selectedCookiesCount || 0)}/${Number(
                    authStateHealth.selectedOriginsCount || 0
                  )}`,
                },
                { label: 'Refresh Triggered', value: yesNo(authStateHealth.refreshTriggered) },
              ]
            : [
                { label: 'Checked At', value: authStateHealth.checkedAt || '-' },
                { label: 'Phase', value: authStateHealth.phase || '-' },
                {
                  label: 'Max Age',
                  value: authStateHealth.maxAgeSec ? `${authStateHealth.maxAgeSec}s` : '-',
                },
                {
                  label: 'Selected Path',
                  value: authStateHealth.selectedPath
                    ? toRelative(authStateHealth.selectedPath)
                    : '-',
                },
                { label: 'Selected Fresh', value: yesNo(authStateHealth.selectedFresh) },
                {
                  label: 'Selected Session Artifacts',
                  value: yesNo(authStateHealth.selectedHasSessionArtifacts),
                },
                {
                  label: 'Selected Cookies/Origins',
                  value: `${Number(authStateHealth.selectedCookiesCount || 0)}/${Number(
                    authStateHealth.selectedOriginsCount || 0
                  )}`,
                },
                { label: 'Refresh Triggered', value: yesNo(authStateHealth.refreshTriggered) },
                { label: 'Healthy', value: yesNo(authStateHealth.healthy) },
              ]
          )
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <table>
          <thead>
            <tr>
              <th>Candidate Path</th>
              <th>Exists</th>
              <th>Fresh</th>
              <th>Age</th>
              <th>Cookies/Origins</th>
              <th>Session Artifacts</th>
              <th>Parse Error</th>
            </tr>
          </thead>
          <tbody>
            ${
              Array.isArray(authStateHealth.entries) && authStateHealth.entries.length
                ? authStateHealth.entries
                    .map(
                      (entry) => `
                        <tr>
                          <td>${escapeHtml(entry.path ? toRelative(entry.path) : '-')}</td>
                          <td>${yesNo(entry.exists)}</td>
                          <td>${yesNo(entry.fresh)}</td>
                          <td>${escapeHtml(
                            entry.ageSec == null ? '-' : `${Number(entry.ageSec)}s`
                          )}</td>
                          <td>${escapeHtml(
                            `${Number(entry.cookiesCount || 0)}/${Number(entry.originsCount || 0)}`
                          )}</td>
                          <td>${yesNo(entry.hasSessionArtifacts)}</td>
                          <td>${escapeHtml(oneLine(entry.parseError || '-') || '-')}</td>
                        </tr>
                      `
                    )
                    .join('')
                : '<tr><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>'
            }
          </tbody>
        </table>
      </section>
    `
  : '';

const kpiValidationHtml = kpiValidation
  ? `
      <section id="run-kpi-validation">
        <h2>Run KPI Validation</h2>
        ${renderSectionIntroHtml('Run KPI Validation')}
        <div class="summary-grid">
          ${[
            { label: 'Generated At', value: kpiValidation.generatedAt || '-' },
            { label: 'Verdict', value: formatKpiVerdict(kpiValidation) },
            {
              label: 'Failed Checks',
              value: Array.isArray(kpiValidation.failedChecks)
                ? kpiValidation.failedChecks.length
                : 0,
            },
            { label: 'Waived Unmet Checks', value: kpiWaivedChecks.length },
            {
              label: 'Blocked Ratio',
              value: formatPercent(
                Number((kpiValidation.totals && kpiValidation.totals.blockedSignals) || 0) /
                  Math.max(1, Number((kpiValidation.totals && kpiValidation.totals.total) || 0))
              ),
            },
            {
              label: 'Infra Blocked Ratio',
              value: formatPercent(
                Number((kpiValidation.totals && kpiValidation.totals.infraBlockedSignals) || 0) /
                  Math.max(1, Number((kpiValidation.totals && kpiValidation.totals.total) || 0))
              ),
            },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <table>
          <thead>
            <tr>
              <th>Check</th>
              <th>Passed</th>
              <th>Actual</th>
              <th>Threshold</th>
              ${reportCompactMode ? '' : '<th>Applicable</th><th>Detail</th>'}
            </tr>
          </thead>
          <tbody>
            ${
              Array.isArray(kpiValidation.checks) && kpiValidation.checks.length
                ? kpiValidation.checks
                    .map(
                      (item) => `
                        <tr class="status-${isKpiWaivedUnmet(item) ? 'skipped' : item.passed ? 'passed' : 'failed'}">
                          <td>${escapeHtml(item.label || item.id || '-')}</td>
                          <td>${isKpiWaivedUnmet(item) ? 'Waived (unmet)' : yesNo(item.passed)}</td>
                          <td>${escapeHtml(item.actual)}</td>
                          <td>${escapeHtml(item.threshold)}</td>
                          ${
                            reportCompactMode
                              ? ''
                              : `<td>${yesNo(item.applicable !== false)}</td><td>${escapeHtml(
                                  oneLine(item.detail || '-') || '-'
                                )}</td>`
                          }
                        </tr>
                      `
                    )
                    .join('')
                : `<tr>${'<td>-</td>'.repeat(reportCompactMode ? 4 : 6)}</tr>`
            }
          </tbody>
        </table>
      </section>
    `
  : '';

const liveChatHtml = liveChatSection
  ? `
      <section id="live-chat">
        <h2>Live Chat</h2>
        ${renderSectionIntroHtml('Live Chat')}
        <div class="summary-grid">
          ${[
            { label: 'Total', value: liveChatSection.totals.total },
            { label: 'Passed', value: liveChatSection.totals.passed },
            { label: 'Failed', value: liveChatSection.totals.failed },
            { label: 'Skipped', value: liveChatSection.totals.skipped },
            {
              label: 'Blocked',
              value: liveChatSection.tests.filter((test) => hasAnnotation(test, 'blocked')).length,
            },
            { label: 'Duration', value: formatDuration(liveChatSection.durationMs) },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Flags</th>
              <th>Test</th>
              <th>Location</th>
              <th>Duration</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            ${liveChatSection.tests
              .map((t) => {
                const locStr = formatLocation(t);
                return `
                  <tr class="status-${escapeHtml(t.status)}">
                    <td><span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td>
                    <td>${flagsHtml(t)}</td>
                    <td>${escapeHtml(t.titlePath || t.title)}</td>
                    <td>${escapeHtml(locStr)}</td>
                    <td>${escapeHtml(formatDuration(t.duration))}</td>
                    <td>${escapeHtml(noteSummary(t))}</td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </section>
    `
  : `
      <section id="live-chat">
        <h2>Live Chat</h2>
        ${renderSectionIntroHtml('Live Chat')}
        <p class="muted">No live chat tests were present in the collected reports.</p>
      </section>
    `;
const sidebarHtml = sidebarSection
  ? `
      <section id="sidebar">
        <h2>Sidebar</h2>
        ${renderSectionIntroHtml('Sidebar')}
        <div class="summary-grid">
          ${[
            { label: 'Total', value: sidebarSection.totals.total },
            { label: 'Passed', value: sidebarSection.totals.passed },
            { label: 'Failed', value: sidebarSection.totals.failed },
            { label: 'Skipped', value: sidebarSection.totals.skipped },
            {
              label: 'Blocked',
              value: sidebarSection.tests.filter((test) => hasAnnotation(test, 'blocked')).length,
            },
            { label: 'Duration', value: formatDuration(sidebarSection.durationMs) },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Flags</th>
              <th>Test</th>
              <th>Location</th>
              <th>Duration</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            ${sidebarSection.tests
              .map((t) => {
                const locStr = formatLocation(t);
                return `
                  <tr class="status-${escapeHtml(t.status)}">
                    <td><span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td>
                    <td>${flagsHtml(t)}</td>
                    <td>${escapeHtml(t.titlePath || t.title)}</td>
                    <td>${escapeHtml(locStr)}</td>
                    <td>${escapeHtml(formatDuration(t.duration))}</td>
                    <td>${escapeHtml(noteSummary(t))}</td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </section>
    `
  : `
      <section id="sidebar">
        <h2>Sidebar</h2>
        ${renderSectionIntroHtml('Sidebar')}
        <p class="muted">No sidebar tests were present in the collected reports.</p>
      </section>
    `;

const registrationPlayerHtml = (() => {
  const primaryEmail =
    registrationOutcome.currentManualLoginEmail ||
    registrationOutcome.manualLoginPlayerEmail ||
    registrationOutcome.playerEmail ||
    '-';
  const primaryPassword = registrationOutcome.currentManualLoginPassword || '-';
  const sourcePath = formatPathForDisplay(registration.path || manualLoginPlayerDataSource || '-');

  if (reportCompactMode) {
    const compactRows = [
      ['Coverage State', registrationOutcome.coverageState],
      ['Test Status', registrationOutcome.testStatus],
      ['New Player Registered', yesNo(registrationOutcome.newPlayerRegisteredInRun)],
      ['Manual Password Login Ready', yesNo(registrationOutcome.manualLoginReady)],
      ['Login Validation', registrationOutcome.loginValidationStatus],
      ['Email For Manual Login', primaryEmail],
      ['Password For Manual Login', primaryPassword],
      ['Player Generated At', registrationOutcome.playerGeneratedAt],
    ];
    if (
      /blocked|failed|incomplete/i.test(registrationOutcome.coverageState || '') &&
      registrationOutcome.blockedReason &&
      registrationOutcome.blockedReason !== '-'
    ) {
      compactRows.push(['Blocked/Incomplete Reason', registrationOutcome.blockedReason]);
    }
    return `
      <section id="registration-player">
        <h2>Registration &amp; Player</h2>
        ${renderSectionIntroHtml('Registration & Player')}
        <div class="key-grid">
          ${compactRows
            .map(
              ([key, value]) =>
                `<div class="key">${escapeHtml(key)}</div><div class="val">${
                  /Email|Password/.test(key)
                    ? escapeCredentialHtml(value)
                    : escapeHtml(value == null ? '-' : value)
                }</div>`
            )
            .join('')}
        </div>
      </section>
    `;
  }

  return `
      <section id="registration-player">
        <h2>Registration &amp; Player</h2>
        ${renderSectionIntroHtml('Registration & Player')}
        <div class="key-grid">
          <div class="key">Registration Test Present</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.testFound)
          )}</div>
          <div class="key">Registration Coverage State</div><div class="val">${escapeHtml(
            registrationOutcome.coverageState
          )}</div>
          <div class="key">Registration Test Status</div><div class="val">${escapeHtml(
            registrationOutcome.testStatus
          )}</div>
          <div class="key">Registration Test Raw Status</div><div class="val">${escapeHtml(
            registrationOutcome.rawTestStatus
          )}</div>
          <div class="key">Registration Blocked/Incomplete Reason</div><div class="val">${escapeHtml(
            registrationOutcome.blockedReason
          )}</div>
          <div class="key">New Player Registered In This Run</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.newPlayerRegisteredInRun)
          )}</div>
          <div class="key">Player Data Belongs To Current Run</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.playerDataFromCurrentRun)
          )}</div>
          <div class="key">Manual Password Login Ready</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.manualLoginReady)
          )}</div>
          <div class="key">Login Validation Status</div><div class="val">${escapeHtml(
            registrationOutcome.loginValidationStatus
          )}</div>
          <div class="key">Login Validation At</div><div class="val">${escapeHtml(
            registrationOutcome.loginValidationAt
          )}</div>
          <div class="key">Latest Login Attempt Status</div><div class="val">${escapeHtml(
            registrationOutcome.lastLoginCheckStatus
          )}</div>
          <div class="key">Latest Login Attempt Method</div><div class="val">${escapeHtml(
            registrationOutcome.lastLoginCheckMethod
          )}</div>
          <div class="key">Latest Login Attempt Reason</div><div class="val">${escapeHtml(
            registrationOutcome.lastLoginCheckReason
          )}</div>
          <div class="key">Latest Login Attempt At</div><div class="val">${escapeHtml(
            registrationOutcome.lastLoginCheckAt
          )}</div>
          <div class="key">Manual Login Player Available</div><div class="val">${escapeHtml(
            yesNo(registrationOutcome.manualLoginPlayerAvailable)
          )}</div>
          <div class="key">Email For Manual Login</div><div class="val">${escapeCredentialHtml(primaryEmail)}</div>
          <div class="key">Password For Manual Login</div><div class="val">${escapeCredentialHtml(
            primaryPassword
          )}</div>
          <div class="key">Player Generated At</div><div class="val">${escapeHtml(
            registrationOutcome.playerGeneratedAt
          )}</div>
          <div class="key">Data Source</div><div class="val"><code>${escapeHtml(sourcePath)}</code></div>
          <div class="key">Source Test</div><div class="val">${escapeHtml(
            registrationOutcome.sourceTest
          )}</div>
        </div>
      </section>
    `;
})();

function renderRegistrationNetworkHtml(network) {
  if (!network) return '';

  const responseErrors = Array.isArray(network.responseErrors) ? network.responseErrors : [];
  const failedRequests = Array.isArray(network.failedRequests) ? network.failedRequests : [];
  const consoleErrors = Array.isArray(network.consoleErrors) ? network.consoleErrors : [];
  const toastErrors = Array.isArray(network.toastErrors) ? network.toastErrors : [];
  const authResponses = Array.isArray(network.authResponses) ? network.authResponses : [];

  if (
    reportCompactMode &&
    responseErrors.length === 0 &&
    failedRequests.length === 0 &&
    consoleErrors.length === 0 &&
    toastErrors.length === 0
  ) {
    return '';
  }

  const rowsFor = (items, mapRow) =>
    items.length
      ? `<tbody>${items.map(mapRow).join('')}</tbody>`
      : '<tbody><tr><td colspan="3" class="muted">No entries</td></tr></tbody>';

  const responseErrorsHtml = `
    <section>
      <h3>Registration API Errors</h3>
      <table>
        <thead><tr><th>Request</th><th>Status</th><th>Response</th></tr></thead>
        ${rowsFor(responseErrors, (err) => {
          const req = `${err.method || ''} ${err.url || ''}`.trim();
          const status = `${err.status || ''} ${err.statusText || ''}`.trim();
          return `<tr><td>${escapeHtml(req)}</td><td>${escapeHtml(status)}</td><td>${escapeHtml(
            oneLine(err.body || '').slice(0, 240)
          )}</td></tr>`;
        })}
      </table>
    </section>
  `;

  const failedRequestsHtml = `
    <section>
      <h3>Registration Failed Requests</h3>
      <table>
        <thead><tr><th>Request</th><th>Error</th></tr></thead>
        <tbody>
          ${
            failedRequests.length
              ? failedRequests
                  .map((req) => {
                    const line = `${req.method || ''} ${req.url || ''}`.trim();
                    return `<tr><td>${escapeHtml(line)}</td><td>${escapeHtml(
                      oneLine(req.errorText || '').slice(0, 240)
                    )}</td></tr>`;
                  })
                  .join('')
              : '<tr><td colspan="2" class="muted">No entries</td></tr>'
          }
        </tbody>
      </table>
    </section>
  `;

  const consoleErrorsHtml = `
    <section>
      <h3>Registration Console Errors</h3>
      <ul>
        ${
          consoleErrors.length
            ? consoleErrors.map((msg) => `<li>${escapeHtml(oneLine(msg))}</li>`).join('')
            : '<li class="muted">No entries</li>'
        }
      </ul>
    </section>
  `;

  const toastErrorsHtml = `
    <section>
      <h3>Registration Toast Errors</h3>
      <ul>
        ${
          toastErrors.length
            ? toastErrors.map((msg) => `<li>${escapeHtml(oneLine(msg))}</li>`).join('')
            : '<li class="muted">No entries</li>'
        }
      </ul>
    </section>
  `;

  const authResponsesHtml = `
    <section>
      <h3>Registration Auth Responses</h3>
      <table>
        <thead><tr><th>Request</th><th>Status</th><th>Response</th></tr></thead>
        ${rowsFor(authResponses, (res) => {
          const req = `${res.method || ''} ${res.url || ''}`.trim();
          const status = `${res.status || ''} ${res.statusText || ''}`.trim();
          return `<tr><td>${escapeHtml(req)}</td><td>${escapeHtml(status)}</td><td>${escapeHtml(
            oneLine(res.body || '').slice(0, 240)
          )}</td></tr>`;
        })}
      </table>
    </section>
  `;

  return `
    <section id="registration-diagnostics">
      <h2>Registration Diagnostics</h2>
      ${renderSectionIntroHtml('Registration Diagnostics')}
      ${responseErrorsHtml}
      ${failedRequestsHtml}
      ${consoleErrorsHtml}
      ${toastErrorsHtml}
      ${authResponsesHtml}
    </section>
  `;
}

async function exportPdfFromHtml(htmlPath, pdfPath) {
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const targetUrl = pathToFileURL(htmlPath).href;
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="width:100%;padding:0 10mm;font:9px Arial,sans-serif;color:#667085;text-align:right;">${escapeHtml(
        brandName
      )} · ${escapeHtml(platformLabel)}</div>`,
      footerTemplate: `<div style="width:100%;padding:0 10mm;font:9px Arial,sans-serif;color:#667085;display:flex;justify-content:space-between;"><span>${escapeHtml(
        platformLabel
      )}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      margin: { top: '15mm', right: '10mm', bottom: '15mm', left: '10mm' },
    });
  } finally {
    await browser.close();
  }
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>QA Report - ${escapeHtml(brandName)} - ${escapeHtml(platformLabel)}</title>
    <style>
      :root {
        --bg: #f4f6f8;
        --surface: #ffffff;
        --surface-2: #f9fafc;
        --text: #14202b;
        --muted: #5f6b7a;
        --border: #d7dde5;
        --ok: #0f8a5f;
        --bad: #c43f3f;
        --warn: #a77800;
        --flaky: #7d3ac1;
        --accent: #0067d8;
      }

      html { scroll-behavior: smooth; }
      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--text);
        background: radial-gradient(circle at top right, #e7f2ff 0, var(--bg) 45%);
      }

      .container {
        max-width: 1240px;
        margin: 0 auto;
        padding: 24px;
      }

      header {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 20px 24px;
      }

      h1 {
        margin: 0;
        font-size: 30px;
        line-height: 1.2;
      }

      h2 {
        margin: 0 0 12px;
        font-size: 22px;
      }

      h3 {
        margin: 0 0 8px;
        font-size: 18px;
      }

      section {
        margin-top: 18px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 20px;
        box-shadow: 0 2px 8px rgba(20, 32, 43, 0.04);
      }

      .toc {
        margin-top: 14px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .toc-link {
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 12px;
        color: #2c3a47;
        background: #ffffff;
        text-decoration: none;
      }

      .toc-link:hover {
        background: #eef5ff;
        border-color: #bfd5f7;
      }

      .highlights-list {
        margin: 0;
        padding-left: 18px;
        line-height: 1.6;
      }

      .quality-gate {
        border-left: 6px solid var(--warn);
      }

      .decision-row {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 14px;
      }

      .decision-badge {
        display: inline-flex;
        padding: 8px 14px;
        border-radius: 999px;
        font-size: 15px;
        font-weight: 800;
        letter-spacing: 0.04em;
        white-space: nowrap;
      }

      .decision-go { background: #dcf5ea; color: var(--ok); }
      .decision-conditional { background: #fff3d7; color: #855f00; }
      .decision-no-go { background: #fde4e4; color: var(--bad); }
      .decision-summary { margin: 0; line-height: 1.55; }
      .comparison-note { margin: 12px 0 0; color: var(--muted); font-size: 13px; }
      .delta-good { color: var(--ok); font-weight: 700; }
      .delta-bad { color: var(--bad); font-weight: 700; }
      .delta-neutral { color: var(--muted); font-weight: 600; }

      .section-intro {
        margin: 0 0 14px;
        color: var(--muted);
        line-height: 1.6;
      }

      .meta {
        margin-top: 8px;
        color: var(--muted);
        font-size: 14px;
      }

      .status-line {
        margin-top: 10px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        background: #e8edf3;
        color: #3e4b58;
      }

      .badge-passed { background: #dcf5ea; color: var(--ok); }
      .badge-failed { background: #fde4e4; color: var(--bad); }
      .badge-skipped { background: #fff3d7; color: var(--warn); }
      .badge-flaky { background: #efe3ff; color: var(--flaky); }
      .badge-default { background: #e8edf3; color: #3e4b58; }

      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 10px;
      }

      .card {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px;
        background: var(--surface-2);
      }

      .label {
        text-transform: uppercase;
        font-size: 11px;
        letter-spacing: 0.04em;
        color: var(--muted);
      }

      .value {
        margin-top: 6px;
        font-size: 20px;
        font-weight: 700;
        line-height: 1.25;
        word-break: break-word;
      }

      .muted { color: var(--muted); }

      .platform-pill {
        display: inline-flex;
        margin-top: 10px;
        padding: 5px 11px;
        border-radius: 999px;
        background: #e8f1ff;
        color: #0059b8;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      .compact #sidebar table,
      .compact #live-chat table,
      .compact #auth-state-health table {
        display: none;
      }

      .failure-list {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
      }

      .failure-card {
        border: 1px solid #efcfcf;
        border-radius: 10px;
        padding: 12px;
        background: #fff6f6;
      }

      .key-grid {
        display: grid;
        grid-template-columns: 220px 1fr;
        gap: 8px 12px;
      }

      .key {
        color: var(--muted);
        font-weight: 600;
      }

      .val {
        word-break: break-word;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
        table-layout: fixed;
      }

      th, td {
        border-bottom: 1px solid var(--border);
        padding: 10px;
        text-align: left;
        vertical-align: top;
        word-break: break-word;
      }

      th {
        background: #f0f4f9;
        color: #3a4653;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        position: sticky;
        top: 0;
        z-index: 2;
      }

      tbody tr:nth-child(even) {
        background: #fbfdff;
      }

      #sections th:first-child,
      #sections td:first-child { width: 18%; }

      .provider-table { font-size: 12px; }
      .provider-table th,
      .provider-table td { padding: 8px 7px; }
      .provider-table th:nth-child(1) { width: 15%; }
      .provider-table th:nth-child(2) { width: 13%; }
      .provider-table th:nth-child(3) { width: 15%; }
      .provider-table th:nth-child(4) { width: 14%; }
      .provider-table th:nth-child(5) { width: 14%; }
      .provider-table th:nth-child(6) { width: 10%; }
      .provider-table th:nth-child(7) { width: 19%; }
      .provider-table .badge {
        padding: 3px 7px;
        font-size: 10px;
        white-space: nowrap;
      }

      #flag-legend { padding: 14px 18px; }
      #flag-legend table { font-size: 12px; }
      #flag-legend th,
      #flag-legend td { padding: 7px 9px; line-height: 1.25; }

      .steps-table { font-size: 10px; table-layout: fixed; }
      .steps-table th,
      .steps-table td { padding: 6px; line-height: 1.25; }
      .steps-table th:nth-child(1) { width: 5%; }
      .steps-table th:nth-child(2) { width: 9%; }
      .steps-table th:nth-child(3) { width: 11%; }
      .steps-table th:nth-child(4) { width: 42%; }
      .steps-table th:nth-child(5) { width: 12%; }
      .steps-table th:nth-child(6) { width: 9%; }
      .steps-table th:nth-child(7) { width: 12%; }
      .step-title { display: block; }
      .step-status {
        display: inline-block;
        border-radius: 999px;
        padding: 2px 5px;
        font-size: 9px;
        font-weight: 700;
      }
      .step-passed .step-status { background: #dcf5ea; color: var(--ok); }
      .step-failed .step-status { background: #fde4e4; color: var(--bad); }
      .step-blocked .step-status { background: #fff3d7; color: #855f00; }
      .step-partial .step-status { background: #e8edf3; color: #4d5b68; }

      code {
        background: #edf2f7;
        border-radius: 6px;
        padding: 2px 6px;
        word-break: break-all;
      }

      a {
        color: var(--accent);
        text-decoration: none;
      }

      a:hover {
        text-decoration: underline;
      }

      .sep { color: var(--muted); }

      .mini-flag {
        display: inline-flex;
        align-items: center;
        margin: 0 6px 6px 0;
        padding: 2px 8px;
        border-radius: 999px;
        background: #edf2f7;
        color: #2f3b47;
        font-size: 12px;
        white-space: nowrap;
      }

      @media (max-width: 800px) {
        .container {
          padding: 12px;
        }

        .key-grid {
          grid-template-columns: 1fr;
        }

        table {
          font-size: 13px;
        }

        th, td {
          padding: 8px;
        }
      }

      @media print {
        body { background: #ffffff; }
        .container { max-width: none; padding: 0; }
        header, section { box-shadow: none; }
        #quality-gate,
        #registration-player,
        #deposit-coverage,
        #auth-state-health,
        #sidebar,
        #live-chat,
        #failed-tests { break-inside: avoid-page; }
        h1, h2, h3 { break-after: avoid-page; }
        tr, .card, .failure-card { break-inside: avoid-page; }
        thead { display: table-header-group; }
        a { color: var(--text); }
      }
    </style>
  </head>
  <body class="${reportCompactMode ? 'compact' : 'full'}">
    <div class="container">
      <header>
        <h1>QA Report - ${escapeHtml(brandName)}</h1>
        <div class="platform-pill">Platform: ${escapeHtml(platformLabel)}</div>
        <div class="meta">Generated: ${escapeHtml(generatedAt)}</div>
        <div class="status-line">Run status: <span class="badge ${runStatusBadgeClass(
          runStatus
        )}">${escapeHtml(runStatus)}</span></div>
      </header>

      ${reportTocHtml}

      <section id="quality-gate" class="quality-gate">
        <h2>Quality Gate</h2>
        <div class="decision-row">
          <span class="decision-badge ${qualityGate.cssClass}">${escapeHtml(
            qualityGate.verdict
          )}</span>
          <p class="decision-summary">${escapeHtml(qualityGate.summary)}</p>
        </div>
        <div class="summary-grid">
          ${[
            { label: 'Hard Failures', value: Math.max(0, effectiveFailedCount) },
            { label: 'KPI Verdict', value: formatKpiVerdict(kpiValidation) },
            { label: 'Blocked Signals', value: signalTotals.blocked },
            { label: 'Test Infra Timeouts', value: signalTotals.testInfraTimeout },
            {
              label: 'Strict Clean Evidence',
              value: `${signalTotals.strictClean}/${totals.total}`,
            },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <h3 style="margin-top:16px">Key Findings</h3>
        ${highlightsHtml}
      </section>

      <section id="previous-run">
        <h2>Previous Run Comparison</h2>
        ${
          previousRun
            ? `<p class="section-intro">Compared with ${escapeHtml(
                previousRun.timestamp || previousRun.runId || '-'
              )}.</p>
        <table>
          <thead><tr><th>Metric</th><th>Current</th><th>Previous</th><th>Delta</th></tr></thead>
          <tbody>${comparisonRowsHtml}</tbody>
        </table>
        <p class="comparison-note">Deltas show classification changes as well as real product changes; review the issue categories before interpreting them as improvement or regression.</p>`
            : '<p class="muted">No earlier comparable run was found for this brand and platform.</p>'
        }
      </section>

      <section id="issue-categories">
        <h2>Issue Categories</h2>
        <table>
          <thead><tr><th>Category</th><th>Count</th><th>Severity</th><th>Meaning</th><th>Next action</th></tr></thead>
          <tbody>${issueCategoryRowsHtml}</tbody>
        </table>
        <p class="comparison-note">Counts are diagnostic signals and may overlap; they must not be added together as unique failed tests.</p>
      </section>

      <section id="summary">
        <h2>Run Overview</h2>
        <div class="summary-grid">${summaryCardsHtml}</div>
      </section>

      <section id="execution-steps">
        <h2>Execution Steps &amp; Statuses</h2>
        <p class="section-intro">Каждый Scenario — выполненный автотест. Вложенные Playwright step — реальные шаги, записанные через <code>test.step</code>; отсутствующие внутренние шаги не реконструируются и не выдумываются.</p>
        <div class="summary-grid">
          ${[
            { label: 'Executed Scenarios', value: tests.length },
            { label: 'Scenarios With Explicit Steps', value: testsWithExplicitSteps },
            { label: 'Explicit Steps Recorded', value: explicitStepCount },
            { label: 'Scenario Passed', value: Number(scenarioStatusCounts.PASSED || 0) },
            {
              label: 'Scenario Blocked',
              value: executionStepRows.filter(
                (item) => item.type === 'Scenario' && /BLOCKED|TEST INFRA/.test(item.status)
              ).length,
            },
            { label: 'Scenario Partial', value: Number(scenarioStatusCounts.PARTIAL || 0) },
            { label: 'Scenario N/A', value: Number(scenarioStatusCounts['N/A'] || 0) },
          ]
            .map(
              (item) =>
                `<article class="card"><div class="label">${escapeHtml(
                  item.label
                )}</div><div class="value">${escapeHtml(item.value)}</div></article>`
            )
            .join('')}
        </div>
        <table class="steps-table">
          <thead>
            <tr><th>#</th><th>Phase</th><th>Type</th><th>Step / Scenario</th><th>Status</th><th>Duration</th><th>Flags / Error</th></tr>
          </thead>
          <tbody>${executionStepRowsHtml}</tbody>
        </table>
      </section>

      ${mobileStabilityHtml}

      <section id="sections">
        <h2>Sections</h2>
        ${renderSectionIntroHtml('Sections')}
        <table>
          <thead>
            <tr>
              <th>Section</th>
              <th>Total</th>
              <th>Passed</th>
              <th>Failed</th>
              <th>Skipped</th>
              <th>Blocked</th>
              <th>Partial</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            ${sectionRowsHtml}
          </tbody>
        </table>
      </section>

      ${sectionBlocksHtml}

      ${registrationPlayerHtml}

      ${providerMatrixHtml}

      ${depositCoverageHtml}

      ${authStateHealthHtml}

      ${kpiValidationHtml}

      ${sidebarHtml}

      ${liveChatHtml}

      ${
        failed.length
          ? `<section id="failed-tests">
        <h2>Failed Tests</h2>
        ${renderSectionIntroHtml('Failed Tests')}
        <div class="failure-list">${failedCardsHtml}</div>
      </section>`
          : ''
      }

      ${renderRegistrationNetworkHtml(registrationNetwork)}

      ${includeReportGuide ? renderReportGuideHtml() : ''}
    </div>
  </body>
</html>`;

(async () => {
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.mkdirSync(path.dirname(outHtmlPath), { recursive: true });
    fs.writeFileSync(outPath, md, 'utf8');
    fs.writeFileSync(outHtmlPath, html, 'utf8');

    fs.mkdirSync(autotestReportDir, { recursive: true });
    fs.writeFileSync(brandOutPath, md, 'utf8');
    fs.writeFileSync(brandOutHtmlPath, html, 'utf8');
    await exportPdfFromHtml(brandOutHtmlPath, brandOutPdfPath);

    try {
      fs.mkdirSync(path.dirname(analyzeOutPath), { recursive: true });
      fs.writeFileSync(analyzeOutPath, md, 'utf8');
      fs.writeFileSync(analyzeOutHtmlPath, html, 'utf8');
    } catch {
      // optional copies in analyze/
    }

    console.log(`QA report saved: ${outPath}`);
    console.log(`QA report saved: ${outHtmlPath}`);
    console.log(`QA report saved: ${brandOutPath}`);
    console.log(`QA report saved: ${brandOutHtmlPath}`);
    console.log(`QA report saved: ${brandOutPdfPath}`);
  } catch (error) {
    console.error(
      `Failed to generate QA report outputs: ${error && error.message ? error.message : error}`
    );
    process.exit(1);
  }
})();
