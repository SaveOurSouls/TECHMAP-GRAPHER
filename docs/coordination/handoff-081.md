# Handoff: карточка 081 — транзит X4 и выходы из защитной оболочки

Статус: `ready-for-review`

- **Репозиторий:** `git@github.com:SaveOurSouls/TECHMAP-GRAPHER.git`
- **Ветка:** `codex/pipe-junction-cover-exits`
- **Worktree:** `C:\Users\Василий Костромин\.codex\worktrees\pipe-junction-cover-exits\Утилита для картинок`
- **Кодовый коммит:** `fdc5c7c7e1121d91f21f7a0ffb1c8e06ebc4d534`
- **Документальный коммит:** `ebcf790be27d7ae8701b7aed86bb952c3a1db2b0`

## Изменённые файлы

- `src/Techmap.Client/src/editor/physical-wire-routing.ts` — пропускает автоматический маршрут через соединитель только для явно назначенного транзитного провода.
- `src/Techmap.Client/src/editor/physical-topology-model.ts`, `physical-topology-validation.ts`, `PhysicalTopologyPanel.tsx` — сохраняемое и валидируемое назначение «Транзит через этот выход».
- `src/Techmap.Client/src/editor/physical-wire-geometry.ts` — продлевает видимый провод через нейлоновую, термоусадочную, плетёную и металлическую оболочку, вынесенную за торец пайпа.
- `physical-topology.test.ts`, `physical-wire-joins.test.ts` — регрессии X4 и нейлонки.
- `tasks/081-connector-transit-and-covering-exits.md`, `docs/requirements.md`, `tasks/README.md`, `chat-registry.md` — границы, REQ-111 и регистрация чата.

## Проверки

- `pnpm --filter @techmap/client test -- physical-topology.test.ts physical-wire-joins.test.ts physical-layer-boundaries.test.ts` — PASS: 183 файлов / 1792 теста.
- `pnpm client:typecheck` — PASS.
- `pnpm client:build` — PASS (известное предупреждение Vite о размере chunk и browser-externalized модулях `heic-to`).
- `git diff --check` — PASS.

## Ограничения и передача

- Неявный транзит через чужой соединитель остаётся запрещённым: для X4 оператор отмечает нужный провод в свойствах выхода. Электрические связи, авторские маршруты, производственные длины и геометрия/обтягивание оболочки не меняются.
- C1–C5 на исходном жгуте и packaged-приложении не проверены; это ручная приёмка после интеграции.
- **Статус handoff:** передан сборщику; для включения в ZIP требуется подтвердить ancestry/эквивалент относительно integration HEAD и записать результат в release coverage.
