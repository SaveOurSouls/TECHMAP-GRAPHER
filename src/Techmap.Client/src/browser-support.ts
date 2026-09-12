export function missingBrowserFeatures(host: typeof globalThis = globalThis): readonly string[] {
  const missing: string[] = [];
  if (!("fetch" in host)) missing.push("Fetch API");
  if (!("AbortController" in host)) missing.push("AbortController");
  if (!("URL" in host)) missing.push("URL API");
  if (!("structuredClone" in host)) missing.push("structuredClone");
  return missing;
}
