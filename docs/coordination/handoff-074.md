# Handoff: карточка 074 — поправки L+/L− от подключённых терминалов

Статус: `ready-for-review`
Репозиторий: `C:\Users\anqla\OneDrive\Документы\ChatGPT\HARNESSTECHMAPGRAPHER\TECHMAP-GRAPHER`
Ветка: `codex/restore-20260918-0235`
Worktree: `C:\Users\anqla\OneDrive\Документы\ChatGPT\HARNESSTECHMAPGRAPHER\TECHMAP-GRAPHER`

## Коммит реализации

`7217377` — `feat(editor): apply terminal L corrections to wire ends`

## Изменения

- `terminal-details.ts` и `model.ts` — чтение L+/L− из БД.ТЕР, знаковая нормализация и snapshot в контакте.
- `ObjectInspector.tsx`, `HarnessEditorWorkspace.tsx`, `HarnessDesignEditor.tsx` — две кнопки для каждого конца, штатная L+ при новом соединении и повторная L+ при переподключении; ручное поле остаётся редактируемым.
- Тесты документации/маршрута — подтверждают формулу `размер + поправка начала + поправка конца` для спецификации и схемы; карта резки использует тот же канонический расчёт.
- `tasks/074-terminal-length-corrections.md`, `docs/requirements.md`, `tasks/README.md` — карточка и REQ-105.

## Проверки

- `pnpm --filter @techmap/client typecheck` — PASS.
- `pnpm --filter @techmap/client build` — PASS.
- `pnpm --filter @techmap/client test src/editor/terminal-details.test.ts src/editor/ObjectInspector.test.ts src/editor/drawing-documents.test.ts src/manufacturing/route-source.test.ts src/editor/cut-diagram.test.ts` — PASS, 5 файлов, 73/73 теста.
- `git diff --cached --check` перед коммитом — PASS.

## Ограничения и порядок интеграции

- Сначала применить `7217377`, затем документальный коммит, содержащий этот handoff.
- Ручной интерактивный проход в браузере и полный `pnpm test` не выполнялись: в исходной общей рабочей копии были независимые незакоммиченные изменения.
