# Приёмочный протокол M5-20 — 04.10.2026

## Срез

- База: опубликованный M5-19 (`331ab5c`).
- Добавлен `4fff3cf`: ограничение utility-панели и уточнение иконки блокировки слоя.
- Добавлен `6449d7f`: сохранение startup-логов
  при ошибке ACL.
- `bde0fb3` и `cf3ab2d` уже являлись предками базы и поэтому повторно не
  дублировались; оба входят в сборочный срез.

## Проверки

- Клиент: 177 файлов / 1737 тестов — успешно; TypeScript и Vite production build —
  успешно.
- Self-contained `win-x64` publish, manifest и `Techmap.Server.exe --verify-package`
  — успешно (`TECHMAP_PACKAGE_STATUS=ok`).
- Полный .NET прогон дошёл до Domain/Architecture, но завис в Web-тестах общей
  среды и был остановлен; portable smoke-test отдельно не выполнялся.

## Артефакт

- Версия: `0.63.31-m5-20-review`.
- ZIP: `artifacts/final-chats-20261004-m5-20/TECHMAP-GRAPHER-0.63.31-m5-20-review-win-x64.zip`.
- Размер: 63 261 471 байт.
- SHA-256: `87C8C1DCEC1569BCED0277EDABD0F009E276EC96E645DADA8B5693EE1219B757`.
