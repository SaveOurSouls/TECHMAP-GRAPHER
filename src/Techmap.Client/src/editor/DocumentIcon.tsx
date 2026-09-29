export function DocumentIcon({ kind }: { kind: "connections" | "bom" | "cut" | "positions" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "connections" ? <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M10 9v12"/></>
      : kind === "bom" ? <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>
      : kind === "cut" ? <><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.2 8.2 12 12M8.2 15.8 20 4M13 12l2 2"/></>
      : <><circle cx="9" cy="8" r="5"/><path d="M9 6v4M12.5 11.5 19 18h3"/></>}
  </svg>;
}
