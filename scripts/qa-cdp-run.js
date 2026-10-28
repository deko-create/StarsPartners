const { chromium, devices } = require('playwright');

const CLOUDFLARE_COOKIE_NAMES = new Set([
  'cf_clearance',
  '__cf_bm',
  '_cfuvid',
  '__cflb',
  'cf_chl_2',
]);
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

function resolveChromeExecutable() {
  const explicit = String(process.env.PW_CDP_CHROME_PATH || '').trim();
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidates =
    process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : process.platform === 'linux'
        ? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
        : [
            path.join(
              process.env.LOCALAPPDATA || '',
              'Google',
              'Chrome',
              'Application',
              'chrome.exe'
            ),
          ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function expandHome(value) {
  return String(value || '').replace(/^~(?=$|\/|\\)/, process.env.HOME || os.homedir());
}

function processExists(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cleanupStaleProfileLocks(profileDir) {
  const lockPath = path.join(profileDir, 'SingletonLock');
  try {
    fs.lstatSync(lockPath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  let ownerPid = 0;
  try {
    const target = fs.readlinkSync(lockPath);
    const match = String(target).match(/-(\d+)$/);
    ownerPid = match ? Number.parseInt(match[1], 10) : 0;
  } catch {
    ownerPid = 0;
  }
  if (processExists(ownerPid)) {
    throw new Error(`CDP profile is already in use by Chrome pid=${ownerPid}: ${profileDir}`);
  }
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      fs.unlinkSync(path.join(profileDir, name));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function waitForDevTools(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = () => {
      if (Date.now() >= deadline) return resolve(false);
      const request = http.get(
        { host: '127.0.0.1', port, path: '/json/version', timeout: 1200 },
        (response) => {
          response.resume();
          if (response.statusCode === 200) return resolve(true);
          setTimeout(poll, 250);
        }
      );
      request.on('error', () => setTimeout(poll, 250));
      request.on('timeout', () => {
        request.destroy();
        setTimeout(poll, 250);
      });
    };
    poll();
  });
}

async function pageIsReady(page) {
  if (/cdn-cgi|challenge-platform|__cf_chl|cf_chl_/i.test(page.url())) return false;
  const appVisible = await page
    .locator('#app, #__nuxt')
    .first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);
  if (!appVisible) return false;
  const body = await page.textContent('body').catch(() => '');
  return !/verify you are human|checking your browser|just a moment/i.test(String(body || ''));
}

async function pageHasApplicationError(page) {
  const title = await page.title().catch(() => '');
  const body = await page.textContent('body').catch(() => '');
  return /something went wrong|internal server error/i.test(`${title} ${body}`);
}

async function resetApplicationState(context, page, baseUrl) {
  const targetHost = new URL(baseUrl).hostname.toLowerCase();
  const cookies = await context.cookies(baseUrl).catch(() => []);
  for (const cookie of cookies) {
    const cookieName = String(cookie.name || '').toLowerCase();
    const cookieDomain = String(cookie.domain || '')
      .replace(/^\./, '')
      .toLowerCase();
    if (CLOUDFLARE_COOKIE_NAMES.has(cookieName)) continue;
    if (cookieDomain !== targetHost && !targetHost.endsWith(`.${cookieDomain}`)) continue;
    await context
      .clearCookies({ name: cookie.name, domain: cookie.domain, path: cookie.path || '/' })
      .catch(() => null);
  }
  await page
    .evaluate(() => {
      globalThis.localStorage.clear();
      globalThis.sessionStorage.clear();
    })
    .catch(() => null);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
}

async function installPersistentOverlayGuards(context) {
  const install = () => {
    const start = () => {
      if (globalThis.__qaPersistentOverlayGuard) return;
      const root = document.documentElement;
      if (!root) {
        globalThis.setTimeout(start, 0);
        return;
      }
      const dismiss = () => {
        const button = document.getElementById('onesignal-slidedown-cancel-button');
        if (button instanceof globalThis.HTMLElement) button.click();
      };
      dismiss();
      const observer = new globalThis.MutationObserver(dismiss);
      observer.observe(root, { childList: true, subtree: true });
      globalThis.__qaPersistentOverlayGuard = observer;
    };
    start();
  };

  await context.addInitScript(install);
  for (const page of context.pages()) {
    await page.evaluate(install).catch(() => null);
  }
}

async function findReadyApplicationPage(context, preferredPage, baseUrl) {
  const pages = [preferredPage, ...context.pages()].filter(
    (candidate, index, all) => candidate && all.indexOf(candidate) === index
  );
  for (const candidate of pages) {
    if (!candidate.url().startsWith(baseUrl)) continue;
    if (await pageIsReady(candidate)) return candidate;
  }
  return null;
}

async function waitForManualChallenge(context, page, baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let applicationStateReset = false;
  while (Date.now() < deadline) {
    const readyPage = await findReadyApplicationPage(context, page, baseUrl);
    if (readyPage) return readyPage;
    if (!applicationStateReset && (await pageHasApplicationError(page))) {
      applicationStateReset = true;
      console.log('Recovering application state while preserving Cloudflare cookies.');
      await resetApplicationState(context, page, baseUrl);
      continue;
    }
    await page.waitForTimeout(1000);
  }
  if (!process.stdin.isTTY) return null;
  console.log('\nCloudflare challenge is visible in native Chrome.');
  console.log('Complete it in the opened window, wait for the site, then press Enter here.');
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once('data', resolve));
  process.stdin.pause();
  return findReadyApplicationPage(context, page, baseUrl);
}

function runChild(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: process.cwd(), env, stdio: 'inherit' });
    let settled = false;
    const finish = (code, signal = null) => {
      if (settled) return;
      settled = true;
      resolve({ code: Number(code || (signal ? 1 : 0)), signal });
    };
    child.on('error', () => finish(1));
    child.on('close', finish);
  });
}

function resolveLaunchUserAgent() {
  const explicit = String(process.env.PW_CDP_USER_AGENT || '').trim();
  if (explicit) return explicit;

  const mode = String(process.env.QA_EXECUTION_MODE || process.env.PW_PROJECT_MATRIX || '')
    .trim()
    .toLowerCase();
  if (mode !== 'mobile' && mode !== 'm') return '';

  const configuredMobile = String(process.env.PW_MOBILE_USER_AGENT || '').trim();
  if (configuredMobile) return configuredMobile;
  return String((devices['Pixel 7'] && devices['Pixel 7'].userAgent) || '').trim();
}

async function saveState(context, page, outPath) {
  if (!outPath) return;
  const resolved = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  await context.storageState({ path: resolved });
  const userAgent = await page.evaluate(() => globalThis.navigator.userAgent).catch(() => '');
  fs.writeFileSync(
    `${resolved}.cdp-meta.json`,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'qa-cdp-run',
        url: page.url(),
        userAgent,
        profileDir: process.env.PW_CDP_PROFILE_DIR || '',
      },
      null,
      2
    )}\n`
  );
}

async function main() {
  const separator = process.argv.indexOf('--');
  const childArgs = separator >= 0 ? process.argv.slice(separator + 1) : [];
  if (childArgs.length === 0) {
    throw new Error('Usage: node scripts/qa-cdp-run.js -- <command> [args...]');
  }

  const chromeExecutable = resolveChromeExecutable();
  if (!chromeExecutable) throw new Error('Google Chrome was not found. Set PW_CDP_CHROME_PATH.');
  const baseUrl = String(process.env.BASE_URL || '').trim();
  if (!baseUrl) throw new Error('BASE_URL is required for CDP mode.');
  const profileDir = path.resolve(
    expandHome(
      process.env.PW_CDP_PROFILE_DIR ||
        path.join(process.cwd(), 'projects', 'cdp-profile', 'desktop')
    )
  );
  const configuredPort = Number.parseInt(process.env.PW_CDP_PORT || '', 10);
  const port =
    Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : await reservePort();
  const endpoint = `http://127.0.0.1:${port}`;
  const viewport = String(process.env.PW_CDP_WINDOW_SIZE || '1365,900');
  fs.mkdirSync(profileDir, { recursive: true });
  cleanupStaleProfileLocks(profileDir);

  console.log('\n=== Native Chrome CDP session ===');
  console.log(`Chrome: ${chromeExecutable}`);
  console.log(`Profile: ${profileDir}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`URL: ${baseUrl}`);

  const launchUserAgent = resolveLaunchUserAgent();
  const chromeArgs = [
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${viewport}`,
    ...(launchUserAgent ? [`--user-agent=${launchUserAgent}`] : []),
    '--new-window',
    baseUrl,
  ];
  const chrome = spawn(chromeExecutable, chromeArgs, { stdio: 'ignore', detached: false });

  let browser = null;
  try {
    if (!(await waitForDevTools(port))) {
      throw new Error(`Native Chrome DevTools endpoint did not start at ${endpoint}.`);
    }
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error('Native Chrome persistent context is unavailable.');
    await installPersistentOverlayGuards(context);
    let page =
      context.pages().find((candidate) => candidate.url().startsWith(baseUrl)) ||
      context.pages()[0] ||
      (await context.newPage());
    if (!page.url().startsWith(baseUrl)) {
      await page
        .goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        .catch(() => null);
    }
    const readyPage = await waitForManualChallenge(
      context,
      page,
      baseUrl,
      Number.parseInt(process.env.PW_CDP_READY_TIMEOUT_MS || '30000', 10)
    );
    if (!readyPage) throw new Error('Native Chrome did not reach the application page.');
    page = readyPage;

    await saveState(context, page, process.env.PW_STORAGE_STATE || '');
    const userAgent = await page.evaluate(() => globalThis.navigator.userAgent).catch(() => '');
    const [command, ...args] = childArgs;
    const childEnv = {
      ...process.env,
      PW_BROWSER: 'chromium',
      PW_CDP_REUSE_CONTEXT: '1',
      PW_CDP_ENDPOINT: endpoint,
      PW_USER_AGENT: userAgent || process.env.PW_USER_AGENT || '',
      PW_AUTO_SAVE_STATE: '0',
      PW_FORCE_SAVE_STATE_BEFORE_RUN: '0',
      PW_SUITE_REFRESH_MAX: '0',
    };
    console.log(`\n> ${[command, ...args].join(' ')}`);
    const result = await runChild(command, args, childEnv);
    await saveState(context, page, process.env.PW_STORAGE_STATE || '');
    process.exitCode = result.code;
  } finally {
    if (browser) await browser.close().catch(() => null);
    if (chrome.pid) {
      try {
        process.kill(chrome.pid, 'SIGTERM');
      } catch {
        // Chrome may already be closed through CDP.
      }
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  cleanupStaleProfileLocks,
  pageIsReady,
  reservePort,
  resolveLaunchUserAgent,
  resolveChromeExecutable,
  waitForDevTools,
};
