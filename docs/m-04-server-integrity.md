# M-04: серверная целостность и границы M5-01

Дата проверки: 26.09.2026. Проверялся текущий SQLite/HTTP слой жгута и план
M5 (`m5-route-plan.md`, `m5-route-source-2026-09-26.md`). Этот документ фиксирует
фактический технический результат, а не объявляет готовность M5.

## Что закрыто в серверном срезе M-04

`SqliteHarnessDesignDocumentStore.ValidateContent` проверяет документ перед
транзакцией. В электрический валидатор вынесены уникальные ID коннекторов,
проводов, узлов, экранов и групп; уникальность контактов внутри коннектора;
ссылки проводов на существующий контакт/коннектор; обратную принадлежность
провода узлу; ссылки дифференциальных пар и экранов; запрет повторного потребления
провода дифференциальными парами; конфликт провода с его собственным охватом
экрана и несовместимые стороны экранного вывода. Ошибка не меняет revision,
содержимое или project placements.

Документный writer contract опционален для старых записей и имеет единственную
поддержанную версию `1`:

```json
{
  "writerContractVersion": 1,
  "expectedRevision": 7,
  "schemaVersion": 1,
  "content": {
    "schemaVersion": 1,
    "requiredWriterContractVersion": 1,
    "connectors": [],
    "wires": []
  }
}
```

Сервер проставляет `requiredWriterContractVersion: 1` при записи capable writer,
не позволяет его уменьшить или удалить, а старому writer возвращает
`409 design_writer_upgrade_required` до SQL UPDATE. Неизвестная версия даёт
`400 unsupported_design_writer_contract`. Для отмеченного документа поля
`connectors`, `contacts` и оба endpoint каждого провода обязательны. Legacy
документы без маркера продолжают читаться и сохраняются старым API; это
намеренная граница совместимости, а не утверждение полной строгости schema 1.

Placement append дополнительно валидирует целевой candidate до изменения live
документа. Export/import и copy прогоняют электрический валидатор и сохраняют
маркер. Тестовые результаты текущего среза: 165/165 основных targeted тестов и
44/44 regression теста после проверки обхода через placement.

## Границы negotiated writer v1

Клиентская интеграция и общие проверки фиксируются оркестратором отдельно от
названных серверных targeted запусков. Версия 1 обозначает понимание текущих
полей конструктора; будущий маршрут требует версии 2. Маркер не защищает от
клиента, который объявил версию 1, но реализует её неверно. Непомеченный legacy
документ защищается от старого writer после первой записи новым клиентом.
Recovery journal хранит отдельный draft и сам по себе не является live UPDATE.
Восстановление draft в live должно пройти обычный writer/revision контракт.

## Минимальный контракт M5-01: `manufacturingRoute`

Производственный маршрут хранится отдельным корнем в том же design JSON и не
смешивается с физической топологией:

```json
{
  "manufacturingRoute": {
    "contractVersion": 1,
    "source": { "fingerprintVersion": 1, "sha256": "..." },
    "status": "draft",
    "rows": [{
      "id": "route-row-uuid",
      "kind": "semiFinished|assembly",
      "title": "...",
      "sourceObjects": [{ "kind": "wire", "id": "wire-uuid" }],
      "operations": [{ "id": "operation-uuid", "binding": null, "note": "Норма ещё не выбрана" }],
      "dependsOn": ["route-row-uuid"],
      "presentation": { "backgroundOpacity": 0.25, "objects": [] },
      "prepared": false
    }]
  }
}
```

Обязательные инварианты:

- `rows[].id`, operation ID и ссылки — устойчивые ID, порядок массива не является
  identity; все ID уникальны в своём пространстве.
- `dependsOn` образует DAG: отсутствующая ссылка, цикл и повторная ссылка
  отклоняются. Общее происхождение учитывается один раз; повторное потребление
  одного объекта в несовместимых строках даёт конфликт.
- `sourceObjects` типизированы: `wire`, `cable`, `covering`, `connector`,
  при необходимости `contact` с обязательным `connectorId`. Произвольный
  `drawingObject` пока исключён: у scene projections не всегда есть предметный ID.
  `sourceObjects` вводит исходный объект в DAG один раз; сборка наследует состав
  через `dependsOn`, а рисунок использует отдельные refs. Удалённый или
  изменившийся объект не удаляет ручную строку: маршрут получает
  `stale-source` и требует явного обновления.
- `source.sha256` рассчитывает сервер по versioned whitelist предметной
  конструкции: connectors/contacts и bindings, wires/ends/material/length,
  cables, физические branches/coverings. Исключены manufacturingRoute,
  requiredWriterContractVersion, экранная камера, E4 derived routing и
  document annotations. Revision не заменяет hash: маршрутная правка сама
  увеличивает design revision. Для количества отдельно включаются текущие
  harness quantity и project batch quantity из БД. Канонизация сортирует
  object keys и identity collections, сохраняет семантический порядок routes.
  Алгоритм должен иметь общие fixtures TS/C#; hash сервера является authority.
- При обычной правке конструкции старый маршрут сохраняется, а устаревание
  вычисляется по несовпадению hash. При изменении самого маршрута его source hash
  должен совпасть с текущим construction hash; иначе отказ сохраняет обе версии.
  Нельзя запретить сохранение чертежа только потому, что маршрут стал устаревшим.
- `operations.binding` закрепляет sourceId/entityType/snapshotId/snapshotSha256/
  recordId/sourceKey; null обозначает отсутствие выбранной нормы. Отсутствие
  нормы остаётся unknown, а не заменяется выдуманным временем/операцией.
- `presentation` содержит только маршрутную геометрию/видимость. Она не меняет
  длину, материал, терминал или ID исходного чертежа.
- Хранимый `status`: `draft|completed`, у строки `prepared`. Эффективные
  `stale-source`, `conflict`, `incomplete` вычисляются валидатором; нельзя
  доверять сохранённому флагу ready. Количество выводится из состава и
  актуального количества жгутов, не является произвольным числом строки.
- Parent conflicts проверяются по явным свойствам состояния и их происхождению;
  M5-01 не должен угадывать семантику ещё не заданных M5-03 операций. Если разные
  родители задают разные значения одного свойства исходного объекта, нужен
  явный resolver или статус conflict.

## Mutation paths, которые обязаны сохранять маршрут

1. Обычный `PUT /design` — optimistic revision, source hash и writer v2.
2. Добавление placement — append connector без потери `manufacturingRoute`.
3. Undo/redo и autosave editor — только через тот же design writer.
4. Project copy — новые project/harness/placement IDs; локальные IDs строк,
   проводов, ветвей и покрытий сейчас сохраняются. Remap касается connector refs,
   contact refs и всех маршрутных presentation refs, содержащих placement UUID.
5. Export/import — тот же remapper; `ProjectComponentPlacementRemapper` сегодня
   меняет только connector/contact IDs и wire endpoints, маршрут ему неизвестен.
   Актуальный source hash можно пересчитать после эквивалентного remap лишь если
   старый hash совпадал с исходной конструкцией; stale остаётся stale. Если
   placement map пуст, early-return remapper не должен обходить проверки маршрута.
6. Recovery restore — проверка writer contract и source hash до live UPDATE.
7. Обновление физического design — не переписывает маршрут молча; выставляет
   `stale-source` и оставляет ручную геометрию.

M5-01 не входит в закрытый M-04: для него ещё нужны отдельный validator,
transactional store/API, remapper typed refs и пользовательские проверки двух
цепочек, сходящихся в сборку, цикла, конфликта родителей и переносимости.

## Предлагаемый writer v2 и файлы M5-01

`writerContractVersion: 2` понимает v1 и route v1. Если incoming или stored
document содержит маршрут либо required marker 2, writer 0/1 получает 409 до
UPDATE. Маркер монотонный и остаётся 2 даже после явного удаления маршрута.
Нельзя принимать manufacturingRoute на marker 1: это позволило бы v1 writer
молча удалить маршрут. Capable writer 2 может обновлять чистый конструктор без
создания маршрута. Existing schemaVersion остаётся 1, version 2 в writer protocol.

Минимальная карта реализации:

- Новые `ManufacturingRouteValidator.cs`, `ManufacturingSourceFingerprint.cs`,
  `ManufacturingRouteRemapper.cs` в Infrastructure.Sqlite; отдельные contract/
  fingerprint/portability tests в Techmap.Web.Tests.
- `SqliteHarnessDesignDocumentStore`, `ElectricalGraphValidator` и
  `HarnessDesignEndpoints` — v2, сравнение previous/candidate route и source,
  проверка в той же транзакции с учётом внешнего количества.
- `SqliteProjectComponentSnapshotStore.AppendInstanceToDesign` — append не теряет
  маршрут, добавление корпуса делает его stale, но не отклоняет всю конструкцию.
- `ProjectComponentPlacementRemapper`, `SqliteProjectCatalog`,
  `SqliteProjectImportService`, `SqliteProjectExportService` — маршрутный remap,
  validation до/после переноса и точное сохранение fingerprint status.
- `ApiContracts.cs` / `HarnessDesignDocuments.cs` — данные fingerprint в read
  response либо отдельный read endpoint; существующий optional writer argument
  достаточно расширить до поддержки 2.
- Клиент: новые route model/commands/validator/source-state; `editor/model.ts`
  сохраняет typed root, `design-api.ts` передаёт writer 2 и читает authoritative
  source hash, команды Undo/redo сохраняют route как часть whole design.
- `HarnessDesignRecoveryJournal` и клиентский recovery parser требуют round-trip
  теста route; журнал не должен повторно вычислять и подменять source hash.

Не найдено необходимости в SQLite migration: payload живёт в existing JSON,
concurrency обеспечивается общим design revision. Отдельный route revision
без отдельного API создал бы два несогласованных optimistic contracts.

Интеграция оркестратора: клиент сохраняет marker и передаёт writerContractVersion=1; будущая версия отклоняется при чтении. Общий прогон 26.09.2026: 960/960 .NET, 1376/1376 Vitest, TypeScript и production build — PASS. M5-предложение выше пока не включено в эту реализацию.

