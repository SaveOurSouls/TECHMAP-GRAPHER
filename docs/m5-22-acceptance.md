# M5-22 — проверенный ZIP после закрытия M3-04, 05.10.2026

Кодовый срез: `93ab279e20afcd40b6e77adba02c171f76d3ce42` (M3-04 delta) в
собирающем HEAD `b9b6c24` (уникальная версия пакета). Старый кандидат
`0.63.35-m5-22-review` не переиспользован; `package/VERSION.json` повышен до
`0.63.36-m5-22-review` в `b9b6c24`.

ZIP собран штатным `scripts/build-package.ps1 -ArtifactSlice m5-22-036`:
`artifacts/m5-22-036/TECHMAP-GRAPHER-0.63.36-m5-22-review-win-x64.zip`;
размер **62 184 587 байт**; SHA-256
`D3663B4ADEA10A5963BDBE789E5AE949C40DF523B320AA7B23A2206F9BF51A02`.

Проверки: клиент — 183 файла / 1790 тестов; TypeScript и Vite production
build — PASS; сервер — 1117 тестов; performance — 1/1; self-contained
Windows x64 publish — PASS; `verify-package.ps1` — PASS, 339 записей манифеста
(340 файлов в каталоге пакета); `test-portable-package.ps1` — **7/7 PASS** из
короткого пути `C:\Temp\TECHMAP-portable-m5-22-036`.

M3-04 (`e0c0116e130e829775eecd68d7750184c9ede75a`) закрыт проверенным
эквивалентом в текущей архитектуре: выбор первого артикула с фактическими
строками Э4, материализация электрических строк без графических прототипов,
стабильные строки при смене артикула и preview уже покрыты текущими тестами;
добавлена отсутствовавшая доступность выбора строки с клавиатуры и защита
удаления от всплывающего выбора (`93ab279`).

Ограничения: ручная UI/packaged приёмка владельца не выполнена; исходный
пользовательский жгут и visual QA при 390 px не проверены; Route V2/localStorage
остаётся браузерным прототипом; длинные Windows-пути могут дать
`UnauthorizedAccessException`; ZIP вне Git. Это технический review-срез, не
автоматическая owner acceptance.

# M5-22 — финальный проверенный ZIP, 05.10.2026

Итоговый кодовый commit: `8e15df7046a79fa6b2c299d5a9dff091d4dfd0fb`;
версия `0.63.34-m5-22-review`. ZIP собран штатным builder в
`artifacts/m5-22-034/TECHMAP-GRAPHER-0.63.34-m5-22-review-win-x64.zip`,
63 957 754 байта, SHA-256
`686131376F371CBE0CDA990140A1B3F8FA0530E59D3FA6A4BC591E2A4E890C8D`.

Проверки финального среза: 183 клиентских файла / 1790 тестов, TypeScript,
Vite, 1117 серверных тестов, performance 1/1, self-contained win-x64 publish,
SBOM/manifest (340 файлов) и portable 7/7 — PASS. Пакет собран и проверен,
но не принят владельцем: исходный пользовательский жгут и visual QA при
390 px остаются открытыми; прототип V2 хранит данные в localStorage.
Полный состав: [manifest](coordination/m5-22-manifest.md); исторические
подготовительные проверки и передачи приведены ниже.

## История подготовки и интеграции

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
# Актуальный полный состав M5-22 — 05.10.2026

Этот раздел заменяет предварительные ожидания ниже. Состав подтверждён в
[manifest](coordination/m5-22-manifest.md), версия `0.63.34-m5-22-review`.
Контактный вид перенесён до `36a96d5`; missing M5-21 product deltas восстановлены
без возврата устаревшей layout и версий. Cancel fix уже входит как `8fc4558`.
Artwork `8676a1e` и `7fc3af2` — exact ancestors и проверенный код.
До упаковки: полный клиент 183/1790, TypeScript/Vite; scoped contact150,
route/layers32; server startup+route57; builder parse и diff check — PASS.
Итоговый code commit: `8e15df7046a79fa6b2c299d5a9dff091d4dfd0fb`.
Штатный builder `scripts/build-package.ps1 -ArtifactSlice m5-22-034` прошёл:
183 client-файла / 1790 тестов, TypeScript/Vite, 1117 серверных тестов,
performance 1/1, self-contained win-x64 publish, SBOM и manifest (340 файлов).
ZIP: `TECHMAP-GRAPHER-0.63.34-m5-22-review-win-x64.zip`, 63 957 754 байта,
SHA-256 `686131376F371CBE0CDA990140A1B3F8FA0530E59D3FA6A4BC591E2A4E890C8D`.
`test-portable-package.ps1` подтвердил 7/7 режимов из пути с пробелами и
кириллицей. Архивная копия в корне workspace сверена побайтно с build ZIP.
Открыто: ручная приёмка владельцем, исходный жгут и visual390px; V2 localStorage.

# M5-22 — проверенный ZIP с интеграцией карточек 080–082, 06.10.2026

Кодовый HEAD: `4621a2090d22938b82ee14e8722136a045298b2d` (`chore: bump package version for M5-22-037`). Версия
`0.63.37-m5-22-review`; исправления 081 и 082 входят в HEAD как проверенные
эквиваленты `5eeb02f` и `7aaaf46`, handoff-документы — `ca55a20`, `e918e18` и
corrected `e345f5f`. Дублирующая карточка `081-covering-point-selection-priority.md`
удалена; актуальная карточка 081 — `081-connector-transit-and-covering-exits.md`.

ZIP собран штатным `scripts/build-package.ps1 -ArtifactSlice m5-22-037`:
`artifacts/m5-22-037/TECHMAP-GRAPHER-0.63.37-m5-22-review-win-x64.zip`; размер **62 185 519 байт**; SHA-256 `C626BADD228191D27F39502788D143A5D3E11855610DE4995FA96DE32A321B66`.

Проверки: client `pnpm --dir src/Techmap.Client test` — 183 файла / 1795 тестов;
TypeScript и Vite — PASS; штатный builder: 1117 серверных тестов и performance
1/1 — PASS; self-contained Windows x64 publish — PASS; `verify-package.ps1` —
PASS, 339 записей манифеста (340 файлов); `test-portable-package.ps1` — **7/7
PASS** из `C:\Temp\TECHMAP-portable-m5-22-037`.

Ограничения: ручная UI/packaged приёмка владельца, C1–C5 на исходном жгуте и
visual QA при 390 px не выполнены; Route V2 остаётся браузерным `localStorage`
прототипом. Длинные Windows-пути могут дать `UnauthorizedAccessException`; ZIP
остаётся вне Git.
# M5-22-038 — новый проверочный срез от `f410e43` — 06.10.2026

Сборка выполняется только из чистой интеграционной базы
`f410e43df8048765c933eebfba8a50b778c88aa6`, версия
`0.63.38-m5-22-review`. Последние refs проверены: covering 082 и pipe 081
уже представлены verified equivalents (`7aaaf46`, `5eeb02f`), Route v3 code
(`9c15918`, handoff `0cfb983`) — ancestry. Устаревшие document-only refs не
перенесены целиком; актуальная coverage зафиксирована в manifest/release log.

ZIP, manifest, portable gates и итоговый code SHA будут записаны ниже после
завершения штатного builder. Это не owner acceptance: ручная C1–C5 packaged
проверка исходного жгута, 390px visual QA и решение владельца остаются отдельными
gates.
