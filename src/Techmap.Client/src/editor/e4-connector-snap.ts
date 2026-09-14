import type { EditorPoint } from "./editor-types";

/** World-space bounds and contact anchors used for transient table alignment. */
export interface E4ConnectorSnapTarget {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly contactSide: "left" | "right";
  /** First contact centre, in world coordinates. Empty tables have no row guide. */
  readonly firstContactY?: number;
}

export interface E4ConnectorSnapGuides {
  readonly vertical?: { readonly x: number; readonly fromY: number; readonly toY: number };
  readonly horizontal?: { readonly y: number; readonly fromX: number; readonly toX: number };
}

export interface E4ConnectorSnapResult {
  readonly position: EditorPoint;
  readonly guides: E4ConnectorSnapGuides;
}

/** An eight-screen-pixel magnetic zone, independent per axis and independent of zoom. */
export function snapE4ConnectorPosition(
  moving: E4ConnectorSnapTarget,
  targets: readonly E4ConnectorSnapTarget[],
  position: EditorPoint,
  zoom: number,
  thresholdPixels = 8,
): E4ConnectorSnapResult {
  const threshold = thresholdPixels / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
  const contactSideX = (table: E4ConnectorSnapTarget, x: number) =>
    x + (table.contactSide === "right" ? table.width : 0);
  const proposedContactX = contactSideX(moving, position.x);
  const proposedFirstContactY = moving.firstContactY === undefined
    ? undefined : position.y + moving.firstContactY - moving.y;
  let closestX: E4ConnectorSnapTarget | undefined;
  let closestY: E4ConnectorSnapTarget | undefined;
  let xDistance = threshold;
  let yDistance = threshold;
  for (const target of targets) {
    if (target.id === moving.id) continue;
    const horizontalDistance = Math.abs(contactSideX(target, target.x) - proposedContactX);
    if (horizontalDistance <= xDistance && (horizontalDistance < xDistance || !closestX)) {
      closestX = target;
      xDistance = horizontalDistance;
    }
    if (proposedFirstContactY !== undefined && target.firstContactY !== undefined) {
      const verticalDistance = Math.abs(target.firstContactY - proposedFirstContactY);
      if (verticalDistance <= yDistance && (verticalDistance < yDistance || !closestY)) {
        closestY = target;
        yDistance = verticalDistance;
      }
    }
  }
  const snappedX = closestX
    ? position.x + contactSideX(closestX, closestX.x) - proposedContactX : position.x;
  const snappedY = closestY && proposedFirstContactY !== undefined
    ? position.y + closestY.firstContactY! - proposedFirstContactY : position.y;
  return {
    position: { x: snappedX, y: snappedY },
    guides: {
      ...(closestX ? { vertical: {
        x: contactSideX(closestX, closestX.x),
        fromY: Math.min(snappedY, closestX.y),
        toY: Math.max(snappedY + moving.height, closestX.y + closestX.height),
      } } : {}),
      ...(closestY ? { horizontal: {
        y: closestY.firstContactY!,
        fromX: Math.min(snappedX, closestY.x),
        toX: Math.max(snappedX + moving.width, closestY.x + closestY.width),
      } } : {}),
    },
  };
}
