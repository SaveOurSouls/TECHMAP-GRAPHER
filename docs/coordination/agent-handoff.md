# Шаблон handoff от чата задачи

## 094 — единица сечения из записи каталога проводов

```text
Карточка: 094 — Единица сечения из записи каталога проводов
Статус: ready-for-review
Репозиторий: git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git
Ветка: codex/integration-m5-22
Worktree: C:\Users\Василий Костромин\Documents\ChatGPT\Утилита для картинок
Коммиты кода: dd13db7

Изменённые файлы:
- src/Techmap.Client/src/editor/{model,wire-database,editor-reference-catalog,editor-types,HarnessDesignEditor}.ts(x): immutable material binding сохраняет sectionUnit, каталог E3:AJ связывает G/I с AWG, явно маркированные поля сохраняют мм².
- src/Techmap.Client/src/manufacturing/cut-list-properties.ts: V3 и живая карта резки используют сохранённую единицу без преобразования или угадывания по марке.
- профильные тесты и REQ-130/карточка 094: регрессии для `UL1007 / 30AWG`, мм², serialisation и каталожного выбора.

Проверки:
- .\node_modules\.bin\vitest.cmd run: PASS, 193 файла / 1859 тестов.
- pnpm run typecheck: PASS.
- pnpm run build: PASS.
- git diff --check: PASS.

Зависимости/порядок:
- Уточнение REQ-128; не меняет электрические связи, IDs, трассы, длины и производственные параметры.

Ограничения и ручная приёмка:
- Исходный жгут и packaged UI вручную не проверялись; ZIP не запрашивался.

Статус handoff: передан сборщику.
Release coverage: следующий ZIP; подтвердить ancestry кода и документационного handoff.

Примечание сборщику:
- Старый document без sectionUnit остаётся совместимым. Для legacy binding `technology-wires` применяется только документированная семантика E3:AJ (AWG); прочие старые записи не получают выдуманную единицу.
```

## 089 — совместимые уплотнители в библиотеке компонентов

```text
Карточка: 089 — Совместимые уплотнители в библиотеке компонентов
Статус: ready-for-review
Чат: 01a13090-15e1-7123-a91d-eecf1a2eb900
Репозиторий: git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git
Ветка: codex/integration-m5-22
Коммиты кода: e86aa33f35bed40bf7d7a98ccc6862b4cadc9468, 11ab633, f10f004da6885723fd2cf6902f9a1d9245c68103

Изменения: совместимые уплотнители серии с артикулом, цветом, сечением и диаметром изоляции; выбор в столбце «Уплотнитель» таблицы компонентов Э4; валидация, сохранение, очистка удалённых ссылок и сохранение выбора при переименовании артикула. Follow-up устраняет ошибку schema-v5 при сохранении `compatibleSeals`, скрывает неактивные разделы до первого сохранения новой серии и заменяет прокручиваемую таблицу адаптивными строками без внутреннего scrollbar.
Проверки рабочего чата: исходный срез — 188 файлов / 1834 теста, TypeScript, production build, профильные тесты и git diff --check — PASS. Follow-up — профилированный Vitest 39/39, TypeScript, production build, серверная валидация 17/17 и git diff --check — PASS.
Ограничения: Browser plugin и локальный Playwright недоступны; C1–C3 сверены с реализацией, packaged UI не проверен. Полный клиентский прогон имеет одну постороннюю ошибку `route-inline-render.test.ts`: старое ожидание «После резки» вместо актуального «Без разделки».
Координатор подтвердил commits через git show/ancestry и добавил карточку, REQ-125, реестр и coverage.
Статус handoff: передан сборщику.
Release coverage: следующий ZIP; сборщику проверить все три кодовых SHA и handoff SHA относительно code HEAD.
```

## 088 — Маршрут v3: рисунки проводов из Э4

```text
Карточка: 088 — Маршрут v3: рисунки проводов из Э4
Статус: ready-for-review
Репозиторий: git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git
Ветка: codex/integration-m5-22
Worktree: C:\Users\Василий Костромин\Documents\ChatGPT\Утилита для картинок
Коммит для интеграции: 3c6a5fb0b76fb7a236c30bb55dc385b0a2ea3171

Изменённые файлы:
- src/Techmap.Client/src/manufacturing-v3/{RouteV3Panel,RouteV3Graph,route-v3-model,route-v3-wire-artwork}.tsx: проекция рисунка провода из Э4, ручной V3 override и явный сброс «Обновить вид проводов по Э4».
- src/Techmap.Client/src/manufacturing-v3/route-v3.css и route-v3-wire-artwork.test.ts: оформление подписей и регрессии терминала/уплотнителя/пайки, ручного вида и парсинга.
- docs/requirements.md, tasks/088-route-v3-e4-wire-artwork.md, tasks/README.md, docs/coordination/chat-registry.md: REQ-124, карточка и регистрация.

Проверки:
- pnpm --dir src\Techmap.Client test: PASS (188 файлов / 1831 тест).
- Профиль: 3 V3 файла / 19 тестов — PASS.
- pnpm --dir src\Techmap.Client typecheck: PASS.
- pnpm --dir src\Techmap.Client build: PASS.
- git diff --check: PASS.

Ограничения и ручная приёмка:
- localStorage-прототип; ручные исходный жгут и packaged Windows UI ожидаются.
- Уплотнитель и пайка определяются по ключам/значениям custom fields Э4 и описанию терминала; при отдельном формальном столбце его нужно связать с этой проекцией.

Статус handoff: передан сборщику; push в origin подтверждён.
Release coverage: следующий ZIP; подтвердить ancestry SHA в собираемом HEAD.
```

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

## 092 — свойства полуфабрикатов и карта резки

```text
Карточка: 092 — Свойства полуфабрикатов и сортировка карты резки
Статус: ready-for-review
Репозиторий: git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git
Ветка: codex/integration-m5-22
Worktree: C:\Users\Василий Костромин\Documents\ChatGPT\Утилита для картинок
Коммиты для интеграции: 89443d6073c47730d181caec9a40b4717baff736 f8de2612ebad386b308216953c1e96be4c2f70cc

Изменение: V3 показывает название ПФ, одну величину сечения с исходной единицей,
цвет и точные концы по Э4; терминал форматируется как «артикул / уплотнитель»
для стороны A и «уплотнитель / артикул» для стороны B, без терминала показываются
медь, лужёная медь или «Без разделки». «После резки» переименовано. Живая карта
резки на Чертеже получила свойства ПФ, группы проводов/кабелей и оболочек,
фильтр и накопительную сортировку по марке, цвету, сечению и терминалу.

Изменённые файлы:
- src/Techmap.Client/src/manufacturing/cut-list-properties.ts: общая проекция свойств и концов.
- src/Techmap.Client/src/editor/cut-list-presentation.ts: группы, фильтр и стабильная сортировка.
- src/Techmap.Client/src/HarnessCutListPanel.tsx, editor/CutDiagramPanel.tsx, editor/HarnessRelationsPanel.tsx: таблица карты резки в Чертежe.
- src/Techmap.Client/src/manufacturing-v3/route-v3-wire-artwork.tsx, WireBlankCatalog.ts: рисунок V3 и подпись «Без разделки».
- профильные тесты и REQ-128/карточка 092.

Проверки:
- .\\node_modules\\.bin\\vitest.cmd run: PASS, 190 файлов / 1842 теста.
- pnpm run typecheck: PASS.
- pnpm run build: PASS.
- git diff --check: PASS.

Зависимости/порядок:
- После REQ-124/125; серверный DTO сохранённой read-only карты не менялся.

Ограничения и ручная приёмка:
- Свойства Э4 и сортировка доступны в живой карте резки внутри Чертежа; внешний серверный read-only список сохраняет прежний контракт и показывает базовые строки без текущего несохранённого документа.
- Исходный жгут и packaged UI не проверены вручную; ZIP не запрашивался.

Статус handoff: передан сборщику после фиксации SHA
Release coverage: следующий ZIP; требуется подтверждение ancestry/equivalent
```

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

## 090 — боковой профиль оконцовок по C1, 12.10.2026

- Чат: `01a13091-f350-7b62-b8b0-9ca77cf1ad58`; REQ-126; статус ready-for-review.
- Ветка: `codex/integration-m5-22`, основной worktree; origin `git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git`.
- Кодовый SHA: `e47f99e2b8044b85d7703359234477de1f3a0821`, отправлен в origin.
- Общий SVG-генератор, 13 рисунков/7 частей, overview/terminal-detail, Canvas scale/anchor и профильные регрессии; чужие незавершённые 089 исключены из коммита, включая общие документы (staged только 090).
- Проверки: Vitest 188 файлов / 1834 теста; профильные 4/14; tsc/Vite; verifier 13/7; XML 20/20; staged diff-check PASS. Browser стенд 1266×714: C1 и итоговый профиль, terminal/sealed-pin, цвет, изображения 3/3, console 0 PASS.
- Интеграции: WireBlankPreview → справочник/ManufacturingRoute/v2/v3; Canvas → renderPartSvg. Новая постоянная модель/ADR не требуются.
- Протокол: `docs/wire-end-090-handoff.md`; карточка: `tasks/090-wire-end-reference-redesign.md`.
- Ограничения: исходный жгут, packaged UI, 390px и приёмка владельцем открыты; IPC не сертифицирован; фото остаются прежними по контракту. ZIP не запрошен.
- Передача сборщику: включить кодовый и следующий документальный SHA 090, подтвердить ancestry и coverage перед следующим ZIP. Этот handoff не означает готовность всех соседних задач релиза.

## 090 follow-up — 13.10.2026: выход меди из изоляции

Статус: ready-for-review. Чат: 01a13091-f350-7b62-b8b0-9ca77cf1ad58, ветка codex/integration-m5-22.
Кодовый SHA: e22862d0051f54dec3629787dc84eb3b38296111, отправлен в origin.
Общий генератор рисует жилы под изоляцией/уплотнителем; выход меди из торца виден для terminal/sealed/sealed-pin и зеркального конца. SVG/PNG обновлены.
Проверки: 188 файлов / 1835 тестов, tsc/Vite, verifier 13/7, XML 20/20, diff-check; растровая проверка 12/12 случаев. Увеличенный стык просмотрен.
Ограничения: исходный жгут и packaged UI не проверены; ZIP не запрошен. M5-22-042 остаётся предыдущим пакетом без follow-up. Сборщику подтвердить SHA follow-up и документальный commit как ancestry перед следующим ZIP.
Соседняя 091 не входит в эту работу: случайно попавшая регистрационная строка REQ-127 убрана только из Git index документальным commit, исходный рабочий файл 091 сохранён для её владельца.

## 091 — стабильная граница оболочки и витая пара

```text
Карточка: 091 — Стабильная граница оболочки и витая пара
Статус: ready-for-review
Репозиторий: git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git
Ветка: codex/integration-m5-22
Worktree: C:\Users\Василий Костромин\Documents\ChatGPT\Утилита для картинок
Коммиты для интеграции: 1a76bbaa8964280362a637c4415e365b16a1588a

Изменённые файлы:
- src/Techmap.Client/src/editor/physical-editing.ts: свободные торцы покрытия перепроецируются после переноса точки П; point-bound торцы не меняют семантику.
- src/Techmap.Client/src/editor/drawing-twisted-pair.ts, physical-wire-geometry.ts, editor-types.ts, CanvasViewport.tsx: витые stroke-фрагменты запрашивают round join вместо miter.
- профильные тесты, REQ-127, карточка 091, реестр и статус: регрессии и handoff.

Проверки:
- pnpm --dir src/Techmap.Client test: PASS (188 файлов / 1838 тестов).
- pnpm --dir src/Techmap.Client typecheck: PASS.
- pnpm --dir src/Techmap.Client build: PASS.
- git diff --check: PASS.

Зависимости/порядок:
- После 97af06e; нет миграции формата и серверных изменений.

Ограничения и ручная приёмка:
- Browser plugin и локальный Playwright fallback недоступны; C1–C8 на исходном жгуте и packaged Windows UI ещё не проверены вручную.

Статус handoff: передан сборщику
Release coverage: следующий ZIP; требуется подтверждение ancestry/equivalent

Примечание сборщику:
- Проверить 1a76bba как ancestor собираемого HEAD. Изменение сохраняет электрические связи, ID, авторские маршруты и производственные длины.
```
## 093 — Route v3: обновление исходника и операции карточек, 13.10.2026

- Чат: `/root`; исполнители `/root/terra` (модель) и `/root/luna` (интерфейс). Статус: ready-for-review.
- Ветка и worktree: `codex/integration-m5-22`, основной worktree; origin `git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git`.
- Кодовый SHA: `02dc3d60375e84966382ef29ba826679c1d6ceb2`, отправлен в origin. Документальный SHA: `764385d`.
- Изменение: сравнение сохранённого Чертежа/Э4 с Route v3 по устойчивым объектам и смысловым точкам, явное обновление и список расхождений; операции из БД.ОП, формулы времени и кратность партии; адаптивные карточки C1/C2 без горизонтальной полосы.
- Проверки: Vitest 193 файла / 1856 тестов, TypeScript, Vite production build, staged diff-check — PASS. Playwright Chrome 1440 и 390 px: ошибок исполнения 0, горизонтальная прокрутка диалога 0; исходный жгут и packaged UI не проверены вручную.
- Ограничение: новые заготовки попадают в подготовленные карточки, но оператор назначает их в ранее настроенную сборку; неизвестные нормы не считаются нулём. Локальное хранение Route v3; ZIP не запрошен.
- Сборщику: подтвердить оба SHA как ancestors собираемого HEAD и отметить coverage перед следующим ZIP. Текущий кодовый SHA уже находится в integration-ветке.

## 091 follow-up — радиус витой пары и совпадение ручки с торцом, 13.10.2026

- Чат `/root`, `codex/integration-m5-22`, основной worktree; статус ready-for-review.
- Кодовые SHA `576a20c`, `caafc22` отправлены в `git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git`.
- C1–C2: витая пара использует скруглённую отображаемую трассу члена ОП и непрерывную касательную для нормали; round join сохранён без miter-клиньев.
- C3–C4: выбранная и наведённая линия торца использует реальные концы видимой поперечной кромки, а не отдельную расчётную ширину от соседней вершины.
- Для bounded-ОП торец сначала строится перпендикулярно оси ОП, но при проверке покрытия входящих П безопасно возвращается к локальному поперечному срезу, если общий срез отсекал бы member path.
- Проверки: Vitest 193 файла / 1862 теста, TypeScript, Vite production build, staged diff-check PASS.
- Ограничения: на резко сложенном ОП глобальный перпендикуляр мог отсечь П; сохранён локальный поперечный торец. Ручная проверка исходного жгута C1–C4 и packaged UI открыта; ZIP не запрошен.
- Сборщику: подтвердить `576a20c` и документальный SHA этого handoff как ancestors следующего ZIP HEAD; соседние `manufacturing-v3/*` изменения не входят в этот handoff.

