# P0 release gate

Локальна перевірка релізу запускається з кореня проєкту:

```powershell
npm test
npm run release:check
npm run build -- --config.win.signAndEditExecutable=false
```

`release:check` перевіряє версію `package.json`, main entry, Windows installer, blockmap і smoke-документацію.

## Перед публікацією

- Перевірити GitHub Actions і відповідність tag/package version.
- Перевірити оновлення з попередньої Windows-версії.
- Перевірити macOS universal test build за `MACOS_TESTER_GUIDE.md`.
- Не публікувати unsigned macOS build як production-реліз без окремого signing/notarization рішення.

## P0 runtime сценарії

- Запуск без Wi‑Fi: launcher показує локальну бібліотеку й повторює sync після появи мережі.
- HLTB тимчасово недоступний: останній успішний результат лишається доступним; новий lookup повторюється після відновлення endpoint.
- Встановлення оновлення: main window, mini-bar і tray закриваються автоматично.
