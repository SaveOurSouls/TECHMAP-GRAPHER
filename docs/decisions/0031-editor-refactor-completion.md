# ADR-0031: завершение декомпозиции редакторов

- Статус: реализовано, проверено и опубликовано; ready-for-review, owner acceptance отдельно. Финальный code 45f75bb521e9a813b8053182239ad4a315ef505a.
- Источник: исходный запрос REQ-161, [карточка 126](../../tasks/126-finish-editor-refactor.md).
- Основание: оценка 120, ADR-0003/0025–0030.

## Решение

Пять крупных модулей из оценки разделяются по ответственностям, сохраняя прежние публичные пути импорта. Фасады переэкспортируют прежний API; внутренние вспомогательные функции не становятся частью публичного API фасада. Выделение механическое, с проверкой исходных тел и существующих регрессий. Изменения хранения, схемы и продуктовых правил не смешиваются с переносом.

CanvasViewport разделён на canvas-selection (геометрия рамки/выравнивание свободных концов), canvas-viewport-types (props и типы drag), canvas-interaction-helpers (wheel/inline/snap), canvas-scene-renderer (рисование), useCanvasViewport (состояние и события) и CanvasViewportSurface (JSX). Surface вызывает hook и возвращает прежнее дерево напрямую; дополнительная React-граница/DOM-обёртка не появляется. Hook возвращает типизированные через inference значения представлению, сохраняя порядок hooks, замыкания, события и cleanup. Renderer сохраняет прежний доступ к Canvas и devicePixelRatio; geometry не получает зависимость на React.

Выполненные этапы отделяют документ/снимки/каталоги HarnessDesignEditor, группы команд, модель/парсеры и модули ComponentLibrary. Конкретные границы проверены перед каждым переносом; итоговый затронутый runtime-граф, включая фасады, ацикличен. Загрузка рабочих областей проверена последним техническим этапом.

Этап HarnessDesignEditor реализован: projection, snapshots, catalog/selection adapters, types, error boundary, controller hook и JSX surface. Для единственного раннего return используется ready-discriminator, позволяющий surface вернуть прежнюю загрузочную разметку; порядок hooks и основной JSX не меняются. Фасад сохраняет API и приватность внутренних helpers.

Команды разделены на шесть handlers по discriminant type. Ветви скопированы, Extract сохраняет точное сужение типов внутри каждой группы. Общий entry point и его последовательность нормализации остаются прежними; handlers и unchecked helpers не экспортируются публичным фасадом. Расчёты routing request/проверки и pair planner отделены от оркестрации маршрутизации, чтобы не создавать runtime-циклы.

Модель разделена на чистые type-контракты, defaults, presentation/геометрию, manufacturing-расчёты и document/connector/wire parsers с общими примитивами валидации. Все исходные объявления сохраняются; общий parseHarnessDesignDocument вызывает прежние шаги в прежнем порядке. Type-only зависимости контрактов явно отделены от runtime, внутренний runtime-граф ацикличен.

ComponentLibrary разделён на draft/catalog/node-editing adapters, types, property panels, controller hook и JSX surface. Исходные handlers, hooks и JSX скопированы. CSS остаётся завершающим import представления, после зависимостей, чтобы перенос не менял приоритет стилей. Recovery/autosave/navigation guard не перерабатываются.

Редактор жгута и Маршрут v3 подключаются через lazy entrypoints на прежних границах навигации. createLazyWorkspace сохраняет успешный load, предоставляет Suspense status и заменяет отказавший lazy instance при явном повторе. Props/guards передаются без подмены. Чистые функции preview потребителей импортируются из focused modules, чтобы UI-фасад не создавал статическую зависимость. Существующая lazy-загрузка библиотек сохраняется.

## Доказательства

Существующие эталоны остаются замороженными. Проверены наборы экспортов и идентичность реализаций через прежний путь. Все семь пунктов подтверждены [итоговым аудитом](../editor-refactor-126-completion-audit.md), code опубликован, [общий handoff](../coordination/handoff-126-editor-refactor.md) заполнен. [Протокол](../editor-refactor-126.md). Отсутствие ручной приёмки и предупреждение shared chunk явно сохраняются как ограничения.
