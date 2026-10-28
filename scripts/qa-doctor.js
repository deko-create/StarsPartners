#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadProjectEnv } = require('./lib/env');

loadProjectEnv();

const args = new Set(process.argv.slice(2));
const isPreflight = args.has('--preflight');
const isStrict = isPreflight || args.has('--strict') || process.env.QA_DOCTOR_STRICT === '1';
const jsonOutput = args.has('--json');
const skipBrowserCheck = process.env.QA_DOCTOR_SKIP_BROWSER === '1';

const launchTimeoutMs = toPositiveInt(process.env.QA_DOCTOR_LAUNCH_TIMEOUT_MS, 60_000);
const navigationTimeoutMs = toPositiveInt(process.env.QA_DOCTOR_NAV_TIMEOUT_MS, 20_000);
const supportedNodeMajors = parseNodeMajors(process.env.QA_NODE_LTS_MAJORS || '24');

const checks = [];
const shellCandidates = [
  process.env.QA_DOCTOR_SHELL,
  process.env.SHELL,
  '/bin/bash',
  '/usr/bin/bash',
  '/bin/zsh',
]
  .map((item) => String(item || '').trim())
  .filter(Boolean);
const shellPath =
  shellCandidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  }) || '/bin/bash';
const extraPathEntries = (() => {
  const items = [];
  const homeDir = process.env.HOME || '';
  if (homeDir) items.push(path.join(homeDir, '.local', 'bin'));
  items.push(path.join(process.cwd(), 'node_modules', '.bin'));

  const seen = new Set();
  return items.filter((item) => {
    const normalized = String(item || '').trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
})();
const mergedPath = `${extraPathEntries.join(':')}${extraPathEntries.length ? ':' : ''}${
  process.env.PATH || ''
}`;

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNodeMajors(value) {
  return String(value || '')
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item) && item > 0);
}

function runShell(command) {
  return spawnSync(shellPath, ['-lc', command], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PATH: mergedPath,
    },
  });
}

function commandExists(command) {
  const result = runShell(`command -v ${command}`);
  return result.status === 0;
}

function addCheck({ id, name, status, severity, message, details }) {
  checks.push({
    id,
    name,
    status,
    severity,
    message,
    details: details || '',
  });
}

function readNvmrcVersion() {
  const nvmPath = path.join(process.cwd(), '.nvmrc');
  if (!fs.existsSync(nvmPath)) return null;

  const raw = String(fs.readFileSync(nvmPath, 'utf8') || '')
    .split('\n')[0]
    .trim();
  if (!raw) return null;

  const match = raw.match(/(\d{2})/);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

function checkNodeVersion() {
  const rawVersion = process.versions && process.versions.node ? process.versions.node : '';
  const major = Number.parseInt(String(rawVersion).split('.')[0], 10);
  const expectedFromNvm = readNvmrcVersion();

  if (!Number.isFinite(major)) {
    addCheck({
      id: 'node-version',
      name: 'Node.js Version',
      status: 'fail',
      severity: 'critical',
      message: 'Unable to parse current Node.js version.',
      details: `process.versions.node=${rawVersion}`,
    });
    return;
  }

  if (!supportedNodeMajors.includes(major)) {
    addCheck({
      id: 'node-version',
      name: 'Node.js Version',
      status: 'fail',
      severity: 'critical',
      message: `Node.js ${rawVersion} is outside supported LTS set (${supportedNodeMajors.join(', ')}).`,
      details: 'Switch Node to 24.x LTS via nvm/fnm/volta.',
    });
    return;
  }

  if (Number.isFinite(expectedFromNvm) && expectedFromNvm !== major) {
    addCheck({
      id: 'node-version',
      name: 'Node.js Version',
      status: 'fail',
      severity: 'critical',
      message: `Node.js ${rawVersion} does not match .nvmrc major (${expectedFromNvm}).`,
      details: 'Run: nvm use (or equivalent).',
    });
    return;
  }

  addCheck({
    id: 'node-version',
    name: 'Node.js Version',
    status: 'pass',
    severity: 'critical',
    message: `Node.js ${rawVersion} is within supported LTS set (${supportedNodeMajors.join(', ')}).`,
    details: expectedFromNvm ? `.nvmrc=${expectedFromNvm}` : 'No .nvmrc pin found.',
  });
}

function checkPlaywrightCli() {
  const localCliCandidate = path.join(process.cwd(), 'node_modules', '.bin', 'playwright');
  if (fs.existsSync(localCliCandidate)) {
    const direct = spawnSync(localCliCandidate, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: mergedPath,
      },
    });
    if (direct.status === 0) {
      addCheck({
        id: 'playwright-cli',
        name: 'Playwright CLI',
        status: 'pass',
        severity: 'critical',
        message: String(direct.stdout || '').trim() || 'Playwright CLI is available.',
      });
      return;
    }
  }

  const result = runShell('npx playwright --version');
  if (result.status !== 0) {
    addCheck({
      id: 'playwright-cli',
      name: 'Playwright CLI',
      status: 'fail',
      severity: 'critical',
      message: 'Playwright CLI is not available.',
      details: `${String(result.stderr || result.stdout || '').trim()} | shell=${shellPath}`,
    });
    return;
  }

  addCheck({
    id: 'playwright-cli',
    name: 'Playwright CLI',
    status: 'pass',
    severity: 'critical',
    message: String(result.stdout || '').trim() || 'Playwright CLI is available.',
  });
}

function checkCommand(name, options = {}) {
  const severity = options.severity || 'medium';
  const expected = options.expected || '';

  if (!commandExists(name)) {
    addCheck({
      id: `cmd-${name}`,
      name: `Command: ${name}`,
      status: options.missingStatus || 'warn',
      severity,
      message: `${name} is not installed or not in PATH.`,
      details: expected,
    });
    return;
  }

  let details = '';
  if (options.versionCmd) {
    const versionResult = runShell(options.versionCmd);
    details = String(versionResult.stdout || versionResult.stderr || '').trim();
  }

  addCheck({
    id: `cmd-${name}`,
    name: `Command: ${name}`,
    status: 'pass',
    severity,
    message: `${name} is available.`,
    details,
  });
}

function checkNodePackage(packageName, options = {}) {
  const severity = options.severity || 'low';
  const expected = options.expected || `Install via npm: npm install -D ${packageName}`;
  const result = runShell(
    `node -e "const p=require('${packageName}/package.json'); console.log(p.version || 'installed')"`
  );

  addCheck({
    id: `pkg-${packageName.replace(/[^a-z0-9]+/gi, '-')}`,
    name: `Node package: ${packageName}`,
    status: result.status === 0 ? 'pass' : options.missingStatus || 'warn',
    severity,
    message:
      result.status === 0
        ? `${packageName} package is available.`
        : `${packageName} package is not installed.`,
    details: result.status === 0 ? String(result.stdout || '').trim() : expected,
  });
}

function checkVsCodePlaywrightExtension() {
  if (!commandExists('code')) {
    addCheck({
      id: 'vscode-playwright-extension',
      name: 'VS Code Playwright Extension',
      status: 'warn',
      severity: 'low',
      message: 'VS Code CLI is not available, so extensions cannot be checked.',
      details: 'Install VS Code and expose the `code` command in PATH.',
    });
    return;
  }

  const result = runShell('code --list-extensions | grep -ix ms-playwright.playwright');
  addCheck({
    id: 'vscode-playwright-extension',
    name: 'VS Code Playwright Extension',
    status: result.status === 0 ? 'pass' : 'warn',
    severity: 'low',
    message:
      result.status === 0
        ? 'Playwright VS Code extension is installed.'
        : 'Playwright VS Code extension is not installed.',
    details:
      result.status === 0
        ? String(result.stdout || '').trim()
        : 'Install via: code --install-extension ms-playwright.playwright',
  });
}

function checkJavaRuntime() {
  const defaultResult = runShell('java -version');
  const defaultOutput = String(defaultResult.stderr || defaultResult.stdout || '').trim();
  const looksMissing =
    defaultResult.status !== 0 || /unable to locate a java runtime/i.test(defaultOutput);

  if (!looksMissing) {
    addCheck({
      id: 'java-runtime',
      name: 'Java Runtime',
      status: 'pass',
      severity: 'medium',
      message: 'Java runtime is available.',
      details: defaultOutput.split('\n').slice(0, 2).join(' | '),
    });
    return;
  }

  const fallbackCandidates = [
    '/opt/homebrew/opt/openjdk/bin/java',
    '/usr/local/opt/openjdk/bin/java',
  ];

  for (const candidate of fallbackCandidates) {
    if (!fs.existsSync(candidate)) continue;
    const fallbackResult = runShell(`"${candidate}" -version`);
    if (fallbackResult.status === 0) {
      addCheck({
        id: 'java-runtime',
        name: 'Java Runtime',
        status: 'warn',
        severity: 'medium',
        message: 'Java runtime is installed but not present in PATH.',
        details: `${candidate} | Add OpenJDK bin to PATH before ZAP/OpenAPI Generator runs.`,
      });
      return;
    }
  }

  addCheck({
    id: 'java-runtime',
    name: 'Java Runtime',
    status: 'warn',
    severity: 'medium',
    message: 'Java runtime is missing. ZAP/OpenAPI Generator flows may fail.',
    details: defaultOutput || 'Install OpenJDK (recommended: 21).',
  });
}

function checkDocker() {
  if (!commandExists('docker')) {
    addCheck({
      id: 'docker-cli',
      name: 'Docker CLI',
      status: 'warn',
      severity: 'medium',
      message: 'Docker CLI is not installed.',
      details: 'Install Docker Desktop or docker+colima for reproducible security/perf layers.',
    });
    return;
  }

  const version = runShell('docker --version');
  const info = runShell('docker info --format "{{.ServerVersion}}"');
  const daemonOk = info.status === 0;

  addCheck({
    id: 'docker-cli',
    name: 'Docker CLI',
    status: daemonOk ? 'pass' : 'warn',
    severity: 'medium',
    message: daemonOk
      ? 'Docker CLI and daemon are available.'
      : 'Docker CLI is available but daemon is not reachable.',
    details: [
      String(version.stdout || version.stderr || '').trim(),
      String(info.stderr || '').trim(),
    ]
      .filter(Boolean)
      .join(' | '),
  });
}

function checkZap() {
  if (!commandExists('docker')) {
    addCheck({
      id: 'zap-cli',
      name: 'OWASP ZAP Docker',
      status: 'warn',
      severity: 'low',
      message: 'Docker CLI is required for the ZAP scanner.',
      details: 'Install Docker Desktop or docker+colima.',
    });
    return;
  }

  const info = runShell('docker info --format "{{.ServerVersion}}"');
  addCheck({
    id: 'zap-cli',
    name: 'OWASP ZAP Docker',
    status: info.status === 0 ? 'pass' : 'warn',
    severity: 'low',
    message:
      info.status === 0
        ? 'ZAP Docker scanner prerequisites are available.'
        : 'Docker daemon is not reachable; ZAP scans cannot start.',
    details: 'Image: ghcr.io/zaproxy/zaproxy:stable (digest pinned by runner)',
  });
}

async function checkBrowserLaunchPreflight() {
  if (skipBrowserCheck) {
    addCheck({
      id: 'browser-preflight',
      name: 'Browser Launch Preflight',
      status: 'warn',
      severity: 'critical',
      message: 'Browser launch preflight was skipped by QA_DOCTOR_SKIP_BROWSER=1.',
    });
    return;
  }

  let playwright;
  try {
    playwright = require('playwright');
  } catch (error) {
    addCheck({
      id: 'browser-preflight',
      name: 'Browser Launch Preflight',
      status: 'fail',
      severity: 'critical',
      message: 'Unable to require Playwright module.',
      details: String((error && error.message) || error || ''),
    });
    return;
  }

  const engines = [
    { name: 'chromium', api: playwright.chromium },
    { name: 'webkit', api: playwright.webkit },
  ];

  for (const engine of engines) {
    let browser = null;
    let context = null;
    try {
      browser = await engine.api.launch({
        headless: true,
        timeout: launchTimeoutMs,
      });
      context = await browser.newContext();
      const page = await context.newPage();
      await page.goto('data:text/html,<title>qa-doctor-ok</title><h1>ok</h1>', {
        timeout: navigationTimeoutMs,
      });
      const title = await page.title();

      addCheck({
        id: `browser-${engine.name}`,
        name: `Browser Launch: ${engine.name}`,
        status: 'pass',
        severity: 'critical',
        message: `${engine.name} launched successfully.`,
        details: `title=${title}`,
      });
    } catch (error) {
      addCheck({
        id: `browser-${engine.name}`,
        name: `Browser Launch: ${engine.name}`,
        status: 'fail',
        severity: 'critical',
        message: `${engine.name} failed to launch in preflight.`,
        details: String((error && error.message) || error || ''),
      });
    } finally {
      try {
        if (context) await context.close();
      } catch {
        // best-effort cleanup
      }
      try {
        if (browser) await browser.close();
      } catch {
        // best-effort cleanup
      }
    }
  }
}

function printHumanReport() {
  const statusIcon = {
    pass: 'PASS',
    warn: 'WARN',
    fail: 'FAIL',
  };

  console.log('\nQA Doctor Report');
  console.log(`Mode: ${isPreflight ? 'preflight' : 'audit'}${isStrict ? ' (strict)' : ''}`);
  console.log('');

  for (const check of checks) {
    const icon = statusIcon[check.status] || check.status.toUpperCase();
    const details = check.details ? ` | ${check.details}` : '';
    console.log(`[${icon}] [${check.severity}] ${check.name}: ${check.message}${details}`);
  }

  const totals = checks.reduce(
    (acc, item) => {
      acc[item.status] += 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 }
  );

  console.log('');
  console.log(
    `Summary: pass=${totals.pass} warn=${totals.warn} fail=${totals.fail} (checks=${checks.length})`
  );
}

function shouldFailProcess() {
  const failed = checks.filter((item) => item.status === 'fail');
  if (!failed.length) return false;

  if (isStrict) return true;
  return failed.some((item) => item.severity === 'critical');
}

(async () => {
  checkNodeVersion();
  checkPlaywrightCli();

  checkCommand('mitmdump', {
    severity: 'low',
    versionCmd: 'mitmdump --version | head -n 1',
  });
  checkCommand('mitmweb', {
    severity: 'low',
    versionCmd: 'mitmweb --version | head -n 1',
  });
  checkCommand('jq', {
    severity: 'low',
    versionCmd: 'jq --version',
  });
  checkCommand('fd', {
    severity: 'low',
    versionCmd: 'fd --version | head -n 1',
    expected: 'Install via Homebrew: brew install fd',
  });
  checkCommand('bat', {
    severity: 'low',
    versionCmd: 'bat --version | head -n 1',
    expected: 'Install via Homebrew: brew install bat',
  });
  checkCommand('delta', {
    severity: 'low',
    versionCmd: 'delta --version | head -n 1',
    expected: 'Install via Homebrew: brew install git-delta',
  });
  checkCommand('http', {
    severity: 'low',
    versionCmd: 'http --version | head -n 1',
    expected: 'Install via Homebrew: brew install httpie',
  });
  checkCommand('gron', {
    severity: 'low',
    versionCmd: 'gron --version | head -n 1',
    expected: 'Install via Homebrew: brew install gron',
  });
  checkCommand('hyperfine', {
    severity: 'low',
    versionCmd: 'hyperfine --version | head -n 1',
    expected: 'Install via Homebrew: brew install hyperfine',
  });
  checkCommand('yq', {
    severity: 'low',
    versionCmd: 'yq --version',
  });
  checkCommand('k6', {
    severity: 'low',
    versionCmd: 'k6 version',
  });
  checkCommand('magick', {
    severity: 'low',
    versionCmd: 'magick -version | head -n 1',
  });
  checkCommand('adb', {
    severity: 'low',
    versionCmd: 'adb version | head -n 1',
  });
  checkCommand('scrcpy', {
    severity: 'low',
    versionCmd: 'scrcpy --version | head -n 1',
  });
  checkCommand('websocat', {
    severity: 'low',
    versionCmd: 'websocat --version | head -n 1',
  });
  checkCommand('tshark', {
    severity: 'low',
    versionCmd: 'tshark --version | head -n 1',
    expected:
      'Install Wireshark CLI (`brew install wireshark`). Optional GUI app: `brew install --cask wireshark-app`.',
  });
  checkCommand('schemathesis', {
    severity: 'medium',
    versionCmd: 'schemathesis --version || st --version',
    expected: 'Install via pipx (`pipx install schemathesis`) or pip (`pip install schemathesis`).',
  });
  checkCommand('spectral', {
    severity: 'medium',
    versionCmd: 'spectral --version',
    expected:
      'Install via npm (`npm i -D @stoplight/spectral-cli`) or globally (`npm i -g @stoplight/spectral-cli`).',
  });
  checkCommand('openapi-generator', {
    severity: 'low',
    versionCmd: 'openapi-generator version',
    expected: 'Install via Homebrew: brew install openapi-generator',
  });
  checkCommand('osv-scanner', {
    severity: 'medium',
    versionCmd: 'osv-scanner --version',
    expected: 'Install via Homebrew: brew install osv-scanner',
  });
  checkCommand('snyk', {
    severity: 'medium',
    versionCmd: 'snyk --version',
    expected: 'Install via Homebrew: brew install snyk-cli',
  });
  checkCommand('ffmpeg', {
    severity: 'low',
    versionCmd: 'ffmpeg -version | head -n 1',
  });
  checkCommand('actionlint', {
    severity: 'low',
    versionCmd: 'actionlint --version',
    expected: 'Install via Homebrew: brew install actionlint',
  });
  checkCommand('zizmor', {
    severity: 'medium',
    versionCmd: 'zizmor --version',
    expected: 'Install via Homebrew: brew install zizmor',
  });
  checkCommand('cosign', {
    severity: 'low',
    versionCmd: "cosign version --json 2>/dev/null | jq -r '.gitVersion'",
    expected: 'Install via Homebrew: brew install cosign',
  });
  checkCommand('shellcheck', {
    severity: 'low',
    versionCmd: 'shellcheck --version | head -n 1',
    expected: 'Install via Homebrew: brew install shellcheck',
  });
  checkCommand('hadolint', {
    severity: 'low',
    versionCmd: 'hadolint --version | head -n 1',
    expected: 'Install via Homebrew: brew install hadolint',
  });
  checkCommand('yamllint', {
    severity: 'low',
    versionCmd: 'yamllint --version',
    expected: 'Install via Homebrew: brew install yamllint',
  });
  checkCommand('semgrep', {
    severity: 'medium',
    versionCmd: 'semgrep --version',
    expected: 'Install via Homebrew: brew install semgrep',
  });
  checkCommand('trivy', {
    severity: 'medium',
    versionCmd: 'trivy --version | head -n 1',
    expected: 'Install via Homebrew: brew install trivy',
  });
  checkCommand('gitleaks', {
    severity: 'medium',
    versionCmd: 'gitleaks version',
    expected: 'Install via Homebrew: brew install gitleaks',
  });
  checkCommand('syft', {
    severity: 'low',
    versionCmd: 'syft version | head -n 1',
    expected: 'Install via Homebrew: brew install syft',
  });
  checkCommand('grype', {
    severity: 'low',
    versionCmd: 'grype version | head -n 1',
    expected: 'Install via Homebrew: brew install grype',
  });
  checkCommand('crane', {
    severity: 'low',
    versionCmd: 'crane version | head -n 1',
    expected: 'Install via Homebrew: brew install crane',
  });
  checkCommand('regctl', {
    severity: 'low',
    versionCmd: 'regctl version | head -n 1',
    expected: 'Install via Go: go install github.com/regclient/regclient/cmd/regctl@latest',
  });
  checkCommand('lychee', {
    severity: 'low',
    versionCmd: 'lychee --version',
    expected: 'Install via Homebrew: brew install lychee',
  });
  checkCommand('markdownlint-cli2', {
    severity: 'low',
    versionCmd: 'markdownlint-cli2 --version 2>&1 | head -n 1',
    expected: 'Install via Homebrew: brew install markdownlint-cli2',
  });
  checkCommand('watchexec', {
    severity: 'low',
    versionCmd: 'watchexec --version | head -n 1',
    expected: 'Install via Homebrew: brew install watchexec',
  });
  checkCommand('just', {
    severity: 'low',
    versionCmd: 'just --version',
    expected: 'Install via Homebrew: brew install just',
  });
  checkCommand('dive', {
    severity: 'low',
    versionCmd: 'dive version 2>/dev/null || dive --version',
    expected: 'Install via Homebrew: brew install dive',
  });
  checkCommand('oha', {
    severity: 'low',
    versionCmd: 'oha --version',
    expected: 'Install via Homebrew: brew install oha',
  });
  checkCommand('autocannon', {
    severity: 'low',
    versionCmd: 'autocannon --version | head -n 1',
    expected: 'Install via npm: npm install -g autocannon',
  });
  checkCommand('code', {
    severity: 'low',
    versionCmd: 'code --version | head -n 1',
    expected: 'Install VS Code and expose the `code` command in PATH.',
  });
  checkVsCodePlaywrightExtension();
  checkCommand('BrowserStackLocal', {
    severity: 'low',
    expected: 'Install via Homebrew cask: brew install --cask browserstacklocal',
  });
  checkNodePackage('browserstack-local', {
    severity: 'low',
    expected: 'Install via npm: npm install -D browserstack-local',
  });

  checkJavaRuntime();
  checkZap();
  checkDocker();

  await checkBrowserLaunchPreflight();

  const payload = {
    generatedAt: new Date().toISOString(),
    mode: isPreflight ? 'preflight' : 'audit',
    strict: isStrict,
    checks,
    summary: checks.reduce(
      (acc, item) => {
        acc[item.status] += 1;
        return acc;
      },
      { pass: 0, warn: 0, fail: 0 }
    ),
  };

  if (jsonOutput) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printHumanReport();
  }

  process.exit(shouldFailProcess() ? 1 : 0);
})();
