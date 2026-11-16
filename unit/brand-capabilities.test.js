const test = require('node:test');
const assert = require('node:assert/strict');

const {
  inferCapabilityFromBlockedReason,
  isCapabilityOptionalForBrand,
} = require('../tests/helpers/brand-capabilities');

test('maps a missing guest Live link to the optional sidebar capability', () => {
  const reason =
    'Guest sidebar live navigation: Live: Guest live navigation is not exposed in current brand layout.';

  assert.equal(inferCapabilityFromBlockedReason(reason), 'guestSidebarLiveNavigation');
  assert.equal(
    isCapabilityOptionalForBrand('https://chacha.bet/', 'guestSidebarLiveNavigation'),
    true
  );
});

test('maps a missing language trigger to the optional language capability', () => {
  const reason = 'Language trigger is not visible in guest sidebar in current brand layout.';

  assert.equal(inferCapabilityFromBlockedReason(reason), 'sidebarLanguageMatrix');
  assert.equal(isCapabilityOptionalForBrand('https://chacha.bet/', 'sidebarLanguageMatrix'), true);
});

test('maps Nix profile, withdraw and authorized chat gaps to explicit optional capabilities', () => {
  const cases = [
    ['Avatar upload control was not found on Account page.', 'profileAvatarUpload'],
    ['No editable profile text field found.', 'profileDetailsEditing'],
    ['No preference control found for persistence check.', 'profilePreferences'],
    ['Password inputs are not visible on profile security page.', 'profilePasswordChange'],
    ['Withdraw trigger is not visible in current layout.', 'withdrawSurface'],
    [
      'Live chat composer/send controls are unavailable for authorized user.',
      'authorizedLiveChatComposer',
    ],
  ];

  for (const [reason, expectedCapability] of cases) {
    assert.equal(inferCapabilityFromBlockedReason(reason), expectedCapability);
    assert.equal(isCapabilityOptionalForBrand('https://nix.bet/', expectedCapability), true);
  }
});

test('maps current IGO layout gaps to explicit optional capabilities', () => {
  for (const capability of [
    'profilePasswordChange',
    'withdrawSurface',
    'authorizedLiveChatComposer',
  ]) {
    assert.equal(isCapabilityOptionalForBrand('https://igo.bet/', capability), true);
  }
});

test('Casho guest Intercom chat is covered instead of treated as optional', () => {
  assert.equal(
    isCapabilityOptionalForBrand('https://casho.bet/', 'guestLiveChatWidgetStates'),
    false
  );
  assert.equal(isCapabilityOptionalForBrand('https://casho.bet/', 'guestLiveChatPreChat'), false);
});
