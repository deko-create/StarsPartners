const { URL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const DEFAULT_BASE_URL = process.env.BASE_URL || 'https://gt.bet/';

const COUNTRY_PROFILE_BY_NAME = {
  spain: { countryId: 171, dialingCode: '34', nationalDigits: 9, zipcode: '28001' },
  spagna: { countryId: 171, dialingCode: '34', nationalDigits: 9, zipcode: '28001' },
  españa: { countryId: 171, dialingCode: '34', nationalDigits: 9, zipcode: '28001' },
  espana: { countryId: 171, dialingCode: '34', nationalDigits: 9, zipcode: '28001' },
};

const DEFAULT_COUNTRY_PROFILE = COUNTRY_PROFILE_BY_NAME.spain;

const DEFAULT_CDP_TIMEOUT_MS = 90_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseHost(baseUrl) {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isNixHost(baseUrl) {
  const host = parseHost(baseUrl);
  return /(^|\.)nix\.bet$/i.test(host);
}

function isStarzinoHost(baseUrl) {
  const host = parseHost(baseUrl);
  return /(^|\.)starzino\.com$/i.test(host);
}

function normalizeApiBody(body) {
  return body && typeof body === 'object' ? body : null;
}

function shouldTryCdpTurnstileFallback({ baseUrl, status, body, page }) {
  const enabledByEnv = process.env.PW_SIGNUP_CDP_FALLBACK === '1';
  const disabledByEnv = process.env.PW_SIGNUP_CDP_FALLBACK === '0';
  if (disabledByEnv) return false;
  const cdpHost = isNixHost(baseUrl) || isStarzinoHost(baseUrl);
  const reusableCdpSession = Boolean(
    page &&
    (process.env.PW_CDP_REUSE_CONTEXT === '1' ||
      process.env.PW_CDP_ENDPOINT ||
      process.env.PW_CDP_URL)
  );
  // When explicitly enabled, allow CDP fallback for any non-200 signup response.
  // This is needed for brands where WAF/challenge returns 4xx/5xx HTML instead of
  // RECAPTCHA_NOT_VALID JSON payloads.
  if (enabledByEnv && status !== 200) return true;
  // A WAF HTML 403 is exactly where the already-open native Chrome session is
  // valuable: it retains the user's VPN path and Cloudflare clearance cookies.
  if (reusableCdpSession && status === 403) return true;
  if (!enabledByEnv && !cdpHost) return false;
  if (cdpHost && status !== 200) return true;
  if (status !== 400) return false;

  const payload = normalizeApiBody(body);
  const code = payload && payload.errorCode ? String(payload.errorCode).toUpperCase() : '';
  return code === 'RECAPTCHA_NOT_VALID';
}

async function dismissSignupPromoFrames(page) {
  const promoPattern =
    /pick your reward|werde teil von ax\s*bet|neue plattform,? neue emotionen|mehr erfahren/i;
  for (const frame of page.frames().filter((candidate) => candidate !== page.mainFrame())) {
    const visible = await frame
      .getByText(promoPattern)
      .first()
      .isVisible({ timeout: 250 })
      .catch(() => false);
    if (!visible) continue;
    const close = frame
      .locator('button')
      .filter({ hasNotText: /claim|mehr erfahren|learn more|register|sign up/i })
      .first();
    if (await close.isVisible({ timeout: 250 }).catch(() => false)) {
      await close.click({ timeout: 1500, force: true }).catch(() => null);
      await delay(350);
    }
    const stillVisible = await frame
      .getByText(promoPattern)
      .first()
      .isVisible({ timeout: 250 })
      .catch(() => false);
    if (!stillVisible) continue;
    const element = await frame.frameElement().catch(() => null);
    if (element) await element.evaluate((node) => node.remove()).catch(() => null);
  }
}

async function parseApiResponse(response) {
  const status = response.status();
  const contentType = response.headers()['content-type'] || '';
  const body = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);
  return { status, body };
}

async function registerPlayerViaCurrentContextTurnstile({ page, data, baseUrl, options }) {
  const context = page && page.context ? page.context() : null;
  if (!context) return null;

  const timeoutMs = Number.parseInt(
    process.env.PW_SIGNUP_CDP_TIMEOUT_MS || String(DEFAULT_CDP_TIMEOUT_MS),
    10
  );
  const signupPage = await context.newPage();
  const signupUrl = new URL('/#signup', baseUrl).toString();
  const url = new URL('/api/auth/signup', baseUrl).toString();
  try {
    await signupPage.goto(signupUrl, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(timeoutMs, 45_000),
    });
    await delay(1200);
    await dismissSignupPromoFrames(signupPage);
    await clickFirstVisible(signupPage, [
      '[data-testid="signup-button"]',
      'button:has-text("Sign Up")',
      'button:has-text("Sign up")',
      'button:has-text("Register")',
    ]).catch(() => null);
    await delay(500);
    await fillLoginCredentials(signupPage, data);

    const turnstileToken = await waitForTurnstileToken(signupPage, {
      timeoutMs: Math.max(10_000, timeoutMs - 25_000),
      actionSelectors: [
        '[data-testid="signup-button"]',
        'button:has-text("Sign Up")',
        'button:has-text("Sign up")',
        'button:has-text("Register")',
        'button[type="submit"]',
      ],
    });
    if (!turnstileToken) {
      throw new Error('Current Chrome context could not obtain Turnstile token.');
    }

    const payload = buildSignupApiPayload(data, options);
    payload['g-recaptcha-response'] = turnstileToken;
    payload['g-recaptcha-ver'] = 'turnstile-invisible';
    const response = await signupPage.request.post(url, {
      data: payload,
      headers: {
        origin: new URL(baseUrl).origin,
        referer: signupUrl,
        'content-type': 'application/json',
        accept: 'application/json, text/plain, */*',
      },
      failOnStatusCode: false,
      timeout: Math.min(timeoutMs, 45_000),
    });
    const { status, body } = await parseApiResponse(response);
    const ok =
      status === 200 &&
      body &&
      typeof body === 'object' &&
      typeof body.token === 'string' &&
      body.token.length >= 10 &&
      Number.isFinite(Number(body.userId)) &&
      Number(body.userId) > 0;
    return {
      ok,
      status,
      url,
      payload,
      body,
      source: 'current-cdp-context-turnstile',
      turnstileTokenLen: turnstileToken.length,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      url,
      payload: null,
      body: {
        errorCode: 'CURRENT_CDP_CONTEXT_FALLBACK_FAILED',
        errorMessage: String(err && err.message ? err.message : err),
      },
      source: 'current-cdp-context-turnstile',
    };
  } finally {
    await signupPage.close().catch(() => null);
  }
}

function resolveChromeExecutable() {
  const explicit = process.env.PW_SIGNUP_CDP_CHROME_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;

  const candidates = [];
  if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta');
  } else if (process.platform === 'linux') {
    candidates.push('/usr/bin/google-chrome');
    candidates.push('/usr/bin/google-chrome-stable');
    candidates.push('/usr/bin/chromium');
    candidates.push('/usr/bin/chromium-browser');
  } else if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    candidates.push(path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    candidates.push(path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    candidates.push(path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }

  const systemChrome = candidates.find((candidate) => fs.existsSync(candidate));
  if (systemChrome) return systemChrome;

  try {
    const bundledChromium = chromium.executablePath();
    if (bundledChromium && fs.existsSync(bundledChromium)) return bundledChromium;
  } catch {
    // Playwright browser may be unavailable; keep null fallback.
  }

  return null;
}

async function waitForDevTools(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const isReady = await new Promise((resolve) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: '/json/version',
          timeout: 1500,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
    if (isReady) return true;
    await delay(300);
  }
  return false;
}

function killProcessTree(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    }
    process.kill(proc.pid, 'SIGKILL');
  } catch {
    // ignore best-effort cleanup
  }
}

function isVisibleLocator(locator) {
  return locator.isVisible().catch(() => false);
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors || []) {
    const target = page.locator(selector).first();
    if (!(await isVisibleLocator(target))) continue;
    const clicked = await target
      .click({ timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (clicked) return true;
  }
  return false;
}

async function waitForTurnstileToken(page, options = {}) {
  const resolved = typeof options === 'number' ? { timeoutMs: options } : options || {};
  const timeoutMs = Number.isFinite(resolved.timeoutMs) ? resolved.timeoutMs : 35_000;
  const actionSelectors =
    Array.isArray(resolved.actionSelectors) && resolved.actionSelectors.length
      ? resolved.actionSelectors
      : [
          '[data-testid="signup-button"]',
          'button:has-text("Sign Up")',
          'button:has-text("Sign up")',
        ];
  const executeTurnstile = resolved.executeTurnstile !== false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tokenValue = await page
      .locator('input[name="cf-turnstile-response"]')
      .first()
      .inputValue()
      .catch(() => '');
    const token = String(tokenValue || '').trim();
    if (token.length >= 40) return token;

    await clickFirstVisible(page, actionSelectors).catch(() => null);

    if (executeTurnstile) {
      await page
        .evaluate(() => {
          const ts = window.turnstile;
          if (!ts || typeof ts.execute !== 'function') return;
          try {
            ts.execute();
          } catch {
            // no-op
          }
        })
        .catch(() => null);
    }

    await delay(700);
  }

  return '';
}

async function fillLoginCredentials(page, data) {
  const emailSelectors = [
    '.t-login-modal input[type="email"]',
    '[data-testid="login-modal"] input[type="email"]',
    'input[name*="email" i]',
    'input[type="email"]',
    'input:visible:not([type="password"])',
  ];
  const passwordSelectors = [
    '.t-login-modal input[type="password"]',
    '[data-testid="login-modal"] input[type="password"]',
    'input[name*="password" i]',
    'input[type="password"]',
  ];

  for (const selector of emailSelectors) {
    const input = page.locator(selector).first();
    if (!(await isVisibleLocator(input))) continue;
    await input.fill(String(data.email || '')).catch(() => null);
    break;
  }
  for (const selector of passwordSelectors) {
    const input = page.locator(selector).first();
    if (!(await isVisibleLocator(input))) continue;
    await input.fill(String(data.password || '')).catch(() => null);
    break;
  }
}

async function registerPlayerViaApiWithCdpTurnstile({ data, baseUrl = DEFAULT_BASE_URL, options }) {
  const chromeExecutable = resolveChromeExecutable();
  if (!chromeExecutable) {
    return {
      ok: false,
      status: 0,
      url: new URL('/api/auth/signup', baseUrl).toString(),
      payload: null,
      body: {
        errorCode: 'CDP_CHROME_NOT_FOUND',
        errorMessage: 'Chrome executable for CDP fallback was not found.',
      },
      source: 'cdp-turnstile',
    };
  }

  const timeoutMs = Number.parseInt(
    process.env.PW_SIGNUP_CDP_TIMEOUT_MS || String(DEFAULT_CDP_TIMEOUT_MS),
    10
  );
  const portFromEnv = Number.parseInt(process.env.PW_SIGNUP_CDP_PORT || '', 10);
  const port =
    Number.isFinite(portFromEnv) && portFromEnv > 0
      ? portFromEnv
      : 9222 + Math.floor(Math.random() * 3000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-signup-cdp-'));
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    'about:blank',
  ];
  const chromeProc = spawn(chromeExecutable, chromeArgs, {
    stdio: 'ignore',
    detached: false,
  });

  let browser = null;
  try {
    const ready = await waitForDevTools(port, 25_000);
    if (!ready) {
      throw new Error(`CDP endpoint was not ready on port ${port}.`);
    }

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();
    const signupUrl = new URL('/#signup', baseUrl).toString();
    await page
      .goto(signupUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
      .catch(() => null);
    await delay(2500);

    const turnstileToken = await waitForTurnstileToken(page, Math.max(10_000, timeoutMs - 25_000));
    if (!turnstileToken) {
      throw new Error('CDP fallback could not obtain Turnstile token.');
    }

    const url = new URL('/api/auth/signup', baseUrl).toString();
    const payload = buildSignupApiPayload(data, options);
    payload['g-recaptcha-response'] = turnstileToken;
    payload['g-recaptcha-ver'] = 'turnstile-invisible';

    const response = await page.request.post(url, {
      data: payload,
      headers: {
        origin: new URL(baseUrl).origin,
        referer: signupUrl,
        'content-type': 'application/json',
        accept: 'application/json, text/plain, */*',
      },
      failOnStatusCode: false,
      timeout: timeoutMs,
    });

    const status = response.status();
    const contentType = response.headers()['content-type'] || '';
    let body = null;
    if (contentType.includes('application/json')) {
      body = await response.json().catch(() => null);
    } else {
      body = await response.text().catch(() => null);
    }

    const ok =
      status === 200 &&
      body &&
      typeof body === 'object' &&
      typeof body.token === 'string' &&
      body.token.length >= 10 &&
      Number.isFinite(Number(body.userId)) &&
      Number(body.userId) > 0;

    return {
      ok,
      status,
      url,
      payload,
      body,
      source: 'cdp-turnstile',
      turnstileTokenLen: turnstileToken.length,
    };
  } finally {
    try {
      if (browser) await browser.close();
    } catch {
      // ignore
    }
    killProcessTree(chromeProc);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function validatePlayerSigninViaCdpTurnstile({ data, baseUrl = DEFAULT_BASE_URL }) {
  const chromeExecutable = resolveChromeExecutable();
  if (!chromeExecutable) {
    return {
      ok: false,
      status: 0,
      url: new URL('/api/auth/signin', baseUrl).toString(),
      payload: null,
      body: {
        errorCode: 'CDP_CHROME_NOT_FOUND',
        errorMessage: 'Chrome executable for CDP sign-in validation was not found.',
      },
      source: 'cdp-signin-turnstile',
    };
  }

  const timeoutMs = Number.parseInt(
    process.env.PW_SIGNIN_CDP_TIMEOUT_MS || process.env.PW_SIGNUP_CDP_TIMEOUT_MS || '90000',
    10
  );
  const portFromEnv = Number.parseInt(process.env.PW_SIGNIN_CDP_PORT || '', 10);
  const port =
    Number.isFinite(portFromEnv) && portFromEnv > 0
      ? portFromEnv
      : 9422 + Math.floor(Math.random() * 3000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-signin-cdp-'));
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    'about:blank',
  ];
  const chromeProc = spawn(chromeExecutable, chromeArgs, {
    stdio: 'ignore',
    detached: false,
  });

  let browser = null;
  try {
    const ready = await waitForDevTools(port, 25_000);
    if (!ready) {
      throw new Error(`CDP endpoint was not ready on port ${port}.`);
    }

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();
    const signinUrl = new URL('/#signin', baseUrl).toString();
    await page
      .goto(signinUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
      .catch(() => null);
    await delay(2000);

    await clickFirstVisible(page, [
      '[data-testid="login-button"]',
      'button:has-text("LOG IN")',
      'button:has-text("Log In")',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
    ]).catch(() => null);
    await delay(900);

    await fillLoginCredentials(page, data);

    const turnstileToken = await waitForTurnstileToken(page, {
      timeoutMs: Math.max(10_000, timeoutMs - 25_000),
      actionSelectors: [
        '[data-testid="login-button"]',
        'button:has-text("LOG IN")',
        'button:has-text("Log In")',
        'button:has-text("Login")',
        'button:has-text("Sign in")',
        'button[type="submit"]',
      ],
    });
    if (!turnstileToken) {
      throw new Error('CDP sign-in validation could not obtain Turnstile token.');
    }

    const url = new URL('/api/auth/signin', baseUrl).toString();
    const payload = {
      email: String(data.email || ''),
      password: String(data.password || ''),
      'g-recaptcha-response': turnstileToken,
      'g-recaptcha-ver': 'turnstile-invisible',
    };

    const response = await page.request.post(url, {
      data: payload,
      headers: {
        origin: new URL(baseUrl).origin,
        referer: signinUrl,
        'content-type': 'application/json',
        accept: 'application/json, text/plain, */*',
      },
      failOnStatusCode: false,
      timeout: timeoutMs,
    });

    const status = response.status();
    const contentType = response.headers()['content-type'] || '';
    let body = null;
    if (contentType.includes('application/json')) {
      body = await response.json().catch(() => null);
    } else {
      body = await response.text().catch(() => null);
    }

    const ok =
      status === 200 &&
      body &&
      typeof body === 'object' &&
      typeof body.token === 'string' &&
      body.token.length >= 10 &&
      Number.isFinite(Number(body.userId)) &&
      Number(body.userId) > 0;

    return {
      ok,
      status,
      url,
      payload,
      body,
      source: 'cdp-signin-turnstile',
      turnstileTokenLen: turnstileToken.length,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      url: new URL('/api/auth/signin', baseUrl).toString(),
      payload: null,
      body: {
        errorCode: 'CDP_SIGNIN_VALIDATION_FAILED',
        errorMessage: String(err && err.message ? err.message : err),
      },
      source: 'cdp-signin-turnstile',
    };
  } finally {
    try {
      if (browser) await browser.close();
    } catch {
      // ignore
    }
    killProcessTree(chromeProc);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function normalizeDatePart(value, fallback) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return fallback;
  return digits.padStart(2, '0').slice(-2);
}

function normalizeYear(value, fallback) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return fallback;
  return digits.padStart(4, '0').slice(-4);
}

function resolveCountryProfile(country, options = {}) {
  const key = String(country || '')
    .trim()
    .toLowerCase();
  const configured = COUNTRY_PROFILE_BY_NAME[key] || DEFAULT_COUNTRY_PROFILE;
  return {
    countryId: Number(options.countryId || configured.countryId),
    dialingCode: String(options.dialingCode || configured.dialingCode).replace(/\D+/g, ''),
    nationalDigits: Math.max(
      6,
      Number.parseInt(options.nationalDigits || configured.nationalDigits, 10) ||
        configured.nationalDigits
    ),
    zipcode: String(options.zipcode || configured.zipcode),
  };
}

function normalizePhoneParts(phone, profile = DEFAULT_COUNTRY_PROFILE) {
  const dialingCode = String(profile.dialingCode || DEFAULT_COUNTRY_PROFILE.dialingCode).replace(
    /\D+/g,
    ''
  );
  const nationalDigits = Math.max(
    6,
    Number.parseInt(profile.nationalDigits || DEFAULT_COUNTRY_PROFILE.nationalDigits, 10) || 9
  );
  let digits = String(phone || '').replace(/\D+/g, '');
  if (digits.startsWith(dialingCode) && digits.length > nationalDigits) {
    digits = digits.slice(dialingCode.length);
  }
  digits = digits.padEnd(nationalDigits, '5').slice(-nationalDigits);
  return {
    phone: `+${dialingCode}${digits}`,
    maskedPhone: `+${dialingCode}-${digits.slice(0, 3)}-${digits.slice(3)}`,
  };
}

function buildSignupApiPayload(data, options = {}) {
  const dd = normalizeDatePart(data.dd, '01');
  const mm = normalizeDatePart(data.mm, '01');
  const yyyy = normalizeYear(data.yyyy, '2001');
  const countryProfile = resolveCountryProfile(data.country, options);
  const { phone, maskedPhone } = normalizePhoneParts(data.phone, countryProfile);
  const zipcode = String(data.zipcode || process.env.REG_ZIPCODE || countryProfile.zipcode).trim();

  return {
    query: options.query || '',
    signUpFlow: 'full',
    email: data.email,
    password: data.password,
    firstName: data.firstName,
    lastName: data.lastName,
    sex: options.sex || 'M',
    countryId: countryProfile.countryId,
    cityName: data.city,
    address: data.address,
    zipcode,
    dob: `${yyyy}-${mm}-${dd}`,
    isCrypto: false,
    currency: options.currency || process.env.REG_CURRENCY || 'EUR',
    'g-recaptcha-ver': 'turnstile-invisible',
    devMode: false,
    emailStatus: false,
    maskedPhone,
    phone,
    type: 'registration',
    years: true,
    promo: true,
    'g-recaptcha-response': '',
  };
}

function extractErrorMessage(error) {
  return String(error && error.message ? error.message : error || '');
}

function isSignupTurnstileBlockedError(error) {
  const message = extractErrorMessage(error).toLowerCase();
  return (
    message.includes('signup turnstile token not issued') ||
    message.includes('signup captcha gate') ||
    message.includes('signup form not actionable') ||
    (message.includes('cloudflare challenge detected') && message.includes('signup'))
  );
}

async function registerPlayerViaApi({ page, request, data, baseUrl = DEFAULT_BASE_URL, options }) {
  const api = request || (page && page.request);
  if (!api) {
    throw new Error('registerPlayerViaApi requires page or APIRequestContext.');
  }

  const url = new URL('/api/auth/signup', baseUrl).toString();
  const payload = buildSignupApiPayload(data, options);
  const response = await api.post(url, {
    data: payload,
    failOnStatusCode: false,
    timeout: 45000,
  });

  const status = response.status();
  const contentType = response.headers()['content-type'] || '';
  let body = null;
  if (contentType.includes('application/json')) {
    body = await response.json().catch(() => null);
  } else {
    body = await response.text().catch(() => null);
  }

  const ok =
    status === 200 &&
    body &&
    typeof body === 'object' &&
    typeof body.token === 'string' &&
    body.token.length >= 10 &&
    Number.isFinite(Number(body.userId)) &&
    Number(body.userId) > 0;

  const initialResult = {
    ok,
    status,
    url,
    payload,
    body,
  };

  if (ok || !shouldTryCdpTurnstileFallback({ baseUrl, status, body, page })) {
    return initialResult;
  }

  const canReuseCurrentContext = Boolean(
    page &&
    (process.env.PW_CDP_REUSE_CONTEXT === '1' ||
      process.env.PW_CDP_ENDPOINT ||
      process.env.PW_CDP_URL)
  );
  const currentContextResult = canReuseCurrentContext
    ? await registerPlayerViaCurrentContextTurnstile({
        page,
        data,
        baseUrl,
        options,
      })
    : null;
  if (currentContextResult && currentContextResult.ok) return currentContextResult;
  const shouldSpawnIsolatedChrome =
    process.env.PW_SIGNUP_CDP_FALLBACK === '1' || isNixHost(baseUrl) || isStarzinoHost(baseUrl);
  if (currentContextResult && !shouldSpawnIsolatedChrome) {
    return {
      ...initialResult,
      currentContextFallback: currentContextResult,
    };
  }

  const cdpResult = await registerPlayerViaApiWithCdpTurnstile({
    data,
    baseUrl,
    options,
  }).catch((err) => ({
    ok: false,
    status: 0,
    url,
    payload,
    body: {
      errorCode: 'CDP_FALLBACK_FAILED',
      errorMessage: String(err && err.message ? err.message : err),
    },
    source: 'cdp-turnstile',
  }));

  if (cdpResult && cdpResult.ok) return cdpResult;
  return {
    ...initialResult,
    currentContextFallback: currentContextResult,
    cdpFallback: cdpResult,
  };
}

async function applyAuthTokenCookie(context, token, baseUrl = DEFAULT_BASE_URL) {
  const target = new URL(baseUrl);
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
  await context.addCookies([
    {
      name: 'auth._token.local',
      value: String(token || ''),
      domain: target.hostname,
      path: '/',
      secure: target.protocol === 'https:',
      httpOnly: false,
      sameSite: 'Lax',
      expires,
    },
  ]);
}

module.exports = {
  applyAuthTokenCookie,
  buildSignupApiPayload,
  isSignupTurnstileBlockedError,
  normalizePhoneParts,
  resolveCountryProfile,
  validatePlayerSigninViaCdpTurnstile,
  registerPlayerViaApiWithCdpTurnstile,
  registerPlayerViaApi,
};
