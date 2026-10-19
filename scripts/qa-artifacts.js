const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Buffer } = require('buffer');
const { chromium } = require('playwright');
const { resolveProjectPaths } = require('../tests/helpers/project-paths');
const { redactObject, redactSerializedText, redactText } = require('./lib/redact-secrets');

const cwd = process.cwd();
const baseUrl = process.env.BASE_URL || 'https://gt.bet/';
const projectPaths = resolveProjectPaths({ cwd, baseUrl });

const reportDir = projectPaths.testResultsDir;
const phaseReportsDir = path.join(projectPaths.artifactsDir, 'phase-reports');
const phaseTestResultsDir = path.join(projectPaths.artifactsDir, 'phase-test-results');
const reportPath = path.join(reportDir, 'report.json');
const autotestReportDir = projectPaths.autotestReportDir;

const screenshotsRoot = path.join(autotestReportDir, 'Screenshots');
const screenshotsAllDir = path.join(screenshotsRoot, 'All');
const screenshotsFailDir = path.join(screenshotsRoot, 'Fail');
const bugsRoot = path.join(autotestReportDir, 'Bugs');

const phaseReportCandidates = [
  {
    phase: 'precheck',
    paths: [
      path.join(phaseReportsDir, 'precheck-report.json'),
      path.join(reportDir, 'precheck-report.json'),
    ],
  },
  {
    phase: 'home',
    paths: [
      path.join(phaseReportsDir, 'home-report.json'),
      path.join(reportDir, 'home-report.json'),
    ],
  },
  {
    phase: 'registration',
    paths: [
      path.join(phaseReportsDir, 'registration-report.json'),
      path.join(reportDir, 'registration-report.json'),
    ],
  },
  {
    phase: 'auth',
    paths: [
      path.join(phaseReportsDir, 'auth-report.json'),
      path.join(reportDir, 'auth-report.json'),
    ],
  },
  {
    phase: 'profile',
    paths: [
      path.join(phaseReportsDir, 'profile-report.json'),
      path.join(reportDir, 'profile-report.json'),
    ],
  },
  {
    phase: 'deposit',
    paths: [
      path.join(phaseReportsDir, 'deposit-report.json'),
      path.join(reportDir, 'deposit-report.json'),
    ],
  },
  {
    phase: 'withdraw',
    paths: [
      path.join(phaseReportsDir, 'withdraw-report.json'),
      path.join(reportDir, 'withdraw-report.json'),
    ],
  },
  {
    phase: 'sidebar',
    paths: [
      path.join(phaseReportsDir, 'sidebar-report.json'),
      path.join(reportDir, 'sidebar-report.json'),
    ],
  },
  {
    phase: 'sports',
    paths: [
      path.join(phaseReportsDir, 'sports-report.json'),
      path.join(reportDir, 'sports-report.json'),
    ],
  },
  {
    phase: 'casino',
    paths: [
      path.join(phaseReportsDir, 'casino-report.json'),
      path.join(reportDir, 'casino-report.json'),
    ],
  },
  {
    phase: 'livecasino',
    paths: [
      path.join(phaseReportsDir, 'livecasino-report.json'),
      path.join(reportDir, 'livecasino-report.json'),
    ],
  },
  {
    phase: 'security',
    paths: [
      path.join(phaseReportsDir, 'security-report.json'),
      path.join(reportDir, 'security-report.json'),
    ],
  },
  {
    phase: 'contracts',
    paths: [
      path.join(phaseReportsDir, 'contracts-report.json'),
      path.join(reportDir, 'contracts-report.json'),
    ],
  },
  {
    phase: 'nightlyextras',
    paths: [
      path.join(phaseReportsDir, 'nightlyextras-report.json'),
      path.join(reportDir, 'nightlyextras-report.json'),
    ],
  },
  {
    phase: 'a11y',
    paths: [
      path.join(phaseReportsDir, 'a11y-report.json'),
      path.join(reportDir, 'a11y-report.json'),
    ],
  },
  {
    phase: 'visual',
    paths: [
      path.join(phaseReportsDir, 'visual-report.json'),
      path.join(reportDir, 'visual-report.json'),
    ],
  },
  {
    phase: 'main',
    paths: [
      path.join(phaseReportsDir, 'main-report.json'),
      path.join(reportDir, 'main-report.json'),
    ],
  },
  {
    phase: 'destructive',
    paths: [
      path.join(phaseReportsDir, 'destructive-report.json'),
      path.join(reportDir, 'destructive-report.json'),
    ],
  },
];

const imageExtRe = /\.(png|jpe?g|webp|gif|bmp)$/i;
const failureStatuses = new Set(['failed', 'timedOut', 'interrupted']);
const safeRootIgnoreNames = new Set(['node_modules', '.git', 'Screenshots', 'Bugs']);
const playerEmailPlaceholder = '__QA_VISIBLE_PLAYER_EMAIL__';
const playerPasswordPlaceholder = '__QA_VISIBLE_PLAYER_PASSWORD__';

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadPlayerCredentials() {
  if (process.env.LOGIN_EMAIL && process.env.LOGIN_PASSWORD) {
    return {
      email: String(process.env.LOGIN_EMAIL),
      password: String(process.env.LOGIN_PASSWORD),
      source: 'LOGIN_EMAIL / LOGIN_PASSWORD',
      validationStatus: 'Переданы через окружение запуска',
    };
  }

  const candidates = [
    path.join(projectPaths.artifactsDir, 'last-registered-player.json'),
    path.join(projectPaths.artifactsDir, 'registration-data-current-run.json'),
    path.join(projectPaths.artifactsDir, 'last-manual-login-player.json'),
  ];
  for (const candidate of candidates) {
    const payload = readJson(candidate);
    const email = stripAnsi(
      String((payload && (payload.loginEmail || payload.email || payload.profileEmail)) || '')
    ).trim();
    const password = stripAnsi(String((payload && payload.password) || '')).trim();
    if (!email || !password) continue;
    return {
      email,
      password,
      source: path.basename(candidate),
      validationStatus: oneLine(
        payload.loginValidationStatus || payload.lastLoginCheckStatus || 'Статус не указан'
      ),
    };
  }

  return {
    email: '',
    password: '',
    source: 'Учётные данные не найдены',
    validationStatus: 'Недоступно',
  };
}

function visiblePlayerCredentials(credentials) {
  const available = Boolean(credentials && credentials.email && credentials.password);
  const exposePassword = process.env.QA_REPORT_INCLUDE_PLAYER_PASSWORD === '1';
  return {
    email: available ? playerEmailPlaceholder : 'Не найдена',
    password: available
      ? exposePassword
        ? playerPasswordPlaceholder
        : 'Скрыт (используйте QA_REPORT_INCLUDE_PLAYER_PASSWORD=1 только для приватного отчёта)'
      : 'Не найден',
    source: oneLine(credentials && credentials.source) || 'Учётные данные не найдены',
    validationStatus: oneLine(credentials && credentials.validationStatus) || 'Статус не указан',
    available,
  };
}

function restoreVisiblePlayerCredentials(value, credentials, { html = false } = {}) {
  const source = String(value || '');
  if (!credentials || !credentials.email || !credentials.password) return source;
  const email = html ? escapeHtml(credentials.email) : credentials.email;
  const password = html ? escapeHtml(credentials.password) : credentials.password;
  return source
    .split(playerEmailPlaceholder)
    .join(email)
    .split(playerPasswordPlaceholder)
    .join(password);
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

function oneLine(value) {
  return redactText(stripAnsi(value)).replace(/\s+/g, ' ').trim();
}

function slugify(value, max = 96) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return 'item';
  return slug.slice(0, max);
}

function sanitizeFileName(name) {
  const ext = path.extname(name || '');
  const base = path.basename(name || '', ext);
  const safeBase = slugify(base, 120) || 'file';
  const safeExt = ext && /^[.a-z0-9_-]+$/i.test(ext) ? ext.toLowerCase() : '';
  return `${safeBase}${safeExt}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function isSubPath(filePath, rootPath) {
  const absFile = path.resolve(filePath);
  const absRoot = path.resolve(rootPath);
  return absFile === absRoot || absFile.startsWith(`${absRoot}${path.sep}`);
}

function toAbsolutePath(filePath) {
  if (!filePath) return '';
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd, filePath);
}

function firstFileByBasename(rootPath, fileName) {
  if (!rootPath || !fileName || !fs.existsSync(rootPath)) return '';
  const queue = [rootPath];

  while (queue.length > 0) {
    const current = queue.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === fileName) return fullPath;
    }
  }

  return '';
}

function resolveAttachmentPath(attachmentPath, phase) {
  if (!attachmentPath) return '';
  const direct = toAbsolutePath(attachmentPath);
  if (direct && fs.existsSync(direct)) return direct;

  const phaseRoot = path.join(phaseTestResultsDir, String(phase || ''));
  if (!fs.existsSync(phaseRoot)) return '';

  const normalized = String(attachmentPath).replace(/\\/g, '/');
  const marker = '/test-results/';
  const markerIndex = normalized.toLowerCase().lastIndexOf(marker);
  let relativeFromTestResults = '';

  if (markerIndex >= 0) {
    relativeFromTestResults = normalized.slice(markerIndex + marker.length);
  } else if (normalized.toLowerCase().startsWith('test-results/')) {
    relativeFromTestResults = normalized.slice('test-results/'.length);
  }

  if (relativeFromTestResults) {
    const candidate = path.join(phaseRoot, relativeFromTestResults);
    if (fs.existsSync(candidate)) return candidate;
  }

  return firstFileByBasename(phaseRoot, path.basename(normalized));
}

function isImageAttachment(attachment) {
  if (!attachment) return false;
  const contentType = String(attachment.contentType || '').toLowerCase();
  if (contentType.startsWith('image/')) return true;
  const attachmentPath = String(attachment.path || '');
  return imageExtRe.test(attachmentPath);
}

function uniquePath(basePath) {
  if (!fs.existsSync(basePath)) return basePath;
  const dir = path.dirname(basePath);
  const ext = path.extname(basePath);
  const name = path.basename(basePath, ext);
  let index = 1;
  while (true) {
    const candidate = path.join(dir, `${name}-${index}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    index += 1;
  }
}

function copyFileSafe(sourcePath, targetPath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return '';
  if (/\.(?:zip|7z|gz|tgz)$/i.test(sourcePath)) return '';
  ensureDir(path.dirname(targetPath));
  const destination = uniquePath(targetPath);
  if (/\.(?:json|har|md|txt|log|html?|xml|csv)$/i.test(destination)) {
    const source = fs.readFileSync(sourcePath, 'utf8');
    fs.writeFileSync(destination, redactSerializedText(source), 'utf8');
  } else {
    fs.copyFileSync(sourcePath, destination);
  }
  return destination;
}

function writeBodyAttachment(body, contentType, targetPathWithoutExt) {
  if (typeof body !== 'string' || !body.length) return '';
  const ext = extensionFromContentType(contentType);
  const targetPath = uniquePath(`${targetPathWithoutExt}${ext}`);
  ensureDir(path.dirname(targetPath));

  try {
    const bytes = Buffer.from(body, 'base64');
    if (/^(?:image|audio|video|application\/(?:pdf|zip|octet-stream))/i.test(contentType || '')) {
      fs.writeFileSync(targetPath, bytes);
    } else {
      fs.writeFileSync(targetPath, redactSerializedText(bytes.toString('utf8')), 'utf8');
    }
    return targetPath;
  } catch {
    fs.writeFileSync(targetPath, redactSerializedText(body), 'utf8');
    return targetPath;
  }
}

function extensionFromContentType(contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('image/png')) return '.png';
  if (type.includes('image/jpeg')) return '.jpg';
  if (type.includes('image/webp')) return '.webp';
  if (type.includes('application/json')) return '.json';
  if (type.includes('text/html')) return '.html';
  if (type.includes('text/plain')) return '.txt';
  if (type.includes('application/zip')) return '.zip';
  if (type.includes('application/pdf')) return '.pdf';
  return '.bin';
}

function collectAnnotations(test, results) {
  const entries = [];
  const seen = new Set();
  const raw = [
    ...(Array.isArray(test.annotations) ? test.annotations : []),
    ...results.flatMap((result) => (Array.isArray(result.annotations) ? result.annotations : [])),
  ];

  for (const annotation of raw) {
    const type = oneLine(annotation && annotation.type ? annotation.type : 'note') || 'note';
    const description = oneLine(annotation && annotation.description ? annotation.description : '');
    const key = `${type}:${description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ type, description });
  }

  return entries;
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

function collectTestsFromSuite(suite, phase, acc = [], suitePath = []) {
  if (!suite) return acc;
  const nextSuitePath = suite.title ? [...suitePath, suite.title] : suitePath;

  if (Array.isArray(suite.specs)) {
    for (const spec of suite.specs) {
      const specFile = spec.file || spec.location?.file || '';
      const specTitle = oneLine(spec.title || '');
      const specPath = uniquePathParts([...nextSuitePath, specTitle]);

      for (const test of spec.tests || []) {
        const results = Array.isArray(test.results) ? test.results : [];
        const final = results[results.length - 1] || {};
        const title = oneLine(test.title || specTitle || '(untitled)');
        const explicitTitlePath = Array.isArray(test.titlePath)
          ? uniquePathParts(test.titlePath)
          : uniquePathParts([...specPath, title]);

        const errorMessage =
          oneLine(final.error?.message) ||
          oneLine(final.errors?.[0]?.message) ||
          oneLine(
            results
              .flatMap((result) => result.errors || [])
              .map((error) => error?.message || '')
              .find(Boolean)
          );

        acc.push({
          phase,
          title,
          titlePath: explicitTitlePath.join(' > ') || title,
          file: specFile,
          projectName: oneLine(test.projectName || final.projectName || ''),
          status: final.status || test.status || 'unknown',
          error: errorMessage,
          annotations: collectAnnotations(test, results),
          attachments: Array.isArray(final.attachments) ? final.attachments : [],
          stdout: Array.isArray(final.stdout) ? final.stdout : [],
          stderr: Array.isArray(final.stderr) ? final.stderr : [],
        });
      }
    }
  }

  if (Array.isArray(suite.suites)) {
    for (const child of suite.suites) collectTestsFromSuite(child, phase, acc, nextSuitePath);
  }

  return acc;
}

function loadReportSources() {
  const phaseSources = phaseReportCandidates
    .map((entry) => {
      for (const candidatePath of entry.paths) {
        const data = readJson(candidatePath);
        if (data) return { phase: entry.phase, path: candidatePath, data };
      }
      return null;
    })
    .filter(Boolean);

  if (phaseSources.length) return phaseSources;

  const fallback = readJson(reportPath);
  if (fallback) {
    return [{ phase: 'latest', path: reportPath, data: fallback }];
  }

  return [];
}

function walkImages(rootPath) {
  if (!rootPath || !fs.existsSync(rootPath)) return [];
  const found = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const current = queue.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (safeRootIgnoreNames.has(entry.name)) continue;
        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (imageExtRe.test(entry.name)) found.push(fullPath);
    }
  }

  return found;
}

function groupedAllDestination(sourcePath) {
  if (isSubPath(sourcePath, autotestReportDir)) {
    const rel = path.relative(autotestReportDir, sourcePath);
    return path.join(screenshotsAllDir, 'autotest-report', rel);
  }
  if (isSubPath(sourcePath, reportDir)) {
    const rel = path.relative(reportDir, sourcePath);
    return path.join(screenshotsAllDir, 'test-results', rel);
  }
  if (isSubPath(sourcePath, phaseReportsDir)) {
    const rel = path.relative(phaseReportsDir, sourcePath);
    return path.join(screenshotsAllDir, 'phase-reports', rel);
  }
  if (isSubPath(sourcePath, projectPaths.analyzeDir)) {
    const rel = path.relative(projectPaths.analyzeDir, sourcePath);
    return path.join(screenshotsAllDir, 'analyze', rel);
  }
  if (isSubPath(sourcePath, projectPaths.artifactsDir)) {
    const rel = path.relative(projectPaths.artifactsDir, sourcePath);
    return path.join(screenshotsAllDir, 'artifacts', rel);
  }
  return path.join(screenshotsAllDir, 'misc', path.basename(sourcePath));
}

function formatOutput(outputEntries) {
  if (!Array.isArray(outputEntries) || outputEntries.length === 0) return '';
  return outputEntries
    .map((entry) => {
      if (typeof entry === 'string') return redactText(entry);
      return oneLine(entry && (entry.text || entry.message || JSON.stringify(entry)));
    })
    .filter(Boolean)
    .join('\n');
}

function extractUrls(text) {
  const urls = [];
  const re = /https?:\/\/[^\s|)]+/gi;
  const source = String(text || '');
  let match = re.exec(source);
  while (match) {
    urls.push(match[0]);
    match = re.exec(source);
  }
  return urls;
}

function pushNetworkCandidate(list, candidate) {
  if (!candidate || !candidate.url) return;
  const normalized = {
    url: String(candidate.url || ''),
    method: oneLine(candidate.method || ''),
    status: Number.isFinite(Number(candidate.status)) ? Number(candidate.status) : null,
    statusText: oneLine(candidate.statusText || ''),
    errorText: oneLine(candidate.errorText || ''),
    consoleError: oneLine(candidate.consoleError || ''),
    source: oneLine(candidate.source || ''),
  };
  const key = JSON.stringify(normalized);
  if (list.keys.has(key)) return;
  list.keys.add(key);
  list.items.push(normalized);
}

function collectNetworkFromJson(value, list, sourceLabel) {
  if (!value || typeof value !== 'object') return;
  const stack = [value];
  let guard = 0;

  while (stack.length > 0 && guard < 5000) {
    guard += 1;
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    if (typeof current.url === 'string') {
      pushNetworkCandidate(list, {
        url: current.url,
        method: current.method,
        status: current.status,
        statusText: current.statusText,
        errorText: current.errorText,
        source: sourceLabel,
      });
    }

    if (current.location && typeof current.location.url === 'string' && current.text) {
      pushNetworkCandidate(list, {
        url: current.location.url,
        consoleError: current.text,
        source: sourceLabel,
      });
    }

    for (const valueItem of Object.values(current)) {
      if (valueItem && typeof valueItem === 'object') stack.push(valueItem);
    }
  }
}

function pickPrimaryNetwork(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const highPriority = candidates.find(
    (item) =>
      (typeof item.status === 'number' && item.status >= 400) || item.errorText || item.consoleError
  );
  return highPriority || candidates[0];
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function asRelative(absolutePath, root) {
  const rel = path.relative(root, absolutePath);
  return rel.split(path.sep).join('/');
}

function dedupeStrings(items) {
  const output = [];
  const seen = new Set();
  for (const raw of items || []) {
    const value = oneLine(raw || '');
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function inferExecutionMode(test) {
  const envMode = oneLine(process.env.QA_EXECUTION_MODE || '').toLowerCase();
  if (envMode === 'mobile' || envMode === 'desktop') return envMode;

  const projectName = oneLine(test && test.projectName ? test.projectName : '').toLowerCase();
  if (projectName.includes('mobile')) return 'mobile';
  if (projectName.includes('desktop')) return 'desktop';

  const titlePath = oneLine(test && test.titlePath ? test.titlePath : '').toLowerCase();
  if (/\[mobile\]|\bmobile\b/.test(titlePath)) return 'mobile';
  if (/\[desktop\]|\bdesktop\b/.test(titlePath)) return 'desktop';

  return 'desktop';
}

function inferAreaContext(test) {
  const fileLower = String(test.file || '').toLowerCase();
  const titleLower = oneLine(`${test.titlePath || ''} ${test.title || ''}`).toLowerCase();
  const phaseLower = String(test.phase || '').toLowerCase();

  if (
    fileLower.includes('livecasino') ||
    phaseLower === 'livecasino' ||
    /\blive casino\b/.test(titleLower)
  ) {
    return { key: 'livecasino', label: 'Live Casino', route: '/live-casino' };
  }
  if (fileLower.includes('casino') || phaseLower === 'casino' || /\bcasino\b/.test(titleLower)) {
    return { key: 'casino', label: 'Casino', route: '/casino' };
  }
  if (fileLower.includes('sports') || phaseLower === 'sports' || /\bsports?\b/.test(titleLower)) {
    return { key: 'sports', label: 'Sports', route: '/sports' };
  }
  if (fileLower.includes('deposit') || phaseLower === 'deposit' || /\bdeposit\b/.test(titleLower)) {
    return { key: 'deposit', label: 'Deposit', route: '/deposit' };
  }
  if (
    fileLower.includes('withdraw') ||
    phaseLower === 'withdraw' ||
    /\bwithdraw\b|\bcashout\b/.test(titleLower)
  ) {
    return { key: 'withdraw', label: 'Withdraw', route: '/assets' };
  }
  if (
    fileLower.includes('profile') ||
    phaseLower === 'profile' ||
    phaseLower === 'security' ||
    /\bmy profile\b|\bsecurity\b/.test(titleLower)
  ) {
    return { key: 'profile', label: 'My Profile', route: '/profile' };
  }
  if (
    fileLower.includes('contract') ||
    phaseLower === 'contracts' ||
    /\bcontract\b|\bopenapi\b|\bschemathesis\b|\bspectral\b/.test(titleLower)
  ) {
    return { key: 'contracts', label: 'Contracts', route: '/api' };
  }
  if (fileLower.includes('sidebar') || phaseLower === 'sidebar' || /\bsidebar\b/.test(titleLower)) {
    return { key: 'sidebar', label: 'Sidebar', route: '/' };
  }
  if (
    fileLower.includes('signup') ||
    phaseLower === 'registration' ||
    /\bregistration\b|\bsign[\s-]?up\b/.test(titleLower)
  ) {
    return { key: 'registration', label: 'Registration', route: '/' };
  }
  if (
    fileLower.includes('login') ||
    phaseLower === 'auth' ||
    /\blog[\s-]?in\b|\bauth\b/.test(titleLower)
  ) {
    return { key: 'auth', label: 'Login', route: '/' };
  }
  if (
    fileLower.includes('home') ||
    fileLower.includes('precheck') ||
    phaseLower === 'home' ||
    phaseLower === 'precheck'
  ) {
    return { key: 'home', label: 'Home', route: '/' };
  }
  return { key: phaseLower || 'main', label: 'Application', route: '/' };
}

function inferUserState({ test, area }) {
  const titleLower = oneLine(`${test.titlePath || ''} ${test.title || ''}`).toLowerCase();
  const phaseLower = String(test.phase || '').toLowerCase();

  if (/\bguest\b/.test(titleLower)) return 'guest';
  if (/\bauthorized\b|\blogged in\b|\blog in\b|\bsigned in\b/.test(titleLower)) return 'authorized';
  if (/\bregistration\b|\bsign[\s-]?up\b/.test(titleLower)) return 'guest';
  if (area.key === 'auth' || area.key === 'home' || area.key === 'registration') return 'guest';
  if (area.key === 'profile' || area.key === 'deposit' || area.key === 'sports')
    return 'authorized';
  if (
    area.key === 'casino' &&
    /\breal\b|\bnon-demo\b|\bfavorites?\b|\bhistory\b|\brecent\b|\bplay opens\b/.test(titleLower)
  ) {
    return 'authorized';
  }
  if (phaseLower === 'sidebar' && /\bauthorized\b/.test(titleLower)) return 'authorized';
  return 'guest';
}

function extractProviderName(title) {
  const normalizedTitle = oneLine(title || '');
  const providerMatch =
    normalizedTitle.match(/provider[^()]*\(([^)]+)\)/i) ||
    normalizedTitle.match(/real launch \(([^)]+)\)/i) ||
    normalizedTitle.match(/launch \(([^)]+)\)/i);
  return providerMatch ? oneLine(providerMatch[1]) : '';
}

function inferExpectedResult({ area, title, providerName }) {
  const titleLower = oneLine(title || '').toLowerCase();
  if (/\bavatar\b/.test(titleLower)) {
    return 'В разделе Account отображается загрузка аватара; поддерживаемое изображение сохраняется и остаётся после перезагрузки.';
  }
  if (/editable field persists/.test(titleLower)) {
    return 'В профиле есть редактируемое текстовое поле; новое допустимое значение сохраняется после перезагрузки.';
  }
  if (/profile validations/.test(titleLower)) {
    return 'Поля профиля отображаются и показывают корректную ошибку для обязательного, неверного или слишком длинного значения.';
  }
  if (/settings section/.test(titleLower)) {
    return 'В разделе Settings доступны настройки; изменённое значение сохраняется после перезагрузки.';
  }
  if (/favorites?/.test(titleLower)) {
    return 'На карточке игры доступно управление избранным; выбранная игра появляется в списке Favorites.';
  }
  if (/recent history|recent games/.test(titleLower)) {
    return 'После успешного запуска игра появляется в списке недавних с тем же id, slug или provider link.';
  }
  if (/network diagnostics/.test(titleLower)) {
    return 'Спортивная страница не формирует запросы ассетов с undefined/null country code; для неизвестной страны используется нейтральный флаг.';
  }
  if (/metadata smoke/.test(titleLower)) {
    return 'На всех проверяемых спортивных маршрутах заданы корректные и непустые title, H1 и canonical URL.';
  }
  if (providerName && /\bprovider\b.*\breal launch\b|\bnon-demo\b/.test(titleLower)) {
    return `Игра провайдера «${providerName}» запускается в реальном режиме и работает без ошибок запросов или критичных ошибок консоли.`;
  }
  if (/\bdemo\b|\btry for fun\b/.test(titleLower)) {
    return 'Выбранная игра запускается в деморежиме и работает стабильно.';
  }
  if (/\bsearch\b/.test(titleLower)) {
    return 'Поиск открывается, принимает запрос и показывает ожидаемые результаты без ошибок интерфейса или выполнения.';
  }
  if (/\bfilter\b/.test(titleLower)) {
    return 'Панель фильтров открывается, выбранный фильтр применяется, каталог обновляется корректно.';
  }
  if (area.key === 'deposit') {
    return 'Раздел депозита открывается, видимые способы оплаты доступны без ошибок выполнения.';
  }
  if (area.key === 'profile') {
    return 'Раздел профиля открывается, целевые элементы доступны и работают без ошибок валидации или выполнения.';
  }
  if (area.key === 'sports') {
    return 'Спортивная страница открывается, целевые действия выполняются без маршрутных, интерфейсных и сетевых блокировок.';
  }
  if (/\blive chat\b/.test(titleLower)) {
    return 'Виджет Live Chat открывается, целевое действие выполняется успешно.';
  }
  return 'Сценарий завершается успешно без критичных ошибок интерфейса, выполнения или сети.';
}

function primaryAnnotation(test) {
  const annotations = Array.isArray(test.annotations) ? test.annotations : [];
  const metadataSignal = annotations.find((item) =>
    /metadata has \d+ warning/i.test(oneLine(item && item.description))
  );
  if (metadataSignal) return oneLine(metadataSignal.description);
  const preferredTypes = [
    'product-blocked',
    'product-warning',
    'provider-blocked',
    'infra-blocked',
    'test-infra',
    'blocked',
    'partial',
  ];
  for (const type of preferredTypes) {
    const match = annotations.find(
      (item) =>
        String((item && item.type) || '').toLowerCase() === type &&
        oneLine(item && item.description)
    );
    if (match) return oneLine(match.description);
  }
  const fallback = annotations.find((item) => oneLine(item && item.description));
  return fallback ? oneLine(fallback.description) : '';
}

function conciseActualResult(test) {
  const error = oneLine(test.error || '');
  if (error) return error;
  const signal = primaryAnnotation(test);
  if (!signal) return 'Автотест зафиксировал отклонение без текстового сообщения.';
  const provider = signal.match(/Provider "([^"]+)".*No game cards found/i)?.[1];
  if (/avatar upload control was not found/i.test(signal))
    return 'В разделе Account не найден элемент загрузки аватара.';
  if (/no editable profile text field found/i.test(signal))
    return 'В профиле не найдено редактируемое текстовое поле.';
  if (/validation input fields are not visible/i.test(signal))
    return 'Поля профиля для проверки валидации не отображаются.';
  if (/no preference control found/i.test(signal))
    return 'Не найдено управление настройками, для которого можно проверить сохранение.';
  if (/favorite control is not visible/i.test(signal))
    return 'На карточке игры в текущем интерфейсе не отображается управление избранным.';
  if (/recent games list did not include/i.test(signal))
    return 'Запущенная игра не появилась в списке недавних за отведённое время наблюдения.';
  if (/country flag asset request.*undefined\/null/i.test(signal))
    return 'Два запроса флагов стран содержат undefined/null вместо кода страны.';
  if (/metadata has (\d+) warning/i.test(signal)) {
    const count = signal.match(/metadata has (\d+) warning/i)?.[1] || '';
    return `Автопроверка обнаружила ${count} предупреждений в метаданных спортивных маршрутов.`;
  }
  if (provider)
    return `Для провайдера «${provider}» не найдены карточки игр, поэтому реальный запуск невозможен.`;
  return signal;
}

function titleCaseMode(mode) {
  return mode === 'mobile' ? 'Mobile' : 'Desktop';
}

function inferIssueTitle({ test, manualPlan, actualResult }) {
  const area = inferAreaContext(test);
  const mode = titleCaseMode(manualPlan.executionMode);
  const signal = oneLine(
    `${test.titlePath || test.title || ''} ${primaryAnnotation(test)} ${actualResult}`
  ).toLowerCase();
  const providerName = extractProviderName(test.titlePath || test.title || '');
  let symptom = actualResult;

  if (/avatar upload/.test(signal)) symptom = 'в разделе Account отсутствует загрузка аватара';
  else if (/no editable profile text field/.test(signal))
    symptom = 'в профиле отсутствуют редактируемые текстовые поля';
  else if (/validation input fields are not visible/.test(signal))
    symptom = 'поля для проверки валидации профиля не отображаются';
  else if (/no preference control/.test(signal))
    symptom = 'отсутствуют настройки, для которых можно проверить сохранение';
  else if (/favorite control is not visible/.test(signal))
    symptom = 'на карточке игры отсутствует управление избранным';
  else if (/recent games list did not include/.test(signal))
    symptom = 'запущенная игра не появляется в списке недавних';
  else if (/undefined\/null country code|undefined\.svg/.test(signal))
    symptom = 'запрос флага страны формируется с кодом undefined';
  else if (/metadata has \d+ warning/.test(signal))
    symptom = 'метаданные спортивных страниц не соответствуют требованиям';
  else if (providerName && /no game cards found/.test(signal))
    symptom = `в каталоге провайдера ${providerName} нет игр для запуска`;

  return `[${area.label}][${mode}] ${oneLine(symptom).replace(/[.]$/, '')}`;
}

function inferTriage({ test, manualPlan, actualResult }) {
  const signal = oneLine(
    `${test.titlePath || test.title || ''} ${primaryAnnotation(test)} ${actualResult}`
  ).toLowerCase();
  const isWarning = test.status === 'product-warning';
  const isFailure = failureStatuses.has(test.status);
  let type = isWarning ? 'Предупреждение о качестве' : 'Потенциальный продуктовый дефект';
  let severity = 'S3 — средняя';
  let priority = 'P2 — обычная';
  let confirmation = 'Требуется ручное подтверждение';
  let reproducibility = 'Зафиксировано в одном автоматизированном прогоне';
  let impact = 'Отклонение ухудшает целевой пользовательский сценарий.';

  if (isFailure) {
    type = 'Дефект или нестабильность сценария';
    confirmation = 'Подтверждено падением автотеста; требуется локализация причины';
  }
  if (/undefined\/null country code|undefined\.svg/.test(signal)) {
    severity = 'S3 — средняя';
    priority = 'P2 — обычная';
    confirmation = 'Подтверждено сетевой диагностикой';
    impact = 'Пользователь может видеть отсутствующий или сломанный флаг страны.';
  } else if (/metadata has \d+ warning|metadata smoke/.test(signal)) {
    severity = 'S3 — средняя';
    priority = 'P2 — обычная';
    confirmation = 'Подтверждено автоматической проверкой метаданных';
    impact = 'Снижается качество SEO, шаринга и доступности спортивных страниц.';
  } else if (/no game cards found/.test(signal)) {
    severity = 'S2 — высокая';
    priority = 'P1 — высокая';
    impact = 'Игрок не может выбрать и запустить игру указанного провайдера.';
  } else if (/recent games list did not include/.test(signal)) {
    severity = 'S2 — высокая';
    priority = 'P1 — высокая';
    confirmation = 'Подтверждено автоматизированным запуском и последующей проверкой списка';
    impact = 'Игрок не может быстро вернуться к недавно запущенной игре.';
  } else if (/favorite control is not visible/.test(signal)) {
    severity = 'S3 — средняя';
    impact = 'Игрок не может добавить игру в избранное из текущего интерфейса.';
  } else if (/avatar upload/.test(signal)) {
    severity = 'S4 — низкая';
    priority = 'P3 — низкая';
    impact = 'Игрок не может персонализировать профиль аватаром.';
  } else if (/editable profile|validation input fields/.test(signal)) {
    severity = 'S2 — высокая';
    priority = 'P1 — высокая';
    impact = 'Нельзя изменить или корректно проверить персональные данные профиля.';
  } else if (/preference control/.test(signal)) {
    severity = 'S3 — средняя';
    impact = 'Нельзя изменить и сохранить пользовательские настройки.';
  }

  if (test.status === 'product-blocked' && !/recent games list did not include/.test(signal)) {
    reproducibility =
      'Автотест не смог продолжить сценарий из-за отсутствующего элемента или данных';
  }

  return {
    type,
    severity,
    priority,
    confirmation,
    reproducibility,
    impact,
    workflowStatus: 'Нужен триаж',
    component: inferAreaContext(test).label,
    issueTitle: inferIssueTitle({ test, manualPlan, actualResult }),
  };
}

function inferViewport(mode) {
  return mode === 'mobile' ? '390 × 844' : '1365 × 900';
}

function compactLogExcerpt(value, maxLines = 12, maxChars = 2200) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, maxLines);
  const excerpt = lines.join('\n');
  return excerpt.length > maxChars ? `${excerpt.slice(0, maxChars)}…` : excerpt;
}

function relevantNetworkRecords(candidates, primaryNetwork) {
  const records = Array.isArray(candidates) ? candidates : [];
  const relevant = records.filter((item) => {
    const url = String((item && item.url) || '').toLowerCase();
    return (
      (primaryNetwork && item.url === primaryNetwork.url) ||
      (typeof item.status === 'number' && item.status >= 400) ||
      item.errorText ||
      item.consoleError ||
      /undefined|\/null(?:[./?#]|$)|\/error(?:[/?#]|$)|\/fail(?:[/?#]|$)/.test(url)
    );
  });
  const unique = new Map();
  for (const item of relevant) {
    if (!unique.has(item.url)) unique.set(item.url, item);
  }
  return Array.from(unique.values()).slice(0, 5);
}

function displayNetworkUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return oneLine(value || '');
  }
}

function buildManualReproPlan({ test, commandHint, primaryNetwork }) {
  const area = inferAreaContext(test);
  const userState = inferUserState({ test, area });
  const executionMode = inferExecutionMode(test);
  const title = oneLine(test.titlePath || test.title || '');
  const titleLower = title.toLowerCase();
  const providerName = extractProviderName(title);

  const preconditions = [
    `URL бренда: ${baseUrl}`,
    `Режим запуска: ${executionMode}`,
    userState === 'authorized'
      ? 'Доступна существующая учётная запись игрока с возможностью авторизации.'
      : 'Используется гостевая сессия без авторизации.',
  ];
  if (test.projectName) {
    preconditions.push(`Проект Playwright: ${test.projectName}.`);
  }
  if (area.route && area.route !== '/') {
    preconditions.push(`Целевой раздел доступен по маршруту ${area.route}.`);
  }
  if (providerName) {
    preconditions.push(`Провайдер доступен в списке фильтров: ${providerName}.`);
  }
  if (primaryNetwork && primaryNetwork.url) {
    preconditions.push('Перед последним действием открыта вкладка Network в DevTools.');
  }

  const steps = [
    `Открыть ${baseUrl} в чистой сессии браузера и дождаться полной загрузки главной страницы.`,
  ];
  if (executionMode === 'mobile') {
    steps.push('До начала действий включить мобильный viewport 390×844.');
  }

  if (userState === 'authorized') {
    steps.push('Авторизоваться под существующей учётной записью игрока.');
  } else if (userState === 'guest') {
    steps.push('Остаться без авторизации в гостевом режиме.');
  }

  if (area.key === 'casino') {
    steps.push('Открыть страницу Casino.');
  } else if (area.key === 'livecasino') {
    steps.push('Открыть страницу Live Casino.');
  } else if (area.key === 'sports') {
    steps.push('Открыть страницу Sports.');
  } else if (area.key === 'profile') {
    steps.push('Открыть My Profile.');
  } else if (area.key === 'deposit') {
    steps.push('Открыть раздел депозита через шапку сайта или кошелёк профиля.');
  } else if (area.key === 'sidebar') {
    steps.push('Открыть боковое меню навигации.');
  } else if (area.key === 'registration') {
    steps.push('Открыть форму регистрации.');
  } else if (area.key === 'auth') {
    steps.push('Открыть форму входа.');
  }

  if (providerName && /\bprovider\b.*\breal launch\b|\bnon-demo\b/.test(titleLower)) {
    steps.push(`Открыть фильтр провайдеров и выбрать «${providerName}».`);
    steps.push(`Запустить любую игру «${providerName}» кнопкой Play, не в деморежиме.`);
    steps.push('Подождать до 90 секунд, пока игровая область или iframe стабилизируется.');
  } else if (providerName && /\bdemo\b|\btry for fun\b/.test(titleLower)) {
    steps.push(`Открыть фильтр провайдеров и выбрать «${providerName}».`);
    steps.push(`Запустить любую игру «${providerName}» через Try for Fun / Demo.`);
  } else if (/favorites?/.test(titleLower)) {
    steps.push('На карточке игры нажать управление избранным и открыть список Favorites.');
  } else if (/recent history|recent games/.test(titleLower)) {
    steps.push('Запустить игру в реальном режиме, закрыть её и открыть список недавних игр.');
  } else if (/metadata smoke/.test(titleLower)) {
    steps.push(
      'Для каждого проверяемого спортивного маршрута проверить document.title, видимый H1 и canonical link.'
    );
  } else if (/network diagnostics/.test(titleLower)) {
    steps.push(
      'Проверить запросы флагов стран в Network и найти URL с undefined/null вместо кода страны.'
    );
  } else if (/\bsearch\b/.test(titleLower)) {
    steps.push('Открыть поиск, ввести запрос и применить его.');
  } else if (/\bfilter\b/.test(titleLower)) {
    steps.push('Открыть фильтры, выбрать значение и проверить обновление каталога.');
  } else if (/\blive chat\b/.test(titleLower)) {
    steps.push('Открыть Live Chat и выполнить целевое действие сценария.');
  } else if (/\bavatar\b/.test(titleLower)) {
    steps.push('В разделе Account загрузить аватар и сохранить изменения.');
  } else if (/editable field persists/.test(titleLower)) {
    steps.push(
      'Изменить доступное текстовое поле профиля, сохранить данные и перезагрузить страницу.'
    );
  } else if (/profile validations/.test(titleLower)) {
    steps.push(
      'Поочерёдно ввести в поле профиля пустое, неверное и слишком длинное значение, сохраняя форму.'
    );
  } else if (/\bsettings\b|\btoggle\b|\bdropdown\b/.test(titleLower)) {
    steps.push(
      'В целевом разделе изменить настройку, переключатель или список и применить изменения.'
    );
  } else {
    steps.push(`Повторить пользовательские действия из исходного теста: «${test.title || title}».`);
  }

  if (primaryNetwork && primaryNetwork.url) {
    steps.push(`Проверить запросы, связанные с ${displayNetworkUrl(primaryNetwork.url)}.`);
  }
  steps.push('Сравнить результат с разделами «Фактический» и «Ожидаемый» ниже.');

  return {
    executionMode,
    preconditions: dedupeStrings(preconditions),
    steps: dedupeStrings(steps),
    expectedResult: inferExpectedResult({ area, title, providerName }),
    commandHint,
  };
}

function buildBugMarkdown({
  bugId,
  test,
  commandHint,
  manualPlan,
  triage,
  generatedAt,
  playerCredentials,
  actualResult,
  primaryNetwork,
  networkCandidates,
  screenshotRelPath,
  copiedAttachments,
  stdoutText,
  stderrText,
}) {
  const evidence = dedupeEvidence(copiedAttachments);
  const lines = [];
  lines.push(`# ${triage.issueTitle}`);
  lines.push('');
  lines.push(`> ${actualResult}`);
  lines.push('');
  lines.push('## Триаж');
  lines.push('');
  lines.push('| Поле | Значение |');
  lines.push('| --- | --- |');
  lines.push(`| ID | ${bugId} |`);
  lines.push(`| Статус | ${triage.workflowStatus} |`);
  lines.push(`| Тип | ${triage.type} |`);
  lines.push(`| Серьёзность | ${triage.severity} |`);
  lines.push(`| Приоритет | ${triage.priority} |`);
  lines.push(`| Компонент | ${triage.component} |`);
  lines.push(`| Подтверждение | ${triage.confirmation} |`);
  lines.push(`| Воспроизводимость | ${triage.reproducibility} |`);
  lines.push('');
  lines.push('## Влияние');
  lines.push('');
  lines.push(triage.impact);
  lines.push('');
  lines.push('## Окружение');
  lines.push('');
  lines.push(`- URL: ${baseUrl}`);
  lines.push(`- Платформа: ${manualPlan.executionMode || '-'}`);
  lines.push(`- Viewport: ${inferViewport(manualPlan.executionMode)}`);
  lines.push(`- Браузер: Chromium / Playwright (${test.projectName || 'project не указан'})`);
  lines.push(`- ОС раннера: ${process.platform} ${process.arch}`);
  lines.push(`- Сформировано: ${generatedAt}`);
  lines.push('');
  lines.push('## Данные тестового игрока');
  lines.push('');
  lines.push(`- Почта: ${playerCredentials.email}`);
  lines.push(`- Пароль: ${playerCredentials.password}`);
  lines.push(`- Источник: ${playerCredentials.source}`);
  lines.push(`- Статус проверки входа: ${playerCredentials.validationStatus}`);
  lines.push('');
  lines.push('## Предусловия');
  lines.push('');
  for (const precondition of manualPlan.preconditions || []) {
    lines.push(`- ${precondition}`);
  }
  lines.push('');
  lines.push('## Шаги воспроизведения');
  lines.push('');
  for (let index = 0; index < (manualPlan.steps || []).length; index += 1) {
    lines.push(`${index + 1}. ${manualPlan.steps[index]}`);
  }
  lines.push('');
  lines.push('## Фактический и ожидаемый результат');
  lines.push('');
  lines.push('| Фактический | Ожидаемый |');
  lines.push('| --- | --- |');
  lines.push(`| ${actualResult || 'Сообщение не сохранено.'} | ${manualPlan.expectedResult} |`);
  lines.push('');
  lines.push('## Критерии приёмки исправления');
  lines.push('');
  lines.push(`- [ ] ${manualPlan.expectedResult}`);
  lines.push(
    '- [ ] Повторный запуск целевого теста завершается без product-blocked/product-warning.'
  );
  lines.push('- [ ] В консоли и Network нет новых критичных ошибок для этого сценария.');
  lines.push('');
  lines.push('## Доказательства');
  lines.push('');
  lines.push(`- Скриншот: ${screenshotRelPath || 'не был сохранён'}`);
  for (const item of evidence) lines.push(`- Вложение: ${item.relPath}`);
  lines.push(`- Сетевых записей: ${networkCandidates.length} (полный файл: network-evidence.json)`);
  lines.push('');
  lines.push('## Техническая диагностика');
  lines.push('');
  lines.push(`- Исходный тест: ${test.titlePath || test.title}`);
  lines.push(`- Файл: ${test.file || '-'}`);
  lines.push(`- Фаза / статус автоматики: ${test.phase} / ${test.status}`);
  lines.push(`- Команда повтора: \`${commandHint}\``);
  if (primaryNetwork) {
    lines.push(
      `- Основной запрос: ${primaryNetwork.method || 'GET'} ${displayNetworkUrl(primaryNetwork.url)}`
    );
    lines.push(
      `- HTTP / ошибка: ${primaryNetwork.status != null ? primaryNetwork.status : '-'} ${primaryNetwork.errorText || primaryNetwork.consoleError || ''}`
    );
  } else {
    lines.push('- Основной проблемный запрос не определён.');
  }
  lines.push('');
  lines.push('### Выдержка из логов');
  lines.push('');
  const logExcerpt = compactLogExcerpt(stderrText || stdoutText);
  if (logExcerpt) {
    lines.push('```text');
    lines.push(logExcerpt);
    lines.push('```');
    lines.push('');
    lines.push('Полный вывод сохранён в `logs.txt`.');
  } else {
    lines.push(
      'stdout/stderr для финальной попытки не сохранены; диагностические аннотации доступны в `logs.txt`.'
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildBugHtml({
  bugId,
  test,
  commandHint,
  manualPlan,
  triage,
  generatedAt,
  playerCredentials,
  actualResult,
  primaryNetwork,
  networkCandidates,
  screenshotRelPath,
  copiedAttachments,
  stdoutText,
  stderrText,
}) {
  const evidence = dedupeEvidence(copiedAttachments);
  const visibleNetworkRecords = relevantNetworkRecords(networkCandidates, primaryNetwork);
  const screenshotBlock = screenshotRelPath
    ? `<div class="evidence-card"><h3>Скриншот</h3><img src="${escapeHtml(
        screenshotRelPath
      )}" alt="Bug screenshot" /></div>`
    : '<div class="evidence-card muted"><h3>Скриншот</h3><p>Не был сохранён для этой проверки.</p></div>';

  const attachmentsHtml =
    evidence.length > 0
      ? `<ul>${evidence.map((item) => `<li>${escapeHtml(item.relPath)}</li>`).join('')}</ul>`
      : '<p class="muted">Дополнительных вложений нет.</p>';

  const networkRows =
    visibleNetworkRecords.length > 0
      ? visibleNetworkRecords
          .map(
            (item) => `<tr>
      <td>${escapeHtml(displayNetworkUrl(item.url))}</td>
      <td>${escapeHtml(item.method || '-')}</td>
      <td>${escapeHtml(item.status != null ? String(item.status) : '-')}</td>
      <td>${escapeHtml(item.errorText || item.consoleError || '-')}</td>
      <td>${escapeHtml(item.source || '-')}</td>
    </tr>`
          )
          .join('')
      : '<tr><td colspan="5">Сетевые записи не найдены.</td></tr>';

  const primaryNetworkHtml = primaryNetwork
    ? `<div class="network-primary">
      <div><strong>URL:</strong> ${escapeHtml(displayNetworkUrl(primaryNetwork.url))}</div>
      <div><strong>Метод:</strong> ${escapeHtml(primaryNetwork.method || '-')}</div>
      <div><strong>Статус:</strong> ${
        primaryNetwork.status != null ? escapeHtml(String(primaryNetwork.status)) : '-'
      }</div>
      <div><strong>Ошибка:</strong> ${escapeHtml(
        primaryNetwork.errorText || primaryNetwork.consoleError || '-'
      )}</div>
    </div>`
    : '<p class="muted">Основной проблемный запрос не определён.</p>';

  const logExcerpt = compactLogExcerpt(stderrText || stdoutText);

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(triage.issueTitle)}</title>
    <style>
      @page { size: A4; margin: 13mm 12mm 15mm; }
      * { box-sizing: border-box; }
      html, body { width: 100%; max-width: 100%; overflow-x: hidden; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; margin: 0; color: #172033; font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
      h1 { margin: 0 0 8px; max-width: 100%; font-size: 22px; line-height: 1.22; color: #101828; overflow-wrap: anywhere; }
      h2 { margin: 0 0 10px; font-size: 15px; color: #101828; }
      h3 { margin: 0 0 7px; font-size: 12px; }
      section { margin: 0 0 15px; break-inside: avoid; }
      .eyebrow { max-width: 100%; color: #475467; font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; overflow-wrap: anywhere; }
      .summary { width: 100%; max-width: 100%; margin: 0 0 16px; padding: 11px 13px; border-left: 4px solid #d92d20; background: #fff4f2; font-size: 12px; }
      .triage { display: grid; width: 100%; min-width: 0; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
      .metric { min-width: 0; padding: 8px 9px; border: 1px solid #e4e7ec; border-radius: 7px; background: #f9fafb; overflow-wrap: anywhere; }
      .metric b { display: block; margin-bottom: 2px; font-size: 9px; color: #667085; text-transform: uppercase; }
      .impact { padding: 10px 12px; border-radius: 7px; background: #fffaeb; border: 1px solid #fedf89; }
      .credentials { padding: 10px 12px; border-radius: 7px; background: #eff8ff; border: 1px solid #b2ddff; }
      .credentials-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 14px; }
      .credential-value { font-family: Menlo, Monaco, Consolas, monospace; overflow-wrap: anywhere; }
      .security-note { margin: 7px 0 0; color: #475467; font-size: 9px; }
      .env { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 14px; }
      .env div { border-bottom: 1px solid #eaecf0; padding: 3px 0; }
      ol, ul { margin: 6px 0 0; padding-left: 19px; }
      li { margin: 0 0 4px; }
      .result-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
      .result { border-radius: 7px; padding: 10px; border: 1px solid #e4e7ec; }
      .actual { border-color: #fda29b; background: #fff4f2; }
      .expected { border-color: #6ce9a6; background: #ecfdf3; }
      .evidence-grid { display: grid; grid-template-columns: 1.2fr .8fr; gap: 9px; }
      .evidence-card { border: 1px solid #e4e7ec; border-radius: 7px; padding: 9px; }
      code, pre { font-family: Menlo, Monaco, Consolas, monospace; font-size: 9px; }
      code { overflow-wrap: anywhere; }
      pre { background: #f8fafc; border: 1px solid #e4e7ec; padding: 8px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; }
      img { display: block; max-width: 100%; max-height: 260px; object-fit: contain; border: 1px solid #d0d5dd; border-radius: 5px; }
      table { border-collapse: collapse; width: 100%; font-size: 9px; table-layout: fixed; }
      th, td { border: 1px solid #e4e7ec; padding: 5px; vertical-align: top; overflow-wrap: anywhere; }
      th { background: #f2f4f7; text-align: left; }
      .muted { color: #667085; }
      .technical { break-before: auto; }
      .technical-row { margin: 0 0 4px; overflow-wrap: anywhere; }
      .checklist { list-style: none; padding-left: 0; }
      .checklist li::before { content: "□"; margin-right: 7px; font-size: 14px; }
      .footer-note { margin-top: 9px; color: #667085; font-size: 9px; }
    </style>
  </head>
  <body>
    <div class="eyebrow">${escapeHtml(bugId)} · ${escapeHtml(triage.workflowStatus)}</div>
    <h1>${escapeHtml(triage.issueTitle)}</h1>
    <p class="summary">${escapeHtml(actualResult)}</p>

    <section>
      <h2>Триаж</h2>
      <div class="triage">
        <div class="metric"><b>Тип</b>${escapeHtml(triage.type)}</div>
        <div class="metric"><b>Серьёзность</b>${escapeHtml(triage.severity)}</div>
        <div class="metric"><b>Приоритет</b>${escapeHtml(triage.priority)}</div>
        <div class="metric"><b>Компонент</b>${escapeHtml(triage.component)}</div>
        <div class="metric"><b>Подтверждение</b>${escapeHtml(triage.confirmation)}</div>
        <div class="metric"><b>Воспроизводимость</b>${escapeHtml(triage.reproducibility)}</div>
      </div>
    </section>

    <section>
      <h2>Влияние</h2>
      <div class="impact">${escapeHtml(triage.impact)}</div>
    </section>

    <section>
      <h2>Окружение</h2>
      <div class="env">
        <div><strong>URL:</strong> ${escapeHtml(baseUrl)}</div>
        <div><strong>Платформа:</strong> ${escapeHtml(manualPlan.executionMode || '-')}</div>
        <div><strong>Viewport:</strong> ${escapeHtml(inferViewport(manualPlan.executionMode))}</div>
        <div><strong>Браузер:</strong> Chromium / Playwright (${escapeHtml(test.projectName || '-')})</div>
        <div><strong>ОС раннера:</strong> ${escapeHtml(`${process.platform} ${process.arch}`)}</div>
        <div><strong>Сформировано:</strong> ${escapeHtml(generatedAt)}</div>
      </div>
    </section>

    <section>
      <h2>Данные тестового игрока</h2>
      <div class="credentials">
        <div class="credentials-grid">
          <div><strong>Почта:</strong> <span class="credential-value">${escapeHtml(playerCredentials.email)}</span></div>
          <div><strong>Пароль:</strong> <span class="credential-value">${escapeHtml(playerCredentials.password)}</span></div>
          <div><strong>Источник:</strong> ${escapeHtml(playerCredentials.source)}</div>
          <div><strong>Статус проверки входа:</strong> ${escapeHtml(playerCredentials.validationStatus)}</div>
        </div>
        <p class="security-note">Содержит открытые учётные данные тестового аккаунта. Ограничьте доступ к отчёту.</p>
      </div>
    </section>

    <section>
      <h2>Предусловия</h2>
      <ul>
        ${(manualPlan.preconditions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>
    </section>

    <section>
      <h2>Шаги воспроизведения</h2>
      <ol>
        ${(manualPlan.steps || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ol>
    </section>

    <section>
      <h2>Результат</h2>
      <div class="result-grid">
        <div class="result actual"><h3>Фактический</h3>${escapeHtml(actualResult)}</div>
        <div class="result expected"><h3>Ожидаемый</h3>${escapeHtml(manualPlan.expectedResult)}</div>
      </div>
    </section>

    <section>
      <h2>Критерии приёмки исправления</h2>
      <ul class="checklist">
        <li>${escapeHtml(manualPlan.expectedResult)}</li>
        <li>Повторный запуск теста завершается без product-blocked/product-warning.</li>
        <li>В консоли и Network нет новых критичных ошибок для этого сценария.</li>
      </ul>
    </section>

    <section>
      <h2>Доказательства</h2>
      <div class="evidence-grid">
        ${screenshotBlock}
        <div class="evidence-card">
          <h3>Вложения</h3>
          ${attachmentsHtml}
          <p class="footer-note">Сетевых записей: ${networkCandidates.length}. Полные данные: network-evidence.json</p>
        </div>
      </div>
    </section>

    <section class="technical">
      <h2>Техническая диагностика</h2>
      <div class="technical-row"><strong>Исходный тест:</strong> ${escapeHtml(test.titlePath || test.title)}</div>
      <div class="technical-row"><strong>Файл:</strong> ${escapeHtml(test.file || '-')}</div>
      <div class="technical-row"><strong>Фаза / статус:</strong> ${escapeHtml(test.phase)} / ${escapeHtml(test.status)}</div>
      <div class="technical-row"><strong>Команда повтора:</strong> <code>${escapeHtml(commandHint)}</code></div>
      <h3 style="margin-top:10px">Основной сетевой сигнал</h3>
      ${primaryNetworkHtml}
      <h3 style="margin-top:10px">Выдержка из логов</h3>
      ${logExcerpt ? `<pre>${escapeHtml(logExcerpt)}</pre><p class="muted">Полный вывод: logs.txt</p>` : '<p class="muted">stdout/stderr не сохранены; аннотации доступны в logs.txt.</p>'}
    </section>

    ${
      visibleNetworkRecords.length > 1
        ? `<section>
      <h2>Релевантные сетевые записи (${visibleNetworkRecords.length}; всего сохранено ${networkCandidates.length})</h2>
      <table>
        <thead>
          <tr>
            <th>URL</th>
            <th style="width:10%">Метод</th>
            <th style="width:10%">Статус</th>
            <th style="width:22%">Ошибка</th>
            <th style="width:18%">Источник</th>
          </tr>
        </thead>
        <tbody>${networkRows}</tbody>
      </table>
    </section>`
        : ''
    }
  </body>
</html>
`;
}

async function exportPdfFromHtml(page, htmlPath, pdfPath) {
  ensureDir(path.dirname(pdfPath));
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="width:100%;padding:0 12mm;text-align:right;font-family:Arial,sans-serif;font-size:8px;color:#667085"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
  });
}

function safeCommandHint(test) {
  const grepTitle = String(test.title || '').replace(/"/g, '\\"');
  let testFile = test.file || '';
  if (testFile && !fs.existsSync(path.resolve(cwd, testFile))) {
    const prefixed = path.join('tests', testFile);
    if (fs.existsSync(path.resolve(cwd, prefixed))) testFile = prefixed;
  }
  if (!testFile) return `BASE_URL=${baseUrl} npm run qa:all`;
  return `BASE_URL=${baseUrl} npx playwright test ${testFile} --grep "${grepTitle}" --workers=1`;
}

function loadAllTests() {
  const sources = loadReportSources();
  const tests = [];
  for (const source of sources) {
    for (const suite of source.data && Array.isArray(source.data.suites)
      ? source.data.suites
      : []) {
      collectTestsFromSuite(suite, source.phase, tests);
    }
  }
  return tests;
}

function gatherAttachmentScreenshotPaths(tests) {
  const set = new Set();
  for (const test of tests) {
    for (const attachment of test.attachments || []) {
      if (!isImageAttachment(attachment)) continue;
      if (!attachment.path) continue;
      const abs = resolveAttachmentPath(attachment.path, test.phase);
      if (abs && fs.existsSync(abs)) set.add(abs);
    }
  }
  return set;
}

function gatherProjectScreenshotPaths() {
  const set = new Set();
  const roots = [autotestReportDir, reportDir, projectPaths.analyzeDir, projectPaths.artifactsDir];

  for (const root of roots) {
    for (const filePath of walkImages(root)) {
      if (isSubPath(filePath, screenshotsRoot)) continue;
      if (isSubPath(filePath, bugsRoot)) continue;
      set.add(filePath);
    }
  }

  return set;
}

function dedupeEvidence(items) {
  const map = new Map();
  for (const item of items) {
    if (!item) continue;
    const key = item.sourcePath || item.copiedPath || item.relPath;
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

async function main() {
  const tests = loadAllTests();
  const playerCredentials = loadPlayerCredentials();
  const reportPlayerCredentials = visiblePlayerCredentials(playerCredentials);
  const failedTests = tests.filter((test) => failureStatuses.has(test.status));
  const bugCandidateTests = tests.filter(
    (test) =>
      failureStatuses.has(test.status) ||
      (test.annotations || []).some((annotation) =>
        ['product-blocked', 'product-warning'].includes(
          String((annotation && annotation.type) || '').toLowerCase()
        )
      )
  );

  cleanDir(screenshotsAllDir);
  cleanDir(screenshotsFailDir);
  cleanDir(bugsRoot);

  const allScreenshotSources = new Set([
    ...gatherProjectScreenshotPaths(),
    ...gatherAttachmentScreenshotPaths(tests),
  ]);

  const groupedScreenshots = [];
  for (const source of Array.from(allScreenshotSources).sort((a, b) => a.localeCompare(b))) {
    const target = groupedAllDestination(source);
    const copied = copyFileSafe(source, target);
    if (!copied) continue;
    groupedScreenshots.push({
      source,
      grouped: copied,
      groupedRelative: asRelative(copied, screenshotsRoot),
    });
  }

  const bugEntries = [];
  const pdfJobs = [];

  {
    let bugIndex = 0;
    for (const sourceTest of bugCandidateTests) {
      const isProductBlocked = (sourceTest.annotations || []).some(
        (annotation) =>
          String((annotation && annotation.type) || '').toLowerCase() === 'product-blocked'
      );
      const isProductWarning = (sourceTest.annotations || []).some(
        (annotation) =>
          String((annotation && annotation.type) || '').toLowerCase() === 'product-warning'
      );
      const test =
        isProductBlocked && !failureStatuses.has(sourceTest.status)
          ? { ...sourceTest, status: 'product-blocked' }
          : isProductWarning && !failureStatuses.has(sourceTest.status)
            ? { ...sourceTest, status: 'product-warning' }
            : sourceTest;
      bugIndex += 1;
      const executionMode = inferExecutionMode(test);
      const bugId = `${String(bugIndex).padStart(3, '0')}-${slugify(
        `${executionMode}-${test.phase}-${test.titlePath || test.title}`
      )}`;
      const bugDir = path.join(bugsRoot, bugId);
      const evidenceDir = path.join(bugDir, 'evidence');
      const failDir = path.join(screenshotsFailDir, bugId);
      ensureDir(evidenceDir);
      ensureDir(failDir);

      const copiedScreenshots = [];
      const copiedAttachments = [];

      for (const attachment of test.attachments || []) {
        const attachmentName = sanitizeFileName(attachment.name || 'attachment');
        if (attachment.path) {
          const sourcePath = resolveAttachmentPath(attachment.path, test.phase);
          if (sourcePath && fs.existsSync(sourcePath)) {
            const attachmentBaseName = path.basename(attachmentName, path.extname(attachmentName));
            const sourceExt =
              path.extname(sourcePath) || extensionFromContentType(attachment.contentType);
            const copiedToEvidence = copyFileSafe(
              sourcePath,
              path.join(evidenceDir, `${attachmentBaseName}${sourceExt}`)
            );

            if (copiedToEvidence) {
              copiedAttachments.push({
                name: attachment.name || path.basename(copiedToEvidence),
                contentType: attachment.contentType || '',
                sourcePath,
                copiedPath: copiedToEvidence,
                relPath: asRelative(copiedToEvidence, bugDir),
              });
            }

            if (isImageAttachment(attachment)) {
              const copiedToFail = copyFileSafe(
                sourcePath,
                path.join(failDir, path.basename(sourcePath))
              );
              const copiedToBugScreens = copyFileSafe(
                sourcePath,
                path.join(bugDir, 'screenshots', path.basename(sourcePath))
              );
              if (copiedToFail) {
                copiedScreenshots.push({
                  sourcePath,
                  failPath: copiedToFail,
                  bugPath: copiedToBugScreens || '',
                });
              }
              if (copiedToBugScreens) {
                copiedAttachments.push({
                  name: 'screenshot',
                  contentType: attachment.contentType || 'image/png',
                  sourcePath,
                  copiedPath: copiedToBugScreens,
                  relPath: asRelative(copiedToBugScreens, bugDir),
                });
              }
            }
          }
        } else if (attachment.body) {
          const bodyPath = writeBodyAttachment(
            attachment.body,
            attachment.contentType,
            path.join(
              evidenceDir,
              path.basename(attachmentName || 'attachment', path.extname(attachmentName || ''))
            )
          );
          if (bodyPath) {
            copiedAttachments.push({
              name: attachment.name || path.basename(bodyPath),
              contentType: attachment.contentType || '',
              sourcePath: '',
              copiedPath: bodyPath,
              relPath: asRelative(bodyPath, bugDir),
            });
            if (isImageAttachment(attachment)) {
              const copiedToFail = copyFileSafe(
                bodyPath,
                path.join(failDir, path.basename(bodyPath))
              );
              const copiedToBugScreens = copyFileSafe(
                bodyPath,
                path.join(bugDir, 'screenshots', path.basename(bodyPath))
              );
              if (copiedToFail) {
                copiedScreenshots.push({
                  sourcePath: bodyPath,
                  failPath: copiedToFail,
                  bugPath: copiedToBugScreens || '',
                });
              }
              if (copiedToBugScreens) {
                copiedAttachments.push({
                  name: 'screenshot',
                  contentType: attachment.contentType || 'image/png',
                  sourcePath: bodyPath,
                  copiedPath: copiedToBugScreens,
                  relPath: asRelative(copiedToBugScreens, bugDir),
                });
              }
            }
          }
        }
      }

      if (copiedScreenshots.length === 0) {
        fs.writeFileSync(
          path.join(failDir, 'NO_SCREENSHOT.txt'),
          'Failure screenshot was not found in available artifacts for this test.',
          'utf8'
        );
      }

      const annotationsText = test.annotations
        .filter((item) => oneLine(item && item.description))
        .map((item) => `${item.type}: ${item.description}`)
        .filter(Boolean)
        .join('\n');
      const stdoutText = formatOutput(test.stdout);
      const stderrText = formatOutput(test.stderr);
      const actualResult = conciseActualResult(test);

      const network = { items: [], keys: new Set() };
      for (const url of extractUrls(test.error)) {
        pushNetworkCandidate(network, {
          url,
          source: 'error-message',
        });
      }
      for (const annotation of test.annotations) {
        for (const url of extractUrls(annotation.description)) {
          pushNetworkCandidate(network, {
            url,
            source: `annotation:${annotation.type}`,
          });
        }
      }
      for (const attachment of copiedAttachments) {
        if (!/\.json$/i.test(attachment.copiedPath)) continue;
        const payload = readJson(attachment.copiedPath);
        if (!payload) continue;
        collectNetworkFromJson(payload, network, `attachment:${attachment.name}`);
      }
      const networkCandidates = network.items.slice(0, 60);
      const primaryNetwork = pickPrimaryNetwork(networkCandidates);

      const screenshotRelPath =
        copiedScreenshots.length > 0
          ? asRelative(copiedScreenshots[0].bugPath || copiedScreenshots[0].failPath, bugDir)
          : '';

      const commandHint = safeCommandHint(test);
      const manualPlan = buildManualReproPlan({
        test,
        commandHint,
        primaryNetwork,
      });
      const generatedAt = new Date().toISOString();
      const triage = inferTriage({ test, manualPlan, actualResult });
      const evidence = dedupeEvidence(copiedAttachments);
      const markdown = buildBugMarkdown({
        bugId,
        test,
        commandHint,
        manualPlan,
        triage,
        generatedAt,
        playerCredentials: reportPlayerCredentials,
        actualResult,
        primaryNetwork,
        networkCandidates,
        screenshotRelPath,
        copiedAttachments: evidence,
        stdoutText,
        stderrText,
      });
      const html = buildBugHtml({
        bugId,
        test,
        commandHint,
        manualPlan,
        triage,
        generatedAt,
        playerCredentials: reportPlayerCredentials,
        actualResult,
        primaryNetwork,
        networkCandidates,
        screenshotRelPath,
        copiedAttachments: evidence,
        stdoutText,
        stderrText,
      });

      const markdownPath = path.join(bugDir, 'bug.md');
      const htmlPath = path.join(bugDir, 'bug.html');
      const pdfPath = path.join(bugDir, 'bug.pdf');
      const metadataPath = path.join(bugDir, 'bug.json');
      const networkPath = path.join(bugDir, 'network-evidence.json');
      const logsPath = path.join(bugDir, 'logs.txt');

      fs.writeFileSync(
        markdownPath,
        restoreVisiblePlayerCredentials(redactText(markdown), playerCredentials),
        'utf8'
      );
      fs.writeFileSync(
        htmlPath,
        restoreVisiblePlayerCredentials(redactText(html), playerCredentials, { html: true }),
        'utf8'
      );
      fs.writeFileSync(
        networkPath,
        JSON.stringify(
          redactObject({ primary: primaryNetwork, records: networkCandidates }),
          null,
          2
        ),
        'utf8'
      );
      fs.writeFileSync(
        logsPath,
        redactText(
          [
            `Error: ${test.error || '-'}`,
            '',
            'Annotations:',
            annotationsText || '-',
            '',
            'stdout:',
            stdoutText || '-',
            '',
            'stderr:',
            stderrText || '-',
          ].join('\n')
        ),
        'utf8'
      );

      const metadata = {
        bugId,
        phase: test.phase,
        file: test.file,
        projectName: test.projectName || '',
        executionMode: manualPlan.executionMode || inferExecutionMode(test),
        title: test.title,
        titlePath: test.titlePath,
        status: test.status,
        error: test.error || '',
        annotations: test.annotations,
        commandHint,
        issueTitle: triage.issueTitle,
        triage,
        generatedAt,
        playerCredentials: reportPlayerCredentials,
        manualReproduction: { ...manualPlan, actualResult },
        screenshotCount: copiedScreenshots.length,
        attachments: evidence.map((item) => ({
          name: item.name,
          contentType: item.contentType,
          relPath: item.relPath,
          sourcePath: item.sourcePath || '',
        })),
        primaryNetwork,
      };
      const safeMetadata = redactObject(metadata);
      safeMetadata.playerCredentials = {
        email: playerCredentials.email || '',
        password:
          process.env.QA_REPORT_INCLUDE_PLAYER_PASSWORD === '1'
            ? playerCredentials.password || ''
            : 'Скрыт (доступен только в приватном отчёте)',
        source: playerCredentials.source || '',
        validationStatus: playerCredentials.validationStatus || '',
        available: reportPlayerCredentials.available,
      };
      fs.writeFileSync(metadataPath, JSON.stringify(safeMetadata, null, 2), 'utf8');

      pdfJobs.push({ htmlPath, pdfPath });

      bugEntries.push({
        bugId,
        phase: test.phase,
        status: test.status,
        projectName: test.projectName || '',
        executionMode: manualPlan.executionMode || inferExecutionMode(test),
        title: triage.issueTitle,
        sourceTestTitle: test.titlePath || test.title,
        file: test.file || '-',
        folder: bugDir,
        pdfPath,
        markdownPath,
        htmlPath,
        screenshotCount: copiedScreenshots.length,
        primaryNetwork,
        triage,
      });
    }
  }

  if (pdfJobs.length > 0) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      for (const job of pdfJobs) {
        await exportPdfFromHtml(page, job.htmlPath, job.pdfPath);
      }
    } finally {
      await page.close().catch(() => null);
      await browser.close().catch(() => null);
    }
  }

  const screenshotManifestPath = path.join(screenshotsRoot, 'manifest.json');
  fs.writeFileSync(
    screenshotManifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalGrouped: groupedScreenshots.length,
        grouped: groupedScreenshots.map((item) => ({
          source: item.source,
          groupedRelative: item.groupedRelative,
        })),
      },
      null,
      2
    ),
    'utf8'
  );

  const bugsIndexPath = path.join(bugsRoot, 'index.json');
  fs.writeFileSync(
    bugsIndexPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalBugs: bugEntries.length,
        bugs: bugEntries.map((entry) => ({
          bugId: entry.bugId,
          phase: entry.phase,
          status: entry.status,
          projectName: entry.projectName || '',
          executionMode: entry.executionMode || '',
          title: entry.title,
          file: entry.file,
          folder: entry.folder,
          pdfPath: entry.pdfPath,
          screenshotCount: entry.screenshotCount,
          primaryNetwork: entry.primaryNetwork || null,
          triage: entry.triage || null,
        })),
      },
      null,
      2
    ),
    'utf8'
  );

  const bugsIndexMd = [
    '# Bugs Index',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Total bugs: ${bugEntries.length}`,
    '',
    '| Bug ID | Заголовок | Severity | Priority | Подтверждение | Phase | Mode | PDF | Screenshots |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...bugEntries.map(
      (entry) =>
        `| ${entry.bugId} | ${entry.title.replace(
          /\|/g,
          '\\|'
        )} | ${entry.triage?.severity || '-'} | ${entry.triage?.priority || '-'} | ${
          entry.triage?.confirmation || '-'
        } | ${entry.phase} | ${entry.executionMode || '-'} | ${asRelative(
          entry.pdfPath,
          bugsRoot
        )} | ${entry.screenshotCount} |`
    ),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(bugsRoot, 'index.md'), bugsIndexMd, 'utf8');

  const screenshotsReadme = [
    '# Screenshots Hub',
    '',
    '- `All/`: all discovered screenshots grouped in one place.',
    '- `Fail/`: screenshots only for tests in failed/timedOut/interrupted status.',
    '',
    `Total grouped screenshots: ${groupedScreenshots.length}`,
    `Total failure tests: ${failedTests.length}`,
    '',
    'Manifest: `manifest.json`',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(screenshotsRoot, 'README.md'), screenshotsReadme, 'utf8');

  console.log(`Screenshots grouped: ${groupedScreenshots.length}`);
  console.log(`Failure screenshots folders: ${failedTests.length}`);
  console.log(`Bug dossiers generated: ${bugEntries.length}`);
  console.log(`Screenshots hub: ${screenshotsRoot}`);
  console.log(`Bugs folder: ${bugsRoot}`);
}

main().catch((error) => {
  console.error(`qa-artifacts failed: ${error && error.message ? error.message : error}`);
  process.exit(1);
});
