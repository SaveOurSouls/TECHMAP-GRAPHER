# Шаблон handoff от чата задачи

Скопируйте блок в сообщение чату-сборщику после успешных обязательных проверок.
Handoff обязателен для статуса `ready-for-review`; без него задача остаётся
`in-progress` либо `blocked` и не считается переданной сборщику.

```text
Карточка: NNN — <название>
Статус: ready-for-review
Репозиторий: <абсолютный путь или имя remote>
Ветка: <ветка>
Worktree: <путь>
Коммиты для интеграции: <hash1> [<hash2> ...]

Изменённые файлы:
- <путь>: <назначение изменения>

Проверки:
- <команда>: PASS
- <команда>: PASS

Зависимости/порядок:
- <предыдущий коммит или `нет`>

Ограничения и ручная приёмка:
- <что ещё не проверено, либо `нет`>

Статус handoff: передан сборщику / заблокирован
Release coverage: ожидаемый релиз или причина явного исключения

Примечание сборщику:
- <особенности cherry-pick, ожидаемый конфликт, миграция или порядок запуска>
```

Перед отправкой выполните `git status --short`, чтобы убедиться, что в handoff не заявлены незакоммиченные файлы. Если задача состоит из нескольких коммитов, перечислите их в порядке применения и объясните зависимость.

Сборщик подтверждает или отклоняет handoff в `integration-log.md` и
`release-coverage.md`. Рабочий чат не заявляет «интегрировано» или «вошло в ZIP»;
это подтверждается только проверкой интеграционной ветки.

## 084 — Маршрут v3: графические слепки и генерация по зависимостям

```text
Карточка: 084 — Маршрут v3: графические слепки и генерация по зависимостям
Статус: ready-for-review
Репозиторий: git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git
Ветка: codex/route-v3
Worktree: C:\Users\Василий Костромин\.codex\worktrees\route-v3\Утилита для картинок
Коммиты для интеграции: 9c15918

Изменённые файлы:
- src/Techmap.Client/src/manufacturing-v3/*: отдельная модель, редактор слепков, галерея и генерация DAG маршрута.
- src/Techmap.Client/src/App.tsx, src/Techmap.Client/src/editor/*: отдельная вкладка v3, скрытый фон 20%, контекстные «Изолировать»/«Сохранить» и сохранение чистого изолированного слепка.
- docs/architecture.md, docs/decisions/0016-route-v3-graphical-snapshots.md, tasks/084-route-v3-graphical-snapshots.md: архитектура, ADR и карточка.

Проверки:
- pnpm run test: PASS (184 файла / 1804 теста).
- pnpm run typecheck: PASS.
- pnpm run build: PASS.
- pnpm exec vitest run src/manufacturing-v3/route-v3-model.test.ts: PASS (9 тестов).
- Playwright fallback smoke: PASS (desktop, reload, 390px, без API writes; Browser plugin отсутствует).
- git diff --check: PASS.

Зависимости/порядок:
- База 9217d6a; после интеграции Route v2/редакторных изменений.

Ограничения и ручная приёмка:
- Нужны ручная проверка владельца, packaged UI и исходного жгута после интеграции; ZIP не собирался.

Статус handoff: передан сборщику
Release coverage: следующий ZIP; требуется подтверждение ancestry/equivalent

Примечание сборщику:
- Маршрут v2 не изменён. Временный Playwright QA сохранён вне репозитория; дополнительные API-записи не выполняются.
```


## 082 — Приоритет выбора узлов поверх оболочек

```text
Карточка: 082 — Приоритет выбора узлов поверх оболочек
Статус: ready-for-review
Репозиторий: git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git
Ветка: codex/covering-point-priority
Worktree: C:\Users\Василий Костромин\.codex\worktrees\covering-point-priority\Утилита для картинок
Коммиты для интеграции: 37a8d0a

Изменённые файлы:
- src/Techmap.Client/src/editor/CanvasViewport.tsx: узел блокирует раннее перетаскивание и hover-ручку оболочки.
- src/Techmap.Client/src/editor/drawing-paint-order.test.ts: регрессия для приоритета точки и выбора оболочки вне неё.
- docs/requirements.md, tasks/082-covering-junction-selection-priority.md, tasks/README.md, docs/coordination/chat-registry.md: REQ-112, карточка и реестр.

Проверки:
- pnpm exec vitest run: PASS, 183 файлов / 1791 тестов.
- pnpm run typecheck: PASS.
- pnpm run build: PASS.
- git diff --check: PASS.

Зависимости/порядок:
- Базовый commit cfe3503; переносить после текущей интеграции M5-22 либо как проверенный эквивалент.

Ограничения и ручная приёмка:
- Проверить C1 в исходном жгуте после интеграции; Vite сообщает о существующем крупном chunk.

Статус handoff: передан сборщику
Release coverage: следующий ZIP; требуется подтверждение ancestry/equivalent

Примечание сборщику:
- Нет миграций и серверных изменений. Если `CanvasViewport.tsx` был изменён параллельно, сохранить общий predicate `coveringDragBlockedByPhysicalNode` в раннем обработчике оболочки и в hover.
```

## 083 — Маршрут v2: карточки, состав C2 и изолированный рисунок

```text
Карточка: 083 — Маршрут v2: карточки, состав C2 и изолированный рисунок
Статус: ready-for-review
Репозиторий: git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git
Ветка: codex/integration-m5-22
Worktree: C:\Users\Василий Костромин\Documents\ChatGPT\Утилита для картинок
Коммиты для интеграции: bfb0906 97d4a56 ab801fc

Изменённые файлы:
- docs/design/route-v2-c2-material-picker.md: дизайн C2 с разделением сырья/полуфабрикатов, hints, портами, isolated preview и resize.
- docs/requirements.md, tasks/083-route-v2-card-materials-and-connectors.md, tasks/README.md, docs/coordination/chat-registry.md: REQ-113–119 и регистрация карточки.
- src/Techmap.Client/src/manufacturing-v2/route-v2-model.ts: размеры, входящие результаты, порты, preferred isolated copy и assembly inputs.
- src/Techmap.Client/src/manufacturing-v2/RouteV2Panel.tsx, route-v2.css: C2, точки связи, красный link mode, resize, inline hints и isolated preview.
- src/Techmap.Client/src/manufacturing-v2/route-v2-c2-model.test.ts, route-v2-ui.test.ts: профильные регрессии.
- src/Techmap.Client/src/manufacturing/RouteAssemblyDrawing.tsx, route-assembly-drawing.css, route-drawing-lifecycle.test.ts: сохранение текущего вида без изменений.

Проверки:
- .\\node_modules\\.bin\\vitest.cmd run: PASS, 185 файлов / 1803 теста.
- pnpm run typecheck: PASS.
- pnpm run build: PASS.
- git diff --check: PASS.

Зависимости/порядок:
- Дизайн `bfb0906` перед кодом `97d4a56`, корректировка `ab801fc`; localStorage version 1 обратно совместим.

Ограничения и ручная приёмка:
- Ручная проверка C1/C2 на исходном жгуте, packaged UI и проверка ZIP остаются за сборщиком/владельцем.
- Route v2 сохраняет localStorage-прототип; серверный контракт не менялся.

Статус handoff: передан сборщику
Release coverage: 083 included (ancestor); общий ZIP gate blocked pending 084

Примечание сборщику:
- Собирать после включения `bfb0906`, `97d4a56` и `ab801fc`; не включать незакоммиченный `tasks/084-route-v3-graphical-snapshots.md` другого чата.
```
