# CrazyKing — exploratory testing report

Дата: 2026-11-18  
Стенд: `https://crazyking.bet/?targaryen`  
Дизайн: Figma, node `22219:208834`  
Платформы: desktop 1470×956, mobile 390×844  
Режимы: гость и авторизованный тестовый игрок.

## Итог

- Проверены основные страницы, меню, каталог казино и Live Casino, поиск, фильтры, demo-игра, sportsbook и betslip до размещения ставки, promotions, collections, VIP, PWA, affiliate, guide, юридические страницы, регистрация и валидации, login, invite, missions, wheel, store и live chat.
- После повторной попытки вход выполнен успешно. Дополнительно проверены профиль, бонусы, рефералы, кошелёк, история ставок, настройки, безопасность, favourites/recent и авторизованные разделы Smartico на desktop и mobile.
- Найдено 16 продуктовых/технических дефектов и 8 отдельных дизайн-расхождений.
- Критический пользовательский риск: русская локаль полностью неработоспособна.
- Авторизация нестабильна: первая серия попыток блокировалась Turnstile, но последующая повторная попытка с теми же валидными данными завершилась успешно.
- Реальные ставки, депозит, вывод, смена пароля, отправка сообщений и создание нового аккаунта не выполнялись.

## Функциональные и технические дефекты

### CK-FUNC-001 — P0 — русская локаль отображает translation keys

**Шаги:** открыть `https://crazyking.bet/?targaryen`; сайт перенаправляет на `/ru/?targaryen` при русской локали браузера.

**Факт:** title страницы — `404 Error`; вместо подписей видны `site_header.*`, `category.*`, `games_by_category.*`, `site_footer.*`, `seo_content.*` и десятки других ключей. Основной контент при этом отвечает HTTP 200.

**Ожидание:** корректно локализованный интерфейс и релевантный title.

**Доказательство:** [guest-home-ru-localization-broken.png](../output/playwright/crazyking/guest-home-ru-localization-broken.png)

### CK-FUNC-002 — P1 — нестабильная авторизация через Turnstile

**Шаги:** открыть Log In, ввести валидные данные тестового игрока, нажать Log In.

**Факт:** первая серия попыток оставляла форму открытой; в консоли появлялись `TurnstileError 300010`, ошибки `postMessage` из-за несовпадения origin, а `/api/auth/signin` отвечал HTTP 400. При повторной проверке позднее вход с теми же данными прошёл успешно.

**Ожидание:** Turnstile получает валидный токен, пользователь авторизуется.

**Влияние:** пользователь может получить ложный отказ во входе при валидных данных; дефект интермиттирующий.

**Доказательства:** [login-turnstile-failed.png](../output/playwright/crazyking/login-turnstile-failed.png), [authorized-home.png](../output/playwright/crazyking/authorized-home.png)

### CK-FUNC-003 — P1 — Promotions пустая

**Шаги:** открыть `/promotions/`.

**Факт:** присутствуют только заголовок, coupon-блок и breadcrumbs; ни одной промо-карточки нет. На главной также отсутствуют секции Promotions и Sport Promotions после завершения загрузки.

**Ожидание:** список доступных casino/sport promotions, как в Figma.

**Доказательство:** [desktop-promotions-empty.png](../output/playwright/crazyking/desktop-promotions-empty.png)

### CK-FUNC-004 — P1 — Collections не загружаются

**Шаги:** открыть главную, затем `/collections/`.

**Факт:** секция Collections на главной исчезает после загрузки; `/collections/` показывает обычный каталог `All games`, а не тематические коллекции.

**Ожидание:** коллекции Egypt, Fruit, Latin, Wild West, Sweets, Asia, Animals, Other согласно Figma.

### CK-FUNC-005 — P1 — большинство фильтров Casino возвращают пустой экран

**Шаги:** открыть `/casino/` и по одному выбрать фильтры.

**Факт:** `Feature buy`, `Instant`, `Jackpots`, `Lottery`, `New`, `Originals`, `Other games` и `VIP` дают 0 карточек без нормального empty state. При этом соответствующие игры/секции присутствуют на главной. `Popular`, `Slots`, `Table games`, `Virtuals` работают.

**Ожидание:** фильтр показывает соответствующие игры либо осмысленный empty state.

### CK-FUNC-006 — P1 — обе ссылки VIP ведут на 404

**Шаги:** нажать VIP Lounge в sidebar либо VIP Club в footer.

**Факт:** sidebar ведёт на `/vip_lounge/` → HTTP 404; footer ведёт на `/vip-club/` → HTTP 404. Рабочая страница находится на `/vip/`.

**Ожидание:** обе ссылки ведут на `/vip/`.

### CK-FUNC-007 — P1 — блок Top events исчезает после загрузки

**Шаги:** открыть главную и дождаться завершения загрузки/lazy loading.

**Факт:** изначальный skeleton не заменяется событиями, затем секция полностью удаляется из DOM. В Figma предусмотрены карточки матчей.

**Ожидание:** отображаются актуальные события либо корректный empty state.

### CK-FUNC-008 — P1 — High RTP / Low RTP не получают данные

**Шаги:** открыть главную, прокрутить к High RTP / Low RTP.

**Факт:** отображаются `No hot games` и `No charged games`.

**Ожидание:** списки игр и RTP, как в макете.

### CK-FUNC-009 — P2 — raw localization keys в английской локали

**Факт:** `/casino/` показывает `category.other_games`; `/livecasino/` показывает `category.other_live` и `category.poker`.

**Ожидание:** `Other games`, `Other live games`, `Poker`.

### CK-FUNC-010 — P2 — неверный текст пустого результата поиска

**Шаги:** в каталоге Casino ввести несуществующее название игры.

**Факт:** сообщение: `Sorry, nothing matched to provider.` — даже когда поиск выполнялся по названию игры.

**Ожидание:** нейтральный текст вроде `Nothing matched your search` с введённым запросом.

### CK-FUNC-011 — P2 — некорректные SEO metadata

**Факт:** `/sports/`, `/promotions/`, `/collections/`, `/affiliate/`, `/pwa-instruction/`, `/guide/` используют общий title `Casino - Play Online Casino Games | CrazyKing` и одинаковый casino description. На `/sports/` и `/pwa-instruction/` отсутствует H1.

**Ожидание:** уникальные title, description и H1 по назначению страницы.

### CK-FUNC-012 — P2 — постоянные frontend/integration errors

**Факт:** на каждом переходе возникает `Hydration completed but contains mismatches`; Customer.io settings endpoint `cdp-eu.customer.io/.../settings` отвечает HTTP 404; также логируется CSP report-only нарушение для Customer.io.

**Ожидание:** чистая hydration и валидная конфигурация Customer.io.

### CK-FUNC-013 — P3 / accessibility — неверный DOM-порядок PWA steps

**Факт:** визуально шаги расположены 1–2 / 3–4, но screen-reader/DOM order — 1, 3, 2, 4.

**Ожидание:** DOM order 1, 2, 3, 4.

**Доказательство:** [desktop-pwa-step-order.png](../output/playwright/crazyking/desktop-pwa-step-order.png)

### CK-FUNC-014 — P2 — некорректное начальное значение суммы вывода

**Шаги:** авторизоваться, открыть Wallet → Withdrawal при балансе `0 EUR`.

**Факт:** поле `Withdrawal amount` автоматически содержит `40`, хотя доступно `0 EUR`, а интерфейс показывает `Minimum: 0 EUR`. Дополнительный текст содержит грамматическую ошибку: `you need make a deposit`.

**Ожидание:** при нулевом доступном балансе поле пустое либо содержит `0`; минимальная сумма соответствует бизнес-правилам, текст — `you need to make a deposit`.

**Доказательство:** [authorized-mobile-withdrawal.png](../output/playwright/crazyking/authorized-mobile-withdrawal.png)

### CK-FUNC-015 — P1 — противоречивый уровень игрока в CrazyKing и Smartico

**Шаги:** открыть Profile, затем Rewards/Smartico Overview.

**Факт:** профиль CrazyKing показывает `Beginner, 1 lvl`; верхняя панель Smartico — `1 Level`, но sidebar Smartico одновременно показывает `Level 0`, а подпись — `Next level is Level 1`.

**Ожидание:** текущий и следующий уровни единообразны во всех представлениях и берутся из одного согласованного состояния.

**Доказательства:** [authorized-mobile-profile.png](../output/playwright/crazyking/authorized-mobile-profile.png), [authorized-rewards.png](../output/playwright/crazyking/authorized-rewards.png)

### CK-FUNC-016 — P1 — разные награды за подтверждение телефона

**Шаги:** сравнить Phone verification в Profile и миссию `Confirm Your Phone Number` в Smartico.

**Факт:** профиль обещает `100,500 XP`, а Smartico — `700 Points`. Интерфейс не объясняет, что это разные валюты/награды.

**Ожидание:** награда и единица измерения согласованы либо различие явно объяснено пользователю.

## Отдельно: несоответствия дизайну Figma

### CK-UI-001 — P1 — отсутствует верхний promo/hero-блок главной

В Figma перед Popular расположены story/avatar chips и большой welcome-bonus carousel. На рабочем guest homepage контент начинается сразу с Popular.

**Figma:** [figma-desktop-very-top.png](../output/playwright/crazyking/figma-desktop-very-top.png)  
**Сайт:** [guest-home-en.png](../output/playwright/crazyking/guest-home-en.png)

### CK-UI-002 — P1 — отсутствует дизайн-блок Collections

В Figma есть полноценная мозаика тематических коллекций; на сайте секция после загрузки отсутствует, а отдельная страница заменена каталогом всех игр.

**Figma:** [figma-desktop-top.png](../output/playwright/crazyking/figma-desktop-top.png)

### CK-UI-003 — P1 — Promotions и Sport Promotions не соответствуют макету

Макет содержит карточки депозитных бонусов с иллюстрациями, суммами и CTA. На сайте эти секции отсутствуют, а `/promotions/` пустая.

**Figma:** [figma-desktop-upper.png](../output/playwright/crazyking/figma-desktop-upper.png)

### CK-UI-004 — P1 — Top events отсутствует

В макете предусмотрены event cards с командами и коэффициентами; на сайте секция исчезает после skeleton.

### CK-UI-005 — P1 — High RTP / Low RTP заменены пустыми состояниями

В Figma оба блока заполнены списками; на сайте внутри только `No hot games` / `No charged games`.

**Figma:** [figma-50-percent.png](../output/playwright/crazyking/figma-50-percent.png)

### CK-UI-006 — P1 — игровые карточки обрезаются на mobile

На ширине 390 px в горизонтальных секциях видна только левая часть первого постера, оставшаяся площадь строки пустая. Карточки не выглядят как полноценная горизонтальная карусель.

**Доказательство:** [mobile-home-en-settled-2.png](../output/playwright/crazyking/mobile-home-en-settled-2.png), [mobile-goldrush-card.png](../output/playwright/crazyking/mobile-goldrush-card.png)

### CK-UI-007 — P2 — notification prompt перекрывает основную навигацию

OneSignal prompt появляется сразу после открытия и перехватывает клики по Menu/header до нажатия Later. В переданном макете такого blocking overlay нет.

### CK-UI-008 — P1 — Smartico не адаптирован под mobile

На viewport 390×844 Rewards/Smartico отображается как уменьшенная desktop-панель внутри блока примерно 326×195 px. Текст, sidebar, карточки и CTA физически присутствуют, но практически нечитаемы и неудобны для нажатия.

**Ожидание:** mobile-компоновка на всю доступную ширину с читаемым текстом, доступной навигацией и touch-targets не менее 44×44 px.

**Доказательство:** [authorized-mobile-rewards.png](../output/playwright/crazyking/authorized-mobile-rewards.png)

## Что работает

- English guest homepage, header/footer и sidebar открываются.
- Глобальный поиск находит игры и показывает рекомендации для пустого результата.
- Demo game открывается в iframe; доступны Close, Search games и Fullscreen.
- Sports renderer загружается; вкладки/виды спорта видны, коэффициент добавляется в betslip. Ставка не размещалась.
- Signup wizard, выбор bonus, email/password/phone и локальные validation messages работают; submit корректно disabled для невалидных данных.
- Invite & Earn dialog, Live chat, Missions/Store/Wheel guest gates открываются.
- PWA Android/iOS переключаются; casino/live/policy/VIP/affiliate/guide routes отвечают HTTP 200.
- Desktop layout не имеет постоянного horizontal overflow после завершения hydration.
- Повторный login успешен; авторизованная сессия сохраняется при навигации и смене viewport.
- Profile, Account details, Security center, Bonuses, Referrals, Wallet, Bets и Settings открываются.
- Deposit показывает доступные карточные, банковские и crypto-методы; отправка платежа не выполнялась.
- Favourites и Recent показывают корректные empty states.
- Smartico Overview, Missions, Leaderboard, Tournaments, Levels, Badges, Wheel, Store, Bonuses, Inbox и Activity log загружаются. Награды, бонусы и товары не активировались.
- Mobile Profile и платёжный модал не создают горизонтального overflow.

## Ограничения и намеренно непроверенные операции

- Реальные депозит, вывод и ставка не выполнялись.
- Bonus/coupon activation, покупка товара Smartico, вращение колеса и отправка live-chat сообщения не выполнялись, чтобы не менять состояние тестового аккаунта.
- Пароль, 2FA, session timeout и персональные данные не изменялись.
- KYC-флоу не запускался; destructive/logout-проверки не выполнялись.

## Рекомендуемый порядок исправления

1. Починить RU locale bundle/routing и стабилизировать Turnstile integration.
2. Исправить CMS/API-данные Promotions, Collections, Top events, RTP и casino filters.
3. Свести все VIP links к `/vip/`.
4. Синхронизировать уровень и phone-verification reward между платформой и Smartico.
5. Сделать Smartico адаптивным для mobile и исправить дефолтную сумму/текст Withdrawal.
6. Вернуть отсутствующие homepage blocks и mobile card layout по Figma.
7. Исправить EN translation keys, search copy, SEO metadata и PWA accessibility order.
8. Устранить hydration mismatch и Customer.io 404, затем повторить guest + authorized regression.
