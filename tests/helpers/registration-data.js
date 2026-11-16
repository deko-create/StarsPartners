const { faker } = require('@faker-js/faker');

function formatDateTagForDisplay(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function sanitizeEmailDateTag(value) {
  const digitsOnly = String(value || '').replace(/\D+/g, '');
  if (digitsOnly) return digitsOnly;
  return formatDateTagForDisplay().replace(/\D+/g, '');
}

function formatTimeTagForEmail(date = new Date()) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}${mm}${ss}`;
}

function withAutotestTag(value) {
  const clean = String(value || '').trim();
  if (!clean) return 'autotest';
  if (/autotest/i.test(clean)) return clean;
  return `${clean}autotest`;
}

function buildRuntimePassword() {
  const uniqueTag = `${Date.now().toString(36)}${faker.string.alphanumeric(6)}`;
  return `Qa!${uniqueTag}A7`;
}

function sanitizeEmailSuffix(value, maxLength = 12) {
  const clean = String(value || '')
    .trim()
    .toLowerCase();
  if (!clean) return '';
  const normalized = clean
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/[-._]{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
  if (!normalized) return '';
  return normalized.slice(0, Math.max(1, Number(maxLength) || 12));
}

function buildRegistrationEmail(options = {}) {
  const env = options.env || process.env;
  if (env.REG_EMAIL) return String(env.REG_EMAIL).toLowerCase();

  const dateTagRaw = options.emailDate || env.REG_EMAIL_DATE || formatDateTagForDisplay();
  const suffix = sanitizeEmailSuffix(
    options.emailSuffix || env.REG_EMAIL_SUFFIX || formatTimeTagForEmail(),
    8
  );
  const fallbackTag = sanitizeEmailDateTag(dateTagRaw).slice(0, 6);
  const compactTag = suffix || fallbackTag || formatTimeTagForEmail();
  const emailFormat = String(options.emailFormat || env.REG_EMAIL_FORMAT || 'plus')
    .trim()
    .toLowerCase();
  if (emailFormat === 'plus') {
    return `deko+${compactTag}@stars-partners.com`.toLowerCase();
  }
  return `deko${compactTag}@stars-partners.com`.toLowerCase();
}

function createRegistrationData(options = {}) {
  const env = options.env || process.env;

  const firstName = withAutotestTag(
    options.firstName || env.REG_FIRST_NAME || faker.person.firstName()
  );
  const lastName = withAutotestTag(
    options.lastName || env.REG_LAST_NAME || faker.person.lastName()
  );
  const city = options.city || env.REG_CITY || faker.location.city();
  const address = options.address || env.REG_ADDRESS || faker.location.streetAddress();

  const country = options.country || env.REG_COUNTRY || 'Spain';
  const defaultPhone = /^spain$/i.test(country)
    ? `+346${faker.string.numeric(8)}`
    : faker.string.numeric(10);

  return {
    email: buildRegistrationEmail(options),
    emailDateDisplay: options.emailDate || env.REG_EMAIL_DATE || formatDateTagForDisplay(),
    password: options.password || env.REG_PASSWORD || buildRuntimePassword(),
    firstName,
    lastName,
    country,
    city,
    address,
    dd: options.dd || env.REG_DD || '01',
    mm: options.mm || env.REG_MM || '01',
    yyyy: options.yyyy || env.REG_YYYY || '2001',
    phone: options.phone || env.REG_PHONE || defaultPhone,
  };
}

function maskValue(value, keep = 2) {
  if (!value) return '';
  if (value.length <= keep) return '*'.repeat(value.length);
  return `${value.slice(0, keep)}${'*'.repeat(value.length - keep)}`;
}

module.exports = {
  buildRegistrationEmail,
  buildRuntimePassword,
  createRegistrationData,
  formatDateTagForDisplay,
  formatTimeTagForEmail,
  maskValue,
  sanitizeEmailDateTag,
  withAutotestTag,
};
