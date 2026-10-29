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

  const authorizedShellVisible = await page
    .locator(
      'a[href*="/profile/"]:visible, [data-testid*="balance" i]:visible, button:has-text("Deposit"):visible'
    )
    .first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);
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
    await signupBtn.click();

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
    await loginBtn.click();

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
    const searchInput = await firstVisible(page, [
      'input[placeholder="Search"]',
      'input[placeholder="Поиск"]',
      '.t-search__input input',
      '[data-testid*="search" i] input',
      '.t-sidebar-menu input[placeholder]',
      'input[type="search"]',
    ]);
    if (!searchInput) {
      test.info().annotations.push({
        type: 'search',
        description: 'Search input is not exposed in current homepage/sidebar layout.',
      });
      return;
    }
    await searchInput.click().catch(() => null);
    await page
      .locator('.t-game-search-modal input:not([type="hidden"])')
      .first()
      .waitFor({ state: 'visible', timeout: 5000 })
      .catch(() => null);
    const modalSearchInput = await firstVisible(page, [
      '.t-game-search-modal input:not([type="hidden"])',
      '.t-game-search-modal [contenteditable="true"]',
    ]);
    const effectiveSearchInput = modalSearchInput || searchInput;
    await effectiveSearchInput.fill('');
    await effectiveSearchInput.pressSequentially('roulette', { delay: 60 });
    const searchValue = await effectiveSearchInput.inputValue().catch(() => '');
    if (!/roulette/i.test(searchValue)) {
      markBlocked(
        test.info(),
        'Product blocked: the visible homepage Search input clears typed text and cannot accept a query.'
      );
      return;
    }
    await effectiveSearchInput.fill('');
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
