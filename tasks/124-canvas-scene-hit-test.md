# 124. Выделить hit-test сцены из CanvasViewport

- **Статус:** ready-for-review
- **Владелец / чат:** `/root`, `01a14521-6a96-7152-b095-accc21abdda7`.
- **Источник запроса:** продолжение владельца 16.10.2026: «Продолжи рефакторинг CanvasViewport: вынеси следующий самостоятельный блок, сохрани текущее поведение и проверь изменения тестами».
- **Требования:** REQ-159; сохраняются существующие правила выбора, индексов, контактов и геометрии.
- **Решения:** ADR-0003/0026/0027/0028; [ADR-0029](../docs/decisions/0029-canvas-scene-hit-test.md).
- **Зависимости:** handoff 123, база `43c57e3`.
- **Владелец файлов:** `editor/CanvasViewport.tsx`, новый `canvas-scene-hit-test.ts`, собственные тесты и docs/tasks. Файлы model/commands/physical-*/renderer не меняются.
- **Ветка / worktree:** основная `codex/integration-m5-22`, исходно чистая.
- **Release coverage:** следующий срез после M5-22-054; ZIP не заказан.

## Результат и границы

Выделить hit-test сцены и используемую им геометрию мишеней: расстояния/контуры, рисунки разделки, ручки/концы проводов и П, кабельные оболочки, приоритеты объектов и блокировку drag оболочки точкой соединения. Исходные тела функций, правила выбора, импорты публичных функций и тип VisibleCableSheathScene сохраняются. Внутренние containsPoint/pointToSegmentDistance экспортируются только из нового модуля для прежних обработчиков viewport. Модель П/ОП и их геометрические алгоритмы не меняются.

## Критерии приёмки

- Characterization-проверки проходят до и после переноса: приоритеты, видимость/lock, zoom, реальные штрихи, контакты, управляемые ручки и контуры оболочек.
- Перенесённый блок и оставшийся viewport совпадают с базой после нормализации import/export/EOL.
- Прежние публичные функции/тип доступны через CanvasViewport; новый модуль не импортирует CanvasViewport/React и не использует глобальный DOM.
- Профильный/полный Vitest, TypeScript/Vite, diff-check/review и прежние эталоны PASS.
- Код опубликован, handoff/coverage заполнены; owner acceptance отдельно.

## План проверки

Baseline и повтор: новый hit-test, editor-workspace, canvas-gestures, drawing-paint-order, drawing-bend-radius, pipe-editing, materialized-contact-representation, component-template-view-renderer и три прежних canvas characterization-файла. Затем полный Vitest и production build, последовательно с одним worker/TEMP в ignored tmp. Сервер/форматы не меняются; .NET и упаковка не входят в этот перенос.

## Журнал результата

- Код/тесты/ADR и [протокол](../docs/canvas-scene-hit-test-124-refactor.md): **`a5873e8142ba79f7c0baec9a43ba638cbd46f798`**, опубликован в origin/integration. [Handoff](../docs/coordination/handoff-124-canvas-scene-hit-test.md) — коммит этой записи; ancestry PASS, cherry-pick не требуется.
- CanvasViewport 2923 → 2679 строк, новый модуль 282. Тела перенесённых функций и весь оставшийся код от CanvasViewportProps совпали с базой после удаления блока и нормализации export/EOL; прежний API сохранён.
- Baseline/повтор профиля: 11 файлов / 177 тестов PASS. Добавленная проверка API и прямые импорты проверены общим прогоном: **213/2303 PASS**, 96,75 с. TypeScript/Vite PASS, Vite 1,22 с; прежнее предупреждение размера chunk сохраняется.
- 16 прежних эталонов неизменны; diff-check/review и ссылки PASS. Временные evidence в ignored tmp/canvas-124.
- Ручная browser/portable-приёмка и исходный жгут не проверялись. Сервер/форматы не менялись, .NET не запускался. ZIP не заказан; owner acceptance открыта.
