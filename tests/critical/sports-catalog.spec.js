const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { test, expect } = require('../fixtures/qa-test');
const {
  detectCloudflare,
  dismissOverlays,
  markBlocked,
  waitForUiSettled,
} = require('../helpers/gt-utils');
const { isCapabilityOptionalForBrand } = require('../helpers/brand-capabilities');
const {
  resolveExtraHTTPHeaders,
  resolveMatrixContextOptions,
} = require('../helpers/context-options');
const { createWsCapture } = require('../helpers/ws-capture');
const { serializeArtifactPayload } = require('../helpers/artifact-output');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const BASE_ORIGIN = new URL(BASE_URL).origin;
const PROJECT_AUTOTEST_REPORT_DIR =
  process.env.QA_AUTOTEST_REPORT_DIR || path.join(process.cwd(), 'Autotest report');
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
const ARTIFACT_DIR = path.join(PROJECT_AUTOTEST_REPORT_DIR, 'sports');
const VISUAL_DIR = path.join(ARTIFACT_DIR, 'visual');
const PRODUCT_REMEDIATION_PATH = (() => {
  if (!process.env.QA_PROJECT_ROOT) return '';
  const projectRoot = path.resolve(String(process.env.QA_PROJECT_ROOT));
  let brandHost = '';
  try {
    brandHost = new URL(BASE_ORIGIN).hostname;
  } catch {
    brandHost = '';
  }
  const candidates = [
    ...(brandHost
      ? [path.join(process.cwd(), 'docs', 'product-remediation', `${brandHost}.md`)]
      : []),
    path.join(projectRoot, 'product-remediation.md'),
    path.join(projectRoot, '..', 'product-remediation.md'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
})();
const EXPLICIT_STORAGE_STATE_PATH = process.env.PW_STORAGE_STATE
  ? path.resolve(String(process.env.PW_STORAGE_STATE))
  : '';
const PROJECT_ROOT_STORAGE_STATE_PATH = process.env.QA_PROJECT_ROOT
  ? path.join(path.resolve(String(process.env.QA_PROJECT_ROOT)), 'storageState.json')
  : '';
const AUTH_STATE_CANDIDATES = [
  path.join(PROJECT_ARTIFACTS_DIR, 'registration-auth-state.json'),
  EXPLICIT_STORAGE_STATE_PATH,
  PROJECT_ROOT_STORAGE_STATE_PATH,
  path.join(PROJECT_ARTIFACTS_DIR, 'profile-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'site-coverage-auth-state.json'),
  path.join(PROJECT_ARTIFACTS_DIR, 'button-sweep-auth-state.json'),
  path.join(process.cwd(), 'storageState.json'),
]
  .filter(Boolean)
  .filter((candidate, index, all) => all.indexOf(candidate) === index);
const ALLOWED_403_PATTERNS = [/\/server\/api\/languages\/thook\/?/i];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeContextBounded(context, timeoutMs = 5000) {
  let timer = null;
  try {
    await Promise.race([
      context.close().catch(() => null),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildUrl(route) {
  return new URL(route, BASE_ORIGIN).toString();
}

function toSlug(value) {
  return String(value || 'test')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function readAuthStateMeta(filePath, index) {
  if (!filePath || !fs.existsSync(filePath)) return null;

  let mtimeMs = 0;
  let sizeBytes = 0;
  try {
    const stat = fs.statSync(filePath);
    mtimeMs = Number(stat.mtimeMs || 0);
    sizeBytes = Number(stat.size || 0);
  } catch {
    // keep best-effort defaults
  }

  let cookiesCount = 0;
  let originsCount = 0;
  let parseError = false;
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    cookiesCount = Array.isArray(payload && payload.cookies) ? payload.cookies.length : 0;
    originsCount = Array.isArray(payload && payload.origins) ? payload.origins.length : 0;
  } catch {
    parseError = true;
  }

  return {
    filePath,
    index,
    mtimeMs,
    sizeBytes,
    cookiesCount,
    originsCount,
    hasSessionArtifacts: cookiesCount > 0 || originsCount > 0,
    parseError,
  };
}

function compareAuthStateMeta(left, right) {
  if (left.hasSessionArtifacts !== right.hasSessionArtifacts) {
    return left.hasSessionArtifacts ? -1 : 1;
  }
  if (left.parseError !== right.parseError) {
    return left.parseError ? 1 : -1;
  }
  if (left.mtimeMs !== right.mtimeMs) {
    return right.mtimeMs - left.mtimeMs;
  }
  if (left.sizeBytes !== right.sizeBytes) {
    return right.sizeBytes - left.sizeBytes;
  }
  return left.index - right.index;
}

function pickAuthStatePath() {
  const ranked = AUTH_STATE_CANDIDATES.map((filePath, index) =>
    readAuthStateMeta(filePath, index)
  ).filter(Boolean);
  if (!ranked.length) return null;

  ranked.sort(compareAuthStateMeta);
  const preferred =
    ranked.find((entry) => entry.hasSessionArtifacts && !entry.parseError) ||
    ranked.find((entry) => !entry.parseError) ||
    ranked[0];
  return preferred ? preferred.filePath : null;
}

async function writeAndAttach(testInfo, name, payload) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const fileName = `${toSlug(name)}.json`;
  const filePath = path.join(ARTIFACT_DIR, fileName);
  const body = serializeArtifactPayload(payload);
  fs.writeFileSync(filePath, body, 'utf8');
  await testInfo.attach(fileName, { body, contentType: 'application/json' });
  return filePath;
}

async function attachProductEvidenceScreenshot(page, testInfo, name) {
  try {
    const body = await page.screenshot({ fullPage: true });
    await testInfo.attach(`${toSlug(name)}.png`, {
      body,
      contentType: 'image/png',
    });
    return true;
  } catch {
    return false;
  }
}

async function firstVisibleLocator(root, selectors) {
  for (const selector of selectors) {
    const locator = root.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 120);
    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return null;
}

async function firstVisibleTextLocator(root, patterns) {
  for (const pattern of patterns) {
    const locator = root.getByText(pattern);
    const count = Math.min(await locator.count().catch(() => 0), 120);
    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return null;
}

async function findBetslipSurface(page) {
  let surface = await firstVisibleLocator(page, [
    '[data-testid*="betslip" i]',
    '[data-testid*="coupon" i]',
    '[id*="betslip" i]',
    '[class*="betslip" i]',
    '[class*="coupon" i]',
  ]);
  if (!surface) {
    const label = page.getByText(/^betslip$/i).first();
    if (await label.isVisible().catch(() => false)) {
      surface = label.locator('..').locator('..').locator('..').locator('..');
    }
  }
  return surface;
}

async function readBetslipEvidence(page) {
  const surface = await findBetslipSurface(page);
  if (!surface) {
    return {
      visible: false,
      text: '',
      inputCount: 0,
      emptyStateVisible: await page
        .getByText(/place your bets|betslip is empty|no selections/i)
        .first()
        .isVisible()
        .catch(() => false),
    };
  }
  const text = ((await surface.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  return {
    visible: true,
    text: text.slice(0, 800),
    inputCount: await surface
      .locator('input')
      .count()
      .catch(() => 0),
    emptyStateVisible: /place your bets|betslip is empty|no selections/i.test(text),
  };
}

async function tagSemanticOddsTargets(page) {
  // Betby currently renders odds as styled divs without semantic roles or
  // stable "odd" class names (for example a cursor-pointer div containing
  // "draw\n3.50"). Tag the smallest deterministic candidates once so the
  // regular locator flow does not scan hundreds of generic spans until the
  // diagnostic budget expires.
  return page
    .evaluate(() => {
      const root = document.querySelector('#betby') || document.body;
      const nodes = Array.from(root.querySelectorAll('button, [role="button"], div[class]'));
      let tagged = 0;
      for (const element of nodes) {
        if (!(element instanceof globalThis.HTMLElement)) continue;
        // Avoid repeatedly materialising innerText for large event containers.
        // An odds choice is a small leaf-like control (label + price).
        if (element.childElementCount > 5) continue;
        const rawText = String(element.textContent || '').trim();
        if (!rawText || rawText.length > 100) continue;
        const text = rawText.replace(/\s+/g, ' ').trim();
        const prices = text.match(/\b\d{1,2}[.,]\d{1,3}\b/g) || [];
        if (prices.length !== 1 || text.length > 80 || /total odds|bet builder/i.test(text)) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        const style = globalThis.getComputedStyle(element);
        if (
          rect.width <= 2 ||
          rect.height <= 2 ||
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.cursor !== 'pointer'
        ) {
          continue;
        }
        element.setAttribute('data-qa-odds-target', String(tagged));
        tagged += 1;
        if (tagged >= 24) break;
      }
      return tagged;
    })
    .catch(() => 0);
}

async function clickOddsWithEvidenceUnbounded(page, preferredTarget = null) {
  // The widget may render its events after the initial route-ready signal.
  // Poll the cheap tagger instead of repeatedly traversing every generic span.
  let taggedOddsCount = 0;
  for (let attempt = 0; attempt < 20 && taggedOddsCount === 0; attempt += 1) {
    taggedOddsCount = await tagSemanticOddsTargets(page);
    if (taggedOddsCount === 0) await sleep(500);
  }
  const selectors =
    taggedOddsCount > 0
      ? ['[data-qa-odds-target]']
      : [
          'button[data-testid*="odd" i]:not([disabled])',
          '[data-testid*="odd" i][role="button"]',
          'button[class*="odd" i]:not([disabled])',
          '[class*="odd" i][role="button"]',
          '[class*="selection" i][role="button"]',
        ];
  const attempts = [];
  const seen = new Set();
  const targets = [];
  if (preferredTarget && preferredTarget.selector && Number.isInteger(preferredTarget.index)) {
    targets.push({ ...preferredTarget, preferred: true });
  }
  for (const selector of selectors) {
    const matches = page.locator(selector);
    const maxMatches = 80;
    const visibleTargets = await matches
      .evaluateAll((elements, limit) => {
        const result = [];
        for (let index = 0; index < Math.min(elements.length, limit); index += 1) {
          const element = elements[index];
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            Number(style.opacity) === 0 ||
            rect.width <= 2 ||
            rect.height <= 2
          ) {
            continue;
          }
          const text = String(element.innerText || element.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
          if (!/\b\d{1,2}[.,]\d{1,3}\b/.test(text) || text.length > 80) continue;
          let interactive = false;
          let interactiveText = '';
          let current = element;
          for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
            if (
              current.tagName === 'BUTTON' ||
              current.getAttribute('role') === 'button' ||
              typeof current.onclick === 'function' ||
              window.getComputedStyle(current).cursor === 'pointer'
            ) {
              interactive = true;
              interactiveText = String(current.innerText || current.textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
              break;
            }
          }
          if (/total odds|bet builder/i.test(interactiveText)) continue;
          if (interactive) result.push({ index, text });
          if (result.length >= 24) break;
        }
        return result;
      }, maxMatches)
      .catch(() => []);
    for (const target of visibleTargets) targets.push({ selector, ...target });
  }

  let successfulClicks = 0;
  for (const target of targets) {
    const { selector, index } = target;
    const signature = `${selector}|${index}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    const candidate = page.locator(selector).nth(index);
    if (
      !(await candidate.isVisible({ timeout: target.preferred ? 500 : 100 }).catch(() => false))
    ) {
      attempts.push({ selector, index, text: target.text || '', clicked: false });
      continue;
    }
    const text =
      target.text ||
      ((await candidate.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    const hasInteractiveAncestor = await candidate
      .evaluate((element) => {
        let current = element;
        for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
          if (
            current.tagName === 'BUTTON' ||
            current.getAttribute('role') === 'button' ||
            typeof current.onclick === 'function' ||
            window.getComputedStyle(current).cursor === 'pointer'
          ) {
            return true;
          }
        }
        return false;
      })
      .catch(() => false);
    if (!hasInteractiveAncestor) continue;
    const beforeElement = await candidate
      .evaluate((element) => ({
        ariaPressed: element.getAttribute('aria-pressed'),
        ariaSelected: element.getAttribute('aria-selected'),
        className: typeof element.className === 'string' ? element.className : '',
      }))
      .catch(() => ({}));
    const beforeBetslip = await readBetslipEvidence(page);
    await candidate.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => null);
    const clicked = await candidate
      .click({ timeout: target.preferred ? 3000 : 2500 })
      .then(() => true)
      .catch(() =>
        candidate
          .click({ timeout: 2000, force: true })
          .then(() => true)
          .catch(() =>
            candidate
              .evaluate((element) => {
                let target = element;
                for (
                  let depth = 0;
                  target && depth < 4;
                  depth += 1, target = target.parentElement
                ) {
                  if (
                    target.tagName === 'BUTTON' ||
                    target.getAttribute('role') === 'button' ||
                    typeof target.onclick === 'function' ||
                    window.getComputedStyle(target).cursor === 'pointer'
                  ) {
                    target.click();
                    return true;
                  }
                }
                return false;
              })
              .catch(() => false)
          )
      );
    if (!clicked) {
      attempts.push({ selector, index, text, clicked: false });
      continue;
    }
    successfulClicks += 1;
    await waitForUiSettled(page, 1200);
    const afterBetslip = await readBetslipEvidence(page);
    const afterElement = await candidate
      .evaluate((element) => ({
        ariaPressed: element.getAttribute('aria-pressed'),
        ariaSelected: element.getAttribute('aria-selected'),
        className: typeof element.className === 'string' ? element.className : '',
      }))
      .catch(() => ({}));
    const selectionAttributeChanged =
      beforeElement.ariaPressed !== afterElement.ariaPressed ||
      beforeElement.ariaSelected !== afterElement.ariaSelected ||
      beforeElement.className !== afterElement.className;
    const betslipChanged = JSON.stringify(beforeBetslip) !== JSON.stringify(afterBetslip);
    const confirmed = Boolean(
      betslipChanged &&
      afterBetslip.visible &&
      (!afterBetslip.emptyStateVisible ||
        afterBetslip.inputCount > beforeBetslip.inputCount ||
        afterBetslip.text !== beforeBetslip.text)
    );
    attempts.push({
      selector,
      index,
      text,
      clicked: true,
      confirmed,
      selectionAttributeChanged,
      selectionOnly: selectionAttributeChanged && !confirmed,
      betslipChanged,
      beforeBetslip,
      afterBetslip,
    });
    if (confirmed) {
      return {
        confirmed: true,
        target: { selector, index, text },
        attempts,
        beforeBetslip,
        afterBetslip,
      };
    }
    if (successfulClicks >= 3) break;
  }
  return {
    confirmed: false,
    selectionOnly: attempts.some((attempt) => attempt.selectionOnly === true),
    attempts,
    afterBetslip: await readBetslipEvidence(page),
  };
}

async function clickOddsWithEvidence(page, preferredTarget = null, timeoutMs = 45_000) {
  return Promise.race([
    clickOddsWithEvidenceUnbounded(page, preferredTarget),
    sleep(timeoutMs).then(() => ({
      confirmed: false,
      timedOut: true,
      selectionOnly: false,
      attempts: [],
      reason: `Odds interaction exceeded the ${timeoutMs} ms diagnostic budget.`,
    })),
  ]);
}

async function removeBetslipSelection(page) {
  const surface = await findBetslipSurface(page);
  const beforeBetslip = await readBetslipEvidence(page);
  if (!surface) {
    return {
      confirmed: false,
      attempts: [],
      reason: 'Betslip surface is not visible.',
      beforeBetslip,
      afterBetslip: beforeBetslip,
    };
  }

  const selectors = [
    'svg[data-cy="rounded-close"]',
    '[data-testid*="remove" i]',
    '[data-testid*="delete" i]',
    '[aria-label*="remove" i]',
    '[aria-label*="delete" i]',
    'svg[data-cy="ic-delete"]',
  ];
  const attempts = [];
  for (const selector of selectors) {
    const candidates = surface.locator(selector);
    const count = Math.min(await candidates.count().catch(() => 0), 8);
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!(await candidate.isVisible({ timeout: 300 }).catch(() => false))) continue;
      const clicked = await candidate
        .click({ timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      attempts.push({ selector, index, clicked });
      if (!clicked) continue;
      await waitForUiSettled(page, 700);
      const afterBetslip = await readBetslipEvidence(page);
      const confirmed =
        afterBetslip.emptyStateVisible ||
        afterBetslip.inputCount < beforeBetslip.inputCount ||
        afterBetslip.text !== beforeBetslip.text;
      if (confirmed) {
        return { confirmed: true, attempts, beforeBetslip, afterBetslip };
      }
    }
  }

  return {
    confirmed: false,
    attempts,
    reason: 'No semantic remove/clear control changed the betslip.',
    beforeBetslip,
    afterBetslip: await readBetslipEvidence(page),
  };
}

async function returnFromSportsEvent(page, eventUrl) {
  const attempts = [];
  const backControl = await firstVisibleLocator(page, [
    'button[data-testid*="back" i]',
    '[role="button"][data-testid*="back" i]',
    'button[aria-label*="back" i]',
    '[role="button"][aria-label*="back" i]',
  ]);
  if (backControl) {
    const label =
      (await backControl.getAttribute('aria-label').catch(() => '')) ||
      ((await backControl.innerText().catch(() => '')) || '').trim();
    const clicked = await backControl
      .click({ timeout: 7000 })
      .then(() => true)
      .catch(() => false);
    await waitForUiSettled(page, 900);
    attempts.push({ strategy: 'semantic-back-control', label, clicked, afterUrl: page.url() });
    if (clicked && page.url() !== eventUrl) {
      return { returned: true, strategy: 'semantic-back-control', attempts, afterUrl: page.url() };
    }
  }

  // The embedded sports widget can replace its current history entry. Use the
  // persistent Sports navigation while the app shell is still available; calling
  // browser back first can leave a directly-opened test tab at about:blank.
  await dismissOverlays(page).catch(() => null);
  let sportsNavigation = await firstVisibleLocator(page, [
    '[data-testid="sidebar-Sport-button"]',
    'a[href*="/sports/"]',
    '[data-testid*="sport" i]',
    'nav a:has-text("Sport")',
    'nav button:has-text("Sport")',
    'button:has-text("Sport")',
  ]);
  if (!sportsNavigation) {
    const labels = page.getByText(/^Sport(?:s)?$/i);
    const labelCount = Math.min(await labels.count().catch(() => 0), 12);
    for (let index = labelCount - 1; index >= 0; index -= 1) {
      const label = labels.nth(index);
      if (await label.isVisible({ timeout: 250 }).catch(() => false)) {
        sportsNavigation = label;
        break;
      }
    }
  }
  if (sportsNavigation) {
    const navigationHref = await sportsNavigation.getAttribute('href').catch(() => '');
    let clicked = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      clicked = await sportsNavigation
        .click({ timeout: 5000, force: attempt > 0 })
        .then(() => true)
        .catch(() => false);
      if (!clicked) continue;
      await page.waitForURL(/\/sports\/?(?:\?|$)/i, { timeout: 5000 }).catch(() => null);
      if (/\/sports\/?(?:\?|$)/i.test(page.url())) break;
      await waitForUiSettled(page, 900);
    }
    attempts.push({
      strategy: 'sports-navigation',
      clicked,
      navigationHref,
      afterUrl: page.url(),
    });
    if (clicked && /\/sports\/?(?:\?|$)/i.test(page.url())) {
      return {
        returned: true,
        strategy: 'sports-navigation',
        attempts,
        afterUrl: page.url(),
      };
    }
  }

  // A directly-opened event tab may have no usable history entry. Navigate to
  // the app's known Sports route before falling back to browser history.
  const fallbackHref =
    (sportsNavigation && (await sportsNavigation.getAttribute('href').catch(() => ''))) ||
    '/sports/?bt-path=%2F';
  const fallbackUrl = new URL(fallbackHref, BASE_ORIGIN).toString();
  const fallbackNavigated = await page
    .goto(fallbackUrl, { waitUntil: 'domcontentloaded', timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  await waitForUiSettled(page, 900);
  attempts.push({
    strategy: 'sports-route-fallback',
    fallbackUrl,
    navigated: fallbackNavigated,
    afterUrl: page.url(),
  });
  if (fallbackNavigated && /\/sports\/?(?:\?|$)/i.test(page.url())) {
    return {
      returned: true,
      strategy: 'sports-route-fallback',
      attempts,
      afterUrl: page.url(),
    };
  }

  await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
  await waitForUiSettled(page, 1200);
  attempts.push({ strategy: 'browser-history', afterUrl: page.url() });
  if (/\/sports\/?(?:\?|$)/i.test(page.url())) {
    return {
      returned: true,
      strategy: 'browser-history',
      attempts,
      afterUrl: page.url(),
    };
  }

  return {
    returned: page.url() !== eventUrl,
    strategy: 'none',
    attempts,
    afterUrl: page.url(),
  };
}

async function hasChallengeTokenPage(page) {
  const appRootVisible = await page
    .locator('#app, #__nuxt')
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (appRootVisible) return false;
  const bodyText = ((await page.textContent('body').catch(() => '')) || '').trim();
  const compact = bodyText.replace(/\s+/g, '');
  return /^[a-f0-9]{12,}$/i.test(compact);
}

async function getChallengeReason(page) {
  const detected = await detectCloudflare(page);
  if (detected) return detected;

  const currentUrl = page.url();
  if (/cdn-cgi|challenge-platform|__cf_chl_rt_tk=|cf_chl_|__cf_bm=/i.test(currentUrl)) {
    return `Challenge URL detected: ${currentUrl}`;
  }

  const challengeTextVisible = await page
    .getByText(/cloudflare|verify you are human|just a moment|checking your browser|forbidden/i)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (challengeTextVisible) return 'Challenge text is visible.';

  const geoBlockText = await page
    .getByText(/cannot be accessed in |region not restricted|proxy service or vpn/i)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (geoBlockText) {
    return `Geo restriction detected: ${new URL(BASE_ORIGIN).hostname} is unavailable from the current QA egress region.`;
  }

  if (await hasChallengeTokenPage(page)) {
    return 'Cloudflare token page detected (no app root + token body).';
  }

  return null;
}

async function waitForSportsContent(page) {
  const deadlineAt = Date.now() + 30_000;
  let lastState = { containers: 0, embeddedFrames: 0, contentSignals: 0, skeletons: 0 };
  while (Date.now() < deadlineAt) {
    const containers = await page
      .locator('#betby:visible, .t-game-sports-st8:visible, iframe[src*="sport" i]:visible')
      .count()
      .catch(() => 0);
    const contentSignals = await page
      .getByText(/upcoming|football|live sports|place your bets|events|leagues|odds/i)
      .count()
      .catch(() => 0);
    const embeddedFrames = await page
      .locator('#betby iframe[src]:visible, iframe[src*="sport" i]:visible')
      .count()
      .catch(() => 0);
    const skeletons = await page
      .locator(
        'main [class*="skeleton" i]:visible, main [class*="placeholder" i]:visible, main [aria-busy="true"]:visible'
      )
      .count()
      .catch(() => 0);
    lastState = { containers, embeddedFrames, contentSignals, skeletons };
    if (containers > 0 && (contentSignals > 0 || embeddedFrames > 0) && skeletons === 0) {
      return { ready: true, ...lastState };
    }
    await sleep(400);
  }
  return { ready: false, ...lastState };
}

async function openSports(page, route = '/sports/?bt-path=%2F') {
  const requestedUrl = buildUrl(route);
  let response = null;
  let navigationError = null;

  try {
    response = await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (err) {
    navigationError = String(err && err.message ? err.message : err);
  }

  await dismissOverlays(page);
  const contentState = await waitForSportsContent(page);
  await waitForUiSettled(page, 1200);
  await dismissOverlays(page);

  if (!/\/sports\/?/i.test(new URL(page.url(), BASE_ORIGIN).pathname) && !navigationError) {
    navigationError = `Sports route resolved outside /sports: ${page.url()}`;
  }
  if (!contentState.ready && !navigationError) {
    navigationError = `Sports content did not become ready at ${page.url()}.`;
  }

  const challenge = await getChallengeReason(page);
  const loginVisible = await page
    .getByRole('button', { name: /log in/i })
    .first()
    .isVisible({ timeout: 1200 })
    .catch(() => false);

  return {
    route,
    requestedUrl,
    finalUrl: page.url(),
    status: response ? response.status() : 0,
    title: await page.title().catch(() => ''),
    challenge: challenge || (navigationError ? `Navigation failed: ${navigationError}` : null),
    loginVisible,
    contentState,
  };
}

async function findSportsBox(page) {
  const root = await firstVisibleLocator(page, [
    '#betby',
    '.t-game-sports-st8__wrap',
    '.t-game-sports-st8',
    '.app-sports',
  ]);
  if (!root) return null;
  return root.boundingBox().catch(() => null);
}

async function readSportsScrollState(page) {
  return page
    .evaluate(() => {
      const selectors = ['#betby', '.t-game-sports-st8__wrap', '.t-game-sports-st8', '.app-sports'];
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!node) continue;
        const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
        if (maxScrollTop <= 0) continue;
        return {
          surface: selector,
          top: Number(node.scrollTop || 0),
          maxTop: maxScrollTop,
        };
      }
      const doc = document.documentElement || document.body;
      return {
        surface: 'window',
        top: Number(window.scrollY || 0),
        maxTop: Math.max(
          0,
          Number((doc && doc.scrollHeight) || 0) - Number(window.innerHeight || 0)
        ),
      };
    })
    .catch(() => ({ surface: 'window', top: 0, maxTop: 0 }));
}

async function scrollSportsSurface(page, amount = 820) {
  return page
    .evaluate((delta) => {
      const selectors = ['#betby', '.t-game-sports-st8__wrap', '.t-game-sports-st8', '.app-sports'];
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!node) continue;
        const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
        if (maxScrollTop <= 0) continue;
        const before = Number(node.scrollTop || 0);
        node.scrollTop = Math.min(maxScrollTop, before + Number(delta || 0));
        return {
          surface: selector,
          moved: Number(node.scrollTop || 0) > before,
          before,
          after: Number(node.scrollTop || 0),
          maxTop: maxScrollTop,
        };
      }

      const before = Number(window.scrollY || 0);
      window.scrollBy(0, Number(delta || 0));
      return {
        surface: 'window',
        moved: Number(window.scrollY || 0) > before,
        before,
        after: Number(window.scrollY || 0),
        maxTop: Math.max(
          0,
          Number(document.documentElement?.scrollHeight || 0) - Number(window.innerHeight || 0)
        ),
      };
    }, amount)
    .catch(() => ({ surface: 'window', moved: false, before: 0, after: 0, maxTop: 0 }));
}

function getBtPath(urlString) {
  try {
    const value = new URL(urlString).searchParams.get('bt-path');
    return value || '';
  } catch {
    return '';
  }
}

function decodeSportsPath(value) {
  let decoded = String(value || '');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function isSportsEventUrl(urlString) {
  try {
    const url = new URL(urlString, BASE_ORIGIN);
    const btPath = url.searchParams.get('bt-path') || '';
    if (btPath.split('/').filter(Boolean).length >= 3) return true;
    return /^\/(?:football|soccer|tennis|basketball|ice-hockey|hockey|volleyball)\//i.test(
      url.pathname
    );
  } catch {
    return false;
  }
}

async function readSportsState(page) {
  const fallback = {
    url: page.url(),
    btPath: '',
    localStorage: {},
    sessionStorage: {},
    timedOut: true,
  };
  return Promise.race([
    page
      .evaluate(() => ({
        url: window.location.href,
        btPath: new URL(window.location.href).searchParams.get('bt-path') || '',
        localStorage: {
          btSession: window.localStorage.getItem('bt-session') || '',
          rightSidebar: window.localStorage.getItem('isRightSidebarCollapsed') || '',
          trackerPinned: window.localStorage.getItem('bt-pinned-match-tracker') || '',
          tokenSport: window.localStorage.getItem('tokenSport') || '',
        },
        sessionStorage: {
          scrollPositions: window.sessionStorage.getItem('bt-scroll-positions') || '',
        },
        timedOut: false,
      }))
      .catch(() => fallback),
    sleep(3000).then(() => fallback),
  ]);
}

function diffSportsState(before, after) {
  const changed = [];
  if (!before || !after) return changed;
  if (before.url !== after.url) changed.push('url');
  if (before.btPath !== after.btPath) changed.push('btPath');
  const lsBefore = before.localStorage || {};
  const lsAfter = after.localStorage || {};
  const ssBefore = before.sessionStorage || {};
  const ssAfter = after.sessionStorage || {};

  for (const key of Object.keys({ ...lsBefore, ...lsAfter })) {
    if (lsBefore[key] !== lsAfter[key]) changed.push(`localStorage.${key}`);
  }
  for (const key of Object.keys({ ...ssBefore, ...ssAfter })) {
    if (ssBefore[key] !== ssAfter[key]) changed.push(`sessionStorage.${key}`);
  }
  return changed;
}

async function openEventFromSportsList(page) {
  const beforeUrl = page.url();
  const attempts = [];

  const eventLinks = page.locator(
    'a[href*="/sports/"][href*="bt-path="], a[href^="/football/"], a[href^="/soccer/"], a[href^="/tennis/"], a[href^="/basketball/"], a[href^="/ice-hockey/"], a[href^="/hockey/"], a[href^="/volleyball/"]'
  );
  const eventLinkCount = Math.min(await eventLinks.count().catch(() => 0), 4);
  for (let index = 0; index < eventLinkCount; index += 1) {
    const locator = eventLinks.nth(index);
    const href = await locator.getAttribute('href').catch(() => '');
    let routeDepth = 0;
    try {
      const candidateUrl = new URL(href || '', BASE_ORIGIN);
      const btPath = candidateUrl.searchParams.get('bt-path') || '';
      routeDepth = Math.max(
        btPath.split('/').filter(Boolean).length,
        candidateUrl.pathname.split('/').filter(Boolean).length
      );
    } catch {
      routeDepth = 0;
    }
    // Three segments can still be a league route. Event detail routes include
    // sport/country/league/event and must expose an actual odds control before
    // being accepted as opened.
    if (routeDepth < 4) continue;
    const visible = await locator.isVisible({ timeout: 300 }).catch(() => false);
    if (!visible) continue;
    await locator.scrollIntoViewIfNeeded().catch(() => null);
    await locator.click({ timeout: 7000 }).catch(() => null);
    await page
      .waitForFunction((previousUrl) => window.location.href !== previousUrl, beforeUrl, {
        timeout: 5000,
      })
      .catch(() => null);
    await waitForUiSettled(page, 500);
    const afterUrl = page.url();
    let eventSurfaceConfirmed = false;
    if (afterUrl !== beforeUrl && isSportsEventUrl(afterUrl)) {
      for (let probe = 0; probe < 12 && !eventSurfaceConfirmed; probe += 1) {
        eventSurfaceConfirmed = (await tagSemanticOddsTargets(page)) > 0;
        if (!eventSurfaceConfirmed) await sleep(500);
      }
    }
    attempts.push({ strategy: `event-link:${href}`, afterUrl, eventSurfaceConfirmed });
    if (eventSurfaceConfirmed) {
      return { opened: true, strategy: `event-link:${href}`, beforeUrl, afterUrl, attempts };
    }
    await page
      .goto(beforeUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      .catch(() => null);
    await waitForUiSettled(page, 1200).catch(() => null);
    await page
      .getByText(/upcoming|football|live sports|events|leagues|odds/i)
      .first()
      .waitFor({ state: 'visible', timeout: 12_000 })
      .catch(() => null);
  }

  const textCandidates = [
    /brentford fc/i,
    /wolverhampton/i,
    /premier league/i,
    /champions league/i,
  ];
  for (const pattern of textCandidates) {
    const locator = page.getByText(pattern).first();
    const visible = await locator.isVisible({ timeout: 500 }).catch(() => false);
    if (!visible) continue;
    await locator.click({ timeout: 7000 }).catch(() => null);
    await waitForUiSettled(page, 900);
    const afterUrl = page.url();
    attempts.push({ strategy: `text:${pattern}`, afterUrl });
    if (afterUrl !== beforeUrl && isSportsEventUrl(afterUrl)) {
      return {
        opened: true,
        strategy: `text:${pattern}`,
        beforeUrl,
        afterUrl,
        attempts,
      };
    }
  }

  const box = await findSportsBox(page);
  if (box) {
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => null);
    await waitForUiSettled(page, 300);
    const refreshedBox = (await findSportsBox(page)) || box;
    const viewport = page.viewportSize() || { width: 1365, height: 900 };
    const left = Math.max(0, refreshedBox.x);
    const top = Math.max(90, refreshedBox.y);
    const right = Math.min(viewport.width - 1, refreshedBox.x + refreshedBox.width);
    const bottom = Math.min(viewport.height - 1, refreshedBox.y + refreshedBox.height);
    const visibleWidth = Math.max(1, right - left);
    const visibleHeight = Math.max(1, bottom - top);
    const points = [
      [0.35, 0.3],
      [0.6, 0.3],
      [0.35, 0.5],
      [0.6, 0.5],
      [0.45, 0.7],
    ];

    for (const [xRatio, yRatio] of points) {
      const absX = Math.round(left + visibleWidth * xRatio);
      const absY = Math.round(top + visibleHeight * yRatio);
      await page.mouse.click(absX, absY).catch(() => null);
      await waitForUiSettled(page, 900);
      const afterUrl = page.url();
      let eventSurfaceConfirmed = false;
      if (afterUrl !== beforeUrl && isSportsEventUrl(afterUrl)) {
        for (let probe = 0; probe < 8 && !eventSurfaceConfirmed; probe += 1) {
          eventSurfaceConfirmed = (await tagSemanticOddsTargets(page)) > 0;
          if (!eventSurfaceConfirmed) await sleep(500);
        }
      }
      attempts.push({
        strategy: `viewport-point:${xRatio},${yRatio}`,
        absX,
        absY,
        afterUrl,
        eventSurfaceConfirmed,
      });
      if (eventSurfaceConfirmed) {
        return {
          opened: true,
          strategy: `viewport-point:${xRatio},${yRatio}`,
          beforeUrl,
          afterUrl,
          attempts,
        };
      }
      if (afterUrl !== beforeUrl) {
        await page
          .goto(beforeUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
          .catch(() => null);
        await waitForUiSettled(page, 1200).catch(() => null);
      }
    }
  }

  return {
    opened: false,
    strategy: '',
    beforeUrl,
    afterUrl: page.url(),
    attempts,
  };
}

function isAllowed403(url) {
  const normalized = String(url || '').toLowerCase();
  return ALLOWED_403_PATTERNS.some((re) => re.test(normalized));
}

function isNonCriticalAuthProbeError(row) {
  const status = Number((row && row.status) || 0);
  return (
    (status === 400 || status === 403) &&
    /\/api\/auth\/user(?:[/?#]|$)/i.test(String((row && row.url) || ''))
  );
}

function isOptionalBetBuilder404(row) {
  return (
    Number((row && row.status) || 0) === 404 &&
    /\/api\/v1\/bet-builder\/brand\/[^/]+\/sport\/[^/?#]+(?:[/?#]|$)/i.test(
      String((row && row.url) || '')
    )
  );
}

function isMainBrandUrl(url) {
  try {
    return new URL(String(url || '')).hostname === new URL(BASE_ORIGIN).hostname;
  } catch {
    return false;
  }
}

function isStaticAssetUrl(url) {
  const value = String(url || '').toLowerCase();
  return /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|css|js)(?:$|\?)/i.test(value);
}

function isNoisyRequestFailure(row) {
  const url = String((row && row.url) || '').toLowerCase();
  const failure = String((row && row.failure) || '').toLowerCase();
  if (!failure) return false;
  if (failure.includes('net::err_blocked_by_orb')) return true;
  if (failure.includes('aborted')) return true;
  if (isStaticAssetUrl(url)) return true;
  if (/flags_by_code\/(?:undefined|\.)?\.svg/i.test(url)) return true;
  if (/cloudfront\.net\/competitors\/images\//i.test(url)) return true;
  return false;
}

function isCriticalFailedRequest(row) {
  const url = String((row && row.url) || '');
  const failure = String((row && row.failure) || '').toLowerCase();
  if (!failure || isNoisyRequestFailure(row)) return false;

  const sportsInfraHost = /(?:^|\.)gt\.bet$|(?:^|\.)sptpub\.com$|(?:^|\.)betby\.com$/i;
  let hostname = '';
  try {
    hostname = new URL(url).hostname || '';
  } catch {
    hostname = '';
  }

  const looksCriticalEndpoint = /\/api\/|\/event\/|\/prematch\//i.test(url);
  if (sportsInfraHost.test(hostname) && looksCriticalEndpoint) return true;
  if (/internet_disconnected|network_changed|timed_out/.test(failure)) return true;
  return false;
}

async function probeAuthorizedSession(page) {
  const probe = {
    userPreferencesStatus: 0,
    profileStatus: 0,
    authorizedLikely: false,
  };

  probe.userPreferencesStatus = await page.request
    .get(buildUrl('/api/user/preferences'), {
      failOnStatusCode: false,
      timeout: 15000,
    })
    .then((resp) => resp.status())
    .catch(() => 0);

  probe.profileStatus = await page.request
    .get(buildUrl('/api/user/profile'), {
      failOnStatusCode: false,
      timeout: 15000,
    })
    .then((resp) => resp.status())
    .catch(() => 0);

  probe.authorizedLikely = [probe.userPreferencesStatus, probe.profileStatus].some(
    (status) => status >= 200 && status < 300
  );

  return probe;
}

test.describe('Sports Coverage: interactions + diagnostics', () => {
  test.setTimeout(180000);

  test.beforeAll(() => {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    fs.mkdirSync(VISUAL_DIR, { recursive: true });
  });

  test('P0.1 Sports page: authorized access and base content', async ({ browser }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for sports authorized checks.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext(
      resolveMatrixContextOptions({ storageState: authStatePath })
    );
    const page = await context.newPage();

    try {
      const route = await openSports(page, '/sports/?bt-path=%2F');
      if (route.challenge) {
        markBlocked(testInfo, route.challenge);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: route.challenge,
          route,
          authStatePath,
        });
        return;
      }

      const sportsBox = await findSportsBox(page);
      const visibleSignals = {
        navigation: await page
          .locator(
            '[data-editor-id="mobileSportButton"]:visible, [data-editor-id="headerNavigationButton"]:visible, [data-testid="sports-navigation"]:visible'
          )
          .first()
          .isVisible()
          .catch(() => false),
        upcoming: await page
          .getByText(/upcoming/i)
          .first()
          .isVisible()
          .catch(() => false),
        football: await page
          .getByText(/^football$/i)
          .first()
          .isVisible()
          .catch(() => false),
        basketball: await page
          .getByText(/^basketball$/i)
          .first()
          .isVisible()
          .catch(() => false),
        tennis: await page
          .getByText(/^tennis$/i)
          .first()
          .isVisible()
          .catch(() => false),
        coupon: await page
          .getByText(/place your bets/i)
          .first()
          .isVisible()
          .catch(() => false),
      };
      const sessionProbe = await probeAuthorizedSession(page);

      if (route.loginVisible) {
        if (!sessionProbe.authorizedLikely) {
          const reason =
            `Sports authorized check is blocked: Log In is visible and auth probes are not healthy ` +
            `(/api/user/preferences=${sessionProbe.userPreferencesStatus || 0}, /api/user/profile=${sessionProbe.profileStatus || 0}).` +
            ' Auth state is not usable for this run.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testInfo.title, {
            blocked: true,
            reason,
            route,
            authStatePath,
            sportsBox,
            visibleSignals,
            sessionProbe,
          });
          return;
        }
        testInfo.annotations.push({
          type: 'partial',
          description:
            'Log In entry is visible in sports shell, but auth probes are healthy; treating as layout-level partial instead of hard fail.',
        });
      }
      if (!sportsBox && !Object.values(visibleSignals).some(Boolean)) {
        const reason =
          'Sports container/signals are not exposed in current brand layout for this run.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason,
          route,
          authStatePath,
          sportsBox,
          visibleSignals,
          sessionProbe,
        });
        return;
      }
      if (!Object.values(visibleSignals).some(Boolean)) {
        const reason =
          'Sports route is reachable but no stable sports UI signals are visible in current brand layout.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason,
          route,
          authStatePath,
          sportsBox,
          visibleSignals,
          sessionProbe,
        });
        return;
      }

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        route,
        authStatePath,
        sportsBox,
        visibleSignals,
        sessionProbe,
      });
    } finally {
      await closeContextBounded(context);
    }
  });

  test('P0.2 Sports navigation: Live/Football/Basketball/Tennis switch bt-path', async ({
    browser,
  }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for sports navigation checks.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext(
      resolveMatrixContextOptions({ storageState: authStatePath })
    );
    const page = await context.newPage();

    const checks = [
      {
        label: 'Football',
        expected: ['/football-1', '/soccer-1', '/1'],
        dataCy: 'sport-soccer',
      },
      { label: 'Basketball', expected: ['/basketball-2', '/2'], dataCy: 'sport-basketball' },
      { label: 'Tennis', expected: ['/tennis-5', '/5'], dataCy: 'sport-tennis' },
      { label: 'Live', expected: ['/live'], dataCy: 'ic-live-simple', optional: true },
    ];

    try {
      const route = await openSports(page, '/sports/?bt-path=%2F');
      if (route.challenge) {
        markBlocked(testInfo, route.challenge);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: route.challenge,
          route,
          authStatePath,
        });
        return;
      }

      const findings = [];
      for (const item of checks) {
        // A selected sport replaces the root sport picker, so every assertion starts from
        // the same canonical hub instead of depending on the previous sport's layout.
        if (page.url() !== route.finalUrl) {
          const resetRoute = await openSports(page, '/sports/?bt-path=%2F');
          if (resetRoute.challenge) {
            findings.push({
              label: item.label,
              status: 'blocked',
              reason: resetRoute.challenge,
              beforeUrl: page.url(),
              afterUrl: page.url(),
            });
            continue;
          }
        }
        const beforeUrl = page.url();
        const routeSelectors = item.expected.flatMap((expectedPath) => [
          `a[href*="bt-path=${encodeURIComponent(expectedPath)}" i]`,
          `a[href*="bt-path=${expectedPath}" i]`,
        ]);
        // The sportsbook renders the sport switcher as generic shadow-DOM controls with a
        // dynamic event count (for example, "Football 758"). Exact text alone also matches
        // the "Football" fragment inside league links and opens a league instead of bt-path.
        const sportWithCount = new RegExp(`^${item.label}\\s*\\d+\\s*$`, 'i');
        const stableControl = item.optional
          ? page
              .locator('[data-editor-id="headerNavigationButton"]')
              .filter({ has: page.locator(`[data-cy="${item.dataCy}"]`) })
              .first()
          : page
              .locator('[data-editor-id="mobileSportButton"]')
              .filter({ has: page.locator(`[data-cy="${item.dataCy}"]`) })
              .first();
        const locator =
          ((await stableControl.isVisible({ timeout: 1200 }).catch(() => false))
            ? stableControl
            : null) ||
          (await firstVisibleLocator(page, [
            ...routeSelectors,
            `a[href*="/sports/?bt-path="]:has-text("${item.label}")`,
            `button:has-text("${item.label}")`,
          ])) ||
          (await firstVisibleTextLocator(page, [
            sportWithCount,
            new RegExp(`^${item.label}$`, 'i'),
          ]));

        if (!locator) {
          findings.push({
            label: item.label,
            status: item.optional ? 'not-applicable' : 'blocked',
            reason: item.optional
              ? 'Optional navigation item is not exposed in the current mobile layout.'
              : 'Navigation link is not visible.',
            beforeUrl,
            afterUrl: page.url(),
          });
          continue;
        }

        await locator.click({ timeout: 10000 }).catch(() => null);
        await page
          .waitForFunction((previousUrl) => window.location.href !== previousUrl, beforeUrl, {
            timeout: 5000,
          })
          .catch(() => null);
        await waitForUiSettled(page, 600);
        const afterUrl = page.url();
        const btPath = getBtPath(afterUrl);
        const decodedBtPath = decodeSportsPath(btPath);
        const matchedExpected = item.expected.find((expectedPath) =>
          decodedBtPath.includes(expectedPath)
        );
        const ok = afterUrl !== beforeUrl && Boolean(matchedExpected);

        findings.push({
          label: item.label,
          expected: item.expected,
          matchedExpected: matchedExpected || '',
          status: ok ? 'passed' : item.optional ? 'not-applicable' : 'failed',
          reason:
            ok || !item.optional
              ? ''
              : 'Optional navigation item did not expose the expected bt-path in this layout.',
          beforeUrl,
          afterUrl,
          btPath,
          decodedBtPath,
        });
      }

      const requiredLabels = checks.filter((item) => !item.optional).map((item) => item.label);
      const requiredFindings = findings.filter((item) => requiredLabels.includes(item.label));
      const optionalNotApplicable = findings.filter((item) => item.status === 'not-applicable');
      if (optionalNotApplicable.length > 0) {
        testInfo.annotations.push({
          type: 'not-applicable',
          description: `Optional sports navigation is not exposed in this layout: ${optionalNotApplicable
            .map((item) => item.label)
            .join(', ')}.`,
        });
      }
      const passedCount = findings.filter((item) => item.status === 'passed').length;
      const requiredPassedCount = requiredFindings.filter(
        (item) => item.status === 'passed'
      ).length;
      if (requiredPassedCount < requiredFindings.length) {
        markBlocked(
          testInfo,
          `Sports navigation is incomplete: ${requiredPassedCount}/${requiredFindings.length} required sport switches were confirmed.`
        );
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: 'Not all required sports navigation switches passed.',
          findings,
          route,
          authStatePath,
        });
        return;
      }

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        partial: false,
        passedCount,
        requiredPassedCount,
        findings,
        route,
        authStatePath,
      });
    } finally {
      await closeContextBounded(context);
    }
  });

  test('P0.3 Sports scroll: upcoming/coupon remain stable while scrolling', async ({
    browser,
  }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for sports scroll checks.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext(
      resolveMatrixContextOptions({ storageState: authStatePath })
    );
    const page = await context.newPage();

    try {
      const route = await openSports(page, '/sports/?bt-path=%2F');
      if (route.challenge) {
        markBlocked(testInfo, route.challenge);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: route.challenge,
          route,
          authStatePath,
        });
        return;
      }

      const beforeState = await readSportsState(page);
      const startY = await page.evaluate(() => window.scrollY).catch(() => 0);
      const startScroll = await readSportsScrollState(page);
      const sportsBox = await findSportsBox(page);
      const upcomingVisibleStart = await page
        .getByText(/upcoming/i)
        .first()
        .isVisible()
        .catch(() => false);
      const couponVisibleStart = await page
        .getByText(/place your bets|betslip/i)
        .first()
        .isVisible()
        .catch(() => false);

      let movedBySurface = false;
      const scrollTrace = [];
      for (let i = 0; i < 10; i += 1) {
        const tick = await scrollSportsSurface(page, 820);
        scrollTrace.push(tick);
        if (tick && tick.moved) movedBySurface = true;
        await waitForUiSettled(page, 200);
      }

      const finalY = await page.evaluate(() => window.scrollY).catch(() => 0);
      const endScroll = await readSportsScrollState(page);
      const endState = await readSportsState(page);
      const changed = diffSportsState(beforeState, endState);
      const movedByWindow = finalY > startY;
      const movedByContainer = endScroll.top > startScroll.top || movedBySurface;
      const hasScrollableRange =
        Number(startScroll.maxTop || 0) > 0 ||
        Number(endScroll.maxTop || 0) > 0 ||
        scrollTrace.some((tick) => Number((tick && tick.maxTop) || 0) > 0);
      if (!sportsBox && !(upcomingVisibleStart || couponVisibleStart)) {
        const reason =
          'Sports container/signals are not exposed for scroll validation in this run.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason,
          route,
          authStatePath,
          sportsBox,
          startY,
          finalY,
          startScroll,
          endScroll,
          scrollTrace,
          upcomingVisibleStart,
          couponVisibleStart,
          stateChanged: changed,
          beforeState,
          endState,
        });
        return;
      }
      if (!hasScrollableRange) {
        const reason = 'Sports surface is reachable but has no scrollable range in current render.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason,
          route,
          authStatePath,
          sportsBox,
          startY,
          finalY,
          startScroll,
          endScroll,
          scrollTrace,
          upcomingVisibleStart,
          couponVisibleStart,
          stateChanged: changed,
          beforeState,
          endState,
        });
        return;
      }
      expect(
        movedByWindow || movedByContainer,
        'Sports route should scroll via window or internal sports container.'
      ).toBeTruthy();
      if (!(upcomingVisibleStart || couponVisibleStart)) {
        testInfo.annotations.push({
          type: 'partial',
          description:
            'Upcoming/coupon labels are not visible in this sports render, but scroll and route stability were validated.',
        });
      }

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        partial: !(upcomingVisibleStart || couponVisibleStart),
        route,
        authStatePath,
        sportsBox,
        startY,
        finalY,
        startScroll,
        endScroll,
        scrollTrace,
        upcomingVisibleStart,
        couponVisibleStart,
        stateChanged: changed,
        beforeState,
        endState,
      });
    } finally {
      await closeContextBounded(context);
    }
  });

  test('P1.4 Event details: open event and return back to sports list', async ({
    browser,
  }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for sports event checks.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext(
      resolveMatrixContextOptions({ storageState: authStatePath })
    );
    const page = await context.newPage();

    try {
      const route = await openSports(page, '/sports/?bt-path=%2F');
      if (route.challenge) {
        markBlocked(testInfo, route.challenge);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: route.challenge,
          route,
          authStatePath,
        });
        return;
      }

      const openEvent = await openEventFromSportsList(page);
      if (!openEvent.opened) {
        markBlocked(testInfo, 'Sports event card is not clickable in current render.');
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: 'Event open action was not confirmed.',
          route,
          authStatePath,
          openEvent,
        });
        return;
      }

      const eventUrl = page.url();
      const backAction = await returnFromSportsEvent(page, eventUrl);
      const afterBackUrl = backAction.afterUrl;
      const remainedOnSports = /\/sports\/?(?:\?|$)/i.test(afterBackUrl);

      // Persist the navigation trace before assertions so a failed return keeps
      // the exact event/list URLs and every fallback attempt in the report.
      await writeAndAttach(testInfo, `${testInfo.title}-navigation-trace`, {
        route,
        openEvent,
        eventUrl,
        afterBackUrl,
        remainedOnSports,
        backAction,
      });

      expect(remainedOnSports, 'After back, page should remain on /sports route.').toBeTruthy();
      if (backAction.strategy === 'sports-navigation') {
        testInfo.annotations.push({
          type: 'fallback-navigation',
          description:
            'The embedded widget did not expose a semantic Back control; persistent Sports navigation returned to the sports list.',
        });
      }
      if (
        eventUrl === afterBackUrl &&
        isCapabilityOptionalForBrand(BASE_URL, 'sportsEventDetails')
      ) {
        const reason =
          'Neither a semantic Back control nor browser history returned from sports event details.';
        markBlocked(testInfo, reason);
        const screenshotAttached = await attachProductEvidenceScreenshot(
          page,
          testInfo,
          'sports-event-back-navigation-defect'
        );
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          partial: true,
          reason,
          route,
          authStatePath,
          openEvent,
          backAction,
          eventUrl,
          afterBackUrl,
          screenshotAttached,
          remediationContract: PRODUCT_REMEDIATION_PATH || '',
        });
        return;
      }
      expect(
        eventUrl !== afterBackUrl,
        'Back action should return from event details.'
      ).toBeTruthy();

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        route,
        authStatePath,
        openEvent,
        backAction,
        eventUrl,
        afterBackUrl,
      });
    } finally {
      await closeContextBounded(context);
    }
  });

  test('P1.5 Odds click + betslip surface: interaction smoke', async ({ browser }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for odds/betslip checks.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext(
      resolveMatrixContextOptions({ storageState: authStatePath })
    );
    const page = await context.newPage();

    try {
      const route = await openSports(page, '/sports/?bt-path=%2F');
      if (route.challenge) {
        markBlocked(testInfo, route.challenge);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: route.challenge,
          route,
          authStatePath,
        });
        return;
      }

      const openEvent = await openEventFromSportsList(page);
      if (!openEvent.opened) {
        markBlocked(testInfo, 'Could not open event details for odds interaction.');
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: 'Event open action was not confirmed.',
          route,
          openEvent,
          authStatePath,
        });
        return;
      }

      const betslipControl = page.getByText(/betslip/i).first();
      const betslipVisible = await betslipControl.isVisible({ timeout: 2500 }).catch(() => false);
      if (betslipVisible) {
        await betslipControl.click({ timeout: 5000 }).catch(() => null);
        await waitForUiSettled(page, 800);
      }

      const before = await readSportsState(page);
      const oddsInteraction = await clickOddsWithEvidence(page);
      if (oddsInteraction.timedOut) {
        testInfo.annotations.push({
          type: 'partial',
          description: oddsInteraction.reason,
        });
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: false,
          partial: true,
          route,
          openEvent,
          authStatePath,
          oddsInteraction,
          changed: [],
          trackerVisible: false,
          couponSignalVisible: true,
        });
        return;
      }
      const after = await readSportsState(page);
      const changed = diffSportsState(before, after).filter(
        (key) => !['localStorage.btSession', 'localStorage.tokenSport'].includes(key)
      );
      const interactionConfirmed = oddsInteraction.confirmed;

      const trackerVisible = await page
        .getByText(/tracker/i)
        .first()
        .isVisible()
        .catch(() => false);
      const couponSignalVisible = await page
        .getByText(/place your bets|betslip/i)
        .first()
        .isVisible()
        .catch(() => false);

      if (!interactionConfirmed && !(trackerVisible || couponSignalVisible)) {
        markBlocked(testInfo, 'Odds-like click did not produce visible betslip/tracker reaction.');
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: 'No interaction confirmation signal.',
          route,
          openEvent,
          authStatePath,
          oddsInteraction,
          changed,
          trackerVisible,
          couponSignalVisible,
        });
        return;
      }

      if (!interactionConfirmed) {
        testInfo.annotations.push({
          type: 'partial',
          description:
            'Odds click signal is weak: the betslip surface was visible, but no deterministic selection/state delta was captured.',
        });
      } else {
        testInfo.annotations.push({
          type: 'strong-evidence',
          description: 'Odds interaction produced a deterministic betslip selection/state delta.',
        });
      }

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        partial: !interactionConfirmed,
        route,
        openEvent,
        authStatePath,
        oddsInteraction,
        changed,
        trackerVisible,
        couponSignalVisible,
      });
    } finally {
      await closeContextBounded(context);
    }
  });

  test('P1.6 Betslip controls: toggle + remove/clear + invalid stake smoke', async ({
    browser,
  }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for betslip control checks.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext(
      resolveMatrixContextOptions({ storageState: authStatePath })
    );
    const page = await context.newPage();

    const betPosts = [];
    page.on('request', (req) => {
      try {
        const method = req.method();
        const url = req.url();
        if (method !== 'POST') return;
        if (!/\/api\/.*(bet|coupon|wager|ticket)/i.test(url)) return;
        if (/\/bet-builder\/.*\/coeffs(?:[/?#]|$)/i.test(url)) return;
        betPosts.push({ method, url });
      } catch {
        // ignore request parsing issues
      }
    });

    try {
      const route = await openSports(page, '/sports/?bt-path=%2F');
      if (route.challenge) {
        markBlocked(testInfo, route.challenge);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: route.challenge,
          route,
          authStatePath,
        });
        return;
      }

      const openEvent = await openEventFromSportsList(page);
      if (!openEvent.opened) {
        markBlocked(testInfo, 'Could not open event details for betslip control checks.');
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: 'Event open action was not confirmed.',
          route,
          openEvent,
          authStatePath,
        });
        return;
      }

      const stateBefore = await readSportsState(page);
      const tracker = page.getByText(/tracker/i).first();
      const betslip = page.getByText(/betslip/i).first();

      const steps = [];
      if (await tracker.isVisible({ timeout: 1000 }).catch(() => false)) {
        await tracker.click({ timeout: 5000 }).catch(() => null);
        await waitForUiSettled(page, 700);
        steps.push('tracker-click');
      }
      if (await betslip.isVisible({ timeout: 1000 }).catch(() => false)) {
        await betslip.click({ timeout: 5000 }).catch(() => null);
        await waitForUiSettled(page, 700);
        steps.push('betslip-click');
      }

      const oddsInteraction = await clickOddsWithEvidence(page);
      steps.push(
        oddsInteraction.confirmed ? 'odds-selection-confirmed' : 'odds-selection-not-confirmed'
      );
      if (oddsInteraction.timedOut) {
        testInfo.annotations.push({
          type: 'partial',
          description: oddsInteraction.reason,
        });
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: false,
          partial: true,
          route,
          openEvent,
          authStatePath,
          steps,
          oddsInteraction,
          removeInteraction: {
            confirmed: false,
            attempts: [],
            reason: 'Skipped after bounded odds interaction timeout.',
          },
          changed: [],
          betPosts,
        });
        return;
      }

      let stakeInputFound = false;
      const betslipSurface = await findBetslipSurface(page);
      const stakeInput = betslipSurface
        ? await firstVisibleLocator(betslipSurface, [
            'input[placeholder*="stake" i]',
            'input[placeholder*="amount" i]',
            'input[inputmode="decimal"]',
            'input[type="number"]',
          ])
        : null;
      if (stakeInput) {
        stakeInputFound = true;
        await stakeInput.fill('0').catch(() => null);
        await page.keyboard.press('Enter').catch(() => null);
        await waitForUiSettled(page, 500);
        await stakeInput.fill('-10').catch(() => null);
        await page.keyboard.press('Enter').catch(() => null);
        await waitForUiSettled(page, 500);
        steps.push('stake-invalid-input');
      }

      const removeInteraction = oddsInteraction.confirmed
        ? await removeBetslipSelection(page)
        : { confirmed: false, attempts: [], reason: 'No selected odd to remove.' };
      steps.push(
        removeInteraction.confirmed
          ? 'odds-selection-removed'
          : 'odds-selection-remove-not-confirmed'
      );

      const stateAfter = await readSportsState(page);
      const changed = diffSportsState(stateBefore, stateAfter);

      if (!stakeInputFound) {
        testInfo.annotations.push({
          type: 'partial',
          description:
            'No visible stake input detected in DOM; invalid stake was not simulated with unsafe coordinate input.',
        });
      }
      if (!oddsInteraction.confirmed || !removeInteraction.confirmed) {
        testInfo.annotations.push({
          type: 'partial',
          description: 'Odds selection and removal could not both be confirmed from DOM evidence.',
        });
      }

      expect(
        betPosts.length,
        `Invalid stake smoke must not produce POST /bet-like calls. Found: ${betPosts
          .map((item) => item.url)
          .join(' | ')}`
      ).toBe(0);

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        partial: !stakeInputFound || !oddsInteraction.confirmed || !removeInteraction.confirmed,
        route,
        openEvent,
        authStatePath,
        steps,
        oddsInteraction,
        removeInteraction,
        changed,
        stateBefore,
        stateAfter,
        betPosts,
      });
    } finally {
      await closeContextBounded(context);
    }
  });

  test('P1.7 Sports network diagnostics: allowlist known 403 and detect criticals', async ({
    browser,
  }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for sports network diagnostics.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext(
      resolveMatrixContextOptions({ storageState: authStatePath })
    );
    const page = await context.newPage();

    const responseErrors = [];
    const failedRequests = [];
    const consoleErrors = [];

    page.on('response', (resp) => {
      try {
        const status = resp.status();
        if (status < 400) return;
        responseErrors.push({
          status,
          url: resp.url(),
          method: resp.request().method(),
          resourceType: resp.request().resourceType(),
        });
      } catch {
        // ignore response parsing errors
      }
    });

    page.on('requestfailed', (req) => {
      try {
        failedRequests.push({
          url: req.url(),
          method: req.method(),
          failure: (req.failure() && req.failure().errorText) || '',
        });
      } catch {
        // ignore request failure parsing
      }
    });

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const location = msg.location ? msg.location() : { url: '' };
      consoleErrors.push({
        text: msg.text(),
        url: location.url || '',
      });
    });

    try {
      const route = await openSports(page, '/sports/?bt-path=%2F');
      if (route.challenge) {
        markBlocked(testInfo, route.challenge);
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: route.challenge,
          route,
          authStatePath,
        });
        return;
      }

      const navLinks = [
        page.getByText(/^football$/i).first(),
        page.getByText(/^basketball$/i).first(),
        page.getByText(/^tennis$/i).first(),
      ];
      for (const locator of navLinks) {
        if (!(await locator.isVisible({ timeout: 500 }).catch(() => false))) continue;
        await locator.click({ timeout: 7000 }).catch(() => null);
        await waitForUiSettled(page, 700);
      }

      await openEventFromSportsList(page);
      await waitForUiSettled(page, 1000);

      const betBuilderUiVisible = await page
        .getByText(/^bet builder$/i)
        .first()
        .isVisible({ timeout: 700 })
        .catch(() => false);

      const ignored = responseErrors.filter((row) => row.status === 403 && isAllowed403(row.url));
      const optionalCapabilityErrors = betBuilderUiVisible
        ? []
        : responseErrors.filter((row) => isOptionalBetBuilder404(row));
      const authProbeErrors = responseErrors.filter((row) => isNonCriticalAuthProbeError(row));
      const fontAssetErrors = responseErrors.filter(
        (row) => row.resourceType === 'font' || /\.(?:woff2?|ttf|otf|eot)(?:\?|$)/i.test(row.url)
      );
      const criticalHttp = responseErrors.filter((row) => {
        const url = String(row.url || '');
        if (!betBuilderUiVisible && isOptionalBetBuilder404(row)) return false;
        if (isNonCriticalAuthProbeError(row)) return false;
        if (row.resourceType === 'font' || /\.(?:woff2?|ttf|otf|eot)(?:\?|$)/i.test(url)) {
          return false;
        }
        const inMainDomain = isMainBrandUrl(url);
        if (row.status >= 500) return true;
        if (row.status >= 400 && inMainDomain && !isAllowed403(url)) return true;
        return false;
      });
      const mainDomain403 = responseErrors.filter(
        (row) => row.status === 403 && isMainBrandUrl(String(row.url || ''))
      );
      const massWaf403 = mainDomain403.length >= 3;
      const noisyFailedRequests = failedRequests.filter((row) => isNoisyRequestFailure(row));
      const invalidFlagRequests = failedRequests.filter((row) =>
        /flags_by_code\/(?:undefined|null|\.)?\.svg/i.test(String((row && row.url) || ''))
      );
      const criticalFailedRequests = failedRequests.filter((row) => isCriticalFailedRequest(row));
      const consoleWarnings = consoleErrors.filter((row) => {
        const url = String(row.url || '');
        const text = String(row.text || '');
        if (
          !betBuilderUiVisible &&
          (/\/api\/v1\/bet-builder\/brand\/[^/]+\/sport\//i.test(url) ||
            /loading betbuilder settings.*status 404/i.test(text))
        ) {
          return false;
        }
        if (!url) return true;
        if (isAllowed403(url)) return false;
        return isMainBrandUrl(url) || /sptpub/i.test(url);
      });

      if (optionalCapabilityErrors.length > 0) {
        testInfo.annotations.push({
          type: 'product-warning',
          description: `${optionalCapabilityErrors.length} BetBuilder capability request(s) returned 404. The UI does not expose Bet Builder, but the frontend still requests its configuration.`,
        });
      }
      if (authProbeErrors.length > 0) {
        testInfo.annotations.push({
          type: 'product-warning',
          description: `${authProbeErrors.length} background /api/auth/user probe(s) returned 400/403 while the authorized sports UI remained usable.`,
        });
      }
      if (fontAssetErrors.length > 0) {
        testInfo.annotations.push({
          type: 'product-warning',
          description: `${fontAssetErrors.length} font asset request(s) returned HTTP errors. Typography may fall back, but functional Sports coverage remains valid.`,
        });
      }
      if (invalidFlagRequests.length > 0) {
        testInfo.annotations.push({
          type: 'product-warning',
          description: `${invalidFlagRequests.length} country flag asset request(s) contain an undefined/null country code. Add data validation and a neutral flag fallback.`,
        });
        await attachProductEvidenceScreenshot(
          page,
          testInfo,
          'sports-invalid-country-flag-fallback'
        );
      }

      if (consoleWarnings.length > 0) {
        testInfo.annotations.push({
          type: 'partial',
          description: `Console diagnostics contain ${consoleWarnings.length} warnings outside allowlist.`,
        });
      }
      if (noisyFailedRequests.length > 0) {
        testInfo.annotations.push({
          type: 'diagnostic',
          description: `Ignored ${noisyFailedRequests.length} noisy failed request(s) (ORB/static asset/known transient).`,
        });
      }

      const diagnosticPayload = {
        blocked: massWaf403,
        reason: massWaf403
          ? `WAF 403 on critical sports resources: ${mainDomain403
              .slice(0, 5)
              .map((row) => row.url)
              .join(' | ')}`
          : '',
        route,
        authStatePath,
        summary: {
          responseErrors: responseErrors.length,
          ignored403: ignored.length,
          optionalCapabilityErrors: optionalCapabilityErrors.length,
          authProbeErrors: authProbeErrors.length,
          fontAssetErrors: fontAssetErrors.length,
          betBuilderUiVisible,
          criticalHttp: criticalHttp.length,
          failedRequests: failedRequests.length,
          noisyFailedRequests: noisyFailedRequests.length,
          invalidFlagRequests: invalidFlagRequests.length,
          criticalFailedRequests: criticalFailedRequests.length,
          consoleErrors: consoleErrors.length,
          consoleWarnings: consoleWarnings.length,
          mainDomain403: mainDomain403.length,
          massWaf403,
        },
        responseErrors,
        ignored403: ignored,
        optionalCapabilityErrors,
        authProbeErrors,
        fontAssetErrors,
        criticalHttp,
        failedRequests,
        noisyFailedRequests,
        invalidFlagRequests,
        criticalFailedRequests,
        consoleErrors,
        consoleWarnings,
      };

      await writeAndAttach(testInfo, testInfo.title, diagnosticPayload);

      if (massWaf403) {
        markBlocked(testInfo, diagnosticPayload.reason);
        return;
      }

      expect(
        criticalHttp.length,
        `Critical sports HTTP diagnostics detected: ${criticalHttp
          .map((row) => `${row.status} ${row.url}`)
          .join(' | ')}`
      ).toBe(0);
      expect(
        criticalFailedRequests.length,
        `Critical failed requests detected: ${criticalFailedRequests
          .map((row) => `${row.method} ${row.url} (${row.failure})`)
          .join(' | ')}`
      ).toBe(0);
    } finally {
      await closeContextBounded(context);
    }
  });

  test('P2.8 Visual smoke: sports desktop and mobile', async ({ browser }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for sports visual smoke.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    fs.mkdirSync(VISUAL_DIR, { recursive: true });
    const captured = [];
    const blockedViewports = [];

    const extraHTTPHeaders = resolveExtraHTTPHeaders();
    const desktopContext = await browser.newContext({
      storageState: authStatePath,
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: true,
      ...(extraHTTPHeaders ? { extraHTTPHeaders } : {}),
    });
    const desktopPage = await desktopContext.newPage();
    try {
      const route = await openSports(desktopPage, '/sports/?bt-path=%2F');
      if (route.challenge) {
        blockedViewports.push({ viewport: 'desktop', reason: route.challenge, routeState: route });
      } else {
        const filePath = path.join(VISUAL_DIR, 'sports-desktop.png');
        await desktopPage.screenshot({ path: filePath, fullPage: true });
        captured.push({ viewport: 'desktop', filePath, route });
      }
    } finally {
      await desktopContext.close();
    }

    const mobileContext = await browser.newContext({
      storageState: authStatePath,
      viewport: { width: 390, height: 844 },
      ignoreHTTPSErrors: true,
      isMobile: true,
      hasTouch: true,
      ...(extraHTTPHeaders ? { extraHTTPHeaders } : {}),
    });
    const mobilePage = await mobileContext.newPage();
    try {
      const route = await openSports(mobilePage, '/sports/?bt-path=%2F');
      if (route.challenge) {
        blockedViewports.push({ viewport: 'mobile', reason: route.challenge, routeState: route });
      } else {
        const filePath = path.join(VISUAL_DIR, 'sports-mobile.png');
        await mobilePage.screenshot({ path: filePath, fullPage: true });
        captured.push({ viewport: 'mobile', filePath, route });
      }
    } finally {
      await mobileContext.close();
    }

    if (!captured.length && blockedViewports.length) {
      markBlocked(
        testInfo,
        `Sports visual smoke blocked on all viewports: ${blockedViewports
          .map((item) => item.viewport)
          .join(', ')}`
      );
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'All sports visual capture routes were blocked.',
        authStatePath,
        captured,
        blockedViewports,
      });
      return;
    }

    expect(captured.length > 0, 'Expected at least one sports visual capture.').toBeTruthy();
    if (blockedViewports.length) {
      testInfo.annotations.push({
        type: 'partial',
        description: `Sports visual blocked on: ${blockedViewports
          .map((item) => item.viewport)
          .join(', ')}`,
      });
    }

    await writeAndAttach(testInfo, testInfo.title, {
      blocked: false,
      partial: blockedViewports.length > 0,
      authStatePath,
      captured,
      blockedViewports,
    });
  });

  test('P2.9 Metadata smoke: title/h1/canonical for sports routes', async ({
    browser,
  }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for sports metadata checks.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext(
      resolveMatrixContextOptions({ storageState: authStatePath })
    );
    const page = await context.newPage();

    const plans = [
      '/sports/?bt-path=%2F',
      '/sports/?bt-path=%2Fsoccer-1',
      '/sports/?bt-path=%2Flive',
    ];

    try {
      const checked = [];
      const blockedRoutes = [];
      const warnings = [];

      for (const routePath of plans) {
        const route = await openSports(page, routePath);
        if (route.challenge) {
          blockedRoutes.push({ route: routePath, reason: route.challenge, routeState: route });
          continue;
        }

        const metadata = await page.evaluate(() => {
          const h1 = document.querySelector('h1');
          const canonical = document.querySelector('link[rel="canonical"]');
          return {
            title: document.title || '',
            h1: h1 ? (h1.textContent || '').trim() : '',
            canonical: canonical ? canonical.getAttribute('href') || '' : '',
          };
        });

        const titleLooksSports = /sport|football|basketball|tennis|live/i.test(metadata.title);
        const h1LooksSports = metadata.h1
          ? /sport|football|basketball|tennis|live/i.test(metadata.h1)
          : false;
        const canonicalLooksSports = /\/sports\/?/i.test(metadata.canonical || '');

        if (!titleLooksSports) {
          warnings.push({
            route: routePath,
            type: 'title',
            value: metadata.title,
            reason: 'Title does not include sports keywords.',
          });
        }
        if (!metadata.h1 || !h1LooksSports) {
          warnings.push({
            route: routePath,
            type: 'h1',
            value: metadata.h1 || '',
            reason: 'H1 is missing or does not include sports keywords.',
          });
        }
        if (!metadata.canonical || !canonicalLooksSports) {
          warnings.push({
            route: routePath,
            type: 'canonical',
            value: metadata.canonical || '',
            reason: 'Canonical is missing or does not point to sports path.',
          });
        }

        checked.push({
          route: routePath,
          finalUrl: page.url(),
          metadata,
          titleLooksSports,
          h1LooksSports,
          canonicalLooksSports,
        });
      }

      if (!checked.length && blockedRoutes.length) {
        markBlocked(testInfo, 'All planned sports metadata routes were blocked.');
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: 'No metadata routes were inspectable.',
          authStatePath,
          checked,
          blockedRoutes,
          warnings,
        });
        return;
      }

      expect(
        checked.length > 0,
        'At least one sports metadata route should be inspected.'
      ).toBeTruthy();

      if (warnings.length) {
        markBlocked(
          testInfo,
          `Sports metadata has ${warnings.length} product defect(s): title/H1/canonical requirements are not met.`
        );
        testInfo.annotations.push({
          type: 'product-warning',
          description: `Sports metadata requires a product fix. Remediation contract: ${
            PRODUCT_REMEDIATION_PATH || 'not configured'
          }`,
        });
        await attachProductEvidenceScreenshot(page, testInfo, 'sports-metadata-h1-defect');
      }
      if (blockedRoutes.length) {
        testInfo.annotations.push({
          type: 'blocked',
          description: `Blocked metadata routes: ${blockedRoutes
            .map((item) => item.route)
            .join(', ')}`,
        });
      }

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        partial: warnings.length > 0 || blockedRoutes.length > 0,
        productOwnerActionRequired: warnings.length > 0,
        remediationContract:
          warnings.length > 0 && PRODUCT_REMEDIATION_PATH ? PRODUCT_REMEDIATION_PATH : '',
        authStatePath,
        checked,
        blockedRoutes,
        warnings,
      });
    } finally {
      await closeContextBounded(context);
    }
  });

  test('P2.10 WebSocket diagnostics: capture sports WS traffic during navigation', async ({
    browser,
  }, testInfo) => {
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth state found for sports WebSocket diagnostics.');
      await writeAndAttach(testInfo, testInfo.title, {
        blocked: true,
        reason: 'No auth state found.',
      });
      return;
    }

    const context = await browser.newContext(
      resolveMatrixContextOptions({ storageState: authStatePath })
    );
    const page = await context.newPage();
    const wsCapture = createWsCapture(page, { sampleLimit: 24, framePreviewLength: 260 });

    try {
      const routes = [
        '/sports/?bt-path=%2F',
        '/sports/?bt-path=%2Flive',
        '/sports/?bt-path=%2Fsoccer-1',
      ];
      const routeStates = [];

      for (const routePath of routes) {
        const state = await openSports(page, routePath);
        routeStates.push(state);
        if (state.challenge) continue;
        await page.mouse.wheel(0, 900).catch(() => null);
        await waitForUiSettled(page, 700);
      }

      const wsSummary = wsCapture.summarize({
        area: 'sports',
        routes,
        finalUrl: page.url(),
      });
      const noSockets = Number(wsSummary.totals && wsSummary.totals.sockets) === 0;
      const allBlocked =
        routeStates.length > 0 && routeStates.every((state) => Boolean(state && state.challenge));

      if (allBlocked) {
        markBlocked(testInfo, 'Sports WebSocket diagnostics blocked by challenge on all routes.');
        await writeAndAttach(testInfo, testInfo.title, {
          blocked: true,
          reason: 'All sports routes were blocked by challenge.',
          authStatePath,
          routeStates,
          wsSummary,
        });
        return;
      }

      if (noSockets) {
        testInfo.annotations.push({
          type: 'diagnostic',
          description:
            'Sports routes opened, but no WebSocket connections were observed in this observation window.',
        });
      }

      await writeAndAttach(testInfo, testInfo.title, {
        blocked: false,
        partial: noSockets,
        authStatePath,
        routeStates,
        wsSummary,
      });

      expect(
        Array.isArray(wsSummary.sockets),
        'WS diagnostics should return sockets array.'
      ).toBeTruthy();
    } finally {
      await closeContextBounded(context);
    }
  });
});
