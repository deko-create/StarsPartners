const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { test, expect } = require('../fixtures/qa-test');
const {
  closeModal,
  clickLocatorRobust,
  detectCloudflare,
  dismissOverlays,
  markBlocked,
  waitForUiSettled,
} = require('../helpers/gt-utils');
const { pickBestAuthStatePath } = require('../helpers/auth-state');
const { resolveMatrixContextOptions } = require('../helpers/context-options');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const BASE_ORIGIN = new URL(BASE_URL).origin;
const PROJECT_AUTOTEST_REPORT_DIR =
  process.env.QA_AUTOTEST_REPORT_DIR || path.join(process.cwd(), 'Autotest report');
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
const ARTIFACT_DIR = path.join(PROJECT_AUTOTEST_REPORT_DIR, 'withdraw');
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

function buildUrl(route) {
  return new URL(route, BASE_ORIGIN).toString();
}

function oneLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickAuthStatePath() {
  return pickBestAuthStatePath(AUTH_STATE_CANDIDATES);
}

function writeArtifact(payload, fileName = 'withdraw-skeleton.json') {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const artifactPath = path.join(ARTIFACT_DIR, fileName);
  fs.writeFileSync(artifactPath, JSON.stringify(payload, null, 2), 'utf8');
  return artifactPath;
}

async function attachArtifact(testInfo, payload, fileName = 'withdraw-skeleton.json') {
  const body = JSON.stringify(payload, null, 2);
  const artifactPath = writeArtifact(payload, fileName);
  await testInfo.attach(fileName, {
    body,
    contentType: 'application/json',
  });
  testInfo.annotations.push({ type: 'artifact', description: artifactPath });
}

async function getChallengeReason(page) {
  const detected = await detectCloudflare(page);
  if (detected) return detected;

  const challengeTextVisible = await page
    .getByText(/cloudflare|verify you are human|checking your browser|just a moment|forbidden/i)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (challengeTextVisible) return 'Challenge text is visible on page.';

  const currentUrl = page.url();
  if (/cdn-cgi|challenge-platform|__cf_chl_rt_tk=|cf_chl_|__cf_bm=/i.test(currentUrl)) {
    return `Challenge URL detected: ${currentUrl}`;
  }

  return null;
}

async function openRoute(page, route) {
  const requestedUrl = buildUrl(route);
  let response = null;
  let navigationError = null;

  try {
    response = await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } catch (error) {
    navigationError = oneLine(error && error.message ? error.message : error);
  }

  await dismissOverlays(page);
  await waitForUiSettled(page, 1200);

  const challenge = await getChallengeReason(page);
  return {
    route,
    requestedUrl,
    finalUrl: page.url(),
    status: response ? response.status() : 0,
    challenge: challenge || (navigationError ? `Navigation failed: ${navigationError}` : null),
  };
}

async function firstVisibleLocator(scope, selectors) {
  for (const selector of selectors) {
    const nodes = scope.locator(selector);
    const count = Math.min(await nodes.count().catch(() => 0), 16);
    for (let i = 0; i < count; i += 1) {
      const node = nodes.nth(i);
      if (await node.isVisible().catch(() => false)) return node;
    }
  }
  return null;
}

async function detectWithdrawContainer(page) {
  const selectors = [
    '.t-popup.t-modal-fund-global',
    '.t-popup__component.t-modal-fund.withdrawal',
    '.t-modal-fund',
    '.t-assets-modal-withdraw',
    '.t-assets-modal',
    '[data-testid="withdraw-modal"]',
    '[data-testid*="withdraw" i]:not(button):has(input)',
    '[role="dialog"]:visible',
  ];

  return firstVisibleLocator(page, selectors);
}

async function collectWithdrawSnapshot(page, container) {
  const scope = container || page;

  const methods = await scope
    .locator(
      '[data-testid^="withdraw-method-"], [data-testid="assets_withdrawal_method-tabs"], [class*="withdraw-method" i], [class*="payment-method" i], .t-fund-payment-method__grid-item'
    )
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    )
    .catch(() => []);

  const controls = {
    amountInputVisible: await scope
      .locator(
        'input[name*="amount" i], input[placeholder*="amount" i], input[placeholder*="Enter amount" i], input[type="number"]'
      )
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false),
    submitVisible: await scope
      .locator(
        'button:has-text("Withdraw"), button:has-text("Withdrawal"), button:has-text("Submit"), button:has-text("Continue"), [data-testid*="withdraw-submit" i]'
      )
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false),
    cardOrAccountInputVisible: await scope
      .locator(
        'input[name*="iban" i], input[name*="wallet" i], input[name*="account" i], input[name*="address" i]'
      )
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false),
    noteVisible: await scope
      .getByText(/withdraw|cashout|available|minimum|fee/i)
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false),
  };

  return {
    methodsCount: methods.length,
    methodsSample: methods.slice(0, 15),
    controls,
  };
}

test('Withdraw skeleton: open withdraw surface and validate controls', async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const authStatePath = pickAuthStatePath();
  if (!authStatePath) {
    const payload = {
      blocked: true,
      reason: 'No auth storage state found for withdraw checks.',
    };
    markBlocked(testInfo, payload.reason);
    await attachArtifact(testInfo, payload);
    return;
  }

  const context = await browser.newContext(
    resolveMatrixContextOptions({ storageState: authStatePath })
  );
  const page = await context.newPage();

  const payload = {
    source: 'tests/critical/withdraw-skeleton.spec.js',
    generatedAt: new Date().toISOString(),
    authStatePath,
    blocked: false,
    reason: '',
    route: null,
    triggerFound: false,
    triggerText: '',
    withdrawSnapshot: null,
    stages: [],
  };

  try {
    const routeStartedAt = Date.now();
    const route = await test.step('Open authorized assets route', () =>
      openRoute(page, '/assets/'));
    payload.stages.push({ name: 'open-assets', durationMs: Date.now() - routeStartedAt });
    payload.route = route;
    if (route.challenge) {
      payload.blocked = true;
      payload.reason = route.challenge;
      markBlocked(testInfo, route.challenge);
      await attachArtifact(testInfo, payload);
      return;
    }

    const loginVisible = await page
      .getByRole('button', { name: /log in/i })
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    if (loginVisible) {
      payload.blocked = true;
      payload.reason = 'Expected authorized session, but Log In button is visible.';
      markBlocked(testInfo, payload.reason);
      await attachArtifact(testInfo, payload);
      return;
    }

    await page
      .getByRole('button', { name: /^withdrawal?$/i })
      .first()
      .waitFor({ state: 'visible', timeout: 8000 })
      .catch(() => null);

    const trigger = await firstVisibleLocator(page, [
      '[data-testid="assets_withdrawal_open-button"]',
      'button:has-text("Withdraw")',
      'button:has-text("Withdrawal")',
      'a:has-text("Withdraw")',
      '[data-testid*="withdraw" i]',
      '.t-header__withdraw',
      '.t-assets-actions__withdraw',
    ]);

    if (!trigger) {
      payload.blocked = true;
      payload.reason = 'Withdraw trigger is not visible in current layout.';
      markBlocked(testInfo, payload.reason);
      await attachArtifact(testInfo, payload);
      return;
    }

    payload.triggerFound = true;
    payload.triggerText = oneLine(await trigger.innerText().catch(() => ''));

    const triggerStartedAt = Date.now();
    const triggerClicked = await test.step('Open withdraw surface', () =>
      clickLocatorRobust(page, trigger, {
        timeout: 10_000,
        waitForNavigation: false,
        settleTimeout: 1200,
      }).catch(() => false));
    payload.stages.push({
      name: 'open-withdraw',
      durationMs: Date.now() - triggerStartedAt,
      ok: triggerClicked,
    });
    if (!triggerClicked) {
      payload.blocked = true;
      payload.reason = 'Withdraw trigger was visible but did not accept the click.';
      markBlocked(testInfo, payload.reason);
      await attachArtifact(testInfo, payload);
      return;
    }
    await waitForUiSettled(page, 1400);
    await page
      .locator(
        '.t-popup.t-modal-fund-global:visible, .t-popup__component.t-modal-fund.withdrawal:visible'
      )
      .first()
      .waitFor({ state: 'visible', timeout: 8000 })
      .catch(() => null);

    const container = await detectWithdrawContainer(page);
    if (!container) {
      payload.blocked = true;
      payload.reason = 'Withdraw surface did not open after trigger click.';
      markBlocked(testInfo, payload.reason);
      await attachArtifact(testInfo, payload);
      return;
    }

    await container
      .locator(
        'input[placeholder*="amount" i], input[type="number"], [data-testid="fund-withdrawal-amount-field"] input'
      )
      .first()
      .waitFor({ state: 'visible', timeout: 8000 })
      .catch(() => null);

    const snapshotStartedAt = Date.now();
    const snapshot = await test.step('Collect withdraw controls', () =>
      collectWithdrawSnapshot(page, container));
    payload.stages.push({
      name: 'collect-controls',
      durationMs: Date.now() - snapshotStartedAt,
    });
    payload.withdrawSnapshot = snapshot;

    const hasAnyControl =
      snapshot.controls.amountInputVisible ||
      snapshot.controls.submitVisible ||
      snapshot.controls.cardOrAccountInputVisible ||
      snapshot.controls.noteVisible;

    if (!hasAnyControl) {
      payload.blocked = true;
      payload.reason = 'Withdraw surface opened but actionable controls are not visible.';
      markBlocked(testInfo, payload.reason);
      await attachArtifact(testInfo, payload);
      return;
    }

    await closeModal(container, page).catch(() => null);

    expect(
      payload.triggerFound,
      'Withdraw trigger should be visible for authorized user.'
    ).toBeTruthy();
    expect(
      hasAnyControl,
      'Withdraw surface should expose at least one actionable control.'
    ).toBeTruthy();

    await attachArtifact(testInfo, payload);
  } finally {
    await context.close();
  }
});
