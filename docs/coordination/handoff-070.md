# Handoff: карточка 070 — коллизия линий после объединения в ОП

Статус: `ready-for-review`
Репозиторий: `C:\Users\anqla\OneDrive\Документы\ChatGPT\HARNESSTECHMAPGRAPHER\TECHMAP-GRAPHER`
Ветка: `codex/restore-20260918-0235`
Worktree: `C:\Users\anqla\OneDrive\Документы\ChatGPT\HARNESSTECHMAPGRAPHER\TECHMAP-GRAPHER`

## Коммиты

Применять в порядке: `b751572`, `5a6d082`, `51a787c`, `03e3731`, `563061f`.

## Изменённые файлы

- `src/Techmap.Client/src/editor/physical-joining-pipe-projection.ts` — устойчивый порядок lane по инверсиям start/end offset.
- `src/Techmap.Client/src/editor/physical-joining-pipe.test.ts` — регрессия для трёх перемешанных П, оболочки на ОП и JSON round-trip.
- `src/Techmap.Client/src/editor/pipe-bundle-projection.ts` — координаты ОП не проходят unprojection обычного authored П.
- `tasks/070-op-lane-crossing-and-covering-install.md` и `docs/op-lane-070-handoff.md` — карточка и протокол.

## Проверки

- Полный Vitest: 1205 файлов, 11658 тестов — PASS.
- Профильный Vitest — 41/41 — PASS.
- TypeScript `tsc --noEmit` — PASS.
- Vite production build — PASS.
- `git diff --check` для staged срезов — PASS.

## Зависимости и ограничения

- Сначала `b751572`, затем документальные коммиты в указанном порядке.
- Исходный файл жгута и packaged-приложение не приложены; ручная C1-приёмка остаётся за сборщиком.
- Незакоммиченные изменения соседних задач в исходном worktree не входят в handoff.

Прямой вызов отправки в чат «Агент сборщик» (Thread ID `01a0fdf4-7970-7311-9a75-b03f9fd9e4ee`) дважды завершился ошибкой `Transport closed`; этот файл сохраняет полный handoff для повторной отправки.
