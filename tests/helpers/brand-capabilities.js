const { URL } = require('url');

const DEFAULT_CAPABILITIES = {
  optional: {
    casinoSearch: false,
    casinoFilter: false,
    casinoCatalogCards: false,
    liveCasinoRoute: false,
    guestSidebarAuthEntries: false,
    guestSidebarLiveNavigation: false,
    guestSidebarReferral: false,
    guestSidebarSearch: false,
    guestSidebarSportsNavigation: false,
    guestSidebarCollectionsNavigation: false,
    authorizedSidebarPrimaryNavigation: false,
    authorizedSidebarSecondaryNavigation: false,
    authorizedSidebarServiceActions: false,
    guestLiveChatWidgetStates: false,
    guestLiveChatPreChat: false,
    profileBonusDetails: false,
    profileAvatarUpload: false,
    profileDetailsEditing: false,
    profilePreferences: false,
    profilePasswordChange: false,
    withdrawSurface: false,
    authorizedLiveChatComposer: false,
    sidebarLanguageMatrix: false,
    sportsEventDetails: false,
    contractOpenApiSchemas: false,
  },
};

const BRAND_CAPABILITIES = {
  'gt.bet': {
    optional: {
      guestSidebarAuthEntries: true,
      sidebarLanguageMatrix: true,
      sportsEventDetails: true,
    },
  },
  'booms.bet': {
    optional: {
      casinoSearch: true,
      casinoFilter: true,
      casinoCatalogCards: true,
      liveCasinoRoute: true,
      guestSidebarAuthEntries: true,
      guestSidebarLiveNavigation: true,
      guestSidebarReferral: true,
      guestSidebarSearch: true,
      guestSidebarSportsNavigation: true,
      guestSidebarCollectionsNavigation: true,
      authorizedSidebarPrimaryNavigation: true,
      authorizedSidebarSecondaryNavigation: true,
      authorizedSidebarServiceActions: true,
      guestLiveChatWidgetStates: true,
      guestLiveChatPreChat: true,
      profileBonusDetails: true,
      profilePasswordChange: true,
      sidebarLanguageMatrix: true,
      sportsEventDetails: true,
      contractOpenApiSchemas: false,
    },
  },
  'likes.bet': {
    optional: {
      casinoSearch: true,
      casinoFilter: true,
      casinoCatalogCards: true,
      liveCasinoRoute: true,
      guestSidebarAuthEntries: true,
      guestSidebarLiveNavigation: true,
      guestSidebarReferral: true,
      guestSidebarSearch: true,
      guestSidebarSportsNavigation: true,
      guestSidebarCollectionsNavigation: true,
      authorizedSidebarPrimaryNavigation: true,
      authorizedSidebarSecondaryNavigation: true,
      authorizedSidebarServiceActions: true,
      guestLiveChatWidgetStates: true,
      guestLiveChatPreChat: true,
      profileBonusDetails: true,
      sidebarLanguageMatrix: true,
      sportsEventDetails: true,
      contractOpenApiSchemas: true,
    },
  },
  'nix.bet': {
    optional: {
      casinoSearch: true,
      casinoFilter: true,
      casinoCatalogCards: true,
      liveCasinoRoute: true,
      guestSidebarAuthEntries: true,
      guestSidebarLiveNavigation: true,
      guestSidebarReferral: true,
      guestSidebarSearch: true,
      guestSidebarSportsNavigation: true,
      guestSidebarCollectionsNavigation: true,
      authorizedSidebarPrimaryNavigation: true,
      authorizedSidebarSecondaryNavigation: true,
      authorizedSidebarServiceActions: true,
      guestLiveChatWidgetStates: true,
      guestLiveChatPreChat: true,
      profileBonusDetails: true,
      profileAvatarUpload: true,
      profileDetailsEditing: true,
      profilePreferences: true,
      profilePasswordChange: true,
      withdrawSurface: true,
      authorizedLiveChatComposer: true,
      sidebarLanguageMatrix: true,
      sportsEventDetails: true,
      contractOpenApiSchemas: true,
    },
  },
  'igo.bet': {
    optional: {
      casinoSearch: true,
      liveCasinoRoute: true,
      guestSidebarAuthEntries: true,
      guestSidebarLiveNavigation: true,
      guestSidebarReferral: true,
      guestSidebarSearch: true,
      guestSidebarSportsNavigation: true,
      guestSidebarCollectionsNavigation: true,
      authorizedSidebarPrimaryNavigation: true,
      authorizedSidebarSecondaryNavigation: true,
      authorizedSidebarServiceActions: true,
      guestLiveChatWidgetStates: true,
      guestLiveChatPreChat: true,
      profileBonusDetails: true,
      profilePasswordChange: true,
      withdrawSurface: true,
      authorizedLiveChatComposer: true,
      sidebarLanguageMatrix: true,
      sportsEventDetails: true,
      contractOpenApiSchemas: true,
    },
  },
  'chacha.bet': {
    optional: {
      casinoSearch: true,
      liveCasinoRoute: true,
      guestSidebarAuthEntries: true,
      guestSidebarLiveNavigation: true,
      guestSidebarReferral: true,
      guestSidebarSearch: true,
      guestSidebarSportsNavigation: true,
      guestSidebarCollectionsNavigation: true,
      authorizedSidebarPrimaryNavigation: true,
      authorizedSidebarSecondaryNavigation: true,
      authorizedSidebarServiceActions: true,
      guestLiveChatWidgetStates: true,
      guestLiveChatPreChat: true,
      profileBonusDetails: true,
      sidebarLanguageMatrix: true,
      sportsEventDetails: true,
      contractOpenApiSchemas: true,
    },
  },
  'casho.bet': {
    optional: {
      casinoSearch: true,
      casinoFilter: true,
      casinoCatalogCards: true,
      liveCasinoRoute: true,
      guestSidebarAuthEntries: true,
      guestSidebarLiveNavigation: true,
      guestSidebarReferral: true,
      guestSidebarSearch: true,
      guestSidebarSportsNavigation: true,
      guestSidebarCollectionsNavigation: true,
      authorizedSidebarPrimaryNavigation: true,
      authorizedSidebarSecondaryNavigation: true,
      authorizedSidebarServiceActions: true,
      guestLiveChatWidgetStates: true,
      guestLiveChatPreChat: true,
      profileBonusDetails: true,
      sidebarLanguageMatrix: true,
      sportsEventDetails: true,
      contractOpenApiSchemas: true,
    },
  },
  'starzino.com': {
    optional: {
      casinoSearch: true,
      casinoFilter: true,
      casinoCatalogCards: true,
      liveCasinoRoute: true,
      guestSidebarAuthEntries: true,
      guestSidebarLiveNavigation: true,
      guestSidebarReferral: true,
      guestSidebarSearch: true,
      guestSidebarSportsNavigation: true,
      guestSidebarCollectionsNavigation: true,
      authorizedSidebarPrimaryNavigation: true,
      authorizedSidebarSecondaryNavigation: true,
      authorizedSidebarServiceActions: true,
      guestLiveChatWidgetStates: true,
      guestLiveChatPreChat: true,
      profileBonusDetails: true,
      sidebarLanguageMatrix: true,
      sportsEventDetails: true,
      contractOpenApiSchemas: true,
    },
  },
};

const BLOCKED_REASON_CAPABILITY_RULES = [
  {
    key: 'casinoSearch',
    re: /search modal\/input not visible|search.*not visible|search trigger not found/i,
  },
  {
    key: 'casinoFilter',
    re: /filter panel not visible|filter panel failed to open|filter toggle not found|clear button is not available in filter panel/i,
  },
  {
    key: 'casinoCatalogCards',
    re: /no game cards found|catalog entries are unavailable|category chips are not discoverable/i,
  },
  {
    key: 'liveCasinoRoute',
    re: /live casino route is not available in current session|resolved to "\/casino\/?"/i,
  },
  {
    key: 'guestSidebarAuthEntries',
    re: /guest sidebar does not expose explicit login\/signup entries/i,
  },
  {
    key: 'guestSidebarLiveNavigation',
    re: /guest sidebar live navigation:|guest live navigation is not exposed|expected url to include one of: \/liv/i,
  },
  {
    key: 'guestSidebarReferral',
    re: /guest sidebar referral gate:.*guest referral entry is not exposed/i,
  },
  {
    key: 'guestSidebarSearch',
    re: /guest sidebar search:.*guest sidebar search is not exposed/i,
  },
  {
    key: 'guestSidebarSportsNavigation',
    re: /guest sidebar sports navigation:|guest sports navigation is not exposed|sports route did not open after sidebar click/i,
  },
  {
    key: 'guestSidebarCollectionsNavigation',
    re: /guest sidebar collections navigation:|guest collections navigation is not exposed|expected url to include one of: \/collections/i,
  },
  {
    key: 'authorizedSidebarPrimaryNavigation',
    re: /authorized sidebar .*not exposed in current brand layout|authorized sidebar items blocked \(layout\/challenge\)|authorized sidebar primary navigation:.*expected url to include one of:|authorized sidebar primary navigation: mobile route validation is optional/i,
  },
  {
    key: 'authorizedSidebarSecondaryNavigation',
    re: /authorized sidebar secondary navigation: mobile route validation is optional/i,
  },
  {
    key: 'authorizedSidebarServiceActions',
    re: /authorized sidebar service: mobile route validation is optional/i,
  },
  {
    key: 'guestLiveChatWidgetStates',
    re: /live chat widget states are optional|live chat active widget iframe was not exposed|launcher did not expose minimized\/additional widget state/i,
  },
  {
    key: 'guestLiveChatPreChat',
    re: /live chat pre-chat form is not fully visible|live chat minimized widget did not expose explicit reopen control|launcher did not expose minimized\/additional widget state/i,
  },
  {
    key: 'profileBonusDetails',
    re: /profile bonus details are optional|bonuses page is open, but player has no available bonuses to open/i,
  },
  {
    key: 'profileAvatarUpload',
    re: /avatar upload control was not found/i,
  },
  {
    key: 'profileDetailsEditing',
    re: /no editable profile text field found|validation input fields are not visible|profile details route changed during validation/i,
  },
  {
    key: 'profilePreferences',
    re: /no preference control found|settings route exposed no interactive controls/i,
  },
  {
    key: 'profilePasswordChange',
    re: /password inputs are not visible on profile security page|password change controls are not visible/i,
  },
  {
    key: 'withdrawSurface',
    re: /withdraw trigger is not visible in current layout|withdraw surface did not open after trigger click/i,
  },
  {
    key: 'authorizedLiveChatComposer',
    re: /live chat trigger is not visible in current authorized layout|live chat frame did not appear for authorized user|live chat composer\/send controls are unavailable for authorized user/i,
  },
  {
    key: 'sidebarLanguageMatrix',
    re: /language trigger is not visible|language selector should expose more than one option|language matrix should expose at least two languages|language selector exposes fewer than two options|language matrix exposes fewer than two languages/i,
  },
  {
    key: 'sportsEventDetails',
    re: /sports event card is not clickable in current render|event open action was not confirmed|sports event details back action did not change route|could not open event details for odds interaction|could not open event details for betslip control checks|odds-like click did not produce visible betslip\/tracker reaction/i,
  },
  {
    key: 'contractOpenApiSchemas',
    re: /openapi schema was not found|provide qa_auth_openapi_url\/qa_payment_openapi_url|contract checks blocked:.*openapi/i,
  },
];

function resolveHostname(baseUrl = process.env.BASE_URL || 'https://gt.bet/') {
  try {
    return new URL(String(baseUrl || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function mergeCapabilities(hostname = '') {
  const host = String(hostname || '').toLowerCase();
  const brand = BRAND_CAPABILITIES[host] || {};
  const merged = {
    optional: {
      ...DEFAULT_CAPABILITIES.optional,
      ...(brand.optional || {}),
    },
  };
  return merged;
}

function getBrandCapabilities(baseUrl = process.env.BASE_URL || 'https://gt.bet/') {
  return mergeCapabilities(resolveHostname(baseUrl));
}

function inferCapabilityFromBlockedReason(reason) {
  const source = String(reason || '');
  if (!source) return null;
  for (const rule of BLOCKED_REASON_CAPABILITY_RULES) {
    if (rule.re.test(source)) return rule.key;
  }
  return null;
}

function isCapabilityOptionalForBrand(baseUrl, capabilityKey) {
  const capabilities = getBrandCapabilities(baseUrl);
  return Boolean(capabilities.optional && capabilities.optional[capabilityKey] === true);
}

module.exports = {
  DEFAULT_CAPABILITIES,
  BRAND_CAPABILITIES,
  BLOCKED_REASON_CAPABILITY_RULES,
  getBrandCapabilities,
  inferCapabilityFromBlockedReason,
  isCapabilityOptionalForBrand,
};
