import type { EditorSceneObject, HarnessEditorView } from "./editor-types";
import {
  connectorCanvasContactPoints, contactCrossCenter, e4CellText, e4ContactMarker,
  getMaterializedConnectorContactPoints,
  type E4ContactRow, type E4ConnectorColumnLayout, type E4ConnectorLayout,
} from "./canvas-connector-layout";
import { resolveWireColorHex } from "./wire-reference-catalog";

export function drawSelectedConnectorContacts(context: CanvasRenderingContext2D, object: EditorSceneObject, view: HarnessEditorView, zoom: number): void {
  context.save();context.lineWidth=2/zoom;context.strokeStyle="#007da8";context.fillStyle="#e1faff";
  for (const contact of connectorCanvasContactPoints(object,view)) {
    if (!contact) continue;
    for (const point of [contact, ...(contact.secondaryPoint?[contact.secondaryPoint]:[])]) {
      context.beginPath();context.arc(point.x,point.y,6/zoom,0,Math.PI*2);context.fill();context.stroke();
      context.beginPath();context.arc(point.x,point.y,2/zoom,0,Math.PI*2);context.fillStyle="#007da8";context.fill();context.fillStyle="#e1faff";
    }
  }
  context.restore();
}


export function drawConnectorContactOverrides(
  context: CanvasRenderingContext2D,
  object: EditorSceneObject,
  view: HarnessEditorView,
  includeFallback: boolean,
): void {
  const points = connectorCanvasContactPoints(object, view);
  const materialized = getMaterializedConnectorContactPoints(object);
  context.save();
  context.lineCap = "round";
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point) continue;
    if (!includeFallback && !materialized?.[index]) continue;
    if (point.status === "available") {
      context.fillStyle = object.color;
      context.beginPath();
      context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      context.fill();
      if (point.secondaryPoint) {
        context.beginPath();
        context.arc(point.secondaryPoint.x, point.secondaryPoint.y, 3.5, 0, Math.PI * 2);
        context.fill();
      }
      continue;
    }
    const cross = contactCrossCenter(point);
    context.strokeStyle = "#2c3fbd";
    context.lineWidth = 1.7;
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(cross.x, cross.y);
    context.moveTo(cross.x - point.crossSize, cross.y - point.crossSize);
    context.lineTo(cross.x + point.crossSize, cross.y + point.crossSize);
    context.moveTo(cross.x - point.crossSize, cross.y + point.crossSize);
    context.lineTo(cross.x + point.crossSize, cross.y - point.crossSize);
    context.stroke();
  }
  context.restore();
}

function drawE4CellText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  context.save();
  context.beginPath();
  context.rect(x + 3, y + 1, Math.max(0, width - 6), Math.max(0, height - 2));
  context.clip();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x + width / 2, y + height / 2);
  context.restore();
}

function drawE4ColorCell(
  context: CanvasRenderingContext2D,
  row: E4ContactRow,
  column: E4ConnectorColumnLayout,
  y: number,
  height: number,
) {
  const label = e4CellText(row, "color");
  if (!label) return;
  const swatchWidth = Math.min(26, Math.max(14, column.width - 12));
  const swatchHeight = Math.min(13, height - 7);
  const swatchX = column.x + 5;
  const swatchY = y + (height - swatchHeight) / 2;
  const primary = resolveWireColorHex(row.color, undefined, "#d9e2e7");
  const secondary = row.secondaryColor
    ? resolveWireColorHex(row.secondaryColor, undefined, "#d9e2e7")
    : "";
  context.save();
  context.beginPath();
  context.rect(column.x + 1, y + 1, column.width - 2, height - 2);
  context.clip();
  if (secondary) {
    context.fillStyle = primary;
    context.beginPath();
    context.moveTo(swatchX, swatchY);
    context.lineTo(swatchX + swatchWidth, swatchY);
    context.lineTo(swatchX + swatchWidth, swatchY + swatchHeight);
    context.closePath();
    context.fill();
    context.fillStyle = secondary;
    context.beginPath();
    context.moveTo(swatchX, swatchY);
    context.lineTo(swatchX, swatchY + swatchHeight);
    context.lineTo(swatchX + swatchWidth, swatchY + swatchHeight);
    context.closePath();
    context.fill();
  } else {
    context.fillStyle = primary;
    context.fillRect(swatchX, swatchY, swatchWidth, swatchHeight);
  }
  context.strokeStyle = "#8297a2";
  context.lineWidth = 1;
  context.strokeRect(swatchX, swatchY, swatchWidth, swatchHeight);
  if (column.width - swatchWidth >= 36) {
    context.fillStyle = "#284957";
    context.font = "500 8px Inter, Arial, sans-serif";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(label, swatchX + swatchWidth + 4, y + height / 2);
  }
  context.restore();
}

export function drawE4Connector(
  context: CanvasRenderingContext2D,
  object: EditorSceneObject,
  layout: E4ConnectorLayout,
  selected: boolean,
) {
  const headerY = layout.y + layout.titleHeight;
  const bodyY = headerY + layout.headerHeight;
  const footerY = bodyY + layout.rows.length * layout.rowHeight;
  context.fillStyle = "#ffffff";
  context.fillRect(layout.x, layout.y, layout.width, layout.height);
  context.fillStyle = "#e9f0f3";
  context.fillRect(layout.x, layout.y, layout.width, layout.titleHeight);
  context.fillStyle = "#f4f7f8";
  context.fillRect(layout.x, headerY, layout.width, layout.headerHeight);
  context.fillStyle = "#f4f7f8";
  context.fillRect(layout.x, footerY, layout.width, layout.footerHeight);

  const hasDiagnostic = object.metadata?.diagnostic === "error";
  // E4 tables keep the crisp selected outline even when they are not the
  // active object.  The table is dense and its 1.5px default border becomes
  // soft at common canvas zoom levels; the C2 reference shows the readable
  // 3px blue outline as the steady table treatment.  Selection still controls
  // interaction handles in the final canvas pass.
  context.strokeStyle = hasDiagnostic ? "#c43d3d" : "#087bb4";
  context.lineWidth = 3;
  context.strokeRect(layout.x, layout.y, layout.width, layout.height);
  if (hasDiagnostic) {
    context.save();
    context.fillStyle = "#c43d3d";
    context.beginPath();
    context.arc(layout.x + layout.width - 12, layout.y + layout.titleHeight / 2, 8, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#fff";
    context.font = "800 11px Inter, Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("!", layout.x + layout.width - 12, layout.y + layout.titleHeight / 2 + 0.5);
    context.restore();
  }
  context.lineWidth = 1;
  context.strokeStyle = "#9fb2bc";
  context.beginPath();
  context.moveTo(layout.x, headerY);
  context.lineTo(layout.x + layout.width, headerY);
  context.moveTo(layout.x, bodyY);
  context.lineTo(layout.x + layout.width, bodyY);
  context.moveTo(layout.x, footerY);
  context.lineTo(layout.x + layout.width, footerY);
  for (const column of layout.columns.slice(1)) {
    context.moveTo(column.x, headerY);
    context.lineTo(column.x, footerY);
  }
  for (let index = 1; index < layout.rows.length; index += 1) {
    const rowY = bodyY + index * layout.rowHeight;
    context.moveTo(layout.x, rowY);
    context.lineTo(layout.x + layout.width, rowY);
  }
  context.stroke();

  context.fillStyle = "#17384b";
  context.font = "800 12px Inter, Arial, sans-serif";
  drawE4CellText(context, layout.designation, layout.x + layout.width * 0.3, layout.y, layout.width * 0.4, layout.titleHeight);
  context.fillStyle = "#2584a8";
  context.font = "700 8px Inter, Arial, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText("⊕ Добавить…", layout.x + 6, layout.y + layout.titleHeight / 2);

  context.font = "700 9px Inter, Arial, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "middle";
  const codeWidth = Math.min(layout.width * 0.35, Math.max(34, context.measureText(layout.libraryCode).width + 14));
  context.save();
  context.beginPath();
  context.rect(layout.x + 5, footerY + 1, Math.max(0, codeWidth - 10), layout.footerHeight - 2);
  context.clip();
  context.fillStyle = "#405f6e";
  context.fillText(layout.libraryCode, layout.x + 7, footerY + layout.footerHeight / 2);
  context.restore();
  context.save();
  context.beginPath();
  context.rect(layout.x + codeWidth, footerY + 1, Math.max(0, layout.width - codeWidth - 7), layout.footerHeight - 2);
  context.clip();
  context.fillStyle = "#d62f45";
  context.fillText(layout.partNumber, layout.x + codeWidth + 3, footerY + layout.footerHeight / 2);
  context.restore();

  context.fillStyle = "#405f6e";
  context.font = "700 10px Inter, Arial, sans-serif";
  for (const column of layout.columns) {
    drawE4CellText(context, column.label, column.x, headerY, column.width, layout.headerHeight);
  }

  context.fillStyle = "#284957";
  context.font = "500 10px Inter, Arial, sans-serif";
  layout.rows.forEach((row, rowIndex) => {
    const rowY = bodyY + rowIndex * layout.rowHeight;
    for (const column of layout.columns) {
      if (column.id === "color") drawE4ColorCell(context, row, column, rowY, layout.rowHeight);
      else drawE4CellText(context, e4CellText(row, column.id), column.x, rowY, column.width, layout.rowHeight);
    }
    if (getMaterializedConnectorContactPoints(object)?.[rowIndex]) return;
    const point = layout.contactPoints[rowIndex]!;
    const marker = e4ContactMarker(row.status, layout.connectionSide);
    if (marker) {
      context.save();
      context.strokeStyle = "#2c3fbd";
      context.lineWidth = 1.7;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(point.x + marker.lineStart.x, point.y + marker.lineStart.y);
      context.lineTo(point.x + marker.lineEnd.x, point.y + marker.lineEnd.y);
      context.stroke();
      context.beginPath();
      context.moveTo(
        point.x + marker.crossCenter.x - marker.crossSize,
        point.y + marker.crossCenter.y - marker.crossSize,
      );
      context.lineTo(
        point.x + marker.crossCenter.x + marker.crossSize,
        point.y + marker.crossCenter.y + marker.crossSize,
      );
      context.moveTo(
        point.x + marker.crossCenter.x - marker.crossSize,
        point.y + marker.crossCenter.y + marker.crossSize,
      );
      context.lineTo(
        point.x + marker.crossCenter.x + marker.crossSize,
        point.y + marker.crossCenter.y - marker.crossSize,
      );
      context.stroke();
      context.restore();
    } else {
      context.fillStyle = object.color;
      context.beginPath();
      context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = "#284957";
    context.font = "500 10px Inter, Arial, sans-serif";
  });
}
