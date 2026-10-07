# Шаблон handoff от чата задачи

## 085 — Свойства размеров и индексы материалов на Чертеже

```text
Карточка: 085 — Свойства размеров и индексы материалов на Чертеже
Статус: ready-for-review
Репозиторий: git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git
Ветка: codex/integration-m5-22
Worktree: C:\Users\Василий Костромин\Documents\ChatGPT\Утилита для картинок
Коммиты для интеграции: 723ff99350476255dcdae2de5442cf761c9720c2

Изменённые файлы:
- src/Techmap.Client/src/editor/CanvasViewport.tsx, HarnessEditorWorkspace.tsx: размер и верхние аннотации получают приоритет над жестами пайпов/оболочек; панель свойств открывается при выборе размера.
- src/Techmap.Client/src/editor/drawing-indices.ts, drawing-documents.ts, model.ts: лидер индекса с точкой и ограничением 10° к нормали; новый мигрируемый слой `material-indexes` для индексов и позиционных выносок.
- src/Techmap.Client/src/editor/*test.ts: регрессии hit-test, выбора, BOM-метража, верхнего слоя и миграции.

Проверки:
- pnpm --dir src\Techmap.Client test: PASS (186 файлов / 1818 тестов)
- pnpm --dir src\Techmap.Client typecheck: PASS
- pnpm --dir src\Techmap.Client build: PASS
- git diff --check: PASS

Зависимости/порядок:
- После caafa91021fbd5e205c65067dcfcad7b4f643e88; кодовый commit уже находится в integration-ветке, однако включение в ZIP подтверждает только сборщик.

Ограничения и ручная приёмка:
- C1/C2 на исходном жгуте, packaged Windows UI и owner acceptance вручную не проверены. Vite сообщает известные предупреждения `heic-to` и крупного chunk.

Статус handoff: передан сборщику
Release coverage: следующий ZIP; требуется подтверждение ancestry/equivalent

Примечание сборщику:
- Миграция добавляет слой при чтении старого документа. Электрические связи не меняются; изменяемая длина размера продолжает использовать существующий доменный пересчёт длины материала.

## 086 — Карточки UML и зависимости в Маршруте v3

```text
Карточка: 086 — Карточки UML и зависимости в Маршруте v3
Статус: ready-for-review
Репозиторий: git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git
Ветка: codex/route-v3-uml
Worktree: C:\Users\Василий Костромин\.codex\worktrees\route-v3\Утилита для картинок
Коммит для интеграции: 0a3c04a0480b7eee1820b56cc2450a8f6ec5c83d

Изменённые файлы:
- src/Techmap.Client/src/manufacturing-v3/RouteV3Graph.tsx,
  route-v3-graph.css, route-v3-graph.ts: UML-карточки, resize, точки,
  cursor-arrow, delete, плюс/вставка в разрыв, настройки и операции.
- src/Techmap.Client/src/manufacturing-v3/RouteV3Panel.tsx: подключение графа,
  сохранение рисунка карточки и защита ручного графа от сохранения слепка.
- src/Techmap.Client/src/manufacturing-v3/route-v3-model.ts/.test.ts: размеры,
  состав, graphEdited, миграция, парсер и регрессии старых документов.
- src/Techmap.Client/src/manufacturing-v3/route-v3-graph.test.ts: 7 регрессий DAG.
- docs/decisions/0017-route-v3-editable-dependencies.md, tasks/086-route-v3-uml-cards.md,
  docs/requirements.md, docs/coordination/{chat-registry,release-coverage}.md.

Проверки:
- pnpm run test: PASS, 187 файлов / 1822 теста.
- pnpm run typecheck: PASS.
- pnpm run build: PASS.
- git diff --check: PASS.
- Playwright fallback (Browser plugin unavailable), fixture 5186: PASS desktop
  1600x1050 and mobile 390x844; resize/content fill, plus leaf/insertion,
  operations, composition propagation and edge delete, cursor arrow, cycle
  rejection, delete cancel/confirm, reload, card drawing save, graphical editor
  at 20%, fragment save, API writes = 0. Screenshots outside repository.

Ограничения:
- localStorage-прототип; packaged UI and owner manual source-harness acceptance remain open.
- ZIP не собирался: он не входил в поручение.

Статус handoff: передан сборщику
Release coverage: 086 ready-for-review; pending integration into next ZIP.
```

## 080 — Follow-up: точка перехода ОП

```text
Карточка: 080 — Редактирование точек изгиба пайпов
Статус: ready-for-review (follow-up)
Репозиторий: git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git
Ветка: codex/integration-m5-22
Worktree: C:\Users\Василий Костромин\Documents\ChatGPT\Утилита для картинок
Коммиты для интеграции: 3df8ce6

Изменённые файлы:
- src/Techmap.Client/src/editor/commands.ts: явная очистка внешней станции перехода ОП.
- src/Techmap.Client/src/editor/HarnessDesignEditor.tsx: удаление outerEnter/outerExit по видимой ручке.
- src/Techmap.Client/src/editor/CanvasViewport.tsx: выбор ближайшей ручки при совпадении пайпов.
- src/Techmap.Client/src/editor/physical-joining-pipe.test.ts: регрессия перемещения/удаления точки.
- tasks/080-edit-pipe-bend-points.md: журнал follow-up.

Проверки:
- pnpm --dir src\\Techmap.Client test: PASS (186 файлов / 1813 тестов)
- pnpm --dir src\\Techmap.Client typecheck: PASS
- pnpm --dir src\\Techmap.Client build: PASS
- git diff --check: PASS

Зависимости/порядок:
- После 7d51a673a0cba9d0654dd54d1f2c28472a8cf984.

Ограничения и ручная приёмка:
- Исходный жгут C1 и packaged Windows UI владельцем вручную не проверены.

Статус handoff: передан сборщику
Release coverage: следующий ZIP; требуется подтверждение ancestry/equivalent

Примечание сборщику:
- Изменение не затрагивает электрические связи, ID маршрутов и производственные длины.
```

## 080 — Follow-up: ручка на округлённой проекции

```text
Карточка: 080 — Редактирование точек изгиба пайпов
Статус: ready-for-review (follow-up)
Репозиторий: git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git
Ветка: codex/integration-m5-22
Worktree: C:\Users\Василий Костромин\Documents\ChatGPT\Утилита для картинок
Коммиты для интеграции: 17914c2

Изменённые файлы:
- src/Techmap.Client/src/editor/pipe-bundle-projection.ts: ручки берутся из sampled route, используемого отрисовкой.
- src/Techmap.Client/src/editor/pipe-bundle-projection.test.ts: регресс для общей точки и округлённого пайпа.
- tasks/080-edit-pipe-bend-points.md: журнал follow-up.

Проверки:
- pnpm --dir src\\Techmap.Client test: PASS (186 файлов / 1814 тестов)
- pnpm --dir src\\Techmap.Client typecheck: PASS
- pnpm --dir src\\Techmap.Client build: PASS
- git diff --check: PASS

Зависимости/порядок:
- После 3df8ce65d18ec0807be746bb6f43c201ec0ccb8e.

Ограничения и ручная приёмка:
- Исходный жгут C1–C3 и packaged Windows UI владельцем вручную не проверены.

Статус handoff: передан сборщику
Release coverage: следующий ZIP; требуется подтверждение ancestry/equivalent

Примечание сборщику:
- Электрические связи, маршруты и производственные длины не меняются; меняется только экранная координата ручки и обратное преобразование редактирования.
```

Скопируйте блок в сообщение чату-сборщику после успешных обязательных проверок.

## 080 — Follow-up: индексы библиотечных XS и ручка на округлённом маршруте

```text
Карточка: 080 — Редактирование точек изгиба пайпов
Статус: ready-for-review
Репозиторий: git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git
Ветка: codex/integration-m5-22
Коммит для интеграции: d971f0d

Изменение: индексы XS привязывают leader к фактическим bounds библиотечного
рисунка и сохраняют эти bounds для последующего перемещения. Обычная ручка
изгиба использует ту же округлённую экранную трассу, что и отрисовка, с обратным
преобразованием при записи authored geometry. Электрические связи, топология и
производственные длины не меняются.

Проверки: полный клиентский Vitest PASS (187 файлов / 1828 тестов), typecheck
PASS, Vite build PASS, git diff --check PASS.

Ограничения: ручная проверка исходного жгута C1–C3 и packaged Windows UI остаётся
за сборщиком/владельцем. Vite сообщает известные предупреждения externalized
fs/path/crypto и крупного chunk.

Статус handoff: передан сборщику
Release coverage: следующий ZIP; требуется подтверждение ancestry/equivalent
```
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

```text
Карточка: 080 — Редактирование точек изгиба пайпов (follow-up C1)
Статус: ready-for-review
Репозиторий: git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git
Ветка: codex/integration-m5-22
Коммиты для подтверждения coverage: 17914c2d19271315fccd70077e870faffaf3dec8 e40ffd09b0f770665eedafb445bce209e60de056

Изменение: handle generated bend controls now follows the same sampled/rounded route as the visible pipe bundle; inverse projection remains in place for editing authored geometry.
Проверки рабочего чата: client tests 1814/1814, typecheck, build, diff-check — PASS (reported by worker).
Git coordinator check: both commits resolve, `git show --check` PASS, both are ancestors of current integration HEAD `e40ffd09b0f770665eedafb445bce209e60de056`.
Ограничения: source harness C1–C3 and packaged Windows UI were not manually checked.
Требуется от сборщика: explicitly confirm follow-up row in release coverage; base card 080 was already included in M5-22-037.
```
