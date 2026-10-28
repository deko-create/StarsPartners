const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const { resolveLaunchUserAgent } = require('../scripts/qa-cdp-run');

const ENV_KEYS = [
  'QA_EXECUTION_MODE',
  'PW_PROJECT_MATRIX',
  'PW_CDP_USER_AGENT',
  'PW_MOBILE_USER_AGENT',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test('uses a mobile Chrome user agent when the CDP run is mobile', () => {
  process.env.QA_EXECUTION_MODE = 'mobile';
  delete process.env.PW_CDP_USER_AGENT;
  delete process.env.PW_MOBILE_USER_AGENT;

  const userAgent = resolveLaunchUserAgent();

  assert.match(userAgent, /Android/i);
  assert.match(userAgent, /Mobile/i);
  assert.match(userAgent, /Chrome/i);
});

test('does not override the native Chrome user agent for desktop CDP runs', () => {
  process.env.QA_EXECUTION_MODE = 'desktop';
  delete process.env.PW_CDP_USER_AGENT;

  assert.equal(resolveLaunchUserAgent(), '');
});

test('honors an explicit CDP launch user agent', () => {
  process.env.QA_EXECUTION_MODE = 'mobile';
  process.env.PW_CDP_USER_AGENT = 'QA explicit user agent';

  assert.equal(resolveLaunchUserAgent(), 'QA explicit user agent');
});
