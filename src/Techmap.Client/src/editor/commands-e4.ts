import {
  findWire,
  snapE4AngularBend,
  updateConnector,
  replaceRequired,
  requireWireIds,
  pointOnOrthogonalSegment,
  validateJunctionAgainstWires,
  validateWireGroups,
} from "./editor-command-invariants";
import {
  screenJunctionEnds,
  createE4RoutingRequest,
  requireE4ModeGeometry,
  validateE4WireIds,
} from "./command-e4-analysis";
import {
  editedE4Points,
  orthogonalE4Deformation,
  movedE4Junctions,
  preserveE4Leads,
  followE4Junctions,
} from "./e4-editing";
import {
  repairE4JunctionBranches,
  setE4WireRoute,
  rebuildConnectorE4Wires,
  retainEditableE4Routes,
  reflowWiresAroundLabel,
  removeE4WireRoutePoint,
  rerouteE4WireBatch,
  screenAttachmentWireIds,
  rerouteWireE4ThroughJunctions,
} from "./command-e4-routing";
import { normalizeE4WireLabelPosition } from "./e4-wire-label";
import { wireEndpointE4Anchor, type HarnessDesignDocument, validateE4Polyline } from "./model";
import { validateE4Route } from "./e4-router";
import { type EditorCommand } from "./editor-command-types";

export function applyE4Command(document: HarnessDesignDocument, command: Extract<EditorCommand, { type: "edit-e4-bend" | "use-e4-table" | "set-e4-wire-label-position" | "set-e4-wire-route" | "move-e4-wire-route-point" | "remove-e4-wire-route-point" | "reroute-e4-wires" | "move-e4-wire-segment" | "set-wire-crossing-style" | "set-e4-routing-mode" }>): HarnessDesignDocument {
  switch (command.type) {

    case "edit-e4-bend": {
      const wire=findWire(document,command.wireId);
      if(document.views.e4.layers.some(l=>l.id===wire.layerIds.e4&&l.locked))throw new Error("Слой проводов заблокирован.");
      if(screenJunctionEnds(wire))throw new Error("Подключение экрана к проводу должно быть прямым, без изгибов.");
      const request=createE4RoutingRequest(document,wire,wire.id);
      const original=[request.start.position,...wire.e4Route,request.end.position];
      const authoredPosition=document.views.e4.e4RoutingMode==="angular"
        ? snapE4AngularBend(original,command.index,command.position,!!command.insert)
        : command.position;
      const editMode=document.views.e4.e4RoutingMode==="angular"?"adjacent":command.mode;
      const raw=editedE4Points(original,command.index,authoredPosition,editMode,command.insert,false);
      const baseline=[...original];
      if(command.insert){const a=baseline[command.index]!,b=baseline[command.index+1]!;baseline.splice(command.index+1,0,{x:(a.x+b.x)/2,y:(a.y+b.y)/2});}
      const geometry=document.views.e4.e4RoutingMode!=="angular"
        ?orthogonalE4Deformation(baseline,raw,request.start,request.end,editMode,command.index+1,!!command.insert):null;
      const positions=movedE4Junctions(document,wire.id,baseline,geometry?.vertices??raw,geometry?.segments,geometry?.points);
      const points=geometry?.points??editedE4Points(original,command.index,authoredPosition,editMode,command.insert);
      const route=preserveE4Leads(points,request.start,request.end).slice(1,-1);
      let changed=followE4Junctions(document,{...document,wires:document.wires.map(w=>w.id===wire.id?{...w,e4Route:route,e4RouteMode:"manual" as const}:w)},positions,new Set([wire.id]),editMode);
      const branches=new Set(changed.junctions.filter(j=>positions.has(j.id)).flatMap(j=>j.wireIds).filter(id=>id!==wire.id));
      if(changed.wires.some(w=>branches.has(w.id)&&changed.views.e4.layers.some(l=>l.id===w.layerIds.e4&&l.locked)))throw new Error("Слой присоединённой ветви заблокирован.");
      changed=repairE4JunctionBranches(changed,branches);
      return setE4WireRoute(changed,wire.id,route);
    }

    case "use-e4-table": {
      const before = document.connectors.find(item => item.id === command.connectorId);
      if (!before) throw new Error("Соединитель не найден.");
      if (before.e4TableMode) return document;
      const changed = updateConnector(document, command.connectorId, connector => ({ ...connector, e4TableMode: true }));
      try { return rebuildConnectorE4Wires(changed, command.connectorId, before); }
      catch { return retainEditableE4Routes(changed); }
    }

    case "set-e4-wire-label-position": {
      const changed = {
        ...document,
        wires: replaceRequired(document.wires, command.wireId, (wire) => ({
          ...wire,
          e4LabelPosition: normalizeE4WireLabelPosition(command.position),
        }), "Провод не найден."),
      };
      // Moving an annotation must not move the wire that owns it. Automatic
      // neighboring wires may reroute around the label's new rectangle.
      return reflowWiresAroundLabel(changed, command.wireId);
    }

    case "set-e4-wire-route": {
      const wire=findWire(document,command.wireId);
      if(screenJunctionEnds(wire)&&command.route.length>0)throw new Error("Подключение экрана к проводу должно быть прямым, без изгибов.");
      const start=wireEndpointE4Anchor(document,wire.from),end=wireEndpointE4Anchor(document,wire.to);
      if(!start||!end)throw new Error("Точки подключения маршрута Э4 не найдены.");
      requireE4ModeGeometry(document,[start.position,...command.route,end.position]);
      return setE4WireRoute(document, command.wireId, command.route);
    }

    case "move-e4-wire-route-point": {
      const wire = findWire(document, command.wireId);
      if (!Number.isSafeInteger(command.pointIndex) || command.pointIndex < 0 || command.pointIndex >= wire.e4Route.length) {
        throw new Error("Точка маршрута Э4 не найдена.");
      }
      return setE4WireRoute(document, command.wireId, wire.e4Route.map((point, index) =>
        index === command.pointIndex ? { ...command.position } : point));
    }

    case "remove-e4-wire-route-point":
      return removeE4WireRoutePoint(document, command.wireId, command.pointIndex);

    case "reroute-e4-wires": {
      requireWireIds(document, command.wireIds);
      const selected = new Set(command.wireIds);
      const changed = { ...document, wires: document.wires.map(wire => selected.has(wire.id)
        ? { ...wire, e4RouteMode: "auto" as const } : wire) };
      return rerouteE4WireBatch(changed, changed.wires.filter(wire => wire.e4RouteMode !== "manual").map(wire => wire.id));
    }

    case "move-e4-wire-segment": {
      const wire = findWire(document, command.wireId);
      if (!Number.isSafeInteger(command.segmentIndex) || command.segmentIndex < 1 || command.segmentIndex >= wire.e4Route.length) {
        throw new Error("Перемещать можно только внутренний сегмент маршрута Э4.");
      }
      const first = wire.e4Route[command.segmentIndex - 1]!;
      const second = wire.e4Route[command.segmentIndex]!;
      const route = wire.e4Route.map((point) => ({ ...point }));
      if (first.x === second.x) {
        route[command.segmentIndex - 1] = { x: command.position.x, y: first.y };
        route[command.segmentIndex] = { x: command.position.x, y: second.y };
      } else if (first.y === second.y) {
        route[command.segmentIndex - 1] = { x: first.x, y: command.position.y };
        route[command.segmentIndex] = { x: second.x, y: command.position.y };
      } else {
        throw new Error("Сегмент маршрута Э4 должен быть ортогональным.");
      }
      const movedJunctionIds = new Set(document.junctions
        .filter((junction) => junction.wireIds.includes(command.wireId) && pointOnOrthogonalSegment(junction.position, first, second))
        .map((junction) => junction.id));
      let changed: HarnessDesignDocument = {
        ...document,
        wires: document.wires.map((item) => item.id === command.wireId
          ? { ...item, e4Route: route, e4RouteMode: "manual" as const }
          : item),
        junctions: document.junctions.map((junction) => !movedJunctionIds.has(junction.id)
          ? junction
          : first.x === second.x
            ? { ...junction, position: { ...junction.position, x: command.position.x } }
            : { ...junction, position: { ...junction.position, y: command.position.y } }),
      };
      const start = wireEndpointE4Anchor(changed, wire.from);
      const end = wireEndpointE4Anchor(changed, wire.to);
      if (!start || !end) throw new Error("Точки подключения маршрута Э4 не найдены.");
      validateE4Polyline(start, route, end);
      const otherWireIds = new Set([
        ...changed.junctions
          .filter((junction) => movedJunctionIds.has(junction.id))
          .flatMap((junction) => junction.wireIds)
          .filter((wireId) => wireId !== command.wireId),
        ...screenAttachmentWireIds(changed, [command.wireId]),
      ]);
      // A manual segment drag owns only the selected route.  Automatic
      // neighbours are not an implicit dependency: moving one wire must not
      // silently rebuild an unrelated differential pair or the rest of the
      // scheme.  Junction and screen attachments remain explicit dependencies
      // and are handled through `otherWireIds` above.
      const excludedWireIds = command.detached
        ? new Set(changed.wires.map(item => item.id))
        : new Set([command.wireId, ...otherWireIds]);
      validateE4Route([start.position, ...route, end.position], createE4RoutingRequest(
        changed, wire, command.wireId, undefined, undefined, excludedWireIds,
      ));
      const pendingWireIds = [...otherWireIds];
      for (const wireId of pendingWireIds) {
        otherWireIds.delete(wireId);
        changed = rerouteWireE4ThroughJunctions(changed, wireId, otherWireIds);
      }
      for (const junction of changed.junctions.filter((item) => movedJunctionIds.has(item.id))) {
        validateJunctionAgainstWires(changed, junction);
      }
      validateWireGroups(changed);
      if (!command.detached) {
        // Validate only the selected route and explicit shared attachments.
        // Independent automatic routes deliberately retain their geometry.
        validateE4WireIds(changed, [...new Set([command.wireId, ...otherWireIds])]);
      }
      return changed;
    }

    case "set-wire-crossing-style":
      if (command.style !== "none" && command.style !== "bridge") throw new Error("Режим пересечения проводов задан неверно.");
      return {
        ...document,
        views: { ...document.views, [command.view]: { ...document.views[command.view], wireCrossingStyle: command.style } },
      };

    case "set-e4-routing-mode": {
      const changed = {
        ...document,
        views: { ...document.views, e4: { ...document.views.e4, e4RoutingMode: command.mode } },
      };
      if (command.mode === "orthogonal") return changed;
      return rerouteE4WireBatch(changed, changed.wires.filter(wire => wire.e4RouteMode !== "manual").map(wire => wire.id));
    }
  }
}
