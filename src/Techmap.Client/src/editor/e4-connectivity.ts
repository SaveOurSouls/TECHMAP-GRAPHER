import {
  isJunctionEndpoint,
  type HarnessDesignDocument,
  type WireEndpoint,
} from "./model";

export type CanonicalE4Endpoint =
  | { readonly kind: "contact"; readonly connectorId: string; readonly contactId: string }
  | { readonly kind: "junction"; readonly junctionId: string };

export interface CanonicalE4Connectivity {
  readonly schema: "techmap-e4-connectivity-v1";
  readonly connectors: readonly {
    readonly id: string;
    readonly designation: string;
    readonly contacts: readonly {
      readonly id: string;
      readonly number: number;
      readonly circuit: string;
      readonly connectionStatus: "available" | "not-connected";
    }[];
  }[];
  readonly wires: readonly {
    readonly id: string;
    readonly circuit: string;
    readonly endpoints: readonly CanonicalE4Endpoint[];
  }[];
  readonly junctions: readonly {
    readonly id: string;
    readonly wireIds: readonly string[];
  }[];
  readonly diffPairs: readonly {
    readonly id: string;
    readonly wireIds: readonly string[];
  }[];
  readonly screens: readonly {
    readonly id: string;
    readonly wireIds: readonly string[];
  }[];
}

/**
 * Produces the electrical meaning of an E4 document without any presentation
 * geometry. It is intentionally stable across array ordering, connector moves,
 * table resizing, route changes, zoom and crossing display changes.
 */
export function projectE4Connectivity(document: HarnessDesignDocument): CanonicalE4Connectivity {
  return {
    schema: "techmap-e4-connectivity-v1",
    connectors: [...document.connectors]
      .sort(compareIds)
      .map((connector) => ({
        id: connector.id,
        designation: connector.designation,
        contacts: [...connector.contacts]
          .sort(compareIds)
          .map((contact) => ({
            id: contact.id,
            number: contact.number,
            circuit: contact.circuit,
            connectionStatus: contact.connectionStatus,
          })),
      })),
    wires: [...document.wires]
      .sort(compareIds)
      .map((wire) => ({
        id: wire.id,
        circuit: wire.circuit,
        endpoints: [canonicalEndpoint(wire.from), canonicalEndpoint(wire.to)]
          .sort((left, right) => compareStrings(endpointKey(left), endpointKey(right))),
      })),
    junctions: [...document.junctions]
      .sort(compareIds)
      .map((junction) => ({ id: junction.id, wireIds: [...junction.wireIds].sort() })),
    diffPairs: [...document.diffPairs]
      .sort(compareIds)
      .map((group) => ({ id: group.id, wireIds: [...group.wireIds].sort() })),
    screens: [...document.screens]
      .sort(compareIds)
      .map((group) => ({ id: group.id, wireIds: [...group.wireIds].sort() })),
  };
}

/** A deterministic comparison value, not a cryptographic content hash. */
export function e4ConnectivityFingerprint(document: HarnessDesignDocument): string {
  return JSON.stringify(projectE4Connectivity(document));
}

function canonicalEndpoint(endpoint: WireEndpoint): CanonicalE4Endpoint {
  return isJunctionEndpoint(endpoint)
    ? { kind: "junction", junctionId: endpoint.junctionId }
    : { kind: "contact", connectorId: endpoint.connectorId, contactId: endpoint.contactId };
}

function endpointKey(endpoint: CanonicalE4Endpoint): string {
  return endpoint.kind === "junction"
    ? `junction\u0000${endpoint.junctionId}`
    : `contact\u0000${endpoint.connectorId}\u0000${endpoint.contactId}`;
}

function compareIds(left: { readonly id: string }, right: { readonly id: string }): number {
  return compareStrings(left.id, right.id);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
