# Возобновление от версии 02:35: аудит и этапы

Дата: 2026-09-18. Основа: `b05c112e12a1ce737f9e1fd4bc5f1c084f796b70`
(02:35:29 МСК), ветка `codex/restore-20260918-0235`.
Работа ведётся в восстановленном корне репозитория. Старая `.build/e4-library-fix`
сохранена; отдельные исправления из неё перенесены после просмотра diff.
Прежние незакоммиченные изменения сохранены в stash `pre-return-to-b05c112-20260918-104118`.
Новых коммитов и отправки нет. Пользовательские проекты не используются для тестов.

## Аудит исходной точки

- Версия 0.17.4-m4-03-r4, SQLite 19. Документация заканчивается M4-03-r4;
  прежнее обозначение M3-03-r2 не соответствовало восстановленной ветке.
- При публикации библиотечного черновика preview получал новую версию,
  POST размещения — старую версию каталога. Артикул также вычислялся отдельно.
- Клиент поддерживал v5, сервер размещения и ограничения таблицы project-owned
  снимков принимали только v3/v4. Это воспроизведено на настоящем portable API.
- Валидатор v5 ошибочно требовал графические прототипы для независимых строк Э4.
- Удаление жгута существовало; UI/API удаления целого проекта отсутствовали.

## План и выполненные изменения

1. **M4-03-r5:** единый запрос из `preview.libraryBinding`, проверка идентичности
   templateId/version/hash/article и материализации; выбор первого артикула с
   контактами Э4. Клиент 713/713, .NET 659/659, ZIP и семь portable-режимов прошли.
   Настоящий API выявил оставшийся отказ v5: этот промежуточный ZIP не итоговый.
2. **M4-03-r6:** устранён отказ v5, добавлено удаление проекта, завершены полная
   проверка и итоговый ZIP `0.17.6-m4-03-r6`.

Размещение использует проверенный `componentPlacementRequest`: ID, версия и
артикул берутся из binding экземпляра, хэш остаётся в нём и его снимке.
Регрессия публикует более новый черновик относительно версии карточки и
отклоняет несогласованный ID, версию, хэш или артикул до POST.

SQLite 20 расширяет допустимый формат закреплённых снимков до v5 через штатную
миграцию поколения с резервной копией. Экспорт/импорт сохраняют v5 без понижения.
Валидация количества строк таблицы и ссылок на группы остаётся обязательной;
графические контакты для v5 необязательны.

Кнопка «Удалить проект» находится рядом с «Новый проект» и недоступна без
выбранного проекта. Модальное окно показывает обозначение, имя, число жгутов
и последствия. Начальный фокус — «Отмена», Escape отменяет; в полёте обе кнопки
заблокированы. Справка перенесена в InfoHint. Перед DELETE ожидается завершение
автосохранения; ошибка оставляет окно открытым. Проверяется ожидаемая ревизия,
удаление выполняется одной транзакцией. Общие справочники, библиотека, shared
blobs и резервные копии сохраняются. Отдельного восстановления удаления в UI нет.

## Проверки

- Клиентские регрессии: 717/717; TypeScript и production build проходят.
- Полный набор .NET: 664/664, без пропусков и ошибок.
- Проверки проектов: 127/127, включая CSRF, конфликт ревизий, rollback,
  удаление графа размещений, сохранность другого проекта и restart.
- Новый `scripts/test-library-placement.mjs` запускает packaged exe в новом
  изолированном data-root, использует production materializer/request builder,
  публикует v5 из черновика, размещает, повторно читает design/graph и проверяет
  идемпотентный повтор. С `--check-deletion` проверяет удаление только созданного
  тестового проекта, сохранность его копии и общей библиотеки.
- Настоящий API: размещён v5 с независимой таблицей Э4 без графических контактов,
  версия каталога 1, опубликованная и размещённая версия 2. Совпали templateId,
  version, SHA-256 и article; повтор идемпотентен. Устаревшая ревизия не позволила
  удалить проект; удаление синтетического оригинала сохранило его копию и библиотеку.
- На синтетическом проекте из пакета schema 19 выполнена миграция в schema 20;
  привязка размещённого компонента и её SHA-256 сохранились. Проверено наличие
  резервной копии `pre-update` со schema 19 и ревизией тестового проекта 1.
- Проверка браузером выявила фокус на InfoHint при showModal: исправлено явным
  переводом фокуса на «Отмена» после открытия. Escape сохраняет тестовый проект.
  После пересборки фокус проверен повторно: Enter вызывает отмену. Подтверждение
  удалило только созданный для проверки `UI-DELETE-TEST`; `API-SMOKE` остался.
  Визуально проверены компактное окно, соседство кнопок и скрытая справка InfoHint.
- Итоговый ZIP прошёл все семь portable-режимов, включая путь с пробелом.
- `git diff --check` проходит; коммиты и отправка не выполнялись.

## Итоговый пакет

`artifacts/m4-03-r6-final/TECHMAP-GRAPHER-win-x64.zip`

52 295 818 байт (49,87 МиБ), 26 файлов. SHA-256:
`DC98175456189C7F7030D3533C2A1592F2362F566629128F318EC3583568A637`.

Содержимое ZIP просмотрено: исполняемые файлы, клиент, лицензии, манифесты и
синтетический пример справочника. Базы данных, пользовательские проекты,
вложения, журналы импорта и резервные копии отсутствуют. Промежуточные пакеты
`m4-03-r5-resumed` и `m4-03-r6-resumed` не предназначены для передачи.
Локальные протоколы: `.build/m4-03-r6-final-build.log`,
`.build/m4-03-r6-final-portable.log`, `.build/final-api-smoke.json`,
`.build/schema20-ui.json`, `.build/final-zip-report.json`.

## Ограничения

Этот срез не является полной приёмкой V1. Данные пользователя и старые локальные
БД не открывались; миграция и удаление проверяются на синтетических данных.
Предупреждение Vite о JS-chunk >500 kB сохраняется и не блокирует production build.

## Изменённые файлы

- `docs/m4-03-r6-resumed-audit.md`
- `docs/work-state.md`
- `package/VERSION.json`
- `scripts/test-library-placement.mjs`
- `src/Techmap.Application/IApplicationBoundary.cs`
- `src/Techmap.Client/src/App.tsx`
- `src/Techmap.Client/src/component-library/template-model-v4.ts`
- `src/Techmap.Client/src/component-library/template-model-v5.ts`
- `src/Techmap.Client/src/DeleteProjectDialog.test.ts`
- `src/Techmap.Client/src/DeleteProjectDialog.tsx`
- `src/Techmap.Client/src/editor/component-placement-api.ts`
- `src/Techmap.Client/src/editor/component-template-placement.test.ts`
- `src/Techmap.Client/src/editor/component-template-placement.ts`
- `src/Techmap.Client/src/editor/HarnessDesignEditor.tsx`
- `src/Techmap.Client/src/InfoHint.tsx`
- `src/Techmap.Client/src/project-api.test.ts`
- `src/Techmap.Client/src/project-api.ts`
- `src/Techmap.Client/src/styles.css`
- `src/Techmap.Contracts/ApiContracts.cs`
- `src/Techmap.Infrastructure.Sqlite/ComponentTemplateContentV3Validator.cs`
- `src/Techmap.Infrastructure.Sqlite/ComponentTemplateContentV4Validator.cs`
- `src/Techmap.Infrastructure.Sqlite/ComponentTemplateContentV5Validator.cs`
- `src/Techmap.Infrastructure.Sqlite/SqliteProjectCatalog.cs`
- `src/Techmap.Infrastructure.Sqlite/SqliteProjectComponentSnapshotStore.cs`
- `src/Techmap.Infrastructure.Sqlite/SqliteProjectExportService.cs`
- `src/Techmap.Infrastructure.Sqlite/SqliteProjectImportService.cs`
- `src/Techmap.Infrastructure.Sqlite/SqliteStorage.cs`
- `src/Techmap.Web/ProjectEndpoints.cs`
- `tests/Techmap.Web.Tests/ComponentTemplateContentV5ValidatorTests.cs`
- `tests/Techmap.Web.Tests/ComponentTemplateMigrationTests.cs`
- `tests/Techmap.Web.Tests/HarnessDesignMigrationTests.cs`
- `tests/Techmap.Web.Tests/ProjectApiTests.cs`
- `tests/Techmap.Web.Tests/ProjectCatalogIntegrationTests.cs`
- `tests/Techmap.Web.Tests/ProjectComponentPlacementApiTests.cs`
- `tests/Techmap.Web.Tests/ProjectComponentPlacementPortabilityTests.cs`
- `tests/Techmap.Web.Tests/ProjectComponentSnapshotStoreTests.cs`
- `tests/Techmap.Web.Tests/ReferenceCatalogSearchMigrationTests.cs`
- `tests/Techmap.Web.Tests/ReferenceCatalogSearchProjectionTests.cs`
- `tests/Techmap.Web.Tests/SqliteStorageIntegrationTests.cs`
