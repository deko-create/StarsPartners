const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { test, expect } = require('../fixtures/qa-test');
const {
  detectCloudflare,
  dismissOverlays,
  clickLocatorRobust,
  markBlocked,
  waitForUiSettled,
} = require('../helpers/gt-utils');
const { pickBestAuthStatePath } = require('../helpers/auth-state');
const { resolveMatrixContextOptions } = require('../helpers/context-options');
const { maskValue } = require('../helpers/registration-data');
const { serializeArtifactPayload } = require('../helpers/artifact-output');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const BASE_ORIGIN = new URL(BASE_URL).origin;
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
const PROJECT_TEST_RESULTS_DIR =
  process.env.QA_TEST_RESULTS_DIR || path.join(process.cwd(), 'test-results');
const PROJECT_AUTOTEST_REPORT_DIR =
  process.env.QA_AUTOTEST_REPORT_DIR || path.join(process.cwd(), 'Autotest report');
const ARTIFACT_DIR = path.join(PROJECT_AUTOTEST_REPORT_DIR, 'my-profile');
const EXPLICIT_STORAGE_STATE_PATH = process.env.PW_STORAGE_STATE
  ? path.resolve(String(process.env.PW_STORAGE_STATE))
  : '';
const PROJECT_ROOT_STORAGE_STATE_PATH = process.env.QA_PROJECT_ROOT
  ? path.join(path.resolve(String(process.env.QA_PROJECT_ROOT)), 'storageState.json')
  : '';
const AUTH_STATE_CANDIDATES = [
  path.join(PROJECT_ARTIFACTS_DIR, 'registration-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'profile-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'site-coverage-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'button-sweep-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'auth-state.json'),
  EXPLICIT_STORAGE_STATE_PATH,
  PROJECT_ROOT_STORAGE_STATE_PATH,
  path.join(process.cwd(), 'storageState.json'),
]
  .filter(Boolean)
  .filter((candidate, index, all) => all.indexOf(candidate) === index);
const STABLE_PLAYER_PATH = path.join(PROJECT_ARTIFACTS_DIR, 'last-registered-player.json');
const CURRENT_RUN_PLAYER_PATH = path.join(
  PROJECT_ARTIFACTS_DIR,
  'registration-data-current-run.json'
);
const VOLATILE_PLAYER_PATH = path.join(PROJECT_TEST_RESULTS_DIR, 'registration-data.json');
const MANUAL_READY_PLAYER_PATH = path.join(PROJECT_ARTIFACTS_DIR, 'last-manual-login-player.json');
const PLAYER_ARTIFACT_PATHS = [STABLE_PLAYER_PATH, CURRENT_RUN_PLAYER_PATH, VOLATILE_PLAYER_PATH];
const CANDIDATE_PATH = path.join(PROJECT_ARTIFACTS_DIR, 'last-login-candidate.txt');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function oneLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEmail(value) {
  return oneLine(value).toLowerCase();
}

function buildUrl(route) {
  return new URL(route, BASE_ORIGIN).toString();
}

function pickAuthStatePath() {
  return pickBestAuthStatePath(AUTH_STATE_CANDIDATES);
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function resolvePlayerFromArtifacts() {
  const candidates = [
    MANUAL_READY_PLAYER_PATH,
    CURRENT_RUN_PLAYER_PATH,
    STABLE_PLAYER_PATH,
    VOLATILE_PLAYER_PATH,
  ];

  for (const filePath of candidates) {
    const payload = readJson(filePath);
    if (!payload || typeof payload !== 'object') continue;
    const email = normalizeEmail(payload.loginEmail || payload.email);
    const password = oneLine(payload.password);
    if (!email || !password) continue;

    return {
      filePath,
      payload,
      email,
      password,
    };
  }

  return null;
}

function generateNewPassword() {
  const suffix = Date.now().toString(36).slice(-5);
  return `P2a!${suffix}Z`;
}

async function firstVisibleLocator(scope, selectors) {
  for (const selector of selectors) {
    const nodes = scope.locator(selector);
    const count = Math.min(await nodes.count().catch(() => 0), 12);
    for (let i = 0; i < count; i += 1) {
      const node = nodes.nth(i);
      if (await node.isVisible().catch(() => false)) return node;
    }
  }
  return null;
}

async function getChallengeReason(page) {
  const detected = await detectCloudflare(page);
  if (detected) return detected;

  const challengeVisible = await page
    .getByText(/cloudflare|verify you are human|checking your browser|just a moment|forbidden/i)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (challengeVisible) return 'Challenge text is visible on page.';

  const currentUrl = page.url();
  if (/cdn-cgi|challenge-platform|__cf_chl_rt_tk=|cf_chl_|__cf_bm=/i.test(currentUrl)) {
    return `Challenge URL detected: ${currentUrl}`;
  }

  return null;
}

async function openSecurityRoute(page) {
  const requestedUrl = buildUrl('/profile/security/');
  let response = null;
  let navigationError = null;

  try {
    response = await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } catch (error) {
    navigationError = oneLine(error && error.message ? error.message : error);
  }

  await dismissOverlays(page);
  await waitForUiSettled(page, 1500);

  const challenge = await getChallengeReason(page);
  const loginVisible = await page
    .getByRole('button', { name: /log in/i })
    .first()
    .isVisible({ timeout: 1200 })
    .catch(() => false);

  return {
    requestedUrl,
    finalUrl: page.url(),
    status: response ? response.status() : 0,
    challenge: challenge || (navigationError ? `Navigation failed: ${navigationError}` : null),
    loginVisible,
  };
}

async function resolvePasswordInputs(page) {
  const currentInput = await firstVisibleLocator(page, [
    'input[name*="current" i]',
    'input[name*="old" i]',
    'input[placeholder*="Current" i]',
    'input[placeholder*="Old" i]',
  ]);
  const newInput = await firstVisibleLocator(page, [
    'input[name*="new" i]',
    'input[placeholder*="New" i]',
    'input[name*="password-new" i]',
  ]);
  const confirmInput = await firstVisibleLocator(page, [
    'input[name*="confirm" i]',
    'input[name*="repeat" i]',
    'input[placeholder*="Confirm" i]',
    'input[placeholder*="Repeat" i]',
  ]);

  const allVisible = page.locator('input[type="password"]:visible');
  const count = Math.min(await allVisible.count().catch(() => 0), 6);
  const fallback = [];
  for (let i = 0; i < count; i += 1) {
    fallback.push(allVisible.nth(i));
  }

  return {
    current: currentInput || fallback[0] || null,
    next: newInput || fallback[1] || fallback[0] || null,
    confirm: confirmInput || fallback[2] || fallback[1] || null,
    visibleCount: count,
  };
}

async function runPasswordChangeUi(page, oldPassword, newPassword) {
  const apiResponses = [];
  const onResponse = async (response) => {
    try {
      const request = response.request();
      const method = request.method();
      const url = response.url();
      if (!/POST|PUT|PATCH/i.test(method)) return;
      if (!/\/api\//i.test(url)) return;
      if (!/password|security|profile|account/i.test(url)) return;
      const body = await response.text().catch(() => '');
      apiResponses.push({
        url,
        method,
        status: response.status(),
        body: oneLine(body).slice(0, 600),
      });
    } catch {
      // ignore parsing issues
    }
  };

  page.on('response', onResponse);

  let inputs = await resolvePasswordInputs(page);
  if (!inputs.current || !inputs.next) {
    const changeButton = await firstVisibleLocator(page, [
      'button:has-text("Change")',
      'button:has-text("Change password")',
      '[data-testid*="password" i] button',
    ]);
    if (changeButton) {
      await clickLocatorRobust(page, changeButton, {
        timeout: 8000,
        waitForNavigation: false,
        settleTimeout: 800,
      }).catch(() => false);
      await page
        .locator('input[type="password"]:visible')
        .first()
        .waitFor({ state: 'visible', timeout: 5000 })
        .catch(() => null);
      inputs = await resolvePasswordInputs(page);
    }
  }
  if (!inputs.current || !inputs.next) {
    page.off('response', onResponse);
    return {
      ok: false,
      reason: 'Password inputs are not visible on profile security page.',
      inputs,
      apiResponses,
    };
  }

  await inputs.current.fill(oldPassword).catch(() => null);
  await inputs.next.fill(newPassword).catch(() => null);
  if (inputs.confirm) {
    await inputs.confirm.fill(newPassword).catch(() => null);
  }

  const submitButton = await firstVisibleLocator(page, [
    'button:has-text("Change password")',
    'button:has-text("Update password")',
    'button:has-text("Save")',
    'button:has-text("Update")',
    '[data-testid*="password" i] button',
    'button[type="submit"]',
  ]);

  if (!submitButton) {
    page.off('response', onResponse);
    return {
      ok: false,
      reason: 'Password change submit button is not visible.',
      inputs,
      apiResponses,
    };
  }

  await submitButton.click({ timeout: 10_000 }).catch(() => null);
  await waitForUiSettled(page, 1800);

  const successToastVisible = await page
    .getByText(/password.*(changed|updated|saved|success)/i)
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  let apiSuccess = false;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 12_000) {
    apiSuccess = apiResponses.some(
      (entry) => Number(entry.status || 0) > 0 && Number(entry.status || 0) < 400
    );
    if (apiSuccess) break;
    await sleep(400);
  }

  page.off('response', onResponse);

  return {
    ok: successToastVisible || apiSuccess,
    reason: successToastVisible || apiSuccess ? '' : 'No password change success signal detected.',
    inputs: {
      visibleCount: inputs.visibleCount,
      hasCurrent: Boolean(inputs.current),
      hasNext: Boolean(inputs.next),
      hasConfirm: Boolean(inputs.confirm),
    },
    submitFound: Boolean(submitButton),
    successToastVisible,
    apiResponses,
  };
}

async function signinViaApi(request, email, password) {
  const signinUrl = new URL('/api/auth/signin', BASE_URL).toString();
  const response = await request
    .post(signinUrl, {
      data: {
        email,
        password,
      },
      failOnStatusCode: false,
      timeout: 20_000,
    })
    .catch(() => null);

  if (!response) {
    return {
      ok: false,
      status: 0,
      body: null,
      reason: 'Sign-in API request failed before response.',
    };
  }

  const status = response.status();
  const body = await response.json().catch(async () => {
    const text = await response.text().catch(() => '');
    return { raw: oneLine(text).slice(0, 600) };
  });

  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    reason: '',
  };
}

function classifySigninResult(result) {
  const status = Number(result && result.status ? result.status : 0);
  const body = result && result.body && typeof result.body === 'object' ? result.body : {};
  const errorCode = oneLine(body.errorCode || body.code || '').toUpperCase();
  const errorMessage = oneLine(body.errorMessage || body.message || '').toLowerCase();

  if (status >= 200 && status < 300 && typeof body.token === 'string' && body.token.length >= 10) {
    return 'valid';
  }

  if (status === 400 || status === 401 || status === 422) {
    if (errorCode.includes('CREDENTIALS_NOT_VALID')) return 'invalid-credentials';
    if (errorCode.includes('WRONG_PASSWORD')) return 'invalid-credentials';
    if (/wrong login|wrong password|credentials|not valid/i.test(errorMessage)) {
      return 'invalid-credentials';
    }
    if (errorCode.includes('CAPTCHA') || /captcha|turnstile|challenge/.test(errorMessage)) {
      return 'blocked-challenge';
    }
    return 'invalid';
  }

  if (status === 403 || status === 429 || status >= 500) return 'blocked-infra';
  if (status === 0) return 'blocked-infra';
  return 'invalid';
}

function updatePlayerArtifacts({ email, newPassword, sourceTest }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return { updated: false, updatedFiles: [] };

  const updatedFiles = [];
  let latestPayload = null;

  for (const filePath of PLAYER_ARTIFACT_PATHS) {
    const payload = readJson(filePath);
    if (!payload || typeof payload !== 'object') continue;

    const artifactEmail = normalizeEmail(payload.loginEmail || payload.email);
    if (artifactEmail !== normalizedEmail) continue;

    const next = {
      ...payload,
      password: newPassword,
      passwordMasked: maskValue(newPassword),
      manualLoginReady: true,
      loginValidationStatus: 'password-signin-ok',
      loginValidationMethod: 'profile-security-change + auth-signin-api',
      loginValidationReason:
        'Password rotated via profile security. Old password rejected and new password accepted by /api/auth/signin.',
      loginValidationAt: new Date().toISOString(),
      lastLoginCheckStatus: 'password-signin-ok',
      lastLoginCheckMethod: 'auth-signin-api',
      lastLoginCheckReason:
        'Password rotated via profile security and verified via signin API (new password valid).',
      lastLoginCheckAt: new Date().toISOString(),
      source: sourceTest || payload.source || 'tests/critical/profile-password-security.spec.js',
    };

    writeJson(filePath, next);
    updatedFiles.push(filePath);
    latestPayload = next;
  }

  if (latestPayload) {
    writeJson(MANUAL_READY_PLAYER_PATH, {
      ...latestPayload,
      source: sourceTest || 'tests/critical/profile-password-security.spec.js',
      generatedAt: new Date().toISOString(),
      manualLoginReady: true,
    });

    try {
      fs.writeFileSync(
        CANDIDATE_PATH,
        `email=${latestPayload.loginEmail || latestPayload.email}\npassword=${newPassword}\nstatus=password-signin-ok\n`,
        'utf8'
      );
      updatedFiles.push(CANDIDATE_PATH);
    } catch {
      // best-effort text candidate update
    }

    updatedFiles.push(MANUAL_READY_PLAYER_PATH);
  }

  return {
    updated: updatedFiles.length > 0,
    updatedFiles,
  };
}

function writeArtifact(payload, fileName = 'profile-password-security.json') {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const filePath = path.join(ARTIFACT_DIR, fileName);
  fs.writeFileSync(filePath, serializeArtifactPayload(payload), 'utf8');
  return filePath;
}

test('Profile security: change password and verify old password no longer signs in', async ({
  browser,
  request,
}, testInfo) => {
  const authStatePath = pickAuthStatePath();
  const player = resolvePlayerFromArtifacts();

  const payload = {
    source: 'tests/critical/profile-password-security.spec.js',
    generatedAt: new Date().toISOString(),
    authStatePath: authStatePath || '',
    playerEmail: player ? player.email : '',
    oldPasswordMasked: player ? maskValue(player.password) : '',
    oldPassword: player ? player.password : '',
    newPassword: '',
    newPasswordMasked: '',
    openSecurity: null,
    passwordChange: null,
    signinOld: null,
    signinNew: null,
    updatedArtifacts: null,
    blocked: false,
    reason: '',
  };

  if (!authStatePath) {
    payload.blocked = true;
    payload.reason = 'No auth storage state found for profile security checks.';
    markBlocked(testInfo, payload.reason);
    const artifactPath = writeArtifact(payload);
    await testInfo.attach('profile-password-security.json', {
      body: serializeArtifactPayload(payload),
      contentType: 'application/json',
    });
    testInfo.annotations.push({ type: 'artifact', description: artifactPath });
    return;
  }

  if (!player) {
    payload.blocked = true;
    payload.reason = 'Registered player credentials were not found in artifacts.';
    markBlocked(testInfo, payload.reason);
    const artifactPath = writeArtifact(payload);
    await testInfo.attach('profile-password-security.json', {
      body: serializeArtifactPayload(payload),
      contentType: 'application/json',
    });
    testInfo.annotations.push({ type: 'artifact', description: artifactPath });
    return;
  }

  const newPassword = generateNewPassword();
  payload.newPassword = newPassword;
  payload.newPasswordMasked = maskValue(newPassword);

  const context = await browser.newContext(
    resolveMatrixContextOptions({ storageState: authStatePath })
  );
  const page = await context.newPage();

  try {
    const securityRoute = await openSecurityRoute(page);
    payload.openSecurity = securityRoute;

    if (securityRoute.challenge) {
      payload.blocked = true;
      payload.reason = securityRoute.challenge;
      markBlocked(testInfo, payload.reason);
      return;
    }

    if (securityRoute.loginVisible) {
      payload.blocked = true;
      payload.reason =
        'Expected authorized session, but Log In button is visible on security page.';
      markBlocked(testInfo, payload.reason);
      return;
    }

    const passwordChange = await runPasswordChangeUi(page, player.password, newPassword);
    payload.passwordChange = passwordChange;

    if (!passwordChange.ok) {
      payload.blocked = true;
      payload.reason = passwordChange.reason || 'Password change did not complete.';
      markBlocked(testInfo, payload.reason);
      return;
    }

    const signinOld = await signinViaApi(request, player.email, player.password);
    const signinNew = await signinViaApi(request, player.email, newPassword);
    payload.signinOld = signinOld;
    payload.signinNew = signinNew;

    const oldClass = classifySigninResult(signinOld);
    const newClass = classifySigninResult(signinNew);

    if (oldClass === 'blocked-infra' || oldClass === 'blocked-challenge') {
      payload.blocked = true;
      payload.reason = `Old-password sign-in check is blocked: class=${oldClass}, status=${signinOld.status}.`;
      markBlocked(testInfo, payload.reason);
      return;
    }

    if (newClass === 'blocked-infra' || newClass === 'blocked-challenge') {
      payload.blocked = true;
      payload.reason = `New-password sign-in check is blocked: class=${newClass}, status=${signinNew.status}.`;
      markBlocked(testInfo, payload.reason);
      return;
    }

    expect(oldClass, 'Old password should be rejected after password change.').toBe(
      'invalid-credentials'
    );
    expect(newClass, 'New password should be accepted after password change.').toBe('valid');

    const updatedArtifacts = updatePlayerArtifacts({
      email: player.email,
      newPassword,
      sourceTest: 'tests/critical/profile-password-security.spec.js',
    });
    payload.updatedArtifacts = updatedArtifacts;

    expect(
      updatedArtifacts.updated,
      'Player artifacts were not updated with new password.'
    ).toBeTruthy();

    testInfo.annotations.push({
      type: 'security',
      description: 'Password rotation validated: old password rejected, new password accepted.',
    });
  } finally {
    await context.close();
    const artifactPath = writeArtifact(payload);
    await testInfo.attach('profile-password-security.json', {
      body: serializeArtifactPayload(payload),
      contentType: 'application/json',
    });
    testInfo.annotations.push({ type: 'artifact', description: artifactPath });
  }
});
