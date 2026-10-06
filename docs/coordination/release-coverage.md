# Release coverage

Этот реестр обязателен для каждого ZIP. Он связывает зарегистрированные рабочие
чаты, handoff и исходные коммиты с конкретным кодовым HEAD, из которого собран
артефакт. Подробные технические manifest могут жить в отдельных документах,
но здесь должна быть явная ссылка и итоговый gate.

## Порядок проверки

1. Зафиксировать интеграционную ветку и предполагаемый code HEAD.
2. Сверить `chat-registry.md`, карточки `ready-for-review` или выше,
   `integration-log.md` и отчёты аудитора. `idle` и `archived` сами по себе не
   доказывают завершённость или интеграцию.
3. Для каждого handoff проверить исходные SHA через `git show`; подтвердить их
   ancestry в code HEAD либо записать и проверить эквивалент переноса.
4. Включить каждую завершённую задачу. Исключение допустимо только при отмене
   владельцем, явном переносе за границы релиза или замене более новым решением;
   указать основание и ссылку на подтверждение.
5. При `pending`, неизвестном статусе или отсутствующем доказательстве включения
   выпуск заблокирован. После сборки записать code HEAD, версию, ZIP path, размер,
   SHA-256, manifest и portable gates.

## Шаблон записи релиза

Скопировать секцию для каждого выпуска. Подробную таблицу задач можно вынести в
`docs/coordination/<slice>-manifest.md`.

### <slice> — <дата>

- **Integration branch:** `<branch>`
- **Code HEAD:** `<full SHA>`
- **Coverage detail:** `<manifest path>`
- **Registry/audit snapshot:** `<date and report>`
- **Handoff rows checked:** `<N>/<N>`
- **Pending or unknown:** `0`
- **Exceptions:** `none` или подтверждённое основание
- **ZIP:** `<path and appVersion>`
- **Size / SHA-256:** `<bytes> / <hash>`
- **PACKAGE-MANIFEST / portable:** `<PASS/FAIL; count>`
- **Gate:** `PASS` только когда каждый завершённый handoff включён или явно исключён; иначе `BLOCKED`.

| Карточка / чат | Thread ID | Исходные commit SHA | Доказательство против code HEAD | Coverage |
| --- | --- | --- | --- | --- |
| `<ID / title>` | `<thread>` | `<SHA list>` | `<ancestor / equivalent / approved exception>` | `included / excluded / pending` |

## M5-22

Подробный manifest текущего среза находится в
[`m5-22-manifest.md`](m5-22-manifest.md). M5-22 проходит gate только после
сверки сборщиком всех manifest rows и новых handoff с фактическим code HEAD и
заполнения итоговой секции выше. Историческое утверждение о проверенном ZIP не
заменяет проверку нового кодового среза.

### m5-22-036 — 05.10.2026

- **Integration branch:** `codex/integration-m5-22`
- **Code HEAD:** `b9b6c24f3597cef6d3306ff23d87136090f8a1b7`
- **Coverage detail:** [`m5-22-manifest.md`](m5-22-manifest.md)
- **Registry/audit snapshot:** `chat-registry.md`, audit report 05.10.2026
- **M5 handoff rows:** all entries in the detailed manifest checked by the builder
- **Additional external rows:** 4 included by ancestry or verified equivalent
- **Exceptions:** none
- **ZIP:** `artifacts/m5-22-036/TECHMAP-GRAPHER-0.63.36-m5-22-review-win-x64.zip`
- **Size / SHA-256:** `62,184,587 bytes / D3663B4ADEA10A5963BDBE789E5AE949C40DF523B320AA7B23A2206F9BF51A02`
- **PACKAGE-MANIFEST / portable:** PASS, 339 manifest entries (340 files including manifest); portable 7/7 PASS
- **Gate:** `PASS`; M5 manifest and external completed work chats reconciled to this code HEAD.

| Карточка / работа | Thread ID | Исходные commit SHA | Доказательство против code HEAD | Coverage |
| --- | --- | --- | --- | --- |
| M1-01 foundation/startup | `01a0931b…` | `85a99ac`, `56f550f` | `85a99ac` is an ancestor; `56f550f` is superseded by the current `StartupFailureReporter` and its tested startup handling | `included (equivalent)` |
| M1-07 exact units | `01a093e1…` | `76da503` | `CutLengthCalculator.cs` exact blob `0f46ef75…`; current `ExactUnits.cs` adds metre conversion; corresponding tests exist in HEAD | `included (equivalent)` |
| M3-04 E4 article placement and preview | Thread ID not established | `e0c0116e130e829775eecd68d7750184c9ede75a` | Placement/preview behavior is covered by the current E4 architecture and tests; the remaining keyboard/Enter/Space selection, accessible row metadata, and delete-event propagation behavior was restored with regression tests in `93ab279` | `included (equivalent + restored delta)` |
| Position rails | `01a0dee2…` | `ad33b10` | Feature `fd6a4b8` and improvement `b8e5d1e` are ancestors; current `position-rail.test.ts` is present | `included (ancestor)` |
| M3-04 package version bump | unknown | `67688b0` | Version-only change is superseded by current package version `0.63.36-m5-22-review` | `excluded (superseded metadata)` |

The earlier `m5-22-035` archive remains a blocked candidate and is superseded by
this verified `m5-22-036` slice. Owner acceptance, source-harness QA and the
390px visual review remain open in the M5-22 acceptance record; they do not
represent missing completed chat handoffs.

## Ожидающие рабочие чаты после M5-22

Следующий ZIP пока **заблокирован** до завершения рабочих чатов, получения их
проверенных commit SHA и подтверждения интеграции сборщиком. Регистрация не
означает, что изменения уже входят в собираемый HEAD.

| Карточка / чат | Thread ID | Исходные commit SHA | Доказательство против code HEAD | Coverage |
| --- | --- | --- | --- | --- |
| 080 — Редактирование точек изгиба пайпов | `01a11190-8a49-7423-a35d-6e75df977c8e` | ожидается handoff | нет; задача в работе | pending |
| 081 — Трассировка проводов через X4 и выход из оболочки | `01a1119a-83a3-7ad2-8b8f-bffd2668c411` | ожидается handoff | нет; задача в работе | pending |
| 082 — Приоритет выбора узлов поверх оболочек | `01a1119f-326d-7863-be97-7d30800b20db` | ожидается handoff | нет; задача в работе | pending |
