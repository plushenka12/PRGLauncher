# Nintendo Sync для PRGLauncher

Технічна документація експериментального read-only конектора для Nintendo
Switch і Nintendo Switch 2.

## Можливості

- Nintendo OAuth у окремому Electron-вікні.
- Пароль не потрапляє в renderer, Firebase або сторонній сервер.
- Отримання play activity: назва, час, платформа, `titleId`, обкладинка.
- Preview перед імпортом і вибір статусу `Backlog`, `Playing`, `Completed`.
- Ігнорування вибраних тайтлів між синхронізаціями.
- Ручний режим «Запросити весь список» для повернення ігнорованих ігор.
- Delta-оновлення часу без дублювання.
- Фонова синхронізація кожні 30 хвилин.

## Попередження

Nintendo не публікує стабільний developer API для Play Activity. Конектор
використовує reverse-engineered read-only endpoint, який може змінитися без
попередження. Не можна передавати Nintendo-пароль на власний сервер.

## OAuth

Публічні параметри клієнта Nintendo Store:

```text
client_id: 5c38e31cd085304b
redirect_uri: npf5c38e31cd085304b://auth
scope: openid user user.mii user.email user.links[].id
response_type: session_token_code
```

Перед входом генеруються випадкові `state` і `code_verifier`. Для PKCE:

```text
session_token_code_challenge = BASE64URL(SHA256(code_verifier))
session_token_code_challenge_method = S256
```

Authorization URL:

```text
https://accounts.nintendo.com/connect/1.0.0/authorize
```

Після вибору профілю Nintendo повертає custom-scheme callback:

```text
npf5c38e31cd085304b://auth#session_token_code=...&state=...
```

Electron перехоплює callback через `will-navigate`, `will-redirect`,
`will-frame-navigate` і popup-переходи. Якщо custom scheme не відкривається,
можна скопіювати адресу кнопки вибору профілю та вставити callback URL вручну.

## Обмін токенів

Одноразовий код обмінюється на session token:

```text
POST https://accounts.nintendo.com/connect/1.0.0/api/session_token
Content-Type: application/x-www-form-urlencoded

client_id=...
session_token_code=...
session_token_code_verifier=...
```

Session token зберігається лише локально. У PRGLauncher він шифрується через
Electron `safeStorage` у `app.getPath('userData')`.

Для запиту історії session token обмінюється на короткоживучий access token:

```text
POST https://accounts.nintendo.com/connect/1.0.0/api/token
Content-Type: application/json

{
  "client_id": "...",
  "session_token": "...",
  "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer-session-token"
}
```

Access token не зберігається постійно й не передається у frontend.

## Play Activity API

```text
GET https://app-api.znej.nintendo.com/api/v2.0/users/me/play_histories
Authorization: Bearer <access_token>
User-Agent: com.nintendo.znej/<version> (...)
gentry-locale: en-US
```

Альтернативний регіональний endpoint:

```text
https://mypage-api.entry.nintendo.co.jp/api/v1/users/me/play_histories
```

Типові поля відповіді: `playHistories`, `recentPlayHistories`, `titleId`,
`titleName`, `firstPlayedAt`, `lastPlayedAt`, `totalPlayedMinutes`,
`totalPlayedDays`, `imageUrl`, `platform` або `system`.

## Нормалізація

```js
{
  id: "Nintendo titleId",
  title: "Game title",
  minutes: 1234,
  platform: "Nintendo Switch", // або Nintendo Switch 2
  cover: "https://...",
  raw: {}
}
```

У грі PRGLauncher зберігаються:

```js
{
  nintendoTitleId: "...",
  nintendoLastSeenMinutes: 1234,
  nintendoLastSync: 1710000000000,
  tags: ["Nintendo Sync"]
}
```

Зіставлення виконується за `nintendoTitleId`, а назва використовується лише
як fallback для старих імпортів.

## Перший імпорт

1. Отримати та нормалізувати play activity.
2. Показати preview із чекбоксами.
3. Дати статус для кожної гри.
4. Імпортувати тільки вибрані записи.
5. Записати поточні хвилини в `nintendoLastSeenMinutes` як baseline.

Якщо користувач зняв галочку, його `titleId` зберігається у:

```text
gv-nintendo-ignored-v1
```

Звичайний sync фільтрує ці записи. «Запросити весь список» показує їх знову.

## Delta-синхронізація

```js
const previous = game.nintendoLastSeenMinutes;
const current = Math.max(previous, incoming.totalPlayedMinutes);
const delta = current - previous;
game.playtime += delta * 60_000;
game.nintendoLastSeenMinutes = current;
game.nintendoLastSync = Date.now();
```

Для старих імпортів без baseline потрібно лише записати baseline, без додавання
часу. Якщо Nintendo повертає лише агреговані хвилини, не можна вигадувати
точні start/end сесії — оновлюється тільки загальний час.

## Фонова синхронізація

Фоновий sync запускається тільки за наявності локального session token:

```js
setTimeout(() => syncNintendoLibrary({ announce: false }), 2000);
setInterval(() => syncNintendoLibrary({ announce: false }), 30 * 60 * 1000);
```

Помилка API не повинна очищати каталог або зупиняти Steam-трекінг. Відповідь
401/403 означає, що потрібна повторна авторизація.

## Безпека

- Не логувати callback URL, токени або Authorization header.
- Не передавати токени у Firebase чи веб-дашборд.
- Обмежити мережеві запити token exchange і GET play history.
- Додати кнопку від’єднання, яка видаляє зашифрований session token.
- На сайт віддавати лише агреговану статистику без Nintendo ID.
- Для backend-версії використовувати secrets storage, rate limit і retry.

## Файли PRGLauncher

```text
src/main/index.js      OAuth, safeStorage, token exchange, API request
src/preload/index.js   безпечний IPC-мост
src/renderer/index.html UI, preview, import, ignore list, delta sync
```

## Обмеження

- Це не офіційний Nintendo developer integration.
- Endpoint і формат відповіді можуть змінитися.
- Play activity може оновлюватися із затримкою.
- Частина ігор може не мати обкладинки або платформи.
- Історія може починатися лише з моменту прив’язки профілю до Nintendo Account.
