import { useId, type ReactNode } from "react";

export function InfoHint({ children }: { readonly children: ReactNode }) {
  const id = useId();
  return <span className="info-hint">
    <button type="button" aria-label="Справка" aria-describedby={id}>i</button>
    <span role="tooltip" id={id}>{children}</span>
  </span>;
}
