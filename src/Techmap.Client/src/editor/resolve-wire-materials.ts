import { applyEditorCommand } from "./commands";
import { isJunctionEndpoint, isScreenEndpoint, type ConnectorContact, type HarnessDesignDocument, type WireEndpoint } from "./model";
import type { WireDatabaseOption } from "./wire-database";

function contactAt(document: HarnessDesignDocument, endpoint: WireEndpoint): ConnectorContact | undefined {
  if (isJunctionEndpoint(endpoint) || isScreenEndpoint(endpoint)) return undefined;
  return document.connectors.find(connector => connector.id === endpoint.connectorId)
    ?.contacts.find(contact => contact.id === endpoint.contactId);
}

function key(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[.,]/g, ".").replace(/\s+/g, "");
}

/** A catalog record is inferred only from exact mark and section values. */
export function uniqueWireMaterialOption(
  contact: ConnectorContact,
  options: readonly WireDatabaseOption[],
): WireDatabaseOption | undefined {
  if (!contact.wire.trim() || !contact.wireSection?.trim()) return undefined;
  const candidates = options.filter(option => option.materialBinding &&
    key(option.mark) === key(contact.wire) && key(option.section) === key(contact.wireSection ?? ""));
  if (candidates.length === 1) return candidates[0];
  if (!contact.color.trim()) return undefined;
  const colored = candidates.filter(option => option.color && key(option.color) === key(contact.color));
  return colored.length === 1 ? colored[0] : undefined;
}

/** Repairs a direct conductor whose library preset has text but no database ID. */
export function resolveConnectedWireMaterials(
  document: HarnessDesignDocument,
  options: readonly WireDatabaseOption[],
): HarnessDesignDocument {
  let next = document;
  for (const wire of document.wires) {
    if (wire.materialBinding) continue;
    const from = contactAt(next, wire.from);
    const to = contactAt(next, wire.to);
    const sources = [from, to].filter((contact): contact is ConnectorContact => Boolean(contact));
    for (const source of sources) {
      const opposite = source === from ? to : from;
      const binding = source.materialBinding;
      const option = binding ? undefined : uniqueWireMaterialOption(source, options);
      const materialBinding = binding ?? option?.materialBinding;
      if (!materialBinding) continue;
      if (opposite && (opposite.wire.trim() && key(opposite.wire) !== key(source.wire) ||
          opposite.wireSection?.trim() && key(opposite.wireSection) !== key(source.wireSection ?? ""))) continue;
      const sourceEndpoint = source === from ? wire.from : wire.to;
      if (isJunctionEndpoint(sourceEndpoint) || isScreenEndpoint(sourceEndpoint)) continue;
      next = applyEditorCommand(next, {
        type: "update-contact", connectorId: sourceEndpoint.connectorId,
        contactId: source.id, materialBinding,
        wire: source.wire, wireSection: source.wireSection ?? "",
        wireDiameterMm: option?.diameterMm ?? source.wireDiameterMm ?? null,
      });
      break;
    }
  }
  return next;
}
