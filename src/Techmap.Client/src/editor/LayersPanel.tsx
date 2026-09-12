import { useState, type DragEvent } from "react";
import type { EditorLayer } from "./editor-types";

export interface LayersPanelProps {
  readonly layers: readonly EditorLayer[];
  readonly onVisibilityToggle: (layerId: string) => void;
  readonly onLockToggle: (layerId: string) => void;
  readonly onMove: (layerId: string, targetIndex: number) => void;
}

export function LayersPanel({ layers, onVisibilityToggle, onLockToggle, onMove }: LayersPanelProps) {
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);

  const beginDrag = (event: DragEvent<HTMLLIElement>, layerId: string) => {
    setDraggedLayerId(layerId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-techmap-layer", layerId);
  };

  const dropLayer = (event: DragEvent<HTMLLIElement>, targetIndex: number) => {
    event.preventDefault();
    const layerId = event.dataTransfer.getData("application/x-techmap-layer") || draggedLayerId;
    if (layerId) onMove(layerId, targetIndex);
    setDraggedLayerId(null);
  };

  return (
    <div className="he-layers-panel">
      <div className="he-panel-note">Верхний слой рисуется поверх остальных.</div>
      <ol className="he-layer-list" aria-label="Слои композиции">
        {layers.map((layer, index) => (
          <li
            className={draggedLayerId === layer.id ? "he-layer-row dragging" : "he-layer-row"}
            key={layer.id}
            draggable
            onDragStart={(event) => beginDrag(event, layer.id)}
            onDragEnd={() => setDraggedLayerId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => dropLayer(event, index)}
          >
            <span className="he-drag-handle" title="Перетащить слой" aria-hidden="true">⠿</span>
            <span className="he-layer-name">{layer.label}</span>
            <button
              type="button"
              className={layer.visible ? "he-layer-control active" : "he-layer-control"}
              aria-label={`${layer.visible ? "Скрыть" : "Показать"} слой ${layer.label}`}
              aria-pressed={layer.visible}
              title={layer.visible ? "Скрыть" : "Показать"}
              onClick={() => onVisibilityToggle(layer.id)}
            >
              {layer.visible ? "◉" : "○"}
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
            <span className="he-layer-order-controls">
              <button
                type="button"
                aria-label={`Поднять слой ${layer.label}`}
                disabled={index === 0}
                onClick={() => onMove(layer.id, index - 1)}
              >↑</button>
              <button
                type="button"
                aria-label={`Опустить слой ${layer.label}`}
                disabled={index === layers.length - 1}
                onClick={() => onMove(layer.id, index + 1)}
              >↓</button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

