const fs = require('fs');

const AUTH_TOKEN_NAMES = new Set([
  'auth._token.local',
  'auth_token',
  'authtoken',
  'access_token',
  'accesstoken',
  'id_token',
  'idtoken',
  'sso',
  'sso_id_token',
  'sso_refresh_token',
  'sso_logged_in',
]);
const WAF_COOKIE_NAMES = new Set(['cf_clearance', '__cf_bm', '__cflb', 'cf_chl_2']);

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isUsableCookie(cookie, nowMs = Date.now()) {
  if (!cookie || !String(cookie.value || '').trim()) return false;
  const expires = Number(cookie.expires || 0);
  return !Number.isFinite(expires) || expires <= 0 || expires * 1000 > nowMs + 30_000;
}

function isAuthTokenName(value) {
  const name = normalizeName(value);
  return (
    AUTH_TOKEN_NAMES.has(name) ||
    /^auth[._-].*token(?:[._-].*)?$/.test(name) ||
    /^auth_session(?:[._-].*)?$/.test(name)
  );
}

function analyzeStorageStatePayload(payload, nowMs = Date.now()) {
  const cookies = Array.isArray(payload && payload.cookies) ? payload.cookies : [];
  const origins = Array.isArray(payload && payload.origins) ? payload.origins : [];
  const authCookies = cookies.filter(
    (cookie) => isAuthTokenName(cookie && cookie.name) && isUsableCookie(cookie, nowMs)
  );
  const wafCookies = cookies.filter(
    (cookie) =>
      WAF_COOKIE_NAMES.has(normalizeName(cookie && cookie.name)) && isUsableCookie(cookie, nowMs)
  );
  const authStorageEntries = origins.flatMap((origin) =>
    (Array.isArray(origin && origin.localStorage) ? origin.localStorage : []).filter(
      (entry) =>
        isAuthTokenName(entry && entry.name) &&
        String(entry && entry.value ? entry.value : '').trim()
    )
  );

  return {
    cookiesCount: cookies.length,
    originsCount: origins.length,
    authCookiesCount: authCookies.length,
    authStorageEntriesCount: authStorageEntries.length,
    wafCookiesCount: wafCookies.length,
    hasAuthArtifacts: authCookies.length > 0 || authStorageEntries.length > 0,
    hasWafArtifacts: wafCookies.length > 0,
    hasSessionArtifacts: cookies.length > 0 || origins.length > 0,
  };
}

function readStorageStatePayload(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function mergeStorageStatePayload(preservedPayload, freshPayload) {
  const preserved =
    preservedPayload && typeof preservedPayload === 'object' ? preservedPayload : {};
  const fresh = freshPayload && typeof freshPayload === 'object' ? freshPayload : {};
  const cookies = new Map();
  for (const cookie of [
    ...(Array.isArray(preserved.cookies) ? preserved.cookies : []),
    ...(Array.isArray(fresh.cookies) ? fresh.cookies : []),
  ]) {
    if (!cookie || !cookie.name) continue;
    const key = [cookie.name, cookie.domain || '', cookie.path || '/'].join('\u0000');
    const existing = cookies.get(key);
    if (
      existing &&
      isAuthTokenName(cookie.name) &&
      isUsableCookie(existing) &&
      !isUsableCookie(cookie)
    ) {
      continue;
    }
    cookies.set(key, cookie);
  }

  const origins = new Map();
  for (const originEntry of [
    ...(Array.isArray(preserved.origins) ? preserved.origins : []),
    ...(Array.isArray(fresh.origins) ? fresh.origins : []),
  ]) {
    if (!originEntry || !originEntry.origin) continue;
    const existing = origins.get(originEntry.origin);
    const localStorage = new Map();
    for (const item of [
      ...(existing && Array.isArray(existing.localStorage) ? existing.localStorage : []),
      ...(Array.isArray(originEntry.localStorage) ? originEntry.localStorage : []),
    ]) {
      if (item && item.name) localStorage.set(item.name, item);
    }
    origins.set(originEntry.origin, {
      ...(existing || {}),
      ...originEntry,
      localStorage: [...localStorage.values()],
    });
  }

  return {
    ...preserved,
    ...fresh,
    cookies: [...cookies.values()],
    origins: [...origins.values()],
  };
}

function readAuthStateMeta(filePath, index) {
  if (!filePath || !fs.existsSync(filePath)) return null;

  let mtimeMs = 0;
  let sizeBytes = 0;
  try {
    const stat = fs.statSync(filePath);
    mtimeMs = Number(stat.mtimeMs || 0);
    sizeBytes = Number(stat.size || 0);
  } catch {
    // best-effort metadata
  }

  const payload = readStorageStatePayload(filePath);
  const parseError = !payload;
  const analysis = analyzeStorageStatePayload(payload);

  return {
    filePath,
    index,
    mtimeMs,
    sizeBytes,
    ...analysis,
    parseError,
  };
}

function compareAuthStateMeta(left, right) {
  if (left.hasAuthArtifacts !== right.hasAuthArtifacts) {
    return left.hasAuthArtifacts ? -1 : 1;
  }
  if (left.hasSessionArtifacts !== right.hasSessionArtifacts) {
    return left.hasSessionArtifacts ? -1 : 1;
  }
  if (left.parseError !== right.parseError) {
    return left.parseError ? 1 : -1;
  }
  if (left.mtimeMs !== right.mtimeMs) {
    return right.mtimeMs - left.mtimeMs;
  }
  if (left.sizeBytes !== right.sizeBytes) {
    return right.sizeBytes - left.sizeBytes;
  }
  return left.index - right.index;
}

function pickBestAuthStatePath(candidates) {
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .map((filePath, index) => readAuthStateMeta(filePath, index))
    .filter(Boolean);
  if (!ranked.length) return null;

  ranked.sort(compareAuthStateMeta);
  const preferred =
    ranked.find((entry) => entry.hasAuthArtifacts && !entry.parseError) ||
    ranked.find((entry) => entry.hasSessionArtifacts && !entry.parseError) ||
    ranked.find((entry) => !entry.parseError) ||
    ranked[0];
  return preferred ? preferred.filePath : null;
}

module.exports = {
  analyzeStorageStatePayload,
  compareAuthStateMeta,
  isAuthTokenName,
  mergeStorageStatePayload,
  pickBestAuthStatePath,
  readAuthStateMeta,
  readStorageStatePayload,
};
