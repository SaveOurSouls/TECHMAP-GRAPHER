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
