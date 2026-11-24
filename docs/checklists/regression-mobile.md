# Регрессионный чеклист брендов — Mobile

## Назначение и база чеклиста

Полный mobile regression для `gt.bet`, `likes.bet`, `booms.bet`, `nix.bet`, `starzino.com`, `igo.bet`, `chacha.bet` и `casho.bet`. Чеклист основан на тестах и последних отчётах проекта, product-remediation документах и исследовательском проходе 11 ноября 2026 года: 32 mobile route-проверки (`/`, `/casino/`, `/livecasino/`, `/sports/`) по восьми брендам плюс сравнение с desktop-проходом.

Responsive-проверки на трёх наиболее распространённых мобильных viewport вынесены в отдельный [чек-лист разрешений Mobile](./regression-mobile-screen-sizes.md).

## Устройства и правила

- Минимальная матрица: Android Chrome `390 × 844`, iPhone Safari `390 × 844`, малый экран `360 × 800`.
- Playwright mobile emulation — базовая проверка; минимум один Android и один iPhone должны быть реальными устройствами перед крупным релизом.
- Проверить portrait; landscape обязателен для game/live/sports/betslip.
- Guest и authorized состояния выполнять раздельно.
- Статусы: `PASS / FAIL / PRODUCT BLOCKED / INFRA BLOCKED / N/A / PARTIAL / NOT RUN`.
- P0 FAIL означает `NO-GO`. WAF/Turnstile/внешний provider не превращать в product PASS.
- Tap должен выполняться обычным пользовательским нажатием. Успех через force-click не является PASS.
- Реальные платежи, ставки, смена пароля и сообщения в поддержку — только opt-in.

## Карточка прогона

| Поле                             | Значение |
| -------------------------------- | -------- |
| Бренд / URL                      |          |
| Release / commit                 |          |
| Дата, время, часовой пояс        |          |
| Устройство / ОС                  |          |
| Браузер / версия                 |          |
| Viewport / DPR / ориентация      |          |
| Эмуляция или реальное устройство |          |
| Гео / VPN / сеть                 |          |
| Игрок / валюта / KYC tier        |          |
| Автоматический report / баги     |          |

## Матрица устройств и брендов

| Бренд        | Android portrait | Android landscape | iPhone portrait | iPhone landscape | Итог |
| ------------ | ---------------- | ----------------- | --------------- | ---------------- | ---- |
| gt.bet       |                  |                   |                 |                  |      |
| likes.bet    |                  |                   |                 |                  |      |
| booms.bet    |                  |                   |                 |                  |      |
| nix.bet      |                  |                   |                 |                  |      |
| starzino.com |                  |                   |                 |                  |      |
| igo.bet      |                  |                   |                 |                  |      |
| chacha.bet   |                  |                   |                 |                  |      |
| casho.bet    |                  |                   |                 |                  |      |

## Brand-specific фокус

| Бренд        | Обязательный mobile-фокус                                                                    |
| ------------ | -------------------------------------------------------------------------------------------- |
| gt.bet       | Signup close/sidebar collision, WAF, language persistence, Sports back, Recent               |
| likes.bet    | CDP/WAF session, bottom navigation, provider strong surface, chat/sidebar                    |
| booms.bet    | External SSO/Turnstile, auth-state, `Load more`, central menu false/real state, chat, Recent |
| nix.bet      | Низкая strict-evidence полнота прошлых mobile прогонов, profile/provider/overlay parity      |
| starzino.com | Mobile KPI, provider card overlays, launch surface и orientation                             |
| igo.bet      | Profile details/avatar/preferences, filters, Favorites/Recent, cashier responsiveness        |
| chacha.bet   | Locale redirects (`/ru/`), mobile Sports routing, WAF, localized UI                          |
| casho.bet    | WAF, фактическая auth/profile/provider/cashier полнота, Console/Network                      |

## 1. Запуск и responsive shell

| ID        | P   | Проверка                                        | Ожидаемый результат                                                | Статус / evidence |
| --------- | --- | ----------------------------------------------- | ------------------------------------------------------------------ | ----------------- |
| RM-ENV-01 | P0  | Открыть URL в чистом мобильном браузере         | Правильный бренд без DNS/TLS/5xx/WAF-loop                          |                   |
| RM-ENV-02 | P0  | Дождаться hydration                             | Нет blank/token page, skeleton исчезает                            |                   |
| RM-ENV-03 | P0  | Проверить viewport                              | Нет desktop canvas, горизонтального scroll и масштабирования формы |                   |
| RM-ENV-04 | P1  | Проверить safe areas/notch/browser bars         | Header/footer/CTA не обрезаны                                      |                   |
| RM-ENV-05 | P1  | Проверить `360 × 800` и `390 × 844`             | Контент и controls доступны на обоих размерах                      |                   |
| RM-ENV-06 | P1  | Сменить portrait/landscape                      | Layout перестроился, state не потерян                              |                   |
| RM-ENV-07 | P1  | Background 15 секунд и возврат                  | Нет blank screen/logout/reload loop                                |                   |
| RM-ENV-08 | P1  | Сменить Wi-Fi/mobile network или offline/online | Понятное recovery состояние без вечного loader                     |                   |
| RM-ENV-09 | P1  | Hard refresh внутреннего route                  | Deep link восстанавливается                                        |                   |

## 2. Header, bottom navigation, drawer и overlays

| ID        | P   | Проверка                                      | Ожидаемый результат                                                | Статус / evidence |
| --------- | --- | --------------------------------------------- | ------------------------------------------------------------------ | ----------------- |
| RM-NAV-01 | P0  | Проверить logo/auth или wallet/header         | Состояние соответствует guest/auth                                 |                   |
| RM-NAV-02 | P0  | Пройти все пункты bottom navigation           | Правильный route/active state; один tap — одно действие            |                   |
| RM-NAV-03 | P0  | Открыть центральное mobile menu/drawer        | Drawer действительно видим и перекрывает ожидаемую область         |                   |
| RM-NAV-04 | P1  | Закрыть drawer toggle/overlay/Back            | Scroll и focus восстановлены; active class не означает ложный open |                   |
| RM-NAV-05 | P1  | Быстро открыть/закрыть drawer 3 раза          | Нет двойного overlay, stuck body или event duplication             |                   |
| RM-NAV-06 | P1  | Проверить все guest menu items                | Каждый видимый item работает или capability подтверждена как N/A   |                   |
| RM-NAV-07 | P1  | Проверить authorized menu items               | Profile/assets/bonus/recent/favorites/referral доступны            |                   |
| RM-NAV-08 | P1  | Проверить Search bottom action                | Открывается именно search, клавиатура не ломает modal              |                   |
| RM-NAV-09 | P1  | Проверить sticky header/bottom bar при scroll | Не перекрывают Load more, CTA, inputs и footer                     |                   |
| RM-NAV-10 | P1  | Cookie/PWA/app/promo banners                  | Закрываются; не перекрывают auth/navigation; выбор сохраняется     |                   |
| RM-NAV-11 | P1  | Android Back / iOS gesture back               | Закрывает верхний overlay до ухода со страницы                     |                   |
| RM-NAV-12 | P1  | Footer accordion                              | Sections раскрываются, links доступны над bottom bar               |                   |

## 3. Главная и touch-поведение

| ID         | P   | Проверка                           | Ожидаемый результат                                 | Статус / evidence |
| ---------- | --- | ---------------------------------- | --------------------------------------------------- | ----------------- |
| RM-HOME-01 | P0  | Прокрутить Home сверху вниз        | Нет горизонтального scroll/layout gaps              |                   |
| RM-HOME-02 | P1  | Swipe hero/carousel в обе стороны  | Один swipe — один предсказуемый переход             |                   |
| RM-HOME-03 | P1  | Tap каждого hero CTA               | Открыт корректный route/modal                       |                   |
| RM-HOME-04 | P1  | Horizontal scroll quick categories | Начало/конец достижимы, page scroll не блокируется  |                   |
| RM-HOME-05 | P1  | Long labels/dynamic amounts        | Текст не перекрывает соседние controls              |                   |
| RM-HOME-06 | P1  | Double tap core CTA                | Не создаёт дубль modal/request                      |                   |
| RM-HOME-07 | P1  | Touch targets                      | Ключевые controls достаточно крупные и не перекрыты |                   |

## 4. Регистрация, внешний SSO и login

| ID         | P   | Проверка                              | Ожидаемый результат                                                 | Статус / evidence |
| ---------- | --- | ------------------------------------- | ------------------------------------------------------------------- | ----------------- |
| RM-AUTH-01 | P0  | Tap Sign Up                           | Внутренняя modal или заявленный внешний SSO открывается             |                   |
| RM-AUTH-02 | P1  | Закрыть signup/exit confirmation      | Modal и drawer закрыты, body scroll возвращён                       |                   |
| RM-AUTH-03 | P1  | Проверить keyboard для каждого поля   | Тип клавиатуры корректен; field/CTA не скрыты                       |                   |
| RM-AUTH-04 | P1  | Пустые/невалидные значения            | Ошибки видимы над keyboard и после blur                             |                   |
| RM-AUTH-05 | P1  | Password show/hide и manager/autofill | Значение не очищается и не раскрывается в UI/URL                    |                   |
| RM-AUTH-06 | P1  | Country/phone/date selectors          | Lists scroll, выбранное значение сохраняется                        |                   |
| RM-AUTH-07 | P0  | Зарегистрировать уникального игрока   | UI/API подтверждают создание; нет Turnstile loop                    |                   |
| RM-AUTH-08 | P0  | Logout/login созданным игроком        | Credentials валидны, профиль того же игрока                         |                   |
| RM-AUTH-09 | P0  | Login существующим игроком            | Wallet/profile доступны                                             |                   |
| RM-AUTH-10 | P1  | Неверный password                     | Понятная безопасная ошибка, сессия не создана                       |                   |
| RM-AUTH-11 | P1  | External SSO Back/Forward             | Возврат на бренд корректен, `state`/redirect не зациклены           |                   |
| RM-AUTH-12 | P1  | Turnstile/Cloudflare вручную          | Одна успешная проверка продолжает flow; нет бесконечного повторения |                   |
| RM-AUTH-13 | P0  | Refresh/core navigation после login   | Auth сохраняется                                                    |                   |
| RM-AUTH-14 | P0  | Logout + Back/refresh                 | Protected data не возвращаются из cache                             |                   |

## 5. Casino catalog и filters

| ID        | P   | Проверка                              | Ожидаемый результат                                         | Статус / evidence |
| --------- | --- | ------------------------------------- | ----------------------------------------------------------- | ----------------- |
| RM-CAS-01 | P0  | Открыть Casino через bottom nav и URL | Тот же рабочий catalog, active state корректен              |                   |
| RM-CAS-02 | P1  | Scroll до конца catalog               | Lazy cards загружаются без пропусков/дублей                 |                   |
| RM-CAS-03 | P1  | Category chips horizontal scroll      | Все chips достижимы и кликабельны                           |                   |
| RM-CAS-04 | P1  | Открыть mobile Filters                | Панель видима целиком, background не кликается              |                   |
| RM-CAS-05 | P1  | Provider select/apply/reopen          | Selected state сохранён и результат согласован              |                   |
| RM-CAS-06 | P1  | CLEAR/OK/close gesture/Back           | Каждый способ даёт ожидаемое состояние                      |                   |
| RM-CAS-07 | P1  | Tabs Provider/Category/Collection     | Нет смешения controls/selected state                        |                   |
| RM-CAS-08 | P0  | Search существующей игры              | Keyboard не скрывает results/close; результат релевантен    |                   |
| RM-CAS-09 | P1  | Impossible search/clear               | Zero-state и восстановление catalog                         |                   |
| RM-CAS-10 | P1  | Search + provider filter              | Комбинация детерминирована                                  |                   |
| RM-CAS-11 | P1  | `Load more`                           | Catalog расширяется/control исчезает; drawer не открывается |                   |
| RM-CAS-12 | P0  | Demo launch                           | Mobile game/iframe/popup работает                           |                   |
| RM-CAS-13 | P0  | Real launch                           | Game surface или ожидаемый balance/geo gate                 |                   |
| RM-CAS-14 | P1  | Landscape внутри game                 | Game масштабирован и управляем                              |                   |
| RM-CAS-15 | P1  | System Back из game                   | Возврат один раз, без stuck iframe/black overlay            |                   |
| RM-CAS-16 | P1  | Favorites add/remove                  | Иконка tappable, state сохранён                             |                   |
| RM-CAS-17 | P1  | Recent после launch                   | Та же game появилась по стабильной identity                 |                   |

## 6. Mobile provider matrix

Для каждого provider из свежего inventory:

| Provider | Filter | Card tap | Demo | Real | Portrait | Landscape | Recent | Итог |
| -------- | ------ | -------- | ---- | ---- | -------- | --------- | ------ | ---- |
|          |        |          |      |      |          |           |        |      |

Не принимать route-only/weak surface за полноценный launch. Массовый WAF block — одна root cause плюс список `NOT RUN` providers.

## 7. Live Casino

| ID         | P   | Проверка                      | Ожидаемый результат                                  | Статус / evidence |
| ---------- | --- | ----------------------------- | ---------------------------------------------------- | ----------------- |
| RM-LIVE-01 | P0  | Открыть Live через nav/URL    | Live catalog, не Home/Casino fallback                |                   |
| RM-LIVE-02 | P1  | Search и clear                | Keyboard/results/close управляемы                    |                   |
| RM-LIVE-03 | P1  | Provider filter               | Панель и cards согласованы                           |                   |
| RM-LIVE-04 | P0  | Запустить доступную live game | Mobile lobby/table или ожидаемый gate                |                   |
| RM-LIVE-05 | P1  | Portrait/landscape            | Table controls доступны, контент не обрезан          |                   |
| RM-LIVE-06 | P1  | Background/return             | Connection восстановлена или есть понятный reconnect |                   |
| RM-LIVE-07 | P1  | Закрыть/Back/relaunch         | Нет зависшего overlay/scroll lock                    |                   |

## 8. Sports и mobile betslip

| ID        | P   | Проверка                     | Ожидаемый результат                                        | Статус / evidence |
| --------- | --- | ---------------------------- | ---------------------------------------------------------- | ----------------- |
| RM-SPT-01 | P0  | Открыть Sports               | Sports hydrated, не generic fallback                       |                   |
| RM-SPT-02 | P1  | Swipe sport tabs             | Football/Basketball/Tennis/Live достижимы                  |                   |
| RM-SPT-03 | P1  | Переключить sport/mode       | URL (`bt-path`, `top` или pretty route) и data согласованы |                   |
| RM-SPT-04 | P1  | Scroll events/markets        | Horizontal/vertical scroll не конфликтуют                  |                   |
| RM-SPT-05 | P1  | Open event/expand market     | Odds читаемы, tap-target не перекрыт                       |                   |
| RM-SPT-06 | P1  | Semantic/System Back         | Возвращены list/scroll/filter                              |                   |
| RM-SPT-07 | P0  | Add odds                     | Betslip indicator появляется с правильным selection        |                   |
| RM-SPT-08 | P1  | Open/minimize/reopen betslip | Selection не теряется, overlay закрываем                   |                   |
| RM-SPT-09 | P1  | Add second/remove/clear      | Count и расчет корректны                                   |                   |
| RM-SPT-10 | P1  | Invalid/min stake без submit | Numeric keyboard не скрывает validation/CTA                |                   |
| RM-SPT-11 | P1  | Landscape с betslip          | Coupon остаётся управляемым                                |                   |
| RM-SPT-12 | P1  | BetBuilder capability        | Нет 404 при отсутствующем UI                               |                   |
| RM-SPT-13 | P1  | Flag assets/metadata/network | Нет invalid asset, critical 4xx/5xx/WS loop                |                   |

## 9. Профиль, wallet и settings

| ID        | P   | Проверка                            | Ожидаемый результат                                             | Статус / evidence |
| --------- | --- | ----------------------------------- | --------------------------------------------------------------- | ----------------- |
| RM-ACC-01 | P0  | Открыть profile через header/drawer | Правильный игрок, адаптивная page                               |                   |
| RM-ACC-02 | P0  | Пройти все profile sections         | Tabs/list доступны tap и не уходят под bottom bar               |                   |
| RM-ACC-03 | P1  | Edit безопасного поля               | Keyboard не скрывает validation/Save; persistence после refresh |                   |
| RM-ACC-04 | P1  | Avatar valid/invalid                | Picker/preview/error работают по capability                     |                   |
| RM-ACC-05 | P1  | Security/password                   | Внутренний flow или корректный external SSO                     |                   |
| RM-ACC-06 | P1  | Preferences controls                | Tap state/Save/refresh persistence                              |                   |
| RM-ACC-07 | P0  | Wallet/assets                       | Balance/currency совпадают с header                             |                   |
| RM-ACC-08 | P1  | Transaction/bets lists              | Cards/table адаптированы; filters/pagination работают           |                   |
| RM-ACC-09 | P1  | Bonus details                       | Terms/CTA читаемы без horizontal scroll                         |                   |
| RM-ACC-10 | P1  | Favorites/Recent                    | Согласованы с Casino действиями                                 |                   |
| RM-ACC-11 | P1  | Referral/copy/share                 | Native share/copy feedback корректен                            |                   |

## 10. Smartico — отдельный mobile regression

### Baseline исследовательского прохода

| Бренд        | Mobile evidence                                                                                   | Что перепроверить в первую очередь            |
| ------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| gt.bet       | Missions/Wheel/Races/Store создавали Smartico iframe; Achieves отсутствовал                       | Все surfaces, Achievements, orientation       |
| likes.bet    | Entry points найдены, но observable surface не подтверждена                                       | Все функции, drawer/overlay и player identity |
| booms.bet    | Последний mobile evidence не нашёл entry points из-за guest/auth sidebar состояния                | External SSO, authorized drawer, все функции  |
| nix.bet      | Entry points найдены без observable surface; `vip-missions` 404                                   | Capability/API contract и mobile overlay      |
| starzino.com | Проверка заблокирована Cloudflare                                                                 | Полный проход на реальном устройстве          |
| igo.bet      | Wheel/Races создавали Smartico iframe; Missions без поверхности; Store/Achievements отсутствовали | Полная capability matrix и persistence        |
| chacha.bet   | Sidebar/Smartico проверка заблокирована                                                           | Locale-prefix, drawer и auth-state            |
| casho.bet    | Проверка заблокирована Cloudflare; Smartico storage artifacts не подтверждены                     | Наличие интеграции и responsive surface       |

### Матрица Smartico по устройству

| Функция      | Android portrait | Android landscape | iPhone portrait | iPhone landscape | Итог |
| ------------ | ---------------- | ----------------- | --------------- | ---------------- | ---- |
| Missions     |                  |                   |                 |                  |      |
| Wheel        |                  |                   |                 |                  |      |
| Races        |                  |                   |                 |                  |      |
| Achievements |                  |                   |                 |                  |      |
| Store        |                  |                   |                 |                  |      |

### Проверки Smartico

| ID        | P   | Проверка                           | Ожидаемый результат                                                             | Статус / evidence |
| --------- | --- | ---------------------------------- | ------------------------------------------------------------------------------- | ----------------- |
| RM-SMT-01 | P0  | Capability и mobile entry points   | Заявленные функции видны в authorized drawer/hero без ложных labels             |                   |
| RM-SMT-02 | P0  | Guest tap Smartico entry           | Открывается login/signup gate, приватный iframe не загружается                  |                   |
| RM-SMT-03 | P0  | Authorized identification          | Текущий player ID/balance/progress, без guest/старого account cache             |                   |
| RM-SMT-04 | P1  | Logout/login другим игроком        | Smartico storage/identity переключены безопасно                                 |                   |
| RM-SMT-05 | P0  | Tap каждого entry point            | Tap открывает правильную видимую surface, не только меняет class                |                   |
| RM-SMT-06 | P1  | Drawer + Smartico overlay          | Drawer закрывается; overlay выше контента, но не ломает bottom nav              |                   |
| RM-SMT-07 | P1  | Close/overlay tap/system Back      | Сначала закрывается Smartico, основной route не теряется                        |                   |
| RM-SMT-08 | P1  | Повторное быстрое открытие         | Нет нескольких iframe, duplicate popup или locked scroll                        |                   |
| RM-SMT-09 | P1  | Scroll внутри Smartico             | Скролл идёт во внутренней surface, background остаётся locked                   |                   |
| RM-SMT-10 | P1  | Safe area/notch/bottom browser bar | Close, CTA и последняя строка не обрезаны                                       |                   |
| RM-SMT-11 | P1  | Portrait/landscape                 | Surface перестраивается без потери выбранного tab/state                         |                   |
| RM-SMT-12 | P1  | Background/return                  | Iframe восстанавливается либо показывает контролируемый retry                   |                   |
| RM-SMT-13 | P0  | Missions list/empty state          | Cards/progress/reward/CTA читаемы и tappable                                    |                   |
| RM-SMT-14 | P1  | Mission details/deep link          | Возврат из Casino/Sports сохраняет Smartico context по контракту                |                   |
| RM-SMT-15 | P0  | Wheel eligibility/loading          | Wheel помещается по ширине; locked/available state понятен                      |                   |
| RM-SMT-16 | P1  | Wheel timer/segments без spin      | Нет обрезки/ложного enabled CTA                                                 |                   |
| RM-SMT-17 | P0  | Races/leaderboard/player row       | Таблица адаптирована; current player и timer читаемы                            |                   |
| RM-SMT-18 | P0  | Achievements label/list            | Entry point и content согласованы; нет `Horror` вместо capability без контракта |                   |
| RM-SMT-19 | P1  | Achievement progress/details       | Cards и reward states доступны tap/scroll                                       |                   |
| RM-SMT-20 | P0  | Store catalog/currency/balance     | Items/prices/current balance корректны на малом экране                          |                   |
| RM-SMT-21 | P1  | Store details/insufficient balance | CTA/error видимы; purchase не выполняется без opt-in                            |                   |
| RM-SMT-22 | P1  | Popup/inbox/notification badge     | Badge/read/dismiss state сохраняется без дублей                                 |                   |
| RM-SMT-23 | P1  | Keyboard/accessibility             | Focus/labels/screen reader/Back работают; нет trap                              |                   |
| RM-SMT-24 | P1  | Localization/long strings          | Locale и формат данных верны; текст не перекрывает CTA                          |                   |
| RM-SMT-25 | P1  | Network/API/CSP                    | Нет `vip-missions` 404, 5xx, CORS/CSP и retry loop                              |                   |
| RM-SMT-26 | P1  | Slow network/offline recovery      | Loader/error/retry понятны, surface не остаётся blank                           |                   |
| RM-SMT-27 | P1  | Privacy/storage                    | Нет password/PII в URL/log; cookies/IDs/consent соответствуют политике          |                   |

Claim reward, spin и Store purchase выполнять только в отдельном opt-in проходе.

## 11. Deposit и Withdraw без операции

| ID        | P   | Проверка                         | Ожидаемый результат                             | Статус / evidence |
| --------- | --- | -------------------------------- | ----------------------------------------------- | ----------------- |
| RM-PAY-01 | P0  | Открыть Deposit из header/drawer | Один responsive cashier surface                 |                   |
| RM-PAY-02 | P0  | Сверить UI methods с API         | Methods соответствуют geo/currency/tier         |                   |
| RM-PAY-03 | P1  | Tap каждого method               | Form/iframe готов, нет blank/timeout            |                   |
| RM-PAY-04 | P1  | Keyboard на amount/requisites    | Не скрывает limit/error/CTA                     |                   |
| RM-PAY-05 | P1  | Invalid/min/max amount           | Validation видима, submit не отправлен          |                   |
| RM-PAY-06 | P1  | Back/close/reopen                | Нет двойного overlay или locked scroll          |                   |
| RM-PAY-07 | P1  | Bank Transfer                    | Загружается в SLA и помещается по ширине        |                   |
| RM-PAY-08 | P0  | Withdraw                         | Methods или явный KYC/rollover/balance gate     |                   |
| RM-PAY-09 | P1  | Invalid withdraw form            | Ошибка видима над keyboard; mutation не создана |                   |
| RM-PAY-10 | P1  | Rotate cashier                   | Form/state не теряются и не дублируются         |                   |

## 12. Promotions, VIP, localization, support и legal

| ID         | P   | Проверка                              | Ожидаемый результат                                   | Статус / evidence |
| ---------- | --- | ------------------------------------- | ----------------------------------------------------- | ----------------- |
| RM-PRM-01  | P0  | Promotions list/detail                | Cards, dates, terms, CTA адаптивны                    |                   |
| RM-PRM-02  | P1  | Promo CTA guest/auth                  | Правильный signup/eligibility/activation flow         |                   |
| RM-VIP-01  | P0  | VIP page                              | Levels/benefits/CTA читаемы в portrait                |                   |
| RM-L10N-01 | P1  | Все доступные languages               | Nav, CTA, forms, validation переведены                |                   |
| RM-L10N-02 | P1  | Refresh и routes после смены языка    | Locale/prefix сохраняются                             |                   |
| RM-L10N-03 | P1  | Long localized strings                | Нет overlap/truncation, если текст должен быть полным |                   |
| RM-SUP-01  | P1  | Open/minimize/reopen/close Chat       | Widget не перекрывает bottom nav                      |                   |
| RM-SUP-02  | P1  | Keyboard в pre-chat/composer          | Input/send остаются видимыми                          |                   |
| RM-SUP-03  | P1  | Rotate с открытым chat                | Widget остаётся управляемым                           |                   |
| RM-LEG-01  | P0  | Terms/Privacy/Responsible Gaming      | Правильный бренд/locale, без 404                      |                   |
| RM-LEG-02  | P1  | License/18+/contacts/social/app links | Видимы, не обрезаны, target безопасен                 |                   |

## 13. Mobile quality: visual, accessibility, network, performance

| ID        | P   | Проверка                               | Ожидаемый результат                                                           | Статус / evidence |
| --------- | --- | -------------------------------------- | ----------------------------------------------------------------------------- | ----------------- |
| RM-QLT-01 | P1  | Title/H1/canonical top routes          | Уникальны разделу и locale                                                    |                   |
| RM-QLT-02 | P1  | Text zoom 200%/larger font             | Core content/controls доступны                                                |                   |
| RM-QLT-03 | P1  | Screen reader labels                   | Bottom nav, icon buttons, forms имеют names                                   |                   |
| RM-QLT-04 | P1  | Focus после modal/drawer               | Возвращается на trigger; нет trap                                             |                   |
| RM-QLT-05 | P1  | Contrast/selected/disabled states      | Состояния различимы не только цветом                                          |                   |
| RM-QLT-06 | P1  | Axe critical scan                      | Нет critical violations                                                       |                   |
| RM-QLT-07 | P1  | Broken images/fonts/flags              | Fallback не ломает layout                                                     |                   |
| RM-QLT-08 | P1  | Console classification                 | App errors отделены от provider/analytics/WAF                                 |                   |
| RM-QLT-09 | P1  | Network 4xx/5xx/failed                 | Нет critical core API/resource failures                                       |                   |
| RM-QLT-10 | P1  | Slow 3G core routes                    | Loading state понятен, controls не dead                                       |                   |
| RM-QLT-11 | P1  | Repeated taps/route changes            | Нет duplicate requests/modals/navigation                                      |                   |
| RM-QLT-12 | P1  | Memory/state после 15 минут navigation | Нет заметного зависания/blank page                                            |                   |
| RM-QLT-13 | P1  | Sensitive data                         | Пароль/token/payment data отсутствуют в URL/Console/report                    |                   |
| RM-QLT-14 | P1  | Auth/Payment OpenAPI contracts         | Versioned schemas проходят Spectral/Schemathesis; missing schema явно BLOCKED |                   |
| RM-QLT-15 | P1  | HTTPS/CSP/mixed content/cookies        | Нет mobile-only blocked content; session cookies имеют ожидаемые flags        |                   |

## 14. Opt-in destructive проверки

| ID        | P   | Проверка                   | Ожидаемый результат                                                           | Статус / evidence |
| --------- | --- | -------------------------- | ----------------------------------------------------------------------------- | ----------------- |
| RM-DST-01 | P1  | Forgot/change password     | Новый пароль работает, старый отклоняется                                     |                   |
| RM-DST-02 | P1  | Guest support message      | Одно сообщение доставлено без дубля                                           |                   |
| RM-DST-03 | P1  | Authorized support message | Identity и delivery корректны                                                 |                   |
| RM-DST-04 | P1  | Test payment/bet           | Только sandbox/test funds; status согласован с backend                        |                   |
| RM-DST-05 | P1  | Smartico reward/spin/store | Только согласованный test mutation; reward/balance/history обновлены один раз |                   |

## Критерии завершения

- `GO`: все применимые mobile P0 — PASS; P1 проблемы имеют баги и release-решение.
- `NO-GO`: P0 FAIL на launch, auth, bottom navigation, Casino/game, Sports/betslip, profile/wallet или cashier.
- Только эмуляция не считается полным mobile regression: в итогах явно указать остаточный риск и непроверенные реальные устройства.
- Не объединять несколько устройств в один PASS: итог хранит status отдельно для каждой device/browser/orientation комбинации.

## Команды автоматизированного дополнения

```bash
node scripts/qa-brand-run.js --brand=<brand> --mode=mobile --profile=full
npm run qa:localization:<brand>:mobile
PW_VISUAL_REGRESSION=1 npx playwright test tests/visual --project=mobile --workers=1
```

Автопрогон дополняет, но не заменяет реальные touch, keyboard, orientation и device проверки.
