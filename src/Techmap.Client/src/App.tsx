import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalSession } from "./local-session";
import {
  createProjectApi,
  type ProjectDetails,
  type ProjectStatus,
  type ProjectSummary,
} from "./project-api";
import type { RuntimeConfig } from "./runtime-config";

interface AppProps {
  readonly config: RuntimeConfig;
  readonly session: LocalSession;
}

interface ProjectFormState {
  readonly designation: string;
  readonly name: string;
  readonly batchQuantity: string;
  readonly status: ProjectStatus;
}

const sections = ["Проекты", "Схема Э4", "Чертёж", "Маршрут", "Справочники"] as const;
const statusLabels: Readonly<Record<ProjectStatus, string>> = {
  draft: "Черновик",
  active: "В работе",
  completed: "Завершён",
};
const emptyCreateForm: ProjectFormState = {
  designation: "",
  name: "",
  batchQuantity: "1",
  status: "draft",
};

function projectSummary(details: ProjectDetails): ProjectSummary {
  return {
    projectId: details.projectId,
    designation: details.designation,
    increment: details.increment,
    name: details.name,
    batchQuantity: details.batchQuantity,
    status: details.status,
    harnessCount: details.harnesses.length,
    createdUtc: details.createdUtc,
    updatedUtc: details.updatedUtc,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Неизвестная ошибка. Повторите попытку.";
}

function positiveInteger(value: string): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function App({ config, session }: AppProps) {
  const api = useMemo(() => createProjectApi(config, session), [config, session]);
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectDetails | null>(null);
  const [selectedHarnessId, setSelectedHarnessId] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState("");
  const [harnessFilter, setHarnessFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<ProjectFormState>(emptyCreateForm);
  const [editName, setEditName] = useState("");
  const [editBatchQuantity, setEditBatchQuantity] = useState("1");
  const [editStatus, setEditStatus] = useState<ProjectStatus>("draft");
  const [newHarnessDesignation, setNewHarnessDesignation] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openSequence = useRef(0);

  const replaceProject = useCallback((details: ProjectDetails) => {
    const summary = projectSummary(details);
    setProjects((current) => {
      const exists = current.some((item) => item.projectId === details.projectId);
      const next = exists
        ? current.map((item) => item.projectId === details.projectId ? summary : item)
        : [...current, summary];
      return [...next].sort((left, right) => right.increment - left.increment);
    });
    setSelectedProject(details);
    setEditName(details.name);
    setEditBatchQuantity(String(details.batchQuantity));
    setEditStatus(details.status);
    setSelectedHarnessId((current) => (
      current && details.harnesses.some((item) => item.harnessId === current) ? current : null
    ));
  }, []);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    setError(null);
    try {
      setProjects(await api.listProjects());
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setLoadingProjects(false);
    }
  }, [api]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const openProject = async (projectId: string) => {
    const sequence = ++openSequence.current;
    setOpeningProjectId(projectId);
    setError(null);
    try {
      const details = await api.getProject(projectId);
      if (sequence === openSequence.current) replaceProject(details);
    } catch (openError) {
      if (sequence === openSequence.current) setError(errorText(openError));
    } finally {
      if (sequence === openSequence.current) setOpeningProjectId(null);
    }
  };

  const closeProject = () => {
    openSequence.current += 1;
    setSelectedProject(null);
    setSelectedHarnessId(null);
    setOpeningProjectId(null);
    setHarnessFilter("");
    setError(null);
  };

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const batchQuantity = positiveInteger(createForm.batchQuantity);
    if (!createForm.designation.trim() || !createForm.name.trim() || batchQuantity === null) {
      setError("Заполните обозначение, название и положительное количество в партии.");
      return;
    }
    setBusyAction("create");
    setError(null);
    try {
      const details = await api.createProject({
        designation: createForm.designation.trim(),
        name: createForm.name.trim(),
        batchQuantity,
        status: createForm.status,
      });
      replaceProject(details);
      setCreateForm(emptyCreateForm);
      setShowCreate(false);
    } catch (createError) {
      setError(errorText(createError));
    } finally {
      setBusyAction(null);
    }
  };

  const saveProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProject) return;
    const batchQuantity = positiveInteger(editBatchQuantity);
    if (!editName.trim() || batchQuantity === null) {
      setError("Укажите название и положительное количество в партии.");
      return;
    }
    setBusyAction("save");
    setError(null);
    try {
      replaceProject(await api.updateProject(selectedProject.projectId, {
        name: editName.trim(),
        batchQuantity,
        status: editStatus,
      }));
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setBusyAction(null);
    }
  };

  const copyProject = async () => {
    if (!selectedProject) return;
    setBusyAction("copy");
    setError(null);
    try {
      replaceProject(await api.copyProject(selectedProject.projectId));
    } catch (copyError) {
      setError(errorText(copyError));
    } finally {
      setBusyAction(null);
    }
  };

  const addHarness = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProject || !newHarnessDesignation.trim()) {
      setError("Укажите обозначение нового жгута.");
      return;
    }
    setBusyAction("add-harness");
    setError(null);
    try {
      const previousIds = new Set(selectedProject.harnesses.map((item) => item.harnessId));
      const details = await api.addHarness(selectedProject.projectId, newHarnessDesignation.trim());
      replaceProject(details);
      const added = details.harnesses.find((item) => !previousIds.has(item.harnessId));
      if (added) setSelectedHarnessId(added.harnessId);
      setNewHarnessDesignation("");
    } catch (addError) {
      setError(errorText(addError));
    } finally {
      setBusyAction(null);
    }
  };

  const deleteHarness = async (harnessId: string, designation: string) => {
    if (!selectedProject) return;
    if (!window.confirm(`Удалить жгут «${designation}» из проекта?`)) return;
    setBusyAction(`delete-${harnessId}`);
    setError(null);
    try {
      replaceProject(await api.deleteHarness(selectedProject.projectId, harnessId));
      setSelectedHarnessId((current) => current === harnessId ? null : current);
    } catch (deleteError) {
      setError(errorText(deleteError));
    } finally {
      setBusyAction(null);
    }
  };

  const normalizedProjectFilter = projectFilter.trim().toLocaleLowerCase("ru");
  const filteredProjects = projects.filter((project) => (
    `${project.designation} ${project.name}`.toLocaleLowerCase("ru").includes(normalizedProjectFilter)
  ));
  const normalizedHarnessFilter = harnessFilter.trim().toLocaleLowerCase("ru");
  const filteredHarnesses = (selectedProject?.harnesses ?? []).filter((harness) => (
    harness.designation.toLocaleLowerCase("ru").includes(normalizedHarnessFilter)
  ));
  const selectedHarness = selectedProject?.harnesses.find(
    (harness) => harness.harnessId === selectedHarnessId,
  );
  const isBusy = busyAction !== null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="product-mark" aria-hidden="true">T</span>
          <span className="product-name">TECHMAP-GRAPHER</span>
        </div>
        <div className="runtime-status" title={`API ${config.apiVersion}; схема ${config.schemaVersion}`}>
          <span className="status-dot" aria-hidden="true" />
          Локальный режим · {config.appVersion}
        </div>
      </header>

      <div className="workspace">
        <nav className="sidebar" aria-label="Разделы приложения">
          {sections.map((section, index) => (
            <button className={index === 0 ? "nav-item active" : "nav-item"} type="button" key={section}>
              <span className="nav-index">{String(index + 1).padStart(2, "0")}</span>
              {section}
            </button>
          ))}
        </nav>

        <main className="content">
          <div className="content-heading">
            <div>
              <p className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p>
              <h1>Проекты жгутов</h1>
              <p>В одном проекте можно вести до 100 независимых жгутов.</p>
            </div>
            <button className="primary-action" type="button" onClick={() => setShowCreate(true)}>
              + Создать проект
            </button>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button type="button" aria-label="Закрыть сообщение" onClick={() => setError(null)}>×</button>
            </div>
          )}

          {showCreate && (
            <section className="create-panel" aria-labelledby="create-title">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">НОВАЯ КАРТОЧКА</p>
                  <h2 id="create-title">Создание проекта</h2>
                </div>
                <button className="icon-button" type="button" aria-label="Закрыть форму" onClick={() => setShowCreate(false)}>×</button>
              </div>
              <form className="form-grid create-form" onSubmit={createProject}>
                <label>
                  Обозначение
                  <input value={createForm.designation} onChange={(event) => setCreateForm({ ...createForm, designation: event.target.value })} required autoFocus />
                </label>
                <label className="wide-field">
                  Название
                  <input value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} required />
                </label>
                <label>
                  Количество в партии
                  <input type="number" min="1" step="1" value={createForm.batchQuantity} onChange={(event) => setCreateForm({ ...createForm, batchQuantity: event.target.value })} required />
                </label>
                <label>
                  Статус
                  <select value={createForm.status} onChange={(event) => setCreateForm({ ...createForm, status: event.target.value as ProjectStatus })}>
                    {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
                <div className="form-actions wide-field">
                  <button className="primary-action" type="submit" disabled={isBusy}>{busyAction === "create" ? "Создание…" : "Создать и открыть"}</button>
                  <button className="secondary-action" type="button" onClick={() => setShowCreate(false)}>Отмена</button>
                </div>
              </form>
            </section>
          )}

          <div className="projects-layout">
            <section className="project-browser" aria-labelledby="projects-title">
              <div className="panel-heading">
                <div>
                  <h2 id="projects-title">Все проекты</h2>
                  <span>{projects.length}</span>
                </div>
                <button className="refresh-button" type="button" onClick={() => void loadProjects()} disabled={loadingProjects}>Обновить</button>
              </div>
              <label className="search-field">
                <span className="visually-hidden">Поиск проекта</span>
                <input type="search" placeholder="Поиск по названию или обозначению" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} />
              </label>

              {loadingProjects ? (
                <p className="panel-message" role="status">Загружаем проекты…</p>
              ) : filteredProjects.length === 0 ? (
                <div className="panel-message">
                  <strong>{projects.length === 0 ? "Проектов пока нет" : "Ничего не найдено"}</strong>
                  <span>{projects.length === 0 ? "Создайте первую карточку проекта." : "Измените строку поиска."}</span>
                </div>
              ) : (
                <div className="project-list">
                  {filteredProjects.map((project) => (
                    <button
                      className={selectedProject?.projectId === project.projectId ? "project-row selected" : "project-row"}
                      type="button"
                      key={project.projectId}
                      onClick={() => void openProject(project.projectId)}
                      aria-current={selectedProject?.projectId === project.projectId ? "true" : undefined}
                    >
                      <span className="project-row-top">
                        <strong>{project.designation}</strong>
                        <span className={`status-pill ${project.status}`}>{statusLabels[project.status]}</span>
                      </span>
                      <span className="project-row-name">{project.name}</span>
                      <span className="project-row-meta">Партия: {project.batchQuantity} шт. · жгутов: {project.harnessCount} · версия {project.increment}</span>
                      {openingProjectId === project.projectId && <span className="opening-label">Открываем…</span>}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {selectedProject ? (
              <section className="project-card" aria-labelledby="project-card-title">
                <div className="section-title-row card-title-row">
                  <div>
                    <p className="eyebrow">ПРОЕКТ · {selectedProject.designation}</p>
                    <h2 id="project-card-title">{selectedProject.name}</h2>
                  </div>
                  <button className="icon-button" type="button" aria-label="Закрыть карточку проекта" title="Закрыть карточку" onClick={closeProject}>×</button>
                </div>

                <form className="form-grid project-edit-form" onSubmit={saveProject}>
                  <label className="wide-field">
                    Название
                    <input value={editName} onChange={(event) => setEditName(event.target.value)} required />
                  </label>
                  <label>
                    Статус
                    <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as ProjectStatus)}>
                      {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                    </select>
                  </label>
                  <label>
                    Количество в партии
                    <input type="number" min="1" step="1" value={editBatchQuantity} onChange={(event) => setEditBatchQuantity(event.target.value)} required />
                  </label>
                  <div className="form-actions wide-field">
                    <button className="primary-action" type="submit" disabled={isBusy}>{busyAction === "save" ? "Сохранение…" : "Сохранить"}</button>
                    <button className="secondary-action" type="button" onClick={() => void copyProject()} disabled={isBusy}>{busyAction === "copy" ? "Копирование…" : "Создать копию"}</button>
                  </div>
                </form>

                <div className="harness-section">
                  <div className="harness-heading">
                    <div>
                      <h3>Жгуты проекта</h3>
                      <span>{selectedProject.harnesses.length} из 100</span>
                    </div>
                    <label className="compact-search">
                      <span className="visually-hidden">Быстрый поиск жгута</span>
                      <input type="search" placeholder="Быстрый поиск" value={harnessFilter} onChange={(event) => setHarnessFilter(event.target.value)} />
                    </label>
                  </div>

                  <form className="add-harness-form" onSubmit={addHarness}>
                    <label>
                      <span className="visually-hidden">Обозначение нового жгута</span>
                      <input placeholder="Обозначение нового жгута" value={newHarnessDesignation} onChange={(event) => setNewHarnessDesignation(event.target.value)} disabled={selectedProject.harnesses.length >= 100} />
                    </label>
                    <button className="secondary-action" type="submit" disabled={isBusy || selectedProject.harnesses.length >= 100}>
                      {busyAction === "add-harness" ? "Добавление…" : "+ Добавить"}
                    </button>
                  </form>

                  {selectedProject.harnesses.length >= 100 && <p className="limit-message">Достигнут предел: 100 жгутов в проекте.</p>}
                  <div className="harness-list" role="list" aria-label="Жгуты проекта">
                    {filteredHarnesses.length === 0 ? (
                      <p className="panel-message">{selectedProject.harnesses.length === 0 ? "В проекте пока нет жгутов." : "Жгуты не найдены."}</p>
                    ) : filteredHarnesses.map((harness) => (
                      <div className={selectedHarnessId === harness.harnessId ? "harness-row selected" : "harness-row"} role="listitem" key={harness.harnessId}>
                        <button type="button" className="harness-select" onClick={() => setSelectedHarnessId(harness.harnessId)}>
                          <span className="harness-order">{String(harness.sortOrder + 1).padStart(2, "0")}</span>
                          <strong>{harness.designation}</strong>
                        </button>
                        <button className="delete-button" type="button" aria-label={`Удалить жгут ${harness.designation}`} onClick={() => void deleteHarness(harness.harnessId, harness.designation)} disabled={isBusy}>
                          {busyAction === `delete-${harness.harnessId}` ? "…" : "Удалить"}
                        </button>
                      </div>
                    ))}
                  </div>
                  {selectedHarness && (
                    <div className="selected-harness-note">
                      <span>Выбран жгут</span>
                      <strong>{selectedHarness.designation}</strong>
                      <button type="button" className="link-button" onClick={() => setSelectedHarnessId(null)}>Снять выбор</button>
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <section className="empty-card" aria-labelledby="empty-title">
                <div className="empty-glyph" aria-hidden="true"><span /><span /><span /></div>
                <h2 id="empty-title">Выберите проект</h2>
                <p>Откройте карточку слева или создайте новый проект.</p>
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
