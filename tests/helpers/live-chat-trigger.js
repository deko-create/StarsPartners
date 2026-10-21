const { clickLocatorRobust, waitForUiSettled } = require('./gt-utils');

const TRIGGER_SELECTOR = [
  '[data-testid="sidebar-Live chat-button"]:visible',
  '[data-testid="sidebar-liveChat-button"]:visible',
  '[data-testid="online-chat-button"]:visible',
  'a:has-text("Live chat"):visible',
  'button:has-text("Live chat"):visible',
  '[role="button"]:has-text("Live chat"):visible',
].join(', ');

async function visibleTrigger(page, timeoutMs = 1000) {
  const trigger = page.locator(TRIGGER_SELECTOR).first();
  await trigger.waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => null);
  return (await trigger.isVisible().catch(() => false)) ? trigger : null;
}

async function findLiveChatTrigger(page, timeoutMs = 15_000) {
  const direct = await visibleTrigger(page, Math.min(timeoutMs, 3000));
  if (direct) return direct;

  const toggleSelectors = [
    '[data-testid="sidebar-burger-button"]',
    '[data-testid="header-burger-button"]',
    '.t-quick-navigations__item.menu',
    '.t-quick-navigations__item:has(.t-icon-menu)',
    '.t-header__toggle',
    'button[aria-label*="sidebar" i]',
    'button[aria-label*="menu" i]',
    'button[class*="burger" i]',
  ];

  for (const selector of toggleSelectors) {
    const toggle = page.locator(selector).first();
    if (!(await toggle.isVisible({ timeout: 500 }).catch(() => false))) continue;
    await clickLocatorRobust(page, toggle, {
      timeout: 5000,
      waitForNavigation: false,
      settleTimeout: 700,
    }).catch(() => false);
    await waitForUiSettled(page, 700).catch(() => null);
    const expanded = await visibleTrigger(page, 2500);
    if (expanded) return expanded;
  }

  return visibleTrigger(page, Math.max(1000, timeoutMs - 3000));
}

module.exports = { findLiveChatTrigger };
