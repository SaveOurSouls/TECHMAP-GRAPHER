# M1-12 — безопасные миграции хранилища

Дата: 2026-09-12. Статус: реализовано.

## Порядок запуска

Сервер сначала читает `VERSION.json` и до записи в `dataRoot` проверяет, что schema
пакета совпадает со schema приложения. Затем он получает единственный
`DataRootLease` и удерживает его до завершения процесса. Тот же объект lease
передаётся migration service; повторное получение нерекурсивного Windows mutex не
выполняется.

Для существующей устаревшей БД выполняется строгая последовательность:

1. Проверяются `CURRENT`, `READY`, SQLite schema/history/shape,
   `integrity_check`, `foreign_key_check`, доменные строки и referenced blobs.
2. Проверяется полный последовательный путь только из шагов `N → N+1`.
3. Обязательно публикуется и повторно проверяется backup `pre-update`. Текущее
   состояние backup policy не может отменить эту копию. Из строго проверенного,
   но не изменённого policy state в manifest переносится прежняя версия приложения.
4. До создания candidate долговечно публикуется неизменяемый `MIGRATION.json` с
   operation ID, source/candidate generation, schema from/to, app version и полной
   идентичностью backup.
5. В новой generation создаётся owner marker. `app.db` копируется только из
   проверенного snapshot backup с одновременной проверкой размера и SHA-256.
6. Каждый шаг schema выполняется отдельной SQLite-транзакцией. После каждого шага
   снова проверяются history и shape. Проверка сохранности сравнивает все столбцы
   всех предметных таблиц, существовавших до миграции.
7. После итоговой проверки публикуются `MIGRATION-COMPLETE.json`, затем `READY`.
   Backup, candidate и live blobs перечитываются непосредственно перед переключением.
8. `CURRENT` заменяется через `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)`.
   После этой точки cancellation и исключения наблюдателя не меняют результат.
9. Новая БД открывается обычным `SqliteStorage.Open`. Только после успешного
   открытия фиксируется `LastRunAppVersion`, применяется retention и удаляется
   journal. Регулярная policy запускается hosted service после открытия БД.

`SqliteStorage.Open` не выполняет миграцию существующего `CURRENT` на месте. Он
открывает новую БД либо проверяет актуальную; для старой schema возвращает
`StorageMigrationRequiredException` до записи в SQLite.

## Восстановление после сбоя

Фаза выводится из неизменяемого journal и опубликованных артефактов. Journal не
переписывается по ходу операции.

- journal без candidate: journal удаляется, создаётся новый обязательный backup и
  новая попытка;
- owned candidate без completion/READY: удаляется только generation с точным owner
  marker и без reparse entries, затем начинается новая попытка;
- completion + READY при прежнем `CURRENT`: все данные и backup повторно
  проверяются, затем завершается переключение;
- `CURRENT` уже указывает на candidate: операция считается committed только после
  полной повторной проверки; journal сохраняется до успешного открытия БД и
  фиксации policy;
- отсутствующий или синтаксически повреждённый `CURRENT` восстанавливается на
  полностью проверенный READY candidate либо на доказанно неизменный source;
- если `CURRENT` указывает на незавершённый candidate, система останавливается без
  удаления candidate и без возврата указателя на source;
- третья generation, изменённый source/backup, чужой candidate, повреждённый или
  противоречивый journal приводят к fail-closed без удаления данных.

Downgrade, неизвестная schema, несовпадение schema пакета и приложения, отсутствующий
шаг, повреждённый referenced blob и неуспешный backup отклоняются до переключения.
Старое поколение не удаляется.

## Проверки и границы

`StorageMigrationIntegrationTests` покрывает schema 1/2/3→4, неизменность source,
обязательный backup, rollback исключения внутри шага, recovery после journal и
после READY, потерянный/повреждённый `CURRENT`, активный незавершённый candidate,
reparse entry при cleanup, повреждённый journal, downgrade и package mismatch.
Policy-тесты отдельно доказывают, что подготовка backup не обновляет версию до
успешного startup. Штатный запуск: `scripts/test-m1-12.ps1`.

Schema в этой карточке остаётся 4: проверяется механизм обновления старых schema,
а новая предметная schema не вводится. Экспорт проекта начинается с M1-13.
