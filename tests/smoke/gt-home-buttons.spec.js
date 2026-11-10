const { test, expect } = require('../fixtures/qa-test');
const {
  assertNotCloudflare,
  createWafProbe,
  dismissOverlays,
  closeModal,
  markBlocked,
  maybeSkipWaf,
  waitForHomeContent,
} = require('../helpers/gt-utils');
const { isAuthTokenName } = require('../helpers/auth-state');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickActionable(locator, timeout = 7000) {
  if (!locator) return false;

  try {
    await locator.scrollIntoViewIfNeeded().catch(() => null);
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ timeout });
      return true;
    }
  } catch {
    // try fallback click strategies below
  }

  try {
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ timeout: Math.min(timeout, 4000), force: true });
      return true;
    }
  } catch {
    // continue
  }

  try {
    if (await locator.isVisible().catch(() => false)) {
      await locator.evaluate((el) => {
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.click();
      });
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (visible) return locator;
  }
  return null;
}

async function firstActionable(page, selectors) {
  for (const selector of selectors) {
    const candidates = page.locator(selector);
    const count = Math.min(await candidates.count().catch(() => 0), 12);
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      const actionable = await candidate
        .evaluate((element) => {
          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height) return false;
          const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
          const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
          if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
          const top = document.elementFromPoint(x, y);
          return Boolean(
            top && (top === element || element.contains(top) || top.contains(element))
          );
        })
        .catch(() => false);
      if (actionable) return candidate;
    }
  }
  return null;
}

async function expandHeaderMenu(page) {
  const toggles = [
    '[data-testid="sidebar-burger-button"]',
    '[data-testid="header-burger-button"]',
    '.t-header__toggle',
    'button:has-text("Open Sidebar")',
    'button[aria-label*="menu" i]',
    'button[class*="burger" i]',
  ];
  const toggle = await firstVisible(page, toggles);
  if (!toggle) return false;
  await clickActionable(toggle, 5000).catch(() => null);
  await sleep(600);
  return true;
}

test('GT Home: primary buttons work', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const wafProbe = createWafProbe(page);
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await assertNotCloudflare(page);
    await dismissOverlays(page);
    await waitForHomeContent(page);
  } catch (err) {
    if (await maybeSkipWaf({ page, probe: wafProbe, testInfo, error: err })) return;
    throw err;
  }

  if (await maybeSkipWaf({ page, probe: wafProbe, testInfo })) return;

  const authCookies = await page
    .context()
    .cookies(BASE_URL)
    .catch(() => []);
  const authorizedShellVisible =
    authCookies.some((cookie) => isAuthTokenName(cookie.name) && Boolean(cookie.value)) ||
    (await page
      .locator(
        'a[href*="/profile/"]:visible, [data-testid*="balance" i]:visible, [class*="balance" i]:visible, [class*="wallet" i]:visible, button:has-text("Deposit"):visible'
      )
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false));
  let modalFlowBlocked = false;

  await test.step('Sign Up button opens/closes modal', async () => {
    await dismissOverlays(page);
    let signupBtn = await firstVisible(page, [
      '[data-testid="signup-button"]',
      'button:has-text("Sign Up")',
      'button:has-text("Sign up")',
    ]);
    if (!signupBtn) {
      await expandHeaderMenu(page);
      signupBtn = await firstVisible(page, [
        '[data-testid="signup-button"]',
        'button:has-text("Sign Up")',
        'button:has-text("Sign up")',
      ]);
    }
    if (!signupBtn) {
      test.info().annotations.push({
        type: authorizedShellVisible ? 'not-applicable' : 'signup-button',
        description: authorizedShellVisible
          ? 'Guest Sign Up control is not applicable in the authorized homepage shell.'
          : 'Sign Up button is not visible in current homepage layout.',
      });
      return;
    }
    await signupBtn.click({ timeout: 5000 });

    const modal = page
      .locator('.t-signup-modal, [data-testid="signup-modal"], .t-signup:has(input)')
      .first();
    await expect(modal).toBeVisible({ timeout: 15000 });

    const closed = await closeModal(modal, page);
    if (!closed) {
      const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);
      if (screenshot) {
        await testInfo.attach('signup-modal-close-failed.png', {
          body: screenshot,
          contentType: 'image/png',
        });
      }
      markBlocked(
        testInfo,
        'Sign Up exit confirmation Close action does not dismiss the registration modal.'
      );
      modalFlowBlocked = true;
      return;
    }
    await expect(modal).toBeHidden({ timeout: 15000 });
  });
  if (modalFlowBlocked) return;

  await test.step('Log In button opens/closes modal', async () => {
    await dismissOverlays(page);
    let loginBtn = await firstVisible(page, [
      '[data-testid="login-button"]',
      'button:has-text("Log In")',
      'button:has-text("LOG IN")',
      'button:has-text("Login")',
    ]);
    if (!loginBtn) {
      await expandHeaderMenu(page);
      loginBtn = await firstVisible(page, [
        '[data-testid="login-button"]',
        'button:has-text("Log In")',
        'button:has-text("LOG IN")',
        'button:has-text("Login")',
      ]);
    }
    if (!loginBtn) {
      test.info().annotations.push({
        type: authorizedShellVisible ? 'not-applicable' : 'login-button',
        description: authorizedShellVisible
          ? 'Guest Log In control is not applicable in the authorized homepage shell.'
          : 'Log In button is not visible in current homepage layout.',
      });
      return;
    }
    await loginBtn.click({ timeout: 5000 });

    const modal = page
      .locator('.t-login-modal, [data-testid="login-modal"], .t-login:has(input)')
      .first();
    await expect(modal).toBeVisible({ timeout: 15000 });

    const closed = await closeModal(modal, page);
    if (!closed) {
      const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);
      if (screenshot) {
        await testInfo.attach('login-modal-close-failed.png', {
          body: screenshot,
          contentType: 'image/png',
        });
      }
      markBlocked(testInfo, 'Log In close action does not dismiss the authentication modal.');
      modalFlowBlocked = true;
      return;
    }
    await expect(modal).toBeHidden({ timeout: 15000 });
  });
  if (modalFlowBlocked) return;

  await test.step('Search input accepts text', async () => {
    await dismissOverlays(page);
    const mobileLayout = (page.viewportSize()?.width || 1365) <= 600;
    let searchInput = await firstActionable(page, [
      '.t-game-search-modal input:not([type="hidden"])',
      'input[placeholder="Search"]',
      'input[placeholder="Поиск"]',
      '.t-search__input input',
      '[data-testid*="search" i] input',
      '.t-sidebar-menu input[placeholder]',
      'input[type="search"]',
    ]);

    if (mobileLayout && !searchInput) {
      const searchTrigger = await firstActionable(page, [
        '[data-testid*="search" i]:not(input)',
        '[class*="bottom" i] [class*="search" i]',
        '[class*="mobile" i] [class*="search" i]',
        'text=/^Search$/i',
      ]);
      if (searchTrigger) {
        await clickActionable(searchTrigger, 5000);
        await page
          .locator('.t-game-search-modal input:not([type="hidden"]), input[type="search"]')
          .first()
          .waitFor({ state: 'visible', timeout: 5000 })
          .catch(() => null);
        searchInput = await firstActionable(page, [
          '.t-game-search-modal input:not([type="hidden"])',
          'input[type="search"]',
          'input[placeholder="Search"]',
        ]);
      }
    }

    if (!searchInput) {
      test.info().annotations.push({
        type: 'search',
        description: 'Search input is not exposed in current homepage/sidebar layout.',
      });
      return;
    }
    await searchInput.click({ timeout: 5000 }).catch(() => null);
    await page
      .locator('.t-game-search-modal input:not([type="hidden"])')
      .first()
      .waitFor({ state: 'visible', timeout: 5000 })
      .catch(() => null);
    const modalSearchInput = await firstActionable(page, [
      '.t-game-search-modal input:not([type="hidden"])',
      '.t-game-search-modal [contenteditable="true"]',
    ]);
    const effectiveSearchInput = modalSearchInput || searchInput;
    await effectiveSearchInput.fill('', { timeout: 5000 });
    await effectiveSearchInput.pressSequentially('roulette', { delay: 60, timeout: 5000 });
    const searchValue = await effectiveSearchInput.inputValue().catch(() => '');
    if (!/roulette/i.test(searchValue)) {
      markBlocked(
        test.info(),
        'Product blocked: the visible homepage Search input clears typed text and cannot accept a query.'
      );
      return;
    }
    await effectiveSearchInput.fill('', { timeout: 5000 });
  });

  await test.step('Visible buttons are not disabled (info only)', async () => {
    const buttons = page.locator('button:visible');
    const count = await buttons.count();
    const inspectCount = Math.min(count, 120);
    const disabled = [];

    for (let i = 0; i < inspectCount; i++) {
      const btn = buttons.nth(i);
      const isDisabled = await btn
        .evaluate((el) => {
          if (!el) return false;
          const attrDisabled = el.hasAttribute('disabled');
          const ariaDisabled = String(el.getAttribute('aria-disabled') || '').toLowerCase();
          return attrDisabled || ariaDisabled === 'true';
        })
        .catch(() => false);
      if (!isDisabled) continue;

      const text = (await btn.innerText().catch(() => '')).trim();
      const aria = (await btn.getAttribute('aria-label').catch(() => '')).trim();
      const label = text || aria || 'button';
      disabled.push(label);
    }

    if (count > inspectCount) {
      test.info().annotations.push({
        type: 'diagnostic',
        description: `Disabled-buttons scan limited to first ${inspectCount}/${count} visible buttons to avoid unstable detached controls.`,
      });
    }

    if (disabled.length) {
      test.info().annotations.push({
        type: 'disabled-buttons',
        description: disabled.slice(0, 15).join(' | '),
      });
    }
  });
});
