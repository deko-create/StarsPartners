const { expect } = require('@playwright/test');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
}

function exactTextRegex(value) {
  return new RegExp(`^\\s*${escapeRegExp(String(value))}\\s*$`, 'i');
}

function monthNames(mm) {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const idx = Number(mm) - 1;
  if (!Number.isFinite(idx) || idx < 0 || idx >= months.length) return [];
  return [months[idx], months[idx].slice(0, 3)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function debugSignup(message) {
  if (process.env.PW_DEBUG_SIGNUP === '1') console.log(`[signup-debug] ${message}`);
}

const CONTINUE_BUTTON_SELECTORS = [
  'button:has-text("CONTINUE")',
  'button:has-text("Continue")',
  'button:has-text("Продолжить")',
  'button:has-text("Продовжити")',
  'button:has-text("Continuar")',
  'button:has-text("Continuer")',
  'button:has-text("Continua")',
  'button:has-text("Weiter")',
  'button:has-text("Συνέχεια")',
  'button:has-text("Next")',
  'button:has-text("Confirm")',
  '[data-testid*="continue" i]',
  '[data-testid*="next" i]',
  '[data-testid="proceed-button"]',
  'button[type="submit"]:not([data-testid="login-button"])',
  'input[type="submit"]',
];

class SignupRegistrationPage {
  constructor(page, container) {
    this.page = page;
    this.container = container;
  }

  setContainer(container) {
    this.container = container;
    return this;
  }

  getContainer() {
    if (!this.container) {
      throw new Error('SignupRegistrationPage: container is not set.');
    }
    return this.container;
  }

  addNote(annotate, description) {
    if (typeof annotate === 'function' && description) annotate(description);
  }

  async fillFirstVisible(selectors, value) {
    const container = this.getContainer();
    for (const selector of selectors) {
      const inputs = container.locator(selector);
      const count = Math.min(await inputs.count().catch(() => 0), 12);
      for (let index = 0; index < count; index += 1) {
        const input = inputs.nth(index);
        try {
          if (await input.isVisible()) {
            await input.fill(value);
            return true;
          }
        } catch {
          // try next matching input
        }
      }
    }
    return false;
  }

  async findActionButton(selectors) {
    const container = this.getContainer();
    for (const selector of selectors) {
      const buttons = container.locator(selector);
      const count = Math.min(await buttons.count().catch(() => 0), 12);
      for (let index = 0; index < count; index += 1) {
        const btn = buttons.nth(index);
        try {
          if (await btn.isVisible()) {
            return btn;
          }
        } catch {
          // try next matching button
        }
      }
    }
    return null;
  }

  async listVisibleButtons() {
    const container = this.getContainer();
    try {
      const buttons = container.locator('button:visible, input[type="submit"]:visible');
      const count = await buttons.count();
      const labels = [];
      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        const text = (await btn.innerText().catch(() => '')).trim();
        const aria = (await btn.getAttribute('aria-label').catch(() => '')).trim();
        const value = (await btn.getAttribute('value').catch(() => '')).trim();
        labels.push(text || aria || value || 'button');
      }
      return labels;
    } catch {
      return [];
    }
  }

  async acceptTermsIfPresent() {
    const container = this.getContainer();
    const requiredCheckboxCandidates = [
      '[data-testid="years-checkbox"]:not(.t-checkbox_checked)',
      '.t-signup__checkbox_years:not(.t-checkbox_checked)',
    ];

    for (const selector of requiredCheckboxCandidates) {
      const checkbox = container.locator(selector).first();
      try {
        if (await checkbox.isVisible()) {
          await checkbox.click();
          return;
        }
      } catch {
        // ignore
      }
    }

    const labelCandidates = [
      'label:has-text("I agree")',
      'label:has-text("I accept")',
      'label:has-text("Terms")',
      'label:has-text("Privacy")',
      'label:has-text("Rules")',
    ];

    for (const selector of labelCandidates) {
      const label = container.locator(selector).first();
      try {
        if (await label.isVisible()) {
          await label.click();
          return;
        }
      } catch {
        // ignore
      }
    }

    try {
      const checkbox = container
        .locator(
          '[data-testid="years-checkbox"] input[type="checkbox"], .t-signup__checkbox_years input[type="checkbox"]'
        )
        .first();
      if (await checkbox.isVisible()) {
        const checked = await checkbox.isChecked().catch(() => false);
        if (!checked) {
          await checkbox.click({ force: true });
        }
      }
    } catch {
      // ignore
    }
  }

  async hasCaptchaGate() {
    const container = this.getContainer();
    const selectors = [
      '.t-cloudflare-captcha',
      '#captcha',
      'iframe[src*="turnstile"]',
      '.cf-turnstile',
      'input[name="cf-turnstile-response"]',
    ];

    for (const selector of selectors) {
      const visible = await container
        .locator(selector)
        .first()
        .isVisible({ timeout: 300 })
        .catch(() => false);
      if (visible) return true;
    }

    return this.page
      .getByText(/verify you are human/i)
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);
  }

  async getTurnstileState() {
    const container = this.getContainer();
    const tokenLocator = container.locator('input[name="cf-turnstile-response"]').first();
    const inputCount = await container
      .locator('input[name="cf-turnstile-response"]')
      .count()
      .catch(() => 0);
    const inputVisible =
      inputCount > 0 ? await tokenLocator.isVisible({ timeout: 300 }).catch(() => false) : false;
    const tokenValue = inputCount > 0 ? await tokenLocator.inputValue().catch(() => '') : '';
    const iframeVisible = await container
      .locator('iframe[src*="turnstile"], iframe[title*="Cloudflare"], .cf-turnstile')
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);

    return {
      inputCount,
      inputVisible,
      tokenLen: String(tokenValue || '').trim().length,
      iframeVisible,
    };
  }

  async waitForTurnstileToken(options = {}) {
    const timeoutMs =
      Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 20000;
    const pollMs = Number.isFinite(options.pollMs) && options.pollMs > 0 ? options.pollMs : 1000;
    const deadline = Date.now() + timeoutMs;
    let state = await this.getTurnstileState();

    while (Date.now() < deadline) {
      if (state.inputCount > 0 && state.tokenLen > 0) {
        return { tokenReady: true, state };
      }
      await sleep(pollMs);
      state = await this.getTurnstileState();
    }

    return {
      tokenReady: state.inputCount > 0 && state.tokenLen > 0,
      state,
    };
  }

  async clickTurnstileWidget() {
    const scopes = [this.getContainer(), this.page];
    const selectors = [
      'iframe[src*="challenges.cloudflare.com"]',
      'iframe[src*="turnstile"]',
      'iframe[title*="Cloudflare"]',
      'iframe[title*="challenge" i]',
    ];

    for (const scope of scopes) {
      for (const selector of selectors) {
        const frameLocator = scope.locator(selector).first();
        const visible = await frameLocator.isVisible({ timeout: 400 }).catch(() => false);
        if (!visible) continue;

        const frameHandle = await frameLocator.elementHandle().catch(() => null);
        if (!frameHandle) continue;

        const frame = await frameHandle.contentFrame().catch(() => null);
        if (frame) {
          const checkbox = frame.locator('input[type="checkbox"], [role="checkbox"]').first();
          const checkboxVisible = await checkbox.isVisible({ timeout: 500 }).catch(() => false);
          if (checkboxVisible) {
            await checkbox.click({ force: true, timeout: 2000 }).catch(() => null);
            return true;
          }
        }

        const box = await frameHandle.boundingBox().catch(() => null);
        if (!box) continue;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await this.page.mouse.move(x, y, { steps: 8 }).catch(() => null);
        await this.page.mouse.click(x, y, { delay: 120 }).catch(() => null);
        return true;
      }
    }

    return false;
  }

  async executeTurnstile() {
    return this.page
      .evaluate(async () => {
        const turnstile = window.turnstile;
        const tokenInput = document.querySelector('input[name="cf-turnstile-response"]');
        const readTokenLen = () =>
          tokenInput && typeof tokenInput.value === 'string' ? tokenInput.value.trim().length : 0;
        if (!turnstile || typeof turnstile.execute !== 'function') {
          return {
            available: false,
            executed: 0,
            tokenLen: readTokenLen(),
          };
        }

        const candidates = Array.from(
          document.querySelectorAll(
            '.cf-turnstile, [id*="turnstile"], [class*="turnstile"], [data-sitekey]'
          )
        ).slice(0, 8);

        let executed = 0;
        for (const node of candidates) {
          try {
            turnstile.execute(node);
            executed += 1;
          } catch {
            // ignore
          }
          const nodeId = String(node && node.id ? node.id : '').trim();
          if (nodeId) {
            try {
              turnstile.execute(nodeId);
              executed += 1;
            } catch {
              // ignore
            }
          }
        }

        if (executed === 0) {
          try {
            turnstile.execute();
            executed += 1;
          } catch {
            // ignore
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 1200));
        return {
          available: true,
          executed,
          tokenLen: readTokenLen(),
        };
      })
      .catch(() => ({
        available: false,
        executed: 0,
        tokenLen: 0,
      }));
  }

  async resolveTurnstileToken(annotate) {
    const before = await this.getTurnstileState();
    if (before.inputCount < 1 || before.tokenLen > 0) {
      return { tokenReady: before.tokenLen > 0, state: before };
    }

    const executed = await this.executeTurnstile();
    this.addNote(
      annotate,
      `Turnstile execute attempt: available=${executed.available}, executed=${executed.executed}, tokenLen=${executed.tokenLen}`
    );

    let waited = await this.waitForTurnstileToken({ timeoutMs: 9000, pollMs: 900 });
    if (waited.tokenReady) return waited;

    const clicked = await this.clickTurnstileWidget();
    this.addNote(annotate, `Turnstile click attempt: clicked=${String(clicked)}`);
    if (clicked) {
      waited = await this.waitForTurnstileToken({ timeoutMs: 12000, pollMs: 900 });
    }

    return waited;
  }

  async fillEmptyTextInputs(values, opts = {}) {
    const { skipCountry = false } = opts;
    const container = this.getContainer();
    const inputs = container.locator('input:visible');
    const count = await inputs.count();
    let valueIndex = 0;

    for (let i = 0; i < count && valueIndex < values.length; i++) {
      const input = inputs.nth(i);
      const type = ((await input.getAttribute('type').catch(() => '')) || 'text').toLowerCase();
      if (['checkbox', 'radio', 'hidden', 'submit', 'button', 'file'].includes(type)) continue;

      const disabled = await input.isDisabled().catch(() => false);
      if (disabled) continue;

      const readonly = await input.getAttribute('readonly').catch(() => null);
      if (readonly !== null) continue;

      const placeholder = (await input.getAttribute('placeholder').catch(() => '')) || '';
      const aria = (await input.getAttribute('aria-label').catch(() => '')) || '';
      const name = (await input.getAttribute('name').catch(() => '')) || '';
      const id = (await input.getAttribute('id').catch(() => '')) || '';
      const attr = `${placeholder} ${aria} ${name} ${id}`.toLowerCase();
      if (skipCountry && attr.includes('country')) continue;

      const currentValue = await input.inputValue().catch(() => '');
      if (currentValue) continue;

      await input.fill(values[valueIndex]);
      valueIndex += 1;
    }

    return valueIndex;
  }

  async collectEmptyInputs() {
    const container = this.getContainer();
    const inputs = container.locator('input:visible');
    const count = await inputs.count();
    const labels = [];

    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const type = ((await input.getAttribute('type').catch(() => '')) || 'text').toLowerCase();
      if (['checkbox', 'radio', 'hidden', 'submit', 'button', 'file'].includes(type)) continue;
      const value = await input.inputValue().catch(() => '');
      if (value) continue;
      const placeholder = (await input.getAttribute('placeholder').catch(() => '')) || '';
      const aria = (await input.getAttribute('aria-label').catch(() => '')) || '';
      const name = (await input.getAttribute('name').catch(() => '')) || '';
      const id = (await input.getAttribute('id').catch(() => '')) || '';
      const label = placeholder || aria || name || id || 'input';
      labels.push(label);
    }

    return labels;
  }

  async selectDropdownOption(trigger, optionText, scope) {
    if (!trigger) return false;
    const page = this.page;
    const debugDob = process.env.PW_DEBUG_DOB === '1';

    try {
      await trigger.click({ timeout: 3000 });
    } catch {
      if (debugDob)
        console.log(`[PW_DEBUG_DOB:select] trigger click failed for ${String(optionText)}`);
      return false;
    }

    const optionMatcher = optionText instanceof RegExp ? optionText : exactTextRegex(optionText);
    const optionSelector = '.t-select__option, .t-dropdown__item, [role="option"]';
    const listSelector = '.t-select__dropdown, .t-dropdown, [role="listbox"]';
    const triggerBox = await trigger.boundingBox().catch(() => null);
    const normalize = (value) =>
      String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
    const initialTriggerText = normalize(await trigger.innerText().catch(() => ''));
    const placeholderTokens = new Set(['DD', 'MM', 'YYYY']);

    const optionMatchesText = (value) => {
      if (!(optionMatcher instanceof RegExp)) return normalize(value) === normalize(optionMatcher);
      optionMatcher.lastIndex = 0;
      return optionMatcher.test(normalize(value));
    };

    const isOptionApplied = async () => {
      const currentText = normalize(
        (await trigger.innerText().catch(() => '')) || (await trigger.textContent().catch(() => ''))
      );
      if (!currentText) return false;
      if (optionMatchesText(currentText)) return true;
      const upper = currentText.toUpperCase();
      const initialUpper = initialTriggerText.toUpperCase();
      return upper !== initialUpper && !placeholderTokens.has(upper);
    };

    const clickOptionCandidate = async (candidate) => {
      const visible = await candidate.isVisible().catch(() => false);
      if (!visible) return false;

      await candidate.scrollIntoViewIfNeeded().catch(() => null);
      let clicked = false;

      try {
        await candidate.click({ timeout: 3000 });
        clicked = true;
      } catch {
        // try fallback clicks below
      }

      if (!clicked) {
        try {
          await candidate.click({ force: true, timeout: 3000 });
          clicked = true;
        } catch {
          // try fallback clicks below
        }
      }

      if (!clicked) {
        try {
          const box = await candidate.boundingBox().catch(() => null);
          if (box) {
            const x = box.x + box.width / 2;
            const y = box.y + box.height / 2;
            await page.mouse.move(x, y, { steps: 5 });
            await page.mouse.click(x, y, { delay: 80 });
            clicked = true;
          }
        } catch {
          // ignore and continue to DOM click fallback
        }
      }

      if (!clicked) {
        try {
          await candidate.evaluate((el) => el.click());
          clicked = true;
        } catch {
          return false;
        }
      }

      for (let i = 0; i < 5; i += 1) {
        if (await isOptionApplied()) return true;
        await sleep(100);
      }
      return false;
    };

    const getNearestCandidateIndexes = async (candidates) => {
      const count = await candidates.count();
      const scored = [];

      for (let i = 0; i < count; i += 1) {
        const candidate = candidates.nth(i);
        const visible = await candidate.isVisible().catch(() => false);
        if (!visible) continue;

        const box = await candidate.boundingBox().catch(() => null);
        if (!box) continue;

        let distance = 0;
        if (triggerBox) {
          const dy = box.y - triggerBox.y;
          const dx = Math.abs(box.x - triggerBox.x);
          distance = (dy >= 0 ? dy : Math.abs(dy) + 1000) + dx / 10;
        }
        scored.push({ index: i, distance });
      }

      scored.sort((a, b) => a.distance - b.distance);
      return scored.map((item) => item.index);
    };

    const tryLists = async (listLocator) => {
      const count = await listLocator.count();
      for (let i = 0; i < count; i += 1) {
        const list = listLocator.nth(i);
        const options = list.locator(optionSelector).filter({ hasText: optionMatcher });
        const indexes = await getNearestCandidateIndexes(options);
        for (const index of indexes) {
          const option = options.nth(index);
          if (await clickOptionCandidate(option)) return true;
        }
      }
      return false;
    };

    const localScope = scope || this.getContainer();
    if (localScope) {
      const scopedLists = localScope.locator(`${listSelector}:visible`);
      if (await tryLists(scopedLists)) return true;
    }

    const parentLists = trigger.locator('xpath=..').locator(`${listSelector}:visible`);
    if (await tryLists(parentLists)) return true;

    const grandParentLists = trigger.locator('xpath=../..').locator(`${listSelector}:visible`);
    if (await tryLists(grandParentLists)) return true;

    const pageLists = page.locator(`${listSelector}:visible`);
    if (await tryLists(pageLists)) return true;

    const tryLooseOptions = async (context) => {
      const looseOptions = context
        .locator(`${optionSelector}:visible`)
        .filter({ hasText: optionMatcher });
      const indexes = await getNearestCandidateIndexes(looseOptions);
      for (const index of indexes) {
        const option = looseOptions.nth(index);
        if (await clickOptionCandidate(option)) return true;
      }
      return false;
    };

    if (localScope && (await tryLooseOptions(localScope))) return true;
    if (await tryLooseOptions(trigger.locator('xpath=..'))) return true;
    if (await tryLooseOptions(trigger.locator('xpath=../..'))) return true;
    if (await tryLooseOptions(page)) return true;

    const tryPositionalTextFallback = async (context) => {
      const textCandidates = context.getByText(optionMatcher, { exact: true });
      const count = await textCandidates.count().catch(() => 0);
      const scored = [];

      for (let i = 0; i < count; i += 1) {
        const candidate = textCandidates.nth(i);
        const visible = await candidate.isVisible().catch(() => false);
        if (!visible) continue;

        const box = await candidate.boundingBox().catch(() => null);
        if (!box) {
          scored.push({ index: i, distance: 10_000 + i });
          continue;
        }

        if (triggerBox) {
          const horizontallyNear = Math.abs(box.x - triggerBox.x) <= 300;
          const verticallyNear = box.y >= triggerBox.y - 20 && box.y <= triggerBox.y + 520;
          if (!horizontallyNear || !verticallyNear) continue;
        }

        let distance = 0;
        if (triggerBox) {
          const dy = box.y - triggerBox.y;
          const dx = Math.abs(box.x - triggerBox.x);
          distance = (dy >= 0 ? dy : Math.abs(dy) + 1000) + dx / 10;
        }
        scored.push({ index: i, distance });
      }

      scored.sort((a, b) => a.distance - b.distance);
      for (const item of scored) {
        const candidate = textCandidates.nth(item.index);
        if (await clickOptionCandidate(candidate)) return true;
      }
      return false;
    };

    if (localScope && (await tryPositionalTextFallback(localScope))) return true;
    if (await tryPositionalTextFallback(page)) return true;

    return false;
  }

  async selectGenderIfPresent() {
    const container = this.getContainer();
    const male = container
      .locator('button:has-text("Male"), [role="button"]:has-text("Male")')
      .first();
    const female = container
      .locator('button:has-text("Female"), [role="button"]:has-text("Female")')
      .first();
    try {
      if (await male.isVisible().catch(() => false)) {
        await male.click();
        return true;
      }
      if (await female.isVisible().catch(() => false)) {
        await female.click();
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  async collectDobPlaceholders() {
    const container = this.getContainer();
    return container.evaluate((root) => {
      const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
      const missing = [];
      const parts = [
        { cls: 'day', token: 'DD' },
        { cls: 'month', token: 'MM' },
        { cls: 'year', token: 'YYYY' },
      ];

      for (const part of parts) {
        const section = root.querySelector(`.t-date-dropdown__select.${part.cls}`);
        if (!section) {
          missing.push(part.token);
          continue;
        }
        const valueText = normalize(section.querySelector('.t-select__value')?.textContent || '');
        if (valueText) continue;
        const sectionText = normalize(section.textContent || '').toUpperCase();
        if (!sectionText || sectionText === part.token) {
          missing.push(part.token);
          continue;
        }
        if (part.token === 'YYYY' && !/\b\d{4}\b/.test(sectionText)) {
          missing.push(part.token);
        }
        if (
          part.token === 'MM' &&
          !/\b(0?[1-9]|1[0-2]|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/i.test(sectionText)
        ) {
          missing.push(part.token);
        }
        if (part.token === 'DD' && !/\b(0?[1-9]|[12]\d|3[01])\b/.test(sectionText)) {
          missing.push(part.token);
        }
      }

      return missing;
    });
  }

  async selectDobFromDropdowns(data) {
    const container = this.getContainer();
    const dobLabel = container.locator('text=Day of Birth').first();
    const dobBlock = (await dobLabel.isVisible().catch(() => false))
      ? dobLabel.locator('..')
      : container;

    const pickVisibleTrigger = async (selectors) => {
      for (const selector of selectors) {
        const candidate = dobBlock.locator(selector).first();
        if (await candidate.isVisible().catch(() => false)) return candidate;
      }
      return dobBlock.locator(selectors[0]).first();
    };

    const ddTrigger = await pickVisibleTrigger([
      '.t-date-dropdown__select.day .t-select__choose:visible',
      '.t-date-dropdown__select.day .t-select__icon:visible',
      '.t-date-dropdown__select.day:visible',
      ':text-is("DD")',
    ]);
    const mmTrigger = await pickVisibleTrigger([
      '.t-date-dropdown__select.month .t-select__choose:visible',
      '.t-date-dropdown__select.month .t-select__icon:visible',
      '.t-date-dropdown__select.month:visible',
      ':text-is("MM")',
    ]);
    const yyTrigger = await pickVisibleTrigger([
      '.t-date-dropdown__select.year .t-select__choose:visible',
      '.t-date-dropdown__select.year .t-select__icon:visible',
      '.t-date-dropdown__select.year:visible',
      ':text-is("YYYY")',
    ]);

    const ddOptions = [exactTextRegex(String(Number(data.dd))), exactTextRegex(data.dd)];
    const mmOptions = [
      exactTextRegex(String(Number(data.mm))),
      exactTextRegex(data.mm),
      ...monthNames(data.mm).map((m) => exactTextRegex(m)),
    ];
    const yyOptions = [exactTextRegex(data.yyyy)];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const missing = await this.collectDobPlaceholders();
      if (!missing.length) return;

      if (missing.includes('DD')) {
        for (const opt of ddOptions) {
          if (await this.selectDropdownOption(ddTrigger, opt, container)) break;
        }
      }
      if (missing.includes('MM')) {
        for (const opt of mmOptions) {
          if (await this.selectDropdownOption(mmTrigger, opt, container)) break;
        }
      }
      if (missing.includes('YYYY')) {
        for (const opt of yyOptions) {
          if (await this.selectDropdownOption(yyTrigger, opt, container)) break;
        }
      }
    }
  }

  async selectDobViaDomFallback(data) {
    const container = this.getContainer();
    return container.evaluate(async (root, values) => {
      const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        if (!el) return false;
        const style = globalThis.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
          return false;
        return el.getClientRects().length > 0;
      };
      const clickLike = (el) => {
        if (!el) return false;
        const types = ['pointerdown', 'mousedown', 'mouseup', 'click'];
        for (const type of types) {
          el.dispatchEvent(
            new globalThis.MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              view: globalThis,
            })
          );
        }
        return true;
      };
      const partSelectorByToken = {
        DD: '.t-date-dropdown__select.day',
        MM: '.t-date-dropdown__select.month',
        YYYY: '.t-date-dropdown__select.year',
      };
      const distance = (a, b) => {
        const ay = a.top + a.height / 2;
        const by = b.top + b.height / 2;
        const ax = a.left + a.width / 2;
        const bx = b.left + b.width / 2;
        return Math.hypot(ax - bx, ay - by);
      };
      const nearestListTo = (anchor) => {
        const lists = Array.from(
          document.querySelectorAll('.t-select__dropdown, .t-dropdown, [role="listbox"]')
        ).filter(visible);
        if (!lists.length || !anchor) return null;
        const anchorRect = anchor.getBoundingClientRect();
        return (
          lists
            .map((list) => ({ list, d: distance(anchorRect, list.getBoundingClientRect()) }))
            .sort((a, b) => a.d - b.d)[0]?.list || null
        );
      };
      const pickFromList = async (anchor, optionValues) => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        const list = nearestListTo(anchor);
        if (!list) return false;
        const targets = Array.from(list.querySelectorAll('*')).filter((el) => visible(el));
        for (const value of optionValues.map((v) => normalize(String(v)))) {
          if (!value) continue;
          const option = targets.find((el) => normalize(el.textContent || '') === value);
          if (option && clickLike(option)) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return true;
          }
        }
        return false;
      };

      const months = [
        '',
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ];
      const mmIndex = Number(values.mm);
      const mmName = Number.isFinite(mmIndex) ? months[mmIndex] || '' : '';

      const selectionPlan = [
        { token: 'DD', options: [String(Number(values.dd)), values.dd] },
        {
          token: 'MM',
          options: [String(Number(values.mm)), values.mm, mmName, mmName.slice(0, 3)],
        },
        { token: 'YYYY', options: [values.yyyy] },
      ];

      for (const step of selectionPlan) {
        const partRoot = root.querySelector(partSelectorByToken[step.token]);
        if (!partRoot) continue;
        const trigger =
          partRoot.querySelector(
            '.t-select__choose, .t-select__icon, .t-select__label, .t-select__value'
          ) || partRoot;
        if (!clickLike(trigger)) continue;
        await pickFromList(trigger, step.options);
      }
    }, data);
  }

  async debugDobState(stage) {
    if (process.env.PW_DEBUG_DOB !== '1') return;
    try {
      const missing = await this.collectDobPlaceholders();
      console.log(`[PW_DEBUG_DOB:${stage}] missing=${missing.join(',') || 'none'}`);
    } catch (err) {
      console.log(`[PW_DEBUG_DOB:${stage}] failed: ${err.message}`);
    }
  }

  async ensureSignupTab() {
    const container = this.getContainer();
    const signupTab = container
      .locator(
        '[role="tab"]:has-text("Sign Up"), a:has-text("Sign Up"), button:not([type="submit"]):has-text("Sign Up")'
      )
      .first();
    try {
      if ((await signupTab.isVisible()) && (await signupTab.isEnabled())) {
        await signupTab.click({ timeout: 3000 });
      }
    } catch {
      // ignore
    }
    return signupTab;
  }

  async findFinalSignupButton() {
    return this.findActionButton([
      'button:has-text("SIGN UP")',
      'button:has-text("Sign Up")',
      'button:has-text("Create")',
      'button:has-text("Зарегистрироваться")',
      'button:has-text("Зареєструватися")',
      'button:has-text("Создать аккаунт")',
      'button:has-text("Registrarse")',
      'button:has-text("S\'inscrire")',
      'button:has-text("Registrieren")',
      'button[type="submit"]:not([data-testid="login-button"])',
      'input[type="submit"]',
      '[data-testid*="signup" i]',
    ]);
  }

  async fillStep1(data, opts = {}) {
    debugSignup('fillStep1:start');
    const { annotate, errorToast, signupTab } = opts;
    const container = this.getContainer();

    const emailInput = container
      .locator(
        'input[type="email"]:visible, input[name="email"]:visible, input[placeholder*="Email"]:visible'
      )
      .first();
    const passwordInput = container
      .locator(
        'input[type="password"]:visible, input[name="password"]:visible, input[placeholder*="Password"]:visible'
      )
      .first();

    await emailInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => null);
    await passwordInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => null);

    let emailFilled = await this.fillFirstVisible(
      ['input[type="email"]', 'input[name="email"]', 'input[placeholder*="Email"]'],
      data.email
    );
    debugSignup(`fillStep1:email=${String(emailFilled)}`);
    if (!emailFilled) {
      const emailFallback = container.locator('input:visible:not([type="password"])').first();
      if (await emailFallback.isVisible().catch(() => false)) {
        await emailFallback.fill(data.email);
        emailFilled = true;
      }
    }

    const passwordInputs = container.locator('input[type="password"]:visible');
    const passwordCount = await passwordInputs.count();
    let passwordFilled = false;
    if (passwordCount >= 1) {
      await passwordInputs.first().fill(data.password);
      passwordFilled = true;
    } else {
      passwordFilled = await this.fillFirstVisible(
        ['input[name="password"]', 'input[placeholder*="Password"]'],
        data.password
      );
    }
    if (passwordCount >= 2) {
      await passwordInputs.nth(1).fill(data.password);
    }
    debugSignup(`fillStep1:password=${String(passwordFilled)} count=${passwordCount}`);
    // Some brands render registration as a single step and require the phone
    // before the same submit button can become actionable.
    await this.fillFirstVisible(
      ['input[type="tel"]', 'input[name="phone"]', 'input[placeholder*="Phone" i]'],
      data.phone
    );
    await container
      .locator(
        'input[type="tel"]:visible, input[name="phone"]:visible, input[placeholder*="Phone" i]:visible'
      )
      .first()
      .press('Tab')
      .catch(() => null);
    debugSignup('fillStep1:phone-blurred');

    await this.acceptTermsIfPresent();
    debugSignup('fillStep1:fields-filled');

    const stepSelectors = CONTINUE_BUTTON_SELECTORS;

    let step1Btn = await this.findActionButton(stepSelectors);
    if (!step1Btn && signupTab) {
      try {
        if (await signupTab.isVisible()) {
          await signupTab.click();
          await sleep(500);
          step1Btn = await this.findActionButton(stepSelectors);
        }
      } catch {
        // ignore
      }
    }

    if (!step1Btn) {
      const finalSignupBtn = await this.findFinalSignupButton();
      if (finalSignupBtn) {
        this.addNote(annotate, 'Single-step registration detected: no step-1 continue button.');
        return;
      }
      const visibleButtons = await this.listVisibleButtons();
      this.addNote(annotate, `Step 1 buttons: ${visibleButtons.join(' | ') || 'none'}`);
      if (errorToast && (await errorToast.isVisible().catch(() => false))) {
        throw new Error('Registration error toast: Something went wrong, please try again later.');
      }
    }

    expect(step1Btn, 'Continue button not found on step 1').toBeTruthy();
    if (step1Btn) {
      const step1Label = String(
        (await step1Btn.innerText().catch(() => '')) ||
          (await step1Btn.getAttribute('value').catch(() => ''))
      ).trim();
      const singleStepSubmit = /sign\s*up|create\s*(?:account)?|register/i.test(step1Label);
      if (await step1Btn.isDisabled().catch(() => false)) {
        const currentEmail = await emailInput.inputValue().catch(() => '');
        const currentPassword = await passwordInput.inputValue().catch(() => '');
        if (currentEmail && currentEmail !== data.email) {
          this.addNote(
            annotate,
            `Step 1 email normalized by UI: requested=${data.email} actual=${currentEmail}`
          );
        }
        if (!currentEmail) {
          await this.fillFirstVisible(
            ['input[type="email"]', 'input[name="email"]', 'input[placeholder*="Email"]'],
            data.email
          );
          emailFilled = true;
        }
        if (!currentPassword) {
          await this.fillFirstVisible(
            ['input[type="password"]', 'input[name="password"]', 'input[placeholder*="Password"]'],
            data.password
          );
          passwordFilled = true;
        }
        await emailInput.press('Tab').catch(() => null);
        await passwordInput.press('Tab').catch(() => null);
        await sleep(500);
        await this.acceptTermsIfPresent();

        const phoneInput = container
          .locator(
            'input[type="tel"]:visible, input[name="phone"]:visible, input[placeholder*="Phone" i]:visible'
          )
          .first();
        if (await phoneInput.isVisible().catch(() => false)) {
          const phoneDigits = String(data.phone || '').replace(/\D+/g, '');
          if (phoneDigits.length > 9) {
            await phoneInput.fill(phoneDigits.slice(-9));
            await phoneInput.press('Tab').catch(() => null);
            await sleep(500);
            this.addNote(annotate, 'Adjusted visible phone input to a 9-digit national number.');
          }
        }
      }

      const currentEmail = await emailInput.inputValue().catch(() => '');
      const currentPassword = await passwordInput.inputValue().catch(() => '');
      if (!currentEmail || !currentPassword) {
        const visibleButtons = await this.listVisibleButtons();
        throw new Error(
          `Signup form not actionable: step 1 inputs were not filled in signup modal ` +
            `(email=${Boolean(currentEmail)}, password=${Boolean(currentPassword)}). ` +
            `Visible buttons: ${visibleButtons.join(' | ') || 'none'}`
        );
      }

      if (!emailFilled || !passwordFilled) {
        this.addNote(
          annotate,
          `Step 1 fill status: email=${String(emailFilled)}, password=${String(passwordFilled)}`
        );
      }

      if (await step1Btn.isDisabled().catch(() => false)) {
        const initialTurnstile = await this.getTurnstileState();
        if (initialTurnstile.inputCount > 0 && initialTurnstile.tokenLen === 0) {
          this.addNote(
            annotate,
            `Turnstile pending before continue: inputCount=${initialTurnstile.inputCount}, inputVisible=${initialTurnstile.inputVisible}, iframeVisible=${initialTurnstile.iframeVisible}`
          );
          const waited = await this.waitForTurnstileToken({ timeoutMs: 20000, pollMs: 1000 });
          this.addNote(
            annotate,
            `Turnstile wait result: tokenReady=${waited.tokenReady}, tokenLen=${waited.state.tokenLen}`
          );
        }
      }

      let turnstileState = await this.getTurnstileState();
      if (
        (await step1Btn.isDisabled().catch(() => false)) &&
        turnstileState.inputCount > 0 &&
        turnstileState.tokenLen === 0
      ) {
        const resolved = await this.resolveTurnstileToken(annotate);
        if (resolved && resolved.state) {
          turnstileState = resolved.state;
        }
        this.addNote(
          annotate,
          `Turnstile resolve result: tokenReady=${Boolean(
            resolved && resolved.tokenReady
          )}, tokenLen=${turnstileState.tokenLen}`
        );
      }

      if (
        (await step1Btn.isDisabled().catch(() => false)) &&
        turnstileState.inputCount > 0 &&
        turnstileState.tokenLen === 0
      ) {
        throw new Error('Cloudflare challenge detected (signup turnstile token not issued).');
      }

      if ((await step1Btn.isDisabled().catch(() => false)) && (await this.hasCaptchaGate())) {
        throw new Error('Cloudflare challenge detected (signup captcha gate).');
      }

      await expect(step1Btn).toBeEnabled({ timeout: 10000 });
      await step1Btn.click({ timeout: 10000 }).catch((err) => {
        throw new Error(
          `Signup form not actionable: continue click failed: ${
            err && err.message ? err.message : err
          }`
        );
      });
      debugSignup(`fillStep1:clicked:${step1Label || 'unlabelled'}`);
      return singleStepSubmit;
    }
    return false;
  }

  async fillStep2(data, opts = {}) {
    const { annotate, errorToast } = opts;

    await this.fillFirstVisible(
      ['input[name="firstName"]', 'input[placeholder*="Name"]', 'input[aria-label*="Name"]'],
      data.firstName
    );
    await this.fillFirstVisible(
      ['input[name="lastName"]', 'input[placeholder*="Last"]', 'input[aria-label*="Last"]'],
      data.lastName
    );
    await this.fillFirstVisible(
      [
        'input[name*="country" i]',
        'input[placeholder*="Country" i]',
        'input[aria-label*="Country" i]',
      ],
      data.country || 'Spain'
    );
    await this.fillFirstVisible(
      ['input[name="city"]', 'input[placeholder*="City"]', 'input[aria-label*="City"]'],
      data.city
    );
    await this.fillFirstVisible(
      ['input[name="address"]', 'input[placeholder*="Address"]', 'input[aria-label*="Address"]'],
      data.address
    );

    await this.fillEmptyTextInputs([data.firstName, data.lastName, data.city, data.address], {
      skipCountry: true,
    });

    await this.acceptTermsIfPresent();

    const step2Btn = await this.findActionButton(CONTINUE_BUTTON_SELECTORS);

    if (!step2Btn) {
      const finalSignupBtn = await this.findFinalSignupButton();
      if (finalSignupBtn) {
        this.addNote(annotate, 'Single-step registration detected: no step-2 continue button.');
        return;
      }
      const visibleButtons = await this.listVisibleButtons();
      this.addNote(annotate, `Step 2 buttons: ${visibleButtons.join(' | ') || 'none'}`);
      const emptyInputs = await this.collectEmptyInputs();
      if (emptyInputs.length) {
        this.addNote(annotate, `Step 2 empty inputs: ${emptyInputs.join(' | ')}`);
      }
      if (errorToast && (await errorToast.isVisible().catch(() => false))) {
        throw new Error('Registration error toast: Something went wrong, please try again later.');
      }
    }

    expect(step2Btn, 'Continue button not found on step 2').toBeTruthy();
    if (step2Btn) {
      if (await step2Btn.isDisabled().catch(() => false)) {
        const emptyInputs = await this.collectEmptyInputs();
        if (emptyInputs.length) {
          this.addNote(annotate, `Step 2 still disabled. Empty inputs: ${emptyInputs.join(' | ')}`);
        }
        await this.fillEmptyTextInputs([data.firstName, data.lastName, data.city, data.address], {
          skipCountry: true,
        });
      }
      await expect(step2Btn).toBeEnabled();
      await step2Btn.click();
    }
  }

  async fillStep3AndSubmit(data, opts = {}) {
    const { annotate, errorToast } = opts;
    const container = this.getContainer();

    const containerVisible = await container.isVisible({ timeout: 800 }).catch(() => false);
    if (!containerVisible) {
      this.addNote(
        annotate,
        'Registration modal closed after step 2; treating the flow as a completed two-step registration.'
      );
      return;
    }

    await this.selectGenderIfPresent();
    await this.fillFirstVisible(
      ['input[placeholder="DD"]', 'input[name="day"]', 'input[aria-label*="Day"]'],
      data.dd
    );
    await this.fillFirstVisible(
      ['input[placeholder="MM"]', 'input[name="month"]', 'input[aria-label*="Month"]'],
      data.mm
    );
    await this.fillFirstVisible(
      ['input[placeholder="YYYY"]', 'input[name="year"]', 'input[aria-label*="Year"]'],
      data.yyyy
    );
    await this.fillFirstVisible(
      ['input[type="tel"]', 'input[name="phone"]', 'input[placeholder*="Phone"]'],
      data.phone
    );

    await this.fillEmptyTextInputs([data.dd, data.mm, data.yyyy, data.phone]);
    await this.selectDobFromDropdowns(data);
    if ((await this.collectDobPlaceholders()).length) {
      await this.selectDobViaDomFallback(data);
    }
    await this.debugDobState('after-select');

    await this.acceptTermsIfPresent();

    const finalSignupBtn = await this.findFinalSignupButton();

    if (!finalSignupBtn) {
      const visibleButtons = await this.listVisibleButtons();
      this.addNote(annotate, `Final step buttons: ${visibleButtons.join(' | ') || 'none'}`);
      if (errorToast && (await errorToast.isVisible().catch(() => false))) {
        throw new Error('Registration error toast: Something went wrong, please try again later.');
      }
    }

    expect(finalSignupBtn, 'Sign Up button not found on final step').toBeTruthy();
    if (finalSignupBtn) {
      if (await finalSignupBtn.isDisabled().catch(() => false)) {
        const emptyInputs = await this.collectEmptyInputs();
        if (emptyInputs.length) {
          this.addNote(annotate, `Final step empty inputs: ${emptyInputs.join(' | ')}`);
        }
        const dobMissing = await this.collectDobPlaceholders();
        if (dobMissing.length) {
          this.addNote(annotate, `DOB not selected: ${dobMissing.join(' | ')}`);
        }
        await this.debugDobState('before-final-expect');
      }

      await expect(finalSignupBtn).toBeEnabled();
      await finalSignupBtn.click();
    }
  }

  async completeRegistration(data, opts = {}) {
    const errorToast = opts.errorToast || this.page.getByText(/something went wrong/i).first();
    const signupTab = await this.ensureSignupTab();
    debugSignup('complete:signup-tab-ready');
    const completedSingleStep = await this.fillStep1(data, { ...opts, errorToast, signupTab });
    debugSignup(`complete:step1-finished:single=${String(completedSingleStep)}`);
    if (completedSingleStep) return;
    const depositAfterSignup = await this.page
      .getByText(/deposit\s*&\s*play/i)
      .first()
      .isVisible({ timeout: 1200 })
      .catch(() => false);
    const containerStillVisible = await this.getContainer()
      .isVisible({ timeout: 1200 })
      .catch(() => false);
    if (depositAfterSignup || !containerStillVisible) return;
    await this.fillStep2(data, { ...opts, errorToast });
    await this.fillStep3AndSubmit(data, { ...opts, errorToast });
  }

  async waitForOutcome() {
    const container = this.getContainer();
    const successMessage = container.getByText(/successfully registered/i).first();
    const otpInput = container.locator('input[name*="code"], input[placeholder*="code"]').first();
    const errorMessage = container.getByText(/already exists|invalid/i).first();

    return Promise.race([
      successMessage
        .waitFor({ state: 'visible', timeout: 20000 })
        .then(() => 'success')
        .catch(() => null),
      otpInput
        .waitFor({ state: 'visible', timeout: 20000 })
        .then(() => 'otp')
        .catch(() => null),
      container
        .waitFor({ state: 'hidden', timeout: 20000 })
        .then(() => 'closed')
        .catch(() => null),
      errorMessage
        .waitFor({ state: 'visible', timeout: 20000 })
        .then(() => 'error')
        .catch(() => null),
    ]);
  }
}

module.exports = {
  SignupRegistrationPage,
};
