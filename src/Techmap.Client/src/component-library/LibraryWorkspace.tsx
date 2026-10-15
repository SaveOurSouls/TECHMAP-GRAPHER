import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import type { RuntimeConfig } from '../runtime-config';
import type { LocalSession } from '../local-session';

const ComponentLibrary = lazy(async () => ({ default: (await import('./ComponentLibrary')).ComponentLibrary }));
const TerminationLibrary = lazy(async () => ({ default: (await import('../termination-library/TerminationLibrary')).TerminationLibrary }));
interface Props { readonly config: RuntimeConfig; readonly session: LocalSession; readonly onNavigationGuard?: (guard: (() => Promise<boolean>) | null) => void }
/** Permanent destinations cannot be removed with a component/series delete command. */
export function LibraryWorkspace({ config, session, onNavigationGuard }: Props) {
  const [active, setActive] = useState<'components' | 'terminations'>('components');
  const guard = useRef<(() => Promise<boolean>) | null>(null), pending = useRef(false);
  const register = useCallback((next: (() => Promise<boolean>) | null) => { guard.current = next; onNavigationGuard?.(next); }, [onNavigationGuard]);
  const change = async (next: typeof active) => {
    if (next === active || pending.current) return;
    pending.current = true;
    try { if (!guard.current || await guard.current()) setActive(next); } finally { pending.current = false; }
  };
  return <div className="library-workspace">
    <nav className="library-workspace-nav" aria-label="Библиотеки"><button type="button" aria-pressed={active === 'components'} onClick={() => void change('components')}>Соединители</button><button type="button" aria-pressed={active === 'terminations'} onClick={() => void change('terminations')}>Библиотека оконцовок</button></nav>
    <Suspense fallback={<p role="status">Открываем библиотеку…</p>}>{active === 'components' ? <ComponentLibrary config={config} session={session} onNavigationGuard={register} /> : <TerminationLibrary onNavigationGuard={register} />}</Suspense>
  </div>;
}
