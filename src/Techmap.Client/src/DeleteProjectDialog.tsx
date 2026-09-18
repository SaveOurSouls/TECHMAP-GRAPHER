import { useEffect, useRef } from "react";
import type { ProjectDetails } from "./project-api";
import { InfoHint } from "./InfoHint";

export function DeleteProjectDialog({ project, busy, error, onCancel, onConfirm }: {
  readonly project: ProjectDetails;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    cancelButton.current?.focus();
  }, []);
  return <dialog ref={dialog} className="project-delete-dialog" aria-labelledby="delete-project-title"
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="delete-project-title">Удалить проект?</h2>
    <p><strong>{project.designation}</strong> · {project.name}</p>
    <p>Будут удалены проект и его жгуты ({project.harnesses.length}). Отменить действие нельзя.
      <InfoHint>Общая библиотека и справочники сохранятся. Для восстановления проекта нужна резервная копия.</InfoHint>
    </p>
    {error && <p role="alert">{error}</p>}
    <div className="project-heading-actions">
      <button ref={cancelButton} type="button" className="secondary-action" autoFocus disabled={busy} onClick={onCancel}>Отмена</button>
      <button type="button" className="delete-button" disabled={busy} onClick={onConfirm}>{busy ? "Удаление…" : "Удалить"}</button>
    </div>
  </dialog>;
}
