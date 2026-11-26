const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  createCdpBrowserFacade,
  isCloudflareCookie,
  replaceApplicationCookies,
  resolveCdpUserAgent,
} = require('../tests/helpers/cdp-reuse-context');

function cookie(name, domain = '.booms.bet') {
  return { name, value: `${name}-value`, domain, path: '/', secure: true };
}

test('recognizes only Cloudflare session cookies as protected', () => {
  assert.equal(isCloudflareCookie(cookie('cf_clearance')), true);
  assert.equal(isCloudflareCookie(cookie('__CF_BM')), true);
  assert.equal(isCloudflareCookie(cookie('auth._token.local', 'booms.bet')), false);
});

test('replaces application cookies while preserving current Cloudflare clearance', async () => {
  let cookies = [cookie('cf_clearance'), cookie('__cf_bm'), cookie('old-app-cookie', 'booms.bet')];
  const context = {
    cookies: async () => cookies,
    clearCookies: async (filter = {}) => {
      cookies = cookies.filter(
        (item) =>
          !(
            (!filter.name || item.name === filter.name) &&
            (!filter.domain || item.domain === filter.domain) &&
            (!filter.path || item.path === filter.path)
          )
      );
    },
    addCookies: async (items) => {
      cookies.push(...items);
    },
  };

  await replaceApplicationCookies(context, {
    cookies: [cookie('cf_clearance'), cookie('auth._token.local', 'booms.bet')],
    origins: [],
  });

  assert.deepEqual(cookies.map((item) => item.name).sort(), [
    '__cf_bm',
    'auth._token.local',
    'cf_clearance',
  ]);
  assert.equal(cookies.find((item) => item.name === 'cf_clearance').value, 'cf_clearance-value');
});

test('empty guest state clears app auth but keeps Cloudflare clearance', async () => {
  let cookies = [
    cookie('cf_clearance'),
    cookie('__cf_bm'),
    cookie('auth._token.local', 'booms.bet'),
  ];
  const context = {
    cookies: async () => cookies,
    clearCookies: async (filter = {}) => {
      cookies = cookies.filter(
        (item) =>
          !(
            (!filter.name || item.name === filter.name) &&
            (!filter.domain || item.domain === filter.domain) &&
            (!filter.path || item.path === filter.path)
          )
      );
    },
    addCookies: async (items) => {
      cookies.push(...items);
    },
  };

  await replaceApplicationCookies(context, { cookies: [], origins: [] });

  assert.deepEqual(cookies.map((item) => item.name).sort(), ['__cf_bm', 'cf_clearance']);
});

test('CDP browser facade never closes the supervisor-owned browser', async () => {
  let browserClosed = false;
  const browser = {
    close: async () => {
      browserClosed = true;
    },
    isConnected: () => true,
  };
  const context = {};
  const facade = createCdpBrowserFacade(browser, context, { baseUrl: 'https://booms.bet/' });

  await facade.close();

  assert.equal(browserClosed, false);
  assert.equal(facade.isConnected(), true);
  assert.deepEqual(facade.contexts(), [context]);
});

test('CDP mobile emulation preserves the native Chrome user agent by default', () => {
  const previousReuse = process.env.PW_CDP_REUSE_CONTEXT;
  const previousNativeUserAgent = process.env.PW_USER_AGENT;
  const previousPreserve = process.env.PW_CDP_PRESERVE_USER_AGENT;
  try {
    process.env.PW_CDP_REUSE_CONTEXT = '1';
    process.env.PW_USER_AGENT = 'Native Chrome UA';
    delete process.env.PW_CDP_PRESERVE_USER_AGENT;

    assert.equal(resolveCdpUserAgent({ userAgent: 'Mobile Safari UA' }), 'Native Chrome UA');

    process.env.PW_CDP_PRESERVE_USER_AGENT = '0';
    assert.equal(resolveCdpUserAgent({ userAgent: 'Mobile Safari UA' }), 'Mobile Safari UA');
  } finally {
    if (previousReuse === undefined) delete process.env.PW_CDP_REUSE_CONTEXT;
    else process.env.PW_CDP_REUSE_CONTEXT = previousReuse;
    if (previousNativeUserAgent === undefined) delete process.env.PW_USER_AGENT;
    else process.env.PW_USER_AGENT = previousNativeUserAgent;
    if (previousPreserve === undefined) delete process.env.PW_CDP_PRESERVE_USER_AGENT;
    else process.env.PW_CDP_PRESERVE_USER_AGENT = previousPreserve;
  }
});
