# Handoff 126 / REQ-161 — завершение плана

Чат 01a14521-6a96-7152-b095-accc21abdda7, `/root`, основная codex/integration-m5-22. [Карточка](../../tasks/126-finish-editor-refactor.md), [протокол](../editor-refactor-126.md), [ADR-0031](../decisions/0031-editor-refactor-completion.md). Общая задача **in-progress**; owner acceptance открыта. ZIP не заказан.

## Этап 1 — CanvasViewport, ready-for-review

- База `303df08ead6530b5c78469995adb877f2e79f6d7`.
- Code SHA **`d378d741af0d8cf4407cb13e48a03862009cffc9`**, опубликован прямо в integration, ancestry PASS; push 303df08..d378d74.
- Фасад 2463 → 61 строка; геометрия выделения/оси, renderer, types/helpers, controller и JSX разделены. Порядок hooks, тела обработчиков и JSX сохранены; публичный API прежний.
- Baseline/профиль 10/162 PASS, 46 исходных объявлений и controller/JSX совпали, 22 snapshots неизменны. Полный Vitest 215/2313 PASS, 78,70 с; TypeScript/Vite PASS, Vite 1,66 с; diff-check/review/новые ссылки PASS.
- Новые зависимости приложения отсутствуют, package/lockfile прежние. Временный AST-инструмент/логи ignored.
- Ручной browser/portable и исходный жгут не проверены; сервер/форматы не менялись, .NET не запускался.

Документальный handoff этапа — коммит этой записи. Этапы 2–7 (остальные крупные модули, загрузка и итоговый аудит) **открыты**; этот handoff не является завершением полного плана. Следующий заказанный ZIP должен проверять включение каждого code/docs SHA; M5-22-054 их не содержит.

## Этап 2 — HarnessDesignEditor, ready-for-review

База ef17141; code **709aacce336a96e88c5faa1d21aa5e9db96deacd** опубликован прямо в integration, ancestry PASS. Фасад 2653 → 8 строк; сцена/снимки/каталоги/выделение/types/boundary/controller/JSX разделены. 33 объявления и основной JSX совпадают с исходником, controller изменён только передачей раннего return через ready-discriminator. Baseline 6/193, профиль с facade-тестом 7/194, полный Vitest **216/2314 PASS**, 79,70 с; TypeScript/Vite PASS, Vite 1,23 с; структурная сверка/эталоны/diff-check/review PASS. Source-тест трассировки читает controller + surface с прежними утверждениями.

Документальный handoff этапа — коммит этого раздела. Этапы 3–7 открыты; ограничения ручной приёмки/сервера/ZIP прежние. Нужны code/docs обоих этапов в следующем заказанном релизе; общий план остаётся in-progress.

## Этап 3 — команды, ready-for-review

База 512d31b; code **ced0a52bd9c534f4c20b0bca99a1b5041e18933d** опубликован в integration, ancestry PASS. Фасад 2897 → 5 строк, 75 ветвей в шести typed handlers; 86 объявлений, pipeline и все ветви совпали с исходником. Новые runtime-модули ацикличны. Baseline 6/136, профиль с API-тестом 7/137, полный Vitest **217/2315 PASS**, 78,75 с; TypeScript/Vite PASS, Vite 1,25 с; эталоны/diff-check/review PASS. Docs handoff — коммит этого раздела. Этапы 4–7 открыты; ограничения прежние.

## Этап 4 — модель, ready-for-review

База 83d312f; code **1205eeb7e13589e4a422cfa4beedd6708be26560** опубликован в integration, ancestry PASS. Фасад 2211 → 9 строк, контракты/defaults/geometry/presentation/measurements и parser-слои разделены. 152 объявления и все 40 runtime-экспортов сохранены; pure type contracts и acyclic runtime graph PASS. Baseline 5/153, профиль 6/154, полный Vitest **218/2316 PASS**, 81,44 с; TypeScript/Vite PASS, Vite 1,27 с; эталоны/diff-check/review PASS. Docs handoff — коммит этого раздела. Этапы 5–7 открыты; ограничения прежние.
