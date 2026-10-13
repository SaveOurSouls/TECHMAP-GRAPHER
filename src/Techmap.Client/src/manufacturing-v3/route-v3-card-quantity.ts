import { routeV3BatchQuantity, type RouteV3Node } from "./route-v3-model";

/** One cut operation is repeated for every blank represented by the card. */
export function routeV3IsCutCard(node: RouteV3Node): boolean {
  return node.kind === "semiFinished" && node.refs.length > 0 && !node.fragmentIds.length
    && node.refs.every(ref => ref.kind === "wire" || ref.kind === "covering" || ref.kind === "cable");
}

export function routeV3ProcessedQuantity(node: RouteV3Node, harnessQuantity: number): number {
  const batch = routeV3BatchQuantity(node, harnessQuantity);
  return batch * (routeV3IsCutCard(node) ? node.refs.length : 1);
}
