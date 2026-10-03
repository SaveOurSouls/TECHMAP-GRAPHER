# Приёмочный протокол M5-12 — 03.10.2026

## Срез кода

- Исходный Git-коммит: `5c87493` (`codex/restore-20260918-0235`).
- Версия: `0.63.23-m5-12-review`.
- Состав: срез M5-11 с REQ-076 (витая пара на Чертеже) и документацией
  интеграции верхней панели REQ-077.
- Незакоммиченные изменения, появившиеся в общей рабочей копии после начала
  упаковки, в этот ZIP не входят.

## Артефакт

- ZIP: `artifacts/final-chats-20261003-v4/TECHMAP-GRAPHER-0.63.23-m5-12-review-win-x64.zip`.
- Размер: 61 430 502 байта (58.59 MiB).
- SHA-256: `C56ECB0779335F6EA827C3197988FF3E1CD51D14DC490EECDAD5B007758FF5A8`.
- Self-contained Windows x64: 276 файлов, 275 проверяемых записей manifest.

## Проверки

- `pnpm install --frozen-lockfile`, 1640 клиентских Vitest, TypeScript и
  Vite production build прошли.
- Release self-contained `dotnet publish` для `win-x64` прошёл.
- `scripts/verify-package.ps1`: `ok`, 275 файлов.
- `Techmap.Server.exe --verify-package`: `TECHMAP_PACKAGE_STATUS=ok`.
- `scripts/test-portable-package.ps1`: успешно пройдены все 7 portable-режимов
  после запуска с доступом к локальным ACL.

## Ограничения

- Полный Release .NET-набор не включён в этот протокол: Web-набор завис после
  прерванных терминальных запусков, хотя Domain и Architecture-наборы завершились
  успешно. Повторить чистый полный и performance-прогон после освобождения
  процессов тестов.
- Обычный sandbox-запуск portable-сценария не имеет права читать ACL тестовых
  директорий и завершается `UnauthorizedAccessException`; тот же ZIP прошёл
  все portable-режимы в разрешённом контексте.
- Ручная UI-приёмка витой пары на рабочем жгуте остаётся открытой. Vite выводит
  неблокирующее предупреждение о размере основного chunk.
