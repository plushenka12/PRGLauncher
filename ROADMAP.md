# PRGLauncher — roadmap

> **Ревізія:** 3 жовтня 2026 · **поточна версія:** `1.2.3`

Цей документ відділяє вже готові можливості від перевірок і майбутніх напрямів. Поточний активний фокус — Windows; macOS production і нові платформи відкладені в дальній беклог. Нові зміни не повинні ламати Steam/Nintendo-синхронізацію та персональні дані користувача.

## Що вже є

### Основний продукт

- PRG Account через Firebase Email/Password і Google; окремі бібліотека, синхронізація та статистика для кожного акаунта.
- Steam: імпорт профілю/бібліотеки/колекцій, картки з обкладинками, пошук і масовий вибір, запуск ігор, install/download tracking, підключення та заміна профілю.
- Nintendo Switch/Switch 2 Sync Beta: авторизація в окремому вікні Nintendo, play activity, повний і delta-імпорт, захист від повторів, ручний повторний запит списку.
- Mini-bar, tray, Stand By, закріплення поверх вікон, автозапуск і приховування Steam у межах підтриманих сценаріїв.
- Єдина кнопка **Додати гру**: Steam, Nintendo, RAWG/стороння гра та локальний `.exe`/`.app` із запуском і трекінгом.
- Статуси Backlog / Playing / Completed / QuickPlay / session-only, клікабельна зміна статусу, історія, таймлайн, об’єднання дублікатів і Backloggd import.
- RAWG matching, ручне виправлення обкладинок і HLTB: пошук, пряме посилання, ручний match, кеш і conflict resolver.
- PRG Recap: річна статистика за сесіями, активні дні/стрік, топ ігор, місячна активність, платформи, PNG/share і публічна статистична сторінка.
- Українська/англійська локалізація, п’ять тем, масштаб 90–120%, контрастні картки, tooltips та оновлення через `electron-updater`.

### Платформи

- **Windows:** основна стабільна платформа; інсталятор і автооновлення.
- **macOS:** universal тестовий DMG, unsigned/not notarized; частина системних інтеграцій і поведінка Steam потребують реального тестування на Mac.
- **GOG:** локальний MVP для пошуку встановлених ігор у Windows registry та запуску.

## Перевірити зараз

### Windows

- Встановлення `1.2.3`, повторний запуск і оновлення з попередньої версії.
- Steam: два акаунти, зміна профілю, імпорт усієї бібліотеки, install/download і запуск гри без зайвого підтвердження.
- Add Game: Steam/Nintendo/RAWG/local executable; вибір статусу, обкладинки, повторне редагування.
- HLTB: звичайний пошук, пряме URL, нестандартні назви/видання, повторна перевірка кешу.
- Recap: сесії за правильним роком, оновлення даних після нових сесій, PNG і public share.
- Вихід/повторний вхід, ізоляція двох PRG Account на одному ПК, відсутність старих даних у новому акаунті.

### macOS

- Запуск universal DMG через Gatekeeper, menu-bar/tray і відображення clover icon.
- Поведінка mini-bar, traffic lights, Stand By та приховування Steam після завантаження.
- Локальний `.app` launch/tracking, HLTB, Recap, Firebase reconnect після старту без Wi‑Fi.
- Перевірити, що unsigned build зрозуміло пояснює користувачу спосіб відкриття; підпис/нотаризація поки не входять у реліз.

## Рефакторингова лінія після P0/P1/P2

Це технічний трек, який не змінює продуктову філософію і не повертає відкладені P3/P4 у найближчі релізи. Детальна карта лежить у `ARCHITECTURE.md`, реєстр ризиків — у `TECH_DEBT.md`.

### R0 — аудит і фіксація меж (завершено)

- Зафіксувати карту процесів Electron, Firebase, Netlify і зовнішніх інтеграцій.
- Зафіксувати технічний борг та критерії перевірки перед змінами.
- Заморозити P3 macOS production та P4 мультилаунчерів у дальньому беклозі.

### R1 — безпечне розділення renderer

- ✅ Винесено чисті утиліти нормалізації назв, матчингів, форматтерів і агрегати Recap.
- ✅ Винесено profile cache, Firebase sync service та окремий sync-state coordinator.
- ✅ Винесено Steam, Nintendo, HLTB і RAWG adapters/utilities; local launch лишається тонким IPC-шаром у renderer.
- ✅ Розділено UI-модулі library/game card-detail/settings/import/history та recap.

### R2 — канонічна схема даних

- ✅ Додати `schemaVersion` і idempotent-міграції локального, cloud та backup payload.
- ✅ Відокремити profile settings, games, sessions, integrations і public recap у backward-compatible canonical snapshot.
- ⏭️ Наступний окремий етап: перехід від whole-snapshot writes до безпечніших per-game/session операцій.

### R3 — тести й фікстури

- ✅ Додати npm test script, unit-тести міграцій, canonical sync і rules contract.
- ✅ Додати Firebase Emulator fixtures для private/public документів та інструкцію повного Emulator прогону.
- ✅ Додати fixtures для Recap/HLTB і smoke-чеклісти Windows/macOS як release gate.

### R4 — UX 1.3 без розширення платформ

- ✅ Єдині live-повідомлення для помилок входу та синхронізації; базова busy-семантика готова.
- ✅ Доступність: фокус модалок, клавіатурне відкриття карток і live region.
- Далі — тільки покращення вже наявних Steam/Nintendo/HLTB/Recap сценаріїв.

### R5 — передбачуваний релізний цикл

- CI перевіряє відповідність package version, tag і назв артефактів.
- Автоматично перевіряються правила, міграції, тести та smoke build.
- Після стабілізації готуємо окремий decision щодо macOS signing/notarization.

## Новий roadmap

### P0 — стабілізація `1.2.3`

1. ◐ Локальний release-gate та assets перевіряються автоматично; GitHub Actions і macOS test build залишаються ручною перевіркою.
2. ✅ Реалізувати backlog item **auto-close перед інсталяцією оновлення**: закривати main window, mini-bar, tray і таймери після flush локальної синхронізації; показувати короткий статус.
3. ✅ HLTB regression hardening: fallback при зміні endpoint/token, зрозумілі помилки та кеш останнього успішного match.
4. ✅ Додати відновлення мережевої синхронізації після запуску без Wi‑Fi з backoff і видимим станом.

### P1 — щоденний UX

1. ✅ Фінально відполірувати Recap: стабільний grid, обкладинки без деформацій, читабельні топи/смужки, найдовша сесія та місячні drill-down; картки року відкривають Game Info.
2. ✅ Зменшити візуальний шум головної сторінки: компактні картки, hover без стрибків, однакова типографіка й доступність контрасту.
3. ✅ Для локальних ігор додати редагування шляху, working directory, launch arguments і кнопку повторного вибору executable.
4. ✅ Уніфікувати loading/empty/error states для Steam, Nintendo, HLTB, RAWG і Recap; додати tooltip для кожної системної іконки.

### P2 — цілісність даних і приватність

1. ✅ Черга sync-операцій із retry, ідемпотентними delta-сесіями та журналом останньої синхронізації.
2. ✅ Явний conflict resolver для часу/назви/обкладинки/статусу, без тихого перезапису даних.
3. ✅ Резервна копія й restore для бібліотеки/сесій, export/delete даних акаунта та очищення після disconnect.
4. ✅ Діагностичний export логів без токенів, паролів і повних персональних payloads.

### P3 — macOS production readiness (відкладено)

1. Окремий checklist для Apple Silicon та Intel, Steam, menu bar і sleep/wake.
2. Виправити системні розбіжності: hide/show Steam, автозапуск, focus налаштувань, traffic lights і розмір mini-bar.
3. Після стабілізації оцінити Apple Developer signing/notarization; це окремий бюджетний релізний етап, не блокер функціональності.

### Поточний Windows-фокус

1. Завершити R1-рефакторинг renderer без зміни поведінки.
2. Перейти від whole-snapshot sync до безпечніших per-game/session операцій.
3. Посилити Windows Steam/HLTB/Recap сценарії та offline/retry перевірки.
4. Зробити CI обов’язковим для тестів, release gate та Windows installer.
5. Підготувати наступний Windows-реліз тільки після проходження smoke-чекліста.

### P4 — більше джерел (дальний беклог)

- Повний GOG import/delta history.
- Локальні/дозволені інтеграції Epic Games, Ubisoft Connect, EA app (колишній Origin) і Battle.net: manifest, launch, tracking.
- PlayStation Network та Xbox activity лише через офіційні або явно дозволені authorization flows; не зберігати паролі й не будувати продукт на undocumented endpoints.

### P5 — multi-user і захист

- Перевірити ізоляцію даних Firestore rules, rate limits і device/session management.
- Додати privacy controls для public recap, data export/delete та відв’язування платформ.
- Підготувати onboarding для інших користувачів без перетину Steam/Nintendo/PRG-сесій.

## Не робимо зараз

- «Що грати сьогодні» та рекомендаційну чергу.
- Автоматичний доступ до платформ через паролі, недокументовані API або обхід 2FA.
- Apple signing/notarization до рішення про бюджет.
- Нові лаунчери до завершення стабілізації Steam, Nintendo, HLTB і Recap.

## Definition of done для наступного релізу

- P0 перевірено на чистому Windows-профілі та на реальному Mac test build.
- Немає регресій у Steam/Nintendo імпорті, HLTB match або Recap після перезапуску.
- Оновлення не вимагає ручного закриття PRGLauncher.
- Кожен новий пункт має позитивний, помилковий та offline-сценарій у тест-чеклисті.
