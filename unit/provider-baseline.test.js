const assert = require('node:assert/strict');
const test = require('node:test');

const { getBaselineProviders } = require('../tests/helpers/provider-baseline');

test('booms provider baseline covers the discovered inventory without the legacy swntt typo', () => {
  const providers = getBaselineProviders('https://booms.bet/');

  assert.equal(providers.length, 69);
  assert.equal(providers.includes('Swintt'), true);
  assert.equal(providers.includes('swntt'), false);
  assert.equal(providers.includes('Pragmatic Play'), true);
  assert.equal(providers.includes('Winfinity'), true);
  assert.equal(providers.includes('Megafair'), true);
  assert.equal(providers.includes('altente'), true);
  assert.equal(providers.includes("Play'n Go"), false);
  assert.equal(providers.includes('Thunderkick'), false);
  assert.equal(new Set(providers.map((provider) => provider.toLowerCase())).size, providers.length);
});

test('igo provider baseline covers the complete current inventory', () => {
  const providers = getBaselineProviders('https://igo.bet/');
  const expected = [
    'Pragmatic Play',
    'NetEnt',
    'Nolimit City',
    'Relax Gaming',
    'Big Time Gaming',
    'Red Tiger',
    'Shady Lady',
    'Habanero',
    'Smartsoft',
    'Absolute Live Gaming',
  ];

  for (const provider of expected) {
    assert.equal(providers.includes(provider), true, `${provider} should be covered`);
  }
  assert.equal(providers.length, 64);
  assert.equal(new Set(providers.map((provider) => provider.toLowerCase())).size, providers.length);
});

test('gt provider baseline covers the complete current inventory', () => {
  const providers = getBaselineProviders('https://gt.bet/');
  const expected = [
    '3 Oaks Gaming',
    'Absolute Live Gaming',
    'Big Time Gaming',
    'Hacksaw Gaming',
    'NetEnt',
    'Nolimit City',
    'PlayTech',
    'Pragmatic Play',
    'Red Tiger',
    'Relax Gaming',
    'sneakyslots',
  ];

  for (const provider of expected) {
    assert.equal(providers.includes(provider), true, `${provider} should be covered`);
  }
  assert.equal(providers.length, 57);
  assert.equal(new Set(providers.map((provider) => provider.toLowerCase())).size, providers.length);
});
