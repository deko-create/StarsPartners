const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildSignupApiPayload,
  normalizePhoneParts,
  resolveCountryProfile,
} = require('../tests/helpers/signup-api-fallback');

test('Spain signup payload keeps country and phone metadata consistent', () => {
  const payload = buildSignupApiPayload({
    email: 'qa@example.test',
    password: 'Example1!',
    firstName: 'QA',
    lastName: 'Player',
    country: 'Spain',
    city: 'Madrid',
    address: 'Calle Test 1',
    phone: '612345678',
    dd: '01',
    mm: '01',
    yyyy: '2001',
  });

  assert.equal(payload.countryId, 171);
  assert.equal(payload.phone, '+34612345678');
  assert.equal(payload.maskedPhone, '+34-612-345678');
  assert.equal(payload.zipcode, '28001');
});

test('phone normalization removes an existing country prefix without duplicating it', () => {
  const profile = resolveCountryProfile('España');
  assert.deepEqual(normalizePhoneParts('+34 612 345 678', profile), {
    phone: '+34612345678',
    maskedPhone: '+34-612-345678',
  });
});

test('registration data generates an E.164 Spanish mobile number by default', () => {
  const { createRegistrationData } = require('../tests/helpers/registration-data');
  const data = createRegistrationData({ env: {} });
  assert.match(data.phone, /^\+346\d{8}$/);
});
