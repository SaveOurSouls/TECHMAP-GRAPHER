# Handoff 119 / REQ-154 — удаление Маршрута, V2 и UML

- Дата: 16.10.2026 (МСК).
- Чат: `01a144bf-a0ea-7e42-b8af-b3e4f3cd7711`, исполнители `/root/navigation`, `/root/shared`, `/root/uml`, интегратор `/root`.
- Ветка/worktree: `codex/remove-legacy-route-pages-work`, `tmp/remove-legacy-route-pages`.
- База: `f47d55e9078fc792cf30500592711f35b72b4000`.
- Регистрация: `d24fd4c77b5647a48a45838ce222c4f79f6816ff`.
- Код: **`8587eb55b3e2366fffe1cb6026b10ff766a8b7b2`**, опубликован в разрешённый `origin`.
- Документальный handoff: коммит, содержащий этот файл; точный SHA в итоговом сообщении.
- Статус: ready-for-review; owner acceptance и интеграция координатором открыты. ZIP не заказан.

## Что изменено

Убраны «Маршрут», «Маршрут v2» и, по дополнительному прямому поручению, отдельная UML-схема. В App и общем редакторе доступны Э4, Чертёж и Маршрут v3. Карточка жгута: 3 колонки desktop / 1 колонка mobile. Удалены входы, иконки и пустые места старых страниц. Неизвестная вкладка, включая старые ID, восстанавливается в Э4; переход редактора в маршрут ведёт в V3 с существующим сохранением.

Удалены `manufacturing-v2/**`, `uml/**`, `RouteDrawingsPanel.tsx`, `ManufacturingRoutePanel.tsx`, `RouteOperationChooser.tsx`, `RoutePhotoList.tsx`, `manufacturing-route.css`, исключительно старые `route-commands`, `route-workspace`, `route-rebase`, `route-order`, `route-wire-blank`, `route-terminal-requirements` и их исключительные тесты, inline UI-тест. Подтверждённые общие artwork-тесты перенесены, fixture QA больше не использует удалённый генератор.

Выделены `manufacturing/RouteSourceArtwork.tsx`, `route-card-drawing.ts`, `route-card.css`; потребители и namespace V3 обновлены. `RouteV3Operation` содержит прежние базовые поля непосредственно, без зависимости от UML. Изменений норм, валидатора и вычислений нет.

## Оставшиеся legacy-совпадения

- `manufacturingRoute`, `RouteRow`, `RouteTerminalRequirement`, `wireBlankSelections`: действующий совместимый parser и серверный контракт старых проектов, рисунков, карты резки. Тип terminal requirement перенесён дословно в route-model.
- `route-source`, `route-drawing-copy`, `RouteAssemblyDrawing`, `route-covering-artwork`, `cut-list-properties`, `route-cut-readiness`, `wire-display-formatters`: реально используются V3/редактором/картой резки, сохранены с тестами.
- `project-api` продолжает принимать server document kind `route`, чтобы читать существующий комплект документов. Это не UI ID и не вход на старую страницу.
- `route` в геометрии проводов, Э4 и рисунках библиотечных компонентов — предметные маршруты/назначения, а не удалённая страница.
- Упоминания V1/V2/UML в исходниках остались только в отрицательных тестах и проверке восстановления старых ID. В runtime `src`/`scripts` нет импортов `manufacturing-v2`, `uml-model`, `UmlPanel`, `ManufacturingRoutePanel` и удалённых команд.
- Исторические требования, ADR и handoff сохраняются как история. Текущее поведение описано в architecture и [протоколе](../legacy-route-retirement-119.md).

Данные localStorage V2/UML не читаются и не удаляются. Существующие проекты/операции/рисунки V3 сохраняют формат; электрические связи, трассы и длины не меняются.

## Доказательства

- Полный Vitest после последнего пользовательского уточнения: **206 файлов / 2223 теста PASS**.
- Профиль: навигация **52/52**, V3 **80/80**; общие manufacturing/V3 до последнего удаления UML **20/141 PASS**.
- TypeScript `tsc --noEmit` и Vite production build PASS. Для Vitest использованы threads/1 worker/local TEMP: sandbox forks терял SSR cache.
- Chrome headless **1440×1000 / 390×844**: проект/три кнопки/все переходы/настройки карточек/графический редактор/возврат к проектам PASS. Ошибок страницы 0, mutation-запросов 0; legacy caches сохранены. Скриншоты визуально проверены; общая страница без горизонтального переполнения.
- Независимое read-only ревью shared и итогового удаления UML: существенных проблем не обнаружено.
- Diff/staged-check PASS; Git-коммит содержит только эту карточку и её документацию. Незавершённая 117 в основную копию не переписывалась и в ветку не переносилась.

QA fixtures и скриншоты вне Git: `src/Techmap.Client/tmp/qa119/`. Build имеет прежние предупреждения большого bundle и browser-externalized Node builtins в heic decoder; сборка успешна.

## Интеграция и ограничения

Сборщику: включить регистрацию, code SHA и документальный handoff; подтвердить ancestry либо точный эквивалент в integration HEAD, обновить coverage. В `RouteV3Panel.tsx` / `route-v3-model.ts` чистой ветки изменены только необходимые импорты/имя общего типа/CSS-класс; при интеграции с активной 117 сохранить её бизнес-код и применить эти точечные hunks. RouteV3Operation не меняет persisted shape.

Интеграция пока не заявлена. .NET не запускался: сервер не менялся. Серверный gate карты резки остаётся прежним; отдельная миграция production readiness в V3 не входит в задачу. Исходный жгут, ручная packaged UI-приёмка и owner acceptance открыты. Последний ZIP не содержит этот срез; новый ZIP не собирался.
