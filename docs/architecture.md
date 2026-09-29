# Восстановленная архитектура

## Границы системы

TECHMAP-GRAPHER — локальное Windows web-приложение. Запускаемый сервер и статический React-клиент поставляются одним self-contained win-x64 архивом, а рабочий data-root находится отдельно. Экспорт проекта — отдельный переносимый архив.

## Слои и зависимости

```text
Browser / React + TypeScript (src/Techmap.Client)
                 │ HTTP JSON / binary attachments
ASP.NET Core Web (src/Techmap.Web)
                 │ contracts + application ports
Application services (src/Techmap.Application)
                 │ domain rules / repositories
Domain model (src/Techmap.Domain)
                 │ SQLite adapters, CAS, import/export
Infrastructure.Sqlite + Infrastructure.GoogleSheets
```

- `Techmap.Contracts` содержит DTO, ошибки, версии API и runtime-конфигурацию.
- `Techmap.Domain` содержит идентичности проектов/жгутов и инварианты предметной области.
- `Techmap.Application` задаёт границы хранения и операции над проектами, справочниками, шаблонами, маршрутами и картой резки.
- `Techmap.Infrastructure.Sqlite` реализует поколенческое SQLite-хранилище, backup/restore, импорт/экспорт, вложения и snapshots.
- `Techmap.Web` связывает DI, security middleware, startup maintenance и endpoint-модули.
- `Techmap.Client` хранит редакторскую модель, команды, физическую топологию, связанные виды и manufacturing workspace.

Границы подтверждены регистрацией сервисов в `src/Techmap.Web/Program.cs`, endpoint-модулями и интерфейсами Application. **Источник: найдено в коде**.

## Запуск и владение data-root

1. `Program.cs` читает `ServerOptions`: порт, path base, data-root, backup-root и offline-команды.
2. Для обычного запуска `DataRootLease.Acquire` создаёт эксклюзивное владение. `LocalInstanceRecord` публикует сведения о владельце; при конфликте `BrowserLauncher` переиспользует доступный экземпляр.
3. `DataRootLayout.Initialize` создаёт маркер формата и каталоги. Затем выполняются миграция, pre-update backup и проверка schema version.
4. SQLite открывается через `SqliteStorage`; регистрируются stores/services и hosted backup policy.
5. Kestrel слушает loopback. Middleware проверяет точный loopback authority, path base, session и mutation cookie.
6. После регистрации API и static files браузер получает runtime-config с app/API/schema версиями.

Это последовательность фактического старта в `Program.cs`, `ServerOptions.cs`, `DataRootLayout.cs`, `LocalInstanceRecord.cs`. **Источник: найдено в коде**.

## Данные и транзакции

SQLite разбит на поколения; указатель current generation и миграционный сервис позволяют подготовить новую схему до переключения. Backup policy делает резервную копию до обновления и фиксирует успешный запуск. Проектные вложения хранятся content-addressed, а каталог и шаблоны используют version/snapshot records. Ревизия проекта и expected revision защищают сохранение от тихого перезаписывания.

Полный backup/restore выполняется отдельными offline-командами с dry-run, планом, pre-restore backup и явным confirmation file. Проектный import/export не является копированием всего data-root. **Источник: найдено в коде** (`SqliteStorage*`, `Program.cs`, `ServerOptions.cs`, `ProjectExport/ImportService`).

## Общая модель редактора

`HarnessDesignDocument` является общим документом жгута. В нём присутствуют соединители/контакты, провода/кабели, маршруты Э4 и чертежа, слои, физическая топология, размеры, оболочки, узлы, diff-pair и screens. `EditorCommand` — единственный типизированный вход для изменений; `applyEditorCommand` после команды выполняет нормализацию физической топологии, автоматическую маршрутизацию и сверку размеров/документов.

Физический граф (nodes, segments, joining pipes, coverings) не смешивается с электрическими endpoint/junction связями. Представления ссылаются на стабильные ID; координаты и масштаб могут отличаться между Э4 и чертежом. **Источник: найдено в коде** (`model.ts`, `commands.ts`, `physical-topology-*`, `drawing-*`).

## Manufacturing и связанные виды

Manufacturing route-модули получают источники из сохранённого design document, строят строки маршрута и выполняют readiness/rebase проверки. Операции, терминалы, материалы и фотографии являются ссылками или вложениями проекта, а не независимыми копиями исходных физических объектов. Cut-list endpoint повторно проверяет readiness на сервере. **Источник: найдено в коде** (`manufacturing/*`, `HarnessCutListEndpoints.cs`).

## Recovery и отказоустойчивость

Recovery-журнал расположен в data-root вне экспортируемого проекта. `HarnessDesignRecoveryEndpoints` даёт GET/PUT/DELETE по project/harness/draft ID; журнал ограничивает размер 1 MiB и защищает sequence conflict. Клиент после успешного сохранения удаляет только архивы, созданные текущим restore flow (исправление `2ba1562`). **Источник: найдено в коде**.

## Поставка

`scripts/build-package.ps1` публикует клиент, сервер и `PACKAGE-MANIFEST.json`; сервер в packaged build проверяет манифест до запуска. Текущий зафиксированный пакет описан в `docs/m5-07-acceptance.md`; ZIP и `artifacts/` намеренно не входят в Git. **Источник: найдено в коде** (скрипты и acceptance protocol).

## Наблюдаемые ограничения

- В текущей среде прямой portable-запуск из пути с кириллицей иногда получает `UnauthorizedAccessException`; тот же архив проходит через ASCII drive alias. Это ограничение среды проверки, а не доказанный дефект приложения. **Источник: найдено в коде** (протокол portable-проверки).
- Автоматические тесты не заменяют ручную визуальную приёмку маршрута и сложных UI-сцен. **Источник: предположение**, основанное на явно отмеченном ограничении acceptance.
