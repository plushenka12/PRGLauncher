# PRGLauncher для macOS

## Що вже підготовлено

- Окрема команда `npm run build:mac` створює `.dmg` для Intel (`x64`) і Apple Silicon (`arm64`).
- Застосунок має `.icns`-версію зелено-фіолетового клевера.
- Головне вікно використовує звичні macOS-кнопки закриття, згортання й розгортання зліва; mini-bar лишається доступним у шапці.
- Локальний Steam шукається в `~/Library/Application Support/Steam`, а Steam.app — у `/Applications` або `~/Applications`.
- Steam-імпорт за посиланням, PRG Account, Firebase, сайт зі статистикою та Nintendo Sync не залежать від ОС і працюють спільно з Windows-версією.

## Свідомі відмінності від Windows

- macOS не має безпечного аналога Windows Registry для визначення запущеної Steam-гри. Автоматичне локальне відстеження Steam-сесії тому вимкнене; ручний таймер працює як завжди.
- PRGLauncher не просить macOS-дозвіл Accessibility тільки для того, щоб примусово ховати вікно Steam. Після запуску гри через лаунчер Steam може коротко показати вікно — це контролює сам користувач.

## Як зібрати на Mac

1. Найпростіший варіант без власного Mac — вручну запустити GitHub Action **Build macOS test package**. Він збере universal `.dmg` на macOS-ранері GitHub і збереже його як artifact на 14 днів.
2. Якщо збірка виконується на Mac локально: встановити актуальний Node.js LTS і відкрити Terminal у папці проєкту.
3. Виконати `npm ci`.
4. Виконати `npm run build:mac`.
5. Готовий universal `.dmg` з'явиться у папці `release`.

Повний сценарій для людини, яка тестуватиме білд: [MACOS_TESTER_GUIDE.md](MACOS_TESTER_GUIDE.md). Збірку потрібно перевірити на справжньому Mac: вхід у PRG Account, Steam-імпорт, tray, mini-bar, відкриття посилань `steam://`, автозапуск і Nintendo Sync.

## Публічний реліз

Для поширення без попереджень Gatekeeper потрібен Apple Developer Program, сертифікат Developer ID Application, code signing і notarization. До цього `.dmg` можна збирати й тестувати локально, але macOS попереджатиме про непідписаний застосунок.
