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

### m5-22-035 — 05.10.2026

- **Integration branch:** `codex/integration-m5-22`
- **Code HEAD:** `2d89d125f9468c4fa12d35d38e26fd0e52f9b054`
- **Coverage detail:** [`m5-22-manifest.md`](m5-22-manifest.md)
- **Registry/audit snapshot:** `chat-registry.md`, audit report 05.10.2026
- **M5 handoff rows:** documented in the detailed manifest; final audit by builder pending
- **Additional external rows:** 3 included/equivalent, 1 pending
- **Exceptions:** none
- **ZIP:** `artifacts/m5-22-035/TECHMAP-GRAPHER-0.63.35-m5-22-review-win-x64.zip`
- **Size / SHA-256:** `62,184,076 bytes / 37117C0E43E79F01C6180D99631526FC5C71C0E325F1CC45E6BD1F4055FD5C98`
- **PACKAGE-MANIFEST / portable:** PASS, 339 manifest entries (340 files including manifest); portable 7/7 PASS
- **Gate:** `BLOCKED` until M3-04 `e0c0116` is proven equivalent in full or its remaining relevant delta is integrated and rechecked.

| Карточка / работа | Thread ID | Исходные commit SHA | Доказательство против code HEAD | Coverage |
| --- | --- | --- | --- | --- |
| M1-01 foundation/startup | `01a0931b…` | `85a99ac`, `56f550f` | `85a99ac` is an ancestor; `56f550f` is superseded by the current `StartupFailureReporter` and its tested startup handling | `included (equivalent)` |
| M1-07 exact units | `01a093e1…` | `76da503` | `CutLengthCalculator.cs` exact blob `0f46ef75…`; current `ExactUnits.cs` adds metre conversion; corresponding tests exist in HEAD | `included (equivalent)` |
| M3-04 E4 article placement and preview | Thread ID not established | `e0c0116e130e829775eecd68d7750184c9ede75a` | Some placement behavior has current tests, but exact equivalent for the full 11-file change is not confirmed | `pending / blocker` |
| Position rails | `01a0dee2…` | `ad33b10` | Feature `fd6a4b8` and improvement `b8e5d1e` are ancestors; current `position-rail.test.ts` is present | `included (ancestor)` |
| M3-04 package version bump | unknown | `67688b0` | Version-only change is superseded by current package version `0.63.35-m5-22-review` | `excluded (superseded metadata)` |

The ZIP is an inspectable candidate, not a completed release, while this gate is
blocked. The builder must either reconcile the remaining M3-04 behavior and
repeat required checks for the resulting code HEAD, or produce evidence that
every remaining behavior is already covered by the current implementation and
tests before changing the gate to `PASS`.
