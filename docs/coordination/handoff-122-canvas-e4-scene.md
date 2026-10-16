# Handoff 122 / REQ-157 — геометрия сцены Э4

- Дата: 16.10.2026; **ready-for-review**, owner acceptance открыта.
- Чат: `01a14521-6a96-7152-b095-accc21abdda7`, `/root`.
- Ветка / worktree: основная `codex/integration-m5-22`.
- База: `2d5c1be967462e560484c36f5ad48827ae558c48`.
- Код/тесты/ADR/протокол: **`df346dbc9b2e7e9261f6ce5b7029c53ec4460341`**, опубликован в разрешённый origin, push `2d5c1be..df346db`.
- Документальный handoff: коммит этой записи; SHA сообщается в финале чата.

## Результат

Расчёты сегментов/проекций Э4, crossings/bridges, metadata overlays, layout/hit-test диффпар/экранов, подписей и видимости выделены в `canvas-e4-scene.ts`. Общий `objectsInPaintOrder` перенесён в `canvas-paint-order.ts`, чтобы не создавать обратной зависимости на viewport. Прежние публичные функции/типы доступны через CanvasViewport.

CanvasViewport: **3759 → 3151 строк**, минус 608; новые модули — 641 и 34 строки. Тела перенесённых блоков и весь оставшийся viewport (включая обработчики/рисование) не менялись, кроме import/export/EOL. Новые модули не импортируют CanvasViewport/React и не используют глобальный DOM. Документ, связи, длины, П/ОП, сервер и renderer соединителей не менялись.

[Протокол](../canvas-e4-scene-122-refactor.md), [ADR-0027](../decisions/0027-canvas-e4-scene-geometry.md), [карточка](../../tasks/122-canvas-e4-scene-geometry.md).

## Проверки

- До/после переноса: **8 файлов / 124 теста PASS**.
- Новый эталон геометрии сформирован до переноса; после переноса snapshot не обновлялся. Он и шесть прежних эталонов соединителей побайтово совпали с baseline.
- Полный клиентский Vitest: **211 файлов / 2283 теста PASS**, 94,83 с.
- TypeScript/Vite production build PASS, Vite 1,26 с; предупреждение основного chunk сохраняется.
- Сверка трёх перенесённых блоков и оставшегося viewport, зависимости, рабочий/staged diff-check, review и ссылки docs PASS.

Проверки последовательные, один worker, TEMP в `tmp/canvas-122/temp`. Логи/скрипты ignored, в Git не включены. Сервер и форматы не менялись, .NET не запускался.

## Интеграция и ограничения

Код уже в integration-ветке; `git merge-base --is-ancestor df346dbc9b2e7e9261f6ce5b7029c53ec4460341 HEAD` подтверждает включение. Cherry-pick не требуется, coverage/status обновляются этим docs-коммитом.

Следующая заказанная поставка должна включить code/handoff 120–122. M5-22-054 их не содержит; **новый ZIP не заказан**. Ручные browser/portable, пиксельная приёмка браузера/шрифтов и исходный жгут не проверялись. Owner acceptance открыта; чат не архивируется.
