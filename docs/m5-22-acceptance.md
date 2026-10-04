# M5-22 — подготовка, приёмка ещё не выполнялась

Дата: 05.10.2026. Текущий статус: ожидание финальных handoff рабочих чатов.

Подготовительная база: `60d30576872e5bb280bf996be4fa8c6f16cd3f6c`.
Состав и обязательные проверки: [checklist](coordination/m5-22-checklist.md).
Интеграция, новая версия, сборочный SHA, ZIP, размер и SHA-256 пока не
подтверждены. Новый ZIP не публиковался. Результаты прежних срезов не считаются
результатами проверки M5-22.

05.10.2026 получен handoff карточки 074 L+/L− со статусом `ready_for_audit`:
`7217377` → `64afbda`. Оба SHA проверены и уже входят в подготовительную базу;
повторно не применялись. Источник подтвердил typecheck, 73/73 целевых теста и
client build; полный клиентский прогон и ручная приёмка остаются открытыми.
Сборщик подтвердил только Git-проверки передачи.

Получен также handoff 075 Э4: `43e6556` → `0c5e2a2`; code SHA уже входит в
базу, новый документальный SHA отсутствует и не переносился. Источник сообщил
1778/1778 клиентских тестов, typecheck/build, Sqlite build и diff check PASS.
Ручная packaged-приёмка остаётся открытой; посторонняя raw-string ошибка в
незакоммиченном worktree источника не переносится.

Получен handoff 060 ширины оболочек ОП: `60d3057`, зависимость `43e6556`;
статус `ready_for_audit`. SHA уже входит в базу и повторно не применяется.
По handoff client 1778 tests, typecheck/build и Sqlite build PASS; ручные
packaged C1–C3 и пользовательский жгут не проверены.

Панель и Route v2 переданы как `ready_for_audit`: общий документальный
`6e4dbf5` пока не переносился, код `6322742`, `9405891`, `fbef55e` уже в базе.
Источник сообщил client 1778/1778, typecheck/build и diff checks PASS;
новые portable/packaged проверки, 390 px ribbon QA и owner acceptance открыты.
Ожидаются handoff контактного вида и финальное решение аудитора.

Финализация дополнительно блокируется Route v2: на точном snapshot `744d122`
toolbar перехватывает клик по кнопке «Отмена» локального редактора. Рабочий чат
готовит scoped fix `route-v2.css` и повторный browser QA. До передачи fix SHA
и аудиторского подтверждения ZIP не собирается и не публикуется.
Счётчики 1776/1778 относятся к сообщениям источников; их нельзя объединять
или объявлять результатом сборочной базы без точного snapshot и команды.

Ancestry Route v2 проверена: `6322742` → `9405891` → `fbef55e` → база.
Запись порядка исправлена в checklist и журнале этой сборочной копии;
общий состав пакета ещё не зафиксирован.

## Предварительный прогон clean базы — 05.10.2026

После прогона получен fix handoff Route v2
`f7623b9fc8d791219a562051d826fc4ef82c7023`: Git-проверка PASS, SHA пока не
переносился. Источник подтвердил browser Cancel/Save и tsc/Vitest 182/1776/Vite
на snapshot `744d122` + два fix-файла. API-deps `6064bb92`, `8676a1e9`,
`7fc3af2f` уже входят в чистую integration ancestry. Source QA не заменяет
прогон окончательного объединённого HEAD; требуется аудиторское решение.
390 px не перепроверен (fix ≥651px), packaged/portable/server/user harness
и owner acceptance остаются открытыми.

Сборщик выполнил разрешённые подготовительные проверки на точном HEAD
`4ebe93c55966f179b0bb2410dde5938785fb1a3e`; код/скрипты/версия совпадают с
`60d30576872e5bb280bf996be4fa8c6f16cd3f6c`, tracked working tree clean.
Контактный вид, новые handoff-doc SHA и he-back fix ещё не интегрированы.

| Команда | Фактический результат сборщика |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` (`CI=true`) | PASS |
| `pnpm --filter @techmap/client test` | PASS: 182 файла / 1776 тестов |
| `pnpm --filter @techmap/client build` | PASS: TypeScript `tsc --noEmit` и Vite production; штатные heic-to fs/path/crypto и chunk >500 kB warnings |
| `dotnet restore Techmap-Grapher.slnx --locked-mode --runtime win-x64 -p:NuGetAudit=false` | PASS |
| `dotnet test Techmap-Grapher.slnx --configuration Release --no-restore --filter 'FullyQualifiedName!~ReferenceCatalogSearchPerformanceTests' -- --minimum-expected-tests 1` | FAIL, exit 1: Web-tests не компилируются, CS8997, `ManufacturingRouteValidatorTests.cs:59` |
| `dotnet test tests/Techmap.Domain.Tests/Techmap.Domain.Tests.csproj --configuration Release --no-restore -- --minimum-expected-tests 1` | PASS: 54/54 |
| `dotnet test tests/Techmap.Architecture.Tests/Techmap.Architecture.Tests.csproj --configuration Release --no-restore -- --minimum-expected-tests 1` | PASS: 3/3 |
| `dotnet publish src/Techmap.Web/Techmap.Web.csproj --configuration Release --runtime win-x64 --self-contained true --no-restore -p:PublishSingleFile=true -p:DebugType=None --output artifacts/m5-22-preflight/publish-check` | PASS; только предварительный publish, не готовый пакет |

Логи сохранены вне Git в `artifacts/m5-22-preflight/`: `vitest.log`,
`client-build.log`, `dotnet-restore.log`, `dotnet-functional.log`,
`dotnet-domain.log`, `dotnet-architecture.log`, `dotnet-publish.log`.
.NET тесты выполнялись с разрешённым повышением доступа для локальных
процессов/SQLite/Windows ACL; отказа automatic review не было.

Проверка Git и независимый аудит подтвердили compile blocker в committed
`60d3057`, а не только в source dirt. Исправление уже в M5-20
`b43c63beb8b92aafdd0f42369c366984815a018e`: корректные newlines raw string и
null-forgiving перед `.AsObject()`. Его узкий тестовый patch пока не переносился
и требует включения в итоговый аудит; version/acceptance части этого коммита
не относятся к новому пакету. Прежнее описание этого ограничения как только
постороннего dirt не является результатом текущего прогона.

Это не финальная приёмка M5-22. Новый ZIP, manifest verification, performance
Web-test и семь portable-режимов ещё не выполнены. Нужны fix he-back с
подтверждённым browser QA, итоговый аудит состава и собственный прогон финального
HEAD. 390 px ribbon QA, пользовательский жгут и owner manual acceptance открыты.
