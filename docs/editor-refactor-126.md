# Завершение рефакторинга — карточка 126

REQ-161, исходный запрос владельца: продолжить и закончить план. База `303df08ead6530b5c78469995adb877f2e79f6d7`, чистая основная codex/integration-m5-22. [Карточка](../tasks/126-finish-editor-refactor.md), [ADR-0031](decisions/0031-editor-refactor-completion.md). Общая работа in-progress, готовые этапы публикуются отдельно. ZIP не заказан.

## Этап 1: CanvasViewport

Фасад сохраняет прежние публичные функции/типы и занимает **61 строку** вместо 2463 (4395 до начала серии 121–126). Самостоятельные модули: CanvasViewportSurface **137**, useCanvasViewport **1225**, canvas-selection **120**, canvas-scene-renderer **650**, canvas-viewport-types **184**, canvas-interaction-helpers **73** строки. Ранее выделенные geometry/bounds/renderers сохраняются. Крупный controller содержит только координацию состояния/событий; геометрия и рисование отделены.

Surface вызывает useCanvasViewport, деструктурирует 68 используемых представлением значений и возвращает прежний JSX. Имена, порядок/инициализаторы hooks, event handlers и cleanup скопированы без изменения. Дополнительная React/DOM-граница не добавляется. Приватные функции экспортируются между внутренними модулями только при необходимости, фасад их не раскрывает.

### Проверки

- До переноса профиль Canvas: **10 файлов / 162 теста PASS**, 5,52 с; после переноса **10/162 PASS**, 9,82 с.
- Автоматическая AST-сверка: **46 объявлений** совпали с исходными после нормализации export/EOL; префикс controller до return (включая hooks и обработчики) и весь return JSX совпали с исходником. Проверка новых зависимостей/приватности PASS.
- Все четыре canvas snapshot-файла (**22 эталона**) побайтово совпали с baseline; snapshots не обновлялись.
- Добавлен один тест совместимости фасада: идентичность renderer/selection/interaction/компонента и отсутствие внутренних helpers/hook в API.
- Полный клиентский Vitest: **215 файлов / 2313 тестов PASS**, 78,70 с. TypeScript PASS; Vite production build PASS, 1,66 с, прежнее предупреждение размера основного chunk сохраняется.
- Полный набор запускался из src/Techmap.Client, один worker, TEMP/TMP в ignored tmp/refactor-126/temp. Прямой запуск Node CLI эквивалентен package scripts. Первый прогон из корня с --root дал три ENOENT из тестов, привязанных к process.cwd; повтор из штатного каталога прошёл без изменений тестов/кода.
- Для точного переноса использован временный TypeScript compiler API 5.9.3; проект использует прежний TypeScript 7.0.2. Временный importer удалён из lockfile, pnpm install --frozen-lockfile --ignore-scripts восстановил исходный набор зависимостей. В Git изменения package/lockfile и tmp не входят.

Ручной браузер, portable и исходный жгут не проверялись; сервер/форматы не менялись, .NET не запускался. Остальные этапы карточки открыты. Измеренное ускорение UI не заявляется.

## Этап 2: HarnessDesignEditor

Главный путь стал фасадом из **8 строк** вместо 2653. Выделены harness-scene-projection **233**, harness-component-snapshots **185**, harness-catalog-adapters **138**, harness-selection-adapters **61**, harness-editor-types **51**, HarnessEditorBoundary **50**, useHarnessDesignEditor **1232** и HarnessDesignEditorSurface **701** строка.

Сверка подтверждает **33** исходных объявления без изменения. Основной JSX сохранён целиком. Hook содержит прежнее состояние/эффекты/обработчики; единственный ранний return загрузки передаёт тот же JSX через discriminated union ready=false, представление сразу возвращает его. Основной return передаёт 138 типизированных через inference значений. Порядок/условия hooks и cleanup сохранены. Новых UI-обёрток нет.

- Baseline до переноса: **6 файлов / 193 теста PASS**, 16,62 с. После переноса с новым facade-тестом: **7/194 PASS**, 17,14 с.
- Тест запрета преждевременной трассировки читает два новых файла (controller + surface), сохраняя все прежние утверждения. Первоначальный повтор с одним controller-файлом упал на поиске JSX-handler; путь обновлён, production-алгоритмы не менялись.
- Полный Vitest **216 файлов / 2314 тестов PASS**, 79,70 с. TypeScript/Vite PASS, Vite 1,23 с; прежнее предупреждение размера chunk сохраняется.
- AST-сверка объявлений/контроллера/JSX, отсутствие обратных facade-импортов, прежние canvas-эталоны, diff-check/review и новые ссылки PASS. Временные evidence в ignored tmp/refactor-126.

Этапы commands/model/ComponentLibrary, загрузка и итоговый аудит остаются открыты.

## Этап 3: команды

commands.ts становится фасадом. 75 ветвей applyCommand разделены на commands-physical (14), commands-connectors (17), commands-wires (20), commands-e4 (10), commands-groups (11), commands-layers (3). Каждый handler принимает Extract<EditorCommand, {type: ...}>; общий dispatcher сохраняет исходные теги и вызывает ровно один handler. Прежний pipeline applyEditorCommand, включая termination bypass, snapshot общих свойств, physical route/topology, размеры, drawing documents и writer contract, скопирован без изменения.

Отдельные модули: editor-command-types **87**, factories **78**, dispatcher **113**, invariants **591**, command-e4-routing **518**, analysis **249**, pair-planner **131** строка. Размеры handlers: 142/415/323/175/170/23 строки соответственно группам выше. Новые внутренние helpers не раскрываются фасадом.

- AST-сверка: **86 объявлений**, все **75 исходных case-блоков**, точный pipeline и сгенерированный dispatcher PASS. После удаления type-only imports граф новых runtime-модулей ацикличен, обратных импортов commands-фасада нет.
- Baseline **6 файлов / 136 тестов PASS**, 16,56 с. После переноса с новым тестом полного публичного API: **7/137 PASS**, 14,26 с. Первоначальный facade-тест сравнивал namespace с plain object; сравнение исправлено на spread namespace, без изменения production-кода.
- Полный Vitest **217 файлов / 2315 тестов PASS**, 78,75 с; TypeScript/Vite PASS, Vite 1,25 с. Прежнее предупреждение размера chunk сохраняется. commands.ts **2897 → 5 строк** фасада. Прежние 22 canvas-эталона, diff-check/review и новые ссылки PASS.

Этапы 4–7 остаются открыты.

## Этап 4: модель документа

model.ts **2211 → 9 строк** фасада. Выделены design-types **376**, connector-presentation **220**, wire-measurements **170**, design-defaults **36**, design-document-parser **293**, design-e4-geometry **260**, design-connector-parser **467**, design-parse-primitives **60**, design-wire-parser **221** строка.

Все **152 объявления** совпали с исходными после нормализации export/EOL. Контракты компилируются в пустой export: в них нет runtime-импортов. Внутренний граф runtime-модулей ацикличен, обратных импортов model-фасада нет. Проверка API закрепляет все **40** исходных runtime-экспортов и отсутствие дополнительных unchecked parser helpers в фасаде. Схема, writer contract, ошибки/порядок нормализации, числовые пределы и единицы измерения не менялись.

- Baseline: **5 файлов / 153 теста PASS**, 13,47 с (cable-model, e4-documents, component-template-placement, commands, termination-routing).
- После переноса с новым API-тестом: **6/154 PASS**, 14,16 с.
- Полный Vitest **218 файлов / 2316 тестов PASS**, 81,44 с. TypeScript/Vite PASS, Vite 1,27 с; прежнее предупреждение размера chunk сохраняется.
- AST/зависимости, прежние эталоны, diff-check/review и ссылки PASS. Временный инструмент/логи ignored.

Этапы 5–7 остаются открыты.

## Этап 5: ComponentLibrary

ComponentLibrary.tsx **1600 → 6 строк** фасада. Выделены library-editor-types **13**, library-draft-adapters **159**, library-node-editing **68**, library-catalog-adapters **106**, LibraryEditorProperties **93**, useComponentLibrary **854** и ComponentLibrarySurface **289** строк.

Все **45 объявлений**, префикс controller (с hooks/обработчиками) и исходный JSX совпали с базой. Между hook и surface передаются 136 значений с выведенными типами; DOM/React-обёртка не добавляется. CSS по-прежнему подключается после зависимостей представления: проверяется последним import. Public API-тест закрепляет все **22** прежних runtime-экспорта. Внутренний runtime-граф ацикличен, обратных facade-импортов нет.

- Baseline **6 файлов / 42 теста PASS**, 6,80 с; после переноса с API-тестом **7/43 PASS**, 7,12 с. Профиль включает component-library, canvas-integration, drawing-size-fields, library-draft-recovery, series-authoring и TemplateSeriesPanelV3.
- Полный Vitest **219 файлов / 2317 тестов PASS**, 101,36 с. TypeScript/Vite PASS, Vite 1,28 с; прежнее предупреждение размера chunk сохраняется.
- AST/JSX/hooks/CSS/зависимости, прежние эталоны, diff-check/review и ссылки PASS. Recovery, autosave, undo, работа с каталогами и рисунками не переписывались.

Этапы 6–7 остаются открыты.

## Этапы 6–7: загрузка и итоговая проверка

App открывает редактор жгута и Маршрут v3 через createLazyWorkspace и отдельные dynamic imports. Успешный React.lazy разделяется между экземплярами; повтор после отказа создаёт новый lazy instance. Suspense показывает status, WorkspaceLoadBoundary — alert с повтором. Props и callbacks navigation guard передаются без подмены. RouteAssemblyDrawing/RouteV3 используют те же чистые projection/snapshot/render функции напрямую, без статического импорта UI-фасада. Уже существующая lazy-загрузка библиотек сохранена.

- Baseline navigation/guards: **3 файла / 14 тестов PASS**, 4,40 с. Итоговый профиль с двумя новыми SSR/retry-тестами и жизненным циклом копий: **5/17 PASS**, 3,27 с.
- Первый полный повтор выявил source selector старого синхронного компонента в route-drawing-lifecycle. Селектор переведён на lazy boundary; все проверки несохранённых копий сохранены и усилены проверками type/key при правке и смене режима. Изменений бизнес-логики ради теста нет.
- После форматирования длинных import/export списков в 35 файлах AST-сверка подтвердила неизменность всех остальных объявлений. Размеры фасадов теперь CanvasViewport **90**, HarnessDesignEditor **25**, commands **4**, model **90**, ComponentLibrary **29** строк. Исторические размеры выше относятся к опубликованным этапам до форматирования.
- Итоговый полный Vitest **220 файлов / 2319 тестов PASS**, **99,43 с**. TypeScript/Vite PASS, Vite **1,17 с**. Семь новых тестов: пять facade contracts и два функциональных SSR/lazy/retry.
- Повторные проверки: **362 исходных объявления**, **75 case-блоков**, исходный pipeline, controller prefixes/hooks, основной JSX, CSS precedence и **22 неизменных canvas-эталона** PASS.
- Итоговый static runtime-граф **54 модулей**, включая новые модули, публичные фасады и интеграционные потребители, ацикличен. Все **140 runtime-имён и 76 явных type-only экспортов** пяти фасадов совпали с исходными наборами. Это аудит затронутого графа, а не заявление об отсутствии любых исторических циклов во всём репозитории.

### Измерение сборки

Исходный код **7c68d3447557d73a1d941ce9c299e53efc437559** собран отдельно через git archive в ignored tmp, с теми же зависимостями/config и без переключения рабочей ветки. В HTML найдены entry script и modulepreload; по AST собран весь транзитивный static JS closure. Dynamic imports в начальную загрузку не включаются. Сравниваются JS-байты, не время запуска и не CSS/изображения.

| Показатель | До lazy-разделения | После |
| --- | ---: | ---: |
| Начальный JS со всеми static/preload chunks | 1 701 779 байт | 893 229 байт |
| Сумма gzip каждого начального JS (Node zlib, одинаковые параметры) | 479 181 байт | 254 868 байт |
| Главный entry JS | 1 693 357 байт | 368 227 байт |

Начальный JS уменьшился на **47,512%**. Общий model chunk **516 580 байт** включён в правую сумму: сравнение не скрывает вынесенный shared-код. Editor **332 005**, RouteV3 **98 051**, ComponentLibrary **211 562** байта загружаются отдельно и не входят в initial closure. Библиотека была отдельной и до этого этапа. Предупреждение Vite >500 kB остаётся для shared model chunk; план не ставил условием устранение всех предупреждений. После форматирования результаты сборки и SHA chunk-файлов совпали с первым lazy-build.

### Приёмка и ограничения

Технические этапы 1–7 проверены; публикация последнего среза и финальный handoff следуют после фиксации кода. [Матрица итогового аудита](editor-refactor-126-completion-audit.md). Runtime/package dependencies, lockfile, сервер, схема документа, VERSION и ZIP не менялись. AST-инструмент и baseline archive находятся в ignored tmp.

Ручная browser/portable-приёмка, реальные пиксели/шрифты, исходный жгут и замер времени запуска не выполнялись. SSR использует настоящие lazy/Suspense и управляемые hooks для rerender; error boundary проверяется также напрямую. Это ограничения доказательства, а не незавершённые пункты технического плана. Owner acceptance остаётся отдельной.
