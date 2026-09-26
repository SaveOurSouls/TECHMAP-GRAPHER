import { useEffect, useMemo, useState } from "react";
import { createMutationHeaders, type LocalSession } from "../local-session";
import { buildApiUrl, type RuntimeConfig } from "../runtime-config";
import type { RouteRow } from "./route-model";

export function RoutePhotoList({ config, session, projectId, photos = [], onChange, disabled = false, onBusyChange }: {
  config: RuntimeConfig; session: LocalSession; projectId: string; photos?: RouteRow["photos"];
  onChange: (photos: NonNullable<RouteRow["photos"]>) => void; disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({}), [error, setError] = useState(""), [uploading, setUploading] = useState(false);
  const api = useMemo(() => {
    const path = `projects/${encodeURIComponent(projectId)}`;
    const request = async (suffix: string, init?: RequestInit) => {
      const result = await fetch(buildApiUrl(config, path + suffix), { credentials: "same-origin", cache: "no-store", ...init });
      if (!result.ok) throw new Error(result.status === 409 ? "Проект изменился. Повторите загрузку фото." : "Не удалось загрузить фото этапа.");
      return result.json();
    };
    return { request, url: (id: string) => buildApiUrl(config, `${path}/attachments/${encodeURIComponent(id)}/content`) };
  }, [config, projectId]);
  useEffect(() => {
    let cancelled = false;
    void api.request("/attachments").then(result => {
      if (!Array.isArray(result.attachments)) throw new Error("Список фото повреждён.");
      const next: Record<string, string> = {};
      for (const item of result.attachments) if (item.purpose === "route-photo" && item.mediaType === "image/png" && typeof item.sha256 === "string" && typeof item.attachmentId === "string") next[item.sha256.toLowerCase()] = api.url(item.attachmentId);
      if (!cancelled) setUrls(next);
    }).catch(caught => { if (!cancelled) setError(String(caught.message)); });
    return () => { cancelled = true; };
  }, [api]);
  const upload = async (files: FileList | null) => {
    if (!files || disabled || uploading) return;
    const pendingFiles = Array.from(files);
    if (photos.length + pendingFiles.length > 16) { setError("В одном этапе можно сохранить до 16 фото."); return; }
    setUploading(true); onBusyChange?.(true); setError("");
    let next = [...photos];
    try {
      const { importDrawingImage } = await import("../component-library/image-import");
      for (const file of pendingFiles) {
        const image = await importDrawingImage(file);
        const project = await api.request("");
        const result = await api.request("/attachments", { method: "POST", headers: createMutationHeaders(session), body: JSON.stringify({ commandId: crypto.randomUUID(), expectedRevision: project.revision, ...image, purpose: "route-photo" }) });
        const item = result.attachment;
        if (!item || typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(item.sha256) || typeof item.attachmentId !== "string") throw new Error("Сервер вернул повреждённую запись фото.");
        const sha256 = item.sha256.toLowerCase();
        if (!next.some(photo => photo.sha256 === sha256)) next = [...next, { sha256, name: file.name.slice(0, 255) }];
        setUrls(old => ({ ...old, [sha256]: api.url(item.attachmentId) }));
        onChange(next);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Фото не загружено."); }
    finally { setUploading(false); onBusyChange?.(false); }
  };
  return <section className="route-photos" aria-label="Фото этапа" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void upload(event.dataTransfer.files); }}>
    <label>Фото этапа · перетащите сюда изображение<input aria-label="Добавить фото этапа" type="file" accept="image/*" multiple disabled={disabled || uploading} onChange={event => { void upload(event.target.files); event.target.value = ""; }} /></label>
    {uploading && <p role="status">Сохраняем фото в проект…</p>}{error && <p role="alert">{error}</p>}
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{photos.map(photo => <figure key={photo.sha256} style={{ margin: 0, width: 180 }}>
      {urls[photo.sha256.toLowerCase()] ? <img src={urls[photo.sha256.toLowerCase()]} alt={photo.name} style={{ maxWidth: "100%", maxHeight: 140, objectFit: "contain" }} /> : <p role="status">Фото недоступно</p>}
      <figcaption>{photo.name}</figcaption><button type="button" disabled={disabled || uploading} onClick={() => onChange(photos.filter(item => item.sha256 !== photo.sha256))}>Убрать из этапа</button>
    </figure>)}</div>
  </section>;
}
