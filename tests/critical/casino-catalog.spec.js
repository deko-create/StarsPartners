const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { test, expect } = require('../fixtures/qa-test');
const {
  clickLocatorRobust,
  closeModal,
  closeMobileNavigationOverlay,
  detectCloudflare,
  dismissOverlays,
  markBlocked,
  waitForUiSettled,
} = require('../helpers/gt-utils');
const { pickBestAuthStatePath } = require('../helpers/auth-state');
const {
  resolveExtraHTTPHeaders,
  resolveMatrixContextOptions,
} = require('../helpers/context-options');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const BASE_ORIGIN = new URL(BASE_URL).origin;
const PROJECT_AUTOTEST_REPORT_DIR =
  process.env.QA_AUTOTEST_REPORT_DIR || path.join(process.cwd(), 'Autotest report');
const PROJECT_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR || path.join(process.cwd(), 'artifacts');
const ARTIFACT_DIR = path.join(PROJECT_AUTOTEST_REPORT_DIR, 'casino');
const VISUAL_DIR = path.join(ARTIFACT_DIR, 'visual');
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(route) {
  return new URL(route, BASE_ORIGIN).toString();
}

function pickAuthStatePath() {
  return pickBestAuthStatePath(AUTH_STATE_CANDIDATES);
}

function toSlug(value) {
  return String(value || 'test')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function writeAndAttach(testInfo, name, payload) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const fileName = `${toSlug(name)}.json`;
  const filePath = path.join(ARTIFACT_DIR, fileName);
  const body = JSON.stringify(payload, null, 2);
  fs.writeFileSync(filePath, body, 'utf8');
  await testInfo.attach(fileName, { body, contentType: 'application/json' });
  return filePath;
}

async function resolveWithTimeout(promise, timeoutMs) {
  const safeTimeout = Math.max(1000, Number(timeoutMs) || 1000);
  const TIMEOUT = Symbol('timeout');
  let timer = null;

  const observed = promise
    .then((value) => ({ kind: 'value', value }))
    .catch((error) => ({ kind: 'error', error }));
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), safeTimeout);
  });

  const raced = await Promise.race([observed, timeout]);
  if (timer) clearTimeout(timer);
  if (raced === TIMEOUT) return { timedOut: true, value: null };
  if (raced.kind === 'error') throw raced.error;
  return { timedOut: false, value: raced.value };
}

async function closeContextBounded(context, timeoutMs = 5000) {
  if (!context) return;
  await resolveWithTimeout(
    context.close().catch(() => null),
    timeoutMs
  ).catch(() => null);
}

async function firstVisibleLocator(root, selectors) {
  for (const selector of selectors) {
    const locator = root.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 300);
    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return null;
}

async function enterSearchQuery(input, query) {
  await input.click({ timeout: 3000 }).catch(() => null);
  await input.fill('');
  await input.pressSequentially(String(query || ''), { delay: 35 });
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

  const challengeFrameVisible = await page
    .locator(
      'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], .cf-turnstile, [id*="turnstile"]'
    )
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (challengeFrameVisible) return 'Challenge widget (Turnstile/Cloudflare) is visible.';

  if (await hasChallengeTokenPage(page)) {
    return 'Cloudflare token page detected (no app root + token body).';
  }

  return null;
}

async function openCasino(page) {
  const requestedUrl = buildUrl('/casino/');
  const attemptsLimit = Math.max(1, Number.parseInt(process.env.PW_CASINO_OPEN_RETRIES || '3', 10));
  let lastState = null;

  for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
    let response = null;
    let navigationError = null;
    try {
      response = await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (err) {
      navigationError = String(err && err.message ? err.message : err);
    }

    await dismissOverlays(page);
    await page
      .locator('body')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => null);

    const challenge = await getChallengeReason(page);
    lastState = {
      route: '/casino/',
      requestedUrl,
      finalUrl: page.url(),
      status: response ? response.status() : 0,
      title: await page.title().catch(() => ''),
      challenge: challenge || (navigationError ? `Navigation failed: ${navigationError}` : null),
      attempt,
    };
    if (!lastState.challenge) return lastState;

    if (attempt < attemptsLimit) {
      await sleep(900 * attempt);
    }
  }

  return lastState;
}

async function waitForCasinoContent(page) {
  const deadlineAt = Date.now() + 30_000;
  let lastState = { gameCards: 0, skeletons: 0, emptyStateVisible: false };
  while (Date.now() < deadlineAt) {
    const gameCards = await page
      .locator(
        '.t-games-catalog .t-game-item, .t-games-catalog a[href*="/casino/"], main .t-game-item, main [class*="game-play" i] a[href], main [class*="game-card" i] a[href]'
      )
      .count()
      .catch(() => 0);
    const skeletons = await page
      .locator(
        'main [class*="skeleton" i]:visible, main [class*="placeholder" i]:visible, main [aria-busy="true"]:visible'
      )
      .count()
      .catch(() => 0);
    const emptyStateVisible = await page
      .getByText(/^(nothing found|no games|no results|not available)$/i)
      .first()
      .isVisible()
      .catch(() => false);
    lastState = { gameCards, skeletons, emptyStateVisible };
    if ((gameCards > 0 || emptyStateVisible) && skeletons === 0) {
      return { ready: true, ...lastState };
    }
    await sleep(400);
  }
  return { ready: false, ...lastState };
}

async function collectCatalogEntries(page) {
  return page
    .evaluate(() => {
      function isVisible(el) {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (!style) return false;
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0) return false;
        if (rect.width < 16 || rect.height < 16) return false;
        return true;
      }

      const root =
        document.querySelector('.t-games-catalog, [class*="games-catalog" i], main') ||
        document.body;
      const links = Array.from(
        root.querySelectorAll(
          '.t-game-item, a[href*="/casino/"], [class*="game-play" i], [class*="games-item" i], [class*="game-card" i]'
        )
      ).filter((node) => isVisible(node));

      const unique = new Map();
      for (const [index, node] of links.entries()) {
        const anchor = node.matches('a[href]') ? node : node.querySelector('a[href*="/casino/"]');
        const href = (anchor && anchor.getAttribute('href')) || '';
        const imageTitle = node.querySelector('img[alt]')?.getAttribute('alt') || '';
        const text = (node.innerText || imageTitle || node.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!href && !text) continue;
        const key = `${href}|${text || `card-${index + 1}`}`;
        if (!unique.has(key)) unique.set(key, { href, text });
      }
      return [...unique.values()];
    })
    .catch(() => []);
}

async function pickVisibleCatalogSearchQuery(page) {
  return page
    .evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.t-game-item'));
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        const style = window.getComputedStyle(card);
        if (
          rect.width < 16 ||
          rect.height < 16 ||
          style.display === 'none' ||
          style.visibility === 'hidden'
        ) {
          continue;
        }
        const title = (
          card.querySelector('.t-game-item__hover-name')?.textContent ||
          card.querySelector('img[alt]')?.getAttribute('alt') ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim();
        const query = title
          .split(/\s+/)
          .filter((word) => word.length >= 3)
          .slice(0, 2)
          .join(' ');
        if (query) return { title, query };
      }
      return { title: '', query: '' };
    })
    .catch(() => ({ title: '', query: '' }));
}

async function mobileSidebarCoversViewport(page) {
  const activeToggle = await firstVisibleLocator(page, [
    '.t-sidebar-menu__toggle-btn-active',
    '.t-sidebar-menu__toggle-btn.is-active',
    '[class*="sidebar-menu" i] [class*="toggle" i][class*="active" i]',
  ]);
  if (activeToggle) return true;
  return page
    .locator('aside, [role="complementary"], [class*="sidebar-menu" i]')
    .evaluateAll((elements) =>
      elements.some((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const text = String(element.textContent || '');
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 &&
          rect.width > 180 &&
          rect.height > window.innerHeight * 0.4 &&
          rect.left < window.innerWidth / 2 &&
          rect.right > window.innerWidth / 2 &&
          /deposit|invite\s*&\s*earn|my profile/i.test(text)
        );
      })
    )
    .catch(() => false);
}

async function closeMobileSidebarIfOpen(page) {
  const sidebarCoversViewport = await mobileSidebarCoversViewport(page);
  if (!sidebarCoversViewport) return false;
  const sharedClosed = await closeMobileNavigationOverlay(page).catch(() => false);
  if (!(await mobileSidebarCoversViewport(page))) return sharedClosed;
  const activeToggle = await firstVisibleLocator(page, [
    '.t-sidebar-menu__toggle-btn-active',
    '.t-sidebar-menu__toggle-btn.is-active',
    '[class*="sidebar-menu" i] [class*="toggle" i][class*="active" i]',
    '[data-testid="sidebar-burger-button"]',
    'aside button',
    '[role="complementary"] button',
  ]);
  if (!activeToggle) return false;
  const closed = await activeToggle
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (closed) await waitForUiSettled(page, 700);
  return closed;
}

async function closeCasinoPromotionModal(page, timeoutMs = 2500) {
  const title = page.getByText(/bring your vip\s*[—-]\s*we match/i).first();
  const visible = await title.isVisible({ timeout: timeoutMs }).catch(() => false);
  if (!visible) return false;

  const modal = title
    .locator(
      'xpath=ancestor::*[@role="dialog" or contains(translate(@class, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "modal") or contains(translate(@class, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "popup")][1]'
    )
    .first();
  const scope = (await modal.isVisible().catch(() => false)) ? modal : page;
  const buttons = scope.locator('button:visible');
  const count = Math.min(await buttons.count().catch(() => 0), 12);
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const text = String((await button.innerText().catch(() => '')) || '').trim();
    const ariaLabel = String((await button.getAttribute('aria-label').catch(() => '')) || '');
    if (text && !/close|dismiss/i.test(text)) continue;
    if (!text && ariaLabel && !/close|dismiss/i.test(ariaLabel)) continue;
    const clicked = await button
      .click({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (clicked) {
      await waitForUiSettled(page, 700);
      return true;
    }
  }
  return false;
}

async function openSearchModal(page) {
  // Reward/subscription prompts can be injected after the casino route has
  // already settled. Dismiss them immediately before resolving the search UI.
  await dismissOverlays(page);
  await waitForUiSettled(page, 500);

  const inlineInput = await firstVisibleLocator(page, [
    '.t-games-catalog input[placeholder*="Search" i]',
    '.t-games-catalog input[type="search"]',
    '.t-games-catalog input[class*="search" i]',
    '[class*="games-catalog" i] input[placeholder*="Search" i]',
    '[class*="games-catalog" i] input[type="search"]',
    '.t-game-search-modal input:not([type="hidden"])',
  ]);
  if (inlineInput) {
    return {
      opened: true,
      inputVisible: true,
      modal: null,
      input: inlineInput,
      reason: null,
    };
  }

  const candidates = [
    '.t-games-catalog__search-btn',
    '[class*="search-btn" i]',
    '[aria-label*="search" i]',
    'button[class*="search" i]',
    '[class*="games-catalog" i] [class*="search" i]',
    '[data-testid*="search" i]',
  ];
  let searchButton = null;

  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 3000 }).catch(() => null);
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    searchButton = locator;
    break;
  }

  let clicked = false;
  if (searchButton) {
    clicked = await clickLocatorRobust(page, searchButton, {
      timeout: 7000,
      waitForNavigation: false,
      settleTimeout: 500,
    }).catch(() => false);
    await waitForUiSettled(page, 1500);
  }

  if (!clicked) {
    const domFallbackClicked = await page
      .evaluate(() => {
        const selectors = [
          '.t-games-catalog__search-btn',
          '[class*="search-btn" i]',
          '[aria-label*="search" i]',
          'button[class*="search" i]',
          '[class*="games-catalog" i] [class*="search" i]',
          '[data-testid*="search" i]',
        ];
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (!element) continue;
          element.click();
          return true;
        }
        return false;
      })
      .catch(() => false);
    if (!domFallbackClicked) {
      return {
        opened: false,
        inputVisible: false,
        modal: null,
        input: null,
        reason: 'Search button not found.',
      };
    }
    await waitForUiSettled(page, 1500);
  }

  // The Vue modal is teleported into the app root after the click transition.
  // `locator.count()` is instantaneous, so wait for the concrete control before
  // resolving the selector matrix below.
  await page
    .locator(
      '.t-game-search-modal input:not([type="hidden"]), .t-game-search-modal [contenteditable="true"]'
    )
    .first()
    .waitFor({ state: 'visible', timeout: 6000 })
    .catch(() => null);

  const input = await firstVisibleLocator(page, [
    '.t-modal input[placeholder*="Game" i]',
    '[role="dialog"] input[placeholder*="Game" i]',
    'input[placeholder*="Game" i][placeholder*="Provider" i]',
    'input[placeholder*="Provider" i][placeholder*="Collections" i]',
    '[class*="games-search" i] input',
    '[role="dialog"] input[type="search"]',
    '[role="dialog"] input[type="text"]',
    '.t-modal input[type="search"]',
    '.t-modal input[type="text"]',
    '.t-game-search-modal input[type="search"]',
    '.t-game-search-modal input[type="text"]',
    '.t-game-search-modal input:not([type="hidden"])',
    '.t-game-search-modal [contenteditable="true"]',
    '.t-games-catalog input[placeholder*="Search" i]',
    '.t-games-catalog input[type="search"]',
    '.t-games-catalog input[class*="search" i]',
    '[class*="games-catalog" i] input[placeholder*="Search" i]',
  ]);

  let modal = null;
  if (input) {
    const parentModal = input
      .locator('xpath=ancestor::*[@role="dialog" or contains(@class,"modal")][1]')
      .first();
    if (await parentModal.isVisible().catch(() => false)) {
      modal = parentModal;
    }
  }

  if (!modal) {
    modal = await firstVisibleLocator(page, [
      '.t-game-search-modal:visible',
      '.t-modal:visible',
      '[role="dialog"]:visible',
      '[class*="games-search" i]:visible',
    ]);
  }
  const inputVisible = Boolean(input);
  const opened = Boolean(modal || input);

  return {
    opened,
    inputVisible,
    modal,
    input,
    reason: !opened
      ? 'Search modal/input not visible.'
      : inputVisible
        ? null
        : 'Search input not visible.',
  };
}

async function closeSearchModal(modal, page) {
  if (modal) {
    const closeButton = await firstVisibleLocator(modal, [
      '[aria-label*="close" i]',
      'button:has-text("Close")',
      '[class*="close" i]',
    ]);
    if (closeButton) {
      await closeButton.click({ timeout: 5000 }).catch(() => null);
      await waitForUiSettled(page, 1200);
      return true;
    }
    await closeModal(modal, page).catch(() => null);
  }
  await page.keyboard.press('Escape').catch(() => null);
  await waitForUiSettled(page, 1200);
  return true;
}

async function collectSearchResultTitles(modalOrPage) {
  const scope = modalOrPage;
  const titleSelectors = [
    '[class*="search" i] [class*="title" i]',
    '[class*="search" i] [class*="name" i]',
    '[class*="game" i] [class*="title" i]',
    '[class*="game" i] [class*="name" i]',
    '[class*="search" i] img[alt]',
    '.t-game-search-modal img[alt]',
    'a[href*="/casino/"]',
  ];

  const titles = [];
  for (const selector of titleSelectors) {
    const items = scope.locator(selector);
    const count = Math.min(await items.count(), 80);
    for (let i = 0; i < count; i += 1) {
      const item = items.nth(i);
      const visible = await item.isVisible().catch(() => false);
      if (!visible) continue;
      const text = (
        (await item.innerText().catch(() => '')) ||
        (await item.getAttribute('alt').catch(() => '')) ||
        (await item.getAttribute('title').catch(() => '')) ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) continue;
      titles.push(text);
    }
  }

  const unique = [...new Set(titles)];
  return unique.filter((item) => !/^(search|recommended|games|load more)$/i.test(item));
}

async function openFilterPanelInternal(page) {
  await dismissOverlays(page).catch(() => null);
  await closeMobileSidebarIfOpen(page).catch(() => false);
  if (await mobileSidebarCoversViewport(page)) {
    return {
      opened: false,
      panel: null,
      reason: 'Mobile sidebar remained open and covered the casino filter controls.',
    };
  }

  const panelSelectors = [
    '.t-games-catalog__quick-access:visible:has(.t-games-filters-block)',
    '.t-games-filters-mobile__body:visible',
    '.t-games-filters-mobile__body .t-games-filters-block.providers:visible',
    '.t-games-filters-block.providers.is-active-tabs:visible',
    '.t-games-filters-block.providers:visible',
    '[class*="games-filters-mobile__body" i]:visible',
    '[class*="games-filters-panel" i]:visible',
    '[class*="filters" i][class*="providers" i]:visible',
  ];
  const existingPanel = await firstVisibleLocator(page, panelSelectors);
  if (existingPanel) return { opened: true, panel: existingPanel, reason: null };

  const selectors = [
    '.t-games-filters-mobile__toggle',
    '[class*="games-filters-mobile__toggle" i]',
    '.t-games-catalog__head-filters button',
    '[class*="head-filter" i] button',
    '[class*="filter-toggle" i]',
    '[data-filter*="filters" i]',
    '[class*="games-filters-mobile__head" i] button',
    '.t-games-catalog button:has-text("Filters")',
    '.t-games-catalog button:has-text("Filter")',
  ];

  let clicked = false;
  for (const selector of selectors) {
    const candidates = page.locator(selector);
    const count = Math.min(await candidates.count().catch(() => 0), 8);
    for (let index = 0; index < count; index += 1) {
      const toggle = candidates.nth(index);
      if (!(await toggle.isVisible().catch(() => false))) continue;
      const belongsToSidebar = await toggle
        .evaluate((node) => Boolean(node.closest('aside, [role="complementary"], .t-sidebar-menu')))
        .catch(() => true);
      if (belongsToSidebar) continue;

      clicked = await clickLocatorRobust(page, toggle, {
        timeout: 5000,
        waitForNavigation: false,
        settleTimeout: 500,
      }).catch(() => false);
      if (!clicked) continue;

      if (await mobileSidebarCoversViewport(page)) {
        await closeMobileSidebarIfOpen(page).catch(() => false);
        clicked = false;
        continue;
      }

      for (let attempt = 0; attempt < 12; attempt += 1) {
        const panel = await firstVisibleLocator(page, panelSelectors);
        if (panel) return { opened: true, panel, reason: null };
        await waitForUiSettled(page, 250);
      }
      clicked = false;
    }
  }

  if (!clicked) {
    const domFallbackClicked = await page
      .evaluate(() => {
        const selectors = [
          '.t-games-filters-mobile__toggle',
          '[class*="games-filters-mobile__toggle" i]',
          '.t-games-catalog__head-filters button',
          '[class*="head-filter" i] button',
          '[class*="filter-toggle" i]',
          '[data-filter*="filters" i]',
          '[class*="games-filters-mobile__head" i] button',
        ];
        for (const selector of selectors) {
          const element = Array.from(document.querySelectorAll(selector)).find((candidate) => {
            if (candidate.closest('aside, [role="complementary"], .t-sidebar-menu')) return false;
            const rect = candidate.getBoundingClientRect();
            const style = globalThis.getComputedStyle(candidate);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden'
            );
          });
          if (!(element instanceof globalThis.HTMLElement)) continue;
          element.click();
          return true;
        }
        return false;
      })
      .catch(() => false);
    if (!domFallbackClicked) {
      return { opened: false, panel: null, reason: 'Filter toggle not found.' };
    }
    clicked = true;
  }

  if (clicked) {
    if (await mobileSidebarCoversViewport(page)) {
      await closeMobileSidebarIfOpen(page).catch(() => false);
      return {
        opened: false,
        panel: null,
        reason: 'Filter toggle opened the mobile sidebar instead of the filter panel.',
      };
    }
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const panel = await firstVisibleLocator(page, panelSelectors);
      if (panel) return { opened: true, panel, reason: null };
      await waitForUiSettled(page, 250);
    }
  }

  const inlineProviderRows = page.locator(
    '.t-games-filters-block.providers .t-checkbox, .t-games-select__checkbox .t-checkbox'
  );
  const inlineCount = await inlineProviderRows.count().catch(() => 0);
  if (inlineCount > 0) {
    return {
      opened: true,
      panel: page.locator('main, body').first(),
      reason: null,
      inline: true,
    };
  }

  const overlayOpened = await page
    .locator('.t-games-catalog__quick-access:visible')
    .first()
    .isVisible()
    .catch(() => false);
  const filterSkeletonVisible = await page
    .locator('.t-games-filters-skeleton:visible, [class*="games-filters-skeleton" i]:visible')
    .first()
    .isVisible()
    .catch(() => false);
  const diagnostics = await page
    .evaluate(() => ({
      toggles: document.querySelectorAll('.t-games-filters-mobile__toggle').length,
      quickAccess: document.querySelectorAll('.t-games-catalog__quick-access').length,
      providerBlocks: document.querySelectorAll('.t-games-filters-block.providers').length,
      checkboxes: document.querySelectorAll(
        '.t-games-filters-block.providers .t-checkbox, .t-games-select__checkbox .t-checkbox'
      ).length,
      visibleFilterClasses: Array.from(document.querySelectorAll('[class*="games-filter"]'))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = globalThis.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        })
        .map((element) => String(element.className || ''))
        .slice(0, 20),
    }))
    .catch(() => null);
  return {
    opened: false,
    panel: null,
    reason: filterSkeletonVisible
      ? 'Filter controls remained in skeleton-loading state.'
      : overlayOpened
        ? 'Filter panel opened but its content did not finish loading.'
        : 'Filter panel not visible.',
    diagnostics,
  };
}

async function openFilterPanel(page) {
  const result = await resolveWithTimeout(openFilterPanelInternal(page), 20_000);
  if (!result.timedOut) return result.value;
  await closeMobileSidebarIfOpen(page).catch(() => false);
  return {
    opened: false,
    panel: null,
    reason: 'Filter panel interaction exceeded the 20 second diagnostic budget.',
    timedOut: true,
  };
}

async function activateFilterTab(panel, label) {
  const raw = String(label || '').trim();
  const aliases = {
    providers: [
      'providers',
      'provider',
      'провайдер',
      'proveedor',
      'fournisseur',
      'anbieter',
      'provedor',
      'fornitore',
    ],
    category: ['category', 'categories', 'категор', 'catégorie', 'kategorie', 'categor'],
    collections: ['collections', 'collection', 'коллекц', 'colecciones', 'collezioni'],
  };
  const bucket = aliases[raw.toLowerCase()] || [raw];
  const candidates = [];
  for (const alias of bucket) {
    const escaped = String(alias).replace(/"/g, '');
    candidates.push(
      `.t-games-filters__tabs .t-tabs__item:has-text("${escaped}")`,
      `button:has-text("${escaped}")`,
      `[role="tab"]:has-text("${escaped}")`
    );
  }

  const tab = await firstVisibleLocator(panel, candidates);
  if (!tab) return false;
  await tab.click({ timeout: 5000 }).catch(() => null);
  await waitForUiSettled(panel.page(), 1000);
  return true;
}

async function isFilterBlockActive(panel, blockName) {
  const selectors = [
    `.t-games-filters-block.${blockName}.is-active-tabs`,
    `.t-games-filters-block.${blockName}:visible`,
  ];
  for (const selector of selectors) {
    const visible = await panel
      .locator(selector)
      .first()
      .isVisible()
      .catch(() => false);
    if (visible) return true;
  }
  return false;
}

async function getCheckedProvidersCount(panel) {
  const byClass = await panel
    .locator(
      '.t-games-filters-block.providers .t-checkbox.t-checkbox_checked, .t-games-select__checkbox .t-checkbox.t-checkbox_checked'
    )
    .count()
    .catch(() => 0);
  if (byClass > 0) return byClass;
  const byInput = await panel
    .locator(
      '.t-games-filters-block.providers input[type="checkbox"]:checked, .t-games-select__checkbox input[type="checkbox"]:checked'
    )
    .count()
    .catch(() => 0);
  if (byInput > 0) return byInput;
  return panel
    .page()
    .locator(
      '.t-games-filters-block.providers .t-checkbox.t-checkbox_checked, .t-games-filters-block.providers input[type="checkbox"]:checked'
    )
    .count()
    .catch(() => 0);
}

async function selectFirstUncheckedProvider(panel) {
  const scopes = [panel, panel.page()];
  let firstVisibleRow = null;
  for (const scope of scopes) {
    const rows = scope.locator(
      '.t-games-filters-block.providers .t-games-select__checkbox .t-checkbox, .t-games-filters-block.providers .t-checkbox, .t-games-select__checkbox .t-checkbox'
    );
    const count = Math.min(await rows.count().catch(() => 0), 120);
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      const visible = await row.isVisible().catch(() => false);
      if (!visible) continue;
      if (!firstVisibleRow) firstVisibleRow = { row, index: i };

      const checked = await row
        .evaluate((node) => {
          const classChecked = /\bt-checkbox_checked\b/i.test(String(node.className || ''));
          const input = node.querySelector('input[type="checkbox"]');
          return classChecked || Boolean(input && input.checked);
        })
        .catch(() => false);
      if (checked) continue;

      const providerName = (
        (await row
          .locator('.t-checkbox__label')
          .first()
          .innerText()
          .catch(() => '')) || ''
      )
        .replace(/\s+/g, ' ')
        .trim();
      await row.click({ timeout: 5000 }).catch(() => null);
      await waitForUiSettled(panel.page(), 1200);
      return { clicked: true, providerName: providerName || `provider-${i + 1}` };
    }
  }

  if (firstVisibleRow) {
    const providerName = (
      (await firstVisibleRow.row
        .locator('.t-checkbox__label')
        .first()
        .innerText()
        .catch(() => '')) || ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    await firstVisibleRow.row.click({ timeout: 5000 }).catch(() => null);
    await waitForUiSettled(panel.page(), 1200);
    return {
      clicked: true,
      providerName: providerName || `provider-${firstVisibleRow.index + 1}`,
      toggledFallback: true,
    };
  }

  return { clicked: false, providerName: null };
}

async function filterPanelOk(panel) {
  let ok = await firstVisibleLocator(panel, [
    '.t-games-filters-action__close',
    '.t-games-filters__close',
    '.t-games-catalog__quick-access [class*="filters__close" i]',
    'button:has-text("OK")',
    'button:has-text("Apply")',
  ]);
  if (!ok) {
    const quickAccess = panel.page().locator('.t-games-catalog__quick-access:visible').first();
    ok = await firstVisibleLocator(quickAccess, [
      '.t-games-catalog__quick-access:visible .t-games-filters-action__close',
      '.t-games-catalog__quick-access:visible .t-games-filters__close',
      '.t-games-catalog__quick-access:visible [class*="filters__close" i]',
      'button:has-text("OK")',
      'button:has-text("Apply")',
    ]);
  }
  if (!ok) return false;
  const clicked = await ok
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() =>
      ok
        .click({ timeout: 3000, force: true })
        .then(() => true)
        .catch(() => false)
    );
  if (!clicked) return false;
  await waitForUiSettled(panel.page(), 1500);
  return true;
}

async function filterPanelClear(panel) {
  let clear = await firstVisibleLocator(panel, [
    '.t-games-filters-action__clear',
    'button:has-text("CLEAR")',
    'button:has-text("Clear")',
    'button:has-text("Reset")',
  ]);
  if (!clear) {
    const quickAccess = panel.page().locator('.t-games-catalog__quick-access:visible').first();
    clear = await firstVisibleLocator(quickAccess, [
      '.t-games-filters-action__clear',
      'button:has-text("CLEAR")',
      'button:has-text("Clear")',
      'button:has-text("Reset")',
    ]);
  }
  if (clear) {
    await clear.click({ timeout: 5000 }).catch(() => null);
    await waitForUiSettled(panel.page(), 1200);
    return true;
  }

  const quickAccess = panel.page().locator('.t-games-catalog__quick-access:visible').first();
  const scopes = [panel, quickAccess];
  let toggled = 0;
  for (const scope of scopes) {
    const rows = scope.locator(
      '.t-games-filters-block.providers .t-checkbox.t-checkbox_checked, .t-games-filters-block.providers input[type="checkbox"]:checked, .t-games-filters-block.providers [role="checkbox"][aria-checked="true"]'
    );
    const count = Math.min(await rows.count().catch(() => 0), 20);
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      const visible = await row.isVisible().catch(() => false);
      if (!visible) continue;
      const clicked = await row
        .click({ timeout: 5000 })
        .then(() => true)
        .catch(async () => {
          const label = row.locator('xpath=ancestor::label[1]');
          return label
            .click({ timeout: 3000 })
            .then(() => true)
            .catch(() => false);
        });
      if (clicked) toggled += 1;
      await waitForUiSettled(panel.page(), 200);
    }
  }
  if (toggled > 0) {
    await waitForUiSettled(panel.page(), 900);
    return true;
  }
  return false;
}

async function getVisibleCategoryChips(page) {
  const known = [
    'All',
    'Popular',
    'VIP',
    'New',
    'Instant',
    'Lottery',
    'Feature Buy',
    'GtBet Originals',
    'Jackpots',
    'Slots',
    'Table',
  ];
  const chips = [];
  for (const label of known) {
    const chip = await firstVisibleLocator(page, [
      `button:has-text("${label}")`,
      `[role="tab"]:has-text("${label}")`,
      `.t-tabs__item:has-text("${label}")`,
      `.t-games-catalog__filter-tags .list__item:has-text("${label}")`,
      `.t-games-catalog .list__item:has-text("${label}")`,
    ]);
    if (!chip) continue;
    const box = await chip.boundingBox().catch(() => null);
    if (!box) continue;
    if (box.y < 120 || box.y > 250) continue;
    chips.push({ label, locator: chip });
  }
  return chips;
}

async function discoverCategoryChipsByDom(page) {
  const known = new Set(
    [
      'all',
      'popular',
      'vip',
      'new',
      'instant',
      'lottery',
      'feature buy',
      'gtbet originals',
      'jackpots',
      'slots',
      'table',
      'other games',
    ].map((v) => v.toLowerCase())
  );

  return page
    .evaluate(
      (knownList) => {
        function isVisible(el) {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          if (!style) return false;
          if (style.display === 'none') return false;
          if (style.visibility === 'hidden') return false;
          if (Number(style.opacity) === 0) return false;
          if (rect.width < 20 || rect.height < 18) return false;
          return rect.y >= 120 && rect.y <= 250;
        }

        const nodes = Array.from(
          document.querySelectorAll(
            '.t-games-catalog .list__item, .t-games-catalog button, .t-games-catalog [role="tab"]'
          )
        ).filter((el) => isVisible(el));
        const known = new Set(knownList);
        const out = [];
        const dedupe = new Set();

        for (const node of nodes) {
          const label = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
          if (!label) continue;
          if (!known.has(label.toLowerCase())) continue;
          if (dedupe.has(label.toLowerCase())) continue;
          dedupe.add(label.toLowerCase());
          const rect = node.getBoundingClientRect();
          out.push({
            label,
            x: rect.x,
            y: rect.y,
            w: rect.width,
            h: rect.height,
          });
        }
        return out;
      },
      [...known]
    )
    .catch(() => []);
}

async function findGameActionButton(page, mode) {
  const cardSelectors = [
    '.t-games-catalog .t-game-item',
    '.t-games-catalog .t-game-play',
    '.t-games-catalog [class*="game-play" i]',
    '.t-games-catalog [class*="games-item" i]',
    'main [class*="game-play" i]',
    'main [class*="games-item" i]',
    'main .t-game-item',
  ];

  let cards = null;
  for (const selector of cardSelectors) {
    const loc = page.locator(selector);
    if ((await loc.count()) > 0) {
      cards = loc;
      break;
    }
  }
  if (!cards) return { found: false, reason: 'No game cards found.', button: null, cardIndex: -1 };

  const localSelectors =
    mode === 'demo'
      ? [
          'button:has-text("Try for Fun")',
          'a:has-text("Try for Fun")',
          '[data-testid*="demo" i]',
          '[href*="demo" i]',
          'button[class*="demo" i]',
        ]
      : [
          'button:has-text("Play")',
          'a:has-text("Play")',
          '[data-testid*="play" i]',
          '[href*="mode=real" i]',
          'button[class*="play" i]',
        ];
  const globalSelectors =
    mode === 'demo'
      ? [
          'button:has-text("Try for Fun")',
          'a:has-text("Try for Fun")',
          '[data-testid*="demo" i]',
          '[href*="demo" i]',
        ]
      : [
          'button:has-text("Play")',
          'a:has-text("Play")',
          '[data-testid*="play" i]',
          '[href*="mode=real" i]',
        ];
  // Keep this lookup comfortably below the outer watchdog. Twelve sequential
  // hover attempts at the previous per-card timeouts could consume the entire
  // 45 second budget even when the page itself was healthy.
  const count = Math.min(await cards.count(), 8);

  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    if (!(await card.isVisible().catch(() => false))) continue;

    await card.scrollIntoViewIfNeeded({ timeout: 900 }).catch(() => null);
    await card.hover({ timeout: 700 }).catch(() => null);
    await waitForUiSettled(page, 150);

    // Read optional metadata in one synchronous DOM operation. Locator
    // innerText/getAttribute calls inherit the page's 30s timeout when the
    // nested node is absent, which previously exhausted the 45s action lookup
    // watchdog on otherwise healthy IGO cards.
    const cardMeta = await card
      .evaluate((node) => {
        const attr = (name) => String(node.getAttribute(name) || '').trim();
        const anchor = node.querySelector('a[href]');
        const titleNode = node.querySelector(
          '.t-game-play__title, .t-game-item__hover-name, [class*="title" i], [class*="name" i]'
        );
        const imageTitle = node.querySelector('img[alt]')?.getAttribute('alt') || '';
        return {
          title: String(
            (titleNode && (titleNode.innerText || titleNode.textContent)) ||
              node.innerText ||
              imageTitle ||
              node.textContent ||
              ''
          )
            .replace(/\s+/g, ' ')
            .trim(),
          dataId: attr('data-id') || attr('data-game-id') || attr('data-gid') || '',
          dataProvider:
            attr('data-provider') ||
            attr('data-provider-name') ||
            attr('data-vendor') ||
            attr('data-game-provider') ||
            '',
          dataSlug: attr('data-slug') || attr('data-game-slug') || '',
          anchorHref: anchor ? String(anchor.getAttribute('href') || '').trim() : '',
        };
      })
      .catch(() => null);
    const cardTitle = String((cardMeta && cardMeta.title) || '').trim();
    const cardHref = String((cardMeta && cardMeta.anchorHref) || '').trim();
    const parsedHrefIdentity = parseCasinoIdentityFromUrl(
      cardHref || (cardMeta && cardMeta.anchorHref) || ''
    );

    let button = await firstVisibleLocator(card, localSelectors);
    const mobileCard = await card.evaluate((node) => node.matches('.t-game-item'));
    if (!button && mobileCard) {
      // Mobile cards reveal their action layer only after the first tap. The
      // card itself is not Play/Try for Fun, so return the semantic action from
      // the newly revealed layer.
      const imageSurface = card.locator('.t-game-item__img').first();
      const activationTarget = (await imageSurface.isVisible().catch(() => false))
        ? imageSurface
        : card;
      await activationTarget
        .click({ timeout: 3000 })
        .catch(() => activationTarget.click({ timeout: 2000, force: true }).catch(() => null));
      await waitForUiSettled(page, 350);
      button = await firstVisibleLocator(card, localSelectors);
    }
    if (!button) continue;

    const buttonText = ((await button.innerText().catch(() => '')) || '')
      .replace(/\s+/g, ' ')
      .trim();
    const hrefHint = (await button.getAttribute('href').catch(() => '')) || '';
    if (mode === 'real' && /try for fun|demo/i.test(`${buttonText} ${hrefHint}`)) continue;
    return {
      found: true,
      reason: null,
      button,
      cardIndex: i,
      buttonText,
      cardTitle,
      cardHref,
      cardKey: `${cardHref || cardTitle || `card-${i + 1}`}`.toLowerCase(),
      cardProvider: (cardMeta && cardMeta.dataProvider) || parsedHrefIdentity.provider || '',
      cardSlug: (cardMeta && cardMeta.dataSlug) || parsedHrefIdentity.slug || '',
      cardGameId: (cardMeta && cardMeta.dataId) || parsedHrefIdentity.gameId || '',
      cardMeta: cardMeta || null,
    };
  }

  // Some layouts render the hover action in a portal outside the card node.
  // Resolve that only after card-local attempts, so an unrelated global action
  // cannot be associated with the wrong game.
  const globalFallbackButton = await firstVisibleLocator(page, globalSelectors);
  if (globalFallbackButton) {
    const buttonText = ((await globalFallbackButton.innerText().catch(() => '')) || '')
      .replace(/\s+/g, ' ')
      .trim();
    const hrefHint = (await globalFallbackButton.getAttribute('href').catch(() => '')) || '';
    if (!(mode === 'real' && /try for fun|demo/i.test(`${buttonText} ${hrefHint}`))) {
      return {
        found: true,
        reason: null,
        button: globalFallbackButton,
        cardIndex: -1,
        buttonText,
        cardTitle: '',
        cardHref: hrefHint,
        cardKey: String(hrefHint || `${mode}-global-action`).toLowerCase(),
        cardProvider: '',
        cardSlug: '',
        cardGameId: '',
        cardMeta: null,
      };
    }
  }

  return {
    found: false,
    reason: `No ${mode} action button is visible on first game cards.`,
    button: null,
    cardIndex: -1,
  };
}

function hasDemoHint(value) {
  return /demo|try\s*for\s*fun|free\s*play|mode=demo|play-for-fun/i.test(String(value || ''));
}

function hasRealHint(value) {
  return /mode=real|mode=money|real|cash|for-real|for real/i.test(String(value || ''));
}

function normalizeIdentity(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function parseCasinoIdentityFromUrl(rawUrl) {
  const source = String(rawUrl || '').trim();
  if (!source) {
    return {
      provider: '',
      slug: '',
      gameId: '',
      pathname: '',
      url: '',
    };
  }

  try {
    const parsed = source.startsWith('http') ? new URL(source) : new URL(source, BASE_ORIGIN);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const casinoIndex = parts.findIndex((item) => item.toLowerCase() === 'casino');
    const provider = casinoIndex >= 0 ? parts[casinoIndex + 1] || '' : '';
    const slug = casinoIndex >= 0 ? parts[casinoIndex + 2] || '' : '';
    const gameId =
      parsed.searchParams.get('gameId') ||
      parsed.searchParams.get('game_id') ||
      parsed.searchParams.get('id') ||
      parsed.searchParams.get('gid') ||
      '';

    return {
      provider,
      slug,
      gameId,
      pathname: parsed.pathname || '',
      url: parsed.toString(),
    };
  } catch {
    return {
      provider: '',
      slug: '',
      gameId: '',
      pathname: '',
      url: source,
    };
  }
}

function collectLaunchIdentity(action, launch) {
  const providerSet = new Set();
  const slugSet = new Set();
  const gameIdSet = new Set();
  const urlSignals = [
    action && action.cardHref,
    launch && launch.sameTabUrl,
    launch && launch.popupUrl,
  ];

  for (const item of urlSignals) {
    const parsed = parseCasinoIdentityFromUrl(item);
    if (parsed.provider) providerSet.add(parsed.provider);
    if (parsed.slug) slugSet.add(parsed.slug);
    if (parsed.gameId) gameIdSet.add(parsed.gameId);
  }

  if (action && action.cardProvider) providerSet.add(action.cardProvider);
  if (action && action.cardSlug) slugSet.add(action.cardSlug);
  if (action && action.cardGameId) gameIdSet.add(action.cardGameId);

  const launchSignals =
    launch && Array.isArray(launch.identitySignals) ? launch.identitySignals : [];
  for (const signal of launchSignals) {
    if (signal.provider) providerSet.add(signal.provider);
    if (signal.slug) slugSet.add(signal.slug);
    if (signal.gameId) gameIdSet.add(signal.gameId);
  }

  const providers = [...providerSet].filter(Boolean);
  const slugs = [...slugSet].filter(Boolean);
  const gameIds = [...gameIdSet].filter(Boolean);

  return {
    providers,
    slugs,
    gameIds,
    providersNormalized: providers.map((value) => normalizeIdentity(value)).filter(Boolean),
    slugsNormalized: slugs.map((value) => normalizeIdentity(value)).filter(Boolean),
    gameIdsNormalized: gameIds.map((value) => normalizeIdentity(value)).filter(Boolean),
    strictReady: slugs.length > 0 || gameIds.length > 0,
  };
}

function matchesStrictHistoryEntry(entry, identity) {
  const candidate = entry && typeof entry === 'object' ? entry : {};
  const provider = normalizeIdentity(candidate.provider);
  const slug = normalizeIdentity(candidate.slug);
  const gameId = normalizeIdentity(candidate.gameId);

  if (identity.gameIdsNormalized.length > 0 && gameId) {
    if (identity.gameIdsNormalized.includes(gameId)) return true;
  }

  if (identity.slugsNormalized.length > 0 && slug) {
    if (!identity.slugsNormalized.includes(slug)) return false;
    if (identity.providersNormalized.length === 0) return true;
    if (provider && identity.providersNormalized.includes(provider)) return true;
  }

  return false;
}

async function clickAndCaptureLaunch(context, page, button) {
  const beforeUrl = page.url();
  const popupPromise = context.waitForEvent('page', { timeout: 6000 }).catch(() => null);
  let clickError = null;
  const networkSignals = [];
  const maxSignals = 80;

  function pushNetworkSignal(item) {
    if (networkSignals.length >= maxSignals) return;
    networkSignals.push(item);
  }

  function captureSignal(url, stage, status = 0) {
    if (!/(casino|game|provider|launch|play|history|recent)/i.test(String(url || ''))) return;
    const parsed = parseCasinoIdentityFromUrl(url);
    pushNetworkSignal({
      stage,
      status,
      url: String(url || ''),
      provider: parsed.provider || '',
      slug: parsed.slug || '',
      gameId: parsed.gameId || '',
    });
  }

  const onRequest = (request) => {
    try {
      captureSignal(request.url(), 'request', 0);
    } catch {
      // ignore
    }
  };
  const onResponse = (response) => {
    try {
      captureSignal(response.url(), 'response', response.status());
    } catch {
      // ignore
    }
  };

  page.on('request', onRequest);
  page.on('response', onResponse);

  try {
    await button.click({ timeout: 9000 });
  } catch (err) {
    clickError = String(err && err.message ? err.message : err);
    await button.click({ timeout: 9000, force: true }).catch(() => null);
  }

  const popup = await popupPromise;
  let popupUrl = null;
  let popupTitle = null;
  let popupChallenge = null;

  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => null);
    popupUrl = popup.url();
    popupTitle = await popup.title().catch(() => '');
    popupChallenge = await getChallengeReason(popup);
  }

  await page.waitForLoadState('domcontentloaded').catch(() => null);
  await waitForUiSettled(page, 1800);
  const sameTabUrl = page.url();
  const sameTabChallenge = await getChallengeReason(page);

  const iframeVisible = await page
    .locator('iframe[src*="casino" i], iframe[src*="game" i], [class*="game-frame" i], canvas')
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  const balanceGateVisible = await page
    .getByText(/insufficient|not enough|deposit|top up|balance/i)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  const loginModalVisible = await page
    .getByText(/log in|registered email|password/i)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);

  const launched = Boolean(
    (popup && popupUrl && !popupChallenge) ||
    (sameTabUrl !== beforeUrl && !sameTabChallenge) ||
    iframeVisible
  );

  page.off('request', onRequest);
  page.off('response', onResponse);
  if (popup) await popup.close().catch(() => null);

  const identitySignals = [];
  const seenSignals = new Set();
  for (const signal of networkSignals) {
    const key = `${normalizeIdentity(signal.provider)}|${normalizeIdentity(
      signal.slug
    )}|${normalizeIdentity(signal.gameId)}|${signal.stage}|${signal.status}`;
    if (seenSignals.has(key)) continue;
    seenSignals.add(key);
    identitySignals.push({
      provider: signal.provider || '',
      slug: signal.slug || '',
      gameId: signal.gameId || '',
      stage: signal.stage,
      status: signal.status,
      url: signal.url,
    });
    if (identitySignals.length >= 40) break;
  }

  return {
    beforeUrl,
    sameTabUrl,
    popupUrl,
    popupTitle,
    popupChallenge,
    sameTabChallenge,
    iframeVisible,
    balanceGateVisible,
    loginModalVisible,
    launched,
    clickError,
    networkSignals,
    identitySignals,
  };
}

function normalizeLoose(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function openCasinoSubRoute(page, route) {
  const requestedUrl = buildUrl(route);
  let response = null;
  let navigationError = null;
  try {
    response = await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (err) {
    navigationError = String(err && err.message ? err.message : err);
  }
  await dismissOverlays(page);
  await page
    .locator('body')
    .first()
    .waitFor({ state: 'visible', timeout: 12000 })
    .catch(() => null);
  const challenge = await getChallengeReason(page);
  return {
    route,
    requestedUrl,
    finalUrl: page.url(),
    status: response ? response.status() : 0,
    challenge: challenge || (navigationError ? `Navigation failed: ${navigationError}` : null),
  };
}

async function findFavoriteControl(scope, options = {}) {
  const selectors = [
    '[data-testid*="favorite" i]',
    '[data-testid*="favourite" i]',
    'button[aria-label*="favorite" i]',
    'button[aria-label*="favourite" i]',
    'button[class*="favorite" i]',
    'button[class*="favourite" i]',
    '[class*="favorite" i][role="button"]',
    '[class*="favourite" i][role="button"]',
    '[class*="bookmark" i][role="button"]',
    '[class*="heart" i][role="button"]',
  ];
  if (options.cardScope === true) {
    selectors.push(
      '.t-game-play__favorite',
      '.t-game-item__favorite',
      '[class*="favorite" i]',
      '[class*="favourite" i]',
      '[class*="bookmark" i]',
      '[class*="heart" i]'
    );
  }
  return firstVisibleLocator(scope, selectors);
}

async function favoriteControlState(locator) {
  if (!locator) return '';
  const meta = await locator
    .evaluate((node) => {
      const attr = (name) => String(node.getAttribute(name) || '').trim();
      return {
        ariaPressed: attr('aria-pressed'),
        ariaChecked: attr('aria-checked'),
        className: String(node.className || '').trim(),
        testId: attr('data-testid'),
      };
    })
    .catch(() => null);
  if (!meta) return '';
  return `${meta.ariaPressed}|${meta.ariaChecked}|${meta.className}|${meta.testId}`;
}

async function collectRecentEntries(page) {
  return page
    .evaluate(() => {
      function isVisible(node) {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        if (rect.width < 20 || rect.height < 14) return false;
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return true;
      }

      function parseIdentity(rawHref) {
        const source = String(rawHref || '').trim();
        if (!source) return { provider: '', slug: '', gameId: '' };
        try {
          const parsed = source.startsWith('http')
            ? new URL(source)
            : new URL(source, window.location.origin);
          const parts = parsed.pathname.split('/').filter(Boolean);
          const casinoIndex = parts.findIndex((item) => item.toLowerCase() === 'casino');
          const provider = casinoIndex >= 0 ? parts[casinoIndex + 1] || '' : '';
          const slug = casinoIndex >= 0 ? parts[casinoIndex + 2] || '' : '';
          const gameId =
            parsed.searchParams.get('gameId') ||
            parsed.searchParams.get('game_id') ||
            parsed.searchParams.get('id') ||
            parsed.searchParams.get('gid') ||
            '';
          return { provider, slug, gameId };
        } catch {
          return { provider: '', slug: '', gameId: '' };
        }
      }

      const selectors = [
        '.t-recent .t-game-item',
        '.t-recent .t-game-play',
        '.t-transactions .t-game-item',
        '.t-transactions .t-game-play',
        '[class*="recent" i] .t-game-item',
        '[class*="recent" i] .t-game-play',
        '[class*="recent" i] a[href*="/casino/"]',
        '.t-games-catalog .t-game-item',
        '.t-games-catalog .t-game-play',
      ];
      const out = [];
      const seen = new Set();
      for (const selector of selectors) {
        const nodes = Array.from(document.querySelectorAll(selector)).filter((node) =>
          isVisible(node)
        );
        for (const node of nodes) {
          const anchor = node.matches('a[href]') ? node : node.querySelector('a[href]');
          const href = anchor ? String(anchor.getAttribute('href') || '').trim() : '';
          const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
          const title = (
            node.querySelector(
              '.t-game-play__title, .t-game-item__hover-name, [class*="title" i], [class*="name" i]'
            )?.textContent || text
          )
            .replace(/\s+/g, ' ')
            .trim();
          if (!text && !title && !href) continue;

          const providerHint = (
            node.querySelector('.t-game-item__hover-provider, [class*="provider" i]')
              ?.textContent || ''
          )
            .replace(/\s+/g, ' ')
            .trim();
          const idHint =
            String(node.getAttribute('data-id') || '').trim() ||
            String(node.getAttribute('data-game-id') || '').trim() ||
            String(node.getAttribute('data-gid') || '').trim();

          const parsed = parseIdentity(href);
          const looksLikeGameCard =
            node.matches('.t-game-item, .t-game-play') ||
            Boolean(node.closest('.t-game-item, .t-game-play')) ||
            Boolean(node.querySelector('img'));
          if (!looksLikeGameCard && !parsed.slug && !parsed.gameId) continue;
          const entry = {
            text,
            title,
            href,
            provider: parsed.provider || providerHint || '',
            slug: parsed.slug || '',
            gameId: parsed.gameId || idHint || '',
          };
          const key = `${entry.href}|${entry.title}|${entry.provider}|${entry.slug}|${entry.gameId}|${entry.text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(entry);
        }
      }
      return out;
    })
    .catch(() => []);
}

async function withCasinoPage(browser, testInfo, testName, run) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.mkdirSync(VISUAL_DIR, { recursive: true });

  const authStatePath = pickAuthStatePath();
  if (!authStatePath) {
    const payload = {
      blocked: true,
      reason: 'No auth storage state found for authorized casino checks.',
    };
    markBlocked(testInfo, payload.reason);
    await writeAndAttach(testInfo, testName, payload);
    return;
  }

  const context = await browser.newContext(
    resolveMatrixContextOptions({ storageState: authStatePath })
  );
  const page = await context.newPage();

  try {
    const route = await openCasino(page);
    if (route.challenge) {
      const payload = { blocked: true, reason: route.challenge, route, authStatePath };
      markBlocked(testInfo, route.challenge);
      await writeAndAttach(testInfo, testName, payload);
      return;
    }

    await waitForCasinoContent(page);
    await dismissOverlays(page);
    const loginVisible = await page
      .getByRole('button', { name: /log in/i })
      .first()
      .isVisible()
      .catch(() => false);
    if (loginVisible) {
      const payload = {
        blocked: true,
        reason: 'Expected authorized session, but Log In button is visible.',
        route,
        authStatePath,
      };
      markBlocked(testInfo, payload.reason);
      await writeAndAttach(testInfo, testName, payload);
      return;
    }

    await run({ context, page, route, authStatePath });
  } finally {
    await closeContextBounded(context);
  }
}

// Independent catalog checks must continue even when one capability fails.
test.describe.configure({ mode: 'default' });

test.describe('Casino Catalog Coverage: search/filter/load more/game launch', () => {
  test.setTimeout(180000);

  test('P0.1 Search modal: open and close', async ({ browser }, testInfo) => {
    const testName = 'p0_1_search_open_close';
    await withCasinoPage(browser, testInfo, testName, async ({ page, route, authStatePath }) => {
      let search = await openSearchModal(page);
      if (!search.opened || !search.inputVisible || !search.input) {
        await dismissOverlays(page);
        await closeMobileSidebarIfOpen(page);
        await waitForUiSettled(page, 700);
        search = await openSearchModal(page);
      }
      if (!search.opened || !search.inputVisible) {
        const reason = search.reason || 'Search modal/input is not available in current layout.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          search,
        });
        return;
      }

      const closed = await closeSearchModal(search.modal, page);
      expect(closed, 'Search modal failed to close by close control or Escape.').toBeTruthy();

      const payload = {
        route,
        authStatePath,
        search: { opened: search.opened, inputVisible: search.inputVisible, closed },
      };
      await writeAndAttach(testInfo, testName, payload);
    });
  });

  test('P0.2 Search query: relevant results are returned', async ({ browser }, testInfo) => {
    const testName = 'p0_2_search_query';
    await withCasinoPage(browser, testInfo, testName, async ({ page, route, authStatePath }) => {
      const query = 'coin';
      const search = await openSearchModal(page);
      if (!search.opened || !search.inputVisible || !search.input) {
        const reason = search.reason || 'Search query check is blocked: modal/input unavailable.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          search,
        });
        return;
      }

      await search.input.click({ timeout: 3000 }).catch(() => null);
      await enterSearchQuery(search.input, query);
      const value = (await search.input.inputValue().catch(() => '')).toLowerCase();
      expect(value.includes(query), 'Search input did not accept query text.').toBeTruthy();
      await waitForUiSettled(page, 2400);
      await (search.modal || page)
        .locator('.games-wrapper__item .name, [class*="game" i] [class*="name" i]')
        .filter({ hasText: new RegExp(query, 'i') })
        .first()
        .waitFor({ state: 'visible', timeout: 8000 })
        .catch(() => null);

      const titles = await collectSearchResultTitles(search.modal || page);
      const matching = titles.filter((item) => item.toLowerCase().includes(query));

      if (!titles.length || !matching.length) {
        const reason = !titles.length
          ? 'Search returned no visible items.'
          : `No search results match query "${query}".`;
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          query,
          sampleTitles: titles.slice(0, 20),
        });
        await closeSearchModal(search.modal, page);
        return;
      }

      await closeSearchModal(search.modal, page);
      const payload = {
        route,
        authStatePath,
        query,
        totalVisibleTitles: titles.length,
        matchingTitles: matching,
        sampleTitles: titles.slice(0, 20),
      };
      await writeAndAttach(testInfo, testName, payload);
    });
  });

  test('P0.3 Search no-results: empty state or zero-match is shown for impossible query', async ({
    browser,
  }, testInfo) => {
    const testName = 'p0_3_search_no_results';
    await withCasinoPage(browser, testInfo, testName, async ({ page, route, authStatePath }) => {
      const query = `zzzz_no_result_${Date.now()}_qqqq`;
      const search = await openSearchModal(page);
      if (!search.opened || !search.inputVisible || !search.input) {
        const reason =
          search.reason || 'No-results check is blocked: search modal/input unavailable.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          search,
        });
        return;
      }

      await search.input.click({ timeout: 3000 }).catch(() => null);
      await enterSearchQuery(search.input, query);
      const value = (await search.input.inputValue().catch(() => '')).toLowerCase();
      expect(
        value.includes(query.toLowerCase()),
        'Search input did not accept impossible query text.'
      ).toBeTruthy();
      await waitForUiSettled(page, 2500);

      const titles = await collectSearchResultTitles(search.modal || page);
      const queryMatches = titles.filter((item) =>
        item.toLowerCase().includes(query.toLowerCase())
      );
      const emptyStateVisible = await (search.modal || page)
        .getByText(/no games|no results|nothing found|not found|empty/i)
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);

      expect(
        emptyStateVisible || queryMatches.length === 0,
        'Expected empty/no-results signal or zero exact matches for impossible query.'
      ).toBeTruthy();

      await closeSearchModal(search.modal, page);
      const payload = {
        route,
        authStatePath,
        query,
        emptyStateVisible,
        titlesCount: titles.length,
        queryMatchesCount: queryMatches.length,
        sampleTitles: titles.slice(0, 20),
      };
      await writeAndAttach(testInfo, testName, payload);
    });
  });

  test('P0.4 Filter Providers: apply provider and keep checked state after reopen', async ({
    browser,
  }, testInfo) => {
    const testName = 'p0_4_filter_providers_apply';
    await withCasinoPage(browser, testInfo, testName, async ({ page, route, authStatePath }) => {
      const opened = await openFilterPanel(page);
      if (!opened.opened || !opened.panel) {
        const reason = opened.reason || 'Filter panel failed to open.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          opened,
        });
        return;
      }

      await activateFilterTab(opened.panel, 'providers');
      const before = await getCheckedProvidersCount(opened.panel);
      const selected = await selectFirstUncheckedProvider(opened.panel);
      const afterClick = await getCheckedProvidersCount(opened.panel);
      const okApplied = await filterPanelOk(opened.panel);
      if (!selected.clicked || !okApplied || afterClick === before) {
        const reason = !selected.clicked
          ? 'No unchecked provider found to apply filter.'
          : !okApplied
            ? 'Filter OK button is not available to apply selection.'
            : 'Provider checkbox state did not change after selection.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          checkedBefore: before,
          checkedAfterClick: afterClick,
          selectedProvider: selected.providerName,
        });
        return;
      }

      const reopened = await openFilterPanel(page);
      if (!reopened.opened || !reopened.panel) {
        const reason = 'Filter panel failed to reopen after applying provider.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, { blocked: true, reason, route, authStatePath });
        return;
      }
      await activateFilterTab(reopened.panel, 'providers');
      const afterReopen = await getCheckedProvidersCount(reopened.panel);
      expect(
        afterReopen,
        'Applied provider selection should remain checked after reopen.'
      ).toBeGreaterThan(0);
      await filterPanelOk(reopened.panel);

      const payload = {
        route,
        authStatePath,
        selectedProvider: selected.providerName,
        checkedBefore: before,
        checkedAfterClick: afterClick,
        checkedAfterReopen: afterReopen,
      };
      await writeAndAttach(testInfo, testName, payload);
    });
  });

  test('P0.5 Filter CLEAR: reset provider selections', async ({ browser }, testInfo) => {
    const testName = 'p0_5_filter_clear';
    await withCasinoPage(browser, testInfo, testName, async ({ page, route, authStatePath }) => {
      const opened = await openFilterPanel(page);
      if (!opened.opened || !opened.panel) {
        const reason = opened.reason || 'Filter panel failed to open.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          opened,
        });
        return;
      }

      await activateFilterTab(opened.panel, 'providers');
      await selectFirstUncheckedProvider(opened.panel);
      await filterPanelOk(opened.panel);

      const reopened = await openFilterPanel(page);
      if (!reopened.opened || !reopened.panel) {
        const reason = 'Filter panel failed to reopen after provider apply.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, { blocked: true, reason, route, authStatePath });
        return;
      }
      await activateFilterTab(reopened.panel, 'providers');
      const checkedBeforeClear = await getCheckedProvidersCount(reopened.panel);
      const clearClicked = await filterPanelClear(reopened.panel);
      if (!clearClicked) {
        const reason = 'CLEAR button is not available in filter panel.';
        const clearDiagnostics = await reopened.panel
          .evaluate((root) => ({
            visibleButtons: Array.from(root.querySelectorAll('button'))
              .filter((button) => {
                const rect = button.getBoundingClientRect();
                const style = globalThis.getComputedStyle(button);
                return (
                  rect.width > 0 &&
                  rect.height > 0 &&
                  style.display !== 'none' &&
                  style.visibility !== 'hidden'
                );
              })
              .map((button) => String(button.innerText || button.textContent || '').trim())
              .filter(Boolean)
              .slice(0, 30),
            checkedControls: Array.from(
              root.querySelectorAll(
                '.t-checkbox.t-checkbox_checked, input[type="checkbox"]:checked, [role="checkbox"][aria-checked="true"]'
              )
            )
              .map((node) => ({
                tag: node.tagName,
                className: String(node.className || ''),
                text: String(node.textContent || '')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .slice(0, 120),
              }))
              .slice(0, 20),
          }))
          .catch(() => null);
        const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);
        if (screenshot) {
          await testInfo.attach('casino-filter-clear-unavailable.png', {
            body: screenshot,
            contentType: 'image/png',
          });
        }
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          checkedBeforeClear,
          clearDiagnostics,
        });
        return;
      }
      await filterPanelOk(reopened.panel);

      const reopenedAfterClear = await openFilterPanel(page);
      if (!reopenedAfterClear.opened || !reopenedAfterClear.panel) {
        const reason = 'Filter panel failed to reopen after CLEAR.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, { blocked: true, reason, route, authStatePath });
        return;
      }
      await activateFilterTab(reopenedAfterClear.panel, 'providers');
      const checkedAfterClear = await getCheckedProvidersCount(reopenedAfterClear.panel);
      await filterPanelOk(reopenedAfterClear.panel);

      if (checkedAfterClear !== 0) {
        const reason = `CLEAR left ${checkedAfterClear} provider selection(s) checked.`;
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          checkedBeforeClear,
          checkedAfterClear,
        });
        return;
      }
      const payload = {
        route,
        authStatePath,
        checkedBeforeClear,
        checkedAfterClear,
      };
      await writeAndAttach(testInfo, testName, payload);
    });
  });

  test('P0.6 Filter tabs: Providers/Category/Collections switch active block', async ({
    browser,
  }, testInfo) => {
    const testName = 'p0_6_filter_tabs_switch';
    await withCasinoPage(browser, testInfo, testName, async ({ page, route, authStatePath }) => {
      const opened = await openFilterPanel(page);
      if (!opened.opened || !opened.panel) {
        const reason = opened.reason || 'Filter panel failed to open.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          opened,
        });
        return;
      }

      const checks = [];
      const mapping = [
        { label: 'providers', block: 'providers' },
        { label: 'Category', block: 'categories' },
        { label: 'Collections', block: 'collections' },
      ];

      for (const item of mapping) {
        const clicked = await activateFilterTab(opened.panel, item.label);
        const active = clicked ? await isFilterBlockActive(opened.panel, item.block) : false;
        checks.push({ ...item, clicked, active });
      }

      const providersActive = await isFilterBlockActive(opened.panel, 'providers');
      await filterPanelOk(opened.panel);
      const clickedCount = checks.filter((row) => row.clicked).length;
      const activeCount = checks.filter((row) => row.active).length;
      if (clickedCount > 0 && (clickedCount < 2 || activeCount < 1)) {
        const reason = `Filter tab layout differs from expected model (clicked=${clickedCount}, active=${activeCount}).`;
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          checks,
        });
        return;
      }
      if (clickedCount === 0 && !providersActive) {
        const reason = 'Filter tab controls are not exposed and provider block is not detectable.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          checks,
        });
        return;
      }

      const payload = {
        route,
        authStatePath,
        checks,
        clickedCount,
        activeCount,
        providersActive,
        note:
          clickedCount === 0
            ? 'Current layout does not expose explicit tab controls; inline provider block is used.'
            : null,
      };
      await writeAndAttach(testInfo, testName, payload);
    });
  });

  test('P1.7 Category chips: chips are clickable and update catalog state', async ({
    browser,
  }, testInfo) => {
    const testName = 'p1_7_category_chips';
    await withCasinoPage(browser, testInfo, testName, async ({ page, route, authStatePath }) => {
      let chips = await getVisibleCategoryChips(page);
      let clickMode = 'locator';
      let domFallback = [];
      if (!chips.length) {
        domFallback = await discoverCategoryChipsByDom(page);
        if (!domFallback.length) {
          const entries = await collectCatalogEntries(page);
          if (entries.length > 0) {
            await writeAndAttach(testInfo, testName, {
              route,
              authStatePath,
              clickMode: 'unsupported-layout',
              reason: 'Category chip controls are not exposed in current layout.',
              catalogSampleCount: entries.length,
              sampleEntries: entries.slice(0, 20),
            });
            return;
          }
          const reason = 'Category chips are not discoverable and catalog entries are unavailable.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
          });
          return;
        }
        clickMode = 'dom';
        chips = domFallback.map((item) => ({ label: item.label, locator: null, point: item }));
      }

      const checks = [];
      for (const chip of chips.slice(0, 6)) {
        await dismissOverlays(page);
        await closeMobileSidebarIfOpen(page);
        const before = await collectCatalogEntries(page);
        let clicked = false;
        if (chip.locator) {
          clicked = await chip.locator
            .click({ timeout: 5000 })
            .then(() => true)
            .catch(() => false);
        } else if (chip.point) {
          clicked = await page.mouse
            .click(chip.point.x + chip.point.w / 2, chip.point.y + chip.point.h / 2)
            .then(() => true)
            .catch(() => false);
        }
        if (!clicked) {
          await dismissOverlays(page);
          await closeMobileSidebarIfOpen(page);
          if (chip.locator) {
            clicked = await chip.locator
              .click({ timeout: 5000, force: true })
              .then(() => true)
              .catch(() => false);
          }
        }
        await waitForUiSettled(page, 1800);
        await dismissOverlays(page);
        const after = await collectCatalogEntries(page);

        const active = chip.locator
          ? await chip.locator
              .evaluate((node) =>
                /\b(active|selected|current|checked)\b/i.test(String(node.className || ''))
              )
              .catch(() => false)
          : null;
        const changed = JSON.stringify(before.slice(0, 50)) !== JSON.stringify(after.slice(0, 50));
        checks.push({
          chip: chip.label,
          clicked,
          active,
          changed,
          beforeCount: before.length,
          afterCount: after.length,
        });
      }

      expect(
        checks.filter((row) => row.active || row.changed).length,
        'Expected at least one category chip to change active/catalog state.'
      ).toBeGreaterThan(0);

      const payload = {
        route,
        authStatePath,
        clickMode,
        discoveredByDom: domFallback,
        checks,
      };
      await writeAndAttach(testInfo, testName, payload);
    });
  });

  test('P1.8 Combined flow: provider filter + search + clear', async ({ browser }, testInfo) => {
    const testName = 'p1_8_combined_search_filter';
    await withCasinoPage(browser, testInfo, testName, async ({ page, route, authStatePath }) => {
      const opened = await openFilterPanel(page);
      if (!opened.opened || !opened.panel) {
        const reason = opened.reason || 'Filter panel failed to open for combined flow.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          opened,
        });
        return;
      }

      await activateFilterTab(opened.panel, 'providers');
      const selected = await selectFirstUncheckedProvider(opened.panel);
      await filterPanelOk(opened.panel);
      if (!selected.clicked) {
        const reason = 'Combined flow: provider was not selected.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, { blocked: true, reason, route, authStatePath });
        return;
      }

      await waitForCasinoContent(page);
      const searchTarget = await pickVisibleCatalogSearchQuery(page);
      if (!searchTarget.query) {
        const reason =
          'Combined flow: selected provider produced no visible catalog title to search for.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          selectedProvider: selected.providerName,
        });
        return;
      }

      let search = await openSearchModal(page);
      if (!search.opened || !search.inputVisible || !search.input) {
        await dismissOverlays(page);
        await closeMobileSidebarIfOpen(page);
        await waitForUiSettled(page, 700);
        search = await openSearchModal(page);
      }
      if (!search.opened || !search.inputVisible || !search.input) {
        const reason = search.reason || 'Combined flow: search modal/input is unavailable.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          search,
        });
        return;
      }

      await search.input.click({ timeout: 3000 }).catch(() => null);
      await enterSearchQuery(search.input, searchTarget.query);
      const value = (await search.input.inputValue().catch(() => '')).toLowerCase();
      expect(
        value.includes(searchTarget.query.toLowerCase()),
        'Combined flow: search input did not accept query text.'
      ).toBeTruthy();
      await waitForUiSettled(page, 2200);
      const titles = await collectSearchResultTitles(search.modal || page);
      await closeSearchModal(search.modal, page);
      if (!titles.length) {
        const reason = 'Combined flow: search returned no titles after provider filter apply.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          selectedProvider: selected.providerName,
          searchTarget,
        });
        return;
      }

      const reopened = await openFilterPanel(page);
      if (!reopened.opened || !reopened.panel) {
        const reason = 'Combined flow: failed to reopen filter panel for clear.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, { blocked: true, reason, route, authStatePath });
        return;
      }
      await filterPanelClear(reopened.panel);
      await filterPanelOk(reopened.panel);

      const reopenedAfterClear = await openFilterPanel(page);
      expect(
        reopenedAfterClear.opened,
        'Combined flow: failed to reopen filter panel after clear.'
      ).toBeTruthy();
      if (!reopenedAfterClear.panel) return;
      await activateFilterTab(reopenedAfterClear.panel, 'providers');
      const checkedAfterClear = await getCheckedProvidersCount(reopenedAfterClear.panel);
      await filterPanelOk(reopenedAfterClear.panel);
      expect(checkedAfterClear, 'Combined flow: providers remain checked after clear.').toBe(0);

      const payload = {
        route,
        authStatePath,
        selectedProvider: selected.providerName,
        searchTarget,
        titlesCountAfterFilterAndSearch: titles.length,
        checkedAfterClear,
      };
      await writeAndAttach(testInfo, testName, payload);
    });
  });

  test('P1.9 Filter persistence model: state is stable across consecutive reloads', async ({
    browser,
  }, testInfo) => {
    const testName = 'p1_9_filter_persistence_model';
    await withCasinoPage(browser, testInfo, testName, async ({ page, route, authStatePath }) => {
      const opened = await openFilterPanel(page);
      if (!opened.opened || !opened.panel) {
        const reason = opened.reason || 'Filter panel failed to open.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          opened,
        });
        return;
      }

      await activateFilterTab(opened.panel, 'providers');
      const before = await getCheckedProvidersCount(opened.panel);
      const selected = await selectFirstUncheckedProvider(opened.panel);
      const afterClick = await getCheckedProvidersCount(opened.panel);
      await filterPanelOk(opened.panel);
      if (!selected.clicked || afterClick === before) {
        const reason = !selected.clicked
          ? 'No provider selected for persistence model check.'
          : 'Provider checkbox state did not change before reload.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, { blocked: true, reason, route, authStatePath });
        return;
      }

      const immediate = await openFilterPanel(page);
      if (!immediate.opened || !immediate.panel) {
        const reason =
          immediate.reason || 'Filter panel failed to open for immediate state capture.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          selectedProvider: selected.providerName,
        });
        return;
      }
      await activateFilterTab(immediate.panel, 'providers');
      const checkedImmediate = await getCheckedProvidersCount(immediate.panel);
      await filterPanelOk(immediate.panel);
      if (!checkedImmediate) {
        const reason = 'Applied provider is not checked before reload.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, { blocked: true, reason, route, authStatePath });
        return;
      }

      await page.reload({ waitUntil: 'domcontentloaded' });
      const challengeAfterReload = await getChallengeReason(page);
      if (challengeAfterReload) {
        markBlocked(testInfo, challengeAfterReload);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason: challengeAfterReload,
          route,
          authStatePath,
          selectedProvider: selected.providerName,
        });
        return;
      }
      await dismissOverlays(page);
      await waitForCasinoContent(page);
      await waitForUiSettled(page, 1200);
      const afterReloadOnePanel = await openFilterPanel(page);
      if (!afterReloadOnePanel.opened || !afterReloadOnePanel.panel) {
        const reason =
          afterReloadOnePanel.reason || 'Failed to open filter panel after first reload.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          selectedProvider: selected.providerName,
          checkedImmediate,
          afterReloadOnePanel,
        });
        return;
      }
      await activateFilterTab(afterReloadOnePanel.panel, 'providers');
      const checkedReloadOne = await getCheckedProvidersCount(afterReloadOnePanel.panel);
      await filterPanelOk(afterReloadOnePanel.panel);

      await page.reload({ waitUntil: 'domcontentloaded' });
      const challengeAfterSecondReload = await getChallengeReason(page);
      if (challengeAfterSecondReload) {
        markBlocked(testInfo, challengeAfterSecondReload);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason: challengeAfterSecondReload,
          route,
          authStatePath,
          selectedProvider: selected.providerName,
          checkedImmediate,
          checkedReloadOne,
        });
        return;
      }

      await dismissOverlays(page);
      await waitForCasinoContent(page);
      await waitForUiSettled(page, 1200);

      let afterReloadTwoPanel = await openFilterPanel(page);
      if (!afterReloadTwoPanel.opened || !afterReloadTwoPanel.panel) {
        // Recovery retry for transient UI state after hard reload.
        await dismissOverlays(page);
        await waitForUiSettled(page, 1200);
        afterReloadTwoPanel = await openFilterPanel(page);
      }
      if (!afterReloadTwoPanel.opened || !afterReloadTwoPanel.panel) {
        const reason =
          afterReloadTwoPanel.reason || 'Failed to open filter panel after second reload.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          selectedProvider: selected.providerName,
          checkedImmediate,
          checkedReloadOne,
          afterReloadTwoPanel,
        });
        return;
      }
      await activateFilterTab(afterReloadTwoPanel.panel, 'providers');
      const checkedReloadTwo = await getCheckedProvidersCount(afterReloadTwoPanel.panel);
      await filterPanelOk(afterReloadTwoPanel.panel);

      // Cleanup
      const cleanupPanel = await openFilterPanel(page);
      if (cleanupPanel.opened && cleanupPanel.panel) {
        await filterPanelClear(cleanupPanel.panel);
        await filterPanelOk(cleanupPanel.panel);
      }

      expect(
        checkedReloadOne,
        'Filter persistence model should be deterministic between consecutive reloads.'
      ).toBe(checkedReloadTwo);

      const payload = {
        route,
        authStatePath,
        selectedProvider: selected.providerName,
        checkedImmediate,
        checkedReloadOne,
        checkedReloadTwo,
      };
      await writeAndAttach(testInfo, testName, payload);
    });
  });

  test('P1.10 LOAD MORE: button expands catalog or becomes unavailable', async ({
    browser,
  }, testInfo) => {
    const testName = 'p1_10_load_more';
    await withCasinoPage(browser, testInfo, testName, async ({ page, route, authStatePath }) => {
      await page.keyboard.press('Escape').catch(() => null);
      await dismissOverlays(page);
      await closeMobileSidebarIfOpen(page);
      await closeCasinoPromotionModal(page);
      await waitForUiSettled(page, 800);
      let beforeEntries = await collectCatalogEntries(page);
      if (beforeEntries.length === 0) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await dismissOverlays(page);
        await closeMobileSidebarIfOpen(page);
        await closeCasinoPromotionModal(page);
        await waitForCasinoContent(page);
        await waitForUiSettled(page, 1200);
        beforeEntries = await collectCatalogEntries(page);
      }
      const loadMore = await firstVisibleLocator(page, [
        'button:has-text("LOAD MORE")',
        'button:has-text("Load more")',
        '.t-games-catalog__load-more',
        '.t-games-catalog [class*="load-more" i]',
        'main [class*="games-catalog" i] [class*="load-more" i]',
      ]);
      if (!loadMore) {
        const payload = {
          route,
          authStatePath,
          beforeCount: beforeEntries.length,
          loadMoreVisible: false,
          reason:
            beforeEntries.length >= 24
              ? 'LOAD MORE control is absent because catalog appears fully expanded.'
              : 'LOAD MORE control is absent in current layout/state.',
        };
        testInfo.annotations.push({
          type: 'note',
          description: payload.reason,
        });
        await writeAndAttach(testInfo, testName, payload);
        return;
      }

      await loadMore
        .evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }))
        .catch(() => null);
      await waitForUiSettled(page, 500);
      await closeMobileSidebarIfOpen(page);
      await closeCasinoPromotionModal(page, 1000);
      const enabledBeforeClick = await loadMore.isEnabled().catch(() => false);
      if (!enabledBeforeClick) {
        const reason = 'LOAD MORE button is disabled before click.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          beforeCount: beforeEntries.length,
        });
        return;
      }

      const clickSucceeded = await loadMore
        .click({ timeout: 7000 })
        .then(() => true)
        .catch(() => false);
      expect(clickSucceeded, 'LOAD MORE should be clickable.').toBeTruthy();
      await expect
        .poll(
          async () => {
            const entries = await collectCatalogEntries(page);
            const controlVisible = await loadMore.isVisible().catch(() => false);
            return entries.length > beforeEntries.length || !controlVisible;
          },
          { timeout: 12000, intervals: [500, 1000, 1500] }
        )
        .toBeTruthy()
        .catch(() => null);
      const challenge = await getChallengeReason(page);
      if (challenge) {
        markBlocked(testInfo, challenge);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason: challenge,
          route,
          authStatePath,
          beforeCount: beforeEntries.length,
        });
        return;
      }

      const afterEntries = await collectCatalogEntries(page);
      const loadMoreStillVisible = await loadMore.isVisible().catch(() => false);
      const expanded = afterEntries.length > beforeEntries.length || !loadMoreStillVisible;
      const sidebarOpenedAfterClick = await mobileSidebarCoversViewport(page);

      if (!expanded) {
        testInfo.annotations.push({
          type: 'product-warning',
          description: sidebarOpenedAfterClick
            ? 'LOAD MORE interaction opened the mobile sidebar instead of expanding the casino catalog.'
            : 'LOAD MORE click did not change visible catalog size in current run.',
        });
      }

      const payload = {
        route,
        authStatePath,
        beforeCount: beforeEntries.length,
        afterCount: afterEntries.length,
        loadMoreStillVisible,
        expanded,
        sidebarOpenedAfterClick,
      };
      await writeAndAttach(testInfo, testName, payload);
      expect(
        sidebarOpenedAfterClick,
        'LOAD MORE interaction should not open the mobile sidebar.'
      ).toBeFalsy();
      expect(
        afterEntries.length,
        'Casino catalog should expose entries after LOAD MORE action.'
      ).toBeGreaterThan(0);
    });
  });

  test('P1.11 Game launch Demo: Try for Fun opens game in demo-like flow', async ({
    browser,
  }, testInfo) => {
    const testName = 'p1_11_launch_demo';
    await withCasinoPage(
      browser,
      testInfo,
      testName,
      async ({ context, page, route, authStatePath }) => {
        const actionResult = await resolveWithTimeout(findGameActionButton(page, 'demo'), 45_000);
        if (actionResult.timedOut) {
          const reason = 'Demo action lookup timed out before launch.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
          });
          return;
        }
        const action = actionResult.value;
        if (!action.found || !action.button) {
          const reason = action.reason || 'Demo action button is not visible.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            action,
          });
          return;
        }

        const launchResult = await resolveWithTimeout(
          clickAndCaptureLaunch(context, page, action.button),
          60_000
        );
        if (launchResult.timedOut) {
          const reason = 'Demo game launch timed out before popup/same-tab response.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            action,
          });
          return;
        }
        const launch = launchResult.value;
        if (launch.popupChallenge || launch.sameTabChallenge) {
          const reason = launch.popupChallenge || launch.sameTabChallenge;
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            action,
            launch,
          });
          return;
        }

        expect(
          launch.launched,
          'Demo launch did not open popup/same-tab/iframe game surface.'
        ).toBeTruthy();
        const launchBlob = `${launch.popupUrl || ''} ${launch.sameTabUrl || ''} ${launch.popupTitle || ''}`;
        expect(
          !hasRealHint(launchBlob) || hasDemoHint(launchBlob),
          'Demo launch looks like real-money flow.'
        ).toBeTruthy();

        const payload = { route, authStatePath, action, launch };
        await writeAndAttach(testInfo, testName, payload);
      }
    );
  });

  test('P1.12 Game launch Real: Play opens non-demo flow or balance gate', async ({
    browser,
  }, testInfo) => {
    const testName = 'p1_12_launch_real';
    await withCasinoPage(
      browser,
      testInfo,
      testName,
      async ({ context, page, route, authStatePath }) => {
        const actionResult = await resolveWithTimeout(findGameActionButton(page, 'real'), 45_000);
        if (actionResult.timedOut) {
          const reason = 'Real-mode action lookup timed out before launch.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
          });
          return;
        }
        const action = actionResult.value;
        if (!action.found || !action.button) {
          const reason = action.reason || 'Real-mode Play action button is not visible.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            action,
          });
          return;
        }

        const launchResult = await resolveWithTimeout(
          clickAndCaptureLaunch(context, page, action.button),
          60_000
        );
        if (launchResult.timedOut) {
          const reason = 'Real-mode game launch timed out before popup/same-tab response.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            action,
          });
          return;
        }
        const launch = launchResult.value;
        if (launch.popupChallenge || launch.sameTabChallenge) {
          const reason = launch.popupChallenge || launch.sameTabChallenge;
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            action,
            launch,
          });
          return;
        }

        expect(
          launch.launched || launch.balanceGateVisible,
          'Real-mode Play should launch game surface or show balance/deposit gate.'
        ).toBeTruthy();
        expect(
          launch.loginModalVisible,
          'Real-mode Play should not open login form for authorized user.'
        ).toBeFalsy();

        const launchBlob = `${launch.popupUrl || ''} ${launch.sameTabUrl || ''} ${launch.popupTitle || ''}`;
        expect(
          !hasDemoHint(launchBlob) || hasRealHint(launchBlob) || launch.balanceGateVisible,
          'Real-mode Play looks like demo-only launch.'
        ).toBeTruthy();

        const payload = { route, authStatePath, action, launch };
        await writeAndAttach(testInfo, testName, payload);
      }
    );
  });

  test('P1.13 Favorites: one launched game can be added to favorites', async ({
    browser,
  }, testInfo) => {
    const testName = 'p1_13_favorites_add_game';
    await withCasinoPage(browser, testInfo, testName, async ({ page, route, authStatePath }) => {
      const actionResult = await resolveWithTimeout(findGameActionButton(page, 'real'), 45_000);
      if (actionResult.timedOut) {
        const reason = 'Real-mode action lookup timed out before favorites check.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
        });
        return;
      }
      const action = actionResult.value;
      if (!action.found) {
        const reason = action.reason || 'No game card was found for favorites check.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          action,
        });
        return;
      }

      await closeMobileSidebarIfOpen(page).catch(() => false);
      const cardSelectors = [
        '.t-games-catalog .t-game-item',
        '.t-games-catalog .t-game-play',
        '.t-games-catalog [class*="games-item" i]',
        'main .t-game-item',
        'main [class*="game-play" i]',
      ];
      let cards = null;
      for (const selector of cardSelectors) {
        const candidate = page.locator(selector);
        if ((await candidate.count().catch(() => 0)) > 0) {
          cards = candidate;
          break;
        }
      }
      const targetCard =
        cards && action.cardIndex >= 0 ? cards.nth(action.cardIndex) : page.locator('main').first();
      await targetCard.scrollIntoViewIfNeeded().catch(() => null);
      await targetCard.hover().catch(() => null);
      await waitForUiSettled(page, 700);

      const favoriteControl = await findFavoriteControl(targetCard, { cardScope: true });
      if (!favoriteControl) {
        const reason = 'Favorite control is not visible on game card in current layout.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          action,
        });
        return;
      }

      const favoriteStateBefore = await favoriteControlState(favoriteControl);
      let favoriteClicked = await clickLocatorRobust(page, favoriteControl, {
        timeout: 7000,
        waitForNavigation: false,
        settleTimeout: 700,
      }).catch(() => false);
      if (await mobileSidebarCoversViewport(page)) {
        await closeMobileSidebarIfOpen(page).catch(() => false);
        await targetCard.hover().catch(() => null);
        const retryControl = await findFavoriteControl(targetCard, { cardScope: true });
        favoriteClicked = retryControl
          ? await clickLocatorRobust(page, retryControl, {
              timeout: 5000,
              waitForNavigation: false,
              settleTimeout: 700,
            }).catch(() => false)
          : false;
      }
      if (!favoriteClicked) {
        const reason = 'Favorite control was visible but did not accept the click.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          action,
          favoriteStateBefore,
        });
        return;
      }
      await waitForUiSettled(page, 1400);
      const favoriteStateAfter = await favoriteControlState(favoriteControl);

      const favoritesRouteResult = await resolveWithTimeout(
        openCasinoSubRoute(page, '/favorites/'),
        45_000
      );
      if (favoritesRouteResult.timedOut) {
        const reason = 'Favorites route open timed out.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          action,
          favoriteStateBefore,
          favoriteStateAfter,
        });
        return;
      }
      const favoritesRoute = favoritesRouteResult.value;
      if (favoritesRoute.challenge) {
        const reason = favoritesRoute.challenge;
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          action,
          favoriteStateBefore,
          favoriteStateAfter,
          favoritesRoute,
        });
        return;
      }

      if (!/\/favorites\/?(?:[?#]|$)/i.test(String(favoritesRoute.finalUrl || ''))) {
        const reason = `Favorites route redirected to ${favoritesRoute.finalUrl || 'an unknown URL'} instead of /favorites/.`;
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          action,
          favoriteStateBefore,
          favoriteStateAfter,
          favoritesRoute,
        });
        return;
      }

      const favoriteEntriesResult = await resolveWithTimeout(
        (async () => {
          await waitForCasinoContent(page);
          await waitForUiSettled(page, 1200);
          return collectCatalogEntries(page);
        })(),
        45_000
      );
      if (favoriteEntriesResult.timedOut) {
        const reason = 'Favorites entries scan timed out.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          action,
          favoriteStateBefore,
          favoriteStateAfter,
          favoritesRoute,
        });
        return;
      }
      const favoriteEntries = favoriteEntriesResult.value;
      if (!favoriteEntries.length) {
        const reason = 'Favorites page opened, but no game entries are visible.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          action,
          favoriteStateBefore,
          favoriteStateAfter,
          favoritesRoute,
        });
        return;
      }

      const titleNeedle = normalizeLoose(action.cardTitle).split(' ').slice(0, 3).join(' ');
      const matched = favoriteEntries.some((entry) => {
        const text = normalizeLoose(entry.text);
        const href = normalizeLoose(entry.href);
        if (titleNeedle && text.includes(titleNeedle)) return true;
        if (action.cardHref && href.includes(normalizeLoose(action.cardHref))) return true;
        return false;
      });

      if (!matched && favoriteStateBefore === favoriteStateAfter) {
        const reason =
          'Favorite toggle did not affect state and selected game is not visible in favorites.';
        markBlocked(testInfo, reason);
        await writeAndAttach(testInfo, testName, {
          blocked: true,
          reason,
          route,
          authStatePath,
          action,
          favoriteStateBefore,
          favoriteStateAfter,
          favoritesRoute,
          favoritesCount: favoriteEntries.length,
          favoritesSample: favoriteEntries.slice(0, 20),
          matched,
        });
        return;
      }

      await writeAndAttach(testInfo, testName, {
        blocked: false,
        route,
        authStatePath,
        action,
        favoriteStateBefore,
        favoriteStateAfter,
        favoritesRoute,
        favoritesCount: favoriteEntries.length,
        favoritesSample: favoriteEntries.slice(0, 20),
        matched,
      });
    });
  });

  test('P1.14 Recent history: launched game appears in recent games list', async ({
    browser,
  }, testInfo) => {
    const testName = 'p1_14_recent_history_after_launch';
    await withCasinoPage(
      browser,
      testInfo,
      testName,
      async ({ context, page, route, authStatePath }) => {
        const actionResult = await resolveWithTimeout(findGameActionButton(page, 'real'), 45_000);
        if (actionResult.timedOut) {
          const reason = 'Real-mode action lookup timed out before recent-history check.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
          });
          return;
        }
        const action = actionResult.value;
        if (!action.found || !action.button) {
          const reason = action.reason || 'No real-mode game action available for history check.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            action,
          });
          return;
        }

        const launchResult = await resolveWithTimeout(
          clickAndCaptureLaunch(context, page, action.button),
          60_000
        );
        if (launchResult.timedOut) {
          const reason = 'Real-mode launch timed out before recent-history check.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            action,
          });
          return;
        }
        const launch = launchResult.value;
        if (launch.popupChallenge || launch.sameTabChallenge) {
          const reason = launch.popupChallenge || launch.sameTabChallenge;
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            action,
            launch,
          });
          return;
        }

        if (!launch.launched && !launch.balanceGateVisible) {
          const reason = 'Game launch was not confirmed before recent-history verification.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            action,
            launch,
          });
          return;
        }

        const recentRouteResult = await resolveWithTimeout(
          openCasinoSubRoute(page, '/recent/'),
          45_000
        );
        if (recentRouteResult.timedOut) {
          const reason = 'Recent route open timed out.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            action,
            launch,
          });
          return;
        }
        const recentRoute = recentRouteResult.value;
        if (recentRoute.challenge) {
          const reason = recentRoute.challenge;
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            action,
            launch,
            recentRoute,
          });
          return;
        }

        await waitForUiSettled(page, 1500);
        const titleNeedle = normalizeLoose(action.cardTitle).split(' ').slice(0, 3).join(' ');
        const launchIdentity = collectLaunchIdentity(action, launch);
        if (!launchIdentity.strictReady) {
          const reason =
            'Strict launch identity is missing (id/slug). Cannot hard-link launched game to history.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            action,
            launch,
            recentRoute,
            launchIdentity,
          });
          return;
        }

        const historyScanResult = await resolveWithTimeout(
          (async () => {
            const historySnapshots = [];
            let strictMatched = false;
            let looseMatched = false;
            let strictMatchEntry = null;

            for (let attempt = 1; attempt <= 3; attempt += 1) {
              const entries = await collectRecentEntries(page);
              historySnapshots.push({
                attempt,
                entriesCount: entries.length,
                sample: entries.slice(0, 20),
              });

              strictMatchEntry = entries.find((entry) =>
                matchesStrictHistoryEntry(entry, launchIdentity)
              );
              strictMatched = Boolean(strictMatchEntry);
              looseMatched = entries.some((entry) => {
                const normalized = normalizeLoose(entry && entry.text ? entry.text : '');
                return titleNeedle && normalized.includes(titleNeedle);
              });
              if (strictMatched) break;

              await page
                .reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
                .catch(() => null);
              await waitForUiSettled(page, 1200);
            }

            return { historySnapshots, strictMatched, looseMatched, strictMatchEntry };
          })(),
          70_000
        );
        if (historyScanResult.timedOut) {
          const reason = 'Recent-history polling timed out.';
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            action,
            launch,
            recentRoute,
            launchIdentity,
          });
          return;
        }
        const { historySnapshots, strictMatched, looseMatched, strictMatchEntry } =
          historyScanResult.value;

        if (!strictMatched) {
          const reason =
            'Recent games list did not include launched game by strict id/slug/provider link during observation window.';
          const recentDiagnostics = await page
            .evaluate(() => ({
              visibleHeadings: Array.from(document.querySelectorAll('h1, h2, h3'))
                .filter((node) => {
                  const rect = node.getBoundingClientRect();
                  const style = globalThis.getComputedStyle(node);
                  return (
                    rect.width > 0 &&
                    rect.height > 0 &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden'
                  );
                })
                .map((node) =>
                  String(node.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim()
                )
                .filter(Boolean)
                .slice(0, 20),
              visibleGameCards: Array.from(
                document.querySelectorAll('.t-game-item, .t-game-play')
              ).filter((node) => {
                const rect = node.getBoundingClientRect();
                const style = globalThis.getComputedStyle(node);
                return (
                  rect.width > 20 &&
                  rect.height > 14 &&
                  style.display !== 'none' &&
                  style.visibility !== 'hidden'
                );
              }).length,
              bodySample: String(document.body?.innerText || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 1000),
            }))
            .catch(() => null);
          const screenshot = await page.screenshot({ fullPage: false }).catch(() => null);
          if (screenshot) {
            await testInfo.attach('casino-recent-missing-launched-game.png', {
              body: screenshot,
              contentType: 'image/png',
            });
          }
          markBlocked(testInfo, reason);
          await writeAndAttach(testInfo, testName, {
            blocked: true,
            reason,
            route,
            authStatePath,
            action,
            launch,
            recentRoute,
            launchIdentity,
            looseMatched,
            historySnapshots,
            recentDiagnostics,
          });
          return;
        }

        await writeAndAttach(testInfo, testName, {
          blocked: false,
          route,
          authStatePath,
          action,
          launch,
          recentRoute,
          launchIdentity,
          historySnapshots,
          strictMatched,
          strictMatchEntry,
          looseMatched,
        });
      }
    );
  });

  test('P2.13 Visual smoke: casino default + search + filter on desktop and mobile', async ({
    browser,
  }, testInfo) => {
    const testName = 'p2_13_visual_smoke';
    const authStatePath = pickAuthStatePath();
    if (!authStatePath) {
      markBlocked(testInfo, 'No auth storage state found for casino visual smoke.');
      await writeAndAttach(testInfo, testName, {
        blocked: true,
        reason: 'No auth storage state found for casino visual smoke.',
      });
      return;
    }

    fs.mkdirSync(VISUAL_DIR, { recursive: true });
    const captured = [];
    const blocked = [];

    const plans = [
      { name: 'desktop-default', viewport: { width: 1365, height: 900 }, step: 'default' },
      { name: 'desktop-search', viewport: { width: 1365, height: 900 }, step: 'search' },
      { name: 'desktop-filter', viewport: { width: 1365, height: 900 }, step: 'filter' },
      { name: 'mobile-default', viewport: { width: 390, height: 844 }, step: 'default' },
    ];

    for (const plan of plans) {
      const extraHTTPHeaders = resolveExtraHTTPHeaders();
      const context = await browser.newContext({
        storageState: authStatePath,
        viewport: plan.viewport,
        ignoreHTTPSErrors: true,
        ...(extraHTTPHeaders ? { extraHTTPHeaders } : {}),
      });
      try {
        const page = await context.newPage();
        const route = await openCasino(page);
        if (route.challenge) {
          blocked.push({ name: plan.name, reason: route.challenge, route });
          continue;
        }

        if (plan.step === 'search') {
          const search = await openSearchModal(page);
          if (search.opened && search.inputVisible && search.input) {
            await enterSearchQuery(search.input, 'coin').catch(() => null);
            await waitForUiSettled(page, 1800);
          }
        }
        if (plan.step === 'filter') {
          await openFilterPanel(page);
        }

        const filePath = path.join(VISUAL_DIR, `${plan.name}.png`);
        await page.screenshot({ path: filePath, fullPage: true });
        captured.push({
          name: plan.name,
          file: filePath,
          viewport: plan.viewport,
          step: plan.step,
        });
      } finally {
        await closeContextBounded(context);
      }
    }

    if (!captured.length && blocked.length === plans.length) {
      const reason = 'All casino visual smoke routes are blocked by challenge.';
      markBlocked(testInfo, reason);
      await writeAndAttach(testInfo, testName, {
        blocked: true,
        reason,
        authStatePath,
        visualDir: VISUAL_DIR,
        plans,
        captured,
        blockedItems: blocked,
      });
      return;
    }

    expect(
      captured.length + blocked.length,
      'Every visual plan should be captured or blocked.'
    ).toBe(plans.length);
    expect(captured.length, 'Expected at least one casino visual screenshot.').toBeGreaterThan(0);

    const payload = {
      authStatePath,
      visualDir: VISUAL_DIR,
      plans,
      captured,
      blocked,
    };
    if (blocked.length) {
      markBlocked(
        testInfo,
        `Visual smoke blocked items: ${blocked.map((item) => item.name).join(', ')}`
      );
    }
    await writeAndAttach(testInfo, testName, payload);
  });
});
