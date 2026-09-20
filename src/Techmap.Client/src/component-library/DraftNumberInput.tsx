import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number | "";
  onValueChange: (value: number) => void;
  onEmpty?: () => void;
};

export function parseDraftNumber(text: string, min?: number, max?: number): number | null {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) && (min === undefined || value >= min) && (max === undefined || value <= max) ? value : null;
}

/** Keep partial input local; model validation runs only at the editing boundary. */
export function DraftNumberInput({ value, onValueChange, onEmpty, onBlur, onKeyDown, ...props }: Props) {
  const [draft, setDraft] = useState(String(value));
  const pending = useRef(false);
  useEffect(() => { setDraft(String(value)); pending.current = false; }, [value]);
  const commit = () => {
    if (!pending.current) return;
    pending.current = false;
    const parsed = parseDraftNumber(draft, props.min === undefined ? undefined : Number(props.min), props.max === undefined ? undefined : Number(props.max));
    if (draft === "" && onEmpty) onEmpty();
    else if (parsed !== null) { setDraft(String(parsed)); if (parsed !== value) onValueChange(parsed); }
    else setDraft(String(value));
  };
  return <input {...props} type="number" value={draft} onChange={event => { pending.current = true; setDraft(event.target.value); }}
    onBlur={event => { commit(); onBlur?.(event); }} onKeyDown={event => {
      if (event.key === "Enter") { event.preventDefault(); commit(); }
      if (event.key === "Escape") { pending.current = false; setDraft(String(value)); }
      onKeyDown?.(event);
    }} />;
}
