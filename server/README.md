# Сервер PRGLauncher на Oracle

Гостьовий сайт і дві серверні функції лаунчера (`rawg-search`, `steam-library`) працюють на власному сервері власника.

- **Адреса:** `https://prg.145-241-163-181.sslip.io/`. Без `?u=` сторінка показує бібліотеку власника.
- **Машина:** Oracle Cloud Free Tier VM, Ubuntu 24.04 aarch64. На ній також працюють EchoPod Wrapped (кореневий домен sslip.io) і SillyTavern (порт 8000); PRG-налаштування їх не зачіпають.
- **SSH:** порт `2222`, ключ `~/.ssh/oracle-echopod.key`, користувач `ubuntu`.

## Що де лежить

| Що | Де |
|---|---|
| Сайт (`web-dashboard` без `_retired` і README) | `/var/www/prglauncher` |
| Функції: `server/functions-server.cjs` і обидва обробники з `netlify/functions` | `/opt/prglauncher` |
| systemd-сервіс `prglauncher-functions` під системним користувачем `prglauncher`, слухає `127.0.0.1:8787` | `/etc/systemd/system/prglauncher-functions.service` |
| Ключі `RAWG_API_KEY`, `STEAM_WEB_API_KEY`, `FIREBASE_WEB_API_KEY`, доступ лише для root | `/etc/prglauncher/env` |
| nginx-сайт (HTTPS додав certbot, сертифікат продовжується сам) | `/etc/nginx/sites-available/prglauncher` |

nginx пропускає до функцій лише `POST /.netlify/functions/<назва>` з обмеженням 30 запитів на хвилину з однієї адреси. Обидві функції самі перевіряють Firebase-токен і пускають лише UID власника.

## Оновлення

Сайт або функції після змін у репозиторії (Git Bash):

```bash
bash scripts/deploy-oracle.sh
```

Скрипт пакує потрібні файли, копіює їх на сервер і запускає `server/setup.sh`. Повторний запуск безпечний: ключі й HTTPS-налаштування nginx лишаються як були.

## Ключі

Ключі не потрапляють у репозиторій, чат чи журнали. Щоб задати або замінити їх, запусти в терміналі й введи ключі (під час введення їх не видно):

```bash
ssh -t -i ~/.ssh/oracle-echopod.key -p 2222 ubuntu@145.241.163.181 bash prglauncher-deploy/server/set-keys.sh
```

## Перевірка

- `https://prg.145-241-163-181.sslip.io/` показує бібліотеку.
- POST на `/.netlify/functions/rawg-search` без токена повертає `401 LOGIN_REQUIRED`; з токеном, коли ключі ще не задані, `503 SERVER_NOT_CONFIGURED`.
- Журнал функцій: `sudo journalctl -u prglauncher-functions -n 50`.
