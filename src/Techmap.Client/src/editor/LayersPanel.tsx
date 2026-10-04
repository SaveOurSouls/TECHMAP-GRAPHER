import { Fragment, useState, type DragEvent } from "react";
import type { EditorLayer } from "./editor-types";

export interface LayersPanelProps {
  readonly layers: readonly EditorLayer[];
  readonly onVisibilityToggle: (layerId: string) => void;
  readonly onLockToggle: (layerId: string) => void;
  readonly onMove: (layerId: string, targetIndex: number) => void;
  readonly onIsolate?: (layerId: string) => void;
}

export function resolveLayerDropIndex(layers: readonly EditorLayer[], layerId: string, dropIndex: number): number {
  const sourceIndex = layers.findIndex((layer) => layer.id === layerId);
  return sourceIndex >= 0 && sourceIndex < dropIndex ? dropIndex - 1 : dropIndex;
}

export function LayersPanel({ layers, onVisibilityToggle, onLockToggle, onMove, onIsolate }: LayersPanelProps) {
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const beginDrag = (event: DragEvent<HTMLElement>, layerId: string) => {
    setDraggedLayerId(layerId);
    setDropIndex(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-techmap-layer", layerId);
  };

  const endDrag = () => {
    setDraggedLayerId(null);
    setDropIndex(null);
  };

  const dropLayer = (event: DragEvent<HTMLElement>, targetIndex: number) => {
    event.preventDefault();
    const layerId = event.dataTransfer.getData("application/x-techmap-layer") || draggedLayerId;
    if (layerId) {
      onMove(layerId, resolveLayerDropIndex(layers, layerId, targetIndex));
    }
    endDrag();
  };

  const allowDrop = (event: DragEvent<HTMLElement>, targetIndex: number) => {
    if (!draggedLayerId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropIndex(targetIndex);
  };

  const rowDropIndex = (event: DragEvent<HTMLLIElement>, index: number): number => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? index : index + 1;
  };

  return (
    <div className="he-layers-panel">
      <div className="he-panel-note">Верхний слой рисуется поверх остальных.</div>
      <ol className="he-layer-list" aria-label="Слои композиции">
        <li
          className={`he-layer-drop-slot${dropIndex === 0 ? " is-active" : ""}`}
          aria-label="Вставить слой перед первым слоем"
          onDragOver={(event) => allowDrop(event, 0)}
          onDrop={(event) => dropLayer(event, 0)}
        />
        {layers.map((layer, index) => (
          <Fragment key={layer.id}>
            <li
              className={`${draggedLayerId === layer.id ? "he-layer-row dragging" : "he-layer-row"}${layer.visible ? "" : " is-hidden"}`}
              aria-grabbed={draggedLayerId === layer.id}
              onDragOver={(event) => allowDrop(event, rowDropIndex(event, index))}
              onDrop={(event) => dropLayer(event, rowDropIndex(event, index))}
            >
              <span
                className="he-drag-handle"
                title="Перетащить слой"
                aria-label={`Перетащить слой ${layer.label}`}
                draggable
                onDragStart={(event) => beginDrag(event, layer.id)}
                onDragEnd={endDrag}
              >⠿</span>
              <span className="he-layer-name">{layer.label}</span>
              {onIsolate && <button
                type="button"
                className="he-layer-isolate"
                aria-label={`Изолировать слой ${layer.label}`}
                title={`Изолировать слой «${layer.label}»`}
                onClick={() => onIsolate(layer.id)}
              >Изолировать</button>}
              <button
                type="button"
                className={layer.visible ? "he-layer-visibility active" : "he-layer-visibility"}
                aria-label={`${layer.visible ? "Скрыть" : "Показать"} слой ${layer.label}`}
                aria-pressed={layer.visible}
                title={layer.visible ? `Скрыть слой «${layer.label}»` : `Показать слой «${layer.label}»`}
                onClick={() => onVisibilityToggle(layer.id)}
              >
                <span aria-hidden="true">{layer.visible ? "◉" : "○"}</span>
                <span>{layer.visible ? "Скрыть" : "Показать"}</span>
              </button>
              <button
                type="button"
                className={layer.locked ? "he-layer-control active" : "he-layer-control"}
                aria-label={`${layer.locked ? "Разблокировать" : "Заблокировать"} слой ${layer.label}`}
                aria-pressed={layer.locked}
                title={layer.locked ? "Разблокировать" : "Заблокировать"}
                onClick={() => onLockToggle(layer.id)}
              >
                {layer.locked ? "●" : "◌"}
              </button>
            </li>
            <li
              className={`he-layer-drop-slot${dropIndex === index + 1 ? " is-active" : ""}`}
              aria-label={`Вставить слой после слоя ${layer.label}`}
              onDragOver={(event) => allowDrop(event, index + 1)}
              onDrop={(event) => dropLayer(event, index + 1)}
            />
          </Fragment>
        ))}
      </ol>
    </div>
  );
}

