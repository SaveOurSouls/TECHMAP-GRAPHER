import { useEffect, useMemo, useState } from 'react';
import { loadTerminationCatalog, TERMINATION_LIBRARY_STORAGE_KEY, type StorageLike, type TerminationCatalog } from './storage';

export function useTerminationCatalog(storage?: StorageLike) {
  const target = useMemo(() => { try { return storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined); } catch { return undefined; } }, [storage]);
  const [catalog, setCatalog] = useState<TerminationCatalog>({ records: [], series: [] });
  const [storageError, setStorageError] = useState<string | null>(null);
  const reload = () => {
    try {
      if (!target) throw new Error('Локальное хранилище недоступно.');
      setCatalog(loadTerminationCatalog(target)); setStorageError(null);
    } catch (cause) { setStorageError(cause instanceof Error ? cause.message : 'Не удалось прочитать библиотеку.'); }
  };
  useEffect(() => {
    reload();
    const onStorage = (e: StorageEvent) => { if (e.key === TERMINATION_LIBRARY_STORAGE_KEY || e.key === null) reload(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [target]);
  return { target, catalog, setCatalog, storageError, reload };
}
