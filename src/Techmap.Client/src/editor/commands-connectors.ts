import { validateConnectorLibraryMetadata, type Point, wireEndpointE4Anchor, wireE4PathContainsPoint, type ConnectorInstance, isJunctionEndpoint, isScreenEndpoint, parseOuterDiameter, connectorE4Contacts, connectorBaseColumnKeys, type HarnessDesignDocument } from "./model";
import { rememberCustomWireColors, updateConnector, replaceRequired, findWire, validateJunctionAgainstWires, validateWireGroups, requireConnectorText, requirePartNumberText, normalizeContact, validateUniqueContacts, requireContactNumber, requireContactStatus, isContactConnected, normalizeCustomValues, normalizeValue, normalizeTemplateTerminalArticle, contactWireCount, syncDirectWireColors, contactAtEndpoint, sameConnectorEndpoint, syncContactWireMaterial, resetContactColorToAutomatic, isConnectorEndpoint, removeRequired, normalizeCustomField, cleanupWireReferences } from "./editor-command-invariants";
import { rebuildConnectorE4Wires, spreadMovedE4Shoulders, repairE4JunctionBranches, rerouteE4WireBatch, screenAttachmentWireIds, rerouteWireE4ThroughJunctions, retainEditableE4Routes, updateConnectorE4Geometry } from "./command-e4-routing";
import { CONTACT_SIDE_VIEW_PLACEMENT_ID, validDrawingScale } from "./drawing-scale";
import { carryPhysicalExits } from "./physical-editing";
import { screenJunctionEnds, wireRouteTouchesConnector, validateE4WireIds } from "./command-e4-analysis";
import { moveE4Ends, orthogonalE4Deformation, movedE4Junctions, preserveE4Leads, resolveE4JunctionMoves, followE4Junctions } from "./e4-editing";
import { type EditorCommand } from "./editor-command-types";

export function applyConnectorsCommand(document: HarnessDesignDocument, command: Extract<EditorCommand, { type: "add-connector" | "set-contact-side-view" | "move-connector" | "update-connector" | "apply-connector-article" | "flip-connector-orientation" | "update-contact" | "reset-contact-color-auto" | "add-contact" | "move-contact-row" | "remove-contact" | "set-name-column-visibility" | "toggle-base-column-visibility" | "add-custom-field" | "remove-custom-field" | "toggle-custom-field-visibility" | "remove-connector" }>): HarnessDesignDocument {
  switch (command.type) {

    case "add-connector":
      if (document.connectors.some((item) => item.id === command.connector.id)) {
        throw new Error("Соединитель с таким ID уже существует.");
      }
      validateConnectorLibraryMetadata(command.connector);
      return rememberCustomWireColors(rebuildConnectorE4Wires(
        { ...document, connectors: [...document.connectors, command.connector] },
        command.connector.id,
      ), command.connector.contacts.flatMap((contact) => [contact.color, contact.secondaryColor ?? ""]));

    case "set-contact-side-view":
      return updateConnector(document,command.connectorId,connector=>{
        if(connector.libraryBinding?.mode!=="template") throw new Error("Вид со стороны контактов доступен библиотечному компоненту.");
        if(command.remove) {
          return {...connector,drawingPlacements:(connector.drawingPlacements??[]).filter(placement=>placement.drawingId!==CONTACT_SIDE_VIEW_PLACEMENT_ID)};
        }
        if(command.offset && (!Number.isFinite(command.offset.x) || !Number.isFinite(command.offset.y))) throw new Error("Некорректное положение вида со стороны контактов.");
        if(command.rotationDegrees!==undefined && (!Number.isFinite(command.rotationDegrees)||Math.abs(command.rotationDegrees)>360))throw new Error("Угол вида: от −360 до 360°.");
        if(command.scale!==undefined&&!validDrawingScale(command.scale)) throw new Error("Масштаб вида: 5–2000%.");
        const previous=connector.drawingPlacements?.find(placement=>placement.drawingId===CONTACT_SIDE_VIEW_PLACEMENT_ID);
        const initial={drawingId:CONTACT_SIDE_VIEW_PLACEMENT_ID,visible:true,offset:{x:160,y:0},scale:1};
        const next={...(previous??initial),...(command.visible===undefined?{}:{visible:command.visible}),...(command.offset?{offset:command.offset}:{}),...(command.scale===undefined?{}:{scale:command.scale}),...(command.rotationDegrees===undefined?{}:{rotationDegrees:command.rotationDegrees})};
        return {...connector,drawingPlacements:[...(connector.drawingPlacements??[]).filter(placement=>placement.drawingId!==CONTACT_SIDE_VIEW_PLACEMENT_ID),next]};
      });

    case "move-connector":
      {
      if (!Number.isFinite(command.position.x) || !Number.isFinite(command.position.y)) {
        throw new Error("Положение соединителя задано неверно.");
      }
      const moved = {
        ...document,
        connectors: replaceRequired(document.connectors, command.connectorId, (connector) => ({
          ...connector,
          positions: { ...connector.positions, [command.view]: command.position },
        }), "Соединитель не найден."),
      };
      if (command.view !== "e4") {
        const connector = document.connectors.find(c => c.id === command.connectorId)!;
        const delta = { x: command.position.x - connector.positions.drawing.x, y: command.position.y - connector.positions.drawing.y };
        let shiftedWiresChanged = false;
        const shiftedWires = moved.wires.map(wire => {
          if (!wire.drawingEndpoints) return wire;
          const fromAttached = wire.from.connectorId === command.connectorId;
          const toAttached = wire.to.connectorId === command.connectorId;
          if (!fromAttached && !toAttached) return wire;
          shiftedWiresChanged = true;
          return { ...wire, drawingEndpoints: {
            from: fromAttached ? { x: wire.drawingEndpoints.from.x + delta.x, y: wire.drawingEndpoints.from.y + delta.y } : wire.drawingEndpoints.from,
            to: toAttached ? { x: wire.drawingEndpoints.to.x + delta.x, y: wire.drawingEndpoints.to.y + delta.y } : wire.drawingEndpoints.to,
          } };
        });
        const shifted = shiftedWiresChanged ? { ...moved, wires: shiftedWires } : moved;
        return command.physicalDragMode
          ? carryPhysicalExits(document,shifted,new Set(document.physicalTopology?.nodes.filter(n=>n.connectorId===command.connectorId).map(n=>n.id)),command.physicalDragMode)
          : shifted;
      }
      if(command.physicalDragMode){
        const connector=document.connectors.find(c=>c.id===command.connectorId)!;
        if(document.views.e4.layers.some(l=>l.locked&&(l.id===connector.layerIds.e4||document.wires.some(w=>[w.from,w.to].some(e=>e.connectorId===connector.id)&&w.layerIds.e4===l.id))))throw new Error("Слой соединителя или проводов заблокирован.");
        let changed=moved;
        const proposals=new Map<string,ReadonlyMap<string,Point>>(),owners=new Set<string>();
        for(const wire of document.wires){
          if(![wire.from,wire.to].some(e=>e.connectorId===command.connectorId)||screenJunctionEnds(wire))continue;
          const a=wireEndpointE4Anchor(document,wire.from),b=wireEndpointE4Anchor(document,wire.to);
          const start=wireEndpointE4Anchor(moved,wire.from),end=wireEndpointE4Anchor(moved,wire.to);
          if(!a||!b||!start||!end)continue;
          const original=[a.position,...wire.e4Route,b.position];
          const raw=moveE4Ends(original,start.position,end.position,command.physicalDragMode);
          const baseline=moveE4Ends(original,a.position,b.position,command.physicalDragMode);
          const geometry=document.views.e4.e4RoutingMode!=="angular"
            ?orthogonalE4Deformation(baseline,raw,start,end,command.physicalDragMode):null;
          proposals.set(wire.id,movedE4Junctions(document,wire.id,baseline,geometry?.vertices??raw,geometry?.segments,geometry?.points));
          owners.add(wire.id);
          const points=geometry?.points??preserveE4Leads(raw,start,end);
          // A termination drag uses the same validated local deformation as a
          // table. Keep automatic wires automatic for later obstacle reflows.
          changed={...changed,wires:changed.wires.map(w=>w.id===wire.id?{...w,e4Route:points.slice(1,-1),
            e4RouteMode:connector.terminationComponent?(w.e4RouteMode??"auto"):"manual"}:w)};
        }
        const positions=resolveE4JunctionMoves(document,proposals);
        const branches=new Set(document.junctions.filter(j=>positions.has(j.id)).flatMap(j=>j.wireIds.filter(id=>{
          const wire=findWire(changed,id);
          return !owners.has(id)||[wire.from,wire.to].some(e=>e.junctionId===j.id)||!wireE4PathContainsPoint(changed,wire,positions.get(j.id)!);
        })));
        changed=followE4Junctions(document,changed,positions,new Set([...owners].filter(id=>!branches.has(id))),command.physicalDragMode);
        if(changed.wires.some(w=>branches.has(w.id)&&changed.views.e4.layers.some(l=>l.id===w.layerIds.e4&&l.locked)))throw new Error("Слой присоединённой ветви заблокирован.");
        const affected=new Set([...owners,...branches]);
        if (connector.terminationComponent) {
          // Moving the symbol can obstruct an unrelated wire. Include only
          // routes touching its new obstacle; distant automatic pairs keep
          // their geometry and never enter the route-order search.
          const current = moved.connectors.find(c => c.id === connector.id)!;
          for (const wire of changed.wires) {
            if (!affected.has(wire.id) && wireRouteTouchesConnector(changed, wire, current)) {
              try { validateE4WireIds(changed, [wire.id]); }
              catch { affected.add(wire.id); }
            }
          }
          if (changed.wires.some(w => affected.has(w.id) &&
              changed.views.e4.layers.some(l => l.id === w.layerIds.e4 && l.locked))) {
            throw new Error("Слой присоединённой ветви заблокирован.");
          }
        }
        changed=spreadMovedE4Shoulders(document,changed,affected);
        try { changed=repairE4JunctionBranches(changed,affected); }
        catch { changed=rerouteE4WireBatch(changed,[...affected],true); }
        for(const id of screenAttachmentWireIds(changed,[...affected]))changed=rerouteWireE4ThroughJunctions(changed,id);
        for(const junction of changed.junctions)validateJunctionAgainstWires(changed,junction);
        validateWireGroups(changed);
        return changed;
      }
      try {
        return rebuildConnectorE4Wires(
          moved,
          command.connectorId,
          document.connectors.find((connector) => connector.id === command.connectorId),
        );
      } catch {
        // A drag must never be rejected because a temporary obstacle layout has
        // no solution. Keep the last valid traces; diagnostics will expose the
        // stale route until the next successful global reflow.
        return retainEditableE4Routes(moved);
      }
      }

    case "update-connector": {
      const designation = command.designation.trim();
      requireConnectorText(designation, "Укажите обозначение соединителя.");
      const partNumber = command.partNumber?.trim();
      if (partNumber !== undefined) requirePartNumberText(partNumber, "Укажите артикул шаблона соединителя.");
      const libraryCode = command.libraryCode?.trim();
      if (libraryCode !== undefined) requireConnectorText(libraryCode, "Укажите код свободного блока.");
      return updateConnectorE4Geometry(document, command.connectorId, (connector) => {
          if (partNumber !== undefined && connector.libraryBinding?.mode === "series" &&
              partNumber !== connector.libraryBinding.partNumber) {
            throw new Error("Артикул библиотечного соединителя можно изменить только выбором артикула серии.");
          }
          if (partNumber !== undefined && connector.libraryBinding?.mode === "template" &&
              partNumber !== connector.partNumber) {
            throw new Error("Артикул закреплённого шаблона определяется выбранным вариантом библиотеки.");
          }
          if (libraryCode !== undefined && (connector.libraryBinding?.mode === "series" || connector.libraryBinding?.mode === "template")) {
            throw new Error("Код библиотечной серии определяется справочником.");
          }
          return {
            ...connector,
            designation,
            libraryCode: libraryCode ?? connector.libraryCode ?? "FREE",
            partNumber: partNumber ?? connector.partNumber,
          };
        });
    }

    case "apply-connector-article": {
      const partNumber = command.partNumber.trim();
      requirePartNumberText(partNumber, "Укажите артикул соединителя.");
      const connector = document.connectors.find((item) => item.id === command.connectorId);
      if (!connector) throw new Error("Соединитель не найден.");
      if (command.libraryBinding.mode !== "series") {
        throw new Error("Команда выбора артикула должна сохранять привязку к серии.");
      }
      if (command.libraryBinding.partNumber !== partNumber) {
        throw new Error("Артикул команды не совпадает с артикулом привязки к серии.");
      }
      if (connector.libraryBinding?.mode === "series" &&
          connector.libraryBinding.seriesId !== command.libraryBinding.seriesId) {
        throw new Error("Нельзя заменить серию уже привязанного библиотечного соединителя.");
      }
      const contacts = command.contacts.map((contact) => normalizeContact(contact, connector.schematic.customFields));
      validateUniqueContacts(contacts);
      const candidate: ConnectorInstance = {
        ...connector,
        partNumber,
        contacts,
        libraryBinding: command.libraryBinding,
      };
      validateConnectorLibraryMetadata(candidate);
      const retainedContactIds = new Set(contacts.map((contact) => contact.id));
      const connectedContactIds = new Set(document.wires.flatMap((wire) => [wire.from, wire.to]
        .filter((endpoint) => !isJunctionEndpoint(endpoint) && !isScreenEndpoint(endpoint) &&
          endpoint.connectorId === command.connectorId)
        .map((endpoint) => endpoint.contactId)));
      if ([...connectedContactIds].some((contactId) => !retainedContactIds.has(contactId))) {
        throw new Error("Выбранный артикул удалит подключённые контакты. Сначала переподключите или удалите их провода.");
      }
      if (contacts.some((contact) => connectedContactIds.has(contact.id) && contact.connectionStatus === "not-connected")) {
        throw new Error("Выбранный артикул помечает подключённый контакт как неподключённый.");
      }
      const updated = updateConnectorE4Geometry(document, command.connectorId, (item) => ({
        ...candidate,
        positions: item.positions,
        drawingPlacements: item.drawingPlacements,
      }));
      return rememberCustomWireColors(updated, contacts.flatMap((contact) => [contact.color, contact.secondaryColor ?? ""]));
    }

    case "flip-connector-orientation":
      return updateConnectorE4Geometry(document, command.connectorId, (connector) => ({
        ...connector,
        schematic: {
          ...connector.schematic,
          orientation: connector.schematic.orientation === "contacts-left" ? "contacts-right" : "contacts-left",
        },
      }));

    case "update-contact": {
      const updated = updateConnectorE4Geometry(document, command.connectorId, (connector) => {
        if ((connector.libraryBinding?.mode === "series" || connector.libraryBinding?.mode === "template") &&
            (command.number !== undefined || command.contactType !== undefined)) {
          throw new Error("Номер и тип библиотечного контакта определяются выбранным артикулом серии.");
        }
        if (command.number !== undefined) requireContactNumber(command.number);
        if (command.connectionStatus !== undefined) requireContactStatus(command.connectionStatus);
        if (command.connectionStatus === "not-connected" && isContactConnected(document, command.connectorId, command.contactId)) {
          throw new Error("Нельзя пометить контакт как неподключённый, пока к нему подключён провод.");
        }
        const customValues = command.customValues === undefined
          ? undefined
          : normalizeCustomValues(command.customValues, connector.schematic.customFields);
        const contacts = replaceRequired(connector.contacts, command.contactId, (contact) => ({
          ...contact,
          ...(command.nameOverride === undefined ? {} : { nameOverride: normalizeValue(command.nameOverride, "Назначение контакта") }),
          number: command.number ?? contact.number,
          contactType: command.contactType === undefined ? contact.contactType : normalizeValue(command.contactType, "Тип контакта"),
          circuit: command.circuit === undefined ? contact.circuit : normalizeValue(command.circuit, "Цепь контакта"),
          terminalArticle: command.terminalArticle === undefined
            ? contact.terminalArticle
            : normalizeTemplateTerminalArticle(
              connector,
              contact,
              normalizeValue(command.terminalArticle, "Артикул терминала"),
            ),
          terminalDetails: command.terminalArticle === undefined ? contact.terminalDetails
            : command.terminalArticle === contact.terminalArticle ? command.terminalDetails ?? contact.terminalDetails
              : command.terminalDetails,
          ...((command.wire!==undefined||command.wireSection!==undefined||command.wireDiameterMm!==undefined)?{wireDiameterMm:command.wireDiameterMm==null?undefined:parseOuterDiameter(command.wireDiameterMm)}:{}),
          wire: command.wire === undefined ? contact.wire : normalizeValue(command.wire, "Провод контакта"),
          ...(command.wireSection === undefined ? {} : { wireSection: normalizeValue(command.wireSection, "Сечение провода") }),
          materialBinding: command.materialBinding === undefined && command.wire === undefined && command.wireSection === undefined
            ? contact.materialBinding : command.materialBinding ?? undefined,
          color: command.color === undefined ? contact.color : normalizeValue(command.color, "Цвет провода контакта"),
          secondaryColor: command.secondaryColor === undefined
            ? contact.secondaryColor ?? ""
            : normalizeValue(command.secondaryColor, "Второй цвет провода контакта"),
          colorMode: command.color === undefined && command.secondaryColor === undefined ? contact.colorMode : "manual",
          connectionStatus: command.connectionStatus ?? contact.connectionStatus,
          customValues: customValues ?? contact.customValues,
        }), "Контакт не найден.");
        validateUniqueContacts(contacts);
        return { ...connector, contacts };
      });
      if (contactWireCount(document,command.connectorId,command.contactId)>1) return rememberCustomWireColors(updated,[command.color??'',command.secondaryColor??'']);
      const synchronized = command.color === undefined && command.secondaryColor === undefined
        ? updated
        : syncDirectWireColors(updated, command.connectorId, command.contactId);
      const materialChanged = command.materialBinding !== undefined || command.wire !== undefined || command.wireSection !== undefined;
      const contactMaterial = contactAtEndpoint(synchronized, { connectorId: command.connectorId, contactId: command.contactId })?.materialBinding;
      const withMaterial = materialChanged ? {
        ...synchronized,
        wires: synchronized.wires.map(wire => [wire.from, wire.to].some(endpoint =>
          sameConnectorEndpoint(endpoint, command.connectorId, command.contactId))
          ? { ...wire, materialBinding: contactMaterial } : wire),
      } : synchronized;
      const diameterChanged=command.wireDiameterMm!==undefined||command.wire!==undefined||command.wireSection!==undefined;
      const endpoints=document.wires.filter(w=>[w.from,w.to].some(e=>e.connectorId===command.connectorId&&e.contactId===command.contactId)).flatMap(w=>[w.from,w.to]);
      const sized=diameterChanged?{...withMaterial,connectors:withMaterial.connectors.map(c=>({...c,contacts:c.contacts.map(p=>endpoints.some(e=>e.connectorId===c.id&&e.contactId===p.id)?{...p,wireDiameterMm:command.wireDiameterMm==null?undefined:parseOuterDiameter(command.wireDiameterMm)}:p)}))}:withMaterial;
      const linked = materialChanged
        ? syncContactWireMaterial(sized, command.connectorId, command.contactId) : sized;
      const rerouted = linked === sized ? linked : rerouteE4WireBatch(linked,
        linked.wires.filter(wire => [wire.from, wire.to].some(endpoint =>
          sameConnectorEndpoint(endpoint, command.connectorId, command.contactId))).map(wire => wire.id));
      return rememberCustomWireColors(rerouted, [command.color ?? "", command.secondaryColor ?? ""]);
    }

    case "reset-contact-color-auto":
      return resetContactColorToAutomatic(document, command.connectorId, command.contactId);

    case "add-contact": {
      const updated = updateConnectorE4Geometry(document, command.connectorId, (connector) => {
        if (connector.libraryBinding?.mode === "series" || connector.libraryBinding?.mode === "template") {
          throw new Error("Число контактов библиотечного соединителя определяется выбранным артикулом серии.");
        }
        const contact = normalizeContact(command.contact, connector.schematic.customFields);
        if (contact.libraryContact !== undefined && contact.libraryContact !== null) {
          throw new Error("Свободная строка не должна ссылаться на позицию библиотечной серии.");
        }
        const contacts = [...connector.contacts, contact];
        validateUniqueContacts(contacts);
        return { ...connector, contacts };
      });
      return rememberCustomWireColors(updated, [command.contact.color, command.contact.secondaryColor ?? ""]);
    }

    case "move-contact-row": {
      const reorder = (connector: ConnectorInstance): ConnectorInstance => {
        const rows = connectorE4Contacts(connector).map(contact => contact.id);
        const index = rows.indexOf(command.contactId);
        if (index < 0) throw new Error("Контакт не найден.");
        const next = index + command.direction;
        if (next < 0 || next >= rows.length) return connector;
        [rows[index], rows[next]] = [rows[next]!, rows[index]!];
        return { ...connector, schematic: { ...connector.schematic, rowOrder: rows } };
      };
      try { return updateConnectorE4Geometry(document, command.connectorId, reorder); }
      catch {
        // A temporary crossing must not prevent the next row move that resolves it.
        // Keep valid contact leads and report clearance conflicts through diagnostics.
        return retainEditableE4Routes(updateConnector(document, command.connectorId, reorder));
      }
    }

    case "remove-contact": {
      const connector = document.connectors.find((item) => item.id === command.connectorId);
      if (connector?.libraryBinding?.mode === "series" || connector?.libraryBinding?.mode === "template") {
        throw new Error("Строки библиотечного соединителя определяются выбранным артикулом серии.");
      }
      if (document.wires.some((wire) =>
        (isConnectorEndpoint(wire.from, command.connectorId, command.contactId)) ||
        (isConnectorEndpoint(wire.to, command.connectorId, command.contactId)))) {
        throw new Error("Нельзя удалить контакт, к которому подключён провод.");
      }
      return updateConnectorE4Geometry(document, command.connectorId, (connector) => ({
        ...connector,
        contacts: removeRequired(connector.contacts, command.contactId, "Контакт не найден."),
      }));
    }

    case "set-name-column-visibility": {
      const targets = command.scope === "document"
        ? document.connectors.filter(connector => connector.libraryBinding?.mode === "template").map(connector => connector.id)
        : [command.connectorId];
      return targets.reduce((current, id) => updateConnectorE4Geometry(current, id, connector => ({
        ...connector, schematic: { ...connector.schematic, showName: command.visible },
      })), document);
    }

    case "toggle-base-column-visibility":
      if (!connectorBaseColumnKeys.includes(command.key)) throw new Error("Базовая колонка не найдена.");
      return updateConnectorE4Geometry(document, command.connectorId, (connector) => ({
        ...connector,
        schematic: {
          ...connector.schematic,
          baseColumns: connector.schematic.baseColumns.map((column) =>
            column.key === command.key ? { ...column, visible: !column.visible } : column),
        },
      }));

    case "add-custom-field":
      return updateConnectorE4Geometry(document, command.connectorId, (connector) => {
        const field = normalizeCustomField(command.field);
        if (connector.schematic.customFields.some((item) => item.id === field.id)) {
          throw new Error("Справочное поле с таким ID уже существует.");
        }
        return {
          ...connector,
          schematic: {
            ...connector.schematic,
            customFields: [...connector.schematic.customFields, field],
          },
        };
      });

    case "remove-custom-field":
      return updateConnectorE4Geometry(document, command.connectorId, (connector) => ({
        ...connector,
        contacts: connector.contacts.map((contact) => {
          const { [command.fieldId]: _removed, ...customValues } = contact.customValues;
          return { ...contact, customValues };
        }),
        schematic: {
          ...connector.schematic,
          customFields: removeRequired(connector.schematic.customFields, command.fieldId, "Справочное поле не найдено."),
        },
      }));

    case "toggle-custom-field-visibility":
      return updateConnectorE4Geometry(document, command.connectorId, (connector) => ({
        ...connector,
        schematic: {
          ...connector.schematic,
          customFields: replaceRequired(connector.schematic.customFields, command.fieldId, (field) => ({
            ...field,
            visible: !field.visible,
          }), "Справочное поле не найдено."),
        },
      }));

    case "remove-connector": {
      if (!document.connectors.some((item) => item.id === command.connectorId)) {
        throw new Error("Соединитель не найден.");
      }
      const removedWireIds = document.wires.filter((wire) =>
        isConnectorEndpoint(wire.from, command.connectorId) || isConnectorEndpoint(wire.to, command.connectorId)).map((wire) => wire.id);
      const changed = cleanupWireReferences({
        ...document,
        connectors: document.connectors.filter((item) => item.id !== command.connectorId),
        wires: document.wires.filter((wire) => !removedWireIds.includes(wire.id)),
      }, removedWireIds);
      return rebuildConnectorE4Wires(changed, command.connectorId, document.connectors.find((item) => item.id === command.connectorId));
    }
  }
}
