# 125. Выделить границы сцены из CanvasViewport

- **Статус:** ready-for-review
- **Владелец / чат:** `/root`, `01a14521-6a96-7152-b095-accc21abdda7`.
- **Источник:** исходный запрос владельца 16.10.2026: «Продолжи рефакторинг CanvasViewport: вынеси следующий самостоятельный блок, сохрани текущее поведение и проверь изменения тестами».
- **Требование:** REQ-160. Выбор расчёта границ — техническое решение исполнителя.
- **Решения:** ADR-0003/0026–0029; [ADR-0030](../docs/decisions/0030-canvas-scene-bounds.md).
- **База:** `9f6343fbf44838b8cee5aec7d4e87d1c76ccda15`, handoff 124.
- **Ветка/worktree:** основная `codex/integration-m5-22`, исходно чистая.
- **Владелец файлов:** CanvasViewport, новые canvas-scene-bounds.ts / canvas-wire-strip-style.ts и свои тесты/docs/tasks. Model/commands, geometry/renderers предыдущих карточек и physical-* исключены.
- **Coverage:** следующий срез после M5-22-054; ZIP не заказан.

## Границы и критерии

Перенести expandSceneBounds, drawingConnectorIndexLabel и getEditorSceneBounds без изменения тел. Три константы оформления разделки выделить в общий модуль: расчёт границ и рисование используют одну толщину обводки. Старые публичные функции доступны через CanvasViewport. Не менять жесты, рисование, масштабирование камеры, модель документа, связи, длины и геометрию П/ОП.

- Новые characterization-проверки проходят до/после переноса на неизменных эталонах.
- Перенесённый блок и оставшийся viewport совпадают с базой после нормализации import/export/EOL и удаления перенесённых блоков.
- Новый модуль не импортирует CanvasViewport/React и не обращается к глобальному DOM.
- Профильный и полный Vitest, TypeScript/Vite, прежние 16 эталонов, diff-check/review PASS.
- Код/документация опубликованы; handoff/coverage заполнены, owner acceptance отдельно.

## Проверки

Профиль: новые границы, editor-workspace, component-template-view-renderer, termination-geometry, drawing-paint-order, canvas-gestures, canvas-scene-hit-test и три прежних canvas characterization-файла. Полный клиентский Vitest и production build последовательно, один worker, TEMP/TMP в ignored tmp/canvas-125. Сервер/форматы не меняются; .NET, browser/portable и ZIP вне этого переноса.

## Результат

- Код/тесты/ADR и [протокол](../docs/canvas-scene-bounds-125-refactor.md): **`440939f942b53bf09bbaf422829f9b696ff7bf52`**, опубликован в origin/integration. [Handoff](../docs/coordination/handoff-125-canvas-scene-bounds.md) — коммит этой записи, ancestry PASS; cherry-pick не требуется.
- CanvasViewport 2679 → 2463 строки; bounds 231 строка, style 3. Перенесённые функции, константы и весь оставшийся код от CanvasViewportProps совпадают с базой после удаления блоков и нормализации export/EOL. Прежний API сохранён.
- Baseline/повтор: **10 файлов / 178 тестов PASS**, 5,87/6,06 с. Прямые импорты и новый тест API проверены общим прогоном: **214/2312 PASS**, 97,54 с. TypeScript/Vite PASS, Vite 1,22 с; прежнее предупреждение размера chunk сохраняется.
- **22 эталона** (6 новых + 16 прежних) неизменны; diff-check/review и новые ссылки PASS. Временные evidence в ignored tmp/canvas-125.
- Ручная browser/portable-приёмка и исходный жгут не проверялись; сервер/форматы не менялись, .NET не запускался. Новый ZIP не заказан; owner acceptance открыта.
