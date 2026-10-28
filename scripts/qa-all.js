const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const { URL } = require('url');
const { loadProjectEnv } = require('./lib/env');
const { resolveProjectPaths } = require('../tests/helpers/project-paths');
const {
  analyzeStorageStatePayload,
  mergeStorageStatePayload,
  readStorageStatePayload,
} = require('../tests/helpers/auth-state');

loadProjectEnv();

const providerProfile = String(process.env.PW_PROVIDER_PROFILE || 'extended')
  .trim()
  .toLowerCase();
const isNightlyRoute = process.env.PW_NIGHTLY_ROUTE === '1' || providerProfile === 'nightly';
const includeNightlyExtras =
  process.env.PW_INCLUDE_NIGHTLY_EXTRAS === '1' ||
  (process.env.PW_INCLUDE_NIGHTLY_EXTRAS !== '0' && isNightlyRoute);
const includeA11ySuites =
  process.env.PW_INCLUDE_A11Y === '1' || (process.env.PW_INCLUDE_A11Y !== '0' && isNightlyRoute);
const includeVisualSuites =
  process.env.PW_VISUAL_REQUIRED === '1' ||
  process.env.PW_INCLUDE_VISUAL === '1' ||
  (process.env.PW_INCLUDE_VISUAL !== '0' && isNightlyRoute);
const runProfile = String(process.env.PW_RUN_PROFILE || 'full')
  .trim()
  .toLowerCase();
const normalizedRunProfile = ['full', 'core', 'providers'].includes(runProfile)
  ? runProfile
  : 'full';
const providersOnlyPhase =
  process.env.PW_CASINO_PROVIDERS_ONLY === '1' || normalizedRunProfile === 'providers';

const orderedSuites = [
  {
    key: 'home',
    label: 'Home content/scroll/buttons',
    tests: ['tests/smoke/gt-home-content.spec.js', 'tests/smoke/gt-home-buttons.spec.js'],
  },
  {
    key: 'registration',
    label: 'Register a new player',
    tests: ['tests/critical/signup-api-success.spec.js'],
  },
  {
    key: 'auth',
    label: 'Authorize with newly registered player',
    tests: ['tests/critical/login-auth.spec.js'],
    env: {
      PW_LOGIN_REQUIRE_REGISTERED: '1',
      PW_LOGIN_USE_ENV: '0',
    },
  },
  {
    key: 'profile',
    label: 'My Profile coverage',
    tests: ['tests/critical/profile-sections.spec.js'],
  },
  {
    key: 'deposit',
    label: 'Deposit coverage',
    tests: ['tests/critical/deposit-non-destructive.spec.js'],
  },
  {
    key: 'withdraw',
    label: 'Withdraw skeleton coverage',
    tests: ['tests/critical/withdraw-skeleton.spec.js'],
  },
  {
    key: 'sidebar',
    label: 'Sidebar + live chat + language',
    tests: [
      'tests/critical/sidebar.spec.js',
      'tests/destructive/live-chat-message.spec.js',
      'tests/destructive/live-chat-message-authorized.spec.js',
    ],
    env: {
      PW_INCLUDE_LIVE_CHAT: '1',
      PW_INCLUDE_LIVE_CHAT_AUTH: '1',
    },
  },
  {
    key: 'sports',
    label: 'Sports page coverage',
    tests: ['tests/critical/sports-catalog.spec.js'],
  },
  {
    key: 'casino',
    label: providersOnlyPhase
      ? 'Casino providers launch + history linkage'
      : 'Casino catalog + providers + favorites/history',
    tests: providersOnlyPhase
      ? ['tests/critical/casino-providers-real.spec.js']
      : ['tests/critical/casino-catalog.spec.js', 'tests/critical/casino-providers-real.spec.js'],
  },
  {
    key: 'livecasino',
    label: 'Live casino coverage',
    tests: ['tests/critical/livecasino-catalog.spec.js'],
  },
  {
    key: 'security',
    label: 'Profile security password rotation',
    tests: ['tests/critical/profile-password-security.spec.js'],
  },
  {
    key: 'contracts',
    label: 'API contract checks: auth/payment',
    tests: ['tests/critical/auth-payment-contract.spec.js'],
    env: {
      PW_CONTRACT_CHECKS: process.env.PW_CONTRACT_CHECKS || '1',
    },
  },
];

if (includeNightlyExtras) {
  orderedSuites.push({
    key: 'nightlyextras',
    label: 'Nightly extras (regression/full navigation)',
    tests: [
      'tests/critical/auth-site-regression.spec.js',
      'tests/critical/button-sweep.spec.js',
      'tests/critical/gt-home-navigation.spec.js',
      'tests/critical/signup-open-close.spec.js',
      'tests/smoke/smoke-session.spec.js',
    ],
  });
}

if (includeA11ySuites) {
  orderedSuites.push({
    key: 'a11y',
    label: 'Accessibility smoke',
    tests: ['tests/smoke/a11y-smoke.spec.js'],
  });
}

if (includeVisualSuites) {
  orderedSuites.push({
    key: 'visual',
    label: 'Visual smoke',
    tests: ['tests/visual/site-visual-smoke.spec.js'],
  });
}

function parseSuiteSelection(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) =>
        String(item || '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
  );
}

const profileSuitesOnly = (() => {
  if (normalizedRunProfile === 'core') {
    return parseSuiteSelection(
      'home,registration,auth,profile,deposit,withdraw,sidebar,sports,casino,livecasino,security,contracts'
    );
  }
  if (normalizedRunProfile === 'providers') {
    return parseSuiteSelection('registration,auth,casino');
  }
  return new Set();
})();
const envSuitesOnly = parseSuiteSelection(process.env.PW_SUITES_ONLY || '');
const suitesOnly = envSuitesOnly.size > 0 ? envSuitesOnly : profileSuitesOnly;
const suitesSkip = parseSuiteSelection(process.env.PW_SUITES_SKIP || '');
const selectedOrderedSuites = orderedSuites.filter((suite) => {
  const key = String(suite && suite.key ? suite.key : '')
    .trim()
    .toLowerCase();
  if (!key) return false;
  if (suitesOnly.size > 0 && !suitesOnly.has(key)) return false;
  if (suitesSkip.has(key)) return false;
  return true;
});

const destructiveTests = [
  'tests/destructive/signup-full.spec.js',
  'tests/destructive/forgot-password.spec.js',
];
const precheckTests = ['tests/smoke/gt-precheck.spec.js'];
const projectPaths = resolveProjectPaths({ cwd: process.cwd() });
const currentBrandHost = (() => {
  try {
    return new URL(projectPaths.baseUrl || process.env.BASE_URL || '').hostname.toLowerCase();
  } catch {
    return '';
  }
})();
const isCashoBrandRun =
  currentBrandHost === 'casho.bet' || /(^|-)casho\.bet($|-)/i.test(projectPaths.brandSlug || '');
const isSingleRouteWarmupBrandRun =
  isCashoBrandRun ||
  currentBrandHost === 'gt.bet' ||
  /(^|-)gt\.bet($|-)/i.test(projectPaths.brandSlug || '') ||
  currentBrandHost === 'chacha.bet' ||
  /(^|-)chacha\.bet($|-)/i.test(projectPaths.brandSlug || '') ||
  currentBrandHost === 'igo.bet' ||
  /(^|-)igo\.bet($|-)/i.test(projectPaths.brandSlug || '');
const matrixProfileDir = isMobileMatrix(process.env.PW_PROJECT_MATRIX || 'desktop')
  ? 'mobile'
  : 'desktop';
const defaultSaveStateProfileDir = path.join(
  projectPaths.projectRoot,
  '.pw-profile',
  matrixProfileDir
);
const qaRunId = String(
  process.env.QA_RUN_ID ||
    `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random()
      .toString(36)
      .slice(2, 8)}`
)
  .trim()
  .toLowerCase();
const storageStatePath =
  process.env.PW_STORAGE_STATE || path.join(projectPaths.projectRoot, 'storageState.json');
const reportDir = projectPaths.testResultsDir;
const reportJsonPath = path.join(reportDir, 'report.json');
const phaseReportDir = path.join(projectPaths.artifactsDir, 'phase-reports');
const phaseTestResultsDir = path.join(projectPaths.artifactsDir, 'phase-test-results');
const runHistoryDir = path.join(projectPaths.artifactsDir, 'history', 'runs');
const phaseReportPaths = {
  precheck: path.join(phaseReportDir, 'precheck-report.json'),
  home: path.join(phaseReportDir, 'home-report.json'),
  registration: path.join(phaseReportDir, 'registration-report.json'),
  auth: path.join(phaseReportDir, 'auth-report.json'),
  profile: path.join(phaseReportDir, 'profile-report.json'),
  deposit: path.join(phaseReportDir, 'deposit-report.json'),
  withdraw: path.join(phaseReportDir, 'withdraw-report.json'),
  sidebar: path.join(phaseReportDir, 'sidebar-report.json'),
  sports: path.join(phaseReportDir, 'sports-report.json'),
  casino: path.join(phaseReportDir, 'casino-report.json'),
  livecasino: path.join(phaseReportDir, 'livecasino-report.json'),
  security: path.join(phaseReportDir, 'security-report.json'),
  contracts: path.join(phaseReportDir, 'contracts-report.json'),
  nightlyextras: path.join(phaseReportDir, 'nightlyextras-report.json'),
  a11y: path.join(phaseReportDir, 'a11y-report.json'),
  visual: path.join(phaseReportDir, 'visual-report.json'),
  main: path.join(phaseReportDir, 'main-report.json'),
  destructive: path.join(phaseReportDir, 'destructive-report.json'),
};
const authStateHealthPath = path.join(projectPaths.artifactsDir, 'auth-state-health.json');
const kpiValidationPath = path.join(projectPaths.artifactsDir, 'kpi-validation.json');
const executionJournalPath = path.join(projectPaths.artifactsDir, 'run-execution.json');
const executionStartedAtMs = Date.now();
const executionAttempts = [];
const providerMatrixArtifactPath = path.join(
  projectPaths.autotestReportDir,
  'casino',
  'providers-real',
  'providers-real-matrix.json'
);
const depositInventoryArtifactPath = path.join(
  projectPaths.autotestReportDir,
  'deposit',
  'deposit-inventory.json'
);
const depositMethodArtifactPath = path.join(
  projectPaths.autotestReportDir,
  'deposit',
  'deposit-non-destructive.json'
);
const authStateMirrorPaths = [
  path.join(projectPaths.artifactsDir, 'registration-auth-state.json'),
  path.join(projectPaths.artifactsDir, 'profile-auth-state.json'),
  path.join(projectPaths.artifactsDir, 'site-coverage-auth-state.json'),
  path.join(projectPaths.artifactsDir, 'button-sweep-auth-state.json'),
].filter((candidate, index, all) => all.indexOf(candidate) === index);
const registrationChainArtifacts = [
  path.join(projectPaths.artifactsDir, 'registration-data-current-run.json'),
  path.join(projectPaths.testResultsDir, 'registration-data.json'),
  path.join(projectPaths.artifactsDir, 'last-registered-player.json'),
  path.join(projectPaths.artifactsDir, 'registration-auth-state.json'),
  path.join(projectPaths.artifactsDir, 'profile-auth-state.json'),
  path.join(projectPaths.artifactsDir, 'site-coverage-auth-state.json'),
  path.join(projectPaths.artifactsDir, 'button-sweep-auth-state.json'),
  path.join(projectPaths.artifactsDir, 'last-manual-login-player.json'),
  path.join(projectPaths.artifactsDir, 'last-login-candidate.txt'),
];
const qaPathEnv = {
  QA_PROJECT_ROOT: projectPaths.projectRoot,
  QA_PROJECT_SLUG: projectPaths.brandSlug,
  QA_ARTIFACTS_DIR: projectPaths.artifactsDir,
  QA_TEST_RESULTS_DIR: projectPaths.testResultsDir,
  QA_AUTOTEST_REPORT_DIR: projectPaths.autotestReportDir,
  QA_ANALYZE_DIR: projectPaths.analyzeDir,
  QA_RUN_ID: qaRunId,
  PW_STORAGE_STATE: storageStatePath,
  PW_RUN_PROFILE: normalizedRunProfile,
  PW_CASINO_PROVIDERS_ONLY: providersOnlyPhase ? '1' : '0',
  PW_SAVE_STATE_PROFILE_DIR: process.env.PW_SAVE_STATE_PROFILE_DIR || defaultSaveStateProfileDir,
};

const crashpadHints = [
  /crashpad/i,
  /Target page, context or browser has been closed/i,
  /Permission denied \(1100\)/i,
];

const networkTransientHints = [
  /internet connection appears to be offline/i,
  /net::err_internet_disconnected/i,
  /net::err_network_changed/i,
  /net::err_timed_out/i,
  /socket hang up/i,
];
const timeoutHints = [
  /Test timeout of \d+ms exceeded/i,
  /expect\([^)]*\)\.to(BeVisible|BeHidden|BeEnabled|HaveURL)\(\) failed by timeout/i,
];
const providerInfraHints = [
  /cloudflare|turnstile|captcha|challenge|waf|cdn-cgi|__cf_chl|just a moment|security verification/i,
  /internet connection appears to be offline|net::err_internet_disconnected|net::err_network_changed/i,
  /net::err_failed|net::err_timed_out|socket hang up|watchdog timed out/i,
  /navigation failed|temporarily unavailable|cancelled\/aborted before bootstrap/i,
  /expected authorized session|auth probes are not healthy/i,
  /\/api\/user\/(?:preferences|profile)=401/i,
];
const infraOnlyKpiCheckIds = new Set(['blocked-ratio', 'infra-blocked-ratio', 'provider-passed']);

const cloudflareHints = [
  /cloudflare/i,
  /403 on critical resources/i,
  /Just a moment/i,
  /turnstile|captcha|cdn-cgi|__cf_chl|challenge-platform/i,
];
const failureStatuses = new Set(['failed', 'timedOut', 'interrupted']);

const autoSaveState = process.env.PW_AUTO_SAVE_STATE !== '0';
const softPrecheck = process.env.PW_PRECHECK_SOFT === '1';
const includeDestructive = process.env.PW_INCLUDE_DESTRUCTIVE === '1';
const runHeaded = process.env.PW_HEADED === '1';
const aiRequired = process.env.PW_AI_REQUIRED === '1';
const useAiGeneration = aiRequired || process.env.PW_USE_AI_GENERATION === '1';
const preferWebkitOnCloudflare = process.env.PW_CF_PREFER_WEBKIT !== '0';
const forceSaveStateBeforeRun = process.env.PW_FORCE_SAVE_STATE_BEFORE_RUN !== '0';
const requireHeadedLoginBeforeRun = process.env.PW_REQUIRE_HEADED_LOGIN_BEFORE_RUN === '1';
const requireHeadedLoginStrict = process.env.PW_REQUIRE_HEADED_LOGIN_STRICT === '1';
const mobileStabilizeRerun = process.env.PW_MOBILE_STABILIZE_RERUN !== '0';
const suitesProjectMatrix = process.env.PW_PROJECT_MATRIX || 'desktop';
const precheckProjectMatrix = process.env.PW_PRECHECK_PROJECT_MATRIX || 'desktop';
const runDoctorPreflight = process.env.QA_PREFLIGHT_DOCTOR !== '0';
const strictValidRun = process.env.PW_VALID_RUN_STRICT === '1';
const abortOnWafGuard = process.env.PW_ABORT_ON_WAF_GUARD !== '0';
const suiteRefreshCooldownMs = Math.max(
  0,
  Number.parseInt(process.env.PW_SUITE_REFRESH_COOLDOWN_MS || '120000', 10) || 120_000
);
const suiteRefreshMax = Math.max(
  0,
  (() => {
    const parsed = Number.parseInt(process.env.PW_SUITE_REFRESH_MAX || '3', 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 3;
  })()
);
const suiteRefreshPhases = (() => {
  const fallback =
    'auth,profile,deposit,sidebar,sports,casino,livecasino,security,contracts,nightlyextras,a11y,visual';
  const set = parseSuiteSelection(process.env.PW_SUITE_REFRESH_PHASES || fallback);
  return set.size > 0 ? set : parseSuiteSelection(fallback);
})();
const challengeRerunMax = Math.max(
  0,
  Number.parseInt(process.env.PW_CHALLENGE_RERUNS || '0', 10) || 0
);
const challengeRerunBackoffMs = Math.max(
  0,
  Number.parseInt(process.env.PW_CHALLENGE_RERUN_BACKOFF_MS || '2500', 10) || 2500
);
const challengeRerunPhases = (() => {
  const fallback = 'auth,profile,deposit,sidebar,sports,casino,livecasino,security,contracts';
  const set = parseSuiteSelection(process.env.PW_CHALLENGE_RERUN_PHASES || fallback);
  return set.size > 0 ? set : parseSuiteSelection(fallback);
})();
const authStateFreshnessSec = (() => {
  const raw = Number.parseInt(process.env.PW_AUTH_STATE_MAX_AGE_SEC || '14400', 10);
  if (!Number.isFinite(raw) || raw <= 0) return 14400;
  return raw;
})();

const kpiThresholds = {
  maxBlockedRatio: (() => {
    const raw = Number.parseFloat(process.env.PW_KPI_MAX_BLOCKED_RATIO || '0.55');
    if (!Number.isFinite(raw) || raw <= 0) return 0.55;
    return raw;
  })(),
  maxInfraBlockedRatio: (() => {
    const raw = Number.parseFloat(process.env.PW_KPI_MAX_INFRA_BLOCKED_RATIO || '0.45');
    if (!Number.isFinite(raw) || raw <= 0) return 0.45;
    return raw;
  })(),
  minProviderPassed: (() => {
    const raw = Number.parseInt(process.env.PW_KPI_MIN_PROVIDER_PASSED || '1', 10);
    if (!Number.isFinite(raw) || raw < 0) return 1;
    return raw;
  })(),
  requireDepositUiWhenApiPresent: process.env.PW_KPI_REQUIRE_DEPOSIT_UI_WITH_API !== '0',
  requireDepositCoverage: process.env.PW_KPI_REQUIRE_DEPOSIT_COVERAGE === '1' || strictValidRun,
  requireProviderCoverage: process.env.PW_KPI_REQUIRE_PROVIDER_COVERAGE === '1' || strictValidRun,
  requireCleanPrecheck: process.env.PW_KPI_REQUIRE_CLEAN_PRECHECK === '1' || strictValidRun,
};
const kpiWafGraceEnabled = !strictValidRun && process.env.PW_KPI_WAF_GRACE !== '0';
const kpiWafGraceMinBlockedRatio = (() => {
  const raw = Number.parseFloat(process.env.PW_KPI_WAF_GRACE_MIN_BLOCKED_RATIO || '0.70');
  if (!Number.isFinite(raw) || raw <= 0) return 0.7;
  return raw;
})();
const kpiWafGraceMinInfraRatio = (() => {
  const raw = Number.parseFloat(process.env.PW_KPI_WAF_GRACE_MIN_INFRA_RATIO || '0.60');
  if (!Number.isFinite(raw) || raw <= 0) return 0.6;
  return raw;
})();

function splitWarmupRoutes(value) {
  return String(value || '')
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function defaultSaveStateWarmupRoutes() {
  return isSingleRouteWarmupBrandRun ? ['/'] : ['/', '/assets/', '/casino/', '/casino/recent/'];
}

function recoveryWarmupRoutesForSuite(suiteKey) {
  if (isSingleRouteWarmupBrandRun) return ['/'];
  return suiteKey === 'casino' || suiteKey === 'livecasino'
    ? ['/casino/', '/casino/recent/']
    : ['/'];
}

function downstreamRefreshWarmupRoutesForSuite(suiteKey) {
  if (isSingleRouteWarmupBrandRun) return ['/'];
  return suiteKey === 'casino' || suiteKey === 'livecasino' ? ['/casino/', '/casino/recent/'] : [];
}

const forceSaveStateWarmupRoutes = process.env.PW_SAVE_STATE_WARMUP_ROUTES
  ? splitWarmupRoutes(process.env.PW_SAVE_STATE_WARMUP_ROUTES)
  : defaultSaveStateWarmupRoutes();

const saveStateTimeoutParsed = Number.parseInt(process.env.PW_SAVE_STATE_TIMEOUT || '90', 10);
const saveStateTimeoutSec =
  Number.isFinite(saveStateTimeoutParsed) && saveStateTimeoutParsed > 0
    ? saveStateTimeoutParsed
    : 90;

function isCloudflareBlocked(output) {
  return cloudflareHints.some((re) => re.test(output));
}

function isChallengeLikeText(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return false;
  return (
    text.includes('cloudflare') ||
    text.includes('challenge') ||
    text.includes('turnstile') ||
    text.includes('captcha') ||
    text.includes('waf') ||
    text.includes('cdn-cgi') ||
    text.includes('__cf_chl') ||
    text.includes('just a moment') ||
    text.includes('security verification') ||
    text.includes('403')
  );
}

function isProviderRowChallengeBlocked(row) {
  if (!row || typeof row !== 'object') return false;
  if (String(row.status || '').toLowerCase() !== 'blocked') return false;
  const blob = [
    row.reason,
    row.note,
    row.outcome,
    row.uiBlockedReason,
    ...(Array.isArray(row.modes)
      ? row.modes.flatMap((mode) => [mode && mode.reason, mode && mode.uiBlockedReason])
      : []),
  ]
    .map((item) => String(item || ''))
    .join(' ');
  return isChallengeLikeText(blob);
}

function isProviderRowInfraBlocked(row) {
  if (!row || typeof row !== 'object') return false;
  if (String(row.status || '').toLowerCase() !== 'blocked') return false;
  const blob = [
    row.reason,
    row.note,
    row.outcome,
    row.uiBlockedReason,
    ...(Array.isArray(row.modes)
      ? row.modes.flatMap((mode) => [mode && mode.reason, mode && mode.uiBlockedReason])
      : []),
  ]
    .map((item) => String(item || ''))
    .join(' ');
  return providerInfraHints.some((re) => re.test(blob)) || isChallengeLikeText(blob);
}

function browserEnv(browser) {
  if (browser === 'webkit') {
    return {
      PW_USE_CHROME_CHANNEL: '0',
      PW_BROWSER: 'webkit',
    };
  }

  return {
    PW_BROWSER: 'chromium',
  };
}

function isMobileMatrix(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .includes('mobile');
}

function buildPlaywrightArgs(tests, options = {}) {
  const args = ['playwright', 'test', ...tests, '--workers=1'];
  const shardArg = String(options.shardArg || process.env.PW_PLAYWRIGHT_SHARD || '').trim();
  if (shardArg && /^\d+\/\d+$/.test(shardArg)) {
    args.push(`--shard=${shardArg}`);
  }
  if (runHeaded) args.push('--headed');
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(bin, args, envOverride = {}) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      ...qaPathEnv,
      PW_REPORT_JSON: '1',
      FORCE_COLOR: '0',
      PW_WAF_DIAGNOSTIC: process.env.PW_WAF_DIAGNOSTIC || '1',
      PW_AUTO_BYPASS_CF_TIMEOUT_MS: process.env.PW_AUTO_BYPASS_CF_TIMEOUT_MS || '45000',
      ...envOverride,
    };
    delete env.NO_COLOR;

    const child = spawn(bin, args, { env });
    let output = '';
    let settled = false;

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      output += chunk.toString();
    });

    const finish = (code, signal = null) => {
      if (settled) return;
      settled = true;
      resolve({ code: Number(code || (signal ? 1 : 0)), signal, output });
    };
    child.on('error', (error) => {
      output += `\n${String(error && error.stack ? error.stack : error)}`;
      finish(1);
    });
    // `exit` may fire while inherited descendants still own the stdio pipes.
    // Waiting for `close` prevents the runner from snapshotting stale reports
    // or starting the next phase while Playwright workers are still writing.
    child.on('close', finish);
  });
}

function runPlaywright(args, envOverride = {}) {
  return runCommand('npx', args, envOverride);
}

function persistExecutionJournal(completed = false) {
  writeJson(executionJournalPath, {
    runId: qaRunId,
    baseUrl: projectPaths.baseUrl || process.env.BASE_URL || '',
    mode: suitesProjectMatrix,
    startedAt: new Date(executionStartedAtMs).toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: completed ? new Date().toISOString() : '',
    durationMs: Math.max(0, Date.now() - executionStartedAtMs),
    attempts: executionAttempts,
    summary: {
      attempts: executionAttempts.length,
      retries: executionAttempts.filter((attempt) => attempt.retry).length,
      failedAttempts: executionAttempts.filter((attempt) => Number(attempt.code || 0) !== 0).length,
      wafAttempts: executionAttempts.filter((attempt) => attempt.wafSignal).length,
      playwrightAttempts: executionAttempts.filter((attempt) => attempt.kind === 'playwright')
        .length,
      storageStateAttempts: executionAttempts.filter((attempt) => attempt.kind === 'storage-state')
        .length,
      storageStateFailedAttempts: executionAttempts.filter(
        (attempt) => attempt.kind === 'storage-state' && Number(attempt.code || 0) !== 0
      ).length,
    },
  });
}

async function runTrackedPlaywright(args, envOverride = {}, metadata = {}) {
  const phase = String(metadata.phase || metadata.label || 'unknown').trim() || 'unknown';
  const startedAtMs = Date.now();
  const retry = executionAttempts.some((attempt) => attempt.phase === phase);
  const result = await runPlaywright(args, envOverride);
  executionAttempts.push({
    kind: 'playwright',
    phase,
    label: String(metadata.label || phase),
    browser: String(metadata.browser || ''),
    retry,
    startedAt: new Date(startedAtMs).toISOString(),
    durationMs: Math.max(0, Date.now() - startedAtMs),
    code: Number(result.code || 0),
    // Successful output can contain diagnostic words such as "Cloudflare"
    // without the phase being blocked. The phase report remains the source of
    // truth for soft/annotated WAF signals; attempt-level WAF is for failures.
    wafSignal: Number(result.code || 0) !== 0 && isCloudflareBlocked(result.output || ''),
  });
  persistExecutionJournal(false);
  return result;
}

function runNodeScript(scriptPath, scriptArgs = [], envOverride = {}) {
  return runCommand('node', [scriptPath, ...scriptArgs], envOverride);
}

function wafGuardArtifactPath(label) {
  const safeLabel = String(label || 'guard')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return path.join(projectPaths.artifactsDir, 'waf-guards', `${safeLabel || 'guard'}.json`);
}

async function runWafGuard({ label, baseUrl, routes = [], depositApi = false, browser = '' }) {
  const guardLabel = String(label || 'waf-guard');
  const outPath = wafGuardArtifactPath(guardLabel);
  const args = [
    `--label=${guardLabel}`,
    `--base-url=${baseUrl}`,
    `--routes=${routes.length ? routes.join(',') : '/,/casino/'}`,
    `--out=${outPath}`,
    `--storage-state=${storageStatePath}`,
  ];
  if (depositApi) args.push('--deposit-api=1');
  if (browser) args.push(`--browser=${browser}`);

  console.log(`\n> node scripts/qa-waf-guard.js ${args.join(' ')}`);
  const result = await runNodeScript(path.join('scripts', 'qa-waf-guard.js'), args);
  return { ...result, outPath };
}

function writeJson(filePath, payload) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    // best-effort write
  }
}

function mirrorPrimaryStorageState() {
  try {
    if (!fs.existsSync(storageStatePath)) return;
    const primaryPayload = readStorageStatePayload(storageStatePath);
    if (!primaryPayload) return;
    let effectivePayload = primaryPayload;
    if (!analyzeStorageStatePayload(primaryPayload).hasAuthArtifacts) {
      const preservedAuthState = authStateMirrorPaths
        .map((candidate) => readStorageStatePayload(candidate))
        .find((payload) => payload && analyzeStorageStatePayload(payload).hasAuthArtifacts);
      if (preservedAuthState) {
        effectivePayload = mergeStorageStatePayload(preservedAuthState, primaryPayload);
      }
    }

    if (!analyzeStorageStatePayload(effectivePayload).hasAuthArtifacts) {
      console.log(
        '\n⚠️  storageState contains WAF/session data but no auth token; auth mirrors preserved.'
      );
      return;
    }

    writeJson(storageStatePath, effectivePayload);
    for (const target of authStateMirrorPaths) {
      if (!target || path.resolve(target) === path.resolve(storageStatePath)) continue;
      writeJson(target, effectivePayload);
    }
  } catch {
    // best-effort mirror
  }
}

function inspectStorageStateFile(filePath, maxAgeSec = authStateFreshnessSec) {
  const entry = {
    path: filePath,
    exists: false,
    sizeBytes: 0,
    modifiedAt: '',
    ageSec: null,
    fresh: false,
    cookiesCount: 0,
    originsCount: 0,
    hasSessionArtifacts: false,
    parseError: '',
  };
  if (!filePath) return entry;

  try {
    if (!fs.existsSync(filePath)) return entry;
    const stat = fs.statSync(filePath);
    const ageMs = Date.now() - Number(stat.mtimeMs || 0);
    entry.exists = true;
    entry.sizeBytes = Number(stat.size || 0);
    entry.modifiedAt = new Date(Number(stat.mtimeMs || Date.now())).toISOString();
    entry.ageSec = Math.max(0, Math.round(ageMs / 1000));
    entry.fresh = Number.isFinite(entry.ageSec) ? entry.ageSec <= maxAgeSec : false;

    try {
      const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      entry.cookiesCount = Array.isArray(payload && payload.cookies) ? payload.cookies.length : 0;
      entry.originsCount = Array.isArray(payload && payload.origins) ? payload.origins.length : 0;
      Object.assign(entry, analyzeStorageStatePayload(payload));
    } catch (err) {
      entry.parseError = String(err && err.message ? err.message : err);
      entry.hasSessionArtifacts = false;
    }
  } catch (err) {
    entry.parseError = String(err && err.message ? err.message : err);
  }

  return entry;
}

function listAuthStateCandidates() {
  return [
    storageStatePath,
    ...authStateMirrorPaths,
    path.join(projectPaths.projectRoot, 'storageState.json'),
    path.join(process.cwd(), 'storageState.json'),
  ]
    .filter(Boolean)
    .filter((candidate, index, all) => all.indexOf(candidate) === index);
}

function compareAuthStateEntries(left, right) {
  const leftHasAuth = Boolean(left && left.hasAuthArtifacts);
  const rightHasAuth = Boolean(right && right.hasAuthArtifacts);
  if (leftHasAuth !== rightHasAuth) return leftHasAuth ? -1 : 1;

  const leftHealthy = Boolean(
    left && left.exists && left.fresh && left.hasSessionArtifacts && !left.parseError
  );
  const rightHealthy = Boolean(
    right && right.exists && right.fresh && right.hasSessionArtifacts && !right.parseError
  );
  if (leftHealthy !== rightHealthy) return leftHealthy ? -1 : 1;

  const leftFreshWithSession = Boolean(
    left && left.exists && left.fresh && left.hasSessionArtifacts
  );
  const rightFreshWithSession = Boolean(
    right && right.exists && right.fresh && right.hasSessionArtifacts
  );
  if (leftFreshWithSession !== rightFreshWithSession) return leftFreshWithSession ? -1 : 1;

  const leftFresh = Boolean(left && left.exists && left.fresh);
  const rightFresh = Boolean(right && right.exists && right.fresh);
  if (leftFresh !== rightFresh) return leftFresh ? -1 : 1;

  const leftHasSession = Boolean(left && left.exists && left.hasSessionArtifacts);
  const rightHasSession = Boolean(right && right.exists && right.hasSessionArtifacts);
  if (leftHasSession !== rightHasSession) return leftHasSession ? -1 : 1;

  const leftParseError = Boolean(left && left.parseError);
  const rightParseError = Boolean(right && right.parseError);
  if (leftParseError !== rightParseError) return leftParseError ? 1 : -1;

  const leftAge = Number.isFinite(left && left.ageSec)
    ? Number(left.ageSec)
    : Number.MAX_SAFE_INTEGER;
  const rightAge = Number.isFinite(right && right.ageSec)
    ? Number(right.ageSec)
    : Number.MAX_SAFE_INTEGER;
  if (leftAge !== rightAge) return leftAge - rightAge;

  const leftSize = Number.isFinite(left && left.sizeBytes) ? Number(left.sizeBytes) : 0;
  const rightSize = Number.isFinite(right && right.sizeBytes) ? Number(right.sizeBytes) : 0;
  if (leftSize !== rightSize) return rightSize - leftSize;

  return String(left && left.path ? left.path : '').localeCompare(
    String(right && right.path ? right.path : '')
  );
}

function selectBestAuthStateEntry(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const existing = entries.filter((item) => item && item.exists);
  if (existing.length === 0) return null;
  return [...existing].sort(compareAuthStateEntries)[0] || null;
}

function runSaveState(baseUrl, options = {}) {
  return new Promise((resolve) => {
    const startedAtMs = Date.now();
    const phase = String(options.phase || 'storage-state').trim() || 'storage-state';
    const trigger = String(options.trigger || 'session-refresh').trim() || 'session-refresh';
    const warmupRoutes = Array.isArray(options.warmupRoutes)
      ? options.warmupRoutes.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const warmupStrict = options.warmupStrict === true;
    const mobileMatrixRun = isMobileMatrix(suitesProjectMatrix);
    const manualMode = options.manual === true;
    const mobileSaveStateUserAgent =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1';
    const env = {
      ...process.env,
      ...qaPathEnv,
      PW_USE_CHROME_CHANNEL: '1',
      PW_SAVE_STATE_TIMEOUT: String(saveStateTimeoutSec),
      PW_SAVE_STATE_PERSISTENT:
        process.env.PW_SAVE_STATE_PERSISTENT || (!process.env.CI ? '1' : '0'),
      PW_SAVE_STATE_PROFILE_DIR:
        process.env.PW_SAVE_STATE_PROFILE_DIR || defaultSaveStateProfileDir,
      PW_SAVE_STATE_AUTO_BYPASS: manualMode ? '0' : '1',
      PW_SAVE_STATE_VIEWPORT:
        process.env.PW_SAVE_STATE_VIEWPORT || (mobileMatrixRun ? '390x844' : '1365x900'),
      PW_SAVE_STATE_IS_MOBILE: process.env.PW_SAVE_STATE_IS_MOBILE || (mobileMatrixRun ? '1' : '0'),
      PW_USER_AGENT: process.env.PW_USER_AGENT || (mobileMatrixRun ? mobileSaveStateUserAgent : ''),
      PW_SAVE_STATE_WARMUP_ROUTES:
        warmupRoutes.length > 0
          ? warmupRoutes.join(',')
          : process.env.PW_SAVE_STATE_WARMUP_ROUTES || '',
      PW_SAVE_STATE_WARMUP_STRICT: warmupStrict
        ? '1'
        : process.env.PW_SAVE_STATE_WARMUP_STRICT || '0',
    };
    const args = ['analyze/saveState.js', baseUrl, storageStatePath];
    if (!manualMode) args.push('--auto');
    const child = spawn('node', args, { env, stdio: ['inherit', 'pipe', 'pipe'] });
    let output = '';
    let finalized = false;
    const collectOutput = (stream, target) => {
      stream.on('data', (chunk) => {
        target.write(chunk);
        output += chunk.toString();
      });
    };
    collectOutput(child.stdout, process.stdout);
    collectOutput(child.stderr, process.stderr);

    const finalize = (code) => {
      if (finalized) return;
      finalized = true;
      const numericCode = Number(code || 0);
      if (numericCode === 0) {
        mirrorPrimaryStorageState();
      }
      executionAttempts.push({
        kind: 'storage-state',
        phase,
        label: String(options.label || `storageState refresh [${trigger}]`),
        browser: 'chromium-channel',
        retry: executionAttempts.some(
          (attempt) => attempt.kind === 'storage-state' && attempt.phase === phase
        ),
        trigger,
        startedAt: new Date(startedAtMs).toISOString(),
        durationMs: Math.max(0, Date.now() - startedAtMs),
        code: numericCode,
        wafSignal: options.wafSignal === true || isCloudflareBlocked(output),
      });
      persistExecutionJournal(false);
      resolve(code);
    };
    child.on('error', (error) => {
      output += `\n${String(error && error.message ? error.message : error)}`;
      finalize(1);
    });
    child.on('close', finalize);
  });
}

function parseShardConfig(prefix) {
  const normalizedPrefix = String(prefix || '')
    .trim()
    .toUpperCase();
  if (!normalizedPrefix) return null;

  const totalRaw = Number.parseInt(process.env[`${normalizedPrefix}_SHARD_TOTAL`] || '0', 10);
  if (!Number.isFinite(totalRaw) || totalRaw <= 1) return null;

  const total = Math.max(2, totalRaw);
  const indexRaw = Number.parseInt(process.env[`${normalizedPrefix}_SHARD_INDEX`] || '1', 10);
  const index = Number.isFinite(indexRaw) ? Math.min(Math.max(indexRaw, 1), total) : 1;
  return { index, total, arg: `${index}/${total}` };
}

function resolveSuiteShardArg(suiteKey) {
  const suite = String(suiteKey || '')
    .trim()
    .toLowerCase();
  const generic = parseShardConfig('PW_SUITE');
  if (generic) return generic.arg;

  if (suite === 'sports') {
    const sports = parseShardConfig('PW_SPORTS');
    if (sports) return sports.arg;
  }

  if (suite === 'casino') {
    const casino = parseShardConfig('PW_CASINO');
    if (casino) return casino.arg;
  }

  return '';
}

async function ensureAuthStateHealth({
  baseUrl,
  phase = 'precheck',
  allowRefresh = true,
  requireAuth = false,
}) {
  const candidates = listAuthStateCandidates();
  const checkedAt = new Date().toISOString();
  let entries = candidates.map((candidate) =>
    inspectStorageStateFile(candidate, authStateFreshnessSec)
  );
  let selected = selectBestAuthStateEntry(entries);

  let refreshTriggered = false;
  let refreshReason = '';
  const selectedHealthy = Boolean(
    selected &&
    selected.exists &&
    selected.fresh &&
    selected.hasSessionArtifacts &&
    (!requireAuth || selected.hasAuthArtifacts)
  );

  const refreshCanRecover = !requireAuth || Boolean(selected && selected.hasAuthArtifacts);
  if (!selectedHealthy && refreshCanRecover && autoSaveState && !process.env.CI && allowRefresh) {
    refreshTriggered = true;
    if (!selected || !selected.exists) {
      refreshReason = 'No auth storageState found.';
    } else if (!selected.fresh) {
      refreshReason = `Auth storageState is stale (age=${selected.ageSec || 'n/a'}s, max=${authStateFreshnessSec}s).`;
    } else if (!selected.hasSessionArtifacts) {
      refreshReason = 'Auth storageState has no session cookies/origins.';
    } else {
      refreshReason = 'Auth storageState health check requested refresh.';
    }

    console.log(`\n⚠️  ${phase}: ${refreshReason} Refreshing storageState...`);
    const refreshCode = await runSaveState(baseUrl, {
      warmupRoutes: defaultSaveStateWarmupRoutes(),
      warmupStrict: false,
      phase,
      trigger: 'auth-state-health',
    });
    if (Number(refreshCode || 0) === 0) {
      entries = candidates.map((candidate) =>
        inspectStorageStateFile(candidate, authStateFreshnessSec)
      );
      selected = selectBestAuthStateEntry(entries);
      console.log(`\n✅ ${phase}: storageState refreshed for auth-state health.`);
    } else {
      console.log(`\n⚠️  ${phase}: storageState refresh failed during auth-state health check.`);
    }
  }

  const finalHealthy = Boolean(
    selected &&
    selected.exists &&
    selected.fresh &&
    selected.hasSessionArtifacts &&
    (!requireAuth || selected.hasAuthArtifacts)
  );
  if (
    finalHealthy &&
    selected.path &&
    path.resolve(selected.path) !== path.resolve(storageStatePath)
  ) {
    try {
      fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });
      fs.copyFileSync(selected.path, storageStatePath);
    } catch {
      // best-effort mirror for the next brand run
    }
  }

  const health = {
    checkedAt,
    phase,
    requireAuth,
    maxAgeSec: authStateFreshnessSec,
    storageStatePath,
    refreshTriggered,
    refreshReason,
    selectedPath: selected ? selected.path : '',
    selectedModifiedAt: selected ? selected.modifiedAt : '',
    selectedAgeSec: selected ? selected.ageSec : null,
    selectedFresh: Boolean(selected && selected.fresh),
    selectedHasSessionArtifacts: Boolean(selected && selected.hasSessionArtifacts),
    selectedHasAuthArtifacts: Boolean(selected && selected.hasAuthArtifacts),
    selectedHasWafArtifacts: Boolean(selected && selected.hasWafArtifacts),
    selectedCookiesCount: selected ? selected.cookiesCount : 0,
    selectedOriginsCount: selected ? selected.originsCount : 0,
    healthy: finalHealthy,
    entries,
  };

  writeJson(authStateHealthPath, health);
  return health;
}

function cleanupStaleBrowserProcesses() {
  const platform = process.platform;
  const patterns =
    platform === 'darwin'
      ? [
          'playwright/lib/common/process.js',
          'pw_run.sh --inspector-pipe',
          'chrome-headless-shell',
          'Google Chrome for Testing',
          'ms-playwright/chromium',
          'ms-playwright/webkit',
        ]
      : [
          'playwright/lib/common/process.js',
          'pw_run.sh --inspector-pipe',
          'chrome-headless-shell',
          'ms-playwright/chromium',
          'ms-playwright/webkit',
        ];

  for (const pattern of patterns) {
    try {
      spawnSync('pkill', ['-f', pattern], { stdio: 'ignore' });
    } catch {
      // best-effort cleanup
    }
  }
}

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
  if (!payload) return null;
  if (process.env.QA_REPORT_ONLY === '1') return payload;
  return String(payload.runId || '').trim() === qaRunId ? payload : null;
}

function collectTestsFromSuites(suites) {
  const tests = [];

  function walkSuite(suite) {
    if (!suite || typeof suite !== 'object') return;

    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        for (const t of spec.tests || []) {
          const results = Array.isArray(t.results) ? t.results : [];
          const final = results[results.length - 1] || {};
          const mergedAnnotations = [
            ...(Array.isArray(t.annotations) ? t.annotations : []),
            ...results.flatMap((result) =>
              Array.isArray(result.annotations) ? result.annotations : []
            ),
          ];
          tests.push({
            status: final.status || t.status || 'unknown',
            annotations: mergedAnnotations,
          });
        }
      }
    }

    if (Array.isArray(suite.suites)) {
      for (const child of suite.suites) walkSuite(child);
    }
  }

  for (const suite of suites || []) walkSuite(suite);
  return tests;
}

function summarizePhaseReport(filePath) {
  const payload = readJson(filePath);
  if (!payload || !payload.stats) return null;

  const stats = payload.stats || {};
  const tests = collectTestsFromSuites(payload.suites || []);
  const total =
    Number(stats.expected || 0) +
    Number(stats.unexpected || 0) +
    Number(stats.flaky || 0) +
    Number(stats.skipped || 0);
  const failed = tests.filter((item) => failureStatuses.has(String(item.status || ''))).length;
  const failedInfraBlockedSignals = tests.filter((item) => {
    if (!failureStatuses.has(String(item.status || ''))) return false;
    const productBlocked = (item.annotations || []).some(
      (ann) => String(ann.type || '').toLowerCase() === 'product-blocked'
    );
    return (
      !productBlocked &&
      (String(item.status || '') === 'timedOut' ||
        (item.annotations || []).some((ann) =>
          ['infra-blocked', 'test-infra-timeout'].includes(String(ann.type || '').toLowerCase())
        ))
    );
  }).length;
  const failedProductBlockedSignals = tests.filter((item) => {
    if (!failureStatuses.has(String(item.status || ''))) return false;
    return (item.annotations || []).some(
      (ann) => String(ann.type || '').toLowerCase() === 'product-blocked'
    );
  }).length;
  const failedTestInfraTimeoutSignals = tests.filter((item) => {
    if (!failureStatuses.has(String(item.status || ''))) return false;
    return (
      String(item.status || '') === 'timedOut' ||
      (item.annotations || []).some(
        (ann) => String(ann.type || '').toLowerCase() === 'test-infra-timeout'
      )
    );
  }).length;
  const failedUnclassifiedSignals = tests.filter((item) => {
    if (!failureStatuses.has(String(item.status || ''))) return false;
    const hasInfra = (item.annotations || []).some(
      (ann) => String(ann.type || '').toLowerCase() === 'infra-blocked'
    );
    const hasProduct = (item.annotations || []).some(
      (ann) => String(ann.type || '').toLowerCase() === 'product-blocked'
    );
    const hasTestInfraTimeout = (item.annotations || []).some(
      (ann) => String(ann.type || '').toLowerCase() === 'test-infra-timeout'
    );
    return (
      !hasInfra && !hasProduct && !hasTestInfraTimeout && String(item.status || '') !== 'timedOut'
    );
  }).length;
  const blockedSignals = tests.filter((item) =>
    (item.annotations || []).some((ann) => String(ann.type || '').toLowerCase() === 'blocked')
  ).length;
  const infraBlockedSignals = tests.filter((item) =>
    (item.annotations || []).some((ann) => String(ann.type || '').toLowerCase() === 'infra-blocked')
  ).length;
  const productBlockedSignals = tests.filter((item) =>
    (item.annotations || []).some(
      (ann) => String(ann.type || '').toLowerCase() === 'product-blocked'
    )
  ).length;
  const testInfraTimeoutSignals = tests.filter(
    (item) =>
      String(item.status || '') === 'timedOut' ||
      (item.annotations || []).some(
        (ann) => String(ann.type || '').toLowerCase() === 'test-infra-timeout'
      )
  ).length;
  const notApplicableSignals = tests.filter((item) =>
    (item.annotations || []).some(
      (ann) => String(ann.type || '').toLowerCase() === 'not-applicable'
    )
  ).length;
  const partialSignals = tests.filter((item) =>
    (item.annotations || []).some((ann) => String(ann.type || '').toLowerCase() === 'partial')
  ).length;

  return {
    total,
    passed: Number(stats.expected || 0),
    failed,
    failedInfraBlockedSignals,
    failedProductBlockedSignals,
    failedTestInfraTimeoutSignals,
    failedUnclassifiedSignals,
    skipped: Number(stats.skipped || 0),
    flaky: Number(stats.flaky || 0),
    blockedSignals,
    infraBlockedSignals,
    productBlockedSignals,
    testInfraTimeoutSignals,
    notApplicableSignals,
    partialSignals,
    durationMs: Number(stats.duration || 0),
    generatedAt: String(stats.startTime || ''),
  };
}

function phaseHasCloudflareSignal(phase) {
  const filePath = phaseReportPaths[phase];
  if (!filePath) return false;
  const payload = readJson(filePath);
  if (!payload || !Array.isArray(payload.suites)) return false;

  const stack = [...payload.suites];
  while (stack.length > 0) {
    const suite = stack.pop();
    if (!suite || typeof suite !== 'object') continue;

    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        for (const t of spec.tests || []) {
          const annotations = [
            ...(Array.isArray(t.annotations) ? t.annotations : []),
            ...(Array.isArray(t.results)
              ? t.results.flatMap((result) =>
                  Array.isArray(result.annotations) ? result.annotations : []
                )
              : []),
          ];
          for (const ann of annotations) {
            const blob = `${String(ann && ann.type ? ann.type : '')} ${String(
              ann && ann.description ? ann.description : ''
            )}`;
            if (isCloudflareBlocked(blob)) return true;
          }

          for (const result of t.results || []) {
            for (const err of result.errors || []) {
              const message = String(err && err.message ? err.message : '');
              if (isCloudflareBlocked(message)) return true;
            }
            const singleError = String(
              result && result.error && result.error.message ? result.error.message : ''
            );
            if (isCloudflareBlocked(singleError)) return true;
          }
        }
      }
    }

    if (Array.isArray(suite.suites)) stack.push(...suite.suites);
  }

  return false;
}

function phaseFailedTestsHaveCloudflareSignal(phase) {
  const filePath = phaseReportPaths[phase];
  if (!filePath) return false;
  const payload = readJson(filePath);
  if (!payload || !Array.isArray(payload.suites)) return false;

  const stack = [...payload.suites];
  while (stack.length > 0) {
    const suite = stack.pop();
    if (!suite || typeof suite !== 'object') continue;

    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
      for (const currentTest of Array.isArray(spec.tests) ? spec.tests : []) {
        const results = Array.isArray(currentTest.results) ? currentTest.results : [];
        const finalResult = results[results.length - 1] || {};
        const status = String(finalResult.status || currentTest.status || '');
        if (!failureStatuses.has(status)) continue;

        const annotations = [
          ...(Array.isArray(currentTest.annotations) ? currentTest.annotations : []),
          ...results.flatMap((result) =>
            Array.isArray(result.annotations) ? result.annotations : []
          ),
        ];
        if (
          annotations.some((annotation) =>
            isCloudflareBlocked(
              `${String(annotation && annotation.type ? annotation.type : '')} ${String(
                annotation && annotation.description ? annotation.description : ''
              )}`
            )
          )
        ) {
          return true;
        }

        for (const result of results) {
          const messages = [
            result && result.error && result.error.message,
            ...(Array.isArray(result && result.errors)
              ? result.errors.map((error) => error && error.message)
              : []),
          ];
          if (messages.some((message) => isCloudflareBlocked(String(message || '')))) return true;
        }
      }
    }

    if (Array.isArray(suite.suites)) stack.push(...suite.suites);
  }

  return false;
}

function phaseHasBlockedSignal(phase) {
  const filePath = phaseReportPaths[phase];
  if (!filePath) return false;
  const payload = readJson(filePath);
  if (!payload || !Array.isArray(payload.suites)) return false;
  return collectTestsFromSuites(payload.suites).some((test) =>
    (test.annotations || []).some((ann) => {
      const type = String(ann && ann.type ? ann.type : '').toLowerCase();
      return type === 'blocked' || type === 'infra-blocked';
    })
  );
}

function collectRunSummary() {
  const phases = {};
  for (const [phase, filePath] of Object.entries(phaseReportPaths)) {
    const summary = summarizePhaseReport(filePath);
    if (summary) phases[phase] = summary;
  }

  const totals = {
    total: 0,
    passed: 0,
    failed: 0,
    failedInfraBlockedSignals: 0,
    failedProductBlockedSignals: 0,
    failedTestInfraTimeoutSignals: 0,
    failedUnclassifiedSignals: 0,
    skipped: 0,
    flaky: 0,
    blockedSignals: 0,
    infraBlockedSignals: 0,
    productBlockedSignals: 0,
    testInfraTimeoutSignals: 0,
    notApplicableSignals: 0,
    partialSignals: 0,
    durationMs: 0,
  };

  for (const phase of Object.keys(phases)) {
    const item = phases[phase];
    totals.total += item.total;
    totals.passed += item.passed;
    totals.failed += item.failed;
    totals.failedInfraBlockedSignals += Number(item.failedInfraBlockedSignals || 0);
    totals.failedProductBlockedSignals += Number(item.failedProductBlockedSignals || 0);
    totals.failedTestInfraTimeoutSignals += Number(item.failedTestInfraTimeoutSignals || 0);
    totals.failedUnclassifiedSignals += Number(item.failedUnclassifiedSignals || 0);
    totals.skipped += item.skipped;
    totals.flaky += item.flaky;
    totals.blockedSignals += item.blockedSignals;
    totals.infraBlockedSignals += Number(item.infraBlockedSignals || 0);
    totals.productBlockedSignals += Number(item.productBlockedSignals || 0);
    totals.testInfraTimeoutSignals += Number(item.testInfraTimeoutSignals || 0);
    totals.notApplicableSignals += Number(item.notApplicableSignals || 0);
    totals.partialSignals += item.partialSignals;
    totals.durationMs += item.durationMs;
  }

  return { phases, totals };
}

function evaluateRunKpis(summary) {
  const phases = (summary && summary.phases) || {};
  const totals = (summary && summary.totals) || {};
  const checks = [];
  const selectedSuiteKeys = new Set(
    selectedOrderedSuites.map((suite) => String(suite && suite.key ? suite.key : '').toLowerCase())
  );
  const blockedRatio =
    Number(totals.total || 0) > 0
      ? Number(totals.blockedSignals || 0) / Number(totals.total || 1)
      : 0;
  const infraBlockedRatio =
    Number(totals.total || 0) > 0
      ? Number(totals.infraBlockedSignals || 0) / Number(totals.total || 1)
      : 0;
  const providerSuiteSelected = selectedSuiteKeys.has('casino');
  const providerMatrix = readCurrentRunJson(providerMatrixArtifactPath);
  const providerResults = Array.isArray(providerMatrix && providerMatrix.results)
    ? providerMatrix.results
    : [];
  const providerLaunchCapableRows = providerResults.filter(
    (item) => String(item && item.outcome).toLowerCase() !== 'provider-absent'
  );
  const providerLaunchPassed = Number(
    providerLaunchCapableRows.filter((item) => {
      const outcome = String(item && item.outcome ? item.outcome : '').toLowerCase();
      return outcome === 'passed-strong' || outcome === 'passed-weak-surface';
    }).length
  );
  const providerPassed = Number(
    providerLaunchPassed ||
      (providerMatrix && providerMatrix.summary
        ? Number(providerMatrix.summary.passedStrong || 0) +
          Number(providerMatrix.summary.passedWeakSurface || 0)
        : 0) ||
      0
  );
  const providerApplicable =
    providerSuiteSelected && (providerResults.length > 0 || Boolean(phases.casino));
  const providerAllBlockedByChallenge =
    providerLaunchCapableRows.length > 0 &&
    providerLaunchCapableRows.every((row) => isProviderRowChallengeBlocked(row));
  const providerAllBlockedByInfra =
    providerLaunchCapableRows.length > 0 &&
    providerLaunchCapableRows.every((row) => isProviderRowInfraBlocked(row));
  const providerWafDominated = providerApplicable && providerAllBlockedByChallenge;
  const precheckCloudflareSignal = phaseHasCloudflareSignal('precheck');
  const precheckBlockedSignal = phaseHasBlockedSignal('precheck');
  const wafGraceApplied = kpiWafGraceEnabled && (precheckCloudflareSignal || providerWafDominated);
  const wafGraceReason = wafGraceApplied
    ? precheckCloudflareSignal
      ? 'Precheck contains Cloudflare/WAF challenge signals.'
      : providerWafDominated
        ? 'All provider real-launch rows are Cloudflare/WAF challenge-blocked.'
        : ''
    : '';

  const pushCheck = ({ id, label, actual, threshold, passed, applicable = true, detail = '' }) => {
    const rawPassed = Boolean(passed);
    checks.push({
      id,
      label,
      applicable,
      actual,
      threshold,
      passed: applicable ? rawPassed : true,
      rawPassed,
      waived: !applicable && !rawPassed,
      detail,
    });
  };

  pushCheck({
    id: 'precheck-waf-clean',
    label: 'Precheck has no blocked/WAF signal',
    actual: precheckBlockedSignal ? 1 : 0,
    threshold: 0,
    passed: !precheckBlockedSignal,
    applicable: kpiThresholds.requireCleanPrecheck && !wafGraceApplied,
    detail:
      (precheckBlockedSignal
        ? precheckCloudflareSignal
          ? 'precheck contains Cloudflare/WAF signal'
          : 'precheck is blocked: app root or critical surface is unavailable'
        : 'clean') + (wafGraceApplied ? ' (waived due to Cloudflare/WAF-dominated run)' : ''),
  });

  pushCheck({
    id: 'blocked-ratio',
    label: 'Blocked signals ratio',
    actual: blockedRatio,
    threshold: kpiThresholds.maxBlockedRatio,
    passed: blockedRatio <= kpiThresholds.maxBlockedRatio,
    applicable: Number(totals.total || 0) > 0 && !wafGraceApplied,
    detail:
      `${Number(totals.blockedSignals || 0)}/${Number(totals.total || 0)}` +
      (wafGraceApplied ? ' (waived due to Cloudflare/WAF-dominated run)' : ''),
  });

  pushCheck({
    id: 'infra-blocked-ratio',
    label: 'Infra-blocked signals ratio',
    actual: infraBlockedRatio,
    threshold: kpiThresholds.maxInfraBlockedRatio,
    passed: infraBlockedRatio <= kpiThresholds.maxInfraBlockedRatio,
    applicable: Number(totals.total || 0) > 0 && !wafGraceApplied,
    detail:
      `${Number(totals.infraBlockedSignals || 0)}/${Number(totals.total || 0)}` +
      (wafGraceApplied ? ' (waived due to Cloudflare/WAF-dominated run)' : ''),
  });

  pushCheck({
    id: 'provider-passed',
    label: 'Provider real-launch passed count',
    actual: providerPassed,
    threshold: kpiThresholds.minProviderPassed,
    passed: providerPassed >= kpiThresholds.minProviderPassed,
    applicable: providerApplicable && !(wafGraceApplied && providerAllBlockedByChallenge),
    detail: providerLaunchCapableRows.length
      ? `${providerPassed}/${providerLaunchCapableRows.length}` +
        (wafGraceApplied && providerAllBlockedByChallenge
          ? ' (waived: all provider rows are Cloudflare/WAF blocked)'
          : '')
      : `provider-results=${providerResults.length}`,
  });

  const depositInventory = readCurrentRunJson(depositInventoryArtifactPath);
  const depositMethods = readCurrentRunJson(depositMethodArtifactPath);
  const depositApiItems = Number(
    (depositInventory &&
      depositInventory.apiInventory &&
      depositInventory.apiInventory.itemsCount) ||
      (depositInventory &&
        depositInventory.apiFallback &&
        depositInventory.apiFallback.inventory &&
        depositInventory.apiFallback.inventory.itemsCount) ||
      (depositMethods &&
        depositMethods.apiFallback &&
        depositMethods.apiFallback.inventory &&
        depositMethods.apiFallback.inventory.itemsCount) ||
      (depositMethods && depositMethods.apiFallback && depositMethods.apiFallback.itemsCount) ||
      0
  );
  const depositUiTiles = Number(
    depositInventory && depositInventory.uiInventory && depositInventory.uiInventory.totalTiles
      ? depositInventory.uiInventory.totalTiles
      : 0
  );
  const depositBlocked = Boolean(
    (depositInventory && depositInventory.blocked) || (depositMethods && depositMethods.blocked)
  );
  const depositApiOnlyCoverage = Boolean(
    (depositInventory &&
      (depositInventory.partial === true || depositInventory.sourceMode === 'api-only')) ||
    (depositMethods &&
      (depositMethods.partial === true || depositMethods.sourceMode === 'api-only'))
  );
  const depositApplicable = kpiThresholds.requireDepositUiWhenApiPresent && depositApiItems > 0;
  pushCheck({
    id: 'deposit-ui-vs-api',
    label: 'Deposit UI coverage present when API has methods',
    actual: depositUiTiles,
    threshold: depositApiItems > 0 ? 1 : 0,
    passed: depositUiTiles > 0,
    applicable: depositApplicable && !depositBlocked,
    detail: `apiItems=${depositApiItems}, uiTiles=${depositUiTiles}, blocked=${depositBlocked}, apiOnly=${depositApiOnlyCoverage}`,
  });

  const depositCoverageApplicable =
    kpiThresholds.requireDepositCoverage && selectedSuiteKeys.has('deposit');
  pushCheck({
    id: 'deposit-methods-discovered',
    label: 'Deposit methods discovered',
    actual: depositApiItems,
    threshold: 1,
    passed: depositApiItems > 0,
    applicable: depositCoverageApplicable,
    detail: `apiItems=${depositApiItems}, uiTiles=${depositUiTiles}, blocked=${depositBlocked}`,
  });

  pushCheck({
    id: 'deposit-not-blocked',
    label: 'Deposit surface is not WAF/auth blocked',
    actual: depositBlocked ? 1 : 0,
    threshold: 0,
    passed: !depositBlocked,
    applicable: depositCoverageApplicable && !wafGraceApplied,
    detail:
      (depositInventory && depositInventory.reason) ||
      (depositMethods && depositMethods.reason) ||
      `blocked=${depositBlocked}`,
  });

  if (process.env.PW_VISUAL_REQUIRED === '1') {
    const visualPhase = phases.visual || {};
    const visualTotal = Number(visualPhase.total || 0);
    const visualFailed = Number(visualPhase.failed || 0);
    const visualBlocked = Number(visualPhase.blockedSignals || 0);

    pushCheck({
      id: 'visual-executed',
      label: 'Visual gate executed',
      actual: visualTotal,
      threshold: 1,
      passed: visualTotal >= 1,
      applicable: true,
      detail: `visualTotal=${visualTotal}`,
    });

    pushCheck({
      id: 'visual-no-failures',
      label: 'Visual gate failed tests',
      actual: visualFailed,
      threshold: 0,
      passed: visualFailed === 0,
      applicable: true,
      detail: `visualFailed=${visualFailed}`,
    });

    pushCheck({
      id: 'visual-no-blocked',
      label: 'Visual gate blocked signals',
      actual: visualBlocked,
      threshold: 0,
      passed: visualBlocked === 0,
      applicable: true,
      detail: `visualBlocked=${visualBlocked}`,
    });
  }

  const failedChecks = checks.filter((item) => item.applicable && !item.passed);
  const waivedChecks = checks.filter((item) => item.waived === true);
  const valid = failedChecks.length === 0;
  const verdict = wafGraceApplied ? 'inconclusive' : valid ? 'passed' : 'failed';
  const payload = {
    generatedAt: new Date().toISOString(),
    thresholds: kpiThresholds,
    totals,
    phases,
    waivers: {
      wafGraceEnabled: kpiWafGraceEnabled,
      wafGraceApplied,
      wafGraceReason,
      precheckCloudflareSignal,
      precheckBlockedSignal,
      providerAllBlockedByChallenge,
      providerAllBlockedByInfra,
      minBlockedRatio: kpiWafGraceMinBlockedRatio,
      minInfraRatio: kpiWafGraceMinInfraRatio,
    },
    valid,
    verdict,
    failedChecks,
    waivedChecks,
    checks,
  };
  writeJson(kpiValidationPath, payload);
  return payload;
}

function evaluateRunFailureClass({ summary, kpi, firstFailedCode }) {
  const totals = (summary && summary.totals) || {};
  const totalFailed = Number(totals.failed || 0);
  const failedInfraBlocked = Number(totals.failedInfraBlockedSignals || 0);
  const failedProductBlocked = Number(totals.failedProductBlockedSignals || 0);
  const failedTestInfraTimeout = Number(totals.failedTestInfraTimeoutSignals || 0);
  const failedUnclassified = Number(totals.failedUnclassifiedSignals || 0);
  const infraOnlyTestFailures =
    totalFailed > 0 &&
    failedInfraBlocked === totalFailed &&
    failedProductBlocked === 0 &&
    failedUnclassified === 0;

  const failedChecks = Array.isArray(kpi && kpi.failedChecks) ? kpi.failedChecks : [];
  const infraOnlyKpiFailures =
    failedChecks.length > 0 &&
    failedChecks.every((item) => infraOnlyKpiCheckIds.has(String(item && item.id ? item.id : '')));
  const testInfraTimeoutRun =
    Number(totals.testInfraTimeoutSignals || 0) > 0 &&
    failedProductBlocked === 0 &&
    failedUnclassified === 0 &&
    failedChecks.every((item) => infraOnlyKpiCheckIds.has(String(item && item.id ? item.id : '')));

  const hasTestExitFailure = Number(firstFailedCode || 0) !== 0;
  const infraBlockedRun =
    (hasTestExitFailure && infraOnlyTestFailures) ||
    (!hasTestExitFailure && !kpi.valid && infraOnlyKpiFailures);

  return {
    totalFailed,
    failedInfraBlocked,
    failedProductBlocked,
    failedTestInfraTimeout,
    testInfraTimeoutSignals: Number(totals.testInfraTimeoutSignals || 0),
    failedUnclassified,
    infraOnlyTestFailures,
    infraOnlyKpiFailures,
    infraBlockedRun,
    testInfraTimeoutRun,
  };
}

function shouldTreatInfraBlockedAsPass() {
  if (Object.prototype.hasOwnProperty.call(process.env, 'PW_INFRA_BLOCK_AS_PASS')) {
    return process.env.PW_INFRA_BLOCK_AS_PASS !== '0';
  }
  return process.env.CI ? false : true;
}

function resolveFinalRunStatus({
  hasSystemFailure,
  hasFailingOutcome,
  infraBlockedRun,
  infraBlockedAsPass,
  testInfraTimeoutRun,
  kpi,
}) {
  if (hasSystemFailure) return 'FAILED';
  const wafGraceApplied = Boolean(kpi && kpi.waivers && kpi.waivers.wafGraceApplied);
  const failedChecks = Array.isArray(kpi && kpi.failedChecks) ? kpi.failedChecks : [];
  const wafSignals = [
    wafGraceApplied,
    kpi && kpi.waivers && kpi.waivers.precheckCloudflareSignal,
    failedChecks.some((item) =>
      /waf|cloudflare|turnstile|captcha|cdn-cgi|__cf_chl|challenge/i.test(
        `${item && item.id ? item.id : ''} ${item && item.detail ? item.detail : ''}`
      )
    ),
  ].some(Boolean);

  if (!hasFailingOutcome && wafSignals) return 'WAF_DEGRADED';
  if (testInfraTimeoutRun && !wafSignals) return 'TEST_INFRA_TIMEOUT';
  if (!hasFailingOutcome) return infraBlockedRun ? 'INFRA_BLOCKED' : 'PASSED';
  if (infraBlockedRun && infraBlockedAsPass) return 'INFRA_BLOCKED';

  // A genuine hard test failure is a failed run. INVALID_RUN is reserved for
  // structurally invalid/KPI-invalid executions, otherwise history disagrees
  // with the HTML/PDF report which correctly shows FAILED.
  return wafSignals ? 'WAF_DEGRADED' : 'FAILED';
}

function hostSlugFromBaseUrl(baseUrl) {
  try {
    const hostname = new URL(String(baseUrl || '')).hostname || '';
    return String(hostname)
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-');
  } catch {
    return '';
  }
}

function fileDescriptor(filePath) {
  const absolute = String(filePath || '').trim();
  if (!absolute) return { path: '', exists: false, bytes: 0 };
  try {
    if (!fs.existsSync(absolute)) return { path: absolute, exists: false, bytes: 0 };
    const stat = fs.statSync(absolute);
    return { path: absolute, exists: true, bytes: Number(stat.size || 0) };
  } catch {
    return { path: absolute, exists: false, bytes: 0 };
  }
}

function collectRunArtifactIndex(baseUrl) {
  const hostSlug = hostSlugFromBaseUrl(baseUrl) || projectPaths.brandSlug;
  const rootReportMd = path.join(projectPaths.projectRoot, 'qa-report.md');
  const rootReportHtml = path.join(projectPaths.projectRoot, 'qa-report.html');
  const rootPdfByHost = path.join(projectPaths.autotestReportDir, `${hostSlug}.pdf`);
  const rootPdfByBrand = path.join(projectPaths.autotestReportDir, `${projectPaths.brandSlug}.pdf`);
  const reportPdf = fs.existsSync(rootPdfByHost) ? rootPdfByHost : rootPdfByBrand;

  return {
    rootReportMd: fileDescriptor(rootReportMd),
    rootReportHtml: fileDescriptor(rootReportHtml),
    reportPdf: fileDescriptor(reportPdf),
    bugsIndexJson: fileDescriptor(path.join(projectPaths.autotestReportDir, 'Bugs', 'index.json')),
    bugsIndexMd: fileDescriptor(path.join(projectPaths.autotestReportDir, 'Bugs', 'index.md')),
    screenshotsManifest: fileDescriptor(
      path.join(projectPaths.autotestReportDir, 'Screenshots', 'manifest.json')
    ),
    providerMatrix: fileDescriptor(providerMatrixArtifactPath),
    depositInventory: fileDescriptor(depositInventoryArtifactPath),
    depositMethods: fileDescriptor(depositMethodArtifactPath),
    authStateHealth: fileDescriptor(authStateHealthPath),
    kpiValidation: fileDescriptor(kpiValidationPath),
  };
}

function captureRunHistory({ baseUrl, runStatus, summary, kpi, authStateHealth, failureClass }) {
  const runSummary = summary || collectRunSummary();
  const phases = runSummary.phases || {};
  const totals = runSummary.totals || {};
  const timestamp = new Date().toISOString();
  const payload = {
    runId: qaRunId,
    timestamp,
    runStatus,
    brandSlug: projectPaths.brandSlug,
    baseUrl,
    nodeVersion: process.version,
    phases,
    totals,
    kpi: kpi || null,
    failureClass: failureClass || null,
    authStateHealth: authStateHealth || readJson(authStateHealthPath) || null,
    artifacts: collectRunArtifactIndex(baseUrl),
  };

  try {
    fs.mkdirSync(runHistoryDir, { recursive: true });
    const stamp = timestamp.replace(/[:.]/g, '-');
    const filePath = path.join(runHistoryDir, `${stamp}--${qaRunId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { filePath, payload };
  } catch {
    return { filePath: '', payload: null };
  }
}

function resetPhaseReports() {
  for (const reportPath of Object.values(phaseReportPaths)) {
    try {
      if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
    } catch {
      // best-effort cleanup
    }
  }
  for (const extraPath of [authStateHealthPath, kpiValidationPath]) {
    try {
      if (fs.existsSync(extraPath)) fs.unlinkSync(extraPath);
    } catch {
      // best-effort cleanup
    }
  }
}

function resetPhaseTestResults() {
  try {
    fs.rmSync(phaseTestResultsDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

function resetCurrentRunReportDir(baseUrl) {
  fs.rmSync(projectPaths.autotestReportDir, { recursive: true, force: true });
  fs.mkdirSync(projectPaths.autotestReportDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectPaths.autotestReportDir, 'run-manifest.json'),
    JSON.stringify(
      {
        runId: qaRunId,
        startedAt: new Date().toISOString(),
        brandSlug: projectPaths.brandSlug,
        baseUrl,
        executionMode: process.env.QA_EXECUTION_MODE || process.env.PW_PROJECT_MATRIX || '',
      },
      null,
      2
    ),
    'utf8'
  );
}

function snapshotPhaseReport(phase) {
  const targetPath = phaseReportPaths[phase];
  if (!targetPath) return;
  try {
    if (!fs.existsSync(reportJsonPath)) return;
    fs.mkdirSync(phaseReportDir, { recursive: true });
    fs.copyFileSync(reportJsonPath, targetPath);
  } catch {
    // best-effort snapshot
  }
}

function snapshotPhaseTestResults(phase) {
  if (!phase) return;
  try {
    if (!fs.existsSync(reportDir)) return;
    const targetDir = path.join(phaseTestResultsDir, phase);
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(reportDir, targetDir, { recursive: true });
  } catch {
    // best-effort snapshot
  }
}

function resetRegistrationChainArtifacts() {
  for (const filePath of registrationChainArtifacts) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // best-effort cleanup
    }
  }
}

async function runSuiteWithRetry({
  tests,
  label,
  phase = '',
  primaryBrowser = 'chromium',
  fallbackBrowser,
  envOverride = {},
  shardArg = '',
}) {
  // A reused native-Chrome context is exposed exclusively through Chromium CDP.
  // Falling back to WebKit/Firefox while that fixture is active makes every
  // subsequent test fail during fixture setup and also poisons browserForNextPhase.
  // Keep the fallback behaviour for isolated Playwright contexts only.
  const effectiveFallbackBrowser =
    process.env.PW_CDP_REUSE_CONTEXT === '1' ? null : fallbackBrowser;
  const shardValue = String(shardArg || '').trim();
  const primaryArgs = buildPlaywrightArgs(tests, { shardArg: shardValue });
  const primaryEnv = {
    ...browserEnv(primaryBrowser),
    PW_PROJECT_MATRIX: suitesProjectMatrix,
  };

  console.log(`\n> npx ${primaryArgs.join(' ')}`);
  const executionPhase = String(phase || label || 'suite');
  let result = await runTrackedPlaywright(
    primaryArgs,
    { ...primaryEnv, ...envOverride },
    { phase: executionPhase, label, browser: primaryBrowser }
  );
  let browserUsed = primaryBrowser;

  if (result.code !== 0 && isCloudflareBlocked(result.output) && effectiveFallbackBrowser) {
    const fallbackArgs = buildPlaywrightArgs(tests, { shardArg: shardValue });
    console.log(
      `\n⚠️  ${label}: Cloudflare/WAF detected on ${primaryBrowser}. Switching to ${effectiveFallbackBrowser}.`
    );
    console.log(`\n> npx ${fallbackArgs.join(' ')}`);
    result = await runTrackedPlaywright(
      fallbackArgs,
      {
        ...browserEnv(effectiveFallbackBrowser),
        PW_PROJECT_MATRIX: suitesProjectMatrix,
        ...envOverride,
      },
      {
        phase: executionPhase,
        label: `${label} [WAF fallback]`,
        browser: effectiveFallbackBrowser,
      }
    );
    browserUsed = effectiveFallbackBrowser;
    return { result, browserUsed };
  }

  let attempt = 1;
  const mobileMatrixRun = isMobileMatrix(suitesProjectMatrix);
  const suiteRetryEnvName =
    executionPhase === 'casino' ? 'PW_CASINO_SUITE_RETRY_MAX' : 'PW_SUITE_RETRY_MAX';
  const configuredRetryMax = Number.parseInt(
    String(envOverride[suiteRetryEnvName] ?? process.env[suiteRetryEnvName] ?? ''),
    10
  );
  // Provider tests already retry individual failed providers. Re-running the
  // complete Casino phase repeats every successful provider and can add hours
  // while hiding the original deterministic catalog failure.
  const defaultRetryMax = executionPhase === 'casino' ? 0 : mobileMatrixRun ? 3 : 2;
  const retryMax = Number.isFinite(configuredRetryMax)
    ? Math.max(0, configuredRetryMax)
    : defaultRetryMax;
  const maxAttempts = 1 + retryMax;
  while (result.code !== 0 && attempt < maxAttempts) {
    const testTimeoutDetected = /Test timeout of \d+ms exceeded/i.test(result.output);
    const shouldRetry =
      crashpadHints.some((re) => re.test(result.output)) ||
      networkTransientHints.some((re) => re.test(result.output)) ||
      testTimeoutDetected ||
      (mobileMatrixRun && timeoutHints.some((re) => re.test(result.output)));
    if (!shouldRetry) break;

    attempt += 1;
    const retryReason = crashpadHints.some((re) => re.test(result.output))
      ? 'crashpad/browser shutdown'
      : networkTransientHints.some((re) => re.test(result.output))
        ? 'transient network error'
        : mobileMatrixRun
          ? 'mobile timeout instability'
          : 'test timeout instability';
    console.log(`\n⚠️  ${label}: Detected ${retryReason}. Retrying (${attempt}/${maxAttempts})...`);
    result = await runTrackedPlaywright(
      primaryArgs,
      { ...primaryEnv, ...envOverride },
      { phase: executionPhase, label: `${label} [retry ${attempt}]`, browser: primaryBrowser }
    );
  }

  if (result.code !== 0 && effectiveFallbackBrowser) {
    const shouldFallback =
      crashpadHints.some((re) => re.test(result.output)) || isCloudflareBlocked(result.output);

    if (shouldFallback) {
      const fallbackArgs = buildPlaywrightArgs(tests, { shardArg: shardValue });
      console.log(
        `\n⚠️  ${label}: ${primaryBrowser} is unstable/blocked. Trying ${effectiveFallbackBrowser} fallback...`
      );
      console.log(`\n> npx ${fallbackArgs.join(' ')}`);
      result = await runTrackedPlaywright(
        fallbackArgs,
        {
          ...browserEnv(effectiveFallbackBrowser),
          PW_PROJECT_MATRIX: suitesProjectMatrix,
          ...envOverride,
        },
        {
          phase: executionPhase,
          label: `${label} [fallback]`,
          browser: effectiveFallbackBrowser,
        }
      );
      browserUsed = effectiveFallbackBrowser;
    }
  }

  return { result, browserUsed };
}

(async () => {
  const baseUrl = process.env.BASE_URL || 'https://gt.bet/';
  let activeBrowser = 'chromium';
  let authStateHealthLatest = null;
  let headedLoginSucceeded = false;
  let preRunStorageStateRefreshAttempted = false;
  let preRunStorageStateRefreshSucceeded = false;
  fs.mkdirSync(projectPaths.projectRoot, { recursive: true });
  fs.mkdirSync(projectPaths.artifactsDir, { recursive: true });
  fs.mkdirSync(projectPaths.testResultsDir, { recursive: true });
  fs.mkdirSync(projectPaths.autotestReportDir, { recursive: true });
  fs.mkdirSync(projectPaths.analyzeDir, { recursive: true });
  if (process.env.QA_REPORT_ONLY !== '1') persistExecutionJournal(false);
  console.log(`\nℹ️  Project workspace: ${projectPaths.projectRoot}`);
  console.log(`ℹ️  Run profile: ${normalizedRunProfile}`);
  if (providersOnlyPhase) {
    console.log('ℹ️  Casino suite is providers-only for this run.');
  }
  console.log(`\nℹ️  Playwright project matrix for ordered suites: ${suitesProjectMatrix}`);
  console.log(`ℹ️  Playwright project matrix for precheck: ${precheckProjectMatrix}`);
  if (process.env.QA_REPORT_ONLY === '1') {
    console.log('\nℹ️  QA report-only mode: recalculating KPI/report from existing artifacts.');
    const summary = collectRunSummary();
    const kpi = evaluateRunKpis(summary);
    if (kpi && kpi.waivers && kpi.waivers.wafGraceApplied) {
      console.log(
        `\nℹ️  KPI WAF grace applied: ${kpi.waivers.wafGraceReason || 'Cloudflare/WAF-dominated run.'}`
      );
    }
    if (kpi.verdict === 'inconclusive') {
      console.log(
        `\n⚠️  KPI validation is inconclusive: ${kpi.waivers.wafGraceReason || 'external blockers dominate the run.'}`
      );
    } else if (!kpi.valid) {
      console.log('\n❌ KPI validation failed. Run is marked invalid.');
      for (const item of kpi.failedChecks || []) {
        console.log(
          `   - ${item.label}: actual=${item.actual}, threshold=${item.threshold}, detail=${item.detail || '-'}`
        );
      }
    } else {
      console.log('\n✅ KPI validation passed.');
    }

    const report = await runNodeScript(path.join('scripts', 'qa-report.js'));
    const artifacts = await runNodeScript(path.join('scripts', 'qa-artifacts.js'));
    const firstFailedCode =
      Number(summary && summary.totals && summary.totals.failed ? summary.totals.failed : 0) > 0
        ? 1
        : 0;
    const failureClass = evaluateRunFailureClass({
      summary,
      kpi,
      firstFailedCode,
    });
    const infraBlockedAsPass = shouldTreatInfraBlockedAsPass();
    const hasSystemFailure = Number(report.code || 0) !== 0 || Number(artifacts.code || 0) !== 0;
    const hasFailingOutcome = Number(firstFailedCode || 0) !== 0 || !kpi.valid;
    const infraBlockedRun = failureClass.infraBlockedRun && !hasSystemFailure && hasFailingOutcome;
    const runStatus = resolveFinalRunStatus({
      hasSystemFailure,
      hasFailingOutcome,
      infraBlockedRun,
      infraBlockedAsPass,
      testInfraTimeoutRun: failureClass.testInfraTimeoutRun,
      kpi,
    });
    const history = captureRunHistory({
      baseUrl,
      runStatus,
      summary,
      kpi,
      failureClass,
      authStateHealth: readJson(authStateHealthPath) || null,
    });
    if (history && history.filePath) {
      console.log(`\nℹ️  Run history saved: ${history.filePath}`);
      const logIndex = await runNodeScript(path.join('scripts', 'qa-log-index.js'), [
        `--run=${history.filePath}`,
      ]);
      if (logIndex.code !== 0) {
        console.log('\n⚠️  Log index update failed, continuing with run exit status.');
      }
    }
    const dashboard = await runNodeScript(path.join('scripts', 'qa-trends-dashboard.js'));
    if (dashboard.code !== 0) {
      console.log('\n⚠️  Dashboard generation failed, continuing with run exit status.');
    }

    if (report.code !== 0) process.exit(report.code);
    if (artifacts.code !== 0) process.exit(artifacts.code);
    if (!kpi.valid && !(infraBlockedRun && infraBlockedAsPass)) process.exit(2);
    process.exit(0);
  }
  cleanupStaleBrowserProcesses();
  if (runDoctorPreflight) {
    console.log('\n> node scripts/qa-doctor.js --preflight');
    const doctor = await runNodeScript(path.join('scripts', 'qa-doctor.js'), ['--preflight']);
    if (doctor.code !== 0) {
      console.log('\n❌ QA Doctor preflight failed. Aborting qa:all before test execution.');
      process.exit(doctor.code);
    }
  } else {
    console.log('\nℹ️  QA Doctor preflight skipped by QA_PREFLIGHT_DOCTOR=0.');
  }
  resetCurrentRunReportDir(baseUrl);
  resetPhaseReports();
  resetPhaseTestResults();

  if (requireHeadedLoginBeforeRun && !process.env.CI) {
    if (process.stdin.isTTY) {
      const warmupLabel =
        forceSaveStateWarmupRoutes.length > 0 ? forceSaveStateWarmupRoutes.join(', ') : '(none)';
      console.log(
        `\n⚠️  Headed pre-login is required. Complete login/challenge manually in opened browser (warmup: ${warmupLabel}).`
      );
      const headedLoginCode = await runSaveState(baseUrl, {
        warmupRoutes: forceSaveStateWarmupRoutes,
        warmupStrict: false,
        manual: true,
        phase: 'precheck-bootstrap',
        trigger: 'headed-login',
      });
      if (headedLoginCode === 0) {
        headedLoginSucceeded = true;
        console.log('\n✅ Headed pre-login storageState refresh completed.');
      } else {
        const message = '\n⚠️  Headed pre-login storageState refresh failed.';
        if (requireHeadedLoginStrict) {
          console.log(`${message} PW_REQUIRE_HEADED_LOGIN_STRICT=1, aborting run.`);
          process.exit(headedLoginCode || 1);
        }
        console.log(`${message} Continuing with current session artifacts.`);
      }
    } else {
      const message =
        '\n⚠️  PW_REQUIRE_HEADED_LOGIN_BEFORE_RUN=1, but stdin is not interactive (TTY missing).';
      if (requireHeadedLoginStrict) {
        console.log(`${message} PW_REQUIRE_HEADED_LOGIN_STRICT=1, aborting run.`);
        process.exit(1);
      }
      console.log(`${message} Falling back to automatic storageState refresh.`);
    }
  }

  if (autoSaveState && !process.env.CI && forceSaveStateBeforeRun) {
    if (headedLoginSucceeded) {
      console.log(
        '\nℹ️  Skipping automatic pre-run refresh because headed pre-login already produced a fresh state.'
      );
    } else {
      const warmupLabel =
        forceSaveStateWarmupRoutes.length > 0 ? forceSaveStateWarmupRoutes.join(', ') : '(none)';
      console.log(
        `\n⚠️  Pre-run Cloudflare prep: refreshing storageState before precheck (warmup: ${warmupLabel}).`
      );
      preRunStorageStateRefreshAttempted = true;
      const startupSaveStateCode = await runSaveState(baseUrl, {
        warmupRoutes: forceSaveStateWarmupRoutes,
        warmupStrict: false,
        phase: 'precheck-bootstrap',
        trigger: 'pre-run-waf-prep',
      });
      if (startupSaveStateCode === 0) {
        preRunStorageStateRefreshSucceeded = true;
        console.log('\n✅ Pre-run storageState refresh completed.');
      } else {
        console.log(
          '\n⚠️  Pre-run storageState refresh failed; continuing with current session artifacts.'
        );
      }
    }
  }

  authStateHealthLatest = await ensureAuthStateHealth({
    baseUrl,
    phase: 'precheck-bootstrap',
    allowRefresh: !preRunStorageStateRefreshAttempted || preRunStorageStateRefreshSucceeded,
  });

  const precheckArgs = buildPlaywrightArgs(precheckTests);
  console.log(`\n> npx ${precheckArgs.join(' ')}`);
  let precheck = await runTrackedPlaywright(
    precheckArgs,
    {
      ...browserEnv('chromium'),
      PW_PROJECT_MATRIX: precheckProjectMatrix,
    },
    { phase: 'precheck', label: 'Precheck', browser: 'chromium' }
  );

  if (precheck.code !== 0 && isCloudflareBlocked(precheck.output)) {
    if (autoSaveState && !process.env.CI) {
      console.log('\n⚠️  Precheck blocked by Cloudflare/WAF. Attempting storageState refresh...');
      const saveStateCode = await runSaveState(baseUrl, {
        phase: 'precheck',
        trigger: 'precheck-waf-recovery',
        wafSignal: true,
      });
      if (saveStateCode === 0) {
        console.log(`\n> npx ${precheckArgs.join(' ')}`);
        precheck = await runTrackedPlaywright(
          precheckArgs,
          {
            ...browserEnv('chromium'),
            PW_PROJECT_MATRIX: precheckProjectMatrix,
          },
          { phase: 'precheck', label: 'Precheck [storage refresh]', browser: 'chromium' }
        );
        if (precheck.code === 0) {
          activeBrowser = 'chromium';
          console.log('\n✅ Precheck passed on Chromium after storageState refresh.');
        }
      } else {
        console.log('\n⚠️  storageState refresh failed.');
      }
    } else if (autoSaveState && process.env.CI) {
      console.log('\n⚠️  Precheck blocked and CI mode is enabled. Skipping storageState refresh.');
    }

    if (precheck.code !== 0 && preferWebkitOnCloudflare) {
      const webkitPrecheckArgs = buildPlaywrightArgs(precheckTests);
      console.log(
        '\n⚠️  Chromium precheck still blocked after storage refresh. Trying WebKit precheck...'
      );
      console.log(`\n> npx ${webkitPrecheckArgs.join(' ')}`);
      const webkitPrecheck = await runTrackedPlaywright(
        webkitPrecheckArgs,
        {
          ...browserEnv('webkit'),
          PW_PROJECT_MATRIX: precheckProjectMatrix,
        },
        { phase: 'precheck', label: 'Precheck [WebKit fallback]', browser: 'webkit' }
      );
      if (webkitPrecheck.code === 0) {
        precheck = webkitPrecheck;
        activeBrowser = 'webkit';
        console.log('\n✅ Precheck passed on WebKit. Ordered suites will run on WebKit first.');
      }
    }
  }
  snapshotPhaseReport('precheck');
  snapshotPhaseTestResults('precheck');

  if (precheck.code !== 0 && !softPrecheck) {
    console.log('\n❌ Precheck failed. Skipping full suite.');
    const summary = collectRunSummary();
    const kpi = evaluateRunKpis(summary);
    if (!kpi.valid) {
      console.log('\n❌ KPI validation failed at precheck.');
      for (const item of kpi.failedChecks || []) {
        console.log(
          `   - ${item.label}: actual=${item.actual}, threshold=${item.threshold}, detail=${item.detail || '-'}`
        );
      }
    }
    persistExecutionJournal(true);
    const report = await runNodeScript(path.join('scripts', 'qa-report.js'));
    const artifacts = await runNodeScript(path.join('scripts', 'qa-artifacts.js'));
    if (report.code !== 0) process.exit(report.code);
    if (artifacts.code !== 0) process.exit(artifacts.code);
    process.exit(precheck.code);
  }

  if (precheck.code !== 0 && softPrecheck) {
    console.log('\n⚠️  Precheck failed, but continuing because PW_PRECHECK_SOFT=1.');
  }
  const softPrecheckFailed = precheck.code !== 0 && softPrecheck;

  if (useAiGeneration) {
    console.log('\n> node analyze/runAll.js');
    const ai = await runNodeScript(path.join('analyze', 'runAll.js'));
    if (ai.code !== 0) {
      const message = '\n⚠️  AI generation pipeline failed.';
      if (aiRequired) {
        console.log(`${message} PW_AI_REQUIRED=1, aborting run.`);
        process.exit(ai.code);
      }
      console.log(`${message} Continuing without blocking suites.`);
    }
  } else {
    console.log('\nℹ️  AI generation skipped by default. Set PW_USE_AI_GENERATION=1 to enable it.');
  }

  let firstFailedCode = 0;
  let browserForNextPhase = activeBrowser;
  let providerCasinoRecoveryNeeded = false;
  let suiteRefreshCount = 0;
  let suiteRefreshLastAt = 0;
  const mobileMatrixRun = isMobileMatrix(suitesProjectMatrix);
  let skipOrderedSuites = false;

  if (strictValidRun) {
    const guard = await runWafGuard({
      label: 'pre-suite',
      baseUrl,
      routes: ['/', '/casino/'],
      depositApi: true,
      browser: browserForNextPhase,
    });
    if (guard.code !== 0) {
      firstFailedCode = guard.code || 2;
      console.log(`\n❌ Strict WAF guard failed before ordered suites. Artifact: ${guard.outPath}`);
      if (abortOnWafGuard) {
        skipOrderedSuites = true;
        console.log(
          '\nℹ️  Ordered suites will be skipped because PW_ABORT_ON_WAF_GUARD is enabled.'
        );
      }
    }
  }

  if (mobileMatrixRun && precheck.code !== 0 && isCloudflareBlocked(precheck.output || '')) {
    providerCasinoRecoveryNeeded = true;
    console.log(
      '\n⚠️  Mobile precheck is Cloudflare-blocked. Will refresh storageState on casino routes before provider checks.'
    );
  }

  const orderedSuitesToRun = skipOrderedSuites ? [] : selectedOrderedSuites;

  if (orderedSuitesToRun.length === 0) {
    console.log(
      '\n⚠️  No ordered suites selected (check PW_SUITES_ONLY/PW_SUITES_SKIP). Continuing with report generation.'
    );
  }

  for (const [suiteIndex, suite] of orderedSuitesToRun.entries()) {
    const suiteKey = String(suite && suite.key ? suite.key : '')
      .trim()
      .toLowerCase();
    const hasDownstreamSuites = suiteIndex < orderedSuitesToRun.length - 1;
    const suiteRefreshAllowed = suiteRefreshPhases.has(suiteKey);
    let suiteRefreshedInThisCycle = false;

    if (suite.key === 'registration') {
      resetRegistrationChainArtifacts();
    }

    const suiteEnv = { ...(suite.env || {}) };
    if (strictValidRun && suite.key === 'deposit') {
      const guard = await runWafGuard({
        label: 'before-deposit',
        baseUrl,
        routes: ['/'],
        depositApi: true,
        browser: browserForNextPhase,
      });
      if (guard.code !== 0) {
        firstFailedCode = firstFailedCode || guard.code || 2;
        console.log(
          `\n❌ Deposit guard failed; skipping deposit suite because coverage would be invalid. Artifact: ${guard.outPath}`
        );
        continue;
      }
    }

    if (suite.key === 'casino') {
      if (strictValidRun) {
        const guard = await runWafGuard({
          label: 'before-casino',
          baseUrl,
          routes: ['/casino/'],
          depositApi: false,
          browser: browserForNextPhase,
        });
        if (guard.code !== 0) {
          firstFailedCode = firstFailedCode || guard.code || 2;
          console.log(
            `\n❌ Casino guard failed; skipping provider matrix because coverage would be invalid. Artifact: ${guard.outPath}`
          );
          continue;
        }
      }

      suiteEnv.PW_PROVIDER_FAST_FAIL_ON_UI_BLOCKED =
        suiteEnv.PW_PROVIDER_FAST_FAIL_ON_UI_BLOCKED ||
        process.env.PW_PROVIDER_FAST_FAIL_ON_UI_BLOCKED ||
        '0';
      suiteEnv.PW_PROVIDER_REQUIRE_HISTORY_MATCH =
        suiteEnv.PW_PROVIDER_REQUIRE_HISTORY_MATCH || '1';
      if (mobileMatrixRun) {
        suiteEnv.PW_CHALLENGE_SETTLE_TIMEOUT = suiteEnv.PW_CHALLENGE_SETTLE_TIMEOUT || '20000';
        suiteEnv.PW_CASINO_OPEN_RETRIES = suiteEnv.PW_CASINO_OPEN_RETRIES || '4';
      }

      authStateHealthLatest = await ensureAuthStateHealth({
        baseUrl,
        phase: 'before-casino-suite',
        requireAuth: true,
      });
      if (!authStateHealthLatest.healthy) {
        providerCasinoRecoveryNeeded = true;
        suiteEnv.PW_PROVIDER_FAST_FAIL_ON_UI_BLOCKED = '1';
        console.log(
          '\n⚠️  Auth state is not healthy before casino suite; enabling provider fast-fail and forcing casino route recovery refresh.'
        );
      }

      if (autoSaveState && !process.env.CI && providerCasinoRecoveryNeeded) {
        console.log(
          `\n⚠️  Casino suite pre-recovery: refreshing storageState with ${recoveryWarmupRoutesForSuite(
            suite.key
          ).join(', ')} warmup.`
        );
        const recoveryCode = await runSaveState(baseUrl, {
          warmupRoutes: recoveryWarmupRoutesForSuite(suite.key),
          warmupStrict: false,
          phase: suite.key,
          trigger: 'casino-pre-recovery',
        });
        if (recoveryCode === 0) {
          suiteRefreshCount += 1;
          suiteRefreshLastAt = Date.now();
          suiteRefreshedInThisCycle = true;
          console.log('\n✅ Casino pre-recovery storageState refresh completed.');
        } else {
          console.log('\n⚠️  Casino pre-recovery storageState refresh failed; continuing run.');
        }
      }
    }

    const suiteShardArg = resolveSuiteShardArg(suite.key);
    if (suiteShardArg) {
      console.log(`\nℹ️  ${suite.label}: using shard ${suiteShardArg}.`);
    }

    let run = await runSuiteWithRetry({
      tests: suite.tests,
      label: suite.label,
      phase: suite.key,
      primaryBrowser: browserForNextPhase,
      fallbackBrowser:
        browserForNextPhase === 'chromium' && preferWebkitOnCloudflare ? 'webkit' : null,
      envOverride: suiteEnv,
      shardArg: suiteShardArg,
    });
    snapshotPhaseReport(suite.key);
    snapshotPhaseTestResults(suite.key);
    browserForNextPhase = run.browserUsed || browserForNextPhase;

    let suiteFailed = Number(run && run.result ? run.result.code || 0 : 0) !== 0;
    let suiteCloudflareBlocked = suiteFailed && phaseFailedTestsHaveCloudflareSignal(suite.key);
    if (mobileMatrixRun && suite.key === 'auth' && suiteFailed && suiteCloudflareBlocked) {
      providerCasinoRecoveryNeeded = true;
      console.log(
        '\n⚠️  Auth phase is Cloudflare/WAF-blocked on mobile. Casino routes will be refreshed before provider checks.'
      );
    }

    if (
      suiteCloudflareBlocked &&
      suiteFailed &&
      challengeRerunMax > 0 &&
      challengeRerunPhases.has(suiteKey) &&
      autoSaveState &&
      !process.env.CI &&
      suite.key !== 'registration'
    ) {
      const warmupRoutes = recoveryWarmupRoutesForSuite(suite.key);

      for (let attempt = 1; attempt <= challengeRerunMax; attempt += 1) {
        if (!suiteCloudflareBlocked) break;
        console.log(
          `\n⚠️  ${suite.label}: challenge-aware rerun ${attempt}/${challengeRerunMax} (refresh + retry).`
        );
        const refreshCode = await runSaveState(baseUrl, {
          warmupRoutes,
          warmupStrict: false,
          phase: suite.key,
          trigger: 'challenge-rerun',
          wafSignal: true,
        });
        if (refreshCode !== 0) {
          console.log('\n⚠️  Challenge-aware refresh failed; retrying with current state.');
        } else {
          suiteRefreshCount += 1;
          suiteRefreshLastAt = Date.now();
          suiteRefreshedInThisCycle = true;
        }

        if (challengeRerunBackoffMs > 0) {
          await sleep(challengeRerunBackoffMs * attempt);
        }

        run = await runSuiteWithRetry({
          tests: suite.tests,
          label: `${suite.label} [challenge-rerun ${attempt}/${challengeRerunMax}]`,
          phase: suite.key,
          primaryBrowser: browserForNextPhase,
          fallbackBrowser:
            browserForNextPhase === 'chromium' && preferWebkitOnCloudflare ? 'webkit' : null,
          envOverride: suiteEnv,
          shardArg: suiteShardArg,
        });
        snapshotPhaseReport(suite.key);
        snapshotPhaseTestResults(suite.key);
        browserForNextPhase = run.browserUsed || browserForNextPhase;
        suiteFailed = Number(run && run.result ? run.result.code || 0 : 0) !== 0;
        suiteCloudflareBlocked = suiteFailed && phaseFailedTestsHaveCloudflareSignal(suite.key);
      }
    }

    if (
      mobileMatrixRun &&
      mobileStabilizeRerun &&
      challengeRerunMax === 0 &&
      suiteCloudflareBlocked &&
      suiteFailed &&
      autoSaveState &&
      !process.env.CI &&
      suite.key !== 'registration'
    ) {
      const warmupRoutes = recoveryWarmupRoutesForSuite(suite.key);
      console.log(
        `\n⚠️  ${suite.label}: mobile stabilization rerun after Cloudflare/WAF signal (refresh + one rerun).`
      );
      const stabilizerCode = await runSaveState(baseUrl, {
        warmupRoutes,
        warmupStrict: false,
        phase: suite.key,
        trigger: 'mobile-waf-stabilization',
        wafSignal: true,
      });
      if (stabilizerCode === 0) {
        suiteRefreshCount += 1;
        suiteRefreshLastAt = Date.now();
        suiteRefreshedInThisCycle = true;
        run = await runSuiteWithRetry({
          tests: suite.tests,
          label: `${suite.label} [mobile-stabilize-rerun]`,
          phase: suite.key,
          primaryBrowser: browserForNextPhase,
          fallbackBrowser:
            browserForNextPhase === 'chromium' && preferWebkitOnCloudflare ? 'webkit' : null,
          envOverride: suiteEnv,
          shardArg: suiteShardArg,
        });
        snapshotPhaseReport(suite.key);
        snapshotPhaseTestResults(suite.key);
        browserForNextPhase = run.browserUsed || browserForNextPhase;
        suiteFailed = Number(run && run.result ? run.result.code || 0 : 0) !== 0;
        suiteCloudflareBlocked = suiteFailed && phaseFailedTestsHaveCloudflareSignal(suite.key);
      } else {
        console.log('\n⚠️  Mobile stabilization storageState refresh failed; keeping initial run.');
      }
    }

    if (
      suiteCloudflareBlocked &&
      suiteFailed &&
      autoSaveState &&
      !process.env.CI &&
      suite.key !== 'registration' &&
      hasDownstreamSuites &&
      suiteRefreshAllowed
    ) {
      const nowMs = Date.now();
      const cooldownLeftMs = Math.max(0, suiteRefreshCooldownMs - (nowMs - suiteRefreshLastAt));
      if (suiteRefreshedInThisCycle) {
        console.log(
          `\nℹ️  ${suite.label}: downstream refresh skipped (already refreshed in this suite cycle).`
        );
      } else if (suiteRefreshCount >= suiteRefreshMax) {
        console.log(
          `\nℹ️  ${suite.label}: downstream refresh skipped (refresh limit reached: ${suiteRefreshCount}/${suiteRefreshMax}).`
        );
      } else if (cooldownLeftMs > 0) {
        console.log(
          `\nℹ️  ${suite.label}: downstream refresh skipped by cooldown (${Math.ceil(
            cooldownLeftMs / 1000
          )}s left).`
        );
      } else {
        const warmupRoutes = downstreamRefreshWarmupRoutesForSuite(suite.key);
        console.log(
          `\n⚠️  ${suite.label}: Cloudflare/WAF signal detected. Refreshing storageState for downstream phases...`
        );
        const saveStateCode = await runSaveState(baseUrl, {
          warmupRoutes,
          warmupStrict: false,
          phase: suite.key,
          trigger: 'downstream-waf-refresh',
          wafSignal: true,
        });
        if (saveStateCode === 0) {
          suiteRefreshCount += 1;
          suiteRefreshLastAt = Date.now();
          console.log('\n✅ storageState refreshed successfully.');
        } else {
          console.log(
            '\n⚠️  storageState refresh failed; continuing with current session artifacts.'
          );
        }
      }
    }

    if (!firstFailedCode && run.result.code !== 0) {
      firstFailedCode = run.result.code;
    }
  }

  let destructiveResult = { code: 0 };
  if (!firstFailedCode && includeDestructive) {
    const destructive = await runSuiteWithRetry({
      tests: destructiveTests,
      label: 'Destructive suite',
      phase: 'destructive',
      primaryBrowser: browserForNextPhase,
      fallbackBrowser:
        browserForNextPhase === 'chromium' && preferWebkitOnCloudflare ? 'webkit' : null,
    });
    destructiveResult = destructive.result;
    snapshotPhaseReport('destructive');
    snapshotPhaseTestResults('destructive');
  } else if (!includeDestructive) {
    console.log('\nℹ️  Destructive suite skipped. Set PW_INCLUDE_DESTRUCTIVE=1 to run it.');
  }

  const summary = collectRunSummary();
  const kpi = evaluateRunKpis(summary);
  if (kpi && kpi.waivers && kpi.waivers.wafGraceApplied) {
    console.log(
      `\nℹ️  KPI WAF grace applied: ${kpi.waivers.wafGraceReason || 'Cloudflare/WAF-dominated run.'}`
    );
  }
  if (kpi.verdict === 'inconclusive') {
    console.log(
      `\n⚠️  KPI validation is inconclusive: ${kpi.waivers.wafGraceReason || 'external blockers dominate the run.'}`
    );
  } else if (!kpi.valid) {
    console.log('\n❌ KPI validation failed. Run is marked invalid.');
    for (const item of kpi.failedChecks || []) {
      console.log(
        `   - ${item.label}: actual=${item.actual}, threshold=${item.threshold}, detail=${item.detail || '-'}`
      );
    }
  } else {
    console.log('\n✅ KPI validation passed.');
  }

  persistExecutionJournal(true);
  const report = await runNodeScript(path.join('scripts', 'qa-report.js'), [], {
    QA_SOFT_PRECHECK_FAILED: softPrecheckFailed ? '1' : '0',
    QA_SOFT_PRECHECK_MODE: softPrecheck ? '1' : '0',
  });
  const artifacts = await runNodeScript(path.join('scripts', 'qa-artifacts.js'));
  const failureClass = evaluateRunFailureClass({
    summary,
    kpi,
    firstFailedCode,
  });
  const infraBlockedAsPass = shouldTreatInfraBlockedAsPass();
  const hasSystemFailure =
    Number(destructiveResult.code || 0) !== 0 ||
    Number(report.code || 0) !== 0 ||
    Number(artifacts.code || 0) !== 0;
  const hasFailingOutcome = Number(firstFailedCode || 0) !== 0 || !kpi.valid;
  const infraBlockedRun = failureClass.infraBlockedRun && !hasSystemFailure && hasFailingOutcome;

  if (infraBlockedRun) {
    console.log(
      `\nℹ️  Infra-blocked run classification: failed=${failureClass.totalFailed}, infra-failed=${failureClass.failedInfraBlocked}, product-failed=${failureClass.failedProductBlocked}, unclassified-failed=${failureClass.failedUnclassified}.`
    );
    if (infraBlockedAsPass) {
      console.log(
        '\nℹ️  PW_INFRA_BLOCK_AS_PASS enabled: infra-only failures are treated as non-fatal.'
      );
    }
  }

  const runStatus = resolveFinalRunStatus({
    hasSystemFailure,
    hasFailingOutcome,
    infraBlockedRun,
    infraBlockedAsPass,
    testInfraTimeoutRun: failureClass.testInfraTimeoutRun,
    kpi,
  });
  const history = captureRunHistory({
    baseUrl,
    runStatus,
    summary,
    kpi,
    failureClass,
    authStateHealth: authStateHealthLatest,
  });
  const historyPath = history && history.filePath ? history.filePath : '';
  if (historyPath) {
    console.log(`\nℹ️  Run history saved: ${historyPath}`);
    const logIndexArgs = [`--run=${historyPath}`];
    if (process.env.LOKI_PUSH === '1') {
      logIndexArgs.push('--push=1');
    }
    const logIndex = await runNodeScript(path.join('scripts', 'qa-log-index.js'), logIndexArgs);
    if (logIndex.code !== 0) {
      console.log('\n⚠️  Log index update failed, continuing with run exit status.');
    }

    const bugFilingArgs = [`--run=${historyPath}`];
    if (process.env.QA_BUG_AUTOFILING === '1') bugFilingArgs.push('--push=1');
    const bugFiling = await runNodeScript(path.join('scripts', 'qa-bug-filing.js'), bugFilingArgs);
    if (bugFiling.code !== 0) {
      console.log('\n⚠️  Bug filing export failed, continuing with run exit status.');
    }
  }
  const dashboard = await runNodeScript(path.join('scripts', 'qa-trends-dashboard.js'));
  if (dashboard.code !== 0) {
    console.log('\n⚠️  Dashboard generation failed, continuing with run exit status.');
  }

  if (firstFailedCode !== 0 && !(infraBlockedRun && infraBlockedAsPass))
    process.exit(firstFailedCode);
  if (destructiveResult.code !== 0) process.exit(destructiveResult.code);
  if (report.code !== 0) process.exit(report.code);
  if (artifacts.code !== 0) process.exit(artifacts.code);
  if (!kpi.valid && !(infraBlockedRun && infraBlockedAsPass)) process.exit(2);
})();
