const PROVIDER_ALIASES = new Map(
  Object.entries({
    // Provider route/API identifiers used by the shared casino platform.
    155: 'onefivefive',
    'absolute live gaming': 'alg',
    fugaso: 'groove',
    'true lab': 'true labs',
  }).map(([name, canonical]) => [normalizeRaw(name), normalizeRaw(canonical)])
);

function normalizeRaw(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalProviderName(value) {
  const normalized = normalizeRaw(value);
  return PROVIDER_ALIASES.get(normalized) || normalized;
}

function providerNamesMatch(left, right) {
  const normalizedLeft = canonicalProviderName(left);
  const normalizedRight = canonicalProviderName(right);
  if (!normalizedLeft || !normalizedRight) return false;
  const compactLeft = normalizedLeft.replace(/[^a-z0-9]/g, '');
  const compactRight = normalizedRight.replace(/[^a-z0-9]/g, '');
  return (
    compactLeft === compactRight ||
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

module.exports = {
  canonicalProviderName,
  providerNamesMatch,
};
