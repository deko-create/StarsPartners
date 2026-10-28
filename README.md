# QA Assistant

Автоматизация QA на базе Playwright для мультибренд-проектов (`gt.bet`, `likes.bet`, `booms.bet`, `nix.bet`, `starzino.com`, `igo.bet`, `chacha.bet`) с precheck, разделением suite-уровней, AI-генерацией тестов и CI-пайплайнами.

По умолчанию все generated-файлы (reports, artifacts, screenshots, bugs, phase json) сохраняются в:

`projects/<brand-slug>/`

Для `https://gt.bet` это:

`projects/gt.bet/`

Для `https://likes.bet` это:

`projects/likes.bet/`

Для `https://booms.bet` это:

`projects/booms.bet/`

Для `https://nix.bet` это:

`projects/nix.bet/`

Для `https://starzino.com` это:

`projects/starzino.com/`

Для `https://igo.bet` это:

`projects/igo.bet/`

Для `https://chacha.bet` это:

`projects/chacha.bet/`

Для прогонов по режимам (`desktop`/`mobile`) структура теперь такая:

1. Runtime workspace (test-results, artifacts, analyze) по режимам:
   `projects/<brand>/<desktop|mobile>/`
2. Единый хаб отчетов бренда (в одном месте):
   `projects/<brand>/Autotest report/`
3. Внутри хаба отчеты и баг-репорты разложены по режимам:
   `projects/<brand>/Autotest report/<desktop|mobile>/`
4. Быстрая навигация:
   `projects/<brand>/Autotest report/index.md`

## Требования

1. Node.js `24.x` LTS (текущий пин: `24.18.0` в `.nvmrc`/`.node-version`)
2. npm `12.x`
3. Установленные браузеры Playwright

## Быстрый старт

```bash
nvm use # или fnm/volta/asdf, чтобы активировать версию из .nvmrc
npm ci
npx playwright install
cp .env.example .env
```

После этого заполните переменные в `.env`.

Опционально можно явно задать workspace для артефактов:

```bash
# по умолчанию: ./projects/<brand-slug>
QA_PROJECT_ROOT=/Users/you/qa-assistant/projects/gt.bet
QA_PROJECT_SLUG=gt.bet
```

## Структура suites

1. `tests/smoke` — быстрые базовые проверки.
2. `tests/critical` — ключевые бизнес-флоу, включая единый full-check.
3. `tests/destructive` — сценарии с потенциальными побочными эффектами (например, регистрация).
4. `tests/ai` — автосгенерированные AI-тесты P0/P1/P2.

Дополнительно в `tests/critical/auth-site-regression.spec.js` добавлен расширенный coverage-suite:

1. P0: auth contract, access matrix, sidebar feature checks, Cloudflare classification, referral smoke.
2. P1: session persistence, network baseline, footer/legal integrity, metadata quality.
3. P2: 404 contract, visual smoke (desktop/mobile), localization smoke.

Артефакты suite сохраняются в `Autotest report/` и `Autotest report/visual-smoke-auth/`.

Также добавлен `tests/critical/profile-sections.spec.js`:

1. P0: доступность profile-маршрутов для authorized, навигация по вкладкам профиля, smoke разделов Account details/Security center.
2. P1: profile save persistence, field validations, preferences persistence, wallet/bets/referral smoke.
3. P2: visual smoke (desktop/mobile), profile a11y smoke, WAF diagnostics и классификация blocked.

Артефакты suite сохраняются в `Autotest report/my-profile/`.

Также добавлен `tests/critical/button-sweep.spec.js`:

1. `guest` режим: обходит внутренние страницы и прокликивает видимые кнопки.
2. `authorized` режим: делает тот же обход после регистрации и сохранения auth state.
3. Артефакты сохраняются в `Autotest report/button-sweep/`.

Также добавлен `tests/critical/deposit-non-destructive.spec.js`:

1. Открывает `Wallet/Deposit` в authorized-режиме без выполнения реального депозита.
2. Находит доступные методы оплаты и проверяет, что каждый метод можно выбрать.
3. Сохраняет артефакты в `Autotest report/deposit/` и прикладывает сетевую диагностику.

Также добавлен `tests/critical/casino-catalog.spec.js`:

1. P0: Search modal open/close, search query, no-results, filter providers apply/clear, switch tabs (Providers/Category/Collections).
2. P1: category chips flow, combined search+filter flow, filter persistence model across reloads, `LOAD MORE`, game launch in demo (`Try for Fun`) и non-demo (`Play`) режимах.
3. P2: visual smoke для `Casino` (desktop/mobile, default/search/filter).
4. Артефакты сохраняются в `Autotest report/casino/`.

Также добавлен `tests/critical/casino-providers-real.spec.js`:

1. P0: собирает полный inventory провайдеров из Casino-фильтра (Providers tab) и сохраняет список.
2. P1: запускает отдельный тест на каждого провайдера в режиме `Play` (НЕ demo) на desktop и mobile (если включено), проверяет запуск игры, health game surface и безопасные in-game controls.
3. Для каждого провайдера проверяется запуск одной или нескольких игр (по env-конфигу), а не только первой карточки.
4. Добавлены проверки: соответствие карточек выбранному provider-фильтру, диагностика `4xx/5xx`, `requestfailed`, console errors на запуске игры.
5. Добавлен retry-механизм для провайдера с flaky-диагностикой (включается через env).
6. Артефакты сохраняются в `Autotest report/casino/providers-real/` (`providers-inventory.md`, `providers-real-matrix.md`, JSON с деталями).
7. Профили провайдеров: `PW_PROVIDER_PROFILE=smoke|extended|nightly` (по умолчанию `smoke`).
8. `smoke` по умолчанию ограничивает матрицу (`PW_PROVIDER_MAX=12`), `extended` расширяет матрицу (`PW_PROVIDER_MAX=40`, для `gt.bet/nix.bet` — `50`), `nightly` — без лимита (`PW_PROVIDER_MAX=0`).
9. Таймаут одного provider-теста: `PW_PROVIDER_TEST_TIMEOUT=240000` (мс, по умолчанию 4 минуты).
10. Количество игр: `PW_PROVIDER_DESKTOP_GAMES=2` (для `nix.bet` по умолчанию `1`), `PW_PROVIDER_MIN_GAMES=1`, `PW_PROVIDER_MOBILE_GAMES=1`.
11. Mobile-проход: `PW_PROVIDER_ENABLE_MOBILE=1` (по умолчанию выключен).
    11.1 Mobile-only режим для provider real launch: `PW_PROVIDER_ONLY_MOBILE=1`.
12. Retry: `PW_PROVIDER_RETRY_ON_FAIL=0` по умолчанию; включается через `PW_PROVIDER_RETRY_ON_FAIL=1`.
13. Таймаут режима (desktop/mobile): `PW_PROVIDER_MODE_TIMEOUT=60000` (мс, по умолчанию 60 секунд).

`tests/ai/p0.spec.js`, `tests/ai/p1.spec.js`, `tests/ai/p2.spec.js` приведены к исполняемому Playwright-формату (без markdown/прозы).

## Основные команды

```bash
# готовые команды по брендам
npm run qa:doctor
npm run qa:doctor:preflight
npm run qa:audit:deep
npm run qa:tools:install                 # core tools
bash scripts/tools/install-qa-extras.sh mobile
bash scripts/tools/install-qa-extras.sh performance
bash scripts/tools/install-qa-extras.sh dev
npm run qa:dashboard
npm run qa:allure:test                  # прогон с Allure results
npm run qa:allure:generate              # собрать статический Allure report
npm run qa:allure:open                  # открыть собранный Allure report
npm run qa:all:smoke
npm run qa:all:extended
npm run qa:all:gt
npm run qa:all:likes
npm run qa:all:booms
npm run qa:all:nix
npm run qa:all:starzino
npm run qa:all:igo
npm run qa:all:chacha
npm run qa:all:casho
# отдельные full-run команды по режимам (desktop/mobile) для каждого бренда
npm run qa:all:gt:desktop
npm run qa:all:gt:mobile
npm run qa:all:likes:desktop
npm run qa:all:likes:mobile
npm run qa:all:booms:desktop
npm run qa:all:booms:mobile
npm run qa:all:nix:desktop
npm run qa:all:nix:mobile
npm run qa:all:starzino:desktop
npm run qa:all:starzino:mobile
npm run qa:all:igo:desktop
npm run qa:all:igo:mobile
npm run qa:all:chacha:desktop
npm run qa:all:chacha:mobile
npm run qa:all:casho:desktop
npm run qa:all:casho:mobile
# полный прогон всех брендов отдельно по desktop и mobile
npm run qa:all:brands:desktop
npm run qa:all:brands:mobile
# разделенные прогоны (core/providers) по всем брендам
npm run qa:all:brands:desktop:core
npm run qa:all:brands:mobile:core
npm run qa:all:brands:desktop:providers
npm run qa:all:brands:mobile:providers
# session prep перед full-run (manual headed challenge/login)
npm run qa:session:prep:all:desktop
npm run qa:session:prep:all:mobile
# пример на одном бренде
npm run qa:session:prep:gt:mobile
npm run qa:all:gt:mobile:core
npm run qa:all:gt:mobile:providers
# dry-run (проверка матрицы брендов/путей без запуска тестов)
node scripts/qa-brand-run.js --brand=all --mode=desktop --dry-run=1
node scripts/qa-brand-run.js --brand=all --mode=mobile --dry-run=1

# Все перечисленные локальные brand-run команды (desktop/mobile, full/core/providers)
# по умолчанию используют native Chrome + один persistent CDP context на бренд.
# Старые изолированные Playwright contexts — только для сравнения/диагностики.
PW_CDP_REUSE_CONTEXT=0 npm run qa:all:gt:desktop
npm run qa:precheck:gt
npm run qa:precheck:likes
npm run qa:precheck:booms
npm run qa:precheck:nix
npm run qa:precheck:starzino
npm run qa:precheck:igo
npm run qa:precheck:chacha
npm run qa:providers:gt
npm run qa:providers:likes
npm run qa:providers:booms
npm run qa:providers:nix
npm run qa:providers:starzino
npm run qa:providers:igo
npm run qa:providers:chacha
npm run qa:forgot-password
npm run save:state:gt
npm run save:state:likes
npm run save:state:booms
npm run save:state:nix
npm run save:state:starzino
npm run save:state:igo
npm run save:state:chacha
npm run qa:yq:version
npm run qa:k6:version
npm run qa:imagemagick:version

# универсально через BASE_URL (любой бренд)
# пример:
BASE_URL=https://likes.bet npm run qa:all

# сохранить storage state (ручной/авто режим)
npm run save:state -- https://gt.bet/ storageState.json --auto

# precheck
npm run qa:precheck

# suite-раны
npm run qa:smoke
npm run qa:critical
npm run qa:fullcheck
npm run qa:destructive
npm run qa:forgot-password

# AI генерация + прогон tests/ai
npm run qa:ai

# полный QA-ран (precheck -> AI -> smoke+critical -> report)
# включает:
# 1) cleanup зависших browser-процессов
# 2) preflight QA Doctor (Node LTS + browser launch sanity)
# 3) run-history snapshot
# 4) auto-генерацию dashboard (projects/dashboard/qa-trends.md|html)
npm run qa:all

# project-matrix для qa:all (desktop+mobile)
PW_PROJECT_MATRIX=desktop,mobile npm run qa:all
# desktop-only прогон (быстрее)
PW_PROJECT_MATRIX=desktop npm run qa:all
# готовый npm script для matrix прогона
npm run qa:all:matrix

# готовый раннер брендов с изоляцией по режимам
# runtime каждого режима пишет в:
# projects/<brand>/<desktop|mobile>/
# а отчеты/баги в единый хаб бренда:
# projects/<brand>/Autotest report/<desktop|mobile>/
npm run qa:all:brands:desktop
npm run qa:all:brands:mobile

# авто-режим Cloudflare обхода (refresh storageState + webkit fallback)
PW_AUTO_SAVE_STATE=1 PW_CF_PREFER_WEBKIT=1 npm run qa:all

# добавить destructive в полный ран
PW_INCLUDE_DESTRUCTIVE=1 npm run qa:all

# accessibility smoke (axe)
npm run qa:a11y
# strict-mode: падать при critical a11y нарушениях
PW_A11Y_STRICT=1 npm run qa:a11y

# ограничители button sweep (по умолчанию 12 роутов x 15 кнопок на роут)
PW_BUTTON_MAX_ROUTES=50 PW_BUTTON_MAX_BUTTONS=50 npm run qa:all

# provider-профили
PW_PROVIDER_PROFILE=smoke npm run qa:all      # быстрый профиль (по умолчанию)
PW_PROVIDER_PROFILE=extended npm run qa:all   # расширенная матрица провайдеров
PW_PROVIDER_PROFILE=nightly npm run qa:all    # полный обход без лимита provider max

# нативные Playwright HTML + JUnit + JSON reports
npm run qa:report:native

# Playwright UI / Trace
npm run qa:ui
npm run qa:trace -- path/to/trace.zip
npm run qa:trace:summary -- path/to/trace.zip

# Lighthouse / LHCI (reports -> artifacts/lighthouse)
npm run qa:lighthouse
npm run qa:lighthouse:collect
npm run qa:lighthouse:assert

# Visual smoke + snapshot regression
npm run qa:visual:update  # первый прогон / обновить baseline snapshots
npm run qa:visual
npm run qa:visual:baseline:update -- --brand=gt --mode=desktop --browser=chromium

# отчёт из test-results/report.json
npm run qa:report

# группировка скриншотов + Fail + Bugs (pdf досье)
npm run qa:artifacts
npm run qa:bugs:file -- --run=projects/<brand>/<mode>/artifacts/history/runs/<run>.json --push=1

# PDF-отчёт в project workspace по имени бренда
# пример для BASE_URL=https://gt.bet/ -> projects/gt.bet/Autotest report/gt.bet.pdf
# дополнительно сохраняются projects/gt.bet/qa-report.md|html
# и projects/gt.bet/Autotest report/gt.bet.md|html
npm run qa:report

# lint/format quality gates
npm run quality

# Network/security diagnostics
npm run qa:mitm:start
npm run qa:mitm:web
npm run qa:zap:baseline -- https://gt.bet/
npm run qa:zap:baseline:docker -- https://gt.bet/
npm run qa:lighthouse:docker           # docker collect smoke (1 URL)
npm run qa:lighthouse:docker:autorun
npm run qa:docker:zap
npm run qa:docker:lighthouse

# heavy-suite sharding examples
npm run qa:all:sharded:sports:1of2
npm run qa:all:sharded:sports:2of2
npm run qa:all:sharded:casino:1of2
npm run qa:all:sharded:casino:2of2
npm run qa:localization:all:desktop:full:shard1
npm run qa:localization:all:desktop:full:shard2

# release/versioning (GitHub Actions)
# 1) Run "Release Tagger" workflow and choose patch/minor/major
# 2) New vX.Y.Z tag will trigger "Release On Tag" workflow automatically
```

## Release flow (автоматическая версия и релиз)

1. В GitHub Actions запусти workflow `Release Tagger`.
2. Выбери `bump`: `patch`, `minor` или `major`.
3. Workflow создаст и запушит новый тег `vX.Y.Z`.
4. По пушу тега автоматически стартует `Release On Tag`.
5. `Release On Tag` публикует GitHub Release с auto-generated release notes.
6. Для ручной публикации существующего тега можно запустить `Release On Tag` через `workflow_dispatch` и передать `tag`.

Docker-based security/perf слой:

1. `scripts/tools/zap-baseline-docker.sh` — baseline ZAP scan в контейнере.
2. `scripts/tools/lighthouse-docker.sh` — Lighthouse/LHCI в контейнере.
3. `docker/qa-stack/docker-compose.yml` — compose-профили `zap` и `lighthouse`.

## Поведение precheck и state refresh

`qa:all` пытается обновить `storageState` автоматически (по умолчанию включено):

```bash
PW_AUTO_SAVE_STATE=1 npm run qa:all
```

Отключить авто-refresh:

```bash
PW_AUTO_SAVE_STATE=0 npm run qa:all
```

Дополнительный таймаут авто-ожидания:

```bash
PW_SAVE_STATE_TIMEOUT=120 npm run qa:all
```

Для брендов с частыми challenge можно принудить ручной headed pre-login перед full-run:

```bash
PW_REQUIRE_HEADED_LOGIN_BEFORE_RUN=1 npm run qa:all
# строгий режим: остановить ран, если pre-login не удался
PW_REQUIRE_HEADED_LOGIN_BEFORE_RUN=1 PW_REQUIRE_HEADED_LOGIN_STRICT=1 npm run qa:all
```

Для повышения стабильности против anti-bot в локальных прогонах:

```bash
# 1) подготовить session/state вручную (один раз перед прогоном)
npm run qa:session:prep:gt:desktop

# 2) выполнить full core-run
npm run qa:all:gt:desktop:core

# 3) отдельно выполнить providers-run на уже прогретой сессии
npm run qa:all:gt:desktop:providers
```

Что включено в этом режиме:

- `saveState` использует persistent browser profile (`projects/<brand>/.pw-profile/<mode>`), чтобы лучше удерживать challenge/session cookies.
- После успешного headed pre-login `qa:all` не делает лишний auto-refresh перед precheck (чтобы не перезатирать свежую сессию).
- На challenge-сигнал запускается `challenge-aware rerun` (refresh + retry с backoff), затем прогон продолжается с диагностикой blocked/infra-blocked.

В CI авто-refresh `storageState` пропускается, чтобы не зависать на challenge.

`qa:all` запускает ordered suites с `PW_PROJECT_MATRIX=desktop` по умолчанию.
Для запуска desktop+mobile используйте `PW_PROJECT_MATRIX=desktop,mobile` или `npm run qa:all:matrix`.
Precheck по умолчанию использует `PW_PRECHECK_PROJECT_MATRIX=desktop`.

Если Cloudflare продолжает блокировать Chromium, включён fallback на WebKit:

```bash
PW_CF_PREFER_WEBKIT=1 npm run qa:all
```

`qa:all` по умолчанию включает `PW_WAF_DIAGNOSTIC=1`, поэтому WAF-блокировки в тестах классифицируются как диагностические сигналы.
В `qa-report` дополнительно выделяются типы блокировок:
`infra blocked` (инфраструктурные причины), `product blocked` (surface/layout причины), `n/a` (опциональная capability для бренда из brand matrix).

Матрица бренд-способностей находится в `tests/helpers/brand-capabilities.js`.
Если фича реально опциональна на бренде (например, `live casino` route alias или guest login/signup entries в sidebar),
она маркируется как `n/a` + `partial`, а не как `blocked`.

## AI генерация

По умолчанию `qa:all` не запускает AI пайплайн `analyze/runAll.js`.

```bash
# включить AI этап
PW_USE_AI_GENERATION=1 npm run qa:all

# сделать AI этап обязательным (фейлить ран при ошибке AI)
PW_AI_REQUIRED=1 npm run qa:all
```

## Проверка Log In

`tests/critical/login-auth.spec.js` работает в двух режимах:

1. Если заданы `LOGIN_EMAIL` и `LOGIN_PASSWORD` — проверяется успешный логин (2xx от auth API).
2. Если env-креды не заданы, тест берёт данные из `artifacts/last-registered-player.json` (последний зарегистрированный игрок).
3. Если Cloudflare Turnstile блокирует отправку логина (`Verify you are human`), тест фиксирует outcome как `blocked` (без `skip`) и прикладывает сетевую диагностику.

## Forgot Password (Gmail API)

`tests/destructive/forgot-password.spec.js` автоматизирует E2E сценарий восстановления пароля:

1. Открывает `Forgot password` из login flow.
2. Отправляет reset-запрос на email зарегистрированного игрока.
3. Читает письмо через Gmail API (Google Workspace / `@stars-partners.com`).
4. Извлекает reset-link, открывает его и задаёт новый пароль.
5. Валидирует новый пароль через sign-in (`cdp-signin-turnstile`) и обновляет player artifacts.

Обязательные env-переменные для Gmail API:

- `GMAIL_USER`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

Опциональные таймауты:

- `PW_FORGOT_PASSWORD_MAIL_TIMEOUT` (по умолчанию `240000`)
- `PW_FORGOT_PASSWORD_MAIL_POLL` (по умолчанию `5000`)

## Accessibility smoke

`tests/smoke/a11y-smoke.spec.js` запускается всегда в основном прогоне:

1. По умолчанию тест не блокирует ран, но сохраняет `a11y-summary.json` с количеством `critical/serious` нарушений.
2. Для строгого режима и падения при `critical` используйте `PW_A11Y_STRICT=1`.

## Daily/Nightly профили

1. Daily CI (`.github/workflows/qa-ci.yml`) использует `button-sweep` лимиты `12 x 15`, `PW_PROVIDER_PROFILE=smoke`, без destructive.
2. Nightly CI (`.github/workflows/qa-nightly.yml`) использует deep-профиль: `50 x 50`, depth `5`, `PW_PROVIDER_PROFILE=extended|nightly`, с destructive.

## Данные зарегистрированного игрока

После успешной регистрации данные игрока сохраняются в:

1. `test-results/registration-data.json` (данные текущего прогона)
2. `artifacts/last-registered-player.json` (стабильный файл для следующих прогонов и login-теста)

## Скриншоты и баг-досье

После `qa:all` автоматически выполняется `scripts/qa-artifacts.js`:

1. Все найденные скриншоты группируются в `projects/<brand-slug>/Autotest report/Screenshots/All/`.
2. Скриншоты падений (`failed/timedOut/interrupted`) копируются в `projects/<brand-slug>/Autotest report/Screenshots/Fail/<bug-id>/`.
3. Если скриншот падения недоступен в артефактах, в `Fail/<bug-id>/` создается `NO_SCREENSHOT.txt`.
4. Для каждого hard-fail создается папка `projects/<brand-slug>/Autotest report/Bugs/<bug-id>/` c:
   - `bug.pdf` и `bug.md` (описание бага, шаги воспроизведения, фактический результат),
   - `network-evidence.json` (сетевые зацепки),
   - `logs.txt` (логи финальной попытки),
   - `evidence/` (приложенные артефакты теста).

Авто-файлинг багов из run history:

1. `qa:all` формирует очередь в `projects/<brand>/<mode>/artifacts/history/bug-filing/`.
2. Для push в внешний трекер задайте:
   - `QA_BUG_AUTOFILING=1`
   - `QA_BUG_AUTOFILING_ENDPOINT=https://<tracker-webhook>`
   - `QA_BUG_AUTOFILING_TOKEN=<token>` (опционально)
3. Строгий режим (`QA_BUG_AUTOFILING_STRICT=1`) фейлит ран при ошибке push.

Централизация run/event логов:

1. `npm run qa:logs:index` собирает `qa-run`, `qa-phase`, `qa-artifact`, `qa-kpi` события.
2. `npm run qa:logs:index:push` отправляет NDJSON в Loki (`LOKI_PUSH_URL`).

## Lint и pre-commit

В проект добавлены:

1. `eslint` (+ правила для Playwright)
2. `prettier`
3. `husky` + `lint-staged`

После `npm install` активируйте husky:

```bash
npm run prepare
```

Дополнительные проверки качества:

```bash
npm run env:check       # загрузка и проверка .env средствами Node.js
npm run unit            # быстрые unit-тесты без браузера
npm run unit:coverage   # unit-тесты со встроенным coverage Node.js
npm run arch:check      # архитектурные границы и циклические зависимости
npm run quality:strict  # полный статический quality gate
```

## Дополнительные интеграции

Установлены и готовы к подключению:

1. BrowserStack (`browserstack-node-sdk`)
   Команды:
   - `npm run qa:browserstack`
   - `npm run qa:browserstack:desktop`
   - `npm run qa:browserstack:mobile`
     Конфиг: `browserstack.yml`

2. MailSlurp (`mailslurp-client`)
   Команда:
   - `npm run qa:mailslurp:health`
     Нужен `MAILSLURP_API_KEY`.

3. Sentry + OpenTelemetry
   Команды:
   - `npm run qa:telemetry:smoke`
   - `npm run qa:all:telemetry`  
     Скрипты:
   - `scripts/telemetry.js`
   - `scripts/telemetry-bootstrap.js`
   - `scripts/tools/telemetry-smoke.js`

4. Grafana Alloy + Loki/Grafana observability stack
   Команды:
   - `npm run qa:observability:up`
   - `npm run qa:observability:status`
     Конфиг: `docker/observability/alloy-config.river`

5. Cloudflare Turnstile test-mode (QA/staging)
   Переменные добавлены в `.env.example`:
   - `CF_TURNSTILE_SITE_KEY`
   - `CF_TURNSTILE_SECRET_KEY`
   - `CF_TURNSTILE_TEST_MODE`
   - `PW_QA_BYPASS_HEADER_NAME`
   - `PW_QA_BYPASS_HEADER_VALUE`
   - `PW_EXTRA_HTTP_HEADERS_JSON`
   - `CF_ACCESS_CLIENT_ID`
   - `CF_ACCESS_CLIENT_SECRET`

   Для стабильных E2E-прогонов используйте Cloudflare skip/challenge-bypass rule на стороне
   зоны: доверенный QA IP + секретный header. Playwright автоматически прокидывает header из
   `PW_QA_BYPASS_HEADER_NAME/PW_QA_BYPASS_HEADER_VALUE` в стандартные browser contexts.
   Если зона использует Cloudflare Access, задайте пару `CF_ACCESS_CLIENT_ID` и
   `CF_ACCESS_CLIENT_SECRET`; runner автоматически отправит стандартные service-token headers.

## Безопасность

1. Не храните реальные токены и секреты в git.
2. Используйте `.env.example` как шаблон.
3. Не коммитьте `storageState.json`, `test-results/`, `playwright-report/`, `analyze/runs/`.
