# Регрессионный чеклист брендов — Desktop

## Назначение и база чеклиста

Полный ручной регресс для `gt.bet`, `likes.bet`, `booms.bet`, `nix.bet`, `starzino.com`, `igo.bet`, `chacha.bet` и `casho.bet` на desktop. Чеклист построен на:

- текущих `smoke`, `critical`, `destructive`, `visual` и `localization` Playwright-тестах проекта;
- последних desktop/mobile QA-репортах каждого бренда;
- product-remediation документах проекта;
- исследовательском проходе 11 ноября 2026 года: 48 desktop-маршрутов (`/`, `/casino/`, `/livecasino/`, `/sports/`, `/promotions/`, `/vip/`) по восьми брендам.

Автоматизация даёт evidence, но не заменяет ручную оценку layout, понятности ошибок, реальной кликабельности и соответствия функции продуктовой конфигурации.

Проверки адаптивности на ноутбуках 13″/16″ и мониторе 27″ вынесены в отдельный [чек-лист разрешений Desktop](./regression-desktop-screen-sizes.md).

## Правила выполнения

- Основной viewport: `1440 × 900`; контрольный: `1366 × 768`; zoom — `100%`.
- Chrome — обязательный основной браузер. Safari/WebKit и Firefox — обязательны для release-кандидата хотя бы на P0; отклонения фиксируются отдельно по browser engine.
- Проверки guest и authorized выполнять в отдельных контекстах.
- Сначала выполнить P0. P0 `FAIL` означает `NO-GO`.
- `N/A` допустим только после подтверждения, что capability отключена для бренда. Отсутствующая заявленная функция — `FAIL`, а не `N/A`.
- `PRODUCT BLOCKED` означает воспроизводимую проблему продукта; `INFRA BLOCKED` — WAF, сеть, тестовые данные или внешний сервис. Эти статусы не являются PASS.
- `PARTIAL` разрешён только с перечнем выполненных и невыполненных подпунктов.
- Реальные deposit, withdraw, ставка, сообщение в поддержку и смена пароля выполняются только при отдельном разрешении. По умолчанию остановиться перед необратимым submit.
- В публичных артефактах не сохранять пароль, токены, cookie и полные платёжные данные.

## Карточка прогона

| Поле                         | Значение                   |
| ---------------------------- | -------------------------- |
| Бренд / URL                  |                            |
| Окружение / release / commit |                            |
| Дата, время, часовой пояс    |                            |
| Тестировщик                  |                            |
| ОС / браузер / версия        |                            |
| Viewport                     | `1440 × 900`; `1366 × 768` |
| Гео / VPN / внешний IP       |                            |
| Guest locale                 |                            |
| Игрок / валюта / KYC tier    |                            |
| Автоматический репорт        |                            |
| Баги / известные ограничения |                            |

Статус строки: `PASS / FAIL / PRODUCT BLOCKED / INFRA BLOCKED / N/A / PARTIAL / NOT RUN`.

## Матрица выполнения по брендам

| Бренд        | Guest | Registration | Auth | Casino | Live | Sports | Profile | Cashier | Localization | Итог |
| ------------ | ----- | ------------ | ---- | ------ | ---- | ------ | ------- | ------- | ------------ | ---- |
| gt.bet       |       |              |      |        |      |        |         |         |              |      |
| likes.bet    |       |              |      |        |      |        |         |         |              |      |
| booms.bet    |       |              |      |        |      |        |         |         |              |      |
| nix.bet      |       |              |      |        |      |        |         |         |              |      |
| starzino.com |       |              |      |        |      |        |         |         |              |      |
| igo.bet      |       |              |      |        |      |        |         |         |              |      |
| chacha.bet   |       |              |      |        |      |        |         |         |              |      |
| casho.bet    |       |              |      |        |      |        |         |         |              |      |

## Brand-specific фокус

| Бренд        | Обязательный фокус регресса                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| gt.bet       | WAF, закрытие signup, persistence языка, возврат из Sports event, metadata/H1, invalid flag, Recent Games            |
| likes.bet    | WAF/CDP-сессия, mobile/desktop parity, provider strong launch, sidebar/chat, metadata разделов                       |
| booms.bet    | Внешний SSO, auth-state persistence, `Load more`, Live Chat, Sports routes/metadata, Recent Games, provider launch   |
| nix.bet      | Mobile/desktop parity, профиль/security, provider surface, overlays, strong game launch                              |
| starzino.com | Overlay карточек провайдеров, mobile KPI, real/demo launch, responsive layout                                        |
| igo.bet      | Profile details/avatar/preferences, provider mapping, Favorites/Recent, country flag, cashier                        |
| chacha.bet   | Locale-prefix (`/ru/` и выбранный язык), Sports routing, WAF, localized metadata                                     |
| casho.bet    | WAF, очень низкая strict-evidence полнота прошлых прогонов, profile access, provider/cashier фактическая доступность |

## 1. Предусловия и доступность

| ID        | P   | Проверка                                   | Ожидаемый результат                                                            | Статус / evidence |
| --------- | --- | ------------------------------------------ | ------------------------------------------------------------------------------ | ----------------- |
| RD-ENV-01 | P0  | Открыть production URL в чистом Chrome     | Загружен правильный бренд без DNS/TLS/5xx                                      |                   |
| RD-ENV-02 | P0  | Дождаться полной hydration                 | Нет blank screen, вечного loader, token-only страницы                          |                   |
| RD-ENV-03 | P0  | Проверить Cloudflare challenge             | Нет бесконечного challenge-loop; приложение доступно после допустимой проверки |                   |
| RD-ENV-04 | P1  | Проверить `http`, `https`, `www`/без `www` | Финальный redirect безопасен, конечный host ожидаемый                          |                   |
| RD-ENV-05 | P1  | Проверить geo/VPN состояние                | Нет неожиданного geo-block; выбранное гео зафиксировано                        |                   |
| RD-ENV-06 | P1  | Hard refresh главной и внутренней страницы | Страница восстанавливается без 404/logout/layout collapse                      |                   |
| RD-ENV-07 | P1  | Открыть внутренний URL в новой вкладке     | Deep link работает независимо от client-side history                           |                   |
| RD-ENV-08 | P1  | Проверить favicon, logo и brand assets     | Нет ассетов другого бренда и broken images                                     |                   |
| RD-ENV-09 | P1  | Зафиксировать Console/Network baseline     | Ошибки разделены на app, API, provider, analytics и WAF                        |                   |
| RD-ENV-10 | P1  | Проверить время/дату/валюту/locale         | Форматы соответствуют выбранному рынку                                         |                   |
| RD-ENV-11 | P0  | Повторить P0 в Safari/WebKit и Firefox     | Core flow работает без engine-specific дефектов                                |                   |

## 2. Главная, header, sidebar и footer

| ID         | P   | Проверка                                         | Ожидаемый результат                                                | Статус / evidence |
| ---------- | --- | ------------------------------------------------ | ------------------------------------------------------------------ | ----------------- |
| RD-HOME-01 | P0  | Проверить header, logo, auth CTA, баланс/кошелёк | Guest/auth элементы соответствуют состоянию сессии                 |                   |
| RD-HOME-02 | P0  | Прокрутить страницу сверху вниз                  | Все секции загружаются; нет горизонтального scroll/перекрытий      |                   |
| RD-HOME-03 | P1  | Проверить hero/banner carousel и каждый CTA      | Слайды управляемы; CTA ведёт в правильный сценарий                 |                   |
| RD-HOME-04 | P1  | Проверить quick navigation/категории             | Иконка, label, active state и URL согласованы                      |                   |
| RD-HOME-05 | P1  | Проверить динамические блоки/jackpot/big wins    | Данные не ломают layout; currency/маскирование корректны           |                   |
| RD-HOME-06 | P1  | Открыть/закрыть sidebar несколькими способами    | Overlay, Escape и click-outside работают; scroll восстанавливается |                   |
| RD-HOME-07 | P1  | Проверить все guest sidebar items                | Нет dead controls; отсутствие capability документировано           |                   |
| RD-HOME-08 | P1  | Проверить все authorized sidebar items           | Profile, assets, bonuses, recent, favorites, referral работают     |                   |
| RD-HOME-09 | P1  | Проверить cookie/age/PWA/app banners             | Баннер читаем, закрывается, выбор сохраняется после refresh        |                   |
| RD-HOME-10 | P1  | Проверить footer accordion/links/social          | Нет 404, неверного домена или перекрывающего sticky UI             |                   |
| RD-HOME-11 | P1  | Повторить ключевой layout на `1366 × 768`        | CTA/sidebar/footer остаются доступными                             |                   |

## 3. Регистрация, login и жизненный цикл сессии

| ID         | P   | Проверка                                           | Ожидаемый результат                                                     | Статус / evidence |
| ---------- | --- | -------------------------------------------------- | ----------------------------------------------------------------------- | ----------------- |
| RD-AUTH-01 | P0  | Открыть Sign Up                                    | Открывается внутренняя форма или заявленный внешний SSO                 |                   |
| RD-AUTH-02 | P1  | Закрыть signup и exit-confirmation                 | Все слои закрыты, focus возвращён, sidebar не открывается               |                   |
| RD-AUTH-03 | P1  | Пустая форма                                       | Required errors привязаны к полям; submit не выполнен                   |                   |
| RD-AUTH-04 | P1  | Невалидные email/phone/password/date/country       | Формат и бизнес-правила валидируются понятно                            |                   |
| RD-AUTH-05 | P0  | Зарегистрировать уникального игрока                | API/UI подтверждают создание; credentials сохранены в закрытом artifact |                   |
| RD-AUTH-06 | P1  | Повторить регистрацию того же идентификатора       | Показана безопасная business error без stack/token                      |                   |
| RD-AUTH-07 | P0  | Проверить состояние сразу после регистрации        | Пользователь авторизован либо видит заявленный следующий шаг            |                   |
| RD-AUTH-08 | P0  | Logout и login новым игроком                       | Новый пароль работает; отображается тот же account                      |                   |
| RD-AUTH-09 | P0  | Login существующим игроком                         | Вход успешен; profile/balance доступны                                  |                   |
| RD-AUTH-10 | P1  | Неверный пароль/несуществующий email               | Сессия не создаётся; ошибка не раскрывает лишние данные                 |                   |
| RD-AUTH-11 | P1  | Forgot password до шага отправки                   | Поле и validation работают; нет account enumeration                     |                   |
| RD-AUTH-12 | P0  | Refresh и 3–4 перехода после login                 | Auth-state сохраняется на всех core routes                              |                   |
| RD-AUTH-13 | P0  | Открыть protected URL в новой вкладке              | Авторизованный доступ сохранён; guest перенаправлен корректно           |                   |
| RD-AUTH-14 | P1  | Дождаться idle и вернуться                         | Нет преждевременного logout; expiry обрабатывается понятно              |                   |
| RD-AUTH-15 | P0  | Logout, Back и refresh protected route             | Приватные данные не восстанавливаются из cache                          |                   |
| RD-AUTH-16 | P1  | Проверить cookies/storage визуально через DevTools | Нет пароля; auth token не появляется в URL/Console                      |                   |

## 4. Навигация, локализация и URL

| ID        | P   | Проверка                                       | Ожидаемый результат                                                 | Статус / evidence |
| --------- | --- | ---------------------------------------------- | ------------------------------------------------------------------- | ----------------- |
| RD-NAV-01 | P0  | Пройти Home, Casino, Live, Sports, Promo, VIP  | Каждый пункт открывает ожидаемый раздел и active state              |                   |
| RD-NAV-02 | P1  | Проверить Back/Forward после цепочки переходов | History не теряет страницу, фильтр и auth-state                     |                   |
| RD-NAV-03 | P1  | Проверить route с/без trailing slash/query     | Нет loop, duplicate page или неожиданного logout                    |                   |
| RD-NAV-04 | P1  | Проверить localized prefix                     | Выбранная locale сохраняется; Chacha не теряет `/ru/`/другой prefix |                   |
| RD-NAV-05 | P1  | Переключить каждый доступный язык              | Header/sidebar/core CTA/validation действительно переведены         |                   |
| RD-NAV-06 | P1  | Дважды refresh после смены языка               | Locale cookie/profile preference имеет приоритет над geo-default    |                   |
| RD-NAV-07 | P1  | Проверить отсутствующие переводы               | Нет ключей, mixed locale и обрезанного текста                       |                   |
| RD-NAV-08 | P1  | Проверить внешние ссылки                       | Правильный host, HTTPS, новая вкладка и `noopener`                  |                   |
| RD-NAV-09 | P1  | Открыть заведомый 404 URL                      | Брендированный 404 с рабочим возвратом, не blank/200 fake page      |                   |

## 5. Casino catalog, search, filters и history

| ID        | P   | Проверка                                      | Ожидаемый результат                                                     | Статус / evidence |
| --------- | --- | --------------------------------------------- | ----------------------------------------------------------------------- | ----------------- |
| RD-CAS-01 | P0  | Открыть `/casino/` guest/auth                 | Каталог и карточки загружены, skeleton исчез                            |                   |
| RD-CAS-02 | P1  | Проверить category/collection chips           | Active state и результаты соответствуют выбору                          |                   |
| RD-CAS-03 | P1  | Открыть Providers и пройти inventory          | Provider list не пуст; названия/ID стабильны                            |                   |
| RD-CAS-04 | P1  | Выбрать одного provider                       | Только соответствующие игры либо корректный empty-state                 |                   |
| RD-CAS-05 | P1  | CLEAR/reset filters                           | Исходный catalog восстановлен полностью                                 |                   |
| RD-CAS-06 | P1  | Переключить Provider/Category/Collection tabs | Панели не смешивают controls и selected state                           |                   |
| RD-CAS-07 | P0  | Поиск существующей игры                       | Результат релевантен, карточка кликабельна                              |                   |
| RD-CAS-08 | P1  | Поиск невозможной строки                      | Понятный zero-state; очистка возвращает catalog                         |                   |
| RD-CAS-09 | P1  | Search + provider filter + clear              | Комбинация детерминирована; нет чужих карточек                          |                   |
| RD-CAS-10 | P1  | Refresh с активным фильтром                   | Persistence соответствует продуктовой модели                            |                   |
| RD-CAS-11 | P1  | Нажать `Load more`/scroll pagination          | Количество растёт либо control исчезает; без дублей/sidebar side effect |                   |
| RD-CAS-12 | P0  | Demo launch доступной игры                    | Игра/iframe/popup загружается без real-money submit                     |                   |
| RD-CAS-13 | P0  | Real launch авторизованным игроком            | Игра загружена либо показан ожидаемый balance/geo gate                  |                   |
| RD-CAS-14 | P1  | Вернуться из игры                             | Catalog остаётся работоспособным; modal/iframe закрыт                   |                   |
| RD-CAS-15 | P1  | Add/remove Favorites                          | Состояние сохранено после refresh и отражено в Favorites                |                   |
| RD-CAS-16 | P1  | Проверить Recent после launch                 | Та же игра появляется по provider/slug/gameId, не только title          |                   |
| RD-CAS-17 | P1  | Проверить broken thumbnails/fallback          | Нет пустых карточек и layout shift                                      |                   |
| RD-CAS-18 | P1  | Проверить keyboard focus на cards/filters     | Основные controls доступны без мыши                                     |                   |

## 6. Casino providers matrix

Для каждого provider из UI inventory заполнить отдельную строку. Нельзя считать один успешный provider доказательством для остальных.

| Provider | В inventory | Filter совпал | Demo | Real | Game surface | Console/Network | Recent linkage | Итог |
| -------- | ----------- | ------------- | ---- | ---- | ------------ | --------------- | -------------- | ---- |
|          |             |               |      |      |              |                 |                |      |

- `provider-absent` допустим только если provider действительно отсутствует в свежем UI/API inventory.
- `passed-strong` требует видимой рабочей game surface; открывшийся route без игры — weak/blocked evidence.
- Массовый WAF/API block фиксировать одной root cause и списком непроверенных providers.

## 7. Live Casino

| ID         | P   | Проверка                              | Ожидаемый результат                                       | Статус / evidence |
| ---------- | --- | ------------------------------------- | --------------------------------------------------------- | ----------------- |
| RD-LIVE-01 | P0  | Открыть `/livecasino/`                | Live catalog фактически загружен, не casino/home fallback |                   |
| RD-LIVE-02 | P1  | Search существующего live game        | Релевантная карточка доступна                             |                   |
| RD-LIVE-03 | P1  | Provider filter и clear               | Результаты соответствуют provider                         |                   |
| RD-LIVE-04 | P1  | Search + filter                       | Комбинация стабильна                                      |                   |
| RD-LIVE-05 | P0  | Запустить 1–5 доступных игр           | Game/lobby или ожидаемый geo/KYC gate                     |                   |
| RD-LIVE-06 | P1  | Проверить WebSocket/network bootstrap | Нет критического disconnect/5xx                           |                   |
| RD-LIVE-07 | P1  | Закрыть game и повторить launch       | Нет зависшего overlay/scroll lock                         |                   |
| RD-LIVE-08 | P1  | Проверить table availability state    | Closed/full table отображается понятно                    |                   |

## 8. Sports и betslip

| ID        | P   | Проверка                                      | Ожидаемый результат                                                  | Статус / evidence |
| --------- | --- | --------------------------------------------- | -------------------------------------------------------------------- | ----------------- |
| RD-SPT-01 | P0  | Открыть `/sports/`                            | Sports content hydrated; это не casino/home fallback                 |                   |
| RD-SPT-02 | P1  | Переключить Live/Pre-match                    | URL/state и события соответствуют выбранному режиму                  |                   |
| RD-SPT-03 | P1  | Переключить Football/Basketball/Tennis        | Поддерживаются `bt-path`, `top` или pretty route по контракту бренда |                   |
| RD-SPT-04 | P1  | Прокрутить длинный список                     | Header/coupon/list остаются стабильны                                |                   |
| RD-SPT-05 | P1  | Открыть league/event                          | Markets/odds видимы, URL изменился                                   |                   |
| RD-SPT-06 | P1  | Вернуться semantic Back                       | Возвращены list, filter, scroll и focus                              |                   |
| RD-SPT-07 | P1  | Повторить browser Back                        | Результат согласован с semantic Back                                 |                   |
| RD-SPT-08 | P0  | Добавить один odds в betslip                  | Selection и актуальный коэффициент отображаются                      |                   |
| RD-SPT-09 | P1  | Добавить второй odds и удалить один           | Coupon пересчитывается корректно                                     |                   |
| RD-SPT-10 | P1  | Toggle/clear betslip                          | Состояние управляемо, overlay не зависает                            |                   |
| RD-SPT-11 | P1  | Ввести пустой/невалидный/min stake без submit | Validation и potential win корректны                                 |                   |
| RD-SPT-12 | P1  | Дождаться odds update                         | Изменение явно показано и не принято скрыто                          |                   |
| RD-SPT-13 | P1  | Проверить BetBuilder только если UI заявлен   | Нет фонового 404 при выключенной capability                          |                   |
| RD-SPT-14 | P1  | Проверить flag assets                         | Нет `undefined.svg`/`null.svg`; fallback доступен                    |                   |
| RD-SPT-15 | P1  | Проверить Sports WebSocket                    | Нет системного reconnect loop/critical error                         |                   |

## 9. Профиль, assets, wallet и персональные данные

| ID        | P   | Проверка                             | Ожидаемый результат                                             | Статус / evidence |
| --------- | --- | ------------------------------------ | --------------------------------------------------------------- | ----------------- |
| RD-ACC-01 | P0  | Открыть `/profile/`                  | Данные принадлежат текущему игроку                              |                   |
| RD-ACC-02 | P0  | Пройти все видимые profile tabs      | Каждый раздел открывается без signup redirect/404               |                   |
| RD-ACC-03 | P1  | Profile details controls             | Поля labelled; данные корректны; Save доступен по контракту     |                   |
| RD-ACC-04 | P1  | Изменить безопасное поле и сохранить | Значение сохраняется после refresh; затем восстановить исходное |                   |
| RD-ACC-05 | P1  | Required/format/length validation    | Ошибка рядом с полем и доступна screen reader                   |                   |
| RD-ACC-06 | P1  | Avatar valid PNG                     | Preview/upload/save работают, если capability заявлена          |                   |
| RD-ACC-07 | P1  | Avatar invalid type/oversize         | Понятная validation; файл не загружен                           |                   |
| RD-ACC-08 | P1  | Security/password surface            | Внутренний UI или корректный переход во внешний SSO             |                   |
| RD-ACC-09 | P1  | Preferences toggles/dropdowns        | Save/persistence после refresh                                  |                   |
| RD-ACC-10 | P0  | Wallet/assets                        | Balance и currency совпадают с header                           |                   |
| RD-ACC-11 | P1  | Transactions/bets history            | Records или корректный empty-state; pagination/filter работают  |                   |
| RD-ACC-12 | P1  | Bonuses                              | Active/available/history и details не смешаны                   |                   |
| RD-ACC-13 | P1  | Favorites/Recent                     | Согласованы с действиями Casino                                 |                   |
| RD-ACC-14 | P1  | Referral                             | Dashboard/link/copy CTA работают; guest получает auth gate      |                   |
| RD-ACC-16 | P1  | Проверить data masking               | Email/phone/card masked по требованиям; чужих данных нет        |                   |

## 10. Smartico — отдельный regression

### Baseline исследовательского прохода

Baseline составлен по фактическим iframe/storage/network evidence последних прогонов и отдельному browser-проходу. Это не заменяет повторную проверку на текущем release.

| Бренд        | Desktop evidence                                                                                         | Что перепроверить в первую очередь                   |
| ------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| gt.bet       | Races и Store создавали `libs.smartico.ai` iframe; Missions/Wheel — без наблюдаемой поверхности          | Missions, Wheel, отсутствующий Achieves              |
| likes.bet    | Пункты Missions/Wheel/Races/Store найдены, но observable Smartico surface не подтверждена                | Все entry points и player identification             |
| booms.bet    | Missions/Wheel/Races/Store создавали Smartico iframe; в свежем guest UI виден `Horror` вместо `Achieves` | Guest gate, SSO return, Horror/Achievements mapping  |
| nix.bet      | Пункты найдены без observable surface; `/api/v1/vip-missions` возвращал `404`                            | Capability contract и каждый entry point             |
| starzino.com | Проверка была заблокирована Cloudflare                                                                   | Полный проход после получения application HTML       |
| igo.bet      | Desktop entry points в последнем evidence отсутствовали                                                  | Capability configuration против mobile               |
| chacha.bet   | Desktop entry points в последнем evidence отсутствовали                                                  | Locale/sidebar/auth-state и capability configuration |
| casho.bet    | Проверка заблокирована Cloudflare; Smartico storage artifacts не подтверждены                            | Наличие интеграции после WAF                         |

`passed` без iframe, route/class change или видимой Smartico-поверхности не считать доказательством.

### Матрица Smartico по бренду

| Функция      | Заявлена | Entry point | Surface loaded | Данные игрока | Persistence | Console/Network | Итог |
| ------------ | -------- | ----------- | -------------- | ------------- | ----------- | --------------- | ---- |
| Missions     |          |             |                |               |             |                 |      |
| Wheel        |          |             |                |               |             |                 |      |
| Races        |          |             |                |               |             |                 |      |
| Achievements |          |             |                |               |             |                 |      |
| Store        |          |             |                |               |             |                 |      |

### Проверки Smartico

| ID        | P   | Проверка                                 | Ожидаемый результат                                                                 | Статус / evidence |
| --------- | --- | ---------------------------------------- | ----------------------------------------------------------------------------------- | ----------------- |
| RD-SMT-01 | P0  | Подтвердить capability/config бренда     | Заявленные Smartico-функции совпадают с видимыми entry points                       |                   |
| RD-SMT-02 | P0  | Проверить Smartico script/bootstrap      | SDK загружен один раз, без fatal JS/CSP/CORS ошибок                                 |                   |
| RD-SMT-03 | P0  | Проверить guest entry points             | Guest получает signup/login gate; приватные данные Smartico не показаны             |                   |
| RD-SMT-04 | P0  | Проверить authorized identification      | Smartico связан с текущим player ID, без данных прошлого игрока                     |                   |
| RD-SMT-05 | P1  | Logout/login другим игроком              | Smartico identity/cache переключены, cross-account leakage отсутствует              |                   |
| RD-SMT-06 | P1  | Проверить все entry points               | Sidebar, hero, popup/deep link открывают одну ожидаемую функцию                     |                   |
| RD-SMT-07 | P1  | Открыть/закрыть каждую поверхность       | Close, Escape, overlay click и повторное открытие работают                          |                   |
| RD-SMT-08 | P1  | Browser Back/Forward с открытым Smartico | History и основной route не ломаются                                                |                   |
| RD-SMT-09 | P1  | Refresh после открытия                   | Поведение соответствует контракту; нет вечного loading iframe                       |                   |
| RD-SMT-10 | P0  | Missions list/empty state                | Активные/завершённые/недоступные missions либо корректный empty state               |                   |
| RD-SMT-11 | P1  | Mission details/progress/CTA             | Условия, progress, reward и deep link согласованы                                   |                   |
| RD-SMT-12 | P1  | Mission reward eligibility без claim     | Locked/claimable state корректен; награда не выдаётся без opt-in                    |                   |
| RD-SMT-13 | P0  | Wheel eligibility и loading              | Wheel загружен; locked/available state объяснён                                     |                   |
| RD-SMT-14 | P1  | Wheel countdown/spins/segments без spin  | Значения валидны, CTA соответствует eligibility                                     |                   |
| RD-SMT-15 | P0  | Races list                               | Current/upcoming/completed races или корректный empty state                         |                   |
| RD-SMT-16 | P1  | Race details/leaderboard/player row      | Позиция, points, timer и reward отображаются согласованно                           |                   |
| RD-SMT-17 | P0  | Achievements entry/label                 | Нет ошибочного/сезонного label вместо заявленного Achievements без product contract |                   |
| RD-SMT-18 | P1  | Achievements categories/progress/details | Progress/locked/completed states и reward согласованы                               |                   |
| RD-SMT-19 | P0  | Store catalog/currency/balance           | Items, цены и Smartico currency загружены; баланс текущего игрока                   |                   |
| RD-SMT-20 | P1  | Store item details/insufficient balance  | CTA/validation корректны; покупка не выполняется без opt-in                         |                   |
| RD-SMT-21 | P1  | Inbox/popups/notifications               | Dismiss/read state сохраняется; popup не дублируется                                |                   |
| RD-SMT-22 | P1  | Localization                             | Labels, content, currency/date и errors соответствуют выбранному языку              |                   |
| RD-SMT-23 | P1  | Accessibility                            | Iframe/dialog имеет title, focus trap/return и keyboard controls                    |                   |
| RD-SMT-24 | P1  | Network/API                              | Нет `vip-missions` 404, 5xx, CORS/CSP errors и бесконечного retry                   |                   |
| RD-SMT-25 | P1  | Privacy/consent/storage                  | IDs/cookies не содержат пароль/PII; consent и expiry соответствуют политике         |                   |
| RD-SMT-26 | P1  | Cross-route persistence                  | Smartico работает после Casino/Live/Sports/Profile и не ломает основной UI          |                   |
| RD-SMT-27 | P1  | Slow network/recovery                    | Есть понятный loader/error/retry; поверхность восстанавливается                     |                   |

Claim reward, spin wheel и Store purchase — только в opt-in destructive проходе с согласованным тестовым игроком.

## 11. Deposit и Withdraw без финансовой операции

| ID        | P   | Проверка                              | Ожидаемый результат                                     | Статус / evidence |
| --------- | --- | ------------------------------------- | ------------------------------------------------------- | ----------------- |
| RD-PAY-01 | P0  | Открыть Deposit из header и profile   | Один рабочий cashier surface, без двойного overlay      |                   |
| RD-PAY-02 | P0  | Сверить UI methods с payment API      | Категории/методы согласованы с geo/currency/player tier |                   |
| RD-PAY-03 | P1  | Открыть каждый видимый method         | Форма готова; нет вечного loader/4xx/blank iframe       |                   |
| RD-PAY-04 | P1  | Проверить min/max/fee/currency        | Значения видимы и согласованы                           |                   |
| RD-PAY-05 | P1  | Пустая/невалидная сумма               | Submit заблокирован; validation понятна                 |                   |
| RD-PAY-06 | P1  | Проверить method back/close           | Возврат не ломает wallet/page scroll                    |                   |
| RD-PAY-07 | P1  | Проверить Bank Transfer отдельно      | Surface загружается в пределах SLA, без timeout         |                   |
| RD-PAY-08 | P0  | Открыть Withdraw                      | Методы или явный KYC/rollover/balance gate              |                   |
| RD-PAY-09 | P1  | Невалидная сумма/requisite без submit | Validation работает; операция не создаётся              |                   |
| RD-PAY-10 | P1  | Проверить истории deposit/withdraw    | Status/date/amount/currency читаемы                     |                   |
| RD-PAY-11 | P1  | Network safety                        | Нет mutation request до явного подтверждения            |                   |

## 12. Promo, VIP, bonus и referral

| ID        | P   | Проверка                             | Ожидаемый результат                                       | Статус / evidence |
| --------- | --- | ------------------------------------ | --------------------------------------------------------- | ----------------- |
| RD-PRM-01 | P0  | Открыть `/promotions/`               | Карточки/условия загружены, не generic fallback           |                   |
| RD-PRM-02 | P1  | Открыть каждую доступную detail page | Title, dates, CTA, T&C соответствуют карточке             |                   |
| RD-PRM-03 | P1  | CTA guest/auth                       | Guest получает signup; auth — eligibility/activation flow |                   |
| RD-PRM-04 | P1  | Проверить expired/ineligible state   | Нельзя активировать; причина понятна                      |                   |
| RD-VIP-01 | P0  | Открыть `/vip/`                      | Контент, levels и CTA соответствуют бренду                |                   |
| RD-VIP-02 | P1  | Проверить VIP CTA                    | Правильный auth/support/activation target                 |                   |
| RD-REF-01 | P1  | Referral link/copy/share             | Значение корректно; copy feedback видим                   |                   |

## 13. Support, legal и коммуникации

| ID        | P   | Проверка                           | Ожидаемый результат                                            | Статус / evidence |
| --------- | --- | ---------------------------------- | -------------------------------------------------------------- | ----------------- |
| RD-SUP-01 | P1  | Открыть Live Chat guest            | Widget/pre-chat действительно открылся, не только button click |                   |
| RD-SUP-02 | P1  | Minimize/reopen/close              | Состояния работают и не блокируют страницу                     |                   |
| RD-SUP-03 | P1  | Заполнить pre-chat без отправки    | Validation/consent доступны                                    |                   |
| RD-SUP-04 | P1  | Открыть Chat authorized            | Identity не смешана с guest; composer доступен по capability   |                   |
| RD-LEG-01 | P0  | Terms, Privacy, Responsible Gaming | Правильный бренд/locale; нет 404                               |                   |
| RD-LEG-02 | P1  | AML/KYC/Bonus terms/Cookie policy  | Документы доступны и читаемы                                   |                   |
| RD-LEG-03 | P1  | License, 18+, contacts             | Данные видимы и не противоречат рынку                          |                   |
| RD-LEG-04 | P1  | Social/app external links          | Официальный target, HTTPS, безопасная новая вкладка            |                   |

## 14. Metadata, accessibility, visual и performance

| ID        | P   | Проверка                        | Ожидаемый результат                                                           | Статус / evidence |
| --------- | --- | ------------------------------- | ----------------------------------------------------------------------------- | ----------------- |
| RD-QLT-01 | P1  | Title на всех top routes        | Уникален разделу; Sports/Live/Promo не используют generic Casino title        |                   |
| RD-QLT-02 | P1  | H1                              | Ровно один осмысленный H1 либо согласованный SSR accessible H1                |                   |
| RD-QLT-03 | P1  | Canonical/OG/title              | Host, locale и route согласованы                                              |                   |
| RD-QLT-04 | P1  | Keyboard-only core flow         | Видимый focus, логичный order, нет keyboard trap                              |                   |
| RD-QLT-05 | P1  | Accessible names/errors/dialogs | Controls labelled; modal имеет focus management                               |                   |
| RD-QLT-06 | P1  | Axe critical scan top routes    | Нет critical violations; исключения задокументированы                         |                   |
| RD-QLT-07 | P1  | Broken images/fonts/icons       | Нет системных asset errors/fallback text                                      |                   |
| RD-QLT-08 | P1  | Layout shift/loading states     | Skeleton исчезает; CTA не прыгает при взаимодействии                          |                   |
| RD-QLT-09 | P1  | Core route load                 | Нет очевидной деградации относительно baseline                                |                   |
| RD-QLT-10 | P1  | Console errors                  | Каждая app/provider error классифицирована; critical исправлена/заведена      |                   |
| RD-QLT-11 | P1  | Network 4xx/5xx/failed          | Нет критических API/resource ошибок; optional probe отделён                   |                   |
| RD-QLT-12 | P1  | Sensitive data                  | Пароль/token/payment data отсутствуют в URL/Console/report                    |                   |
| RD-QLT-13 | P1  | Auth/Payment OpenAPI contracts  | Spectral/Schemathesis выполняются по versioned schema; missing schema не PASS |                   |
| RD-QLT-14 | P1  | HTTPS/CSP/mixed content/cookies | Нет blocked active content; headers/cookie flags соответствуют контракту      |                   |

## 15. Opt-in destructive проверки

Выполнять только при явном разрешении и на специально подготовленном игроке.

| ID        | P   | Проверка                             | Ожидаемый результат                                                  | Статус / evidence |
| --------- | --- | ------------------------------------ | -------------------------------------------------------------------- | ----------------- |
| RD-DST-01 | P1  | Полная password reset + login        | Новый пароль работает, старый отклоняется                            |                   |
| RD-DST-02 | P1  | Change password + session checks     | Rotation корректна; другие сессии ведут себя по требованиям          |                   |
| RD-DST-03 | P1  | Отправка guest support message       | Сообщение видно; нет дублей                                          |                   |
| RD-DST-04 | P1  | Отправка authorized support message  | Identity и delivery корректны                                        |                   |
| RD-DST-05 | P1  | Test deposit/withdraw/bet            | Только sandbox/test funds; статус согласован с backend               |                   |
| RD-DST-06 | P1  | Smartico reward/wheel/store mutation | Только согласованный test reward; balance/history обновлены один раз |                   |

## Критерии завершения

- `GO`: все применимые P0 — PASS; для P1 `FAIL/PRODUCT BLOCKED/INFRA BLOCKED` созданы баги и принято release-решение.
- `NO-GO`: любой P0 FAIL; невозможны загрузка, auth, core navigation, catalog/game, Sports/betslip или cashier surface.
- Регресс незавершён, если у применимого P0 остался `NOT RUN`, `PARTIAL` или неподтверждённый `N/A`.
- Итог должен содержать totals по статусам, список непроверенного, root causes вместо дублей, ссылки на screenshots/video/trace/network и автоматический report.

## Команды автоматизированного дополнения

```bash
node scripts/qa-brand-run.js --brand=<brand> --mode=desktop --profile=full
npm run qa:localization:<brand>:desktop
PW_VISUAL_REGRESSION=1 npx playwright test tests/visual --project=desktop --workers=1
```

Автопрогон не заменяет ручной desktop regression.
