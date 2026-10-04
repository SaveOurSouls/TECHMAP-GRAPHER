# 050. Устойчивый startup-error fallback в portable-проверке

- **Статус:** ready-for-review
- **Владелец / чат:** основной агент `/root`
- **Источник запроса:** сообщение владельца от 04.10.2026 о `UnauthorizedAccessException` в portable startup-error сценарии
- **Требования:** REQ-001, REQ-003
- **Владелец файлов:** `src/Techmap.Web/StartupFailureReporter.cs`, эта карточка, `status.md`

## Результат и границы

`StartupFailureReporter.SafeLogRoots` не должен передавать наружу отказ ACL или
ошибку Win32 при канонизации каталога. Если физический путь нельзя прочитать,
репортёр использует лексическую проверку пересечения и затем пробует независимые
каталоги `%LOCALAPPDATA%` и `%TEMP%`. Это сохраняет startup-log даже в среде,
где `CreateFileW(FILE_FLAG_BACKUP_SEMANTICS)` запрещён для каталога.

## Критерии приёмки

- startup failure возвращает код 1 и не выбрасывает вторичный `UnauthorizedAccessException`;
- заданный log root и sibling data-root не используются при обнаруженном пересечении;
- существующие проверки junction/overlap и UTF-8 startup-log продолжают проходить;
- `Techmap.Web.Tests`, `git diff --check` и сборка изменённого проекта проходят.

## Ограничения

Полный ZIP и все семь portable-режимов требуют self-contained сборки Windows и
будут повторены сборщиком после коммита. Эта карточка исправляет обработку ошибки
старта; она не объявляет проверку пути с кириллицей пройденной.

## Журнал проверки

- `dotnet build src/Techmap.Web/Techmap.Web.csproj --no-restore --configuration Release` — успешно, 0 предупреждений/ошибок.
- `dotnet test tests/Techmap.Web.Tests/Techmap.Web.Tests.csproj --no-restore --no-build --configuration Release --filter FullyQualifiedName~StartupFailureReporterTests` — 13/13.
- `git diff --check` — успешно.
- Полный `dotnet test` в этой среде не обнаружил тесты (код 5), а повторная сборка тестового проекта столкнулась с оставшимся процессом, удерживающим `Techmap.Server.dll`; это ограничение среды, не падение теста.
