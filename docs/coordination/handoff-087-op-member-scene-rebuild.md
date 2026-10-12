Карточка: 087 — Пересборка точек П после добавления ОП
Статус: ready-for-review
Репозиторий: git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git
Ветка: codex/integration-m5-22
Worktree: C:\Users\Василий Костромин\Documents\ChatGPT\Утилита для картинок
Коммит для интеграции: pending (будет указан после коммита)

Изменённые файлы:
- src/Techmap.Client/src/editor/physical-scene.ts: скрывает незафиксированные точки П, совпавшие с осью ОП, сохраняя явные authoredBendRegions.
- src/Techmap.Client/src/editor/physical-joining-pipe.test.ts: регрессия stale handles/midpoints после добавления ОП.
- docs/requirements.md, tasks/087-op-member-scene-rebuild.md, tasks/README.md: REQ-123 и карточка.

Проверки:
- pnpm --dir src\\Techmap.Client test -- --run: PASS (187 файлов / 1829 тестов)
- pnpm --dir src\\Techmap.Client typecheck: PASS
- pnpm --dir src\\Techmap.Client build: PASS
- git diff --check: PASS

Ограничения:
- Ручная проверка C1 на исходном жгуте и packaged Windows UI остаётся открытой.
- Vite сообщает штатные предупреждения externalized fs/path/crypto и chunk >500 kB.

Статус handoff: передан сборщику после публикации commit SHA
Release coverage: следующий ZIP; требуется подтверждение ancestry/equivalent
