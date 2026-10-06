# Полный manifest M5-22 — 05.10.2026

Версия: `0.63.34-m5-22-review`. Ветка: `codex/integration-m5-22`.
Worktree: `C:\Users\anqla\OneDrive\Документы\ChatGPT\HARNESSTECHMAPGRAPHER\_m5_22_safe`.
Основа: `60d30576872e5bb280bf996be4fa8c6f16cd3f6c`; ранее выданный пакет:
`0.63.33-m5-21-review`, код M5-21 `d90b0054baadc95c14e97812b145e550cabebb7d`.
Все исходные SHA разрешены через `git show`. Подтверждение наличия означает
ancestry либо проверенный перенос/эквивалент, а не существование hash в другом worktree.
Документ подготовлен до упаковки. Результаты финального среза и build SHA:
[протокол M5-22](../m5-22-acceptance.md).

Фактический итог: code commit `8e15df7046a79fa6b2c299d5a9dff091d4dfd0fb`;
package содержит 340 файлов, ZIP 63 957 754 bytes, SHA-256
`686131376F371CBE0CDA990140A1B3F8FA0530E59D3FA6A4BC591E2A4E890C8D`;
portable gates 7/7 PASS.

## Новые завершённые handoff

| Работа | Исходные коммиты (порядок) | Решение интеграции |
| --- | --- | --- |
| Route v2 | `63227429f1b246c921b0385744ac873534cbf7f4` → `94058911c887aba6001fad497f7d289a4be56963` → `fbef55e9ca56552300f45a9b48db133d6b72e5e1` → `f7623b9fc8d791219a562051d826fc4ef82c7023` | Первые три уже предки основы. Cancel fix перенесён как `8fc455889a8ca519e465e1fbe7ef02ffebcd67ee`; оба V2 code-файла совпадают с source fix. |
| Контекстная панель и общий handoff | `fbef55e9ca56552300f45a9b48db133d6b72e5e1`, `6e4dbf5091d0f9d291e159c601e83bc16ecf386d` | Код уже есть; общий документальный SHA перенесён один раз как `6a8f435`, сохранив QA Cancel. |
| L+/L− | `7217377a73ef955a865066718f20cb5fd4310b53` → `64afbda9fde0fd97d1e3cafc00e17d372f84e772` | Оба уже предки; повторно не применять. Сохранены REQ-105/карточка 074. |
| Э4 drawing gestures/selection | `43e65568a6ece068ef194795f352bdee00a2ea25` → `0c5e2a2c6269e0201a6dd035b14072472aa5fcf6` | Код уже предок; финальная документация перенесена как `e92bf88`. |
| Независимая ширина оболочек ОП | `60d30576872e5bb280bf996be4fa8c6f16cd3f6c` | Основа уже включает код и тесты REQ-106. |
| Contact-side card | `8d810e5c83c42c86bd2821cba669d0eccf2e2631` | Перенесён как `c8570b9`; статус, добавить, выделить, скрыть. |
| Contact-side placement API | `35e38c33eeced099c6d6d67cfd91a7e884334a9d` | Перенесён как `f01e8f6`; независимые положение/масштаб и закреплённый E4 view. |
| Contact-side rendering | `19bc5436a20c92444e157389f39a1add3f62d6ca` | Перенесён как `ef7410e`; canvas/editor интеграция и пунктирная связь. Конфликт requirements сохранён с новым ID. |
| Contact-side verification | `832c5c3c743178791c1ad2983f62ca5685187f20` | Перенесён как `819f208`; сохранены обе ветви status. |
| Contact-side drag/scale regressions | `d43f54218c2b012bcd64cff1ddf7dc01392b3b4c` | Перенесён как `2cb06a4`; сохранены текущие free-end tests и новые contact tests. |
| Contact-side supply handoff | `36a96d5e59941ac3b1acc7e209974bb0e766a72a` | Перенесён как `f331ed1`; полная цепочка подтверждена. Итоговая карточка 076/REQ-107 не конфликтует с терминалами. |
| Навигация | `42b0cfa88d40c0fad1822edf8ed6e7ded1b3ecd3`, `d34aaabb097952869701bd5a36ef62f08dcaeb19`, `6064bb92e5728996028e7f2d4c9b4ac1e0135edc` | Все три уже предки; подтверждено фактическое единое оформление. |
| Artwork: texture/volume/rectangular | `8676a1e9a538c7c55735eefa3195313782b80e23` | Уже точный предок. Сохранены useId, Metal049A/catalog texture, объёмная светотень, прямоугольная геометрия. |
| Artwork: изоляция и pinned assets | `7fc3af2f266067a8ed60b1144d833b6ef12693e7` | Уже точный предок. Сохранены covering-only preview, подавление background/toolbars/title, centered length, pinned URL и fallback. Не применять второй раз. |

## Сохранение ранее подтверждённых изменений / M5-21

M5-21 не является exact ancestor выбранной новой ветки. `git cherry -v HEAD
d90b005` выявил только семь неэквивалентных старых коммитов: `bb36468`,
`924b2b6`, `331ab5c`, `4fff3cf`, `6449d7f`, `b43c63b`, `d90b005`.
Ниже учтены все их продуктовые изменения; старые version/package-протоколы
не объявляются результатом M5-22 и не подменяют новую версию.

| Ранее переданная работа | Исходные коммиты | Решение |
| --- | --- | --- |
| Последняя фактическая база | `f8d992106e8ec7138b185d71f8869d021e6ff6ce` | Предок новой основы. |
| Единая таблица ПФ и документы | `027eb7756e4d6c301ce9d59d666a118422836f2d`, `2005970623cfad9628a7ae8d52032918ba3492e1`, `0a7ae7606eb7ccc92598722bfa0155e566addad1` | В основе через эквиваленты `bdafa4d`, `83f2082`, `66a6dfb`; самостоятельные строки/метрики сохранены. |
| Старый artwork handoff | `fb80d0de9f13bb94d961da23af203e19db101ab9`, `f86afa1ade669555d634b8fdb7340b61929c5727` | Код fb80 уже предок; прежний документальный результат уточняется новыми 8676/7fc handoff и финальной проверкой, без возврата старого renderer. |
| Изолированный фрагмент | `bde0fb3b6ea70a12d326426d53219746dd030026`, `cf3ab2d5e80057dd3b385d0eb386d56d80727d5b` | Оба уже предки; сохранены редактор, изгибы/концы/оконцовки и handoff. |
| Коллизия ОП / финальный handoff-070 | `b7515729c503e853c14c8349c00a5a4671ef2065` → `5a6d08217e36b27f0f9e578fec839984b77540ab` → `51a787caa094f2e796a754548019be69fa1b4265` → `03e37315f34bf3b927d1e95f8ae71f59039de4b1` → `563061f58b4623754c3bcced9a0cd6e8204f45dc` | Вся цепочка уже предки, повторно не применять. |
| Startup ACL fallback | `ea3a562665306411b88f5b67b2d1ea938eee12c4` / M5-21 `6449d7fc233c30da54a262b1805052f809b9beef` | Восстановлен узкий продуктовый patch StartupFailureReporter; blob `fbc6aa917ee7a9ac5ab69648abf82994e7f08538` совпадает с source. |
| Utility panel / lock | `fc435f454f0923e4615e4417c55a17d840d631b7` / `4fff3cf249689a0e08c9ea64387f50aa0f468030` | Восстановлены SVG замок/aria, constrained 244px panel с текущими ribbon offsets; сохранён DnD порядок. |
| Удаление каждого этапа | `d1e6379bab3365d5693f3c505e106e2a777edb51` / `924b2b6b24de7331fab3adb881c844fd0ade23cb`, assertion из `331ab5c9791a2dc48e107d62c02ae19d3f50c287` | Восстановлена generic stage deletion/confirm/detach и кнопка под номером, совместимый semiFinished API. Карточка 077/REQ-108 устраняет коллизию со старой 057/REQ-083. |
| Адаптивные слои | `2c14bd799d4cf2734ff4695457882025daae18bb` / `bb36468bc58a536ba8332fab76fac00c4bf24239` | Старые arrow-order grids заменены новым подтверждённым DnD UI. Их CSS не переносится поверх DnD: изоляция/lock/visibility остаются доступны в текущей компактной сетке. |
| PF deletion / operation chooser | `6c3a6eeeabdfd6355b79e68bff16fa7bcb29e2c9` | Эквивалент `cd87679928dfe629d04e1ae1d206d653bbc49045` уже предок; RouteOperationChooser побайтно соответствует M5-21. |
| Серверная тестовая компиляция | `b43c63beb8b92aafdd0f42369c366984815a018e` | Только raw-string/newline/null-forgiving repair перенесён как `12db684`; старые appVersion/acceptance docs не переносились. |

## Подтверждённые библиотечные CAD/JST assets

- CAD source `8b91a5535e7691e5d5b4c84b0ce3df917160714d` эквивалентен
  уже включённому `2cdb8c2d6524b0202ed54e9ea7160674652d4c7f`.
- JST source `2d335a465773bf06fcc32fa6416f8ced44a165b3` эквивалентен
  `98bcf94a258dad44e897c9a727663d5c0ffef8c6`.
- JST half-contact/terminal correction `4e4d186c175374f862df67b8b1ba483d23d5ef65`
  перенесён как `44a78dc`; все 46 source delta-файлов сохранены.
- Штатный builder включает обе папки в `LibraryAssets/` ZIP. Это готовые файлы
  для библиотеки; они не импортируются автоматически в пользовательские БД/каталоги.

## Исключения и границы

- `20a6583`, `8616828`, `14454b9`, `ec99e23`: параллельные/устаревшие contact
  варианты, заменены единственной подтверждённой шестикоммитной цепочкой.
- Незакоммиченный код чужих worktree, их localStorage/БД и диагностика не включены.
- Существующие ручные ограничения сохраняются: owner acceptance, пользовательский
  жгут, визуальная narrow QA 390px; V2 остаётся localStorage-прототипом.
- Длинные Windows пути — известное ограничение takeover. Все семь portable gates
  проверяются из отдельного короткого корня с пробелами и кириллицей.

## Итоговый coverage и ZIP M5-22-036 — 05.10.2026

Предыдущая таблица фиксирует состав интеграционного кода `8e15df7` и M5-22-034.
Для последнего release candidate выполнена дополнительная сверка зарегистрированных
рабочих чатов и завершённых коммитов; все оставшиеся продуктовые дельты разрешены
в HEAD `b9b6c24f3597cef6d3306ff23d87136090f8a1b7` или подтверждены эквивалентом.
Полный gate и внешние worktree refs перечислены в
[`release-coverage.md`](release-coverage.md).

| Дополнительная работа | Исходный commit / Thread | Решение для M5-22-036 |
| --- | --- | --- |
| M1-01 startup failure | `85a99ac`, `56f550f` / `01a0931b…` | Основа `85a99ac` в ancestry. Поздний `56f550f` заменён текущим более полным `StartupFailureReporter` и startup tests. |
| M1-07 exact units | `76da503` / `01a093e1…` | `CutLengthCalculator.cs` совпадает по blob `0f46ef75…`; точные единицы и тесты присутствуют в текущем HEAD. |
| M3-04 E4 placement/preview | `e0c0116e130e829775eecd68d7750184c9ede75a` | Современные placement/preview поведения покрыты текущей архитектурой и тестами; keyboard, Enter/Space, доступные метаданные строки и защита delete от ложного выбора восстановлены с тестами в `93ab279`. |
| Position rails | `fd6a4b8`, `b8e5d1e`, ветка `ad33b10` / `01a0dee2…` | Оба функциональных коммита ancestry; текущий regression test включён. Повторно branch tip не переносить. |
| M3-04 version-only update | `67688b0` | Только старый appVersion; superseded версией M5-22-036. |

Финальная сборка создана из branch `codex/integration-m5-22`, HEAD
`b9b6c24f3597cef6d3306ff23d87136090f8a1b7`, appVersion
`0.63.36-m5-22-review`. ZIP:
`artifacts/m5-22-036/TECHMAP-GRAPHER-0.63.36-m5-22-review-win-x64.zip`,
62,184,587 bytes, SHA-256
`D3663B4ADEA10A5963BDBE789E5AE949C40DF523B320AA7B23A2206F9BF51A02`.
Client 183 files / 1790 tests, server 1117 tests, performance 1/1, manifest
verification and portable 7/7 passed. The manifest lists 339 payload files; the
extracted package contains 340 files including `PACKAGE-MANIFEST.json`.

Release coverage gate: **PASS**. M5-22 owner acceptance, source-harness QA and
390px visual review remain open product acceptance items; they are recorded in
the acceptance/status docs and are not omitted completed chat handoffs.

## M5-22-037 release record — 06.10.2026

Code HEAD: $code; appVersion:  .63.37-m5-22-review.
ZIP: $zipRel; size $bytes bytes; SHA-256 $sha.
Manifest verification: 339 payload entries / 340 package files — PASS.
Portable verification: 7/7 PASS from C:\Temp\TECHMAP-portable-m5-22-037.
Cards 080, 081 and 082 are included in release coverage; 081/082 are recorded as
verified equivalents in docs/coordination/release-coverage.md.
