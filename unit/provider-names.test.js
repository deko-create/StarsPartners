const assert = require('node:assert/strict');
const test = require('node:test');

const { canonicalProviderName, providerNamesMatch } = require('../tests/helpers/provider-names');

test('matches provider display names to platform route aliases', () => {
  assert.equal(providerNamesMatch('3 Oaks Gaming', '3oaksgaming'), true);
  assert.equal(providerNamesMatch("Play'n Go", 'playngo'), true);
  assert.equal(providerNamesMatch('Tom Horn Gaming', 'tomhorngaming'), true);
  assert.equal(providerNamesMatch('155', 'onefivefive'), true);
  assert.equal(providerNamesMatch('Absolute Live Gaming', 'alg'), true);
  assert.equal(providerNamesMatch('Fugaso', 'groove'), true);
  assert.equal(providerNamesMatch('True Lab', 'True Labs'), true);
});

test('does not collapse unrelated provider names', () => {
  assert.equal(providerNamesMatch('Fugaso', 'Novomatic'), false);
  assert.equal(canonicalProviderName('Pragmatic Play'), 'pragmatic play');
});
