const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { loadProjectEnv } = require('./lib/env');

loadProjectEnv();

const BRAND_CATALOG = {
  gt: { key: 'gt', slug: 'gt.bet', baseUrl: 'https://gt.bet' },
  likes: { key: 'likes', slug: 'likes.bet', baseUrl: 'https://likes.bet' },
  booms: { key: 'booms', slug: 'booms.bet', baseUrl: 'https://booms.bet' },
  nix: { key: 'nix', slug: 'nix.bet', baseUrl: 'https://nix.bet' },
  starzino: { key: 'starzino', slug: 'starzino.com', baseUrl: 'https://starzino.com' },
  igo: { key: 'igo', slug: 'igo.bet', baseUrl: 'https://igo.bet' },
  chacha: { key: 'chacha', slug: 'chacha.bet', baseUrl: 'https://chacha.bet' },
  casho: { key: 'casho', slug: 'casho.bet', baseUrl: 'https://casho.bet' },
};

const DEFAULT_ORDER = ['gt', 'likes', 'booms', 'nix', 'starzino', 'igo', 'chacha', 'casho'];
const HIGH_CLOUDFLARE_BRANDS = new Set(DEFAULT_ORDER);
const DESKTOP_SOFT_PRECHECK_BRANDS = new Set([
  'gt',
  'booms',
  'casho',
  'likes',
  'chacha',
  'igo',
  'nix',
]);
const FORCE_PRE_RUN_SESSION_BRANDS = new Set(['booms', 'casho', 'chacha', 'igo']);
const REUSE_EXISTING_SESSION_BRANDS = new Set(['likes']);
// Every local brand run uses the same native Chrome/CDP strategy. Keeping these
// sets derived from DEFAULT_ORDER prevents a newly added brand from silently
// falling back to short-lived Playwright contexts or bundled Chromium.
const REAL_CHROME_CHANNEL_BRANDS = new Set(DEFAULT_ORDER);
const DEFAULT_CDP_REUSE_BRANDS = new Set(DEFAULT_ORDER);
const VALID_MODES = new Set(['desktop', 'mobile']);
const VALID_RUN_PROFILES = new Set(['full', 'core', 'providers']);

function getBrandSessionDefaults(brand, mode) {
  const isSingleRouteWarmupBrand =
    brand && ['gt', 'booms', 'casho', 'chacha', 'igo', 'nix'].includes(brand.key);
  if (!isSingleRouteWarmupBrand) {
    return {
      warmupRoutes: '/,/casino/',
      saveStateTimeout: '120',
      saveStateWarmupTimeout: mode === 'mobile' ? '90' : '75',
      challengeReruns: '0',
      suiteRefreshMax: '0',
      suiteRefreshCooldownMs: '120000',
    };
  }

  return {
    warmupRoutes: '/',
    saveStateTimeout: mode === 'mobile' ? '300' : '240',
    saveStateWarmupTimeout: mode === 'mobile' ? '120' : '90',
    challengeReruns: '1',
    suiteRefreshMax: '4',
    suiteRefreshCooldownMs: '30000',
  };
}

function parseArgs(argv) {
  const args = {};
  for (const token of argv.slice(2)) {
    if (!token.startsWith('--')) continue;
    const trimmed = token.slice(2);
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      args[trimmed] = '1';
      continue;
    }
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    args[key] = value;
  }
  return args;
}

function normalizeMode(rawMode) {
  const mode = String(rawMode || '')
    .trim()
    .toLowerCase();
  if (!mode) return 'desktop';
  if (!VALID_MODES.has(mode)) return '';
  return mode;
}

function normalizeRunProfile(rawProfile) {
  const profile = String(rawProfile || '')
    .trim()
    .toLowerCase();
  if (!profile) return 'full';
  if (!VALID_RUN_PROFILES.has(profile)) return '';
  return profile;
}

function resolveBrandKeys(rawBrand) {
  const input = String(rawBrand || 'all')
    .trim()
    .toLowerCase();
  if (!input || input === 'all') return DEFAULT_ORDER.slice();

  const tokens = input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (tokens.length === 0) return DEFAULT_ORDER.slice();

  const resolved = [];
  for (const token of tokens) {
    if (!BRAND_CATALOG[token]) return { ok: false, unknown: token, keys: [] };
    if (!resolved.includes(token)) resolved.push(token);
  }
  return { ok: true, keys: resolved };
}

function modePaths(cwd, brand, mode) {
  const sharedRoot = path.join(cwd, 'projects', brand.slug);
  const modeRoot = path.join(sharedRoot, mode);
  const sharedAutotestReportDir = path.join(sharedRoot, 'Autotest report');
  return {
    sharedRoot,
    modeRoot,
    storageState: path.join(sharedRoot, 'storageState.json'),
    testResultsDir: path.join(modeRoot, 'test-results'),
    artifactsDir: path.join(modeRoot, 'artifacts'),
    legacyAutotestReportDir: path.join(modeRoot, 'Autotest report'),
    sharedAutotestReportDir,
    autotestReportDir: path.join(sharedAutotestReportDir, mode),
    analyzeDir: path.join(modeRoot, 'analyze'),
  };
}

function readCdpMetaUserAgent(storageStatePath, mode) {
  if (!storageStatePath) return '';
  try {
    const metaPath = `${path.resolve(storageStatePath)}.cdp-meta.json`;
    if (!fs.existsSync(metaPath)) return '';
    const payload = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const userAgent = String((payload && payload.userAgent) || '').trim();
    if (!userAgent) return '';

    const looksMobile = /mobile|iphone|ipad|android/i.test(userAgent);
    if (mode === 'mobile') return looksMobile ? userAgent : '';
    if (mode === 'desktop') return looksMobile ? '' : userAgent;
    return '';
  } catch {
    return '';
  }
}

function hasFreshStorageState(storageStatePath) {
  try {
    if (!storageStatePath || !fs.existsSync(storageStatePath)) return false;
    const stat = fs.statSync(storageStatePath);
    const maxAgeSec = Number.parseInt(process.env.PW_AUTH_STATE_MAX_AGE_SEC || '14400', 10);
    const ageSec = Math.max(0, Math.floor((Date.now() - Number(stat.mtimeMs || 0)) / 1000));
    if (Number.isFinite(maxAgeSec) && maxAgeSec > 0 && ageSec > maxAgeSec) return false;

    const payload = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
    const cookies = Array.isArray(payload && payload.cookies) ? payload.cookies : [];
    const origins = Array.isArray(payload && payload.origins) ? payload.origins : [];
    return cookies.length > 0 || origins.length > 0;
  } catch {
    return false;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureModeWorkspace(paths) {
  if (!paths) return;
  ensureDir(paths.sharedRoot);
  ensureDir(paths.modeRoot);
  ensureDir(paths.testResultsDir);
  ensureDir(paths.artifactsDir);
  ensureDir(paths.analyzeDir);
  ensureDir(paths.sharedAutotestReportDir);
  ensureDir(paths.autotestReportDir);
}

function migrateLegacyModeReports(paths) {
  const legacyDir = paths.legacyAutotestReportDir;
  const modeDir = paths.autotestReportDir;
  if (!legacyDir || !modeDir) return;
  if (!fs.existsSync(legacyDir)) return;

  ensureDir(modeDir);
  try {
    fs.cpSync(legacyDir, modeDir, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
  } catch {
    // best-effort migration from legacy mode folder
  }
}

function reportExists(filePath) {
  try {
    return Boolean(filePath && fs.existsSync(filePath));
  } catch {
    return false;
  }
}

function readJsonSafe(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readLatestRunStatus(paths) {
  const runsDir = path.join(paths.artifactsDir, 'history', 'runs');
  try {
    if (!fs.existsSync(runsDir)) return '';
    const latest = fs
      .readdirSync(runsDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.join(runsDir, name))
      .map((filePath) => {
        const stat = fs.statSync(filePath);
        return { filePath, mtimeMs: Number(stat.mtimeMs || 0) };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    const payload = latest ? readJsonSafe(latest.filePath) : null;
    return String((payload && payload.runStatus) || '').trim();
  } catch {
    return '';
  }
}

function updateSharedReportsIndex({ brand, paths }) {
  const reportRoot = paths.sharedAutotestReportDir;
  if (!reportRoot) return;

  ensureDir(reportRoot);
  const modes = ['desktop', 'mobile'];
  const rows = [
    '# Autotest Reports Hub',
    '',
    `Brand: ${brand.slug}`,
    `Updated: ${new Date().toISOString()}`,
    '',
    '| Mode | Report MD | Report HTML | Report PDF | Bugs Index | Screenshots |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const mode of modes) {
    const modeDir = path.join(reportRoot, mode);
    const baseName = brand.slug;
    const mdPath = path.join(modeDir, `${baseName}.md`);
    const htmlPath = path.join(modeDir, `${baseName}.html`);
    const pdfPath = path.join(modeDir, `${baseName}.pdf`);
    const bugsIndexPath = path.join(modeDir, 'Bugs', 'index.md');
    const screenshotsPath = path.join(modeDir, 'Screenshots');
    const legacyMdPath = path.join(reportRoot, `${baseName}.md`);
    const legacyHtmlPath = path.join(reportRoot, `${baseName}.html`);
    const legacyPdfPath = path.join(reportRoot, `${baseName}.pdf`);
    const legacyBugsIndexPath = path.join(reportRoot, 'Bugs', 'index.md');
    const legacyScreenshotsPath = path.join(reportRoot, 'Screenshots');
    const allowLegacyFallback = mode === 'desktop';

    const mdLink = reportExists(mdPath)
      ? `[${baseName}.md](./${mode}/${baseName}.md)`
      : allowLegacyFallback && reportExists(legacyMdPath)
        ? `[${baseName}.md](./${baseName}.md)`
        : '-';
    const htmlLink = reportExists(htmlPath)
      ? `[${baseName}.html](./${mode}/${baseName}.html)`
      : allowLegacyFallback && reportExists(legacyHtmlPath)
        ? `[${baseName}.html](./${baseName}.html)`
        : '-';
    const pdfLink = reportExists(pdfPath)
      ? `[${baseName}.pdf](./${mode}/${baseName}.pdf)`
      : allowLegacyFallback && reportExists(legacyPdfPath)
        ? `[${baseName}.pdf](./${baseName}.pdf)`
        : '-';
    const bugsLink = reportExists(bugsIndexPath)
      ? `[index.md](./${mode}/Bugs/index.md)`
      : allowLegacyFallback && reportExists(legacyBugsIndexPath)
        ? `[index.md](./Bugs/index.md)`
        : '-';
    const screenshotsLink = reportExists(screenshotsPath)
      ? `[Screenshots](./${mode}/Screenshots/)`
      : allowLegacyFallback && reportExists(legacyScreenshotsPath)
        ? `[Screenshots](./Screenshots/)`
        : '-';

    rows.push(
      `| ${mode} | ${mdLink} | ${htmlLink} | ${pdfLink} | ${bugsLink} | ${screenshotsLink} |`
    );
  }

  rows.push('');
  rows.push('Notes:');
  rows.push('- All desktop/mobile reports are stored in this single brand-level folder.');
  rows.push('- Legacy mode folders remain untouched for backward compatibility.');
  rows.push('');

  const indexPath = path.join(reportRoot, 'index.md');
  fs.writeFileSync(indexPath, rows.join('\n'), 'utf8');
}

function buildRunEnv({ brand, mode, cwd, runProfile }) {
  const paths = modePaths(cwd, brand, mode);
  const isHighCloudflareBrand = HIGH_CLOUDFLARE_BRANDS.has(brand.key);
  const cdpMetaUserAgent = readCdpMetaUserAgent(paths.storageState, mode);
  const hasCdpStateForMode = Boolean(cdpMetaUserAgent);
  const hasFreshPrimaryState = hasFreshStorageState(paths.storageState);
  const reuseCdpSession = brand.key === 'casho' && hasCdpStateForMode;
  const reuseExistingSession = reuseCdpSession || REUSE_EXISTING_SESSION_BRANDS.has(brand.key);
  const forcePreRunSession =
    FORCE_PRE_RUN_SESSION_BRANDS.has(brand.key) && !hasCdpStateForMode && !hasFreshPrimaryState;
  const sessionDefaults = getBrandSessionDefaults(brand, mode);
  const explicitCdpReuse = String(process.env.PW_CDP_REUSE_CONTEXT || '').trim();
  const useCdpReuse = explicitCdpReuse
    ? explicitCdpReuse === '1'
    : !process.env.CI && DEFAULT_CDP_REUSE_BRANDS.has(brand.key);
  // Keep desktop and mobile CDP fingerprints isolated. Reusing the desktop
  // profile for a mobile viewport made provider launch requests advertise
  // device=DESKTOP and also coupled both modes to the same Cloudflare session.
  const cdpProfileMode = mode;
  const env = {
    ...process.env,
    BASE_URL: brand.baseUrl,
    PW_PROJECT_MATRIX: mode,
    PW_PRECHECK_PROJECT_MATRIX: mode,
    PW_PROVIDER_PROFILE: process.env.PW_PROVIDER_PROFILE || 'extended',
    PW_RUN_PROFILE: runProfile || process.env.PW_RUN_PROFILE || 'full',
    QA_EXECUTION_MODE: mode,
    QA_PROJECT_ROOT: paths.modeRoot,
    QA_PROJECT_SLUG: `${brand.slug}-${mode}`,
    QA_TEST_RESULTS_DIR: paths.testResultsDir,
    QA_ARTIFACTS_DIR: paths.artifactsDir,
    QA_AUTOTEST_REPORT_DIR: paths.autotestReportDir,
    QA_ANALYZE_DIR: paths.analyzeDir,
    PW_STORAGE_STATE: paths.storageState,
    PW_CDP_REUSE_CONTEXT: useCdpReuse ? '1' : '0',
    PW_CDP_PROFILE_DIR:
      process.env.PW_CDP_PROFILE_DIR || path.join(paths.sharedRoot, '.pw-profile', cdpProfileMode),
    PW_CDP_WINDOW_SIZE:
      process.env.PW_CDP_WINDOW_SIZE || (mode === 'mobile' ? '390,844' : '1365,900'),
    PW_CDP_READY_TIMEOUT_MS: process.env.PW_CDP_READY_TIMEOUT_MS || '30000',
    PW_CDP_CONNECT_TIMEOUT_MS: process.env.PW_CDP_CONNECT_TIMEOUT_MS || '60000',
    PW_CDP_PRESERVE_USER_AGENT: process.env.PW_CDP_PRESERVE_USER_AGENT || '1',
    PW_AUTO_SAVE_STATE: process.env.PW_AUTO_SAVE_STATE || (reuseExistingSession ? '0' : '1'),
    PW_USE_CHROME_CHANNEL:
      process.env.PW_USE_CHROME_CHANNEL || (REAL_CHROME_CHANNEL_BRANDS.has(brand.key) ? '1' : '0'),
    PW_FORCE_SAVE_STATE_BEFORE_RUN:
      process.env.PW_FORCE_SAVE_STATE_BEFORE_RUN || (forcePreRunSession ? '1' : '0'),
    PW_REQUIRE_HEADED_LOGIN_BEFORE_RUN: process.env.PW_REQUIRE_HEADED_LOGIN_BEFORE_RUN || '0',
    PW_SAVE_STATE_WARMUP_ROUTES:
      process.env.PW_SAVE_STATE_WARMUP_ROUTES || sessionDefaults.warmupRoutes,
    PW_SAVE_STATE_WARMUP_STRICT: process.env.PW_SAVE_STATE_WARMUP_STRICT || '0',
    PW_SAVE_STATE_TIMEOUT: process.env.PW_SAVE_STATE_TIMEOUT || sessionDefaults.saveStateTimeout,
    PW_SAVE_STATE_PERSISTENT: process.env.PW_SAVE_STATE_PERSISTENT || (!process.env.CI ? '1' : '0'),
    PW_SAVE_STATE_PROFILE_DIR:
      process.env.PW_SAVE_STATE_PROFILE_DIR || path.join(paths.sharedRoot, '.pw-profile', mode),
    PW_CHALLENGE_RERUNS:
      process.env.PW_CHALLENGE_RERUNS || (reuseCdpSession ? '0' : sessionDefaults.challengeReruns),
    PW_CHALLENGE_RERUN_BACKOFF_MS: process.env.PW_CHALLENGE_RERUN_BACKOFF_MS || '2500',
    PW_VALID_RUN_STRICT: process.env.PW_VALID_RUN_STRICT || (process.env.CI ? '1' : '0'),
    PW_ABORT_ON_WAF_GUARD: process.env.PW_ABORT_ON_WAF_GUARD || '0',
    PW_KPI_WAF_GRACE: process.env.PW_KPI_WAF_GRACE || '0',
    PW_KPI_MAX_BLOCKED_RATIO: process.env.PW_KPI_MAX_BLOCKED_RATIO || '0.30',
    PW_KPI_MAX_INFRA_BLOCKED_RATIO: process.env.PW_KPI_MAX_INFRA_BLOCKED_RATIO || '0.15',
    PW_KPI_REQUIRE_CLEAN_PRECHECK: process.env.PW_KPI_REQUIRE_CLEAN_PRECHECK || '1',
    PW_KPI_REQUIRE_DEPOSIT_COVERAGE: process.env.PW_KPI_REQUIRE_DEPOSIT_COVERAGE || '1',
    PW_KPI_REQUIRE_PROVIDER_COVERAGE: process.env.PW_KPI_REQUIRE_PROVIDER_COVERAGE || '1',
    PW_PRECHECK_SOFT_BLOCK: process.env.PW_PRECHECK_SOFT_BLOCK || '0',
    PW_PRECHECK_STRICT_403: process.env.PW_PRECHECK_STRICT_403 || '1',
    PW_INFRA_BLOCK_AS_PASS: process.env.PW_INFRA_BLOCK_AS_PASS || '0',
    // A challenge from one provider is not evidence that every subsequent
    // provider is blocked. Keep executing the matrix unless explicitly opted in.
    PW_PROVIDER_FAST_FAIL_ON_UI_BLOCKED: process.env.PW_PROVIDER_FAST_FAIL_ON_UI_BLOCKED || '0',
    // Prefer a real password login. Token fallback is allowed only after the
    // token has been proven to establish an authorized session for this brand.
    PW_LOGIN_PREFER_TOKEN_FALLBACK: process.env.PW_LOGIN_PREFER_TOKEN_FALLBACK || '0',
    PW_LOGIN_ALLOW_SHARED_PLAYER: process.env.PW_LOGIN_ALLOW_SHARED_PLAYER || '0',
    // GT currently issues a valid Turnstile token through the real multi-step
    // form, while an API-first request is rejected with 403. Use the same UI
    // path a player uses instead of spending the registration budget on a
    // synthetic request that cannot pass the brand WAF policy.
    PW_SIGNUP_PREFER_API: process.env.PW_SIGNUP_PREFER_API || (brand.key === 'gt' ? '0' : '1'),
    // booms.bet can reject a plain API/UI request with HTTP 403 even when the
    // regular browser session is healthy. Allow the native Chrome CDP fallback
    // to obtain and submit the real Turnstile token before classifying signup
    // as infrastructure-blocked.
    PW_SIGNUP_CDP_FALLBACK:
      process.env.PW_SIGNUP_CDP_FALLBACK || (brand.key === 'booms' ? '1' : '0'),
    PW_SIGNUP_UI_TIMEOUT_MS: process.env.PW_SIGNUP_UI_TIMEOUT_MS || '150000',
    PW_USER_AGENT: process.env.PW_USER_AGENT || cdpMetaUserAgent || '',
    PW_MOBILE_STABILIZE_RERUN: process.env.PW_MOBILE_STABILIZE_RERUN || '0',
    PW_SUITE_REFRESH_MAX:
      process.env.PW_SUITE_REFRESH_MAX ||
      (reuseExistingSession ? '0' : sessionDefaults.suiteRefreshMax),
    PW_SUITE_REFRESH_COOLDOWN_MS:
      process.env.PW_SUITE_REFRESH_COOLDOWN_MS || sessionDefaults.suiteRefreshCooldownMs,
    PW_PROVIDER_REQUIRE_HISTORY_MATCH: process.env.PW_PROVIDER_REQUIRE_HISTORY_MATCH || '0',
    // Retry only providers that hard-fail. This distinguishes a transient
    // launch race from a reproducible product defect without repeating passes.
    PW_PROVIDER_RETRY_ON_FAIL: process.env.PW_PROVIDER_RETRY_ON_FAIL || '1',
  };

  if (useCdpReuse) {
    env.PW_BROWSER = 'chromium';
    env.PW_AUTO_SAVE_STATE = '0';
    env.PW_FORCE_SAVE_STATE_BEFORE_RUN = '0';
    env.PW_SUITE_REFRESH_MAX = '0';
    env.PW_CHALLENGE_RERUNS = '0';
    env.PW_PROVIDER_DESKTOP_GAMES = process.env.PW_PROVIDER_DESKTOP_GAMES || '1';
    env.PW_PROVIDER_MIN_GAMES = process.env.PW_PROVIDER_MIN_GAMES || '1';
    env.PW_PROVIDER_DEMO_SCAN_MAX = process.env.PW_PROVIDER_DEMO_SCAN_MAX || '10';
    env.PW_PROVIDER_DEMO_SCAN_TIMEOUT = process.env.PW_PROVIDER_DEMO_SCAN_TIMEOUT || '120000';
  }

  if (brand.key === 'nix' || brand.key === 'igo') {
    // These brands start challenging the shared browser after a sustained burst of provider
    // launches. Pace the matrix in small batches so coverage does not collapse into
    // one suite-level WAF short-circuit near the middle of the inventory.
    env.PW_PROVIDER_INTER_TEST_DELAY_MS = process.env.PW_PROVIDER_INTER_TEST_DELAY_MS || '750';
    env.PW_PROVIDER_BATCH_SIZE = process.env.PW_PROVIDER_BATCH_SIZE || '10';
    env.PW_PROVIDER_BATCH_COOLDOWN_MS = process.env.PW_PROVIDER_BATCH_COOLDOWN_MS || '15000';
    env.PW_CHALLENGE_SETTLE_TIMEOUT = process.env.PW_CHALLENGE_SETTLE_TIMEOUT || '30000';
    env.PW_PROVIDER_CONTROLS_TIMEOUT_MS = process.env.PW_PROVIDER_CONTROLS_TIMEOUT_MS || '3500';
  }

  if (String(env.PW_RUN_PROFILE).toLowerCase() === 'providers') {
    env.PW_CASINO_PROVIDERS_ONLY = process.env.PW_CASINO_PROVIDERS_ONLY || '1';
  }

  // Strict desktop brand runs should fail fast on WAF precheck. Mobile high-WAF runs
  // keep the failing precheck as a diagnostic, but continue into downstream recovery.
  if (isHighCloudflareBrand && mode !== 'mobile' && !DESKTOP_SOFT_PRECHECK_BRANDS.has(brand.key)) {
    env.PW_PRECHECK_SOFT = process.env.PW_PRECHECK_SOFT || '0';
  }

  // A caller that explicitly opts a strict desktop brand into soft precheck expects
  // the precheck test itself and the clean-precheck KPI to use the same semantics.
  if (env.PW_PRECHECK_SOFT === '1') {
    env.PW_PRECHECK_SOFT_BLOCK = process.env.PW_PRECHECK_SOFT_BLOCK || '1';
    env.PW_KPI_REQUIRE_CLEAN_PRECHECK = process.env.PW_KPI_REQUIRE_CLEAN_PRECHECK || '0';
  }

  if (mode === 'mobile') {
    env.PW_PROVIDER_ONLY_MOBILE = '1';
    env.PW_PROVIDER_ENABLE_MOBILE = '1';
    env.PW_PROVIDER_DEMO_GAMES = process.env.PW_PROVIDER_DEMO_GAMES || '1';
    env.PW_PROVIDER_DEMO_MIN_GAMES = process.env.PW_PROVIDER_DEMO_MIN_GAMES || '1';
    env.PW_PROVIDER_DEMO_SCAN_MAX = process.env.PW_PROVIDER_DEMO_SCAN_MAX || '18';
    env.PW_PROVIDER_SCAN_LIMIT = process.env.PW_PROVIDER_SCAN_LIMIT || '22';
    env.PW_MOBILE_STABILIZE_RERUN = process.env.PW_MOBILE_STABILIZE_RERUN || '1';
    env.PW_SAVE_STATE_TIMEOUT =
      process.env.PW_SAVE_STATE_TIMEOUT || sessionDefaults.saveStateTimeout;
    env.PW_AUTO_BYPASS_CF_TIMEOUT_MS = process.env.PW_AUTO_BYPASS_CF_TIMEOUT_MS || '60000';

    // For high-Cloudflare brands mobile precheck often fails despite valid session cookies.
    // Continue after the failing precheck so qa-all can refresh casino routes and capture
    // provider/deposit diagnostics instead of stopping with a one-test report.
    if (isHighCloudflareBrand) {
      env.PW_PRECHECK_SOFT = process.env.PW_PRECHECK_SOFT || '1';
      env.PW_PRECHECK_SOFT_BLOCK = process.env.PW_PRECHECK_SOFT_BLOCK || '1';
      env.PW_KPI_REQUIRE_CLEAN_PRECHECK = process.env.PW_KPI_REQUIRE_CLEAN_PRECHECK || '0';
      env.PW_SAVE_STATE_TIMEOUT =
        process.env.PW_SAVE_STATE_TIMEOUT || sessionDefaults.saveStateTimeout;
      env.PW_SAVE_STATE_WARMUP_TIMEOUT =
        process.env.PW_SAVE_STATE_WARMUP_TIMEOUT || sessionDefaults.saveStateWarmupTimeout;
    }
  } else if (DESKTOP_SOFT_PRECHECK_BRANDS.has(brand.key)) {
    env.PW_PRECHECK_SOFT = process.env.PW_PRECHECK_SOFT || '1';
    env.PW_PRECHECK_SOFT_BLOCK = process.env.PW_PRECHECK_SOFT_BLOCK || '1';
    env.PW_KPI_REQUIRE_CLEAN_PRECHECK = process.env.PW_KPI_REQUIRE_CLEAN_PRECHECK || '0';
    env.PW_SAVE_STATE_WARMUP_TIMEOUT =
      process.env.PW_SAVE_STATE_WARMUP_TIMEOUT || sessionDefaults.saveStateWarmupTimeout;
    env.PW_SAVE_STATE_TIMEOUT =
      process.env.PW_SAVE_STATE_TIMEOUT || sessionDefaults.saveStateTimeout;
  } else if (isHighCloudflareBrand) {
    env.PW_SAVE_STATE_WARMUP_TIMEOUT = process.env.PW_SAVE_STATE_WARMUP_TIMEOUT || '75';
  } else {
    env.PW_PROVIDER_ONLY_MOBILE = '0';
  }

  return { env, paths };
}

function runQaAllForBrand({ brand, mode, cwd, dryRun = false, runProfile = 'full' }) {
  const startedAt = Date.now();
  const { env, paths } = buildRunEnv({ brand, mode, cwd, runProfile });
  ensureModeWorkspace(paths);
  migrateLegacyModeReports(paths);
  updateSharedReportsIndex({ brand, paths });

  if (dryRun) {
    console.log(`\n=== ${brand.slug} [${mode}] (dry-run) ===`);
    console.log(`BASE_URL=${brand.baseUrl}`);
    console.log(`Workspace: ${paths.modeRoot}`);
    console.log(`Reports Hub: ${paths.sharedAutotestReportDir}`);
    console.log(`Reports Mode Folder: ${paths.autotestReportDir}`);
    console.log(`PW_PROJECT_MATRIX=${env.PW_PROJECT_MATRIX}`);
    console.log(`PW_PRECHECK_PROJECT_MATRIX=${env.PW_PRECHECK_PROJECT_MATRIX}`);
    console.log(`PW_PRECHECK_SOFT=${env.PW_PRECHECK_SOFT || '0'}`);
    console.log(`PW_VALID_RUN_STRICT=${env.PW_VALID_RUN_STRICT || '0'}`);
    console.log(`PW_KPI_WAF_GRACE=${env.PW_KPI_WAF_GRACE || '0'}`);
    console.log(`PW_ABORT_ON_WAF_GUARD=${env.PW_ABORT_ON_WAF_GUARD || '0'}`);
    console.log(`PW_PROVIDER_ONLY_MOBILE=${env.PW_PROVIDER_ONLY_MOBILE || '0'}`);
    console.log(`PW_RUN_PROFILE=${env.PW_RUN_PROFILE || 'full'}`);
    console.log(`PW_CASINO_PROVIDERS_ONLY=${env.PW_CASINO_PROVIDERS_ONLY || '0'}`);
    console.log(`PW_AUTO_SAVE_STATE=${env.PW_AUTO_SAVE_STATE || '1'}`);
    console.log(`PW_USE_CHROME_CHANNEL=${env.PW_USE_CHROME_CHANNEL || '0'}`);
    console.log(`PW_CDP_REUSE_CONTEXT=${env.PW_CDP_REUSE_CONTEXT || '0'}`);
    console.log(`PW_CDP_PROFILE_DIR=${env.PW_CDP_PROFILE_DIR || '-'}`);
    console.log(`PW_CDP_CONNECT_TIMEOUT_MS=${env.PW_CDP_CONNECT_TIMEOUT_MS || '-'}`);
    console.log(`PW_SAVE_STATE_PERSISTENT=${env.PW_SAVE_STATE_PERSISTENT || '0'}`);
    console.log(`PW_SAVE_STATE_PROFILE_DIR=${env.PW_SAVE_STATE_PROFILE_DIR || '-'}`);
    console.log(`PW_FORCE_SAVE_STATE_BEFORE_RUN=${env.PW_FORCE_SAVE_STATE_BEFORE_RUN || '0'}`);
    console.log(`PW_SAVE_STATE_TIMEOUT=${env.PW_SAVE_STATE_TIMEOUT || '-'}`);
    console.log(`PW_SAVE_STATE_WARMUP_TIMEOUT=${env.PW_SAVE_STATE_WARMUP_TIMEOUT || '-'}`);
    console.log(`PW_SAVE_STATE_WARMUP_ROUTES=${env.PW_SAVE_STATE_WARMUP_ROUTES || '-'}`);
    console.log(`PW_CHALLENGE_RERUNS=${env.PW_CHALLENGE_RERUNS || '0'}`);
    console.log(`PW_SUITE_REFRESH_MAX=${env.PW_SUITE_REFRESH_MAX || '0'}`);
    console.log(`PW_SUITE_REFRESH_COOLDOWN_MS=${env.PW_SUITE_REFRESH_COOLDOWN_MS || '-'}`);
    console.log(`PW_PROVIDER_DEMO_SCAN_MAX=${env.PW_PROVIDER_DEMO_SCAN_MAX || '-'}`);
    console.log(`PW_PROVIDER_DEMO_SCAN_TIMEOUT=${env.PW_PROVIDER_DEMO_SCAN_TIMEOUT || '-'}`);
    console.log(`PW_PROVIDER_INTER_TEST_DELAY_MS=${env.PW_PROVIDER_INTER_TEST_DELAY_MS || '0'}`);
    console.log(`PW_PROVIDER_BATCH_SIZE=${env.PW_PROVIDER_BATCH_SIZE || '0'}`);
    console.log(`PW_PROVIDER_BATCH_COOLDOWN_MS=${env.PW_PROVIDER_BATCH_COOLDOWN_MS || '0'}`);
    console.log(`PW_PROVIDER_CONTROLS_TIMEOUT_MS=${env.PW_PROVIDER_CONTROLS_TIMEOUT_MS || '-'}`);
    console.log(`PW_USER_AGENT=${env.PW_USER_AGENT ? '<configured>' : '-'}`);
    console.log(
      `PW_REQUIRE_HEADED_LOGIN_BEFORE_RUN=${env.PW_REQUIRE_HEADED_LOGIN_BEFORE_RUN || '0'}`
    );
    console.log(
      env.PW_CDP_REUSE_CONTEXT === '1'
        ? '> node scripts/qa-cdp-run.js -- node scripts/qa-all.js'
        : '> node scripts/qa-all.js'
    );
    return Promise.resolve({
      brand: brand.slug,
      mode,
      code: 0,
      durationSec: 0,
      reportDir: paths.autotestReportDir,
    });
  }

  return new Promise((resolve) => {
    console.log(`\n=== ${brand.slug} [${mode}] ===`);
    console.log(`BASE_URL=${brand.baseUrl}`);
    console.log(`Workspace: ${paths.modeRoot}`);
    console.log(`Reports Hub: ${paths.sharedAutotestReportDir}`);
    console.log(`Reports Mode Folder: ${paths.autotestReportDir}`);
    console.log(`Run profile: ${env.PW_RUN_PROFILE || 'full'}`);
    const useCdpReuse = env.PW_CDP_REUSE_CONTEXT === '1';
    const commandArgs = useCdpReuse
      ? ['scripts/qa-cdp-run.js', '--', 'node', 'scripts/qa-all.js']
      : ['scripts/qa-all.js'];
    console.log(
      useCdpReuse
        ? '> node scripts/qa-cdp-run.js -- node scripts/qa-all.js'
        : '> node scripts/qa-all.js'
    );

    const child = spawn('node', commandArgs, {
      cwd,
      env,
      stdio: 'inherit',
    });

    let settled = false;
    const finish = (code, signal = null) => {
      if (settled) return;
      settled = true;
      const durationSec = Math.round((Date.now() - startedAt) / 1000);
      updateSharedReportsIndex({ brand, paths });
      const runStatus = readLatestRunStatus(paths);
      resolve({
        brand: brand.slug,
        mode,
        code: Number(code || (signal ? 1 : 0)),
        signal,
        runStatus,
        durationSec,
        reportDir: paths.autotestReportDir,
      });
    };
    child.on('error', () => finish(1));
    // `close` guarantees that the complete qa-all/CDP process tree released
    // its inherited streams before indexes and final status are read.
    child.on('close', finish);
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const mode = normalizeMode(args.mode);
  if (!mode) {
    console.error('Invalid --mode value. Allowed: desktop, mobile');
    process.exit(2);
  }

  const resolvedBrands = resolveBrandKeys(args.brand || 'all');
  if (!Array.isArray(resolvedBrands)) {
    if (!resolvedBrands.ok) {
      console.error(`Unknown --brand value: "${resolvedBrands.unknown}".`);
      console.error(`Allowed: ${Object.keys(BRAND_CATALOG).join(', ')}, all`);
      process.exit(2);
    }
  }

  const brandKeys = Array.isArray(resolvedBrands) ? resolvedBrands : resolvedBrands.keys;
  const cwd = process.cwd();
  const dryRun = args['dry-run'] === '1' || args['dry-run'] === 'true';
  const runProfile = normalizeRunProfile(args.profile || process.env.PW_RUN_PROFILE || 'full');
  if (!runProfile) {
    console.error('Invalid --profile value. Allowed: full, core, providers');
    process.exit(2);
  }
  const results = [];

  for (const key of brandKeys) {
    const brand = BRAND_CATALOG[key];
    if (!brand) continue;
    // Run sequentially to keep logs/report generation deterministic per brand.
    const result = await runQaAllForBrand({ brand, mode, cwd, dryRun, runProfile });
    results.push(result);
  }

  const failed = results.filter((item) => item.code !== 0);
  console.log('\n=== Brand Matrix Summary ===');
  for (const item of results) {
    const status = item.code === 0 ? item.runStatus || 'PASSED' : 'FAILED';
    console.log(
      `- ${item.brand} [${item.mode}] ${status} | ${item.durationSec}s | ${item.reportDir}`
    );
  }

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
