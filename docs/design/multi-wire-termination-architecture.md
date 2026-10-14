# Архитектура многопроводных оконцовок (карточка 099)

Статус: проектирование; реализация в эту карточку не входит. Основание: REQ-135, `tasks/099-multi-wire-termination-design.md`. Сверено с `docs/design/multi-wire-termination-plan.md` и ADR-0003, 0004, 0010, 0014, 0017, 0018, 0019.

## Наблюдения по текущему коду

- `editor/model.ts` хранит `ConnectorContact` с одним `terminalArticle`, `terminalDetails` и проводными атрибутами. `WireEndpoint` адресует `connectorId/contactId`, `junctionId` или экран; `WireInstance` имеет два конца.
- Текущие `validateWire/requireEndpoint` и серверный `ElectricalGraphValidator.cs` разрешают несколько wire ends на одном обычном `ContactRef`. Это существующее shared-contact поведение, но оно не доказывает общий обжим, гильзу или технологическую совместимость.
- `junction` — электрическая группа. Физическая близость, общая трасса, оболочка и одинаковый circuit сами по себе не создают производственную оконцовку (ADR-0004).
- `WireBlankCatalog.ts` поддерживает базовые режимы `cut/copper/tin/terminal/sealed/sealed-pin`. Они являются режимами конца/иллюстрации, а не группой обжима.
- `terminal-details.ts` и `route-terminal-requirements.ts` закрепляют snapshot и норму для одного конца одного провода; неизвестная норма остаётся `null`.
- `drawing-documents.ts` считает терминалы по контактным записям; совпадение артикулов не означает один физический экземпляр. `CableInstance.memberWireIds` — физический кабель, не оконцовка.
- `route-source.ts` и Route V3 сейчас адресуют `wire/cable/covering/connector`; `route-v3-source-refresh.ts` применяет изменения источника явно по стабильным refs.
- ComponentTemplate v5 закрепляет совместимые терминалы и уплотнители snapshot-ами, но текущий код не подтверждает capacity для 2+ проводов.
- `diffPairs` и `drawing-twisted-pair.ts` описывают только специальную двухпроводную группу. Новая скрутка 2+ хранится отдельно.
- `collectConnectedWireIds` расширяет обход через junction/screen, но не общий ContactRef; `syncContactWireMaterial` и `syncDirectWireColors` могут распространять единичные свойства контакта на его провода. Внедрение требует общего resolver связности и индивидуальных свойств WireInstance с явным групповым редактированием; одного добавления SVG недостаточно.

## Канонический контракт

В новый versioned документ добавляются top-level коллекции:

    terminationPoints[]
    terminationGroups[]
    terminationArtifacts[]
    endPreparations[]
    terminationOperations[]
    physicalTwistGroups[]

Существующие `connectors/wires/junctions/physicalTopology` сохраняются источниками электрической и физической модели. Все ID opaque и стабильны:

    wire-end:<wireId>:from|to
    termination-point:<uuid>
    termination-group:<uuid>
    termination-artifact:<uuid>
    end-preparation:<uuid>
    termination-operation:<uuid>
    physical-twist:<uuid>

### Target и точки

`TerminationTarget` — tagged union:

    contact          { connectorId, contactId }
    standalone-terminal { terminalId, contactId }
    joint-port       { jointId, portId }

`TerminationPoint` содержит `id`, один `target`, опциональный `groupId` и presentation. Для свободного окончания `target` отсутствует, а точка адресуется через `EndPreparation.pointId` и его `WireEndRef`; это не электрическое соединение. `standalone-terminal` имеет отдельный stable ID и библиотечный рисунок. `joint-port` относится к conductive `JointInstance` с двумя портами A/B и явной внутренней связью A↔B. Безгильзовая сварка вне текущего scope.

Точка `TerminationPoint` на Чертежe всегда является **точкой Разделки**. Самостоятельный терминал дополнительно имеет библиотечный рисунок; точка Разделки не превращается в копию провода или отдельный электрический контакт.

Электрический `WireEndpoint` расширяется tagged union для `standalone-terminal`, `joint-port` и `free-end {pointId}`. Свободный конец не является junction и не связывает соседние точки. Канонические `StandaloneTerminalInstance` и `JointInstance` должны храниться в документе со своими IDs и artifactId; нельзя оставлять targets только в UI. Каждая группа проверяет точное совпадение target с endpoints всех memberEnds; предварительное переподключение — отдельная атомарная электрическая команда. Топология гильзы A↔B хранится независимо от наличия выполненной операции, как и электрическая схема соединения до физического изготовления.

### Артефакты

`TerminationArtifact` хранится один раз top-level:

    {
      id,
      kind: terminal | sleeve | seal,
      catalogBinding: pinned snapshot | null,
      article,
      capacity: {
        conductorCountMin, conductorCountMax,
        combinations: explicit catalog combinations,
        totalSection/range with source units,
        diameterRange?, material?, finish?, sealCompatibility?
      } | null,
      geometry: single { anchorId }
              | extreme-pair { fromAnchorId, toAnchorId }
    }

Terminal (НКИ, НШВИ, НВШ, НВИ, подтверждённый pin/socket или DIN) имеет ровно один anchor. Sleeve имеет ровно два крайних anchor A/B. Число якорей не является capacity и не равно числу проводников. Артикул/название/цвет не подтверждают capacity. При отсутствии snapshot или явной комбинации capacity = `null` и производственное подтверждение блокируется.

### Группы и preparation

`TerminationGroup` содержит `id`, `pointId`, `artifactId`, `memberEnds[]` и назначение `role=same-contact-termination`. Группа одного ввода имеет 1+ элемент: это необходимо для гильз 1+1 и 2+1 и одиночного наконечника. Команда «Общий обжим нескольких проводов» требует 2+ участников на выбранном вводе. Free end не требует группы. `artifactId` является ссылкой на один физический экземпляр, не вложенной копией. По нему обе группы гильзы A/B адресуют одну запись sleeve.

Гильза имеет один top-level artifact и два порта A/B. Каждая сторона получает собственную группу проводов; A/B распределение хранится явно. Одна операция может адресовать обе группы/порта.

`EndPreparation` хранится top-level, ровно по `WireEndRef`:

    {
      id, wireId, end, pointId,
      mode: cut | copper | tin | pin | socket | pin-sealed |
            socket-sealed | lug,
      artifactId?: termination-artifact:<uuid>,
      sealArtifactId?: termination-artifact:<uuid>,
      stripLengthMm?: number | null,
      catalogBinding?: pinned snapshot | null,
      correctionSource?: pinned snapshot | manual
    }

Это восемь явных режимов Разделки. `pin/socket` и уплотнённые варианты получают artifact refs; `lug` ссылается на наконечник из библиотеки. `cut/copper/tin` не создают неявное электрическое соединение. Один и тот же `WireInstance` может иметь группы на обоих концах: уникальность действует для `wireId + end`, а не для всего провода.

### PhysicalTwistGroup

    {
      id,
      memberWireIds[],
      span: physical path/segment refs,
      pitchMm: number | null,
      direction,
      processBinding: pinned snapshot | null
    }

Минимум два провода. Скрутка описывает физический участок и не создаёт `junction`. Она может существовать без `TerminationGroup`. `DiffPairGroup` остаётся двухпроводной дифференциальной сущностью.

### Операции

`TerminationOperation` содержит target union и рецепт:

    target:
      wireEnd { wireId, end }
      | group { groupId }
      | portSet { jointId, portIds: [A, B, ...] }
      | twist { twistGroupId }
    kind: strip | tin | crimp | ultrasonic-weld | twist
    recipe: pinned catalog snapshot | null
    executionCount: positive integer | null
    parallelCapacity: positive integer | null
    dependsOn: operationId[]
    norm: machine/human/setup seconds or null

Одна УЗ-операция может адресовать `portSet {jointId, portIds:[A,B]}` и обрабатывать обе стороны общей гильзы. `executionCount` берётся из закреплённого рецепта; он не равен автоматически числу групп, портов или артикулов. Группировка P выполняется только при явной `processCapacity` в рецепте; `parallelCapacity` станка не является capacity материала. `dependsOn` образует ацикличный граф.

## Инварианты и расчёты

1. Все top-level IDs уникальны. Каждый `WireEndRef`, заданный target, artifactId, groupId и operationId существует; `point.groupId` и `group.pointId` взаимны, если группа задана. Target/groupId у free end отсутствуют; EndPreparation ссылается на его TerminationPoint.
2. `memberEnds` уникальны. Один `wireId/end` может входить только в одну активную `TerminationGroup`. Оба конца одного провода могут входить в разные группы.
3. Contact target должен ссылаться на существующий контакт; standalone terminal/joint-port — на существующую производственную сущность. Создание группы не переподключает `wires.from/to`.
4. Наконечник = один anchor; гильза = два крайних anchor. SVG anchors, число проводов и capacity валидируются раздельно.
5. Junction, общая трасса, оболочка, скрутка и совпадение circuit не создают termination group.
6. Catalog compatibility даёт `compatible/incompatible/unknown`. Unknown не считается успехом. AWG/мм² сохраняют исходные единицы; номера AWG не складываются. Mixed sections/materials допустимы только при явной комбинации рецепта.
7. Длина резки считается один раз на WireInstance по существующим correction/rounding. Подготовка конца использует собственную strip length и provenance; поправка L+/L− не прибавляется второй раз и не выводится из canvas geometry.
8. BOM считает каждый wire blank по wireId, один artifact по artifactId, seal по sealArtifactId, а операции по `executionCount`. Группа из 4 проводов не создаёт четыре наконечника. Операция не считается автоматически «одной на группу»: одна группа может требовать несколько executions, а одна операция может адресовать обе стороны одного sleeve.
9. Отсутствующая норма времени остаётся `null`. Route V3 cycles/setup рассчитываются только из явно закреплённого process capacity и recipe.
10. Электрика, production group и physical twist — независимые графы; изменение одного не переписывает другие.

## Проекции

- **Э4:** существующий ContactRef показывает список wireId и индивидуальные свойства; общий обжим отображается badge-ом TerminationGroup. Свободный конец может иметь EndPreparation без группы. Standalone terminal/joint-port имеют собственные stable IDs.
- **Чертёж:** TerminationPoint всегда рисуется точкой Разделки с индексом/выноской. Standalone terminal дополнительно рисуется библиотечным изображением. Terminal artifact имеет один anchor, sleeve — A/B крайние anchors; слои остаются поверх П/ОП/оболочек.
- **Route V3:** wire refs отвечают за резку; artifact refs — за расход; group/portSet/wireEnd operation refs — за обработку. Source refresh сравнивает отсортированные WireEndRefs, target, artifact/preparation/recipe snapshots и требует явного apply. Multi-output остаётся явно назначаемым.
- **Синхронизация:** только типизированные атомарные команды меняют канонический документ; проекции не хранят свои копии группы, подготовки или артефакта.

## Команды

`create/update-termination-group`, `split/remove-termination-group`, `set-end-preparation`, `set-artifact`, `set-operation-recipe`, `create/update-physical-twist`, `move-terminal-point`.

Команды возвращают `invalid_electrical_graph`, `invalid_termination_capacity`, `unknown_catalog_compatibility` и `route_source_divergence`. `move-terminal-point` меняет только presentation.

## Миграция

Schema 1 читается в legacy projection mode; новый полный writer требует versioned schema/writer contract (планируемый contract 3), а embedded drawing copy и Route V3 parser обновляются одновременно.

Автоматически сохраняются старые wires, endpoints, contacts, junctions, cables, topology и Route V3 refs. `terminalArticle/details/materialBinding` можно показать как legacy EndPreparation только при однозначном `WireEndRef`. Это не создаёт group/artifact и не подтверждает capacity.

Не мигрируются автоматически junction, CableInstance, diffPairs, coverings, одинаковые артикулы/circuit/цвет/сечение, capacity по названию и standalone/joint-port без явного mapping. Shared contact остаётся legacy electrical data. Мигратор предлагает кандидатов по stable refs; оператор подтверждает target, members, artifact, recipe, capacity и операции. Сохраняются исходная ревизия, migrationId и журнал решений. Неизвестная каталожная совместимость блокирует производственную готовность, но позволяет сохранить структурно корректный черновик v2; невалидные ссылки/дубли блокируют write. Неизвестные новые типы старый writer не должен молча отбросить. Отдельно покрыть backup, recovery, export/import и embedded drawing copies.

## Ссылки на проверенные точки кода

- [Контакты, endpoints, длины и обход цепи](../../src/Techmap.Client/src/editor/model.ts).
- [Команды и синхронизация материала/цвета](../../src/Techmap.Client/src/editor/commands.ts).
- [Серверный граф и writer contract](../../src/Techmap.Infrastructure.Sqlite/ElectricalGraphValidator.cs).
- [Хранение schemaVersion](../../src/Techmap.Infrastructure.Sqlite/SqliteHarnessDesignDocumentStore.cs).
- [Требования терминалов по wire/end](../../src/Techmap.Client/src/manufacturing/route-terminal-requirements.ts).
- [Проекция источника маршрута](../../src/Techmap.Client/src/manufacturing/route-source.ts).
- [Операции V3](../../src/Techmap.Client/src/manufacturing-v3/route-v3-operations.ts), [обновление V3](../../src/Techmap.Client/src/manufacturing-v3/route-v3-source-refresh.ts).
- [BOM](../../src/Techmap.Client/src/editor/drawing-documents.ts), [проверка embedded копий](../../src/Techmap.Infrastructure.Sqlite/ManufacturingRouteValidator.cs).

## Будущие файлы интеграции

- Канон и валидаторы: `src/Techmap.Client/src/editor/model.ts`, `commands.ts`, `SqliteHarnessDesignDocumentStore.cs`, `ElectricalGraphValidator.cs`, новый `HarnessTerminationValidator.cs`, contracts/application DTO.
- Каталог: `component-library/template-model-v5.ts`, `ComponentTemplateContentV5Validator.cs`, `template-terminal-catalog.ts`, `terminal-details.ts`, `WireBlankCatalog.ts`.
- Э4/Чертёж: `drawing-documents.ts`, `CanvasViewport.tsx`, scene/selection и `HarnessDesignEditor.tsx`.
- Route V3: `route-source.ts`, `route-v3-model.ts`, `route-v3-operations.ts`, `route-v3-source-refresh.ts`, `route-v3-wire-artwork.tsx`, `ManufacturingRouteValidator.cs`.
- Проверки: model/commands, catalog, migration, `ElectricalGraphValidatorTests.cs`, `HarnessDesignMigrationTests.cs`, `ManufacturingRouteValidatorTests.cs`. Fixtures: 2/3/4+ wires, one terminal anchor, sleeve A/B, eight preparation modes, both wire ends in groups, one UZ operation on A+B, unknown capacity, twist without junction, rollback.

## Решения, принятые этим проектом

- Оба конца одного WireInstance в разных группах разрешены.
- Pin/socket и sealed modes являются EndPreparation modes с явными artifact refs.
- Распределение sleeve groups A/B и один shared artifact обязательны; безгильзовая сварка не входит в scope.
- Количество execution задаётся recipe; не выводится автоматически из количества group/port/artifact.
- Свободный конец поддерживается EndPreparation без обязательной TerminationGroup.
- Открытые вопросы ограничены реальными catalog records, mixed-material compatibility matrix и принятой schema/writer version; семантика модели выше не является вопросом.
