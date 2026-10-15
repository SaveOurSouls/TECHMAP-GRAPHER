# Release coverage

## 099 — пропорции и прозрачность изолированного флажка, 15.10.2026

`84648422ce335619e2fa8a9a95324a3d666bda1c` опубликован непосредственно в integration-ветке: изолированный flag по C1 `f8726991`, полупрозрачный компактный профиль и лист сравнения. PASS: 57 SVG / 25 контрактов, 48 прочих отдельных SVG неизменны, воспроизводимость и визуальный review. Только дизайн, runtime/ZIP не менялись. Перед следующей поставкой подтвердить ancestry и handoff 099.

## 099 — плоская проекция и присоединение флажковых, 15.10.2026

`ff1a5b3ddf60622a740c766d39bed307d0f81b39` опубликован непосредственно в integration-ветке. C1/C2: компактный открытый обжим, трубка снизу под головкой у обоих опрессовочных; изолированный строго 2D. Проверки 56 SVG / 25 неизменных контрактов, воспроизводимость и визуальный просмотр PASS. Coverage: только дизайн, без runtime/ZIP. Перед следующей поставкой подтвердить ancestry данного SHA и handoff 099.

## 099 — четыре исполнения флажкового, 15.10.2026

`96c47a786e67d8f5cce073b36cbcc08152d50a4a` опубликован непосредственно в integration-ветке. Цельный изолированный, открытый обжимной, гладкий и рифлёный трубчатые опрессовочные варианты; 25 ассетов / 56 SVG, сохранность контрактов и визуальный review PASS. Coverage — только дизайн; runtime/ZIP не заявлены. Перед следующим ZIP подтвердить ancestry этого SHA и документационного handoff 099.

## 099 — розетки по C1 `af5ec56d`, 15.10.2026

`faf94638902896fd0f25eac6de8d854301639cf6` опубликован и интегрирован непосредственно в `codex/integration-m5-22`. Две формы и лист сравнения, 49 SVG / 22 неизменных контракта; структурные, геометрические и визуальные проверки PASS. Только дизайн; runtime и ZIP не изменены. Перед следующей сборкой подтвердить ancestry данного SHA и handoff; это продолжение design-only результата 099.

## 099 follow-up — 15.10.2026, уточнённые векторные профили

`e1259fc333d642e3e861cf8d29c6a1300b228d61` опубликован в integration-ветке;
48 SVG/22 ассета, проверка XML/ID/якорей, воспроизводимости и визуальный просмотр
четырёх листов PASS. Результат — дизайн по C1–C3 от 15.10, runtime и ZIP не менялись.
Перед следующим ZIP подтвердить ancestry вместе с документационным handoff 099.

## Карточка 099 — 14.10.2026, план и дизайн

Чат `01a13a64-e264-7a03-8198-49dae2c51bee`, ветка `codex/integration-m5-22`.
Объём поручения: проектирование и векторные рисунки многопроводных оконцовок, REQ-135.
Код приложения и ZIP не входят в этот срез. Будущие этапы внедрения A–F описаны
в `docs/design/multi-wire-termination-plan.md` и не начаты. Этот документальный
срез нельзя выдавать за доступные функции следующего ZIP. SHA и проверки
зафиксированы в handoff 099: `2c69636bc56f27e7f28008cc12fc3ef74782dc2c` опубликован,
документальный срез находится в integration-ветке. 47 SVG/22 ассета, якоря/XML/IDs,
29 локальных ссылок и diff-check PASS, три обзорных рисунка визуально просмотрены.

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
| 080 — Редактирование точек изгиба пайпов | `01a11190-8a49-7423-a35d-6e75df977c8e` | `7d51a673a0cba9d0654dd54d1f2c28472a8cf984`, `c34f1d61dfb2844482730fd538eca20de3b4ac60`, `17914c2d19271315fccd70077e870faffaf3dec8`, `e40ffd09b0f770665eedafb445bce209e60de056`, `d971f0d`, `eff2e27` | All code and handoff SHAs passed `git show --check` and are ancestors of current HEAD | included (base + all follow-ups) |
| 081 — Транзит через соединитель и выходы из защитной оболочки | `01a1119a-83a3-7ad2-8b8f-bffd2668c411` | `fdc5c7c7e1121d91f21f7a0ffb1c8e06ebc4d534`, `ebcf790be27d7ae8701b7aed86bb952c3a1db2b0`, `b207b1f206b7dc3467c2a4479224fc857d31e781` | Code equivalent `5eeb02f`, handoff `ca55a20`/`e918e18`; source checks PASS; common physical-topology test retains 080 regression | included (M5-22-037) |
| 082 — Приоритет выбора узлов поверх оболочек | `01a1119f-326d-7863-be97-7d30800b20db` | `37a8d0a5b2b42c33f049284a6f135c99e551c357`, corrected handoff `e345f5f2d1edcde6408be7c46ff1b66ec3ee4a8b` | Code equivalent `7aaaf46`; source blobs verified; corrected handoff identity confirmed | included (M5-22-037) |
| 083 — Маршрут v2: карточки, состав C2 и изолированный рисунок | `01a0ee02-09d6-7790-98a3-d74947735e63` | `bfb0906`, `97d4a56`, `ab801fc` | все SHA — предки integration HEAD | included (ancestor) |
| 084 — Маршрут v3: графические слепки и генерация по зависимостям | `01a111fa-93ab-79b3-9089-7ec8ca14c393` | `9c15918`, handoff `0cfb983` | оба SHA включены merge в integration HEAD; handoff в `agent-handoff.md` | included (ancestor) |

### m5-22-038 — 06.10.2026 (проверенный ZIP)

- **Integration branch:** `codex/integration-m5-22`
- **Code HEAD:** `4be527d45f81ae1daf4aa4b72d0a1a7573bff542` (исходная кодовая база `f410e43df8048765c933eebfba8a50b778c88aa6`)
- **Coverage detail:** [`m5-22-manifest.md`](m5-22-manifest.md), раздел M5-22-038
- **Registry/audit snapshot:** 06.10.2026, refs audit after `fetch origin --prune`
- **Handoff rows checked:** 3/3 new refs; all `git show --check` PASS
- **Pending or unknown:** `0` for Git inclusion; owner/manual acceptance remains a separate release gate
- **Exceptions:** 082 and 081 included through verified ancestor-equivalents; 084 code is ancestor, docs already current in registry/task/ADR
- **ZIP:** `artifacts/m5-22-038/TECHMAP-GRAPHER-0.63.38-m5-22-review-win-x64.zip`
- **Size / SHA-256:** `63,980,096 / 0ED7DDD6995C32E7582D8A432829FA9F35E094927E0499A305AFA9757A67D9C7`
- **PACKAGE-MANIFEST / portable:** `PASS; 339 manifest entries / 340 files; 7/7 portable`
- **Gate:** `PASS` for Git/reproducible package coverage; owner acceptance is separate and remains open

| Карточка | Исходные SHA | Доказательство | Coverage |
| --- | --- | --- | --- |
| 082 | `37a8d0a`, `03d7474`, `3a51979`, `e345f5f` | code exact file match/equivalent `7aaaf46`; corrected identity in audit | included (equivalent) |
| 081 | `fdc5c7c`, `ebcf790`, `b207b1f` | code equivalent `5eeb02f`; docs `ca55a20`/`e918e18` already ancestry | included (equivalent) |
| 084 | `9c15918`, `0cfb983`, `2174599` | first two ancestors; final ref docs-only and current registry/task/ADR match | included (ancestor + docs coverage) |

| 085 — Свойства размеров и индексы материалов на Чертеже | `01a116cf-8c36-79b3-89ca-57fa146c0046` | `723ff99350476255dcdae2de5442cf761c9720c2`, handoff `7241134db77f2b8ecfdf96d13e92513eaa814a68` | оба SHA — предки integration HEAD; `git show --check` PASS | included (ancestor) |
| 086 — Карточки UML в Route v3 | `01a111fa-93ab-79b3-9089-7ec8ca14c393` | `0a3c04a0480b7eee1820b56cc2450a8f6ec5c83d`, handoff `6e274c42dd5a7082dc9bb9233b82e0cebd0f8a3a` | оба SHA включены merge в integration HEAD; `git show --check` PASS | included (ancestor) |
| 087 — Пересборка точек П после добавления ОП | `01a13055-229d-7a92-8a20-b0bf25a3671c` | `cf34ec5e58ef7cfb725e855eaf09148f9f15a52c`, `e145d2ca6fda6a02724a561b370f4ffc0622d385`, handoff `dce7105` | все SHA проверены сборщиком как ancestors текущего integration HEAD; `git show --check` PASS | included; pending final ZIP |
| 088 — Маршрут v3: рисунки проводов из Э4 | `01a13071-75d8-75e0-bad6-5e2c1f86f614` | `3c6a5fb0b76fb7a236c30bb55dc385b0a2ea3171`, handoff `ca49fc3` | оба SHA проверены сборщиком как ancestors текущего integration HEAD; `git show --check` PASS | included; pending final ZIP |
| 089 — Совместимые уплотнители в библиотеке компонентов | `01a13090-15e1-7123-a91d-eecf1a2eb900` | `e86aa33f35bed40bf7d7a98ccc6862b4cadc9468`, `11ab633`, `f10f004da6885723fd2cf6902f9a1d9245c68103`, handoff `6ce3e2a`, follow-up handoff `c419918` | все SHA — предки code HEAD M5-22-043 `8162857` | included in M5-22-043; accepted владельцем 13.10.2026 |
| 090 — Редизайн оконцовок провода по C1 | `01a13091-f350-7b62-b8b0-9ca77cf1ad58` | `e47f99e2b8044b85d7703359234477de1f3a0821`, handoff `47964b2`, follow-up `e22862d`, handoff `d04c059` | все SHA — предки code HEAD M5-22-043 `8162857` | included in M5-22-043; accepted владельцем 13.10.2026 |

| 090 follow-up 13.10 — выход меди из изоляции | 01a13091-f350-7b62-b8b0-9ca77cf1ad58 | code `e22862d0051f54dec3629787dc84eb3b38296111`, handoff `d04c059` | оба SHA — предки integration HEAD `2ea885b7d79302e5393c552f517f71cea789efbf`; исторический handoff имеет предупреждения `git show --check` о CRLF | included (ancestor) |

| 093 — Route v3: обновление исходника и операции карточек | `/root`, исполнители `/root/terra` и `/root/luna` | code `02dc3d60375e84966382ef29ba826679c1d6ceb2`, handoff `ec36ffb71be99769aff61c3692d558918de1df24` | оба SHA — предки integration HEAD `26787085a4a0a70f4074ddb294e4400325ca21a4`; `git show --check` PASS; Vitest 193/1856, typecheck, build, Playwright 1440/390 px — PASS | included (ancestor); следующий ZIP pending, ручная приёмка открыта |

| 097 — Route v3: продукция операций и выбор входных полуфабрикатов | `/root`, исполнители `/root/terra` и `/root/luna` | code `a59174c4ee9e91fe3194a2c9ebeed9e4f9187a17`; handoff — текущий документальный коммит | REQ-133; SHA находится в integration HEAD (ancestor), Vitest 195/1874, typecheck/build и Playwright 1440/390 PASS | included (ancestor); следующий ZIP pending, ручная приёмка открыта |
| 091 — Чертёж: граница оболочки и витая пара | `/root` | code `1a76bbaa8964280362a637c4415e365b16a1588a`, handoff `ac4e2c5` | оба SHA — предки integration HEAD `2ea885b7d79302e5393c552f517f71cea789efbf`; `git show --check` PASS | included (ancestor) |
| 092 — Свойства полуфабрикатов и карта резки | `/root` | code `89443d6073c47730d181caec9a40b4717baff736`, `f8de2612ebad386b308216953c1e96be4c2f70cc`, handoff `f052577` | все SHA — предки integration HEAD; `git show --check` PASS | included (ancestor) |
| 094 — Единица сечения из записи каталога проводов | `/root` | code `dd13db7`, handoff `2ea885b` | оба SHA — предки integration HEAD; `git show --check` PASS | included (ancestor) |
| 096 — Подписи и компоновка полуфабрикатов V3 | `/root`, исполнители `/root/terra` и `/root/luna` | code `b241e811649eaa7224c9db0d15ed13f665b3dc88`, handoff `0bdfdc338798a03db75a394dec133314b35798df` | оба SHA — предки integration HEAD `428ba1f020da11b82e4dced5e58dc559093da597`; `git show --check` PASS | included (ancestor) |
| 098 — Подписи сырья и иерархия БД.ОП в Route v3 | `/root`, исполнители `/root/terra` и `/root/luna` | code `fc09295`, CSS follow-up `033e669`, handoff `1349f15`, status `c32f925` | все SHA — предки integration HEAD `e71f52a2f905bab8da65651f92554ad71c49895a`; `git show --check` PASS | included (ancestor) |
| 099 — Проектирование многопроводных оконцовок | `/root` и design subagents | дизайн-only code-free task; handoff `e71f52a` | явно отложено за границы ZIP: реализация не заявлена, ZIP не запрошен | excluded (design-only) |

### m5-22-045 — 14.10.2026

- **Integration branch:** `codex/integration-m5-22`
- **Code HEAD:** `76f028bcfcdd1dca090ae61ac6a4def3cdc05a9f`
- **Coverage:** 098 included (ancestor); 099 excluded (design-only); pending/unknown `0`
- **ZIP:** `artifacts/m5-22-045/TECHMAP-GRAPHER-0.63.45-m5-22-review-win-x64.zip`
- **Size / SHA-256:** `64 024 728 / B5D8C5AB38E86059101CEDBB94BE70DE46510C3C0A5130FDFDE6232F34D075E2`
- **Manifest / portable:** `PASS; 339/340; 7/7`
- **Gate:** `PASS` для Git и package; ручная и owner acceptance открыты

### m5-22-044 — 14.10.2026

- **Code HEAD:** `6da7e7ca75ea9c927daf3226ad8835f1835d54e8`
- **Handoffs:** 095, 096, 097 и предыдущие release rows подтверждены ancestry
- **ZIP:** `artifacts/m5-22-044/TECHMAP-GRAPHER-0.63.44-m5-22-review-win-x64.zip`
- **Size / SHA-256:** `64 022 953 / EE040A161AB764E0929C354CD29CD4AEB931AB080B03D2F6591380314896D25B`
- **Manifest / portable:** `PASS; 339/340; 7/7`
- **Gate:** `PASS`; ручная и owner acceptance открыты

### m5-22-043 — 13.10.2026

- **Integration branch:** `codex/integration-m5-22`
- **Code HEAD:** `81628571106e0b138db5731b776e5294e6e4aa4d`
- **Coverage detail:** строки 090 follow-up, 091–094 выше; все handoff подтверждены как ancestors
- **Pending or unknown:** `0` для Git inclusion
- **ZIP:** `artifacts/m5-22-043/TECHMAP-GRAPHER-0.63.43-m5-22-review-win-x64.zip`
- **Size / SHA-256:** `64 012 360 / 5F3A431A4AB0090426A0CA2FB51F04ED068EA1EC9C774F0931B74C38597796C2`
- **PACKAGE-MANIFEST / portable:** `PASS; 339 записей / 340 файлов; 7/7 из C:\Temp`
- **Gate:** `PASS` для Git/package coverage; ручная и owner acceptance открыта

| 101 — Таблица операций Route v3 | `/root` | code `a808a25db9a1a8dd5bb56a33dc87700c718e28ad`; handoff — документальный срез 101 | REQ-137; code является ancestor integration HEAD; 195/1878, TypeScript/Vite, Playwright PASS | included (ancestor); следующий ZIP pending, приёмка открыта |

| 102 — Вид проводов в строке ПФ | `/root` | code `30688f622129bd3114e44968aa86f03641442190`; handoff — документальный срез 102 | REQ-138; ancestor integration HEAD; 195/1878, TypeScript/Vite, Playwright PASS | included (ancestor); следующий ZIP pending |

| 103 — Прямые колонки вида и рисунок ПФ | /root | code ca6cebaa72e0c723d8736c08fc77fad4bf92923a; handoff — документальный срез 103 | REQ-139; ancestor integration HEAD; 196/1880, TypeScript/Vite, Playwright PASS | included (ancestor); следующий ZIP pending, приёмка открыта |
