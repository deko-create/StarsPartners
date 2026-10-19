const { test, expect } = require('../fixtures/qa-test');
const fs = require('fs');
const path = require('path');
const {
  assertNotCloudflare,
  createWafProbe,
  detectCloudflare,
  dismissOverlays,
  markBlocked,
  maybeSkipWaf,
  openLoginModal,
  waitForUiSettled,
} = require('../helpers/gt-utils');
const { applyAuthTokenCookie } = require('../helpers/signup-api-fallback');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
const PROJECT_TEST_RESULTS_DIR =
  process.env.QA_TEST_RESULTS_DIR || path.join(process.cwd(), 'test-results');
const STABLE_PLAYER_PATH = path.join(PROJECT_ARTIFACTS_DIR, 'last-registered-player.json');
const CURRENT_RUN_PLAYER_PATH = path.join(
  PROJECT_ARTIFACTS_DIR,
  'registration-data-current-run.json'
);
const VOLATILE_PLAYER_PATH = path.join(PROJECT_TEST_RESULTS_DIR, 'registration-data.json');
const MANUAL_READY_PLAYER_PATH = path.join(PROJECT_ARTIFACTS_DIR, 'last-manual-login-player.json');
const MODE_PROJECT_ROOT = path.dirname(PROJECT_ARTIFACTS_DIR);
const BRAND_PROJECT_ROOT = ['desktop', 'mobile'].includes(path.basename(MODE_PROJECT_ROOT))
  ? path.dirname(MODE_PROJECT_ROOT)
  : MODE_PROJECT_ROOT;
const BRAND_ARTIFACTS_DIR = path.join(BRAND_PROJECT_ROOT, 'artifacts');
const LOCAL_PLAYER_ARTIFACT_PATHS = [
  CURRENT_RUN_PLAYER_PATH,
  STABLE_PLAYER_PATH,
  MANUAL_READY_PLAYER_PATH,
  path.join(BRAND_ARTIFACTS_DIR, 'registration-data-current-run.json'),
  path.join(BRAND_ARTIFACTS_DIR, 'last-registered-player.json'),
  path.join(BRAND_ARTIFACTS_DIR, 'last-manual-login-player.json'),
].filter((candidate, index, all) => all.indexOf(candidate) === index);
const AUTH_STATE_OUTPUT_PATHS = [
  path.join(PROJECT_ARTIFACTS_DIR, 'registration-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'profile-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'site-coverage-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'button-sweep-auth-state.json'),
];
const PLAYER_ARTIFACT_PATHS = [...LOCAL_PLAYER_ARTIFACT_PATHS, VOLATILE_PLAYER_PATH];
const REQUIRE_REGISTERED_LOGIN = process.env.PW_LOGIN_REQUIRE_REGISTERED === '1';
const USE_ENV_LOGIN_FIRST = process.env.PW_LOGIN_USE_ENV === '1';
// Cross-brand credentials are unsafe: a token issued by chacha.bet, for example,
// must never be persisted as a supposedly authorized gt.bet session.
const ALLOW_SHARED_PLAYER_FALLBACK = process.env.PW_LOGIN_ALLOW_SHARED_PLAYER === '1';
const CURRENT_PROJECT_ROOT = process.env.QA_PROJECT_ROOT
  ? path.resolve(String(process.env.QA_PROJECT_ROOT))
  : '';
const PROJECTS_ROOT_DIR = path.join(process.cwd(), 'projects');
const LOGIN_MANUAL_CAPTCHA_WAIT_MS = Number.parseInt(
  process.env.PW_LOGIN_MANUAL_CAPTCHA_WAIT || '0',
  10
);
const SIGNIN_ROUTE_RE = /\/api\/auth\/signin(?:\?|$)/i;
const MOBILE_TURNSTILE_PRE_SUBMIT_WAIT_MS = 10_000;
const MOBILE_TURNSTILE_SUBMIT_ENABLE_WAIT_MS = 7_000;
const MOBILE_AUTH_SUCCESS_WAIT_MS = 10_000;
const MOBILE_TURNSTILE_RETRY_WAIT_MS = 7_000;
const MOBILE_AUTH_RETRY_WAIT_MS = 8_000;
const MOBILE_MAX_TURNSTILE_RETRIES = 1;
const MOBILE_FALLBACK_GOTO_TIMEOUT_MS = 12_000;
const MOBILE_MANUAL_CAPTCHA_WAIT_CAP_MS = 20_000;
const LOGIN_SHORT_VISIBILITY_TIMEOUT_MS = 500;

function maskValue(value, keep = 2) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= keep) return '*'.repeat(text.length);
  return `${text.slice(0, keep)}${'*'.repeat(text.length - keep)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, timeoutMs = 20000, stepMs = 200) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return true;
    await sleep(stepMs);
  }
  return false;
}

async function fillFirstVisible(container, selectors, value) {
  for (const selector of selectors) {
    const input = container.locator(selector).first();
    try {
      if (await input.isVisible({ timeout: LOGIN_SHORT_VISIBILITY_TIMEOUT_MS })) {
        await input.fill(value);
        return true;
      }
    } catch {
      // try next selector
    }
  }
  return false;
}

async function resolveVisibleAuthContainer(page, fallbackContainer = null) {
  const candidates = [
    '.t-login-modal:visible',
    '[data-testid="login-modal"]:visible',
    '.t-login:visible',
    '.t-signup-modal:visible',
    '[data-testid="signup-modal"]:visible',
    '.t-signup:visible',
    '[role="dialog"]:visible',
  ];

  for (const selector of candidates) {
    const container = page.locator(selector).first();
    if (await container.isVisible({ timeout: 400 }).catch(() => false)) {
      return container;
    }
  }

  return fallbackContainer;
}

async function switchToLoginView(page, currentContainer) {
  const selectors = [
    'button:has-text("Have an Account? Log In")',
    'button:has-text("Have an account? Log in")',
    'button:has-text("Already have an account?")',
    'button:has-text("LOG IN")',
    'button:has-text("Log In")',
    'a:has-text("Log In")',
    '[data-testid*="login" i]',
  ];
  const scopes = [currentContainer, page];

  for (const scope of scopes) {
    if (!scope || typeof scope.locator !== 'function') continue;
    for (const selector of selectors) {
      const btn = scope.locator(selector).first();
      if (!(await btn.isVisible({ timeout: 400 }).catch(() => false))) continue;
      await btn.click({ timeout: 5000 }).catch(() => null);
      await waitForUiSettled(page, 900).catch(() => null);
      const nextContainer = await resolveVisibleAuthContainer(page, currentContainer);
      if (nextContainer) return nextContainer;
    }
  }

  return currentContainer;
}

async function findActionButton(container, selectors) {
  for (const selector of selectors) {
    const btn = container.locator(selector).first();
    try {
      if (await btn.isVisible({ timeout: LOGIN_SHORT_VISIBILITY_TIMEOUT_MS })) {
        return btn;
      }
    } catch {
      // try next selector
    }
  }
  return null;
}

async function readVisibleEmailValue(container) {
  const selectors = [
    'input[type="email"]',
    'input[name*="email" i]',
    'input[placeholder*="Email" i]',
    'input:visible:not([type="password"])',
  ];
  for (const selector of selectors) {
    const input = container.locator(selector).first();
    try {
      if (await input.isVisible({ timeout: 300 })) {
        return await input.inputValue().catch(() => '');
      }
    } catch {
      // try next selector
    }
  }
  return '';
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

async function installSigninEmailPatch(page, email, testInfo) {
  const expectedEmail = normalizeEmail(email);
  if (!expectedEmail || !expectedEmail.includes('+')) {
    return { enabled: false, expectedEmail: '', expectedEmailNoPlus: '', handler: null };
  }

  const expectedEmailNoPlus = expectedEmail.replace(/\+/g, '');
  const handler = async (route, request) => {
    try {
      if (request.method() !== 'POST') {
        await route.continue();
        return;
      }
      const postData = request.postData();
      if (!postData) {
        await route.continue();
        return;
      }

      const parsed = JSON.parse(postData);
      if (!parsed || typeof parsed !== 'object') {
        await route.continue();
        return;
      }
      const sentEmail = normalizeEmail(parsed.email);
      if (!sentEmail || sentEmail === expectedEmail || sentEmail !== expectedEmailNoPlus) {
        await route.continue();
        return;
      }

      parsed.email = expectedEmail;
      testInfo.annotations.push({
        type: 'login',
        description: `Sign-in payload email patched: ${sentEmail} -> ${expectedEmail}.`,
      });
      await route.continue({
        postData: JSON.stringify(parsed),
      });
    } catch {
      await route.continue();
    }
  };

  await page.route(SIGNIN_ROUTE_RE, handler);
  testInfo.annotations.push({
    type: 'login',
    description: `Sign-in email patch enabled for plus-address: ${expectedEmail}.`,
  });
  return { enabled: true, expectedEmail, expectedEmailNoPlus, handler };
}

function isAuthLikeResponse(url, method) {
  if (method !== 'POST') return false;
  const authNamespace = /\/api\/(auth|user|account|session)\//i.test(url);
  const loginIntent = /(sign-?in|log-?in|signin|login|token|session|otp|code)/i.test(url);
  return authNamespace && loginIntent;
}

function getCredsFromStableArtifact() {
  const candidates = [];
  for (const filePath of LOCAL_PLAYER_ARTIFACT_PATHS) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const loginEmail = payload ? payload.loginEmail || payload.email : '';
      if (!payload || !loginEmail || !payload.password) continue;
      const stat = fs.statSync(filePath);
      const score = Math.max(
        parseIsoDate(payload.loginValidationAt),
        parseIsoDate(payload.generatedAt),
        Number(stat.mtimeMs) || 0
      );
      candidates.push({
        score,
        creds: {
          email: String(loginEmail),
          password: String(payload.password),
          authToken:
            typeof payload.authToken === 'string' && payload.authToken.length >= 10
              ? payload.authToken
              : '',
          artifactPath: filePath,
        },
      });
    } catch {
      // Ignore malformed or incomplete same-brand artifacts.
    }
  }
  if (!candidates.length) return null;
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0].creds;
}

function parseIsoDate(value) {
  if (!value) return 0;
  const ts = Date.parse(String(value));
  return Number.isFinite(ts) ? ts : 0;
}

function getCredsFromSharedProjectArtifacts() {
  if (!ALLOW_SHARED_PLAYER_FALLBACK) return null;
  if (!fs.existsSync(PROJECTS_ROOT_DIR)) return null;

  const candidates = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT_DIR, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const dirent of dirs) {
    if (!dirent || !dirent.isDirectory()) continue;
    const projectRoot = path.resolve(PROJECTS_ROOT_DIR, dirent.name);
    if (CURRENT_PROJECT_ROOT && projectRoot === CURRENT_PROJECT_ROOT) continue;
    const filePath = path.join(projectRoot, 'artifacts', 'last-registered-player.json');
    if (!fs.existsSync(filePath)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const loginEmail = payload ? payload.loginEmail || payload.email : '';
      if (!payload || !loginEmail || !payload.password) continue;
      if (typeof payload.authToken !== 'string' || payload.authToken.length < 10) continue;
      const stat = fs.statSync(filePath);
      const score = Math.max(
        parseIsoDate(payload.loginValidationAt),
        parseIsoDate(payload.generatedAt),
        Number(stat.mtimeMs) || 0
      );
      candidates.push({
        filePath,
        projectSlug: dirent.name,
        score,
        creds: {
          email: String(loginEmail),
          password: String(payload.password),
          authToken: String(payload.authToken),
        },
      });
    } catch {
      // ignore malformed shared artifact
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

function readPlayerArtifact(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!payload || typeof payload !== 'object') return null;
    return payload;
  } catch {
    return null;
  }
}

function writePlayerArtifact(filePath, payload) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function updatePlayerLoginValidation({ creds, status, method, reason }) {
  const email = String((creds && creds.email) || '')
    .trim()
    .toLowerCase();
  if (!email) return false;

  let updated = false;
  let latestUpdatedPayload = null;
  for (const filePath of PLAYER_ARTIFACT_PATHS) {
    const payload = readPlayerArtifact(filePath);
    if (!payload || !payload.email) continue;
    const artifactEmail = String(payload.loginEmail || payload.email || '')
      .trim()
      .toLowerCase();
    if (artifactEmail !== email) continue;

    const existingStatus = String(payload.loginValidationStatus || '')
      .trim()
      .toLowerCase();
    const existingReady =
      payload.manualLoginReady === true && existingStatus === 'password-signin-ok';
    const incomingReady =
      String(status || '')
        .trim()
        .toLowerCase() === 'password-signin-ok';
    const preserveReady = existingReady && !incomingReady;

    const nextPayload = {
      ...payload,
      manualLoginReady: incomingReady || preserveReady,
      loginValidationStatus: preserveReady ? payload.loginValidationStatus : status || '',
      loginValidationMethod: preserveReady ? payload.loginValidationMethod : method || '',
      loginValidationReason: preserveReady ? payload.loginValidationReason : reason || '',
      loginValidationAt: preserveReady
        ? payload.loginValidationAt || new Date().toISOString()
        : new Date().toISOString(),
      lastLoginCheckStatus: status || '',
      lastLoginCheckMethod: method || '',
      lastLoginCheckReason: reason || '',
      lastLoginCheckAt: new Date().toISOString(),
    };
    if (writePlayerArtifact(filePath, nextPayload)) {
      updated = true;
      latestUpdatedPayload = nextPayload;
    }
  }

  if (status === 'password-signin-ok') {
    const manualReadyPayload = latestUpdatedPayload || {
      source: 'tests/critical/login-auth.spec.js',
      generatedAt: new Date().toISOString(),
      email: String((creds && creds.email) || ''),
      password: String((creds && creds.password) || ''),
      passwordMasked: maskValue(String((creds && creds.password) || '')),
      manualLoginReady: true,
      loginValidationStatus: 'password-signin-ok',
      loginValidationMethod: method || 'ui-signin',
      loginValidationReason:
        reason || 'Password sign-in succeeded and authorized session was established.',
      loginValidationAt: new Date().toISOString(),
    };
    if (writePlayerArtifact(MANUAL_READY_PLAYER_PATH, manualReadyPayload)) {
      updated = true;
    }
  }

  return updated;
}

function resolveLoginCreds({ artifactCreds, envCreds }) {
  const hasEnvCreds = Boolean(envCreds && envCreds.email && envCreds.password);
  if (USE_ENV_LOGIN_FIRST && hasEnvCreds) {
    return {
      source: 'env',
      creds: envCreds,
    };
  }

  if (artifactCreds) {
    return {
      source: 'registered-artifact',
      creds: artifactCreds,
    };
  }

  if (hasEnvCreds) {
    return {
      source: 'env',
      creds: envCreds,
    };
  }

  return {
    source: 'negative-random',
    creds: randomInvalidCreds(),
  };
}

async function persistAuthStates(context) {
  const saved = [];
  for (const statePath of AUTH_STATE_OUTPUT_PATHS) {
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      await context.storageState({ path: statePath });
      saved.push(statePath);
    } catch {
      // Keep login test resilient when browser context is recycled by target site/WAF.
    }
  }
  return saved;
}

async function getTurnstileState(modal) {
  const tokenInput = modal.locator('input[name="cf-turnstile-response"]').first();
  const inputCount = await modal
    .locator('input[name="cf-turnstile-response"]')
    .count()
    .catch(() => 0);
  const inputVisible =
    inputCount > 0 ? await tokenInput.isVisible({ timeout: 300 }).catch(() => false) : false;
  const tokenValue = inputCount > 0 ? await tokenInput.inputValue().catch(() => '') : '';
  const iframeVisible = await modal
    .locator('iframe[src*="turnstile"], iframe[title*="Cloudflare"], .cf-turnstile')
    .first()
    .isVisible({ timeout: 300 })
    .catch(() => false);

  return {
    inputCount,
    inputVisible,
    tokenLen: String(tokenValue || '').trim().length,
    iframeVisible,
  };
}

async function pokeTurnstile(modal, page) {
  const frame = modal.locator('iframe[src*="turnstile"], iframe[title*="Cloudflare"]').first();
  const frameVisible = await frame.isVisible({ timeout: 300 }).catch(() => false);
  if (frameVisible) {
    const box = await frame.boundingBox().catch(() => null);
    if (box) {
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y, { steps: 3 }).catch(() => null);
      await page.mouse.click(x, y, { delay: 60 }).catch(() => null);
      return true;
    }
  }

  const widget = modal.locator('.cf-turnstile, [id*="turnstile"], [class*="turnstile"]').first();
  if (await widget.isVisible({ timeout: 300 }).catch(() => false)) {
    await widget.click({ timeout: 1500 }).catch(() => null);
    return true;
  }

  return false;
}

async function waitForTurnstileToken(modal, page, options = {}) {
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 20_000;
  const pollMs = Number.isFinite(options.pollMs) && options.pollMs > 0 ? options.pollMs : 900;
  const deadline = Date.now() + timeoutMs;
  let touched = false;
  let state = await getTurnstileState(modal);

  while (Date.now() < deadline) {
    if (state.inputCount > 0 && state.tokenLen > 0) {
      return {
        tokenReady: true,
        state,
        touched,
      };
    }
    if (state.inputCount > 0 && (state.inputVisible || state.iframeVisible) && !touched) {
      touched = await pokeTurnstile(modal, page);
    }
    await sleep(pollMs);
    state = await getTurnstileState(modal);
  }

  return {
    tokenReady: state.inputCount > 0 && state.tokenLen > 0,
    state,
    touched,
  };
}

async function hasTurnstileChallenge(modal, page) {
  const tokenState = await getTurnstileState(modal);
  if (tokenState.inputCount > 0) {
    return tokenState.tokenLen === 0;
  }

  const selectors = ['iframe[src*="turnstile"]', '.cf-turnstile'];
  for (const selector of selectors) {
    const visible = await modal
      .locator(selector)
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);
    if (visible) return true;
  }

  const verifyText = await page
    .getByText(/verify you are human/i)
    .first()
    .isVisible({ timeout: 300 })
    .catch(() => false);
  if (!verifyText) return false;

  const appRootVisible = await page
    .locator('#app, #__nuxt')
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  const authModalVisible = await modal.isVisible({ timeout: 300 }).catch(() => false);
  return !appRootVisible || !authModalVisible;
}

function randomInvalidCreds() {
  const stamp = Date.now();
  return {
    email: `autotest.login.${stamp}@example.test`,
    password: `InvalidPass@${String(stamp).slice(-4)}`,
  };
}

function isMobileProjectRun(testInfo) {
  const matrix = String(process.env.PW_PROJECT_MATRIX || '')
    .trim()
    .toLowerCase();
  const projectName = String((testInfo && testInfo.project && testInfo.project.name) || '')
    .trim()
    .toLowerCase();
  return matrix.includes('mobile') || projectName.includes('mobile');
}

async function waitForLoginSurface(page, opts = {}) {
  const mobileRun = Boolean(opts.mobileRun);
  const timeoutMs = mobileRun ? 22000 : 32000;
  const pollMs = 500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const challenge = await detectCloudflare(page).catch(() => null);
    if (challenge) {
      throw new Error(challenge);
    }

    const appRootVisible = await page
      .locator('#app, #__nuxt')
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (appRootVisible) {
      return;
    }

    await sleep(pollMs);
  }

  throw new Error('Login surface did not become ready in time.');
}

function isCaptchaBlockedResponse(response) {
  if (!response || typeof response !== 'object') return false;
  const payload = JSON.stringify(response.body || {}).toLowerCase();
  return /recaptcha|captcha|turnstile|verify you are human|cf-/.test(payload);
}

async function fallbackToTokenLoginIfAvailable({
  page,
  mobileRun,
  hasRealCreds,
  artifactCreds,
  creds,
  loginOutcome,
  testInfo,
  reason,
}) {
  if (!hasRealCreds) return false;
  const hasTokenFallback =
    Boolean(artifactCreds && typeof artifactCreds.authToken === 'string') &&
    artifactCreds.authToken.length >= 10;
  if (!hasTokenFallback) return false;

  const tokenSession = await establishVerifiedTokenSession({
    page,
    token: artifactCreds.authToken,
    mobileRun,
  });
  if (!tokenSession.authorized) {
    testInfo.annotations.push({
      type: 'auth-diagnostic',
      description: `Token fallback rejected: session is not authorized (preferencesStatus=${String(
        tokenSession.probe.preferencesStatus
      )}, loginVisible=${String(tokenSession.probe.loginVisible)}).`,
    });
    return false;
  }

  loginOutcome.savedAuthStates = await persistAuthStates(page.context());
  loginOutcome.status = 'blocked-token-fallback';
  loginOutcome.reason = reason;
  markTokenFallbackDiagnostic(testInfo, reason);
  updatePlayerLoginValidation({
    creds,
    status: 'token-fallback-only',
    method: 'auth-token-cookie',
    reason,
  });
  return true;
}

function markTokenFallbackDiagnostic(testInfo, reason) {
  const description = String(reason || 'Auth token fallback established a diagnostic session.');
  testInfo.annotations.push({
    type: 'partial',
    description,
  });
  testInfo.annotations.push({
    type: 'auth-diagnostic',
    description,
  });
}

async function probeCurrentAuthState(page) {
  const loginVisible = await page
    .getByRole('button', {
      name: /log\s*in|sign\s*in|connexion|se connecter|anmelden|entrar|iniciar sesi[oó]n|accedi|войти|увійти/i,
    })
    .first()
    .isVisible({ timeout: 700 })
    .catch(() => false);
  const accountVisible = await page
    .getByText(
      /account menu|menu de compte|men[uú] de cuenta|konto|perfil|profile|compte|аккаунт|профил|обліков/i
    )
    .first()
    .isVisible({ timeout: 700 })
    .catch(() => false);
  const preferencesStatus = await page.request
    .get(new URL('/api/user/preferences', BASE_URL).toString(), {
      failOnStatusCode: false,
      timeout: 10000,
    })
    .then((resp) => resp.status())
    .catch(() => null);
  const authorizedByApi =
    Number.isFinite(Number(preferencesStatus)) &&
    Number(preferencesStatus) > 0 &&
    Number(preferencesStatus) < 400;
  return {
    loginVisible,
    accountVisible,
    preferencesStatus: Number.isFinite(Number(preferencesStatus))
      ? Number(preferencesStatus)
      : null,
    authorized: authorizedByApi || (accountVisible && !loginVisible),
  };
}

async function establishVerifiedTokenSession({ page, token, mobileRun }) {
  await applyAuthTokenCookie(page.context(), token, BASE_URL);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
  await dismissOverlays(page);
  await waitForLoginSurface(page, { mobileRun }).catch(() => null);
  const probe = await probeCurrentAuthState(page);
  if (!probe.authorized) {
    await page
      .context()
      .clearCookies({ name: 'auth._token.local' })
      .catch(() => null);
  }
  return { authorized: probe.authorized, probe };
}

test('Log In flow: auth request is handled correctly', async ({ page }, testInfo) => {
  const mobileRun = isMobileProjectRun(testInfo);
  test.setTimeout(mobileRun ? 150000 : 180000);
  const wafProbe = createWafProbe(page);
  const authResponses = [];
  const localArtifactCreds = getCredsFromStableArtifact();
  const sharedArtifact =
    REQUIRE_REGISTERED_LOGIN && !localArtifactCreds ? getCredsFromSharedProjectArtifacts() : null;
  const artifactCreds = localArtifactCreds || (sharedArtifact ? sharedArtifact.creds : null);
  const artifactCredsPath = localArtifactCreds
    ? localArtifactCreds.artifactPath || STABLE_PLAYER_PATH
    : sharedArtifact
      ? sharedArtifact.filePath
      : STABLE_PLAYER_PATH;
  const envCreds =
    process.env.LOGIN_EMAIL && process.env.LOGIN_PASSWORD
      ? {
          email: String(process.env.LOGIN_EMAIL),
          password: String(process.env.LOGIN_PASSWORD),
        }
      : null;
  const loginOutcome = {
    source: '',
    status: 'started',
    reason: '',
    savedAuthStates: [],
  };
  let resolvedCreds = null;
  let signinEmailPatch = null;

  if (sharedArtifact) {
    testInfo.annotations.push({
      type: 'login',
      description: `Local registered player artifact is unavailable; using shared player from ${sharedArtifact.projectSlug}.`,
    });
  }

  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      const method = resp.request().method();
      if (!isAuthLikeResponse(url, method)) return;

      const contentType = resp.headers()['content-type'] || '';
      let body = null;
      if (contentType.includes('application/json')) {
        body = await resp.json().catch(() => null);
      } else {
        body = (await resp.text().catch(() => '')).slice(0, 500);
      }

      authResponses.push({
        url,
        status: resp.status(),
        statusText: resp.statusText(),
        body,
      });
    } catch {
      // ignore response parsing issues
    }
  });

  try {
    await page.setViewportSize(
      mobileRun ? { width: 412, height: 915 } : { width: 1365, height: 900 }
    );
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await assertNotCloudflare(page);
    await dismissOverlays(page);
    await waitForLoginSurface(page, { mobileRun });
    const preferTokenFallback =
      process.env.PW_LOGIN_PREFER_TOKEN_FALLBACK === '1' &&
      Boolean(artifactCreds && typeof artifactCreds.authToken === 'string') &&
      artifactCreds.authToken.length >= 10;
    if (preferTokenFallback) {
      const reason =
        'Token fallback preferred for this brand run; UI password sign-in is treated as diagnostic to avoid Cloudflare/browser shutdown flake.';
      const tokenSession = await establishVerifiedTokenSession({
        page,
        token: artifactCreds.authToken,
        mobileRun,
      });
      if (tokenSession.authorized) {
        loginOutcome.savedAuthStates = await persistAuthStates(page.context());
        loginOutcome.status = 'token-fallback-preferred';
        loginOutcome.reason = reason;
        markTokenFallbackDiagnostic(testInfo, reason);
        updatePlayerLoginValidation({
          creds: artifactCreds,
          status: 'token-fallback-only',
          method: 'auth-token-cookie',
          reason,
        });
        testInfo.annotations.push({ type: 'login', description: reason });
        return;
      }
      testInfo.annotations.push({
        type: 'auth-diagnostic',
        description: `Preferred token fallback was rejected; continuing with password login (preferencesStatus=${String(
          tokenSession.probe.preferencesStatus
        )}).`,
      });
    }
    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo })) {
      if (REQUIRE_REGISTERED_LOGIN && artifactCreds && artifactCreds.authToken) {
        const tokenSession = await establishVerifiedTokenSession({
          page,
          token: artifactCreds.authToken,
          mobileRun,
        });
        loginOutcome.status = tokenSession.authorized ? 'blocked-token-fallback' : 'blocked';
        loginOutcome.reason = tokenSession.authorized
          ? 'WAF blocked login UI; verified token fallback established an authorized session.'
          : 'WAF blocked login UI and the available token fallback was rejected.';
        if (tokenSession.authorized) {
          loginOutcome.savedAuthStates = await persistAuthStates(page.context());
          markTokenFallbackDiagnostic(testInfo, loginOutcome.reason);
        } else {
          markBlocked(testInfo, loginOutcome.reason);
        }
        updatePlayerLoginValidation({
          creds: artifactCreds,
          status: tokenSession.authorized ? 'token-fallback-only' : 'signin-blocked-waf',
          method: tokenSession.authorized ? 'auth-token-cookie' : 'ui-signin',
          reason: loginOutcome.reason,
        });
        testInfo.annotations.push({
          type: 'login',
          description: loginOutcome.reason,
        });
      } else if (REQUIRE_REGISTERED_LOGIN && artifactCreds) {
        updatePlayerLoginValidation({
          creds: artifactCreds,
          status: 'signin-blocked-waf',
          method: 'ui-signin',
          reason: 'WAF blocked login UI before password sign-in validation.',
        });
      }
      return;
    }

    let modal = null;
    try {
      modal = await openLoginModal(page, { retryOnError: false, attempts: 2 });
    } catch (modalError) {
      const authProbe = await probeCurrentAuthState(page);
      if (REQUIRE_REGISTERED_LOGIN && authProbe.authorized) {
        loginOutcome.savedAuthStates = await persistAuthStates(page.context());
        loginOutcome.status = 'passed-preauthorized';
        loginOutcome.reason =
          'Session was already authorized before login submit; saved auth state for downstream checks.';
        if (artifactCreds) {
          updatePlayerLoginValidation({
            creds: artifactCreds,
            status: 'preauthorized-session',
            method: 'existing-session',
            reason: loginOutcome.reason,
          });
        }
        testInfo.annotations.push({
          type: 'login',
          description: `Login modal is hidden because session is already authorized (preferencesStatus=${String(
            authProbe.preferencesStatus
          )}); auth-state artifacts were persisted.`,
        });
        return;
      }

      const hasTokenFallback =
        REQUIRE_REGISTERED_LOGIN &&
        Boolean(artifactCreds && typeof artifactCreds.authToken === 'string') &&
        artifactCreds.authToken.length >= 10;
      if (hasTokenFallback) {
        const tokenSession = await establishVerifiedTokenSession({
          page,
          token: artifactCreds.authToken,
          mobileRun,
        });
        if (tokenSession.authorized) {
          loginOutcome.savedAuthStates = await persistAuthStates(page.context());
          loginOutcome.status = 'blocked-token-fallback';
          loginOutcome.reason =
            'Log In modal did not open; verified token fallback established an authorized session.';
          markTokenFallbackDiagnostic(testInfo, loginOutcome.reason);
          updatePlayerLoginValidation({
            creds: artifactCreds,
            status: 'token-fallback-only',
            method: 'auth-token-cookie',
            reason: loginOutcome.reason,
          });
          return;
        }
      }
      throw modalError;
    }
    modal = (await resolveVisibleAuthContainer(page, modal)) || modal;
    await expect(modal).toBeVisible({ timeout: 15000 });

    if (REQUIRE_REGISTERED_LOGIN && !artifactCreds) {
      throw new Error(
        `PW_LOGIN_REQUIRE_REGISTERED=1 but no credentials were found in ${STABLE_PLAYER_PATH}.`
      );
    }

    resolvedCreds = resolveLoginCreds({ artifactCreds, envCreds });
    const creds = resolvedCreds.creds;
    const hasRealCreds = resolvedCreds.source !== 'negative-random';
    loginOutcome.source = resolvedCreds.source;
    if (hasRealCreds) {
      signinEmailPatch = await installSigninEmailPatch(page, creds.email, testInfo);
    }

    if (resolvedCreds.source === 'env') {
      testInfo.annotations.push({
        type: 'login',
        description: 'Using LOGIN_EMAIL/LOGIN_PASSWORD from env.',
      });
    } else if (resolvedCreds.source === 'registered-artifact') {
      testInfo.annotations.push({
        type: 'login',
        description: `Using credentials from ${artifactCredsPath}.`,
      });
    } else {
      testInfo.annotations.push({
        type: 'login',
        description:
          'No real login credentials found: running negative auth check with invalid credentials.',
      });
    }

    let emailFilled = await fillFirstVisible(
      modal,
      ['input[type="email"]', 'input[name*="email" i]', 'input[placeholder*="Email" i]'],
      creds.email
    );
    if (!emailFilled) {
      const emailFallback = modal.locator('input:visible:not([type="password"])').first();
      if (
        await emailFallback
          .isVisible({ timeout: LOGIN_SHORT_VISIBILITY_TIMEOUT_MS })
          .catch(() => false)
      ) {
        await emailFallback.fill(creds.email);
        emailFilled = true;
      }
    }
    if (!emailFilled) {
      const genericInputs = modal.locator('input:visible');
      const genericCount = Math.min(await genericInputs.count().catch(() => 0), 8);
      for (let i = 0; i < genericCount; i += 1) {
        const input = genericInputs.nth(i);
        const type = ((await input.getAttribute('type').catch(() => '')) || 'text').toLowerCase();
        if (['password', 'hidden', 'checkbox', 'radio', 'submit', 'button'].includes(type))
          continue;
        await input.fill(creds.email).catch(() => null);
        const value = await input.inputValue().catch(() => '');
        if (value && value.includes('@')) {
          emailFilled = true;
          break;
        }
      }
    }
    if (!emailFilled) {
      emailFilled = await fillFirstVisible(
        page,
        ['input[type="email"]', 'input[name*="email" i]', 'input[placeholder*="Email" i]'],
        creds.email
      );
    }
    if (hasRealCreds && emailFilled && String(creds.email || '').includes('+')) {
      const observedAfterFill = normalizeEmail(await readVisibleEmailValue(modal));
      const expectedEmail = normalizeEmail(creds.email || '');
      if (observedAfterFill && observedAfterFill !== expectedEmail) {
        const emailInput = modal
          .locator(
            'input[type="email"], input[name*="email" i], input:visible:not([type="password"])'
          )
          .first();
        if (
          await emailInput
            .isVisible({ timeout: LOGIN_SHORT_VISIBILITY_TIMEOUT_MS })
            .catch(() => false)
        ) {
          await emailInput.click().catch(() => null);
          await emailInput.fill('').catch(() => null);
          await page.keyboard.type(String(creds.email)).catch(() => null);
          const observedAfterType = normalizeEmail(await emailInput.inputValue().catch(() => ''));
          testInfo.annotations.push({
            type: 'login',
            description: `Email refill via keyboard for plus-address: afterFill=${observedAfterFill}, afterType=${observedAfterType}.`,
          });
        }
      }
    }

    let passwordFilled = await fillFirstVisible(
      modal,
      ['input[type="password"]', 'input[name*="password" i]', 'input[placeholder*="Password" i]'],
      creds.password
    );
    if (!passwordFilled) {
      const passwordFallback = modal.locator('input[type="password"]:visible').first();
      if (
        await passwordFallback
          .isVisible({ timeout: LOGIN_SHORT_VISIBILITY_TIMEOUT_MS })
          .catch(() => false)
      ) {
        await passwordFallback.fill(creds.password);
        passwordFilled = true;
      }
    }
    if (!passwordFilled) {
      const genericInputs = modal.locator('input:visible');
      const genericCount = Math.min(await genericInputs.count().catch(() => 0), 8);
      for (let i = 0; i < genericCount; i += 1) {
        const input = genericInputs.nth(i);
        const type = ((await input.getAttribute('type').catch(() => '')) || '').toLowerCase();
        if (type !== 'password') continue;
        await input.fill(creds.password).catch(() => null);
        const value = await input.inputValue().catch(() => '');
        if (value) {
          passwordFilled = true;
          break;
        }
      }
    }
    if (!passwordFilled) {
      passwordFilled = await fillFirstVisible(
        page,
        ['input[type="password"]', 'input[name*="password" i]', 'input[placeholder*="Password" i]'],
        creds.password
      );
    }

    if (hasRealCreds && (!emailFilled || !passwordFilled)) {
      const challengeBeforeSwitch = await detectCloudflare(page).catch(() => null);
      if (challengeBeforeSwitch) {
        const reason = `Login UI is blocked by challenge before field interaction: ${challengeBeforeSwitch}`;
        const recovered = await fallbackToTokenLoginIfAvailable({
          page,
          mobileRun,
          hasRealCreds,
          artifactCreds,
          creds,
          loginOutcome,
          testInfo,
          reason,
        });
        if (recovered) return;

        markBlocked(testInfo, reason);
        loginOutcome.status = 'blocked';
        loginOutcome.reason = reason;
        updatePlayerLoginValidation({
          creds,
          status: 'signin-blocked-waf',
          method: 'ui-signin',
          reason,
        });
        return;
      }

      modal = (await switchToLoginView(page, modal)) || modal;
      emailFilled =
        emailFilled ||
        (await fillFirstVisible(
          modal,
          ['input[type="email"]', 'input[name*="email" i]', 'input[placeholder*="Email" i]'],
          creds.email
        )) ||
        (await fillFirstVisible(
          page,
          ['input[type="email"]', 'input[name*="email" i]', 'input[placeholder*="Email" i]'],
          creds.email
        ));
      passwordFilled =
        passwordFilled ||
        (await fillFirstVisible(
          modal,
          [
            'input[type="password"]',
            'input[name*="password" i]',
            'input[placeholder*="Password" i]',
          ],
          creds.password
        )) ||
        (await fillFirstVisible(
          page,
          [
            'input[type="password"]',
            'input[name*="password" i]',
            'input[placeholder*="Password" i]',
          ],
          creds.password
        ));
    }

    if (hasRealCreds) {
      const expectedEmail = normalizeEmail(creds.email || '');
      const observedEmail = normalizeEmail(await readVisibleEmailValue(modal));
      const expectedNoPlus =
        signinEmailPatch && signinEmailPatch.expectedEmailNoPlus
          ? signinEmailPatch.expectedEmailNoPlus
          : expectedEmail.replace(/\+/g, '');
      const uiRemovedPlus = Boolean(
        expectedEmail &&
        observedEmail &&
        expectedEmail.includes('+') &&
        observedEmail === expectedNoPlus &&
        observedEmail !== expectedEmail
      );

      if (uiRemovedPlus) {
        testInfo.annotations.push({
          type: 'login',
          description: `Email sanitizer detected: expected=${expectedEmail}, observed=${observedEmail}.`,
        });
        if (signinEmailPatch && signinEmailPatch.enabled) {
          testInfo.annotations.push({
            type: 'login',
            description:
              'Email sanitizer detected in UI; sign-in payload patch is enabled for plus-address login.',
          });
        } else {
          const reason =
            'Login UI removed "+" from email local-part; submitted credentials no longer match registered email.';

          const hasTokenFallback =
            Boolean(artifactCreds && typeof artifactCreds.authToken === 'string') &&
            artifactCreds.authToken.length >= 10;
          if (hasTokenFallback) {
            const tokenSession = await establishVerifiedTokenSession({
              page,
              token: artifactCreds.authToken,
              mobileRun,
            });
            if (tokenSession.authorized) {
              loginOutcome.savedAuthStates = await persistAuthStates(page.context());
              loginOutcome.status = 'blocked-token-fallback';
              loginOutcome.reason = reason;
              markTokenFallbackDiagnostic(testInfo, reason);
              updatePlayerLoginValidation({
                creds,
                status: 'signin-email-mutated-by-ui',
                method: 'ui-signin',
                reason,
              });
              return;
            }
          }

          markBlocked(testInfo, reason);
          loginOutcome.status = 'blocked';
          loginOutcome.reason = reason;
          updatePlayerLoginValidation({
            creds,
            status: 'signin-email-mutated-by-ui',
            method: 'ui-signin',
            reason,
          });
          return;
        }
      }
    }

    if (!emailFilled || !passwordFilled) {
      const challenge = await detectCloudflare(page).catch(() => null);
      const reason = challenge
        ? `Login form fields are blocked by challenge (${challenge}).`
        : `Login form fields are not accessible in current UI layout (emailFilled=${String(
            emailFilled
          )}, passwordFilled=${String(passwordFilled)}).`;
      testInfo.annotations.push({
        type: 'login',
        description: reason,
      });

      const hasTokenFallback =
        hasRealCreds &&
        Boolean(artifactCreds && typeof artifactCreds.authToken === 'string') &&
        artifactCreds.authToken.length >= 10;
      if (hasTokenFallback) {
        const tokenSession = await establishVerifiedTokenSession({
          page,
          token: artifactCreds.authToken,
          mobileRun,
        });
        if (tokenSession.authorized) {
          loginOutcome.savedAuthStates = await persistAuthStates(page.context());
          loginOutcome.status = 'blocked-token-fallback';
          loginOutcome.reason =
            'Login form fields were unavailable; verified token fallback established an authorized session.';
          markTokenFallbackDiagnostic(testInfo, loginOutcome.reason);
          updatePlayerLoginValidation({
            creds,
            status: 'token-fallback-only',
            method: 'auth-token-cookie',
            reason: loginOutcome.reason,
          });
          return;
        }
      }

      if (hasRealCreds) {
        markBlocked(testInfo, reason);
        loginOutcome.status = 'blocked';
        loginOutcome.reason = reason;
        updatePlayerLoginValidation({
          creds,
          status: challenge ? 'signin-blocked-waf' : 'signin-form-unavailable',
          method: 'ui-signin',
          reason,
        });
        return;
      }

      const negativeReason =
        'Login form fields are inaccessible for negative auth check; skipping submit because no registered credentials are available.';
      markBlocked(testInfo, `${negativeReason} ${reason}`);
      loginOutcome.status = 'blocked';
      loginOutcome.reason = `${negativeReason} ${reason}`;
      return;
    }

    expect(emailFilled, 'Email input not found in Log In modal.').toBeTruthy();
    expect(passwordFilled, 'Password input not found in Log In modal.').toBeTruthy();

    const submit = await findActionButton(modal, [
      'button:has-text("LOG IN")',
      'button:has-text("Log In")',
      'button:has-text("Login")',
      'button[type="submit"]',
      'input[type="submit"]',
      '[data-testid*="login"]',
    ]);
    expect(submit, 'Log In submit button not found.').toBeTruthy();

    const turnstilePreSubmitWaitMs = mobileRun ? MOBILE_TURNSTILE_PRE_SUBMIT_WAIT_MS : 18_000;
    const turnstileSubmitEnableWaitMs = mobileRun ? MOBILE_TURNSTILE_SUBMIT_ENABLE_WAIT_MS : 12_000;
    const authSuccessWaitMs = mobileRun ? MOBILE_AUTH_SUCCESS_WAIT_MS : 20_000;
    const turnstileRetryWaitMs = mobileRun ? MOBILE_TURNSTILE_RETRY_WAIT_MS : 12_000;
    const authRetryWaitMs = mobileRun ? MOBILE_AUTH_RETRY_WAIT_MS : 12_000;
    const maxTurnstileRetries = mobileRun ? MOBILE_MAX_TURNSTILE_RETRIES : 2;
    const fallbackGotoTimeoutMs = mobileRun ? MOBILE_FALLBACK_GOTO_TIMEOUT_MS : 30_000;
    const manualCaptchaWaitMs =
      Number.isFinite(LOGIN_MANUAL_CAPTCHA_WAIT_MS) && LOGIN_MANUAL_CAPTCHA_WAIT_MS > 0
        ? mobileRun
          ? Math.min(LOGIN_MANUAL_CAPTCHA_WAIT_MS, MOBILE_MANUAL_CAPTCHA_WAIT_CAP_MS)
          : LOGIN_MANUAL_CAPTCHA_WAIT_MS
        : 0;

    const tokenBeforeSubmit = await getTurnstileState(modal);
    if (tokenBeforeSubmit.inputCount > 0 && tokenBeforeSubmit.tokenLen === 0) {
      const waited = await waitForTurnstileToken(modal, page, {
        timeoutMs: turnstilePreSubmitWaitMs,
        pollMs: 900,
      });
      testInfo.annotations.push({
        type: 'login',
        description: `Turnstile pre-submit wait: tokenReady=${waited.tokenReady}, tokenLen=${waited.state.tokenLen}, touched=${waited.touched}`,
      });

      // On mobile runs Turnstile can remain unsolved for long periods and force test timeout.
      // Exit early to token fallback when we already have validated registered-player token.
      if (hasRealCreds && mobileRun && !waited.tokenReady) {
        const hasTokenFallback =
          Boolean(artifactCreds && typeof artifactCreds.authToken === 'string') &&
          artifactCreds.authToken.length >= 10;
        if (hasTokenFallback) {
          const tokenSession = await establishVerifiedTokenSession({
            page,
            token: artifactCreds.authToken,
            mobileRun,
          });
          if (tokenSession.authorized) {
            loginOutcome.savedAuthStates = await persistAuthStates(page.context());
            const reason =
              'Captcha/Turnstile token was not issued in mobile flow; verified token fallback established an authorized session.';
            loginOutcome.status = 'blocked-token-fallback';
            loginOutcome.reason = reason;
            markTokenFallbackDiagnostic(testInfo, reason);
            updatePlayerLoginValidation({
              creds,
              status: 'token-fallback-only',
              method: 'auth-token-cookie',
              reason,
            });
            return;
          }
        }
      }
    }

    if (submit) {
      let submitEnabled = await submit.isEnabled().catch(() => false);
      if (!submitEnabled) {
        const waited = await waitForTurnstileToken(modal, page, {
          timeoutMs: turnstileSubmitEnableWaitMs,
          pollMs: 900,
        });
        testInfo.annotations.push({
          type: 'login',
          description: `Submit enabled wait: tokenReady=${waited.tokenReady}, tokenLen=${waited.state.tokenLen}, touched=${waited.touched}`,
        });
        submitEnabled = await submit.isEnabled().catch(() => false);
      }
      if (submitEnabled) {
        await submit.click().catch(() => null);
      }
    }

    if (hasRealCreds) {
      let successAuth = await waitFor(
        () => authResponses.some((resp) => resp.status >= 200 && resp.status < 300),
        authSuccessWaitMs
      );
      let blockedByCaptchaResponse = authResponses.some(
        (resp) => resp.status >= 400 && isCaptchaBlockedResponse(resp)
      );
      let turnstileRetries = 0;
      while (!successAuth && blockedByCaptchaResponse && turnstileRetries < maxTurnstileRetries) {
        turnstileRetries += 1;
        const waited = await waitForTurnstileToken(modal, page, {
          timeoutMs: turnstileRetryWaitMs,
          pollMs: 900,
        });
        testInfo.annotations.push({
          type: 'login',
          description: `Turnstile retry ${turnstileRetries}: tokenReady=${waited.tokenReady}, tokenLen=${waited.state.tokenLen}, touched=${waited.touched}`,
        });

        if (
          submit &&
          (await submit
            .isVisible({ timeout: LOGIN_SHORT_VISIBILITY_TIMEOUT_MS })
            .catch(() => false))
        ) {
          const enabled = await submit.isEnabled().catch(() => false);
          if (enabled) {
            await submit.click().catch(() => null);
          }
        }

        successAuth = await waitFor(
          () => authResponses.some((resp) => resp.status >= 200 && resp.status < 300),
          authRetryWaitMs
        );
        blockedByCaptchaResponse = authResponses.some(
          (resp) => resp.status >= 400 && isCaptchaBlockedResponse(resp)
        );
      }

      if (!successAuth && blockedByCaptchaResponse && manualCaptchaWaitMs > 0) {
        testInfo.annotations.push({
          type: 'login',
          description: `Manual captcha window enabled: waiting up to ${manualCaptchaWaitMs} ms for Turnstile token.`,
        });
        const waitedManual = await waitForTurnstileToken(modal, page, {
          timeoutMs: manualCaptchaWaitMs,
          pollMs: 1000,
        });
        if (
          submit &&
          (await submit
            .isVisible({ timeout: LOGIN_SHORT_VISIBILITY_TIMEOUT_MS })
            .catch(() => false))
        ) {
          const enabled = await submit.isEnabled().catch(() => false);
          if (enabled) {
            await submit.click().catch(() => null);
          }
        }
        successAuth = await waitFor(
          () => authResponses.some((resp) => resp.status >= 200 && resp.status < 300),
          15_000
        );
        blockedByCaptchaResponse = authResponses.some(
          (resp) => resp.status >= 400 && isCaptchaBlockedResponse(resp)
        );
        testInfo.annotations.push({
          type: 'login',
          description: `Manual captcha wait result: tokenReady=${waitedManual.tokenReady}, tokenLen=${waitedManual.state.tokenLen}, touched=${waitedManual.touched}`,
        });
      }

      const blockedByTurnstile = await waitFor(() => hasTurnstileChallenge(modal, page), 3_000);
      if (!successAuth && (blockedByTurnstile || blockedByCaptchaResponse)) {
        const hasTokenFallback =
          Boolean(artifactCreds && typeof artifactCreds.authToken === 'string') &&
          artifactCreds.authToken.length >= 10;
        if (hasTokenFallback) {
          await applyAuthTokenCookie(page.context(), artifactCreds.authToken, BASE_URL);
          await page
            .goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: fallbackGotoTimeoutMs })
            .catch(() => null);
          await dismissOverlays(page);
          await waitForLoginSurface(page, { mobileRun }).catch(() => null);

          const loginVisibleAfterToken = await page
            .getByRole('button', { name: /log in/i })
            .first()
            .isVisible({ timeout: 3000 })
            .catch(() => false);
          const preferencesStatus = await page.request
            .get(new URL('/api/user/preferences', BASE_URL).toString(), {
              failOnStatusCode: false,
              timeout: mobileRun ? 8_000 : 20_000,
            })
            .then((resp) => resp.status())
            .catch(() => null);
          const tokenSessionLooksAuthorized =
            !loginVisibleAfterToken ||
            (Number.isFinite(Number(preferencesStatus)) && Number(preferencesStatus) < 400);
          if (tokenSessionLooksAuthorized) {
            loginOutcome.savedAuthStates = await persistAuthStates(page.context());
            const reason =
              'Captcha/Turnstile blocked password sign-in; token fallback established a session, but manual login is not validated.';
            loginOutcome.status = 'blocked-token-fallback';
            loginOutcome.reason = reason;
            markTokenFallbackDiagnostic(testInfo, reason);
            updatePlayerLoginValidation({
              creds,
              status: 'token-fallback-only',
              method: 'auth-token-cookie',
              reason,
            });
            testInfo.annotations.push({
              type: 'login',
              description:
                'UI login was blocked by captcha; auth token fallback worked, but manual password sign-in is not validated.',
            });
            return;
          }
        }

        const reason = 'Captcha/Turnstile validation blocked automated login submission.';
        markBlocked(testInfo, reason);
        loginOutcome.status = 'blocked';
        loginOutcome.reason = reason;
        updatePlayerLoginValidation({
          creds,
          status: 'signin-blocked-captcha',
          method: 'ui-signin',
          reason,
        });
        testInfo.annotations.push({
          type: 'login',
          description:
            'Outcome classified as WAF-blocked; request handling check is considered complete.',
        });
        return;
      }

      const statuses = authResponses.map((resp) => resp.status).join(', ') || 'none';
      expect(
        successAuth,
        `Expected successful login API response (2xx). Captured statuses: ${statuses}`
      ).toBeTruthy();

      const final2xx = authResponses
        .filter((resp) => resp.status >= 200 && resp.status < 300)
        .at(-1);
      expect(final2xx, 'Successful login API response is missing.').toBeTruthy();

      const otpInput = modal.locator('input[name*="code"], input[placeholder*="code" i]').first();
      const otpVisible = await otpInput.isVisible({ timeout: 3000 }).catch(() => false);
      const modalHidden = await modal.isHidden().catch(() => false);
      expect(
        modalHidden || otpVisible,
        'Expected modal to close or OTP field to appear.'
      ).toBeTruthy();

      if (otpVisible && !modalHidden) {
        const reason =
          'OTP step is required after credential submit; automated auth state not established.';
        markBlocked(testInfo, reason);
        loginOutcome.status = 'blocked';
        loginOutcome.reason = reason;
        updatePlayerLoginValidation({
          creds,
          status: 'signin-blocked-otp',
          method: 'ui-signin',
          reason,
        });
        return;
      }

      const loginVisible = await page
        .getByRole('button', { name: /log in/i })
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      if (loginVisible) {
        const reason = 'Credentials were submitted but authorized session was not established.';
        markBlocked(testInfo, reason);
        loginOutcome.status = 'blocked';
        loginOutcome.reason = reason;
        updatePlayerLoginValidation({
          creds,
          status: 'signin-failed-session-not-established',
          method: 'ui-signin',
          reason,
        });
        return;
      }

      loginOutcome.savedAuthStates = await persistAuthStates(page.context());
      loginOutcome.status = 'passed';
      updatePlayerLoginValidation({
        creds,
        status: 'password-signin-ok',
        method: 'ui-signin',
        reason: 'Password sign-in succeeded and authorized session was established.',
      });
    } else {
      const rejectedAuth = await waitFor(
        () => authResponses.some((resp) => resp.status >= 400 && resp.status < 500),
        20000
      );
      const uiError = await page
        .getByText(/invalid|incorrect|wrong|try again|something went wrong/i)
        .first()
        .isVisible({ timeout: 2000 })
        .catch(() => false);

      expect(
        rejectedAuth || uiError,
        'Expected auth rejection (4xx) or visible login error with invalid credentials.'
      ).toBeTruthy();
      loginOutcome.status = 'passed-negative';
    }
  } catch (err) {
    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo, error: err })) {
      if (REQUIRE_REGISTERED_LOGIN && artifactCreds && artifactCreds.authToken) {
        const tokenSession = await establishVerifiedTokenSession({
          page,
          token: artifactCreds.authToken,
          mobileRun,
        });
        loginOutcome.status = tokenSession.authorized ? 'blocked-token-fallback' : 'blocked';
        loginOutcome.reason = tokenSession.authorized
          ? 'WAF blocked login UI during error flow; verified token fallback established an authorized session.'
          : 'WAF blocked login UI during error flow and the available token fallback was rejected.';
        if (tokenSession.authorized) {
          loginOutcome.savedAuthStates = await persistAuthStates(page.context());
          markTokenFallbackDiagnostic(testInfo, loginOutcome.reason);
        } else {
          markBlocked(testInfo, loginOutcome.reason);
        }
        updatePlayerLoginValidation({
          creds: artifactCreds,
          status: tokenSession.authorized ? 'token-fallback-only' : 'signin-blocked-waf',
          method: tokenSession.authorized ? 'auth-token-cookie' : 'ui-signin',
          reason: loginOutcome.reason,
        });
        testInfo.annotations.push({
          type: 'login',
          description: loginOutcome.reason,
        });
      } else if (REQUIRE_REGISTERED_LOGIN && artifactCreds) {
        updatePlayerLoginValidation({
          creds: artifactCreds,
          status: 'signin-blocked-waf',
          method: 'ui-signin',
          reason: 'WAF blocked login UI before password sign-in validation.',
        });
      }
      return;
    }
    throw err;
  } finally {
    if (signinEmailPatch && signinEmailPatch.handler) {
      await page.unroute(SIGNIN_ROUTE_RE, signinEmailPatch.handler).catch(() => null);
    }
    await testInfo.attach('login-auth-responses.json', {
      body: JSON.stringify(authResponses, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('login-auth-outcome.json', {
      body: JSON.stringify(loginOutcome, null, 2),
      contentType: 'application/json',
    });
  }
});
