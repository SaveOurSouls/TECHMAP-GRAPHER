# Handoff 112 — точки изгиба после создания ОП

## Follow-up C1–C4, 15.10.2026 — ready-for-review

Рабочий чат/ветка/worktree прежние. База `96829c0bf2d16606e67c3d2b59ce0a306d52e2e6` (первый срез уже в M5-22-052), регистрация follow-up `1170ee6`. Новый код **`dc817dea78d89410e04a89b86ef1489209dbaaea`** опубликован в `origin/codex/op-bend-coordinate-integrity`. Следующий docs-only handoff-коммит передаётся сборщику вместе с этим SHA. Предыдущие SHA ниже — история, а не coverage нового follow-up.

C1–C4: удлиняемая общая прямая ОП пересекала старую внешнюю опору перехода, и провод возвращался к ней, образуя петлю. В `physical-joining-pipe-projection.ts` опора теперь ограничена новой торцевой плоскостью прямой и следует за ней с сохранением поперечного смещения. Действует для обоих торцов, reverse и сохранённых внешних станций. Срединные ручки/оболочка используют ту же перестроенную геометрию. Авторские `enterBend`/`exitBend` не удаляются и не подменяются; документ, электрические ID/связи и заданные длины не меняются.

Production-правка — только `physical-joining-pipe-projection.ts`; новые шесть регрессий в `op-exit-support-regression.test.ts`, уточнения проверок координат в `op-midpoint-video.test.ts`. Commands/CanvasViewport/Э4 (115), artwork (113), dimensions (114) не затронуты. Формат документа и сервер не менялись.

PASS: полный Vitest **216 файлов / 2285 тестов** (85.95 с), финальный exit-support + midpoint **2 файла / 29 тестов** (5.32 с), TypeScript, Vite production build и diff/staged/show-check. Проверены перемещения вперёд/назад 100→180→220→260→220→180→100, оба торца, reverse, старые сохранённые опоры, повороты 0/45/90/180°, отсутствие обратного хода исходной и скруглённой линий, движение срединной ручки по видимому маршруту, отсутствие накопления ошибки, reload/Undo/Redo и неизменность связей/длин. Production-код после полного прогона не менялся.

[Протокол follow-up](../op-exit-support-112-acceptance.md) содержит команды и результаты. PNG/SVG до/после из фактической проекции просмотрены (`src/Techmap.Client/artifacts/exit-support-before-after.*`, вне Git); это синтетическая статическая сверка, не screenshot packaged UI и не исходный жгут владельца. Ручная C1–C4/packaged UI-приёмка и owner acceptance открыты. Vite — известные externalized fs/path/crypto и chunk >500 kB. Тестовые зависимости — локальная junction к исправному существующему node_modules 113; её целевой каталог не изменялся. .NET не запускался: серверная модель не менялась.

ZIP не заказан и не собирался. M5-22-052 не содержит новый код. Сборщику следует включить registration/code/docs-only handoff SHA в следующий заказанный срез, подтвердить ancestry/equivalent, сверить другие handoff 113/115 и обновить общие registry/coverage/status. Основная рабочая копия в этом follow-up не менялась; изменены только собственные записи координационных файлов в выделенной ветке. Worktree после документального коммита должен быть чистым.

## Первый срез — включён в M5-22-052

- **Статус:** ready-for-review, 15.10.2026; приёмка владельца открыта.
- **Чат:** `01a1410d-5bc6-7123-9e7a-f5b7b5dfef9a`.
- **Карточка / требование:** [112](../../tasks/112-op-bend-coordinate-integrity.md), REQ-147; ADR-0004/0011.
- **Ветка:** `codex/op-bend-coordinate-integrity`, `origin` — `git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git`.
- **Worktree:** `tmp/op-bend-coordinate-integrity`; основная копия после передачи координатором не редактировалась.
- **Регистрация:** `bbeeb3c15e6d59c1b3e45fce04d1efa279be348c`; изоляция/владение уточнены `034bf42154a6ed9a15841a010f1242b865e3a120`, затем docs-only `1f2639f`.
- **Проверенный код:** `4d56e4058b1a8e9ba0034f812b7ac3699604bf63`, опубликован. Следующий docs-only handoff-коммит следует за ним; SHA передаётся в итоговом сообщении.
- **Назначение:** следующий кодовый срез после M5-22-051; ZIP не заказан. До подтверждения ancestry/equivalent интеграция pending.

## Исправление

C1 показывает ручку далеко от линии и повторные локальные номера. Старый поиск ближайшей точки начинался с самой исходной точки: нулевое расстояние никогда не позволяло выбрать точку скруглённой линии. У ОП ручки вообще брались с острого control polygon. Все физические ручки теперь проецируются на фактически нарисованный sampled contour. Sharp display origins хранятся только в scene DTO и используются для преобразования pointer delta; источники геометрии/производственные длины не заменяются экранными координатами.

ОП-preview и commit вызывают один resolver, click без сдвига не создаёт команду. Угловые привязки перенесены в систему координат экранной ручки. Автоматические внешние станции остаются опорами пути/midpoint-вставки, но не нумеруются как отдельные неудаляемые изгибы. Сброс явной внешней станции возвращает её в это служебное состояние и сохраняется после reload. Reverse-член берёт внешние плечи из своего исходного направления; прежде они брались с противоположных концов, вызывая петли.

Номера остаются локальными для каждого П/ОП. Две «1» на разных объектах — не дублирование ID. Префиксы/глобальная нумерация не реализовывались, CanvasViewport принадлежит 113. Если владелец ожидает глобальную нумерацию, это отдельное уточнение, а не подтверждённый результат этого среза.

## Точные файлы

Production: `physical-scene.ts`, `physical-joining-pipe-projection.ts`, `physical-route-point-command.ts`, `physical-editing.ts`; добавлено только необязательное `handleOrigins` в `editor-types.ts` и одна строка маршрутизации OP commit в `HarnessDesignEditor.tsx`. Расширение двух незакреплённых за 113 файлов обосновано в карточке. `CanvasViewport.tsx`, `termination-scene.ts`, drawing-dimensions/114 не менялись.

Tests: новые `op-bend-coordinate-integrity.test.ts` (10), `op-bend-canvas-gesture.test.ts` (4), актуализация `op-midpoint-video`, `physical-joining-pipe`, `physical-scene`, `physical-topology`, `pipe-editing`. Старые тесты, проверявшие попадание по скрытым острым вершинам, теперь различают sharp origins и painted grips. Проверки углов/длин/соединений сохранены.

## Проверки

Команды из `src/Techmap.Client` с Node.js 24.21.0; `TEMP` и `TMP` — абсолютный путь локального `artifacts/test-temp` (игнорируется):

```powershell
node node_modules/vitest/vitest.mjs run --maxWorkers=1
# PASS: 212 файлов / 2233 теста, 88.35 с; full-client-final.log
node node_modules/vitest/vitest.mjs run src/editor/op-bend-canvas-gesture.test.ts --maxWorkers=1
# PASS: 1 файл / 4 теста, 2.26 с; добавлен после старта полного прогона
node node_modules/typescript/bin/tsc --noEmit
# PASS после добавления gesture-тестов
node node_modules/vite/bin/vite.js build
# PASS: production код тот же, итоговые изменения после build — только тесты/комментарии/docs
git diff --check
git diff --cached --check
git show --check 4d56e4058b1a8e9ba0034f812b7ac3699604bf63
# PASS
```

Итого на одном production-срезе: 213 файлов / 2237 тестов. Фактические Canvas handlers проверены без браузера: pointer capture, перемещение при zoom 0,6/2 и radius 24/160, совпадение preview/commit, двойной щелчок на видимой ручке. Дополнительно проверены reload, Undo/Redo, удаление, прямое/обратное направление, автоматические/авторские точки, wire IDs, маршруты, длины проводов и оболочки. Новых серверных полей/валидаторов нет; .NET для этой карточки не запускался.

## Ограничения и интеграция

Исходный пользовательский документ не приложен. Browser Use: Chrome unavailable; IAB не подключился к локальному Vite (`net::ERR_CONNECTION_TIMED_OUT`). Диагностический сервер остановлен. Скриншотное/packaged/manual QA не объявлено выполненным. Vite: известные externalized fs/path/crypto от heic-to и chunk >500 kB. Вне Git: зависимости/junction, dist, test TEMP, логи, диагностическая HTML-сцена. Локальный worktree после handoff должен быть чистым.

В основной копии остался ранний untracked-черновик `src/Techmap.Client/src/editor/op-bend-coordinate-integrity.test.ts`, SHA-256 `F314D115C03C78BE62E9F20F9D13406C48B02A38690F7ABBD2C155A5DC1931CF`, созданный до команды координатора остановиться и скопированный им в worktree. Его завершённая версия входит в code SHA выше. Рабочий чат не удаляет файл из общей копии; координатор может убрать именно этот устаревший черновик после сверки хеша, не добавляя его в integration-коммит.

Сборщик: включить code и docs-only handoff SHA, подтвердить ancestry/equivalent и совместный regression с 113/114, обновить registry/coverage/status. Не считать M5-22-051 исправленным и не собирать ZIP до закрытия относящихся к срезу handoff. Новая нумерация/правки Canvas не входят в этот commit.
