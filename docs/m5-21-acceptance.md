# Приёмочный протокол M5-21 — 04.10.2026

## Срез

- База: M5-20 (`b43c63b`).
- Включены `8676a1e` (металлическая оплётка, навигация разделов и связанные
  тесты), `42b0cfa` (верхняя плашка) и `d34aaab` (документация проверки).
- `b751572` уже входит в базу M5-20 и сохранён без повторного cherry-pick.

## Проверки

- Клиент: 178 файлов / 1743 теста — успешно; TypeScript и Vite production build —
  успешно.
- Self-contained `win-x64` publish, manifest и `Techmap.Server.exe
  --verify-package` — успешно (`TECHMAP_PACKAGE_STATUS=ok`).
- Полный .NET прогон прошёл Domain/Architecture, но завис на Web-тестах в общей
  среде и был остановлен; portable smoke-test отдельно не выполнялся.

## Артефакт

- Версия: `0.63.32-m5-21-review`.
- ZIP: `artifacts/final-chats-20261004-m5-21/TECHMAP-GRAPHER-0.63.32-m5-21-review-win-x64.zip`.
- Размер: 63 264 029 байт.
- SHA-256: `459F9BA69EBBB51789CA6AF622920B895E5EDA13660920E4F03FABE764C3BE9C`.
