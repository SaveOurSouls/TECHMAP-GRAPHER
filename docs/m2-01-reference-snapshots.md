# M2-01 — версионированные снимки локального справочника

Дата: 2026-09-12. Статус: реализовано.

Это рабочее описание фактически реализованной карточки, не итоговое ТЗ. Чтение
XLSX, сопоставление столбцов и preview относятся к M2-02; Google Sheets — к
M2-09. В M2-01 внешний источник не открывается и не изменяется.

## Результат и граница

M2-01 принимает уже материализованный candidate: идентификатор логического
источника, версию контракта, происхождение, канонические записи и диагностику.
Доменный код проверяет candidate и вычисляет воспроизводимый SHA-256. Публикация
сверяет результат проверки, подтверждение предупреждений и ожидаемый active
snapshot. Новый снимок и active head сохраняются одной SQLite-транзакцией.

Реализованы:

- доменные типы candidate, записи, диагностики и проверенного снимка;
- канонизация JSON и стабильные SHA-256 снимка, записи и диагностики;
- точное подтверждение набора предупреждений перед публикацией;
- Application-сервис публикации с optimistic check active snapshot;
- SQLite schema 7, история опубликованных версий и один active head на источник;
- чтение active snapshot с повторной канонической проверкой целостности;
- защищённые API проверки, публикации и чтения active snapshot.

Не реализованы: адаптер источника, чтение XLSX/Google, mapping и preview,
`observed/retained/withdrawn`, tombstone, автоматическое сохранение пропавшей
строки, предметные профили справочников, поиск по большому каталогу, UI каталога,
связь active snapshot с `pinned_characteristics` и перенос глобального каталога в
архив проекта.

## Доменный контракт

`ReferenceCatalogDraft` создаётся из следующих данных:

- `snapshotId` — непустой UUID;
- `sourceId` — внешний стабильный текстовый ключ логического источника;
- `contractVersion` — положительное целое число;
- `capturedUtc` — время получения candidate;
- provenance: `sourceKind`, `versionFingerprint`, optional `sourceUri`;
- records: `entityType`, `sourceKey`, JSON `payload`, optional `sourceLocation`;
- diagnostics: `warning` или `error`, code, message и optional привязка к записи,
  полю и месту в источнике.

Строки нормализуются в Unicode NFC и не могут содержать управляющие символы.
`sourceKey` не обрезается: ведущие нули и значимые пробелы сохраняются. На границе
SQLite `sourceId` ограничен 256 символами, `entityType` и `sourceKind` — 64,
`sourceKey` и `versionFingerprint` — 512.

`ReferenceCatalogRecordIdentity` — lowercase SHA-256 строки
`sourceId + "\n" + entityType + "\n" + sourceKey`. Адрес строки не входит в ID,
поэтому перестановка строк источника его не меняет.

Validation блокируется, если candidate пуст, две записи имеют одинаковую пару
`entityType + sourceKey`, payload не является допустимым JSON или вход содержит
diagnostic уровня `error`. Ошибки отдельных записей преобразуются в diagnostics
`invalid-record`. Успешный результат имеет состояние `validated` либо
`validated-with-warnings`.

## Канонический снимок

Канонический JSON schema 1 содержит:

```json
{
  "canonicalSchemaVersion": 1,
  "contractVersion": 1,
  "diagnostics": [],
  "provenance": {
    "sourceKind": "xlsx",
    "sourceUri": "technology-database.xlsx",
    "versionFingerprint": "revision-1"
  },
  "records": [],
  "sourceId": "technology-database",
  "validationState": "validated"
}
```

Поля объектов payload сортируются ordinal, строки приводятся к NFC, порядок
элементов массива сохраняется. JSON numbers принимаются только тогда, когда их
можно точно представить как `Int64` или `Decimal`. `null`, число `0`, пустая
строка и строка `"0"` остаются разными значениями.

Records сортируются по `entityType`, затем `sourceKey`; diagnostics — по их
стабильному ID. В запись канонического envelope входят `recordId`, `sourceId`,
`entityType`, `sourceKey` и payload. В diagnostic входят ID, severity, code,
message и optional entity/source key/field.

`capturedUtc`, `snapshotId` и `sourceLocation` не входят в канонический JSON.
Поэтому одинаковое предметное содержимое получает одинаковый snapshot SHA-256
после перестановки строк или изменения адресов строк. При хранении
`sourceLocation` защищён отдельными hashes метаданных записи и диагностики, а
`capturedUtc` и остальные данные заголовка — отдельным
`snapshot_metadata_sha256`. Это сохраняет воспроизводимость хеша содержимого и
позволяет обнаружить подмену служебных метаданных.

## Application-контракт

```csharp
public interface IReferenceCatalogSnapshotStore
{
    ReferenceCatalogSnapshot? GetActive(string sourceId);
    ReferenceCatalogSnapshot? Get(ReferenceCatalogSnapshotIdentity snapshotId);
    IReadOnlyList<ReferenceCatalogSnapshot> List(string sourceId);

    ReferenceCatalogStorePublishResult TryPublish(
        ReferenceCatalogSnapshot candidate,
        ReferenceCatalogSnapshotIdentity? expectedActiveSnapshotId);
}
```

`ReferenceCatalogPublicationService.Publish` принимает уже выполненную domain
validation, `ExpectedValidationSha256`, optional expected active snapshot ID и
полный набор acknowledged warning IDs.

Публикация отклоняется, если:

- validation не создала снимок;
- переданный validation SHA-256 не равен текущему SHA-256 candidate;
- подтверждённый набор warning IDs не совпадает с требуемым точно;
- active snapshot изменился относительно ожидаемого.

Успех возвращает `Published`. Повтор той же опубликованной версии с тем же
содержимым и текущим active возвращает `Unchanged`. Если один
`versionFingerprint` повторно использован для другого канонического содержимого,
store возвращает ошибку `catalog_source_version_reused`.

Интерфейс не содержит отдельных методов `CreateDraft` и `Validate`: domain
validation выполняется до store. SQLite store создаёт служебную draft-строку,
заполняет её и проводит через `validated → published` только внутри транзакции
успешной публикации.

## SQLite schema 7

Migration ID: `M2-01-versioned-reference-snapshots`. Migration 6 → 7 создаёт
пустые таблицы и не преобразует существующие проектные данные.

### `reference_sources`

| Поле | Назначение |
|---|---|
| `source_id` | внутренний UUID строки источника |
| `source_key` | внешний `sourceId`, уникальный |
| `source_kind` | вид источника первой публикации |
| `display_name` | сейчас равен `source_key` |
| `created_utc` | время создания строки |

### `reference_snapshots`

| Поле | Назначение |
|---|---|
| `snapshot_id` | UUID candidate |
| `source_id` | FK на внутренний источник |
| `snapshot_sequence` | положительный номер версии внутри источника |
| `contract_version` | версия предметного контракта |
| `source_version` | provenance `versionFingerprint` |
| `source_content_sha256` | hash fingerprint; для `sha256:<64 hex>` используется указанный hash |
| `snapshot_metadata_sha256` | hash ID, источника, версии, provenance и `captured_utc` |
| `canonical_content_sha256` | domain SHA-256 канонического снимка |
| `provenance_json` | `sourceKind`, `versionFingerprint`, `sourceUri` |
| `lifecycle_status` | `draft`, `validated` или `published` |
| `captured_utc` | время candidate |
| `validated_utc`, `published_utc` | времена переходов lifecycle |

Уникальны `(source_id, snapshot_sequence)` и `(source_id, snapshot_id)`.
Draft не имеет canonical hash и времён validation/publication; validated имеет
hash и `validated_utc`; published дополнительно имеет `published_utc`.

Schema разрешает наполнять и исправлять draft. Переход draft → validated запрещён
при persisted diagnostic уровня `error`. После validation header, records и
diagnostics заморожены; допустим только переход validated → published без
изменения проверенного содержимого. Validated/published snapshot удалить нельзя.
Текущий store выполняет все три стадии в одной транзакции и не оставляет draft
при штатной ошибке публикации.

### `reference_snapshot_records`

Первичный ключ: `(snapshot_id, entity_type, source_record_key)`. Хранятся
`source_location`, канонический payload и `payload_sha256`, вычисленный по
entity type, source key, location и payload. Максимальный payload на уровне БД —
1 MiB текста. В M2-01 нет disposition и отдельного persisted `record_id`: record
ID воспроизводится доменной канонизацией при чтении.

### `reference_snapshot_diagnostics`

Первичный ключ: `(snapshot_id, diagnostic_index)`. Хранятся severity, code,
message, optional entity/source key/location/field и `diagnostic_sha256` всех
этих метаданных. SQLite constraint допускает `info`, `warning`, `error`, но
текущие Domain и API создают только `warning` и `error`.

### `reference_source_heads`

Содержит не более одной пары `(source_id, snapshot_id)` на источник. Composite FK
и triggers разрешают head только на published snapshot того же источника. Замена
head происходит в той же транзакции, что вставка и публикация версии.

## Публикация, повтор и конкурентный доступ

1. Клиент локально или через validation endpoint передаёт полный candidate.
2. Domain validation канонизирует данные и возвращает SHA-256 и warning IDs.
3. Для publication клиент повторно передаёт полный candidate, ожидаемый validation
   SHA-256, warning IDs и optional expected active snapshot ID.
4. Application повторяет validation и сверяет exact hash/acknowledgements.
5. Store в одной `ExecuteInTransaction` проверяет active и версии, вставляет
   draft, records и diagnostics, выполняет два lifecycle-перехода и меняет head.

При stale expected active новая версия не вставляется. Два конкурентных publisher
с одним expected active дают одного победителя; второй получает conflict. До
commit читатели видят старый head, после commit — новый целый published snapshot.

Исторические published snapshots остаются в БД и доступны через `Get`/`List` на
Application-уровне. Web API M2-01 выдаёт только active snapshot и его records.

## Чтение и целостность

`GetActive` начинает с `reference_source_heads` и читает данные из `app.db`, не
обращаясь к внешнему источнику. Поэтому неудача будущего обновления не удаляет
последний опубликованный локальный снимок.

При чтении store повторно проверяет:

- SHA-256 заголовка, включая `captured_utc`;
- provenance fingerprint и `source_content_sha256`;
- payload SHA-256 каждой записи;
- SHA-256 метаданных каждой диагностики;
- доменную validation и полный `canonical_content_sha256`.

Повреждение active snapshot даёт fail-closed `InvalidDataException`; store не
подменяет его автоматически более старой версией. Backup и restore сохраняют
таблицы как часть общей SQLite БД. При создании, dry-run и полном восстановлении
backup заново проверяет метаданные, строки, диагностику и канонический hash каждого
опубликованного снимка до принятия копии.

## Web API

Реализованы четыре endpoint:

- `POST /api/v1/reference-sources/{sourceId}/validations`;
- `POST /api/v1/reference-sources/{sourceId}/publications`;
- `GET /api/v1/reference-sources/{sourceId}/active`;
- `GET /api/v1/reference-sources/{sourceId}/active/records`.

Оба POST принимают материализованные records/diagnostics; publication также
принимает `expectedActiveSnapshotId`, `expectedValidationSha256` и
`acknowledgedWarningIds`. Лимит запроса — 100 000 records и 100 000 diagnostics;
дополнительные ограничения длин и payload накладывает schema. Все endpoints
используют локальную session-защиту M1; изменяющие запросы также проходят общую
Origin/CSRF/JSON-проверку.

Фактически возвращаемые стабильные коды:

- `catalog_active_snapshot_not_found` — 404;
- `catalog_validation_failed` — 422;
- `catalog_validation_changed` — 409;
- `catalog_warnings_require_acknowledgement` — 409;
- `catalog_active_snapshot_changed` — 409;
- `catalog_source_version_reused`, `catalog_snapshot_id_reused`,
  `catalog_snapshot_state_conflict`, `catalog_source_kind_changed` — 409;
- `catalog_snapshot_limit_exceeded` — 413;
- `catalog_payload_invalid` — 400 или 422 в зависимости от границы проверки;
- `catalog_snapshot_corrupt` — 500.

Отдельные API создания/редактирования persisted draft, просмотра исторического
снимка и списка версий не входят в M2-01.

## Фактические проверки

Проверено:

- SHA-256 не зависит от порядка records, порядка свойств payload и адреса строки;
- NFC-эквивалентный текст канонизируется одинаково;
- `null`, ноль, пустая строка и текстовый ноль различаются;
- duplicate key/property, пустой candidate и неточное число блокируют validation;
- публикация требует точный validation hash и точный набор warning IDs;
- migration 6 → 7 не переписывает предыдущую историю и оставляет каталог пустым;
- schema соблюдает `draft → validated → published` и замораживает снимок;
- две опубликованные версии сосуществуют и переживают restart;
- record ID остаётся стабильным между версиями;
- stale и конкурентная публикации сохраняют предыдущий active snapshot;
- повтор одинаковой source version идемпотентен, другое содержимое отклоняется;
- повреждённый persisted payload обнаруживается без fallback;
- повреждённые время/provenance и несогласованный канонический снимок не проходят
  runtime- или backup-проверку;
- backup/full restore сохраняет опубликованный active snapshot и его записи;
- API проверяет warning acknowledgement, stale validation и локальную защиту.

Все тесты решения после реализации: 399/399. Чтение и preview XLSX остаются
M2-02.

## Ограничения

`sourceUri` и `versionFingerprint` принимает вызывающий код: M2-01 не удаляет из
них секреты автоматически. Будущий адаптер обязан передавать безопасное
происхождение без access token, cookie и учётных данных.

`source_content_sha256` пока является производным от `versionFingerprint`, если
тот не задан в формате `sha256:<lowercase hash>`; M2-02 должен передавать hash
точных входных байтов в согласованном fingerprint.

Отсутствие записи в новом candidate не имеет специальной семантики. Правила
retained/withdrawn нельзя считать реализованными и следует проектировать вместе с
предметным импортом. Существующие `pinned_characteristics` не обновляются и не
читают active catalog автоматически.
