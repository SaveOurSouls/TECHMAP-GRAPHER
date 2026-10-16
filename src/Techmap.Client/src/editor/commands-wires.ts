import { updateConnector, rememberCustomWireColors, validateCableMembership, removeRequired, validateWire, contactWireCount, contactAtEndpoint, addWireToEndpointJunctions, validateWireGroups, normalizeJunctionCircuits, syncContactWireMaterial, syncDirectWireColors, cleanupWireReferences, replaceRequired, sameConnectorEndpoint, assertEditableFreeDrawingEnd, isFreeDrawingEnd, assertNoLockedDrawingWires, requireEndpoint, findWire, updateJunctionMembership, requireWireIds, requirePositiveParameter } from "./editor-command-invariants";
import { validDrawingScale } from "./drawing-scale";
import { validateConnectorLibraryMetadata, isJunctionEndpoint, isScreenEndpoint, normalizeCableInstance, wireEndpointE4Anchor, type HarnessDesignDocument, parseOuterDiameter, calculateWireCutLength, normalizeWireStripProfileBinding, type DiffPairGroup } from "./model";
import { updateConnectorE4Geometry, addTargetWireToJunction, rerouteWireE4, rerouteE4WireBatch, screenAttachmentWireIds } from "./command-e4-routing";
import { validateE4Route } from "./e4-router";
import { createE4RoutingRequest } from "./command-e4-analysis";
import { wireBlankEnds } from "../WireBlankCatalog";
import { editedDetachedWireBends } from "./detached-wire-editing";
import { freeTwistedPairPaths } from "./drawing-twisted-pair";
import { drawingWireWidth, drawingPhysicalScale } from "./drawing-thickness";
import { type EditorCommand } from "./editor-command-types";

export function applyWiresCommand(document: HarnessDesignDocument, command: Extract<EditorCommand, { type: "set-drawing-placement" | "refresh-template-terminals" | "apply-template-article" | "add-cable" | "update-cable" | "set-cable-members" | "remove-cable" | "add-wire" | "remove-wire" | "update-wire" | "set-wire-strip-profile" | "set-wire-drawing-end-style" | "set-wire-drawing-end-styles" | "set-wire-drawing-endpoints-x" | "set-wire-drawing-endpoint" | "reconnect-wire" | "set-wire-route" | "edit-detached-wire-bend" | "remove-detached-wire-bend" | "set-detached-wire-pair" }>): HarnessDesignDocument {
  switch (command.type) {

    case "set-drawing-placement":
      return updateConnector(document,command.connectorId,connector=>{
        if(connector.libraryBinding?.mode!=="template") throw new Error("Рисунок доступен библиотечному компоненту.");
        if(!command.drawingId.trim() || command.offset && (!Number.isFinite(command.offset.x) || !Number.isFinite(command.offset.y))) throw new Error("Некорректное положение рисунка.");
        if(command.rotationDegrees!==undefined && (!Number.isFinite(command.rotationDegrees)||Math.abs(command.rotationDegrees)>360))throw new Error("Угол рисунка: от −360 до 360°.");
        if(command.scale!==undefined&&!validDrawingScale(command.scale)) throw new Error("Масштаб рисунка: 5–2000%.");
        const previous=connector.drawingPlacements?.find(p=>p.drawingId===command.drawingId) ?? {drawingId:command.drawingId,visible:true,offset:{x:0,y:0}};
        let positions=connector.positions;
        if(command.rotationDegrees!==undefined && command.rotationCenter) {
          const center=command.rotationCenter;
          if(!Number.isFinite(center.x)||!Number.isFinite(center.y))throw new Error("Некорректный центр поворота.");
          const angle=(command.rotationDegrees-(previous.rotationDegrees??0))*Math.PI/180;
          const x=connector.positions.drawing.x-center.x,y=connector.positions.drawing.y-center.y;
          positions={...positions,drawing:{x:center.x+x*Math.cos(angle)-y*Math.sin(angle),y:center.y+x*Math.sin(angle)+y*Math.cos(angle)}};
        }
        return {...connector,positions,drawingPlacements:[...(connector.drawingPlacements ?? []).filter(p=>p.drawingId!==command.drawingId),{...previous,...(command.visible===undefined ? {} : {visible:command.visible}),...(command.offset ? {offset:command.offset} : {}),...(command.scale===undefined?{}:{scale:command.scale}),...(command.rotationDegrees===undefined?{}:{rotationDegrees:command.rotationDegrees})}]};
      });

    case "refresh-template-terminals":
      return updateConnector(document, command.connectorId, connector => {
        if (connector.libraryBinding?.mode !== "template" || connector.libraryBinding.templateId !== command.catalog.templateId) {
          throw new Error("Список терминалов принадлежит другому шаблону.");
        }
        const updated = { ...connector, terminalCatalog: command.catalog };
        validateConnectorLibraryMetadata(updated);
        return updated;
      });

    case "apply-template-article": {
      const current = document.connectors.find((item) => item.id === command.connectorId);
      if (!current) throw new Error("Соединитель не найден.");
      const previousBinding = current.libraryBinding;
      const nextBinding = command.connector.libraryBinding;
      if (previousBinding?.mode !== "template" || nextBinding?.mode !== "template" ||
          command.connector.id !== current.id ||
          previousBinding.templateId !== nextBinding.templateId ||
          previousBinding.templateVersion !== nextBinding.templateVersion ||
          previousBinding.versionSha256 !== nextBinding.versionSha256) {
        throw new Error("Артикул можно сменить только внутри закреплённой версии шаблона.");
      }
      validateConnectorLibraryMetadata(command.connector);
      const retainedContactIds = new Set(command.connector.contacts.map((contact) => contact.id));
      const connectedContactIds = new Set(document.wires.flatMap((wire) => [wire.from, wire.to]
        .filter((endpoint) => !isJunctionEndpoint(endpoint) && !isScreenEndpoint(endpoint) &&
          endpoint.connectorId === command.connectorId)
        .map((endpoint) => endpoint.contactId)));
      if ([...connectedContactIds].some((contactId) => !retainedContactIds.has(contactId))) {
        throw new Error("Выбранный артикул удалит подключённые контакты. Сначала переподключите или удалите их провода.");
      }
      const updated = updateConnectorE4Geometry(document, command.connectorId, (item) => ({
        ...command.connector,
        positions: item.positions,
        drawingPlacements: item.drawingPlacements,
      }));
      return rememberCustomWireColors(updated, command.connector.contacts
        .flatMap((contact) => [contact.color, contact.secondaryColor ?? ""]));
    }

    case "add-cable": {
      const cable = normalizeCableInstance(command.cable);
      if (document.cables.some((item) => item.id === cable.id)) {
        throw new Error("Кабель с таким ID уже существует.");
      }
      validateCableMembership(document, cable);
      return { ...document, cables: [...document.cables, cable] };
    }

    case "update-cable": {
      const existing = document.cables.find((item) => item.id === command.cableId);
      if (!existing) throw new Error("Кабель не найден.");
      const cable = normalizeCableInstance({
        ...existing,
        materialBinding: command.materialBinding === undefined
          ? existing.materialBinding : command.materialBinding ?? undefined,
        lengthMm: command.lengthMm === undefined ? existing.lengthMm : command.lengthMm,
        endCorrectionFromMm: command.endCorrectionFromMm ?? existing.endCorrectionFromMm,
        endCorrectionToMm: command.endCorrectionToMm ?? existing.endCorrectionToMm,
        cutRoundingStepMm: command.cutRoundingStepMm ?? existing.cutRoundingStepMm,
        sheathStrip: command.sheathStrip === undefined ? existing.sheathStrip : command.sheathStrip ?? undefined,
      });
      validateCableMembership(document, cable, cable.id);
      return { ...document, cables: document.cables.map((item) => item.id === cable.id ? cable : item) };
    }

    case "set-cable-members": {
      const existing = document.cables.find((item) => item.id === command.cableId);
      if (!existing) throw new Error("Кабель не найден.");
      const cable = normalizeCableInstance({ ...existing, memberWireIds: command.memberWireIds });
      validateCableMembership(document, cable, cable.id);
      return { ...document, cables: document.cables.map((item) => item.id === cable.id ? cable : item) };
    }

    case "remove-cable":
      return { ...document, cables: removeRequired(document.cables, command.cableId, "Кабель не найден.") };

    case "add-wire":
      validateWire(document, command.wire);
      if (document.wires.some((item) => item.id === command.wire.id)) {
        throw new Error("Провод с таким ID уже существует.");
      }
      if(command.wire.e4Route.length){
        const start=wireEndpointE4Anchor(document,command.wire.from),end=wireEndpointE4Anchor(document,command.wire.to);
        if(start&&end)validateE4Route([start.position,...command.wire.e4Route,end.position],createE4RoutingRequest(document,command.wire,command.wire.id));
      }
      const selectedMaterial = [command.wire.from,command.wire.to].filter(e=>contactWireCount(document,e.connectorId,e.contactId)===0).map(e=>contactAtEndpoint(document,e)?.materialBinding).find(Boolean);
      const newWire = command.wire.materialBinding || !selectedMaterial
        ? command.wire : { ...command.wire, materialBinding: selectedMaterial };
      let added = addWireToEndpointJunctions(
        { ...document, wires: [...document.wires, newWire] }, newWire);
      if (command.targetWireId !== undefined) {
        const junctionEndpoint = [command.wire.from, command.wire.to].find(isJunctionEndpoint);
        if (!junctionEndpoint) throw new Error("Новая ветвь должна завершаться в узле целевого провода.");
        added = addTargetWireToJunction(added, junctionEndpoint.junctionId, command.targetWireId);
      }
      let addedAndRouted: HarnessDesignDocument;
      try { addedAndRouted = rerouteWireE4(added, command.wire.id); }
      catch { addedAndRouted = rerouteE4WireBatch(added, added.wires.filter(w=>w.id===command.wire.id || w.e4RouteMode!=="manual").map(w=>w.id)); }
      validateWireGroups(addedAndRouted);
      const normalized = normalizeJunctionCircuits(addedAndRouted);
      const sourceEndpoint = [newWire.from, newWire.to].find(endpoint => contactAtEndpoint(normalized, endpoint)?.materialBinding)
        ?? [newWire.from, newWire.to].find(endpoint => contactAtEndpoint(normalized, endpoint)?.wire.trim());
      const linked = sourceEndpoint
        ? syncContactWireMaterial(normalized, sourceEndpoint.connectorId, sourceEndpoint.contactId, newWire.materialBinding)
        : normalized;
      const withMaterial = linked === normalized ? linked : rerouteE4WireBatch(linked, [newWire.id]);
      return command.wire.colorSource
        ? syncDirectWireColors(withMaterial, command.wire.colorSource.connectorId, command.wire.colorSource.contactId)
        : withMaterial;

    case "remove-wire": {
      const attachedWireIds = screenAttachmentWireIds(document, [command.wireId]);
      const changed = {
        ...document,
        wires: removeRequired(document.wires, command.wireId, "Провод не найден."),
      };
      const cleaned = cleanupWireReferences(changed, [command.wireId]);
      return rerouteE4WireBatch(cleaned, [
        ...cleaned.wires.filter((wire) => wire.e4RouteMode !== "manual").map((wire) => wire.id),
        ...attachedWireIds.filter((wireId) => cleaned.wires.some((wire) => wire.id === wireId)),
      ]);
    }

    case "update-wire": {
      const changed = {
        ...document,
        wires: replaceRequired(document.wires, command.wireId, (wire) => {
          const updated = {
            ...wire,
            circuit: command.circuit === undefined ? wire.circuit : command.circuit.trim(),
            color: command.color ?? wire.color,
            ...(command.secondaryColor===undefined?{}:{secondaryColor:command.secondaryColor}),
            ...(command.wireMark===undefined?{}:{wireMark:command.wireMark}),
            ...(command.wireSection===undefined?{}:{wireSection:command.wireSection}),
            ...(command.wireDiameterMm===undefined?{}:{wireDiameterMm:command.wireDiameterMm===null?undefined:parseOuterDiameter(command.wireDiameterMm)}),
            colorSource: command.colorSource === undefined ? (command.color === undefined ? wire.colorSource : null) : command.colorSource,
            materialBinding: command.materialBinding === undefined
              ? wire.materialBinding : command.materialBinding ?? undefined,
            lengthMm: command.lengthMm === undefined ? wire.lengthMm : command.lengthMm,
            endCorrectionFromMm: command.endCorrectionFromMm ?? wire.endCorrectionFromMm,
            endCorrectionToMm: command.endCorrectionToMm ?? wire.endCorrectionToMm,
            cutRoundingStepMm: command.cutRoundingStepMm ?? wire.cutRoundingStepMm,
          };
          calculateWireCutLength(updated);
          return updated;
        }, "Провод не найден."),
      };
      if (command.materialBinding === null && !changed.wires.some(w=>w.id===command.wireId&&[w.from,w.to].some(e=>contactWireCount(changed,e.connectorId,e.contactId)>1))) {
        const wire = changed.wires.find(item => item.id === command.wireId)!;
        return normalizeJunctionCircuits({ ...changed, connectors: changed.connectors.map(connector => ({
          ...connector, contacts: connector.contacts.map(contact => [wire.from, wire.to].some(endpoint =>
            sameConnectorEndpoint(endpoint, connector.id, contact.id))
            ? { ...contact, materialBinding: undefined } : contact),
        })) });
      }
      return normalizeJunctionCircuits(changed);
    }

    case "set-wire-strip-profile":
      return {
        ...document,
        wires: replaceRequired(document.wires, command.wireId, (wire) => {
          const profile = command.profile === null ? undefined : normalizeWireStripProfileBinding(command.profile);
          const stripProfiles = { ...wire.stripProfiles, [command.end]: profile };
          if (stripProfiles.from === undefined && stripProfiles.to === undefined) {
            const { stripProfiles: _removed, ...withoutProfiles } = wire;
            return withoutProfiles;
          }
          return { ...wire, stripProfiles: Object.freeze(stripProfiles) };
        }, "Провод не найден."),
      };

    case "set-wire-drawing-end-style":
      if (!wireBlankEnds.includes(command.style)) throw new Error("Режим отображения конца провода задан неверно.");
      return {
        ...document,
        wires: replaceRequired(document.wires, command.wireId, (wire) => {
          assertEditableFreeDrawingEnd(document, wire, command.end);
          return ({
          ...wire,
          drawingEndStyles: {
            from: wire.drawingEndStyles?.from ?? "cut",
            to: wire.drawingEndStyles?.to ?? "cut",
            [command.end]: command.style,
          },
        }); }, "Провод не найден."),
      };

    case "set-wire-drawing-end-styles": {
      if (!wireBlankEnds.includes(command.style)) throw new Error("Режим отображения конца провода задан неверно.");
      const targets = document.wires.filter(wire => command.wireIds.includes(wire.id));
      if (targets.length !== new Set(command.wireIds).size) throw new Error("Один из выбранных проводов не найден.");
      const editable = targets.filter(wire => isFreeDrawingEnd(document, wire, command.end));
      assertNoLockedDrawingWires(document, editable);
      const ids = new Set(editable.map(wire => wire.id));
      return { ...document, wires: document.wires.map(wire => ids.has(wire.id) ? ({ ...wire, drawingEndStyles: { from: wire.drawingEndStyles?.from ?? "cut", to: wire.drawingEndStyles?.to ?? "cut", [command.end]: command.style } }) : wire) };
    }

    case "set-wire-drawing-endpoints-x": {
      if (!Number.isFinite(command.x)) throw new Error("Координата X должна быть конечным числом.");
      const targets = document.wires.filter(wire => command.wireIds.includes(wire.id) && isFreeDrawingEnd(document, wire, command.end));
      assertNoLockedDrawingWires(document, targets);
      return { ...document, wires: document.wires.map(wire => {
        const endpoints = wire.drawingEndpoints;
        if (!targets.includes(wire) || !endpoints) return wire;
        const current = endpoints[command.end];
        return { ...wire, drawingEndpoints: { ...endpoints, [command.end]: { x: command.x, y: current.y } } };
      }) };
    }

    case "set-wire-drawing-endpoint":
      if (!Number.isFinite(command.position.x) || !Number.isFinite(command.position.y)) throw new Error("Координаты конца должны быть конечными числами.");
      return { ...document, wires: replaceRequired(document.wires, command.wireId, wire => {
        assertEditableFreeDrawingEnd(document, wire, command.end);
        const endpoints = wire.drawingEndpoints;
        if (!endpoints) throw new Error("Свободный конец доступен только у независимого провода.");
        return { ...wire, drawingEndpoints: { from: endpoints.from, to: endpoints.to, [command.end]: command.position } };
      }, "Провод не найден.") };

    case "reconnect-wire": {
      requireEndpoint(document, command.endpoint);
      const original = findWire(document, command.wireId);
      const changed = {
        ...document,
        wires: replaceRequired(document.wires, command.wireId, (wire) => {
          const updated = { ...wire, [command.end]: { ...command.endpoint } };
          validateWire(document, updated);
          return updated;
        }, "Провод не найден."),
      };
      const membership = updateJunctionMembership(changed, command.wireId, original[command.end], command.endpoint);
      const routed = rerouteWireE4(membership, command.wireId);
      validateWireGroups(routed);
      return normalizeJunctionCircuits(routed);
    }

    case "set-wire-route":
      return {
        ...document,
        wires: replaceRequired(document.wires, command.wireId, (wire) => ({
          ...wire,
          drawingRoute: command.route.map((point) => ({ ...point })),
        }), "Провод не найден."),
      };

    case "edit-detached-wire-bend": {
      return { ...document, wires: replaceRequired(document.wires, command.wireId, wire => {
        assertNoLockedDrawingWires(document, [wire]);
        return { ...wire, drawingRoute: editedDetachedWireBends(wire, command.index, command.position, command.insert) };
      }, "Провод не найден.") };
    }

    case "remove-detached-wire-bend": {
      return { ...document, wires: replaceRequired(document.wires, command.wireId, wire => {
        assertNoLockedDrawingWires(document, [wire]);
        if (!wire.drawingEndpoints || !Number.isInteger(command.index) || command.index < 0 || command.index >= wire.drawingRoute.length) throw new Error("Изгиб независимого провода не найден.");
        return { ...wire, drawingRoute: wire.drawingRoute.filter((_, index) => index !== command.index) };
      }, "Провод не найден.") };
    }

    case "set-detached-wire-pair": {
      if (command.wireIds.length !== 2 || new Set(command.wireIds).size !== 2) throw new Error("Выберите два разных независимых провода.");
      requireWireIds(document, command.wireIds);
      const wires = document.wires.filter(wire => command.wireIds.includes(wire.id));
      if (wires.some(wire => !wire.drawingEndpoints)) throw new Error("Скрутка фрагмента доступна только для независимых проводов.");
      assertNoLockedDrawingWires(document, wires);
      const existing = document.diffPairs.find(group => command.wireIds.every(id => group.wireIds.includes(id)));
      if (command.action === "straighten") {
        if (!existing) return document;
        return { ...document, diffPairs: document.diffPairs.filter(group => group.id !== existing.id) };
      }
      if (document.diffPairs.some(group => group.id !== existing?.id && group.wireIds.some(id => command.wireIds.includes(id)))) throw new Error("Провод уже входит в другую дифференциальную пару.");
      const group: DiffPairGroup = {
        id: existing?.id ?? command.groupId ?? crypto.randomUUID(),
        wireIds: existing?.wireIds ?? [command.wireIds[0]!, command.wireIds[1]!],
        step: command.step ?? existing?.step ?? 40,
        amplitude: command.amplitude ?? existing?.amplitude ?? 6,
        variant: command.variant ?? existing?.variant ?? 1,
      };
      if (!group.id.trim() || group.id.length > 128 || document.diffPairs.some(candidate => candidate.id === group.id && candidate !== existing)) throw new Error("ID дифференциальной пары задан неверно.");
      requirePositiveParameter(group.step, "Шаг дифференциальной пары");
      requirePositiveParameter(group.amplitude, "Амплитуда дифференциальной пары");
      if (group.variant !== 1 && group.variant !== 2) throw new Error("Вид дифференциальной пары задан неверно.");
      const display = freeTwistedPairPaths(group, wires.map(wire => ({ id: wire.id, points: [wire.drawingEndpoints!.from, ...wire.drawingRoute, wire.drawingEndpoints!.to], width: drawingWireWidth(document, wire) })), drawingPhysicalScale(document), true);
      if (display.size !== 2) throw new Error("Для скрутки нужны два направленных вдоль друг друга провода достаточной длины. Согласуйте их изгибы или уменьшите шаг скрутки.");
      return { ...document, diffPairs: existing ? document.diffPairs.map(candidate => candidate.id === existing.id ? group : candidate) : [...document.diffPairs, group] };
    }
  }
}
