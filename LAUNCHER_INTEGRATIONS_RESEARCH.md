# Інтеграції EGS, GOG, Ubisoft Connect, EA app і Battle.net

## Висновок

PRGLauncher може підтримати всі п’ять екосистем, але їм не можна обіцяти однаковий рівень інтеграції зі Steam. У Steam є стабільний публічний Web API для профілю та бібліотеки. У цих платформах публічних API для стороннього застосунку, який отримує **всю приватну бібліотеку та історичний час**, або немає, або вони призначені для розробника конкретної гри, а не для бібліотечного лаунчера.

Правильна стратегія: спочатку додати безпечне визначення **локально встановлених** ігор, запуск із PRGLauncher і точний час, який відтепер рахує сам PRGLauncher. Потім, окремо для кожної платформи, додавати опціональний імпорт усієї бібліотеки через одноразовий web-login. Цей режим мусить прямо маркуватися як `Beta / може потребувати повторного входу`.

| Платформа | Встановлені ігри | Вся бібліотека | Історичний час | Запуск / встановлення | Оцінка першої версії |
|---|---|---|---|---|---|
| **GOG Galaxy** | Так, надійно | Так, але через web-сесію | Так, коли дані доступні | Так | Найкращий кандидат №1 |
| **Epic Games Store** | Так, надійно | Можливо, але не через публічний API | Немає стабільного шляху | Так | Кандидат №2 |
| **Ubisoft Connect** | Так, надійно | Імовірно з локального кешу Connect | Немає стабільного шляху | Так | Кандидат №3 |
| **Battle.net** | Так, надійно | Можливо через web-сесію, непублічний шлях | Немає універсального шляху | Так | Кандидат №4 |
| **EA app / EA Play** | Так, з обережністю | Можливо лише крихким неофіційним способом | Немає стабільного шляху | Так | Кандидат №5 |

`EA Play` — не окремий PC-лаунчер. Це підписка всередині EA app, Steam або Xbox. Для PRGLauncher джерелом буде **EA app**, а кожна така гра повинна мати тип права `Subscription`, а не `Owned`: вона може зникнути з доступу після завершення підписки.

## Що саме означає «підтримка»

Щоб не повторити ситуацію з ранніми Steam/Nintendo-експериментами, для кожного провайдера потрібно розділити шість можливостей:

1. **Виявити клієнт** — зрозуміти, чи встановлений лаунчер.
2. **Знайти встановлені ігри** — прочитати лише локальні маніфести, реєстр або uninstall-записи; це не потребує пароля чи токена.
3. **Імпортувати повну бібліотеку** — показати картки з обкладинками, пошуком, «Обрати всі» та вибором статусу, як у Steam.
4. **Запустити / поставити на завантаження** — відкрити гру або її сторінку у нативному клієнті через офіційний URL-protocol чи виконуваний файл.
5. **Вести час** — або імпортувати історичне значення платформи, або рахувати майбутні сесії власним трекером PRGLauncher.
6. **Розуміти інсталяцію** — спочатку хоча б `не встановлена → встановлена`; прогрес завантаження є окремим, значно менш стабільним завданням.

Пункти 1, 2, 4 і власний час для встановленої гри — практично реальні для всіх п’яти на Windows. Найризиковіші — 3, історичний час і live-прогрес завантаження.

## Порівняння платформ

### 1. GOG Galaxy — починати з нього

**Що можна зробити.** GOG Galaxy має найкращу комбінацію локальної інформації та даних акаунта. Встановлена гра містить `goggame-<id>.info` з ідентифікатором та launch-task; її також можна знайти в uninstall-записах GOG. Відома відкрита реалізація Playnite читає ці дані, запускає гру через Galaxy або напряму, а для залогіненого користувача отримує список куплених ігор, playtime та last activity. Вона конвертує серверне значення playtime у секунди і зберігає дату останньої активності. Це практичний доказ, що потрібний UX можливий. [Код інтеграції GOG](https://raw.githubusercontent.com/JosefNemec/PlayniteExtensions/master/source/Libraries/GogLibrary/GogLibrary.cs)

**Чого не робити.** Офіційний GOG Galaxy SDK призначений для гри, яка має власні client credentials, а не для універсального лаунчера. Документація прямо описує credentials для конкретної гри; `SignInCredentials(login, password)` позначено лише для тестування, не для production. Не можна просити або зберігати пароль GOG у PRGLauncher. [GOG Galaxy SDK](https://docs.gog.com/galaxyapi/), [обмеження SignInCredentials](https://docs.gog.com/galaxyapi/classgalaxy_1_1api_1_1IUser.html)

**Безпечна реалізація.** Відкрити вікно входу `gog.com` усередині контрольованого Electron BrowserWindow/WebContents; користувач сам проходить пароль, 2FA і captcha на сторінці GOG. PRGLauncher не читає пароль. Після підтвердження треба зберігати лише мінімальний зашифрований cookie/token у системному сховищі Windows, не у Firebase і не в `localStorage`. На ручне «Від’єднати GOG» — видалити сесію. Оскільки це не документований consumer API, інтеграція має мати м’яку деградацію: якщо сесія протухла, показати «Увійди повторно», але не прибирати вже імпортовані ігри.

**Час.** Перший імпорт: історичний `playtime` і `lastActivity`, якщо GOG їх віддав. Далі: порівнювати нове значення з попереднім, а сесію створювати тільки на дельту; також вести власний таймер PRGLauncher як резерв. Не додавати локальний і серверний час двічі — джерело часу повинно бути позначене (`GOG` або `PRG tracked`).

**Вердикт:** перша повна інтеграція після Steam.

### 2. Epic Games Store — локальна підтримка дуже добра, акаунтова менш надійна

**Що можна зробити без логіну.** Epic Launcher залишає чіткі JSON-маніфести у `%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item`, а також список у `LauncherInstalled.dat`. У них є App Name, назва, install location, executable та інші дані, достатні для картки «встановлено», для запуску і для виявлення появи гри після інсталяції. Відкрита інтеграція Playnite використовує саме ці шляхи та URI `com.epicgames.launcher://apps/...` для запуску й `?action=install` для встановлення. [Epic launcher integration source](https://raw.githubusercontent.com/JosefNemec/PlayniteExtensions/master/source/Libraries/EpicLibrary/EpicLauncher.cs)

**Повна бібліотека.** Epic має OAuth / Sign in with Epic, але це не дорівнює загальнодоступному API бібліотеки EGS. Epic пояснює, що сторонній продукт може отримати тільки те, на що користувач явно погодився; наявність Epic login сама по собі не означає доступу до покупок чи entitlement-ів. Документація EOS/EGS у першу чергу орієнтована на розробника власної гри або продукту. [Epic про доступ сторонніх продуктів](https://www.epicgames.com/help/c-45487929/c-40721840/a12351724), [OAuth overview](https://dev.epicgames.com/documentation/en-us/fortnite/oauth)

Технічно можливо повторити підхід великих unified-launcher’ів: web-login + приватні запити вебклієнта. Але це **не контрактований API**, тож Epic може змінити його будь-якого дня. Потрібні ротація сесії, докладні помилки, remote feature flag і можливість швидко вимкнути акаунтовий імпорт без поломки всієї програми.

**Час.** Не обіцяти перенос історичного EGS playtime: стабільного, публічного шляху немає. Після того як користувач імпортує або запускатиме гру через PRGLauncher, відстежувати дочірній процес за встановленим шляхом і створювати сесію локально. Якщо гру запущено вручну, можна виявляти процес за install path кожні кілька секунд; назви `.exe` не достатньо, бо вони часто повторюються.

**Вердикт:** робити другим етапом. В MVP: `installed scan + launch + PRG time`; повну бібліотеку додавати тільки як beta.

### 3. Ubisoft Connect (колишній Uplay) — сильний локальний варіант

**Що можна зробити.** На Windows встановлені Ubisoft-ігри доступні в `HKLM\SOFTWARE\Ubisoft\Launcher\Installs\<gameId>` через `InstallDir`. Відкрита інтеграція Playnite реалізує саме такий скан, а її локальний product cache містить назву, іконку та обкладинку для не-DLC продуктів. Це дає нормальний перший імпорт без того, щоб PRGLauncher знав пароль Ubisoft. [Uplay/Ubisoft integration source](https://raw.githubusercontent.com/JosefNemec/PlayniteExtensions/master/source/Libraries/UplayLibrary/UplayLibrary.cs)

**Повна бібліотека.** У Ubisoft Connect справді є бібліотека і PC-функції, але публічної developer-документації для стороннього «дай мені всі куплені ігри цього користувача» немає. [Опис Ubisoft Connect](https://bluebyte.ubisoft.com/en/portfolio/ubisoft-connect/) Локальний cache може виявитися достатнім, якщо Connect залогінений і вже завантажив каталог, але на це не можна покладатися як на серверну істину. Альтернатива — web-login і внутрішні endpoints, тобто та сама beta-ризик модель, що й EGS.

**Час.** Для загального профілю Ubisoft немає безпечного універсального історичного лічильника. Рахувати майбутні сесії за процесом/директорією. Старт через Ubisoft Connect має передавати PRGLauncher game ID; потім відстежувати не тільки `upc.exe`, а процес гри, інакше час буде неправильний.

**Вердикт:** хороший третій крок, спочатку «тільки встановлені»; повна бібліотека — лише після реального тесту кешу різних користувачів.

### 4. Battle.net — добре для встановлених Blizzard-ігор, обережно для акаунта

**Що можна зробити без логіну.** Battle.net залишає uninstall-записи з `--uid=<product>` та fallback базу `%ProgramData%\Battle.net\Agent\product.db`. Відкрита інтеграція Playnite використовує обидва варіанти, бо registry keys бувають відсутні. Вона також запускає клієнт із `--game=<id>` і моніторить дерево процесів, а не сам Battle.net Agent. [Battle.net library source](https://raw.githubusercontent.com/JosefNemec/PlayniteExtensions/master/source/Libraries/BattleNetLibrary/BattleNetLibrary.cs), [про запуск і процес-стеження](https://github.com/JosefNemec/PlayniteExtensions/blob/master/source/Libraries/BattleNetLibrary/BattleNetGameController.cs)

**Повна бібліотека.** Battle.net має OAuth 2.0 і офіційні game-data API, але вони орієнтовані на певні ігрові домени (WoW, Diablo, StarCraft) і не документують узагальнений список усіх entitlement-ів у launcher-бібліотеці. [Blizzard OAuth sample](https://github.com/Blizzard/oauth-client-sample), [Blizzard про API](https://news.blizzard.com/en-us/article/15318054/attention-web-developers) Тому офіційний OAuth може бути корисний для ідентичності користувача, але не є доказом, що він дасть каталог куплених ігор. Існуючі unified-launcher’и отримують список через web-session/private endpoints — теж beta та maintenance burden.

**Час.** Universal historical time не варто обіцяти. Для WoW, Diablo тощо дані дуже різні та не дорівнюють «playtime у лаунчері». Майбутній час — через власний моніторинг процесу гри. Для онлайн-ігор потрібна логіка, що Agent і update-process не є запущеною грою.

**Вердикт:** четвертий, почати з локальних інсталяцій і запуску.

### 5. EA app / EA Play — підтримувати, але ставити останньою

**Факти.** EA app — це клієнт, де лежать куплені й встановлені EA-ігри; EA також показує користувачу `My Playtime` у Settings. [EA app guide](https://help.ea.com/en///articles/platforms/how-to-use-ea-app/) Але EA не публікує підтримуваний API для сторонньої повної бібліотеки або playtime. Додатковий ризик: зафіксований приклад Playnite показує, що їхня стара інтеграція використовувала Origin APIs і зламалася під час завершення Origin / переходу на EA app; підтримувач прямо зауважив, що backend змінився. [Issue про поломку EA integration](https://github.com/JosefNemec/PlayniteExtensions/issues/448)

**Що реально робити.** Виявляти EA app, знаходити встановлені ігри за локальними даними/записами встановлення, запускати через сам клієнт і вести власний час. Через те, що схеми EA внутрішніх даних уже змінювалися, перед реалізацією потрібно зібрати анонімні діагностичні приклади від кількох тестерів, а парсери робити versioned і fail-safe.

**EA Play.** Не помічати такі ігри як постійно «куплені». Зберігати `entitlementType: subscription`, `provider: EA app`, `availability: unknown/active/expired`. Коли скан більше не бачить гру або користувач каже, що підписка закінчилася, не видаляти картку й історію — показувати «Недоступна через EA Play».

**Вердикт:** останній провайдер, не ставити його в критичний шлях релізу.

## Рекомендована архітектура PRGLauncher

### Єдиний Provider Adapter

Не вшивати п’ять наборів умов у Steam-код. У main process потрібен один контракт адаптера:

```js
{
  id: 'gog',
  label: 'GOG Galaxy',
  detectClient(),
  scanInstalled(),
  importOwnedViaWebSession(), // optional, Beta
  launch(game),
  requestInstall(game),
  getDownloadState(game),      // optional; absent у v1
  resolveRunningGame(processes),
  disconnectAccount()
}
```

Кожен результат нормалізувати до одного `externalGame`:

```js
{
  provider: 'gog' | 'epic' | 'ubisoft' | 'ea' | 'battlenet',
  externalId: 'stable-provider-id',
  title, cover, installPath, executablePath,
  installed: true, ownership: 'owned' | 'subscription' | 'unknown',
  importedPlaytimeMs: null, importedLastPlayedAt: null,
  launch: { kind: 'protocol' | 'client', value: '...' }
}
```

У картці PRG гри зберігати `sources: []`, а не один `steamAppId`. Одна й та сама гра може бути придбана в Steam і GOG: вона має бути однією карткою, але з двома source records. Автоматично зливати тільки за надійною парою `provider + externalId`; між різними магазинами — запропонувати користувачу «це та сама гра?» з обкладинкою, назвою та роком, а не зливати наосліп.

### Облік часу

Для кожного джерела зберігати окремо:

- `importedPlaytimeMs` — останній відомий cumulative час з платформи;
- `prgTrackedPlaytimeMs` — сесії, які PRGLauncher виміряв сам;
- `timeAuthority` — `platform`, `prg`, або `mixed`;
- `lastPlatformSyncAt` і `lastTrackedAt`.

На екрані показувати один total без подвоєння. Якщо платформа має історичний час (GOG), стартувати зі значення платформи, а потім застосовувати тільки дельти. Якщо платформа не має такого API (EGS/Ubisoft/EA/Battle.net), не вигадувати «синхронізований» час — ясно показувати `PRG tracked since <date>`.

### Авторизація та приватність

1. Ніколи не збирати паролі, Steam API keys чи 2FA-коди в полях PRGLauncher.
2. Логін відкривається на домені провайдера у окремому вікні; користувач бачить звичну сторінку.
3. Зберігати тільки необхідний refresh token/cookie, зашифрований через OS credential storage; для Windows — DPAPI/keytar, для macOS — Keychain.
4. Не відправляти launcher tokens у Firebase, Netlify чи public dashboard. У хмару йдуть лише бібліотека та статистика PRG Account.
5. Кожен провайдер має кнопку `Від’єднати` і зрозумілий опис, що саме вона видалить.
6. Для неофіційних інтеграцій показувати коротке попередження: «PRGLauncher використовує вебсесію, не бачить пароль; постачальник може вимагати повторний вхід після оновлення». 

## Реалістичний порядок роботи

### Етап A — фундамент

1. Переробити модель гри з `steamAppId` на `sources[]`, не ламаючи наявні Steam та Nintendo дані.
2. Додати у Settings → Integrations секцію **PC launchers** з плитками GOG, Epic, Ubisoft, EA та Battle.net: `Клієнт знайдено / не знайдено`, `Сканувати встановлені`, `Від’єднати`.
3. Реалізувати спільний Windows process tracker за `installPath` та process tree.
4. Універсальний modal імпорту: обкладинки, пошук, select all, статус та захист від дублікатів. Це той самий UX, який уже подобається в Steam-імпорті.

### Етап B — GOG повністю

1. Скан встановлених GOG без логіну.
2. Запуск, встановлення та трекінг процесу.
3. Web-login імпорт усієї бібліотеки як Beta.
4. Історичний час/last activity із delta-sync і ручним повторним логіном.

### Етап C — Epic та Ubisoft

1. Epic manifests + protocol launch/install + PRG tracked time.
2. Ubisoft registry/cache + launch + PRG tracked time.
3. Лише після тестів — web-session/full library Beta для кожного окремо.

### Етап D — Battle.net та EA

1. Battle.net `product.db`/uninstall entries + process tree.
2. EA local installed scan + process tracking.
3. Account import — експериментальний, окремими feature flags і з тестерами. Не включати за замовчуванням.

### Етап E — завантаження й UI

Не переносити Steam Downloads як є. Спершу для всіх провайдерів показувати чесний стан `Не встановлена / Встановлюється / Встановлена`, який визначається сканом маніфестів. Точний відсоток, швидкість і час до завершення додавати лише там, де перевірений формат клієнта стабільно віддає ці дані. Не читати випадкові логи як основу продукту.

## Що не варто робити

- Не робити «введи логін і пароль EGS/GOG/EA/Ubi/Battle.net у PRGLauncher».
- Не копіювати чужі зашифровані токени з профілю браузера чи папок лаунчерів.
- Не називати неофіційне отримання бібліотеки «офіційною синхронізацією».
- Не видаляти картки, сесії або playtime, якщо інтеграція тимчасово не відповіла.
- Не починати з EA: це найвища вартість підтримки за найменшу передбачуваність.
- Не змішувати EA Play-підписку з постійним володінням грою.

## Рішення, яке рекомендовано затвердити

Для наступного великого релізу варто заявити не «п’ять акаунтів одразу», а **PRGLauncher Multi-Launcher Foundation**:

1. встановлені ігри GOG / Epic / Ubisoft / Battle.net / EA на Windows;
2. запуск із PRGLauncher і власний трекінг сесій;
3. безпечна модель кількох sources в одній картці;
4. повний GOG import Beta;
5. Epic account import Beta лише після окремого прототипу;
6. Ubisoft, Battle.net та EA account import — пізніші експериментальні модулі.

Це дає користувачу відчутний результат швидко, не залежить від паролів і не перетворює PRGLauncher на крихкий скрапер п’яти приватних API.

## Джерела

1. [GOG Galaxy SDK — Introduction](https://docs.gog.com/galaxyapi/)
2. [GOG Galaxy SDK — IUser](https://docs.gog.com/galaxyapi/classgalaxy_1_1api_1_1IUser.html)
3. [Playnite GOG integration source](https://raw.githubusercontent.com/JosefNemec/PlayniteExtensions/master/source/Libraries/GogLibrary/GogLibrary.cs)
4. [Epic Games: доступ сторонніх продуктів до Epic Account](https://www.epicgames.com/help/c-45487929/c-40721840/a12351724)
5. [Epic OAuth overview](https://dev.epicgames.com/documentation/en-us/fortnite/oauth)
6. [Playnite Epic integration source](https://raw.githubusercontent.com/JosefNemec/PlayniteExtensions/master/source/Libraries/EpicLibrary/EpicLauncher.cs)
7. [Ubisoft Connect — офіційний опис сервісу](https://bluebyte.ubisoft.com/en/portfolio/ubisoft-connect/)
8. [Playnite Ubisoft Connect integration source](https://raw.githubusercontent.com/JosefNemec/PlayniteExtensions/master/source/Libraries/UplayLibrary/UplayLibrary.cs)
9. [Blizzard OAuth client sample](https://github.com/Blizzard/oauth-client-sample)
10. [Playnite Battle.net integration source](https://raw.githubusercontent.com/JosefNemec/PlayniteExtensions/master/source/Libraries/BattleNetLibrary/BattleNetLibrary.cs)
11. [EA: робота з EA app та My Playtime](https://help.ea.com/en///articles/platforms/how-to-use-ea-app/)
12. [Playnite issue: поломка EA library після змін Origin/EA backend](https://github.com/JosefNemec/PlayniteExtensions/issues/448)
13. [Playnite: приклад актуального unified launcher з цими інтеграціями](https://github.com/JosefNemec/Playnite)
