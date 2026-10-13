import { routeV3BatchQuantity, type RouteV3Node } from "./route-v3-model";
import { routeV3IsCutCard } from "./route-v3-operations";
export { routeV3IsCutCard } from "./route-v3-operations";

/** One cut operation is repeated for every blank represented by the card. */
export function routeV3ProcessedQuantity(node: RouteV3Node, harnessQuantity: number): number {
  const batch = routeV3BatchQuantity(node, harnessQuantity);
  return batch * (routeV3IsCutCard(node) ? node.refs.length : 1);
}
