const { loadProjectEnv } = require('./scripts/lib/env');

loadProjectEnv();

const { defineConfig, devices } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveExtraHTTPHeaders } = require('./tests/helpers/context-options');
const { resolveProjectPaths } = require('./tests/helpers/project-paths');

const isMacArm = process.platform === 'darwin' && process.arch === 'arm64';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const allowChromeChannel = process.env.PW_USE_CHROME_CHANNEL === '1';
const useChromeChannel = isMacArm && fs.existsSync(chromePath) && allowChromeChannel;
const baseUrl = process.env.BASE_URL || 'https://gt.bet';
const projectPaths = resolveProjectPaths({ cwd: process.cwd(), baseUrl });
const configuredStorageState =
  process.env.PW_STORAGE_STATE || path.join(projectPaths.projectRoot, 'storageState.json');
const storageStatePath = fs.existsSync(configuredStorageState) ? configuredStorageState : undefined;
const requestedBrowser = String(process.env.PW_BROWSER || 'chromium').toLowerCase();
const browserName = ['chromium', 'firefox', 'webkit'].includes(requestedBrowser)
  ? requestedBrowser
  : 'chromium';
const headedRequested = process.env.PW_HEADED === '1' || process.env.HEADLESS === '0';
const slowMo = Number.parseInt(process.env.PW_SLOWMO || '0', 10);
const locale = process.env.PW_LOCALE || 'en-US';
const testOutputDir = process.env.QA_TEST_RESULTS_DIR || path.join(process.cwd(), 'test-results');
const reportJsonOutputFile = path.join(testOutputDir, 'report.json');
const DESKTOP_VIEWPORT = { width: 1365, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const iPhoneProfile = devices['iPhone 13'];

function parseProjectMatrix(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return ['desktop'];
  if (raw === 'all') return ['desktop', 'mobile'];

  const tokens = raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);

  const selected = [];
  for (const token of tokens) {
    if (token === 'desktop' || token === 'd') {
      if (!selected.includes('desktop')) selected.push('desktop');
      continue;
    }
    if (token === 'mobile' || token === 'm') {
      if (!selected.includes('mobile')) selected.push('mobile');
    }
  }

  return selected.length ? selected : ['desktop'];
}

const projectMatrix = parseProjectMatrix(process.env.PW_PROJECT_MATRIX || 'desktop');

const extraHTTPHeaders = resolveExtraHTTPHeaders();
function readCdpMetaUserAgent(storagePath) {
  if (!storagePath) return '';
  try {
    const metaPath = `${path.resolve(storagePath)}.cdp-meta.json`;
    if (!fs.existsSync(metaPath)) return '';
    const payload = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return String((payload && payload.userAgent) || '').trim();
  } catch {
    return '';
  }
}

function resolveUserAgent() {
  if (process.env.PW_USER_AGENT) return process.env.PW_USER_AGENT;
  const cdpUserAgent = readCdpMetaUserAgent(configuredStorageState);
  if (!cdpUserAgent) return undefined;

  const mobileOnly = projectMatrix.length === 1 && projectMatrix[0] === 'mobile';
  const desktopOnly = projectMatrix.length === 1 && projectMatrix[0] === 'desktop';
  const looksMobile = /mobile|iphone|ipad|android/i.test(cdpUserAgent);
  if (mobileOnly) return looksMobile ? cdpUserAgent : undefined;
  if (desktopOnly) return looksMobile ? undefined : cdpUserAgent;
  return undefined;
}

const userAgent = resolveUserAgent();
const chromiumArmPath = (() => {
  try {
    const root = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
    const entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium-'))
      .map((entry) => entry.name)
      .sort((a, b) => {
        const anum = Number(a.replace('chromium-', ''));
        const bnum = Number(b.replace('chromium-', ''));
        return bnum - anum;
      });

    for (const entry of entries) {
      const candidate = path.join(
        root,
        entry,
        'chrome-mac-arm64',
        'Google Chrome for Testing.app',
        'Contents',
        'MacOS',
        'Google Chrome for Testing'
      );
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // Best-effort only; fall back to Playwright defaults if unavailable.
  }
  return null;
})();
const tmpHome = (() => {
  const dir = path.join(os.tmpdir(), 'pw-home');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // If this fails, we fall back to the default HOME.
  }
  return dir;
})();

const reporters = [['line']];
if (process.env.PW_REPORT_JSON === '1') {
  reporters.push(['json', { outputFile: reportJsonOutputFile }]);
}
if (process.env.PW_REPORT_JUNIT === '1' || process.env.CI) {
  reporters.push(['junit', { outputFile: path.join(testOutputDir, 'junit.xml') }]);
}
if (process.env.PW_REPORT_HTML === '1' || process.env.CI) {
  reporters.push(['html', { outputFolder: 'playwright-report', open: 'never' }]);
}
if (process.env.PW_REPORT_ALLURE === '1') {
  reporters.push([
    'allure-playwright',
    {
      outputFolder: process.env.ALLURE_RESULTS_DIR || 'allure-results',
      detail: true,
      suiteTitle: true,
    },
  ]);
}

module.exports = defineConfig({
  testDir: './tests',
  outputDir: testOutputDir,
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL: process.env.BASE_URL || 'https://gt.bet',
    locale,
    browserName,
    ...(storageStatePath ? { storageState: storageStatePath } : {}),
    headless: !headedRequested,
    ...(userAgent ? { userAgent } : {}),
    ...(extraHTTPHeaders ? { extraHTTPHeaders } : {}),
    ...(useChromeChannel && browserName === 'chromium' ? { channel: 'chrome' } : {}),
    launchOptions: {
      ...(browserName === 'chromium'
        ? { args: ['--disable-crashpad', '--no-crashpad', '--disable-features=Crashpad'] }
        : {}),
      ...(Number.isFinite(slowMo) && slowMo > 0 ? { slowMo } : {}),
      ...(!useChromeChannel && browserName === 'chromium' && chromiumArmPath
        ? { executablePath: chromiumArmPath }
        : {}),
      env: tmpHome ? { ...process.env, HOME: tmpHome } : undefined,
    },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: projectMatrix.map((profile) =>
    profile === 'mobile'
      ? {
          name: 'mobile',
          use: {
            ...(iPhoneProfile || {}),
            viewport: MOBILE_VIEWPORT,
            isMobile: true,
            hasTouch: true,
            ...(userAgent ? { userAgent } : {}),
          },
        }
      : {
          name: 'desktop',
          use: {
            viewport: DESKTOP_VIEWPORT,
            isMobile: false,
            hasTouch: false,
          },
        }
  ),

  reporter: reporters,
});
