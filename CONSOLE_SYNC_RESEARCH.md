# PlayStation Network і Xbox Network — дослідження Console Activity Sync

## Рішення

PlayStation Network і Xbox Network можна додати до PRGLauncher як джерела console activity, але вони не мають такого ж безпечного та стабільного consumer-потоку, як Nintendo Sync. Обидва можуть дати цінний результат у beta-прототипі; жоден не варто обіцяти як «офіційну синхронізацію повної бібліотеки й точного часу» до реальної перевірки на кількох акаунтах і юридичної оцінки умов платформ.

| Можливість | PlayStation Network | Xbox Network |
|---|---|---|
| Зіграні ігри | Технічно доступні через недокументовані PSN endpoints | Частково: title history / recent titles |
| Історичний час | Технічно доступний для played games у неофіційних клієнтах | Не підтверджений універсальний API для загального часу |
| Куплені digital PS4/PS5 ігри | Технічно доступні у неофіційному клієнті | Не підтверджена повна й стабільна бібліотека для стороннього застосунку |
| PS3/Vita / фізичні диски | Не гарантуються як purchases; можуть бути видимі через trophies/activity | Не застосовується |
| Офіційний public API для PRGLauncher | Не знайдено | Є game-developer Xbox Services API, але він не є універсальною consumer library API |
| Безпечний публічний реліз зараз | Ні, лише opt-in experimental прототип | Обережний beta після перевірки авторизації та scope |

Висновок: **Xbox — досліджувати і прототипувати першим; PlayStation — лише в режимі локального експерименту, доки немає партнерського/офіційного шляху.** Це не означає, що PSN неможливий: навпаки, дані технічно виглядають дуже корисними. Ризик саме в авторизації, довгостроковій підтримці та умовах Sony.

## Який результат повинен мати Console Sync

Інтеграція не повинна лише разово додати список ігор. Вона має поводитися так само продумано, як Nintendo Sync:

1. Користувач підключає конкретний console account через видимий, зрозумілий потік авторизації.
2. PRGLauncher показує картки: обкладинка, назва, платформа, зафіксований час, остання активність, статус для імпорту.
3. Користувач сам вирішує, які ігри додавати. Пропущені ігри стають `ignored` і не спливають знову, доки не натиснуто «Запросити весь список».
4. Наступний sync не імпортує всю історію повторно: зберігається fingerprint зовнішньої гри, попередній cumulative playtime, остання дата та ідентифікатори вже створених сесій.
5. Коли час збільшився, PRGLauncher додає лише дельту. Коли з’явилася нова гра — вона потрапляє в pending review, а повідомлення показується тільки при відкритті основного вікна, не в tray.
6. Платформа й джерело часу видимі у картці: `PlayStation 5 · PSN sync` або `Xbox Series X|S · Xbox sync`.

На відміну від PC-лаунчерів, PRGLauncher не може запускати PS5/Xbox гру з Windows чи точно відстежувати процес консолі. Джерелом істини завжди лишається серверна історія самої платформи; отже sync є періодичним, а не realtime.

## PlayStation Network

### Що видно користувачу офіційно

Sony підтверджує, що PlayStation збирає та прив’язує до акаунта відомості про ігри, trophies і in-game progress. Користувач може обирати, хто бачить поточну гру та gaming history, а також приховувати конкретні ігри. Це означає, що будь-який read-only sync зобов’язаний поважати privacy settings, hidden games і дитячі акаунти. [PlayStation privacy & safety](https://www.playstation.com/en-us/privacy-security-safety/), [PS5 privacy controls](https://www.playstation.com/en-au/support/account/privacy-settings/)

Sony також показує, що playtime існує у власних family products: Family app відображає current game, online status і hours from the past week для дитячих акаунтів. Це доказ наявності даних у платформі, але не дозвіл сторонньому застосунку читати ці дані. [PlayStation Family app](https://www.playstation.com/en-us/ps-family-app/)

### Що технічно доступне сьогодні

Підтримувана community-бібліотека `psn-api` документує отримання:

- purchased PS4/PS5 games;
- recently played games;
- user played games із playtime, впорядкованих за недавністю;
- trophy titles, трофеї та progress;
- профіль, devices і presence.

Це майже ідеально відповідає тому, що потрібне PRGLauncher. Однак це **не офіційний Sony API**: сама спільнота описує його як API, відтворений на підставі запитів PlayStation web/app. [psn-api README](https://github.com/achievements-app/psn-api), [підтвердження reverse-engineered характеру альтернативного клієнта](https://github.com/isFakeAccount/psnawp)

Важлива межа даних:

- `getPurchasedGames()` у цьому підході обіцяє тільки digital PS4/PS5 purchases;
- `getUserPlayedGames()` може дати зіграні ігри і час, але не є гарантією повного каталогу всіх поколінь;
- trophy history залежить від того, чи гра має trophies і чи синхронізувались вони;
- приховані ігри, privacy settings, дитячі акаунти та регіон можуть змінити результат.

Отже у UI не можна називати результат «Вся PlayStation бібліотека». Коректна назва: **«Ігри й activity, доступні PlayStation Network для цього акаунта»**.

### Авторизація: головний ризик

Неофіційні PSN клієнти зазвичай просять NPSSO — session value, який обмінюється на access і refresh tokens. Їхня власна документація прямо попереджає: NPSSO еквівалентний паролю. Такий токен не можна просити користувача копіювати в PRGLauncher, не можна зберігати в Firebase і не можна показувати в логах. [psn-api authentication notes](https://github.com/achievements-app/psn-api)

Нормальний OAuth-потік `Sign in with PlayStation`, де PRGLauncher отримує мінімальний документований scope, для незалежного consumer launcher не знайдений. Крім того, умови PlayStation вебсайтів забороняють web scraping/data mining і дозволяють Sony вимкнути доступ за порушення. Це не є юридичним висновком, але робить масовий продукт на reverse-engineered endpoints ризиковим без письмової відповіді/партнерства Sony. [PlayStation Website Terms, March 2026](https://www.playstation.com/en-us/legal/website-terms-of-use/)

### Безпечні варіанти

**Варіант A — офіційний партнерський шлях, рекомендований для публічного релізу.** Звернутися до PlayStation Partners / Sony з описом read-only tracker-а й попросити дозволений API/авторизацію. Це найдовший шлях, але єдиний, що не ставить під ризик акаунти користувачів.

**Варіант B — локальний Experimental Prototype.** Тільки для добровільних тестерів, вимкнений за замовчуванням. Умови:

- жодного автоматичного вилучення browser cookies;
- окреме попередження, що інтеграція недокументована та може перестати працювати;
- токен зберігається лише в Windows DPAPI/macOS Keychain, ніколи не синхронізується у PRG Account;
- мінімальна частота: ручний sync і, наприклад, 6–12 годин, без polling;
- `Від’єднати PlayStation` видаляє token, кеш і scheduled sync;
- не додавати автоматичні дії, повідомлення, friends або write endpoints.

Навіть для цього варіанта потрібна окрема перевірка terms, бо сам факт використання reverse-engineered mobile/web endpoints може бути неприйнятним для продукту.

**Варіант C — public-profile import без токена.** Можна прийняти online ID і читати лише те, що користувач сам зробив видимим. Це найменший security risk, але дірявий за даними та не підходить як приватний синк. Його можна використати тільки як тимчасову функцію «імпортувати видиму PSN activity».

### Що тестувати, якщо буде прототип

1. Власний акаунт із PS4, PS5, digital, physical і PS Plus іграми.
2. Гра без трофеїв, гра без часу, прихована гра, щойно зіграна гра.
3. Чи змінюється total playtime, коли зіграти 10–20 хвилин.
4. Чи повертається нова game session або лише cumulative time.
5. Refresh token: термін життя, повторний login, реакція на password reset та 2FA.
6. Чи не бачить PRGLauncher нічого зайвого: список друзів, повідомлення і payment data поза scope продукту.

## Xbox Network

### Що підтримує Microsoft офіційно

Microsoft має документовані Xbox Services APIs, але вони призначені для продуктів, зареєстрованих у Xbox developer program / Partner Center. Їх потрібно конфігурувати в контексті конкретного Xbox product: Title ID, MSA App ID і Service Configuration ID. Це не відкритий аналог Steam Web API для стороннього менеджера бібліотеки. [Configuring Xbox services](https://learn.microsoft.com/en-us/gaming/game-publishing/concepts/xbox-services)

Документований endpoint achievement title history повертає ігри, для яких користувач розблокував achievement або має achievement progress. Microsoft прямо вказує, що це **не повна історія запущених чи зіграних ігор**. Також це не універсальний total-playtime API. [Xbox title history documentation](https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/live/rest/uri/titlehistory/uri-titlehistoryusersxuidhistorytitlesv2?view=gdk-2604)

Іншими словами, Xbox має більш явну офіційну технічну поверхню, але навіть вона не гарантує результат «усі ігри + весь час». Документація про achievements описує запити в рамках конкретного title/user контексту, а не consumer-library export. [Xbox achievements API overview](https://learn.microsoft.com/en-us/gaming/gdk/docs/services/player-data/achievements/achievements-manager/live-achievements-manager-overview?view=gdk-2510)

### Що технічно роблять існуючі клієнти

Існують community-клієнти Xbox Web API, які через Xbox Live web services отримують recently played titles і title info. Це корисна технічна основа для прототипу, але також не є стабільним публічним контрактом Microsoft для PRGLauncher. [Xbox-WebAPI title history](https://xbox-webapi-python.readthedocs.io/en/latest/source/xbox.webapi.api.provider.titlehub/)

Відкрита Xbox integration Playnite підтверджує, що акаунтовий імпорт можливий, але її власна документація попереджає: вона може імпортувати тільки ігри, які були запущені хоча б один раз. Це узгоджується з обмеженням title history і означає, що куплені, але ніколи не запущені Xbox-ігри можуть не з’явитися. [Playnite Xbox troubleshooting](https://github-wiki-see.page/m/JosefNemec/PlayniteExtensions/wiki/Xbox-Library-troubleshooting)

### Що можна побудувати

**MVP Xbox Activity Sync** може бути дуже корисним навіть без повної бібліотеки:

- Microsoft/Xbox login у окремому вікні;
- gamertag, avatar і список recently played / achievement history;
- Xbox One, Series X|S, 360 та PC класифікуються окремо, коли платформа відома;
- нові зіграні ігри потрапляють у pending review;
- новий title або зміна доступного часу/активності створює delta-event;
- обкладинки нормалізуються через IGDB/RAWG, якщо Xbox endpoint не має придатної;
- якщо платформа не віддає total time, PRGLauncher показує `Activity detected` і дату, а не вигаданий лічильник годин.

**Не можна обіцяти в MVP:** повну owned library, усі Game Pass entitlement-и, ігри без achievements, точний cumulative playtime і запуск console games із ПК.

### Авторизація й privacy

Для Xbox перший крок — перевірити, чи може окремий зареєстрований Microsoft app отримати необхідний delegated scope без порушення Xbox Services requirements. Не використовувати чужий client ID із Xbox App, не копіювати XSTS tokens із браузера і не приймати user password. Якщо потрібного дозволеного flow немає, Xbox має перейти в той самий `Experimental local-only` клас, а не обходити захист неофіційними секретами.

Privacy також не можна обійти: Microsoft endpoint-и та Xbox профіль залежать від обраних гравцем privacy settings. PRGLauncher читає лише активність самого авторизованого користувача й не використовує friends lookup.

## Рекомендована модель даних

```js
game.sources = [
  {
    provider: 'nintendo' | 'playstation' | 'xbox',
    externalId: 'provider-stable-id',
    platform: 'Nintendo Switch' | 'PlayStation 5' | 'Xbox Series X|S',
    ownership: 'owned' | 'subscription' | 'played-only' | 'unknown',
    importedPlaytimeMs: null,
    importedLastPlayedAt: null,
    lastSyncAt: null,
    visibility: 'available' | 'hidden-by-provider' | 'unavailable'
  }
];
```

Для кожного console source вести `lastSeenMinutes`, `lastSeenPlayedAt`, `sessionFingerprints[]`, `ignoredExternalIds[]` та `notifiedExternalIds[]` у profile-scoped storage — за тим самим принципом, що вже працює для Nintendo. Не ототожнювати гру тільки за назвою: PSN/Xbox можуть мати різні edition/subtitle. Для автоматичного збігу використовувати provider ID, а кросплатформове злиття підтверджує користувач.

## Delta-sync без фантазій

1. Отримати поточний список activity.
2. Зіставити item за `provider + externalId`.
3. Якщо game нова — pending review, не додавати тихо.
4. Якщо `currentMinutes > lastSeenMinutes` — створити одну session-delta `current - lastSeen` лише коли платформа віддає cumulative minutes.
5. Якщо доступні тільки recently played/title history без часу — оновити `lastPlayedAt`, але не створювати фальшиву session duration.
6. Після успішного збереження оновити watermark. Якщо sync впав — watermark не рухати.

Така модель переживе неповні й запізнілі дані краще, ніж спроба вгадати кожну реальну console session.

## Порядок дій

1. Завершити Multi-Launcher Foundation (`sources[]`, merge UI, source-aware playtime).
2. **Xbox discovery spike:** перевірити дозволений Microsoft authorization flow і на одному тестовому акаунті зафіксувати точні поля, які повертаються без private endpoints.
3. Якщо scope достатній — зробити Xbox Activity Sync Beta без заяви про повну бібліотеку.
4. **PlayStation legal/technical spike:** звернутися в PlayStation Partners або отримати письмове підтвердження допустимого read-only сценарію.
5. До отримання такого шляху не включати PSN token import у публічний інсталятор. За потреби зробити лише локальний developer prototype на тестовому акаунті.
6. Лише після успішних прототипів додавати налаштування, auto-sync, pending review і dashboard console stats.

## Чого не робити

- Не просити користувача вставляти NPSSO, access token, XSTS token, cookie або пароль у звичайне текстове поле.
- Не витягувати cookies із Chrome/Edge/PlayStation App/Xbox App.
- Не обіцяти, що PSN або Xbox sync бачить «усе».
- Не запускати частий polling, особливо на недокументованих endpoints.
- Не змішувати activity history, trophies, owned licenses і subscription access в один статус `Owned`.
- Не пушити будь-які console auth secrets у Firebase, Netlify, GitHub logs чи backup JSON.

## Джерела

1. Sony Interactive Entertainment. [Privacy, account security & online safety](https://www.playstation.com/en-us/privacy-security-safety/). Перевірено вересень 2026.
2. Sony Interactive Entertainment. [How to manage privacy settings on PlayStation](https://www.playstation.com/en-au/support/account/privacy-settings/). Перевірено вересень 2026.
3. Sony Interactive Entertainment. [PlayStation Family app](https://www.playstation.com/en-us/ps-family-app/). Перевірено вересень 2026.
4. achievements-app. [psn-api](https://github.com/achievements-app/psn-api). Неофіційна community implementation; використана як технічне, не юридичне джерело.
5. isFakeAccount. [PSNAWP](https://github.com/isFakeAccount/psnawp). Неофіційна reverse-engineered implementation; використана для оцінки ризику авторизації.
6. Sony Interactive Entertainment. [Website Terms of Use](https://www.playstation.com/en-us/legal/website-terms-of-use/), updated March 11, 2026.
7. Microsoft. [Configuring Xbox services](https://learn.microsoft.com/en-us/gaming/game-publishing/concepts/xbox-services). Перевірено вересень 2026.
8. Microsoft. [Xbox achievement title history](https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/live/rest/uri/titlehistory/uri-titlehistoryusersxuidhistorytitlesv2?view=gdk-2604). Last updated November 6, 2025.
9. Microsoft. [Xbox Achievements Manager API overview](https://learn.microsoft.com/en-us/gaming/gdk/docs/services/player-data/achievements/achievements-manager/live-achievements-manager-overview?view=gdk-2510). Перевірено вересень 2026.
10. OpenXbox. [Xbox-WebAPI title history](https://xbox-webapi-python.readthedocs.io/en/latest/source/xbox.webapi.api.provider.titlehub/). Неофіційна community implementation.
11. Playnite. [Xbox Library troubleshooting](https://github-wiki-see.page/m/JosefNemec/PlayniteExtensions/wiki/Xbox-Library-troubleshooting). Практичний приклад обмеження імпорту.
