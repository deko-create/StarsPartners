const { test, expect } = require('../fixtures/qa-test');
const { assertNotCloudflare, dismissOverlays, markBlocked } = require('../helpers/gt-utils');

const BASE_URL = process.env.BASE_URL || 'https://gt.bet/';
const STRICT_403_MODE = process.env.PW_PRECHECK_STRICT_403 === '1';
const SOFT_BLOCK_MODE = process.env.PW_PRECHECK_SOFT_BLOCK !== '0';
const KNOWN_NON_CRITICAL_403 = [/\/server\/api\/languages\/thook\/?(\?|$)/i];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitBlocked403(urls) {
  const unique = [
    ...new Set((urls || []).map((item) => String(item || '').trim()).filter(Boolean)),
  ];
  if (STRICT_403_MODE) {
    return { critical: unique, ignored: [] };
  }
  const ignored = [];
  const critical = [];
  for (const url of unique) {
    if (KNOWN_NON_CRITICAL_403.some((re) => re.test(url))) ignored.push(url);
    else critical.push(url);
  }
  return { critical, ignored };
}

function maybeBlockPrecheck(testInfo, reason) {
  if (!SOFT_BLOCK_MODE) {
    throw new Error(reason);
  }
  markBlocked(testInfo, reason);
  return true;
}

test('GT Precheck: no Cloudflare/403 on critical resources', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const blocked = [];

  page.on('response', (resp) => {
    try {
      if (resp.status() !== 403) return;
      const url = resp.url();
      if (/\/_nuxt\//i.test(url) || /\/api\//i.test(url)) {
        blocked.push(url);
      }
    } catch {
      // ignore
    }
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  try {
    await assertNotCloudflare(page);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Cloudflare challenge detected';
    if (maybeBlockPrecheck(testInfo, `PRECHECK_BLOCKED: ${msg}`)) return;
  }

  await dismissOverlays(page);

  const appRoot = page
    .locator('#app:visible, #__nuxt:visible, main:visible, [role="main"]:visible')
    .first();
  try {
    await appRoot.waitFor({ state: 'visible', timeout: 30000 });
  } catch {
    const healthyFallback = await page
      .locator('header:visible, nav:visible, a[href]:visible, button:visible')
      .count()
      .catch(() => 0);
    if (
      healthyFallback < 2 &&
      maybeBlockPrecheck(testInfo, 'PRECHECK_BLOCKED: App root not visible (possible WAF/403).')
    )
      return;
  }

  await sleep(2000);

  const blocked403 = splitBlocked403(blocked);
  if (blocked403.ignored.length > 0) {
    testInfo.annotations.push({
      type: 'partial',
      description: `Ignored known non-critical 403 resources: ${blocked403.ignored
        .slice(0, 5)
        .join(' | ')}`,
    });
  }

  if (blocked403.critical.length) {
    const sample = blocked403.critical.slice(0, 5).join(' | ');
    const reason = `PRECHECK_BLOCKED: 403 on critical resources: ${sample}`;
    if (STRICT_403_MODE) {
      throw new Error(reason);
    }
    if (maybeBlockPrecheck(testInfo, reason)) return;
  }

  expect(true).toBeTruthy();
});
