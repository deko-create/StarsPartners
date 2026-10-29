const CLOUD_FLARE_HINTS = [
  /verify you are human/i,
  /checking your browser/i,
  /cloudflare/i,
  /just a moment/i,
  /performing security verification/i,
  /выполнение проверки безопасности/i,
  /один момент/i,
];
const {
  inferCapabilityFromBlockedReason,
  isCapabilityOptionalForBrand,
} = require('./brand-capabilities');
const GEO_BLOCK_HINTS = [
  /cannot be accessed in /i,
  /region not restricted/i,
  /proxy service or vpn/i,
  /we're sorry, but .* cannot be accessed/i,
];
const NON_CRITICAL_WAF_URLS = [/\/(?:server\/)?api\/languages\/thook(?:\/|$|\?)/i];
const NON_CRITICAL_STATIC_ASSET_RE =
  /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|woff2?|ttf|otf|eot)(?:\?|$)/i;
const CLOUD_FLARE_CHALLENGE_FRAME_SELECTOR =
  'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], iframe[title*="challenge" i], iframe[title*="turnstile" i]';

const INFRA_BLOCKED_HINTS = [
  /cloudflare|turnstile|captcha|challenge|waf|cdn-cgi|__cf_chl|token page|forbidden|403/i,
  /geo restriction|cannot be accessed in |region not restricted|proxy service or vpn|http 423/i,
  /no auth state|no (?:verified )?authorized storage state|auth storage state|storage state is unavailable/i,
  /stored player credentials .*invalid|stale player credential|test credential|user_account_blocked|account (?:is )?blocked/i,
  /expected authorized session|auth state|authorized .*login surface|http 401|unauthorized|\/api\/user\/preferences returned 401|session was not established/i,
  /temporarily unavailable|backend unavailable|transport negotiation failed|cancelled\/aborted before bootstrap/i,
  /target page|context or browser has been closed|browser has been closed|test ended/i,
  /internet connection appears to be offline|net::err_internet_disconnected|net::err_network_changed|socket hang up/i,
  /net::err_failed|net::err_timed_out|net::err_blocked_by_orb|request failed/i,
  /openapi schema was not found|contract (?:schema|specification|configuration) (?:is )?(?:missing|unavailable)|provide qa_(?:auth|payment)_openapi/i,
  /registered player credentials were not found|registration must succeed before|current run did not create (?:player )?credentials/i,
];
const TEST_INFRA_TIMEOUT_HINTS = [
  /test_infra_timeout/i,
  /watchdog timed out/i,
  /provider stage .*timed out/i,
  /timed out before/i,
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyBlockedType(description) {
  const source = String(description || '');
  if (!source) return 'product';
  if (TEST_INFRA_TIMEOUT_HINTS.some((re) => re.test(source))) return 'test-infra-timeout';
  return INFRA_BLOCKED_HINTS.some((re) => re.test(source)) ? 'infra' : 'product';
}

function isCriticalWafUrl(url) {
  const value = String(url || '');
  if (!/\/_nuxt\/|\/api\//i.test(value)) return false;
  if (NON_CRITICAL_WAF_URLS.some((re) => re.test(value))) return false;
  // Fonts and images can be genuine product defects, but they are not evidence
  // that Cloudflare blocked the application or that an auth flow is unusable.
  if (NON_CRITICAL_STATIC_ASSET_RE.test(value)) return false;
  return true;
}

async function detectCloudflare(page) {
  const cfUrlPattern = /\/cdn-cgi\/|challenge-platform/i;
  if (cfUrlPattern.test(page.url())) {
    return 'Cloudflare challenge detected (cdn-cgi/challenge).';
  }

  const appRootVisible = await page
    .locator('#app, #__nuxt')
    .first()
    .isVisible({ timeout: 600 })
    .catch(() => false);
  const authModalVisible = appRootVisible
    ? await page
        .locator(
          '.t-login-modal, [data-testid="login-modal"], .t-login:has(input), .t-signup-modal, [data-testid="signup-modal"], .t-signup:has(input)'
        )
        .first()
        .isVisible({ timeout: 600 })
        .catch(() => false)
    : false;

  for (const re of CLOUD_FLARE_HINTS) {
    const loc = page.getByText(re).first();
    const visible = await loc.isVisible({ timeout: 1000 }).catch(() => false);
    if (visible) {
      if (appRootVisible && /cloudflare/i.test(re.source)) {
        continue;
      }
      if (
        authModalVisible &&
        /verify you are human|performing security verification|выполнение проверки безопасности|один момент/i.test(
          re.source
        )
      ) {
        continue;
      }
      return 'Cloudflare challenge detected (challenge text visible).';
    }
  }

  const cfSelectors = [
    '#cf-wrapper',
    'form#challenge-form',
    'iframe[src*="challenge-platform"]',
    'iframe[src*="/cdn-cgi/"]',
    '[id*="challenge-form"]',
  ];

  for (const sel of cfSelectors) {
    const loc = page.locator(sel).first();
    const visible = await loc.isVisible({ timeout: 1000 }).catch(() => false);
    if (visible) {
      return 'Cloudflare challenge detected (challenge selector visible).';
    }
  }

  // Some Cloudflare pages render as a blank page with a short token string.
  try {
    const appRoot = await page
      .locator('#app, #__nuxt')
      .first()
      .isVisible()
      .catch(() => false);
    if (!appRoot) {
      const bodyTextRaw = (await page.textContent('body').catch(() => '')) || '';
      const bodyText = bodyTextRaw.trim();
      const compact = bodyText.replace(/\s+/g, '');
      const token = compact.match(/^[a-f0-9]{12,}$/i);
      const tokenInText = bodyText.match(/\b[a-f0-9]{12,}\b/i);
      if ((token || tokenInText) && bodyText.length <= 128) {
        return 'Cloudflare challenge detected (token page).';
      }
    }
  } catch (err) {
    if (err instanceof Error) throw err;
  }

  return null;
}

async function clickTurnstileChallenge(page) {
  const frames = page.locator(CLOUD_FLARE_CHALLENGE_FRAME_SELECTOR);
  const count = await frames.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
    const iframeLocator = frames.nth(i);
    const iframeHandle = await iframeLocator.elementHandle().catch(() => null);
    if (!iframeHandle) continue;

    const frame = await iframeHandle.contentFrame().catch(() => null);
    if (frame) {
      const checkbox = frame.locator('input[type="checkbox"], [role="checkbox"]').first();
      const visibleCheckbox = await checkbox.isVisible({ timeout: 800 }).catch(() => false);
      if (visibleCheckbox) {
        await checkbox.click({ force: true, timeout: 2000 }).catch(() => null);
        return true;
      }
    }

    const box = await iframeHandle.boundingBox().catch(() => null);
    if (!box) continue;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y, { steps: 8 }).catch(() => null);
    await page.mouse.click(x, y, { delay: 120 }).catch(() => null);
    return true;
  }

  return false;
}

async function tryAutoBypassCloudflare(page, timeoutMs = 22_000) {
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 22_000;
  const startedAt = Date.now();
  let attemptedInteraction = false;

  while (Date.now() - startedAt < timeout) {
    const detected = await detectCloudflare(page);
    if (!detected) {
      return {
        resolved: true,
        attemptedInteraction,
      };
    }

    const clicked = await clickTurnstileChallenge(page);
    attemptedInteraction = attemptedInteraction || clicked;

    if (!clicked) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 12_000 }).catch(() => null);
      await delay(900);
      continue;
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 7_000 }).catch(() => null);
    await delay(1700);
  }

  return {
    resolved: !(await detectCloudflare(page)),
    attemptedInteraction,
  };
}

async function detectGeoBlock(page) {
  for (const re of GEO_BLOCK_HINTS) {
    const loc = page.getByText(re).first();
    const visible = await loc.isVisible({ timeout: 1000 }).catch(() => false);
    if (visible) {
      const bodyText = ((await page.textContent('body').catch(() => '')) || '')
        .replace(/\s+/g, ' ')
        .trim();
      return `Geo restriction detected: ${bodyText.slice(0, 180) || 'access is blocked for current region.'}`;
    }
  }
  return null;
}

async function assertNotCloudflare(page) {
  let detected = await detectCloudflare(page);
  if (detected && process.env.PW_AUTO_BYPASS_CF !== '0') {
    const bypass = await tryAutoBypassCloudflare(
      page,
      Number.parseInt(process.env.PW_AUTO_BYPASS_CF_TIMEOUT_MS || '22000', 10)
    );
    if (bypass.resolved) {
      detected = null;
    } else {
      detected = await detectCloudflare(page);
      if (detected && bypass.attemptedInteraction) {
        detected = `${detected} (auto-bypass attempted).`;
      }
    }
  }

  if (detected) {
    const baseUrl = process.env.BASE_URL || 'https://gt.bet/';
    throw new Error(`${detected} Run: npm run save:state -- ${baseUrl} --auto`);
  }
  const geoBlocked = await detectGeoBlock(page);
  if (geoBlocked) {
    throw new Error(geoBlocked);
  }
}

function createWafProbe(page) {
  const blocked = [];
  const failed = [];

  page.on('response', (resp) => {
    try {
      if (resp.status() !== 403) return;
      const url = resp.url();
      if (isCriticalWafUrl(url) && !blocked.includes(url)) {
        blocked.push(url);
      }
    } catch {
      // ignore
    }
  });

  page.on('requestfailed', (req) => {
    try {
      const url = req.url();
      if (isCriticalWafUrl(url) && !failed.includes(url)) {
        failed.push(url);
      }
    } catch {
      // ignore
    }
  });

  return {
    blocked,
    failed,
  };
}

function formatWafList(list, limit = 5) {
  if (!list || list.length === 0) return null;
  return list.slice(0, limit).join(' | ');
}

async function findSignupModal(page, timeoutMs = 500) {
  const selectors = [
    '.t-popup.t-signup-modal',
    '.t-popup:has(input):has-text("Sign up")',
    '.t-signup-modal',
    '[data-testid="signup-modal"]',
    '.t-signup:has(input)',
    '[role="dialog"]:has(input):has-text("Sign up")',
    '[class*="modal" i]:has(input):has-text("Sign up")',
    '[class*="popup" i]:has(input):has-text("Sign up")',
    '[class*="dialog" i]:has(input):has-text("Sign up")',
    '[class*="registration" i]:has(input):has-text("Sign up")',
    '[class*="signup" i]:has(input):has-text("Sign up")',
    'form:has(input):has-text("Sign up")',
  ];

  for (const selector of selectors) {
    const matches = page.locator(selector);
    const count = await matches.count().catch(() => 0);
    const cap = Math.min(count, 10);
    for (let i = 0; i < cap; i += 1) {
      const locator = matches.nth(i);
      const visible = await locator.isVisible({ timeout: timeoutMs }).catch(() => false);
      if (!visible) continue;
      const visibleEmail = await locator
        .locator('input[type="email"]:visible, input[name="email"]:visible')
        .count()
        .catch(() => 0);
      const visiblePassword = await locator
        .locator('input[type="password"]:visible, input[name="password"]:visible')
        .count()
        .catch(() => 0);
      if (visibleEmail > 0 && visiblePassword > 0) return locator;
    }
  }

  const titles = page.locator(
    'xpath=//*[normalize-space()="Sign up" or normalize-space()="Sign Up"]'
  );
  const titleCount = await titles.count().catch(() => 0);
  const titleCap = Math.min(titleCount, 20);
  const classTranslate =
    "translate(@class, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')";
  const modalAncestorXPath =
    `xpath=ancestor::*[.//input and (` +
    `@role="dialog" or contains(${classTranslate}, "signup") or ` +
    `contains(${classTranslate}, "modal") or contains(${classTranslate}, "popup") or ` +
    `contains(${classTranslate}, "registration") or contains(${classTranslate}, "dialog")` +
    `)][1]`;

  for (let i = 0; i < titleCap; i += 1) {
    const title = titles.nth(i);
    const titleVisible = await title.isVisible({ timeout: timeoutMs }).catch(() => false);
    if (!titleVisible) continue;

    const titleTag = await title.evaluate((node) => node.tagName.toLowerCase()).catch(() => '');
    if (['button', 'a'].includes(titleTag)) continue;

    const ancestor = title.locator(modalAncestorXPath).first();
    const ancestorVisible = await ancestor.isVisible({ timeout: timeoutMs }).catch(() => false);
    if (!ancestorVisible) continue;
    const visibleEmail = await ancestor
      .locator('input[type="email"]:visible, input[name="email"]:visible')
      .count()
      .catch(() => 0);
    const visiblePassword = await ancestor
      .locator('input[type="password"]:visible, input[name="password"]:visible')
      .count()
      .catch(() => 0);
    if (visibleEmail > 0 && visiblePassword > 0) return ancestor;
  }

  return null;
}

async function waitForSignupModal(page, timeoutMs = 5000) {
  const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
  while (Date.now() < deadline) {
    const modal = await findSignupModal(page, 250);
    if (modal) return modal;
    const withoutDeposit = page.getByText(/sign\s*up\s*without\s*(?:a\s*)?deposit/i).last();
    if (await withoutDeposit.isVisible({ timeout: 250 }).catch(() => false)) {
      await withoutDeposit.click({ timeout: 1500, force: true }).catch(() => null);
    }
    await delay(200);
  }
  return null;
}

async function findLoginModal(page, timeoutMs = 500) {
  const selectors = [
    '.t-login-modal',
    '[data-testid="login-modal"]',
    '.t-popup:has(input[type="password"]):has-text("Log In")',
    '[role="dialog"]:has(input[type="password"]):has-text("Log In")',
    '[class*="modal" i]:has(input[type="password"]):has-text("Log In")',
    '[class*="popup" i]:has(input[type="password"]):has-text("Log In")',
    '[class*="dialog" i]:has(input[type="password"]):has-text("Log In")',
    '.t-login:has(input[type="password"])',
    'form:has(input[type="password"]):has-text("Log In")',
  ];

  for (const selector of selectors) {
    const matches = page.locator(selector);
    const count = Math.min(await matches.count().catch(() => 0), 12);
    for (let index = 0; index < count; index += 1) {
      const candidate = matches.nth(index);
      if (!(await candidate.isVisible({ timeout: timeoutMs }).catch(() => false))) continue;
      const passwordVisible = await candidate
        .locator('input[type="password"]:visible')
        .count()
        .catch(() => 0);
      const identityVisible = await candidate
        .locator(
          'input[type="email"]:visible, input[name*="email" i]:visible, input:visible:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])'
        )
        .count()
        .catch(() => 0);
      if (passwordVisible > 0 && identityVisible > 0) return candidate;
    }
  }
  return null;
}

async function waitForLoginModal(page, timeoutMs = 5000) {
  const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
  while (Date.now() < deadline) {
    const modal = await findLoginModal(page, 250);
    if (modal) return modal;
    await delay(200);
  }
  return null;
}

async function detectSignupTurnstileStall(page) {
  const modal = await findSignupModal(page);
  if (!modal) return null;

  const step1Btn = modal
    .locator(
      'button:has-text("CONTINUE"), button:has-text("Continue"), [data-testid="proceed-button"]'
    )
    .first();
  const buttonVisible = await step1Btn.isVisible({ timeout: 500 }).catch(() => false);
  if (!buttonVisible) return null;
  const buttonDisabled = await step1Btn.isDisabled().catch(() => false);
  if (!buttonDisabled) return null;

  const tokenInput = modal.locator('input[name="cf-turnstile-response"]').first();
  const tokenCount = await modal
    .locator('input[name="cf-turnstile-response"]')
    .count()
    .catch(() => 0);
  if (tokenCount < 1) return null;

  const tokenValue = (await tokenInput.inputValue().catch(() => '')) || '';
  if (tokenValue.trim().length > 0) return null;

  return 'Cloudflare challenge detected (signup turnstile token not issued).';
}

async function getWafReason(page, probe, error) {
  const message = error && error.message ? String(error.message) : '';
  if (message.includes('Cloudflare challenge detected')) return message;
  if (message.includes('PRECHECK_BLOCKED')) return message;
  if (message.includes('Geo restriction detected')) return message;
  if (message.includes('signup turnstile token not issued')) {
    return 'Cloudflare challenge detected (signup turnstile token not issued).';
  }
  if (
    /toBeEnabled/i.test(message) &&
    /proceed-button|button:has-text\("CONTINUE"\)|button:has-text\("Continue"\)/i.test(message)
  ) {
    return 'Cloudflare challenge detected (signup turnstile token not issued).';
  }
  if (message.includes("locator('#app, #__nuxt').first() to be visible")) {
    return 'App root is not visible (possible WAF/challenge/blank page).';
  }

  const detected = await detectCloudflare(page);
  if (detected) return detected;
  const turnstileStall = await detectSignupTurnstileStall(page);
  if (turnstileStall) return turnstileStall;
  const geoBlocked = await detectGeoBlock(page);
  if (geoBlocked) return geoBlocked;

  const blockedSample = formatWafList(probe && probe.blocked);
  if (blockedSample) return `WAF 403 on critical resources: ${blockedSample}`;

  const failedSample = formatWafList(probe && probe.failed);
  if (failedSample) return `Critical requests failed: ${failedSample}`;

  return null;
}

async function maybeSkipWaf({ page, probe, testInfo, error }) {
  if (process.env.PW_WAF_DIAGNOSTIC === '0') return false;
  const reason = await getWafReason(page, probe, error);
  if (!reason) return false;
  markBlocked(testInfo, reason);
  return true;
}

async function dismissOverlays(page) {
  try {
    await page.evaluate(() => {
      const dismissOneSignal = () => {
        const button = document.getElementById('onesignal-slidedown-cancel-button');
        if (button instanceof globalThis.HTMLElement) button.click();
      };
      dismissOneSignal();
      if (!globalThis.__qaOneSignalDismissObserver) {
        const observer = new globalThis.MutationObserver(dismissOneSignal);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        globalThis.__qaOneSignalDismissObserver = observer;
        globalThis.setTimeout(() => {
          observer.disconnect();
          delete globalThis.__qaOneSignalDismissObserver;
        }, 15_000);
      }
    });
  } catch {
    // ignore
  }

  // Hard-disable known overlays that can intercept clicks
  try {
    await page.addStyleTag({
      content:
        '#onesignal-slidedown-container{display:none!important;pointer-events:none!important;}' +
        '.onesignal-slidedown-container{display:none!important;pointer-events:none!important;}' +
        '[data-testid="pwa-modal"],[data-testid="pwa-popup"]{display:none!important;}',
    });
  } catch {
    // ignore
  }

  const candidates = [
    '#onesignal-slidedown-cancel-button',
    '#onesignal-slidedown-allow-button',
    '[data-testid="pwa-close"]',
    '[aria-label="Close"]',
    '[aria-label*="close" i]',
    '[data-testid*="close" i]',
    '.t-popup__close',
    '.t-popup-close',
    '[class*="popup" i] [class*="close" i]',
    '.t-header__pwa-close',
    'button:has-text("No thanks")',
    'button:has-text("No Thanks")',
    'button:has-text("Got it")',
  ];

  for (const selector of candidates) {
    const el = page.locator(selector).first();
    try {
      if (await el.isVisible()) {
        await el.click({ timeout: 1500 });
      }
    } catch {
      // Ignore if not present or not clickable
    }
  }

  // Deposit & Play and notification prompts can be injected after the first
  // pass. Poll only their known surfaces before continuing with user actions.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const latePopup = page
      .locator(
        '.t-modal-pnp:visible, .t-popup:visible:has-text("Deposit &"), .t-popup:visible:has-text("Please choose your payment method")'
      )
      .first();
    const lateNotification = page
      .locator('button:has-text("Later"), button:has-text("No thanks")')
      .first();
    const popupVisible = await latePopup.isVisible({ timeout: 250 }).catch(() => false);
    const notificationVisible = await lateNotification
      .isVisible({ timeout: 250 })
      .catch(() => false);

    if (popupVisible) {
      const close = latePopup
        .locator('.t-popup__close, [aria-label*="close" i], [data-testid*="close" i]')
        .first();
      await close.click({ timeout: 1200, force: true }).catch(() => null);
    }
    if (notificationVisible) {
      await lateNotification.click({ timeout: 1200, force: true }).catch(() => null);
    }
    if (popupVisible || notificationVisible) {
      await waitForUiSettled(page, 300).catch(() => null);
      continue;
    }
    if (attempt < 3) {
      await page
        .evaluate(() => new Promise((resolve) => globalThis.setTimeout(resolve, 250)))
        .catch(() => null);
    }
  }

  // OneSignal can mount after the first dismissal pass. Keep its container
  // inert even when the vendor replaces the DOM node after page readiness.
  await page
    .evaluate(() => {
      const container = document.querySelector(
        '#onesignal-slidedown-container, .onesignal-slidedown-container'
      );
      if (!(container instanceof globalThis.HTMLElement)) return;
      container.style.setProperty('display', 'none', 'important');
      container.style.setProperty('pointer-events', 'none', 'important');
      container.setAttribute('aria-hidden', 'true');
    })
    .catch(() => null);

  // Some brands inject the "Pick Your Reward" promo as a delayed cross-origin iframe.
  // Try its close action first. If the third-party widget ignores the click, remove only
  // that confirmed reward iframe from the test page so it cannot intercept later actions.
  // Never hide arbitrary iframes: casino and sports surfaces legitimately use them.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let rewardFrameHandled = false;
    const childFrames = page.frames().filter((candidate) => candidate !== page.mainFrame());
    const frameMatches = await Promise.all(
      childFrames.map(async (frame) => ({
        frame,
        rewardPromptVisible: await frame
          .getByText(/pick your reward/i)
          .first()
          .isVisible({ timeout: 300 })
          .catch(() => false),
      }))
    );
    for (const { frame, rewardPromptVisible } of frameMatches) {
      if (!rewardPromptVisible) continue;

      rewardFrameHandled = true;
      const frameCloseCandidates = [
        frame.getByRole('button', { name: /close|dismiss|no thanks/i }).first(),
        frame.locator('[aria-label*="close" i], [data-testid*="close" i]').first(),
        frame.locator('button').filter({ hasNotText: /claim/i }).first(),
      ];
      for (const closeButton of frameCloseCandidates) {
        const visible = await closeButton.isVisible({ timeout: 300 }).catch(() => false);
        if (!visible) continue;
        await closeButton.click({ timeout: 1500, force: true }).catch(() => null);
        await waitForUiSettled(page, 350).catch(() => null);
        const stillVisible = await frame
          .getByText(/pick your reward/i)
          .first()
          .isVisible({ timeout: 250 })
          .catch(() => false);
        if (!stillVisible) break;
      }

      const stillVisible = await frame
        .getByText(/pick your reward/i)
        .first()
        .isVisible({ timeout: 250 })
        .catch(() => false);
      if (stillVisible) {
        const frameElement = await frame.frameElement().catch(() => null);
        if (frameElement) {
          await frameElement.evaluate((element) => element.remove()).catch(() => null);
        }
      }
    }
    if (rewardFrameHandled || attempt === 3) break;
    await waitForUiSettled(page, 250).catch(() => null);
  }

  // The rewards subscription prompt is injected after the initial route render on
  // some brands and its dismiss action is not consistently rendered as a button.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const noThanks = page.getByText(/^No thanks$/i).first();
    const visible = await noThanks.isVisible({ timeout: 500 }).catch(() => false);
    if (visible) {
      await noThanks.click({ timeout: 1500, force: true }).catch(() => null);
      break;
    }
    if (attempt < 2) await waitForUiSettled(page, 300).catch(() => null);
  }

  // If OneSignal container still exists, remove it via DOM
  try {
    await page.evaluate(() => {
      const el = document.getElementById('onesignal-slidedown-container');
      if (el) el.remove();
    });
  } catch {
    // ignore
  }

  await closeMobileNavigationOverlay(page).catch(() => false);
}

async function closeMobileNavigationOverlay(page) {
  const viewport = page.viewportSize();
  if (viewport && viewport.width > 1100) return false;

  const sidebars = page.locator(
    'aside:visible, [role="complementary"]:visible, [data-testid="sidebar-aside"]:visible, .t-sidebar-menu:visible'
  );
  const count = Math.min(await sidebars.count().catch(() => 0), 6);
  let overlay = null;
  for (let index = 0; index < count; index += 1) {
    const candidate = sidebars.nth(index);
    const coversViewport = await candidate
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = globalThis.getComputedStyle(element);
        const text = String(element.textContent || '');
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 &&
          rect.width >= globalThis.innerWidth * 0.38 &&
          rect.height >= globalThis.innerHeight * 0.55 &&
          rect.left <= globalThis.innerWidth * 0.08 &&
          /my profile|deposit|casino|sports|favorites|promotions?/i.test(text)
        );
      })
      .catch(() => false);
    if (coversViewport) {
      overlay = candidate;
      break;
    }
  }
  if (!overlay) return false;

  const candidates = [
    overlay.locator('button').first(),
    page.locator('[data-testid="sidebar-burger-button"]:visible').first(),
    page.locator('.t-sidebar-menu__toggle-btn-active:visible').first(),
    page.locator('[class*="sidebar-menu" i] [class*="toggle" i]:visible').first(),
  ];
  for (const candidate of candidates) {
    if (!(await candidate.isVisible({ timeout: 250 }).catch(() => false))) continue;
    await candidate.click({ timeout: 1500, force: true }).catch(() => null);
    await waitForUiSettled(page, 350).catch(() => null);
    if (!(await overlay.isVisible({ timeout: 250 }).catch(() => false))) return true;
  }

  await page.keyboard.press('Escape').catch(() => null);
  await waitForUiSettled(page, 350).catch(() => null);
  return !(await overlay.isVisible({ timeout: 250 }).catch(() => false));
}

async function closeModal(modal, page) {
  const closeCandidates = [
    'button:has-text("Close")',
    'button:has-text("Закрыть")',
    'button:has-text("Закрити")',
    '[aria-label="Close"]',
    '[aria-label*="close" i]',
    '[aria-label*="закр" i]',
    '[data-testid*="close"]',
    '.t-popup__close',
    '.t-popup-close',
    '[class*="popup" i] [class*="close" i]',
    '.t-modal__close',
    '.t-modal__close-btn',
    '.modal__close',
  ];

  const modalIsClosed = () => modal.isHidden({ timeout: 700 }).catch(() => false);
  let closeTriggered = false;
  for (const selector of closeCandidates) {
    const btn = modal.locator(selector).first();
    try {
      const visible = await btn.isVisible({ timeout: 500 }).catch(() => false);
      if (visible) {
        closeTriggered = await btn
          .click({ timeout: 1500 })
          .then(() => true)
          .catch(() => false);
        if (closeTriggered) {
          await waitForUiSettled(page, 250).catch(() => null);
          if (await modalIsClosed()) return true;
          // One close click can open an exit-confirmation overlay. Do not keep
          // matching the same X through subsequent selectors and stack several
          // identical confirmation dialogs.
          break;
        }
      }
    } catch {
      // try next selector
    }
  }

  // On the current signup shell `.t-popup__close` is a sibling of the inner
  // `.t-signup-modal`, not its descendant. Search the visible page-level popup
  // only after the scoped candidates so unrelated dialogs are not closed.
  if (!closeTriggered) {
    const pageClose = page
      .locator(
        '.t-popup:visible > .t-popup__close:visible, .t-popup:visible .t-popup__close:visible, [role="dialog"]:visible [class*="close" i]:visible'
      )
      .last();
    if (await pageClose.isVisible({ timeout: 800 }).catch(() => false)) {
      closeTriggered = await pageClose
        .click({ timeout: 2000, force: true })
        .then(() => true)
        .catch(() =>
          pageClose
            .evaluate((element) => {
              element.click();
              return true;
            })
            .catch(() => false)
        );
      if (closeTriggered) {
        await waitForUiSettled(page, 300).catch(() => null);
        if (await modalIsClosed()) return true;
      }
    }
  }

  // Icon-only close buttons often have no accessible name or stable class.
  // Restrict the fallback to a button in the modal's top-right corner so form
  // actions such as Continue cannot be clicked accidentally.
  if (!closeTriggered) {
    const iconClose = modal.locator('button').filter({ hasNotText: /continue|log in|sign up/i });
    const count = Math.min(await iconClose.count().catch(() => 0), 20);
    const modalBox = await modal.boundingBox().catch(() => null);
    const geometricCandidates = [];
    for (let index = 0; modalBox && index < count; index += 1) {
      const candidate = iconClose.nth(index);
      const box = await candidate.boundingBox().catch(() => null);
      if (!box) continue;
      const nearTop = box.y <= modalBox.y + Math.min(120, modalBox.height * 0.2);
      const nearRight = box.x + box.width >= modalBox.x + modalBox.width - 140;
      if (!nearTop || !nearRight) continue;
      geometricCandidates.push({ candidate, box });
    }

    // Some signup dialogs place a gift/help action immediately to the left of X.
    // The DOM order is not reliable, so try the rightmost control first and only
    // accept a click as successful after the dialog actually disappears.
    geometricCandidates.sort(
      (left, right) =>
        right.box.x + right.box.width - (left.box.x + left.box.width) || left.box.y - right.box.y
    );
    for (const { candidate } of geometricCandidates) {
      closeTriggered = await candidate
        .click({ timeout: 1500, force: true })
        .then(() => true)
        .catch(() => false);
      if (!closeTriggered) continue;
      await waitForUiSettled(page, 250).catch(() => null);
      if (await modalIsClosed()) return true;
      break;
    }
  }

  if (!closeTriggered) {
    await page.keyboard.press('Escape').catch(() => null);
  }

  await waitForUiSettled(page, 500).catch(() => null);
  if (await modal.isHidden({ timeout: 1000 }).catch(() => false)) return true;

  // Some brands intentionally ask for confirmation before abandoning registration.
  // The confirmation is a sibling dialog, so it cannot be found inside `modal`.
  const confirmationDialog = page
    .locator(
      '[role="dialog"]:has-text("Are you sure"), [role="dialog"]:has-text("УВЕРЕНЫ"), [class*="modal" i]:has-text("Are you sure"), [class*="modal" i]:has-text("УВЕРЕНЫ"), [class*="popup" i]:has-text("Are you sure"), [class*="popup" i]:has-text("УВЕРЕНЫ")'
    )
    .filter({ visible: true })
    .last();
  const confirmationVisible = await confirmationDialog
    .isVisible({ timeout: 1500 })
    .catch(() => false);

  // On the current mobile shell the confirmation popup has neither a dialog
  // role nor a class containing "modal"/"popup" on its visible wrapper. Detect
  // the prompt itself as well, otherwise the first X click succeeds but the
  // signup flow remains covered by the confirmation screen.
  const confirmationPrompt = page
    .getByText(
      /are you sure you want to exit|вы уверены, что хотите выйти|ви впевнені, що хочете вийти/i
    )
    .filter({ visible: true })
    .last();
  const confirmationPromptVisible = await confirmationPrompt
    .isVisible({ timeout: 1500 })
    .catch(() => false);

  if (confirmationVisible || confirmationPromptVisible) {
    // Match visible button text, not only its accessible name: the signup X
    // icon may also be announced as "Close" and appears earlier in the DOM.
    let confirmExit = page
      .locator('button:visible')
      .filter({
        hasText: /^\s*(close|exit|leave|yes|закрыть|выйти|так|да|закрити|вийти)\s*$/i,
      })
      .last();
    if (!(await confirmExit.isVisible({ timeout: 800 }).catch(() => false))) {
      confirmExit = page
        .getByRole('button', {
          name: /^(close|exit|leave|yes|закрыть|выйти|так|да|закрити|вийти)$/i,
        })
        .filter({ visible: true })
        .last();
    }
    if (await confirmExit.isVisible({ timeout: 800 }).catch(() => false)) {
      const clicked = await confirmExit
        .click({ timeout: 2500, force: true })
        .then(() => true)
        .catch(() => false);
      if (!clicked) {
        await confirmExit.evaluate((element) => element.click()).catch(() => null);
      }
    }
  }

  // Last-resort confirmation handling. The overlay can be mounted while the
  // close animation is still running, which makes prompt visibility checks
  // race even though its textual action is already available in the DOM.
  if (!(await modal.isHidden({ timeout: 600 }).catch(() => false))) {
    const actionRowExit = page
      .locator('.t-popup__action-row button')
      .filter({
        hasText: /^\s*(close|exit|leave|yes|закрыть|выйти|так|да|закрити|вийти)\s*$/i,
      })
      .last();
    await actionRowExit.waitFor({ state: 'visible', timeout: 4000 }).catch(() => null);
    const textualExit = (await actionRowExit.isVisible().catch(() => false))
      ? actionRowExit
      : page
          .locator('button:visible')
          .filter({
            hasText: /^\s*(close|exit|leave|yes|закрыть|выйти|так|да|закрити|вийти)\s*$/i,
          })
          .last();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!(await textualExit.isVisible({ timeout: 1000 }).catch(() => false))) break;
      const clicked = await textualExit
        .click({ timeout: 2500, force: true })
        .then(() => true)
        .catch(() => false);
      if (!clicked) {
        await textualExit.evaluate((element) => element.click()).catch(() => null);
      }
      await waitForUiSettled(page, 400).catch(() => null);
      if (await modal.isHidden({ timeout: 800 }).catch(() => false)) return true;
    }
  }

  return modal.isHidden({ timeout: 5000 }).catch(() => false);
}

function markBlocked(testInfo, description) {
  const reason = String(description || 'Blocked');
  const capabilityKey = inferCapabilityFromBlockedReason(reason);
  if (capabilityKey && isCapabilityOptionalForBrand(process.env.BASE_URL, capabilityKey)) {
    testInfo.annotations.push({
      type: 'not-applicable',
      description: `Capability "${capabilityKey}" is optional for this brand. ${reason}`,
    });
    return;
  }

  const blockedType = classifyBlockedType(reason);
  testInfo.annotations.push({ type: 'blocked', description: reason });
  testInfo.annotations.push({
    type:
      blockedType === 'infra'
        ? 'infra-blocked'
        : blockedType === 'test-infra-timeout'
          ? 'test-infra-timeout'
          : 'product-blocked',
    description: reason,
  });
}

async function waitForUiSettled(page, timeoutMs = 1500) {
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1500;
  await page
    .locator('body')
    .first()
    .waitFor({ state: 'visible', timeout })
    .catch(() => null);
  await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => null);
  const busy = page
    .locator(
      '.t-loader, .t-preloader, [class*="loader" i], [class*="spinner" i], [aria-busy="true"]'
    )
    .first();
  const busyVisible = await busy.isVisible({ timeout: 300 }).catch(() => false);
  if (busyVisible) {
    await busy.waitFor({ state: 'hidden', timeout }).catch(() => null);
  }
}

function shouldUsePointerFallback(error) {
  const message = String((error && error.message) || error || '').toLowerCase();
  return (
    message.includes('outside of the viewport') ||
    message.includes('intercepts pointer events') ||
    message.includes('not receiving pointer events') ||
    message.includes('element is detached from the dom')
  );
}

async function clickLocatorRobust(page, locator, options = {}) {
  if (!locator) return false;
  const timeout = Number.isFinite(options.timeout) && options.timeout > 0 ? options.timeout : 10000;
  const waitForNavigation = options.waitForNavigation !== false;
  const settleTimeout = Number.isFinite(options.settleTimeout) ? options.settleTimeout : 2200;

  await locator.scrollIntoViewIfNeeded().catch(() => null);
  try {
    await locator.click({ timeout, noWaitAfter: options.noWaitAfter === true });
    if (waitForNavigation) {
      await page.waitForLoadState('domcontentloaded').catch(() => null);
    }
    if (settleTimeout > 0) {
      await waitForUiSettled(page, settleTimeout);
    }
    return true;
  } catch (error) {
    if (!shouldUsePointerFallback(error)) {
      throw error;
    }
  }

  // A coordinate fallback is unsafe when a delayed popup/backdrop intercepts
  // pointer events: the click lands on the overlay and looks successful.
  await dismissOverlays(page).catch(() => null);
  // `force: true` still sends a coordinate event. A sticky sidebar/header can
  // receive that event while Playwright reports the target click as successful.
  // Dispatch the target element's native click first so the intended component
  // handler runs even when another fixed layer overlaps its coordinates.
  const domClicked = await locator
    .evaluate((node) => {
      if (!node || typeof node.click !== 'function') return false;
      node.click();
      return true;
    })
    .catch(() => false);
  if (domClicked) {
    if (waitForNavigation) {
      await page.waitForLoadState('domcontentloaded').catch(() => null);
    }
    if (settleTimeout > 0) {
      await waitForUiSettled(page, settleTimeout);
    }
    return true;
  }

  const forced = await locator
    .click({
      timeout: Math.min(timeout, 5000),
      force: true,
      noWaitAfter: options.noWaitAfter === true,
    })
    .then(() => true)
    .catch(() => false);
  if (!forced) {
    return false;
  }
  if (waitForNavigation) {
    await page.waitForLoadState('domcontentloaded').catch(() => null);
  }
  if (settleTimeout > 0) {
    await waitForUiSettled(page, settleTimeout);
  }
  return true;
}

async function openSignupModal(page, opts = {}) {
  const errorToast = page.getByText(/something went wrong/i).first();
  const retryOnError = opts.retryOnError !== false;
  const maxAttempts = opts.attempts || 3;
  const triggers = [
    '[data-testid="signup-button"]',
    'button:has-text("Sign Up")',
    'button:has-text("Sign up")',
    '.t-sidebar-menu-welcome__button_signin',
    '.t-header__signup',
    '.t-banner-registration__default_action-btn',
    'button:has-text("Sign Up Now")',
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await dismissOverlays(page);
    const alreadyOpen = await findSignupModal(page);
    if (alreadyOpen) return alreadyOpen;
    for (const selector of triggers) {
      const btn = page.locator(selector).first();
      try {
        if (await btn.isVisible()) {
          await btn.click();
          let signupWithoutDeposit = page
            .getByRole('button', { name: /sign\s*up\s*without\s*a?\s*deposit/i })
            .first();
          if (!(await signupWithoutDeposit.isVisible({ timeout: 1200 }).catch(() => false))) {
            signupWithoutDeposit = page
              .getByText(/^\s*sign\s*up\s*without\s*a?\s*deposit\s*$/i, { exact: true })
              .first();
          }
          if (await signupWithoutDeposit.isVisible({ timeout: 2500 }).catch(() => false)) {
            await signupWithoutDeposit.click({ timeout: 5000, force: true });
          }
          await Promise.any([
            waitForSignupModal(page, 5000),
            errorToast.waitFor({ state: 'visible', timeout: 2000 }),
            waitForUiSettled(page, 2000),
          ]).catch(() => null);
          const opened = await waitForSignupModal(page, 5000);
          if (opened) return opened;
          if (await errorToast.isVisible().catch(() => false)) {
            if (!retryOnError) {
              throw new Error(
                'Registration error toast: Something went wrong, please try again later.'
              );
            }
            await page.reload({ waitUntil: 'domcontentloaded' });
            await waitForHomeContent(page);
            break;
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('Registration error toast')) {
          throw err;
        }
      }
    }
  }

  throw new Error('Sign Up modal did not open.');
}

async function openLoginModal(page, opts = {}) {
  const errorToast = page.getByText(/something went wrong/i).first();
  const retryOnError = opts.retryOnError !== false;
  const maxAttempts = opts.attempts || 3;
  const loginLabelRe =
    /log\s*in|sign\s*in|connexion|se connecter|anmelden|entrar|iniciar sesi[oó]n|accedi|войти|увійти/i;
  const triggers = [
    '[data-testid="login-button"]',
    '[data-testid*="login" i]',
    '[data-testid*="signin" i]',
    'button:has-text("Log In")',
    'button:has-text("Log in")',
    'button:has-text("Sign In")',
    'button:has-text("Se connecter")',
    'button:has-text("Connexion")',
    'button:has-text("Anmelden")',
    'button:has-text("Entrar")',
    'button:has-text("Войти")',
    'button:has-text("Увійти")',
    'a:has-text("Log In")',
    'a:has-text("Sign In")',
    'a:has-text("Se connecter")',
    'a:has-text("Connexion")',
    'a:has-text("Anmelden")',
    'a:has-text("Entrar")',
    'a:has-text("Войти")',
    'a:has-text("Увійти")',
    '.t-sidebar-menu-welcome__button_login',
    '.t-sidebar-menu-welcome__button_signin',
    '.t-header__login',
    'a[href*="login" i]',
    'a[href*="signin" i]',
    'button[class*="login" i]',
    'a[class*="login" i]',
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await dismissOverlays(page);
    const alreadyOpen = await findLoginModal(page);
    if (alreadyOpen) return alreadyOpen;
    const depositGateVisible = await page
      .getByText(/deposit\s*&\s*play/i)
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (depositGateVisible) {
      const gateLogin = page.getByText(/^\s*log\s*in\s*$/i, { exact: true }).last();
      if (await gateLogin.isVisible({ timeout: 500 }).catch(() => false)) {
        await gateLogin.click({ timeout: 3000, force: true }).catch(() => null);
        const opened = await waitForLoginModal(page, 5000);
        if (opened) return opened;
      }
    }
    for (const selector of triggers) {
      const btn = page.locator(selector).first();
      try {
        if (await btn.isVisible()) {
          await btn.click({ timeout: 5000 });
          const opened = await waitForLoginModal(page, 5000);
          if (opened) return opened;
          if (await errorToast.isVisible().catch(() => false)) {
            if (!retryOnError) {
              throw new Error('Login error toast: Something went wrong, please try again later.');
            }
            await page.reload({ waitUntil: 'domcontentloaded' });
            await waitForHomeContent(page);
            break;
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('Login error toast')) {
          throw err;
        }
      }
    }

    const fallbackCandidates = [
      page.getByRole('button', { name: loginLabelRe }).first(),
      page.getByRole('link', { name: loginLabelRe }).first(),
      page
        .locator('[data-testid*="login" i], [data-testid*="signin" i], [class*="login" i]')
        .first(),
    ];
    for (const candidate of fallbackCandidates) {
      const visible = await candidate.isVisible({ timeout: 500 }).catch(() => false);
      if (!visible) continue;
      await candidate.click({ timeout: 5000 }).catch(() => null);
      const opened = await waitForLoginModal(page, 5000);
      if (opened) return opened;
    }
  }

  throw new Error('Log In modal did not open.');
}

async function waitForHomeContent(page) {
  await assertNotCloudflare(page);
  const appRoot = page.locator('#app, #__nuxt').first();
  try {
    await appRoot.waitFor({ state: 'visible', timeout: 45000 });
  } catch {
    await assertNotCloudflare(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertNotCloudflare(page);
    await appRoot.waitFor({ state: 'visible', timeout: 45000 });
  }

  const gameLinks = page.locator('a.t-game-play__link-demo, a[href^="/casino/"]');
  const mainBanner = page.locator('[data-testid="main-banner"]').first();
  const ctaBanner = page.locator('.t-banner-registration__default_action-btn').first();

  await Promise.any([
    gameLinks.first().waitFor({ state: 'visible', timeout: 60000 }),
    mainBanner.waitFor({ state: 'visible', timeout: 60000 }),
    ctaBanner.waitFor({ state: 'visible', timeout: 60000 }),
  ]);
}

module.exports = {
  assertNotCloudflare,
  createWafProbe,
  detectCloudflare,
  dismissOverlays,
  closeMobileNavigationOverlay,
  closeModal,
  markBlocked,
  maybeSkipWaf,
  openLoginModal,
  openSignupModal,
  clickLocatorRobust,
  tryAutoBypassCloudflare,
  waitForHomeContent,
  waitForUiSettled,
};
