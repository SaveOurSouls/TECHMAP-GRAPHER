# Handoff 112 — точки изгиба после создания ОП

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
