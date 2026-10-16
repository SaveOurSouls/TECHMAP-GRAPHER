# Handoff 125 / REQ-160 — границы сцены

- Дата: 16.10.2026; **ready-for-review**, owner acceptance открыта.
- Чат: `01a14521-6a96-7152-b095-accc21abdda7`, `/root`.
- Ветка/worktree: основная `codex/integration-m5-22`.
- База: `9f6343fbf44838b8cee5aec7d4e87d1c76ccda15`.
- Код/тесты/ADR/протокол: **`440939f942b53bf09bbaf422829f9b696ff7bf52`**, опубликован в разрешённый origin, push `9f6343f..440939f`.
- Документальный handoff: коммит этой записи; SHA сообщается в финале чата.

## Результат

В canvas-scene-bounds.ts перенесён непрерывный блок expandSceneBounds, drawingConnectorIndexLabel и getEditorSceneBounds. Две публичные функции доступны по прежнему пути через CanvasViewport, аккумулятор приватный. Общие три константы оформления разделки — в canvas-wire-strip-style.ts; рисование и расчёт границ используют одну толщину обводки.

CanvasViewport **2679 → 2463 строки**, минус 216; bounds 231 строка, style 3. Перенесённые функции/константы и весь оставшийся код от CanvasViewportProps совпали с исходником после удаления блоков и нормализации export/EOL. Жесты, рисование, fit, связи, длины и геометрия П/ОП не менялись. Новые модули не импортируют React/CanvasViewport и не обращаются к глобальному DOM.

[Протокол](../canvas-scene-bounds-125-refactor.md), [ADR-0030](../decisions/0030-canvas-scene-bounds.md), [карточка](../../tasks/125-canvas-scene-bounds.md).

## Проверки

- Baseline/повтор после переноса: **10 файлов / 178 тестов PASS**, 5,87/6,06 с.
- Восемь новых characterization-проверок получены до переноса; после него — прямой импорт и девятая проверка прежних экспортов/приватности аккумулятора.
- **6 новых + 16 прежних = 22 эталона**, четыре snapshot-файла побайтово совпали с baseline. После переноса snapshots не обновлялись.
- Полный Vitest **214 файлов / 2312 тестов PASS**, 97,54 с.
- TypeScript и production build (tsc/Vite) PASS, Vite 1,22 с; прежнее предупреждение размера основного chunk сохраняется.
- Сверка исходных/оставшихся реализаций и shared style, зависимости, рабочий/staged diff-check, review и новые ссылки docs PASS.

Прогоны последовательные, один worker, TEMP/TMP в ignored tmp/canvas-125/temp. Временные evidence не входят в Git. Сервер/форматы не менялись; .NET не запускался.

## Интеграция и ограничения

Код опубликован прямо в integration; `git merge-base --is-ancestor 440939f942b53bf09bbaf422829f9b696ff7bf52 HEAD` подтверждает включение. Cherry-pick не требуется. Этот docs-коммит завершает handoff/coverage/status.

Следующий заказанный релиз должен включить code/handoff 120–125. M5-22-054 их не содержит; **новый ZIP не заказан**. Ручная browser/portable-приёмка и исходный жгут не проверялись. Owner acceptance открыта, чат не архивируется.
