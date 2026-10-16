import { createLazyWorkspace } from "../lazy-workspace";

export async function loadRouteV3() {
  const module = await import("./RouteV3Panel");
  return { default: module.RouteV3Panel };
}

export const LazyRouteV3Panel = createLazyWorkspace(loadRouteV3, "Открываем маршрут…");
