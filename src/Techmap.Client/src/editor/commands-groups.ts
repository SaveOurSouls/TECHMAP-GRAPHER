import {
  isJunctionEndpoint,
  type HarnessDesignDocument,
  createJunctionEndpoint,
  wireE4PathContainsPoint,
  isScreenEndpoint,
  wireEndpointE4Anchor,
} from "./model";
import {
  validateWire,
  normalizeJunction,
  validateJunctionAgainstWires,
  normalizeJunctionCircuits,
  requireJunction,
  validateWireGroups,
  findWire,
  replaceRequired,
  updateJunctionMembership,
  pointsMatch,
  normalizeDiffPair,
  removeRequired,
  normalizeScreen,
  cleanupWireReferences,
} from "./editor-command-invariants";
import { rerouteWireE4, rerouteE4WireBatch } from "./command-e4-routing";
import { validateAllE4Wires } from "./command-e4-analysis";
import { compactAutomaticDifferentialPairs } from "./command-e4-pair-planner";
import { type EditorCommand } from "./editor-command-types";

export function applyGroupsCommand(document: HarnessDesignDocument, command: Extract<EditorCommand, { type: "create-junction" | "move-junction" | "remove-junction" | "connect-wire-to-junction" | "connect-wire-to-wire" | "create-diff-pair" | "update-diff-pair" | "remove-diff-pair" | "create-screen" | "update-screen" | "remove-screen" }>): HarnessDesignDocument {
  switch (command.type) {

    case "create-junction": {
      if (document.junctions.some((item) => item.id === command.junction.id)) throw new Error("Узел соединения с таким ID уже существует.");
      let changed = document;
      if (command.branchWire) {
        const endpointMatches = [command.branchWire.from, command.branchWire.to].some((endpoint) =>
          isJunctionEndpoint(endpoint) && endpoint.junctionId === command.junction.id);
        if (!endpointMatches) throw new Error("Ветвь должна завершаться в создаваемом узле соединения.");
        validateWire(document, command.branchWire, command.junction.id);
        if (document.wires.some((wire) => wire.id === command.branchWire!.id)) throw new Error("Провод с таким ID уже существует.");
        changed = { ...document, wires: [...document.wires, command.branchWire] };
      }
      const junction = normalizeJunction(command.junction);
      if (command.branchWire && !junction.wireIds.includes(command.branchWire.id)) {
        throw new Error("Создаваемый узел должен содержать ID новой ветви.");
      }
      validateJunctionAgainstWires(changed, junction);
      const result = { ...changed, junctions: [...changed.junctions, junction] };
      return normalizeJunctionCircuits(command.branchWire ? rerouteWireE4(result, command.branchWire.id) : result);
    }

    case "move-junction": {
      const junction = requireJunction(document, command.junctionId);
      let changed: HarnessDesignDocument = { ...document, junctions: document.junctions.map((item) =>
        item.id === junction.id ? { ...item, position: { ...command.position } } : item) };
      // A moved junction changes the routes and therefore the positions of
      // their labels. Reflow every automatic route in the same transaction so
      // a newly positioned label cannot be left over an unrelated conductor.
      changed = rerouteE4WireBatch(changed, changed.wires
        .filter((wire) => wire.e4RouteMode !== "manual" || junction.wireIds.includes(wire.id))
        .map((wire) => wire.id));
      validateJunctionAgainstWires(changed, changed.junctions.find((item) => item.id === junction.id)!);
      validateWireGroups(changed);
      validateAllE4Wires(changed);
      return changed;
    }

    case "remove-junction": {
      const junction = requireJunction(document, command.junctionId);
      if (document.wires.some((wire) => [wire.from, wire.to].some((endpoint) =>
        isJunctionEndpoint(endpoint) && endpoint.junctionId === junction.id))) {
        throw new Error("Нельзя удалить узел соединения, в котором завершается ветвь.");
      }
      return { ...document, junctions: document.junctions.filter((item) => item.id !== junction.id) };
    }

    case "connect-wire-to-junction": {
      const existingJunction = requireJunction(document, command.junctionId);
      const original = findWire(document, command.wireId);
      const changed = {
        ...document,
        wires: replaceRequired(document.wires, command.wireId, (wire) => ({
          ...wire,
          [command.end]: createJunctionEndpoint(command.junctionId),
        }), "Провод не найден."),
      };
      const result = updateJunctionMembership(changed, command.wireId, original[command.end], createJunctionEndpoint(command.junctionId));
      validateJunctionAgainstWires(result, result.junctions.find((item) => item.id === existingJunction.id)!);
      const routed = rerouteWireE4(result, command.wireId);
      validateWireGroups(routed);
      return normalizeJunctionCircuits(routed);
    }

    case "connect-wire-to-wire": {
      if (command.wireId === command.targetWireId) throw new Error("Провод нельзя подключить к самому себе.");
      const target = findWire(document, command.targetWireId);
      const existingJunction = document.junctions.find((junction) => junction.id === command.junctionId);
      const junctionPosition = existingJunction?.position ?? command.position;
      if (existingJunction && !pointsMatch(existingJunction.position, command.position)) {
        throw new Error("Существующий узел находится в другой точке.");
      }
      if (!wireE4PathContainsPoint(document, target, junctionPosition)) throw new Error("Целевой провод не проходит через точку соединения.");
      const original = findWire(document, command.wireId);
      const changed = {
        ...document,
        wires: replaceRequired(document.wires, command.wireId, (wire) => ({
          ...wire,
          [command.end]: createJunctionEndpoint(command.junctionId),
        }), "Провод не найден."),
      };
      const junction = existingJunction
        ? normalizeJunction({ ...existingJunction, wireIds: [...new Set([...existingJunction.wireIds, command.targetWireId, command.wireId])] })
        : normalizeJunction({ id: command.junctionId, position: command.position, wireIds: [command.targetWireId, command.wireId] });
      const membership = updateJunctionMembership(changed, command.wireId, original[command.end], createJunctionEndpoint(command.junctionId));
      const result = { ...membership, junctions: existingJunction
        ? membership.junctions.map((item) => item.id === junction.id ? junction : item)
        : [...membership.junctions, junction] };
      validateJunctionAgainstWires(result, junction);
      const routed = rerouteWireE4(result, command.wireId);
      validateWireGroups(routed);
      return normalizeJunctionCircuits(routed);
    }

    case "create-diff-pair": {
      const group = normalizeDiffPair(document, command.group);
      if (document.diffPairs.some((item) => item.id === group.id)) throw new Error("Дифференциальная пара с таким ID уже существует.");
      if (document.diffPairs.some((item) => item.wireIds.some((wireId) => group.wireIds.includes(wireId)))) {
        throw new Error("Провод уже входит в другую дифференциальную пару.");
      }
      return compactAutomaticDifferentialPairs(
        { ...document, diffPairs: [...document.diffPairs, group] },
        group.wireIds,
      );
    }

    case "update-diff-pair":
      const changed = {
        ...document,
        diffPairs: replaceRequired(document.diffPairs, command.groupId, (group) => normalizeDiffPair(document, {
          ...group,
          variant: command.variant ?? group.variant,
          step: command.step ?? group.step,
          amplitude: command.amplitude ?? group.amplitude,
        }), "Дифференциальная пара не найдена."),
      };
      const group = changed.diffPairs.find(item => item.id === command.groupId);
      return group ? compactAutomaticDifferentialPairs(changed, group.wireIds) : changed;

    case "remove-diff-pair":
      return { ...document, diffPairs: removeRequired(document.diffPairs, command.groupId, "Дифференциальная пара не найдена.") };

    case "create-screen": {
      const screen = normalizeScreen(document, command.screen);
      if (document.screens.some((item) => item.id === screen.id)) throw new Error("Экран с таким ID уже существует.");
      return { ...document, screens: [...document.screens, screen] };
    }

    case "update-screen": {
      const changed = {
        ...document,
        screens: replaceRequired(document.screens, command.screenId, (screen) => normalizeScreen(document, {
          ...screen,
          wireIds: command.wireIds ?? screen.wireIds,
          position: command.position ?? screen.position,
          label: command.label ?? screen.label,
          width: command.width ?? screen.width,
          terminalSide: command.terminalSide ?? screen.terminalSide,
        }), "Экран не найден."),
      };
      const attachedWires = changed.wires.filter((wire) => [wire.from, wire.to].some((endpoint) =>
        isScreenEndpoint(endpoint) && endpoint.screenId === command.screenId));
      if (attachedWires.some((wire) => [wire.from, wire.to].some((endpoint) =>
        isScreenEndpoint(endpoint) && endpoint.screenId === command.screenId && !wireEndpointE4Anchor(changed, endpoint)))) {
        throw new Error("Выбранная сторона экрана уже используется. Сначала переподключите или удалите провод.");
      }
      const attachedWireIds = attachedWires.map((wire) => wire.id);
      return rerouteE4WireBatch(changed, attachedWireIds);
    }

    case "remove-screen": {
      const attachedWireIds = document.wires.filter((wire) => [wire.from, wire.to].some((endpoint) =>
        isScreenEndpoint(endpoint) && endpoint.screenId === command.screenId)).map((wire) => wire.id);
      const changed = {
        ...document,
        screens: removeRequired(document.screens, command.screenId, "Экран не найден."),
        wires: document.wires.filter((wire) => !attachedWireIds.includes(wire.id)),
      };
      return cleanupWireReferences(changed, attachedWireIds);
    }
  }
}
