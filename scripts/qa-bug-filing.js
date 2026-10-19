#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseArgs(argv) {
  const args = {};
  for (const token of argv.slice(2)) {
    if (!token.startsWith('--')) continue;
    const trimmed = token.slice(2);
    const divider = trimmed.indexOf('=');
    if (divider === -1) {
      args[trimmed] = '1';
      continue;
    }
    const key = trimmed.slice(0, divider);
    const value = trimmed.slice(divider + 1);
    args[key] = value;
  }
  return args;
}

function oneLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function inferMode(runPath, brandSlug = '') {
  const slug = String(brandSlug || '').toLowerCase();
  if (slug.endsWith('-mobile')) return 'mobile';
  if (slug.endsWith('-desktop')) return 'desktop';
  if (/[\\/]mobile[\\/]/i.test(runPath)) return 'mobile';
  if (/[\\/]desktop[\\/]/i.test(runPath)) return 'desktop';
  return 'legacy';
}

function resolvePaths(runPath, runPayload) {
  const runAbs = path.resolve(runPath);
  const mode = inferMode(runAbs, runPayload.brandSlug);
  const historyRunsDir = path.dirname(runAbs);
  const historyDir = path.dirname(historyRunsDir);
  const artifactsDir = path.dirname(historyDir);
  const modeRoot = path.dirname(artifactsDir);
  const brandRoot = mode === 'legacy' ? modeRoot : path.dirname(modeRoot);
  const reportRoot =
    mode === 'legacy'
      ? path.join(brandRoot, 'Autotest report')
      : path.join(brandRoot, 'Autotest report', mode);
  const bugIndexFromRun =
    runPayload &&
    runPayload.artifacts &&
    runPayload.artifacts.bugsIndexJson &&
    runPayload.artifacts.bugsIndexJson.path
      ? String(runPayload.artifacts.bugsIndexJson.path)
      : '';
  const bugIndexPath = bugIndexFromRun || path.join(reportRoot, 'Bugs', 'index.json');
  const bugFilingDir = path.join(historyDir, 'bug-filing');
  return {
    mode,
    brandRoot,
    reportRoot,
    bugIndexPath,
    bugFilingDir,
    sentStatePath: path.join(bugFilingDir, 'sent-fingerprints.json'),
  };
}

function hashFingerprint(payload) {
  const raw = JSON.stringify(payload || {});
  return crypto.createHash('sha1').update(raw).digest('hex');
}

function bugFingerprint(runPayload, mode, bugEntry, bugMetadata) {
  return hashFingerprint({
    brand: oneLine(runPayload.brandSlug || ''),
    baseUrl: oneLine(runPayload.baseUrl || ''),
    mode: oneLine(mode),
    phase: oneLine(bugEntry.phase || ''),
    title: oneLine(bugEntry.title || ''),
    file: oneLine(bugEntry.file || ''),
    primaryNetwork: oneLine(
      (bugMetadata && bugMetadata.primaryNetwork && bugMetadata.primaryNetwork.url) || ''
    ),
  });
}

function markdownBody({ runPayload, mode, bugEntry, bugMetadata, runPath }) {
  const manual =
    bugMetadata && bugMetadata.manualReproduction ? bugMetadata.manualReproduction : {};
  const triage = bugMetadata && bugMetadata.triage ? bugMetadata.triage : {};
  const player = bugMetadata && bugMetadata.playerCredentials ? bugMetadata.playerCredentials : {};
  const playerPassword =
    process.env.QA_REPORT_INCLUDE_PLAYER_PASSWORD === '1'
      ? oneLine(player.password || 'Не найден')
      : 'Скрыт (доступен только в приватном отчёте)';
  const preconditions = Array.isArray(manual.preconditions) ? manual.preconditions : [];
  const steps = Array.isArray(manual.steps) ? manual.steps : [];
  const expected = oneLine(manual.expectedResult || '');
  const actual = oneLine(manual.actualResult || bugMetadata?.error || '');
  const command = oneLine(bugMetadata?.commandHint || '');
  const primaryNetwork = bugMetadata?.primaryNetwork || null;
  const networkLine = primaryNetwork
    ? `- URL: ${oneLine(primaryNetwork.url || '-')}\n- Method: ${oneLine(primaryNetwork.method || '-')}\n- Status: ${
        Number.isFinite(Number(primaryNetwork.status)) ? Number(primaryNetwork.status) : '-'
      }`
    : '- No primary network artifact';

  const stepLines =
    steps.length > 0
      ? steps.map((step, idx) => `${idx + 1}. ${step}`).join('\n')
      : '- No explicit repro steps.';
  const preconditionLines =
    preconditions.length > 0
      ? preconditions.map((item) => `- ${item}`).join('\n')
      : '- Не указаны.';
  const artifacts = [
    bugEntry.folder ? `- Folder: \`${bugEntry.folder}\`` : '',
    bugEntry.pdfPath ? `- PDF: \`${bugEntry.pdfPath}\`` : '',
    runPath ? `- Run history: \`${runPath}\`` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    `# ${oneLine(bugMetadata?.issueTitle || bugEntry.title || bugEntry.bugId || 'QA bug')}`,
    '',
    '## Триаж',
    `- Статус: ${oneLine(triage.workflowStatus || 'Нужен триаж')}`,
    `- Тип: ${oneLine(triage.type || '-')}`,
    `- Серьёзность: ${oneLine(triage.severity || '-')}`,
    `- Приоритет: ${oneLine(triage.priority || '-')}`,
    `- Компонент: ${oneLine(triage.component || bugEntry.phase || '-')}`,
    `- Подтверждение: ${oneLine(triage.confirmation || '-')}`,
    `- Воспроизводимость: ${oneLine(triage.reproducibility || '-')}`,
    '',
    '## Влияние',
    oneLine(triage.impact || '-'),
    '',
    '## Окружение',
    `- Brand: ${oneLine(runPayload.brandSlug || '-')}`,
    `- Base URL: ${oneLine(runPayload.baseUrl || '-')}`,
    `- Mode: ${oneLine(mode || '-')}`,
    `- Phase: ${oneLine(bugEntry.phase || '-')}`,
    `- Status: ${oneLine(bugEntry.status || '-')}`,
    `- Bug ID: ${oneLine(bugEntry.bugId || '-')}`,
    `- File: ${oneLine(bugEntry.file || '-')}`,
    '',
    '## Данные тестового игрока',
    `- Почта: ${oneLine(player.email || 'Не найдена')}`,
    `- Пароль: ${playerPassword}`,
    `- Источник: ${oneLine(player.source || 'Не указан')}`,
    `- Статус проверки входа: ${oneLine(player.validationStatus || 'Не указан')}`,
    '',
    '## Предусловия',
    preconditionLines,
    '',
    '## Шаги воспроизведения',
    stepLines,
    '',
    '## Ожидаемый результат',
    expected || '-',
    '',
    '## Фактический результат',
    actual || '-',
    '',
    '## Критерии приёмки',
    `- [ ] ${expected || 'Целевой сценарий работает без ошибки.'}`,
    '- [ ] Повторный автотест проходит без блокирующей аннотации.',
    '- [ ] Нет новых критичных ошибок в Console/Network.',
    '',
    '## Сеть',
    networkLine,
    '',
    '## Команда повтора',
    command || '-',
    '',
    '## Артефакты',
    artifacts || '-',
    '',
  ].join('\n');
}

function buildTicketPayload({ runPayload, mode, bugEntry, bugMetadata, runPath }) {
  const fingerprint = bugFingerprint(runPayload, mode, bugEntry, bugMetadata);
  const runId = oneLine(runPayload.runId || path.basename(runPath, '.json'));
  const phase = oneLine(bugEntry.phase || 'unknown');
  const title = oneLine(bugMetadata?.issueTitle || bugEntry.title || bugEntry.bugId || 'QA Bug');
  const shortTitle = `[${oneLine(runPayload.brandSlug || 'brand')}] [${oneLine(mode)}] [${phase}] ${title}`;
  const body = markdownBody({ runPayload, mode, bugEntry, bugMetadata, runPath });
  return {
    runId,
    fingerprint,
    title: shortTitle,
    body,
    labels: [
      'qa-auto',
      `brand:${oneLine(runPayload.brandSlug || 'unknown')}`,
      `mode:${oneLine(mode || 'legacy')}`,
      `phase:${phase}`,
      bugMetadata?.triage?.severity
        ? `severity:${oneLine(bugMetadata.triage.severity).split(' ')[0].toLowerCase()}`
        : '',
    ].filter(Boolean),
    bug: {
      bugId: oneLine(bugEntry.bugId || ''),
      phase,
      status: oneLine(bugEntry.status || ''),
      file: oneLine(bugEntry.file || ''),
      folder: oneLine(bugEntry.folder || ''),
      pdfPath: oneLine(bugEntry.pdfPath || ''),
      title,
      error: oneLine((bugMetadata && bugMetadata.error) || ''),
      primaryNetwork:
        bugMetadata && typeof bugMetadata.primaryNetwork === 'object'
          ? bugMetadata.primaryNetwork
          : null,
    },
    run: {
      brandSlug: oneLine(runPayload.brandSlug || ''),
      baseUrl: oneLine(runPayload.baseUrl || ''),
      mode: oneLine(mode || ''),
      runPath,
      timestamp: oneLine(runPayload.timestamp || ''),
      status: oneLine(runPayload.runStatus || ''),
    },
  };
}

function loadBugEntries(bugIndexPath) {
  const bugIndex = readJson(bugIndexPath);
  if (!bugIndex || !Array.isArray(bugIndex.bugs)) return [];
  return bugIndex.bugs
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      ...item,
      bugId: oneLine(item.bugId || ''),
      folder: oneLine(item.folder || ''),
      pdfPath: oneLine(item.pdfPath || ''),
      title: oneLine(item.title || ''),
      phase: oneLine(item.phase || ''),
      status: oneLine(item.status || ''),
      file: oneLine(item.file || ''),
    }))
    .filter((item) => item.bugId);
}

function loadBugMetadata(bugEntry) {
  if (!bugEntry.folder) return {};
  const metadataPath = path.join(bugEntry.folder, 'bug.json');
  return readJson(metadataPath) || {};
}

function loadSentState(sentStatePath) {
  const payload = readJson(sentStatePath);
  if (!payload || !Array.isArray(payload.sent)) {
    return { updatedAt: '', sent: [] };
  }
  return {
    updatedAt: oneLine(payload.updatedAt || ''),
    sent: payload.sent
      .map((item) => ({
        fingerprint: oneLine(item.fingerprint || ''),
        bugId: oneLine(item.bugId || ''),
        runId: oneLine(item.runId || ''),
        endpoint: oneLine(item.endpoint || ''),
        pushedAt: oneLine(item.pushedAt || ''),
        ok: Boolean(item.ok),
        status: Number.isFinite(Number(item.status)) ? Number(item.status) : 0,
      }))
      .filter((item) => item.fingerprint),
  };
}

async function pushTicket(endpoint, token, payload) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        source: 'qa-assistant',
        payload,
      }),
    });
    const text = await response.text().catch(() => '');
    return {
      ok: response.ok,
      status: Number(response.status || 0),
      response: oneLine(text),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      response: oneLine(error && error.message ? error.message : error),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const runArg = oneLine(args.run || '');
  if (!runArg) {
    console.error(
      'Usage: node scripts/qa-bug-filing.js --run=/abs/path/to/run-history.json [--push=1]'
    );
    process.exit(2);
  }

  const runPath = path.resolve(runArg);
  const runPayload = readJson(runPath);
  if (!runPayload || typeof runPayload !== 'object') {
    console.error(`Run history is missing or malformed: ${runPath}`);
    process.exit(2);
  }

  const paths = resolvePaths(runPath, runPayload);
  const bugEntries = loadBugEntries(paths.bugIndexPath);
  const runId = oneLine(runPayload.runId || path.basename(runPath, '.json'));
  const generatedAt = new Date().toISOString();
  const queuePath = path.join(
    paths.bugFilingDir,
    `${generatedAt.replace(/[:.]/g, '-')}-${runId || 'run'}.json`
  );
  const strict = process.env.QA_BUG_AUTOFILING_STRICT === '1';
  const shouldPush =
    args.push === '1' || args.push === 'true' || process.env.QA_BUG_AUTOFILING === '1';
  const endpoint = oneLine(process.env.QA_BUG_AUTOFILING_ENDPOINT || '');
  const token = oneLine(process.env.QA_BUG_AUTOFILING_TOKEN || '');
  const skipAlreadySent = process.env.QA_BUG_AUTOFILING_SKIP_SENT !== '0';
  const sentState = loadSentState(paths.sentStatePath);
  const sentFingerprints = new Set(sentState.sent.map((item) => item.fingerprint));

  const tickets = [];
  const seenInRun = new Set();
  for (const bugEntry of bugEntries) {
    const bugMetadata = loadBugMetadata(bugEntry);
    const ticket = buildTicketPayload({
      runPayload,
      mode: paths.mode,
      bugEntry,
      bugMetadata,
      runPath,
    });
    if (!ticket.fingerprint || seenInRun.has(ticket.fingerprint)) continue;
    seenInRun.add(ticket.fingerprint);
    if (skipAlreadySent && sentFingerprints.has(ticket.fingerprint)) continue;
    tickets.push(ticket);
  }

  const queuePayload = {
    generatedAt,
    runId,
    runPath,
    bugIndexPath: paths.bugIndexPath,
    mode: paths.mode,
    brandSlug: oneLine(runPayload.brandSlug || ''),
    baseUrl: oneLine(runPayload.baseUrl || ''),
    totalBugs: bugEntries.length,
    queued: tickets.length,
    pushRequested: shouldPush,
    endpoint: endpoint || '',
    tickets,
  };
  writeJson(queuePath, queuePayload);
  console.log(`Bug filing queue: ${queuePath}`);
  console.log(`Queued tickets: ${tickets.length} (from ${bugEntries.length} bug dossiers)`);

  if (!shouldPush) return;
  if (!endpoint) {
    const message = 'QA_BUG_AUTOFILING_ENDPOINT is not configured; skipping push.';
    if (strict) {
      console.error(message);
      process.exit(1);
    }
    console.log(`⚠️  ${message}`);
    return;
  }

  let failed = 0;
  const pushedItems = [];
  for (const ticket of tickets) {
    const pushed = await pushTicket(endpoint, token, ticket);
    pushedItems.push({
      fingerprint: ticket.fingerprint,
      bugId: ticket.bug.bugId,
      runId: ticket.runId,
      endpoint,
      pushedAt: new Date().toISOString(),
      ok: pushed.ok,
      status: pushed.status,
    });
    if (!pushed.ok) {
      failed += 1;
      console.log(
        `⚠️  Push failed for ${ticket.bug.bugId || ticket.fingerprint}: status=${pushed.status}, response=${pushed.response || '-'}`
      );
    }
  }

  const nextState = {
    updatedAt: new Date().toISOString(),
    sent: [...sentState.sent, ...pushedItems.filter((item) => item.ok)].slice(-5000),
  };
  writeJson(paths.sentStatePath, nextState);
  console.log(`Bug filing push: ${tickets.length - failed}/${tickets.length} successful.`);

  if (failed > 0 && strict) process.exit(1);
}

main().catch((error) => {
  console.error(oneLine(error && error.message ? error.message : error));
  process.exit(1);
});
