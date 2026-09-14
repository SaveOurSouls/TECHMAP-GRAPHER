import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AutosaveConflictError,
  AutosaveController,
  AutosaveDraftError,
  createPendingDraftMarkerStore,
  type AutosaveSnapshot,
} from "./autosave-controller";
import type { LocalSession } from "./local-session";
import { ReferenceImportPanel } from "./ReferenceImportPanel";
import { ComponentLibrary } from "./component-library/ComponentLibrary";
import { HarnessDesignEditor } from "./editor/HarnessDesignEditor";
import {
  createProjectApi,
  ProjectApiError,
  type ProjectDetails,
  type HarnessSummary,
  type ProjectStatus,
  type ProjectSummary,
} from "./project-api";
import type { RuntimeConfig } from "./runtime-config";
import { TransitionGate } from "./transition-gate";

interface AppProps {
  readonly config: RuntimeConfig;
  readonly session: LocalSession;
}

interface ProjectFormState {
  readonly designation: string;
  readonly name: string;
  readonly status: ProjectStatus;
}

interface ProjectEditDraft {
  readonly name: string;
  readonly status: ProjectStatus;
}

const sections = [
  { id: "projects", label: "Проекты" },
  { id: "references", label: "Справочники" },
  { id: "library", label: "Библиотека" },
] as const;
export type AppSection = typeof sections[number]["id"];
const harnessTabs = [
  { id: "e4", label: "Схема Э4", description: "Соединения и электрическая схема жгута" },
  { id: "drawing", label: "Чертёж", description: "Геометрия, размеры и технические требования" },
  { id: "route", label: "Маршрут", description: "Последовательность операций изготовления" },
] as const;
export type HarnessTab = typeof harnessTabs[number]["id"];
const statusLabels: Readonly<Record<ProjectStatus, string>> = {
  draft: "Черновик",
  active: "В работе",
  completed: "Завершён",
};
const emptyCreateForm: ProjectFormState = {
  designation: "",
  name: "",
  status: "draft",
};
const maximumHarnessQuantity = Number.MAX_SAFE_INTEGER;

function projectSummary(details: ProjectDetails): ProjectSummary {
  return {
    projectId: details.projectId,
    designation: details.designation,
    increment: details.increment,
    name: details.name,
    batchQuantity: details.batchQuantity,
    status: details.status,
    revision: details.revision,
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
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function rememberHarnessTab(
  current: Readonly<Record<string, HarnessTab>>,
  harnessId: string,
  tab: HarnessTab,
): Readonly<Record<string, HarnessTab>> {
  return { ...current, [harnessId]: tab };
}

interface AppNavigationProps {
  readonly activeSection: AppSection;
  readonly onSectionChange: (section: AppSection) => void;
}

export function AppNavigation({ activeSection, onSectionChange }: AppNavigationProps) {
  return (
    <nav className="sidebar" aria-label="Разделы приложения">
      {sections.map((section, index) => (
        <button
          className={activeSection === section.id ? "nav-item active" : "nav-item"}
          type="button"
          key={section.id}
          onClick={() => onSectionChange(section.id)}
          aria-current={activeSection === section.id ? "page" : undefined}
        >
          <span className="nav-index">{String(index + 1).padStart(2, "0")}</span>
          {section.label}
        </button>
      ))}
    </nav>
  );
}

interface HarnessDocumentTabsProps {
  readonly harness: HarnessSummary;
  readonly activeTab: HarnessTab;
  readonly onTabChange: (tab: HarnessTab) => void;
  readonly onOpen?: (tab: Exclude<HarnessTab, "route">) => void;
}

export function HarnessDocumentTabs({
  harness,
  activeTab,
  onTabChange,
  onOpen,
}: HarnessDocumentTabsProps) {
  const activeDefinition = harnessTabs.find((tab) => tab.id === activeTab)!;
  const document = harness.documents.find((item) => item.kind === activeTab)!;
  return (
    <>
      <div className="harness-tabs" role="tablist" aria-label={`Документация жгута ${harness.designation}`}>
        {harnessTabs.map((tab) => (
          <button
            id={`harness-tab-${harness.harnessId}-${tab.id}`}
            className={activeTab === tab.id ? "harness-tab active" : "harness-tab"}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`harness-panel-${harness.harnessId}`}
            onClick={() => onTabChange(tab.id)}
            key={tab.id}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        id={`harness-panel-${harness.harnessId}`}
        className="document-empty-state"
        role="tabpanel"
        aria-labelledby={`harness-tab-${harness.harnessId}-${activeTab}`}
      >
        <span className={`document-icon ${activeTab}`} aria-hidden="true" />
        <strong>{activeDefinition.label}</strong>
        <p>{activeDefinition.description}</p>
        {activeTab === "route" ? (
          <span>{document.status === "empty" && "Маршрут пока пуст. Его редактор будет подключён после сквозного Э4 и Чертежа."}</span>
        ) : (
          <button className="primary-action document-open-action" type="button" onClick={() => onOpen?.(activeTab)}>
            Открыть {activeTab === "e4" ? "схему Э4" : "чертёж"}
          </button>
        )}
      </div>
    </>
  );
}

export function App({ config, session }: AppProps) {
  const api = useMemo(() => createProjectApi(config, session), [config, session]);
  const [activeSection, setActiveSection] = useState<AppSection>("projects");
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectDetails | null>(null);
  const [selectedHarnessId, setSelectedHarnessId] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState("");
  const [harnessFilter, setHarnessFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<ProjectFormState>(emptyCreateForm);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState<ProjectStatus>("draft");
  const [newHarnessDesignation, setNewHarnessDesignation] = useState("");
  const [newHarnessQuantity, setNewHarnessQuantity] = useState("1");
  const [editHarnessQuantity, setEditHarnessQuantity] = useState("1");
  const [activeHarnessTabs, setActiveHarnessTabs] = useState<Readonly<Record<string, HarnessTab>>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [navigationPending, setNavigationPending] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autosave, setAutosave] = useState<AutosaveSnapshot | null>(null);
  const transitionGateRef = useRef(new TransitionGate());
  const autosaveRef = useRef<AutosaveController<ProjectEditDraft> | null>(null);
  const unsubscribeAutosaveRef = useRef<(() => void) | null>(null);
  const discreteMutationRef = useRef(false);

  const replaceProject = useCallback((details: ProjectDetails, synchronizeEditor = true) => {
    const summary = projectSummary(details);
    setProjects((current) => {
      const exists = current.some((item) => item.projectId === details.projectId);
      const next = exists
        ? current.map((item) => item.projectId === details.projectId ? summary : item)
        : [...current, summary];
      return [...next].sort((left, right) => right.increment - left.increment);
    });
    setSelectedProject(details);
    if (synchronizeEditor) {
      setEditName(details.name);
      setEditStatus(details.status);
    }
    setSelectedHarnessId((current) => (
      current && details.harnesses.some((item) => item.harnessId === current) ? current : null
    ));
  }, []);

  const activateAutosave = useCallback((details: ProjectDetails) => {
    unsubscribeAutosaveRef.current?.();
    autosaveRef.current?.dispose();

    const controller = new AutosaveController<ProjectEditDraft>({
      initialRevision: details.revision,
      markerStore: createPendingDraftMarkerStore(
        window.localStorage,
        `techmap.autosave.project.${details.projectId}`,
      ),
      send: async command => {
        const request: { name?: string; status?: ProjectStatus } = {};
        if (command.draft.name !== undefined) {
          if (!command.draft.name.trim()) throw new AutosaveDraftError("Название проекта не может быть пустым.");
          request.name = command.draft.name.trim();
        }
        if (command.draft.status !== undefined) request.status = command.draft.status;

        try {
          const result = await api.updateProject(details.projectId, {
            commandId: command.commandId,
            expectedRevision: command.expectedRevision,
          }, request);
          if (autosaveRef.current === controller) replaceProject(result.project, false);
          return { revision: result.resultingRevision };
        } catch (updateError) {
          if (updateError instanceof ProjectApiError && updateError.code === "revision_conflict") {
            const suffix = updateError.currentRevision === null
              ? ""
              : ` Текущая ревизия: ${updateError.currentRevision}.`;
            throw new AutosaveConflictError(`${updateError.message}${suffix}`);
          }
          throw updateError;
        }
      },
    });
    autosaveRef.current = controller;
    unsubscribeAutosaveRef.current = controller.subscribe(setAutosave);
  }, [api, replaceProject]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        !autosaveRef.current?.snapshot.unloadWarning &&
        !discreteMutationRef.current &&
        !transitionGateRef.current.isBlocked
      ) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      unsubscribeAutosaveRef.current?.();
      autosaveRef.current?.dispose();
    };
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

  const hasUnconfirmedEdits = () => Boolean(autosaveRef.current?.snapshot.unloadWarning);

  const canStartMutation = () => {
    if (transitionGateRef.current.allowMutation()) return true;
    setError("Дождитесь завершения открытия проекта.");
    return false;
  };

  const canLeaveCurrentProject = () =>
    !hasUnconfirmedEdits() || window.confirm(
      "Есть изменения, не подтверждённые сервером. Закрыть карточку и потерять этот черновик?",
    );

  const discardAutosave = () => {
    unsubscribeAutosaveRef.current?.();
    unsubscribeAutosaveRef.current = null;
    autosaveRef.current?.dispose();
    autosaveRef.current = null;
    setAutosave(null);
  };

  const openProject = async (projectId: string) => {
    if (discreteMutationRef.current) {
      setError("Дождитесь завершения текущей операции проекта.");
      return;
    }
    if (selectedProject && !canLeaveCurrentProject()) return;
    const transition = transitionGateRef.current.begin();
    setNavigationPending(true);
    setOpeningProjectId(projectId);
    setError(null);
    try {
      const details = await api.getProject(projectId);
      if (transitionGateRef.current.isCurrent(transition)) {
        discardAutosave();
        replaceProject(details);
        activateAutosave(details);
      }
    } catch (openError) {
      if (transitionGateRef.current.isCurrent(transition)) setError(errorText(openError));
    } finally {
      if (transitionGateRef.current.finish(transition)) {
        setNavigationPending(false);
        setOpeningProjectId(null);
      }
    }
  };

  const closeProject = () => {
    if (discreteMutationRef.current) {
      setError("Дождитесь завершения текущей операции проекта.");
      return;
    }
    if (!canLeaveCurrentProject()) return;
    transitionGateRef.current.invalidate();
    discardAutosave();
    setSelectedProject(null);
    setSelectedHarnessId(null);
    setNavigationPending(false);
    setOpeningProjectId(null);
    setHarnessFilter("");
    setError(null);
  };

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canStartMutation()) return;
    if (discreteMutationRef.current) {
      setError("Дождитесь завершения текущей операции проекта.");
      return;
    }
    if (selectedProject && hasUnconfirmedEdits()) {
      setError("Сначала завершите сохранение открытого проекта или закройте его карточку.");
      return;
    }
    if (!createForm.designation.trim() || !createForm.name.trim()) {
      setError("Заполните обозначение и название проекта.");
      return;
    }
    discreteMutationRef.current = true;
    setBusyAction("create");
    setError(null);
    try {
      const details = await api.createProject({
        designation: createForm.designation.trim(),
        name: createForm.name.trim(),
        status: createForm.status,
      });
      replaceProject(details);
      discardAutosave();
      activateAutosave(details);
      setCreateForm(emptyCreateForm);
      setShowCreate(false);
    } catch (createError) {
      setError(errorText(createError));
    } finally {
      discreteMutationRef.current = false;
      setBusyAction(null);
    }
  };

  const saveProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canStartMutation()) return;
    const controller = autosaveRef.current;
    if (!selectedProject || !controller || discreteMutationRef.current) return;
    discreteMutationRef.current = true;
    setBusyAction("save");
    try {
      await controller.flush();
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      discreteMutationRef.current = false;
      setBusyAction(null);
    }
  };

  const copyProject = async () => {
    if (
      !canStartMutation() ||
      !selectedProject ||
      !autosaveRef.current ||
      discreteMutationRef.current
    ) return;
    discreteMutationRef.current = true;
    setBusyAction("copy");
    setError(null);
    try {
      await autosaveRef.current.flush();
      if (autosaveRef.current.snapshot.status !== "acknowledged") {
        throw new Error("Сначала разрешите неподтверждённые изменения проекта.");
      }
      const details = await api.copyProject(selectedProject.projectId);
      discardAutosave();
      replaceProject(details);
      activateAutosave(details);
    } catch (copyError) {
      setError(errorText(copyError));
    } finally {
      discreteMutationRef.current = false;
      setBusyAction(null);
    }
  };

  const commitHarnessChange = async (
    action: string,
    execute: (project: ProjectDetails, expectedRevision: number, commandId: string) => Promise<ProjectDetails>,
  ) => {
    const project = selectedProject;
    const controller = autosaveRef.current;
    if (!canStartMutation() || !project || !controller || discreteMutationRef.current) return null;
    discreteMutationRef.current = true;
    setBusyAction(action);
    setError(null);
    try {
      await controller.flush();
      const state = controller.snapshot;
      if (state.status !== "acknowledged" || state.hasPendingDraft || state.interruptedDraft) {
        throw new Error("Сначала разрешите неподтверждённые изменения проекта.");
      }
      const details = await execute(project, state.revision, crypto.randomUUID());
      if (autosaveRef.current === controller) {
        controller.resumeAtRevision(details.revision);
        replaceProject(details);
      }
      return details;
    } catch (changeError) {
      setError(errorText(changeError));
      return null;
    } finally {
      discreteMutationRef.current = false;
      setBusyAction(null);
    }
  };

  const addHarness = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canStartMutation()) return;
    const quantity = positiveInteger(newHarnessQuantity);
    if (!selectedProject || !newHarnessDesignation.trim() || quantity === null) {
      setError("Укажите обозначение и положительное целое количество для жгута.");
      return;
    }
    const designation = newHarnessDesignation.trim();
    const previousIds = new Set(selectedProject.harnesses.map((item) => item.harnessId));
    const details = await commitHarnessChange("add-harness", async (project, expectedRevision, commandId) => (
      await api.addHarness(
        project.projectId,
        { commandId, expectedRevision },
        { designation, quantity },
      )
    ).project);
    if (details) {
      const added = details.harnesses.find((item) => !previousIds.has(item.harnessId));
      if (added) setSelectedHarnessId(added.harnessId);
      setNewHarnessDesignation("");
      setNewHarnessQuantity("1");
    }
  };

  const saveHarnessQuantity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProject) return;
    const harness = selectedProject.harnesses.find((item) => item.harnessId === selectedHarnessId);
    const quantity = positiveInteger(editHarnessQuantity);
    if (!harness || quantity === null) {
      setError("Количество для жгута должно быть положительным целым числом.");
      return;
    }
    if (quantity === harness.quantity) return;
    await commitHarnessChange(
      `quantity-${harness.harnessId}`,
      async (project, expectedRevision, commandId) => (
        await api.updateHarness(
          project.projectId,
          harness.harnessId,
          { commandId, expectedRevision },
          { quantity },
        )
      ).project,
    );
  };

  const deleteHarness = async (harnessId: string, designation: string) => {
    if (!canStartMutation()) return;
    if (!selectedProject) return;
    if (!window.confirm(`Удалить жгут «${designation}» из проекта?`)) return;
    const details = await commitHarnessChange(`delete-${harnessId}`, async (project, expectedRevision, commandId) => (
      await api.deleteHarness(project.projectId, harnessId, { commandId, expectedRevision })
    ).project);
    if (details) {
      setSelectedHarnessId((current) => current === harnessId ? null : current);
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
  const activeHarnessTab = selectedHarness
    ? activeHarnessTabs[selectedHarness.harnessId] ?? "e4"
    : "e4";
  const isBusy = busyAction !== null;
  const isEditorLocked = navigationPending || isBusy || autosave?.status === "conflict" || autosave?.interruptedDraft === true;

  const changeCreateForm = (patch: Readonly<Partial<ProjectFormState>>) => {
    if (!transitionGateRef.current.allowMutation() || discreteMutationRef.current) return;
    setCreateForm((current) => ({ ...current, ...patch }));
  };

  const changeNewHarnessDesignation = (value: string) => {
    if (!transitionGateRef.current.allowMutation() || discreteMutationRef.current) return;
    setNewHarnessDesignation(value);
  };

  const changeEditName = (value: string) => {
    if (!transitionGateRef.current.allowMutation() || discreteMutationRef.current) return;
    setEditName(value);
    autosaveRef.current?.edit({ name: value });
  };

  const changeEditStatus = (value: ProjectStatus) => {
    if (!transitionGateRef.current.allowMutation() || discreteMutationRef.current) return;
    setEditStatus(value);
    autosaveRef.current?.edit({ status: value });
  };

  const discardAndReload = () => {
    if (!canStartMutation()) return;
    if (!selectedProject || !autosaveRef.current) return;
    autosaveRef.current.discardPendingDraft(selectedProject.revision);
    void openProject(selectedProject.projectId);
  };

  useEffect(() => {
    if (!selectedProject) return;
    setSelectedHarnessId((current) => (
      current && selectedProject.harnesses.some((item) => item.harnessId === current)
        ? current
        : selectedProject.harnesses[0]?.harnessId ?? null
    ));
  }, [selectedProject]);

  useEffect(() => {
    if (selectedHarness) setEditHarnessQuantity(String(selectedHarness.quantity));
  }, [selectedHarness]);

  if (editorOpen && selectedProject && selectedHarness && activeHarnessTab !== "route") {
    return (
      <HarnessDesignEditor
        config={config}
        session={session}
        projectId={selectedProject.projectId}
        harnessId={selectedHarness.harnessId}
        harnessDesignation={selectedHarness.designation}
        initialView={activeHarnessTab}
        onClose={() => setEditorOpen(false)}
        onViewChange={(view) => setActiveHarnessTabs((current) => rememberHarnessTab(
          current,
          selectedHarness.harnessId,
          view,
        ))}
      />
    );
  }

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
        <AppNavigation activeSection={activeSection} onSectionChange={setActiveSection} />

        <main className="content">
          {activeSection === "projects" ? (
            <>
          <div className="content-heading">
            <div>
              <p className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p>
              <h1>Проекты</h1>
              <p>Проект объединяет жгуты, их параметры и комплект документации.</p>
            </div>
            <button className="primary-action" type="button" onClick={() => {
              if (canStartMutation()) setShowCreate(true);
            }} disabled={navigationPending || isBusy}>
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
                <button className="icon-button" type="button" aria-label="Закрыть форму" onClick={() => setShowCreate(false)} disabled={navigationPending}>×</button>
              </div>
              <form className="form-grid create-form" onSubmit={createProject}>
                <label>
                  Обозначение
                  <input value={createForm.designation} onChange={(event) => changeCreateForm({ designation: event.target.value })} disabled={navigationPending || isBusy} required autoFocus />
                </label>
                <label className="wide-field">
                  Название
                  <input value={createForm.name} onChange={(event) => changeCreateForm({ name: event.target.value })} disabled={navigationPending || isBusy} required />
                </label>
                <label>
                  Статус
                  <select value={createForm.status} onChange={(event) => changeCreateForm({ status: event.target.value as ProjectStatus })} disabled={navigationPending || isBusy}>
                    {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
                <div className="form-actions wide-field">
                  <button className="primary-action" type="submit" disabled={navigationPending || isBusy}>{busyAction === "create" ? "Создание…" : "Создать и открыть"}</button>
                  <button className="secondary-action" type="button" onClick={() => setShowCreate(false)} disabled={navigationPending || isBusy}>Отмена</button>
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
                      disabled={isBusy}
                      aria-current={selectedProject?.projectId === project.projectId ? "true" : undefined}
                    >
                      <span className="project-row-top">
                        <strong>{project.designation}</strong>
                        <span className={`status-pill ${project.status}`}>{statusLabels[project.status]}</span>
                      </span>
                      <span className="project-row-name">{project.name}</span>
                      <span className="project-row-meta">Жгутов в проекте: {project.harnessCount} · версия {project.increment}</span>
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
                  <button className="icon-button" type="button" aria-label="Закрыть карточку проекта" title="Закрыть карточку" onClick={closeProject} disabled={isBusy}>×</button>
                </div>

                <form className="form-grid project-edit-form" onSubmit={saveProject}>
                  {autosave && (
                    <div className={`autosave-state ${autosave.status}`} role="status" aria-live="polite">
                      <span className="autosave-indicator" aria-hidden="true" />
                      <div>
                        <strong>{autosave.status === "pending"
                          ? (autosave.commandInFlight ? "Сохраняем…" : "Ожидает сохранения")
                          : autosave.status === "acknowledged"
                            ? `Сохранено · ревизия ${autosave.revision}`
                            : autosave.status === "conflict"
                              ? "Конфликт изменений"
                              : "Не сохранено"}</strong>
                        {autosave.message && <span>{autosave.message}</span>}
                      </div>
                      {autosave.status === "error" && !autosave.interruptedDraft && (
                        <button className="link-button" type="button" onClick={() => {
                          if (canStartMutation()) autosaveRef.current?.retry();
                        }} disabled={navigationPending}>
                          Повторить
                        </button>
                      )}
                      {(autosave.status === "conflict" || autosave.interruptedDraft) && (
                        <button className="link-button" type="button" onClick={discardAndReload} disabled={navigationPending}>
                          Отменить черновик и обновить
                        </button>
                      )}
                    </div>
                  )}
                  <label className="wide-field">
                    Название
                    <input value={editName} onChange={(event) => changeEditName(event.target.value)} disabled={isEditorLocked} required />
                  </label>
                  <label>
                    Статус
                    <select value={editStatus} onChange={(event) => changeEditStatus(event.target.value as ProjectStatus)} disabled={isEditorLocked}>
                      {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                    </select>
                  </label>
                  <div className="form-actions wide-field">
                    <button className="primary-action" type="submit" disabled={navigationPending || isBusy || autosave?.status === "acknowledged"}>{busyAction === "save" ? "Сохраняем…" : "Сохранить сейчас"}</button>
                    <button className="secondary-action" type="button" onClick={() => void copyProject()} disabled={navigationPending || isBusy}>{busyAction === "copy" ? "Копирование…" : "Создать копию"}</button>
                  </div>
                </form>

                <div className="harness-section" aria-label="Состав проекта">
                  <div className="harness-heading">
                    <div>
                      <h3>Жгуты</h3>
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
                      <input placeholder="Обозначение нового жгута" value={newHarnessDesignation} onChange={(event) => changeNewHarnessDesignation(event.target.value)} disabled={navigationPending || isBusy || selectedProject.harnesses.length >= 100} />
                    </label>
                    <label className="quantity-field">
                      <span className="visually-hidden">Количество нового жгута</span>
                      <input type="number" min="1" max={maximumHarnessQuantity} step="1" aria-label="Количество нового жгута" value={newHarnessQuantity} onChange={(event) => setNewHarnessQuantity(event.target.value)} disabled={navigationPending || isBusy || selectedProject.harnesses.length >= 100} />
                      <span aria-hidden="true">шт.</span>
                    </label>
                    <button className="secondary-action" type="submit" disabled={navigationPending || isBusy || selectedProject.harnesses.length >= 100}>
                      {busyAction === "add-harness" ? "Добавление…" : "+ Добавить"}
                    </button>
                  </form>

                  {selectedProject.harnesses.length >= 100 && <p className="limit-message">Достигнут предел: 100 жгутов в проекте.</p>}
                  <div className="harness-workspace">
                    <div className="harness-list" role="list" aria-label="Жгуты проекта">
                      {filteredHarnesses.length === 0 ? (
                        <p className="panel-message">{selectedProject.harnesses.length === 0 ? "Добавьте первый жгут, чтобы начать работу с его документацией." : "Жгуты не найдены."}</p>
                      ) : filteredHarnesses.map((harness) => (
                        <div className={selectedHarnessId === harness.harnessId ? "harness-row selected" : "harness-row"} role="listitem" key={harness.harnessId}>
                          <button
                            type="button"
                            className="harness-select"
                            onClick={() => setSelectedHarnessId(harness.harnessId)}
                            aria-current={selectedHarnessId === harness.harnessId ? "true" : undefined}
                          >
                            <span className="harness-order">{String(harness.sortOrder + 1).padStart(2, "0")}</span>
                            <span className="harness-label">
                              <strong>{harness.designation}</strong>
                              <span>{harness.quantity} шт.</span>
                            </span>
                          </button>
                          <button className="delete-button" type="button" aria-label={`Удалить жгут ${harness.designation}`} onClick={() => void deleteHarness(harness.harnessId, harness.designation)} disabled={navigationPending || isBusy}>
                            {busyAction === `delete-${harness.harnessId}` ? "…" : "Удалить"}
                          </button>
                        </div>
                      ))}
                    </div>

                    {selectedHarness ? (
                      <section className="harness-detail" aria-labelledby="selected-harness-title">
                        <div className="harness-detail-heading">
                          <div>
                            <p className="eyebrow">ВЫБРАННЫЙ ЖГУТ</p>
                            <h3 id="selected-harness-title">{selectedHarness.designation}</h3>
                          </div>
                          <span className="harness-position">позиция {selectedHarness.sortOrder + 1}</span>
                        </div>

                        <form className="harness-parameters" onSubmit={saveHarnessQuantity}>
                          <label>
                            Количество
                            <span className="quantity-control">
                              <input type="number" min="1" max={maximumHarnessQuantity} step="1" value={editHarnessQuantity} onChange={(event) => setEditHarnessQuantity(event.target.value)} disabled={navigationPending || isBusy} required />
                              <span>шт.</span>
                            </span>
                          </label>
                          <button className="secondary-action" type="submit" disabled={navigationPending || isBusy || editHarnessQuantity === String(selectedHarness.quantity)}>
                            {busyAction === `quantity-${selectedHarness.harnessId}` ? "Сохранение…" : "Сохранить количество"}
                          </button>
                        </form>

                        <HarnessDocumentTabs
                          harness={selectedHarness}
                          activeTab={activeHarnessTab}
                          onTabChange={(tab) => setActiveHarnessTabs((current) => (
                            rememberHarnessTab(current, selectedHarness.harnessId, tab)
                          ))}
                          onOpen={(tab) => {
                            setActiveHarnessTabs((current) => rememberHarnessTab(
                              current,
                              selectedHarness.harnessId,
                              tab,
                            ));
                            setEditorOpen(true);
                          }}
                        />
                      </section>
                    ) : (
                      <div className="harness-detail-empty">
                        <strong>Выберите жгут</strong>
                        <span>Здесь будут его количество, параметры и документация.</span>
                      </div>
                    )}
                  </div>
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
            </>
          ) : activeSection === "references" ? (
            <ReferenceImportPanel config={config} session={session} />
          ) : (
            <ComponentLibrary config={config} session={session} />
          )}
        </main>
      </div>
    </div>
  );
}
