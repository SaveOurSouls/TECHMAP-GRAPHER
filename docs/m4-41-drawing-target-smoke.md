# М4-41 — сквозная проверка рисунков по разделам

## Цель

Усилить API smoke для уже реализованных рисунков по разделам: Схема Э4,
Чертёж и Маршрут должны иметь независимые виды, но одну таблицу электрических
контактов. Неполный рисунок должен отклоняться до публикации; очистка одного
раздела не должна скрывать два других.

## Изменение

`scripts/test-library-placement.mjs` теперь автоматически включает базовый
редактор рисунка и независимый Э4 для флагов `--check-drawing-targets` и
`--check-drawing-array`. Smoke создаёт все 12 контактных точек в каждом явном
виде, связывает их с `seriesRowId`, а для массива оставляет точки прототипа.
Повторяемые точки и статические точки больше не пересекаются.

Добавлены проверки:

- `templateId`, версия, hash и article сохраняются при размещении;
- `projectE4DrawingCompanions` и view renderer выбирают только нужный target;
- каждый target проходит `validateArticleDrawingContacts` для всех 12 строк;
- удаление одной точки отклоняется сервером без изменения версии и hash;
- очистка одного target оставляет два остальных видимыми;
- аргументы сценария нормализуются через `Set`, HMR/WebSocket отключены для
  параллельных запусков.

## Проверка

Успешная команда на `artifacts/m4-40/TECHMAP-GRAPHER`:

```powershell
node scripts/test-library-placement.mjs artifacts/m4-40/TECHMAP-GRAPHER --check-drawing-targets --check-drawing-array --check-drawing-placement --check-drawing-scale --check-common-drawing --check-drawing-workspace --check-topology --check-documents --check-cut-diagram --check-restart
```

Результат: `status: ok`, `drawingTargetsChecked: true`,
`drawingArrayChecked: true`, `drawingPlacementChecked: true`,
`drawingScaleChecked: true`, `documentsChecked: true`,
`cutDiagramChecked: true`, `restartChecked: true`.

Собран пакет `artifacts/m4-41/TECHMAP-GRAPHER-win-x64.zip`, версия
`0.40.2-m4-41`. SHA-256: `9DB71BFD7C1E76950419B08920064559951406E4797776463DFB170F6ACD86EA`.
`verify-package` завершён успешно.

Отдельно повторно запущены флаги `--check-drawing-targets` и
`--check-drawing-array` без ручного перечисления зависимостей: оба успешно
создают необходимые базовые данные. Старый формат `--v4 --check-restart`
также проверен. Эти запуски не падают с `articleDrawings undefined`.

Финальная объединённая команда повторена против EXE из `artifacts/m4-41`:
`appVersion: 0.40.2-m4-41`, все перечисленные сценарии успешны.
Код и поведение приложения в М4-41 не менялись, изменены smoke и версия пакета;
браузерная проверка окон относится к М4-40 и здесь повторной не объявляется.

Изменённые файлы М4-41: `scripts/test-library-placement.mjs`,
`package/VERSION.json`, этот протокол, `docs/work-state.md`,
`docs/development-plan.md`. Подготовлена следующая карточка
`docs/m4-42-markings-card.md`. Коммит и push не выполнялись по последним
переданным правилам задачи. Изменения предыдущего М4-40 сохранены в рабочем дереве.

Операционное замечание: ошибочная попытка `git add`/`git commit` в конце проверки
была остановлена песочницей на создании `.git/index.lock`. Lock-файла и процессов
Git не обнаружено; индекс и история не изменились. Повышение прав для публикации
не запрашивалось: последние правила пользователя для задачи ограничивают коммиты
отдельным поручением координатора. Это не блокирует дальнейшую реализацию.

Пользовательские проекты не использовались; каждая проверка создаёт новую БД
в `artifacts/library-placement-smoke/test-*`.
