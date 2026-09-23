# PRGLauncher — macOS test checklist

## Install and first launch

- [ ] Відкрити tester `.dmg`, перенести PRGLauncher у Applications.
- [ ] Перевірити Gatekeeper-попередження і documented спосіб дозволити запуск.
- [ ] Вікно має native traffic lights, правильну назву та іконку Dock.
- [ ] При запуску без Wi‑Fi застосунок показує локальний стан і синхронізується після підключення.

## Menu bar and mini-bar

- [ ] Іконка menu bar — monochrome template, 16–18 px, без обрізаного кольорового фрагмента.
- [ ] Яскравий клевер у Dock і menu bar не плутаються між собою.
- [ ] Mini-bar відкривається у правому верхньому куті поверх вікон.
- [ ] Stand By працює без активної гри.
- [ ] Pin, pause, restore і вихід у tray працюють.
- [ ] Закриття головного вікна не завершує застосунок.

## Steam on macOS

- [ ] Steam знаходиться через `~/Library/Application Support/Steam`.
- [ ] Встановлена Steam-гра запускається через Steam protocol.
- [ ] Встановлення гри не втрачає діалог вибору бібліотеки.
- [ ] Steam не ховається без Automation-згоди.
- [ ] Після надання Automation-згоди Steam, відкритий PRGLauncher, ховається після старту завантаження.
- [ ] Steam, відкритий користувачем вручну, лаунчер не ховає.

## Account and integrations

- [ ] Email/Google login, logout і повторний login працюють.
- [ ] Steam profile import працює у публічного профілю.
- [ ] Nintendo OAuth відкривається, callback повертає у PRGLauncher, токен не видно в UI.
- [ ] HLTB і Backloggd помилки не блокують відкриття картки.
- [ ] GOG-кнопка коректно пояснює, що local MVP доступний лише для Windows.

## Release quality

- [ ] Масштаб 90–120% не ламає картки та модальні вікна.
- [ ] Українська та англійська локалізації не мають обрізаних рядків.
- [ ] Report відкриває правильний dashboard.
- [ ] Застосунок не залишає завислий процес після Quit.
- [ ] Зафіксувати macOS version, chip (Intel/Apple Silicon), macOS version і всі console errors.

