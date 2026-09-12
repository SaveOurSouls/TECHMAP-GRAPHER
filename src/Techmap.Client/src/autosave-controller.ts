export const AUTOSAVE_DEBOUNCE_MILLISECONDS = 1_500;

export type AutosaveStatus = "pending" | "acknowledged" | "conflict" | "error";

export interface AutosaveCommand<TDraft extends object> {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly draft: Readonly<Partial<TDraft>>;
}

export interface AutosaveAcknowledgement {
  readonly revision: number;
}

export interface AutosaveSnapshot {
  readonly status: AutosaveStatus;
  readonly revision: number;
  readonly hasPendingDraft: boolean;
  readonly commandInFlight: boolean;
  readonly interruptedDraft: boolean;
  readonly unloadWarning: string | null;
  readonly message: string | null;
}

export interface PendingDraftMarkerStore {
  exists(): boolean;
  mark(expectedRevision: number): void;
  clear(): void;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AutosaveControllerOptions<TDraft extends object> {
  readonly initialRevision: number;
  readonly send: (command: AutosaveCommand<TDraft>) => Promise<AutosaveAcknowledgement>;
  readonly markerStore: PendingDraftMarkerStore;
  readonly createCommandId?: () => string;
  readonly debounceMilliseconds?: number;
}

export class AutosaveConflictError extends Error {
  constructor(message = "Данные на сервере изменились. Обновите проект и повторите правку.") {
    super(message);
    this.name = "AutosaveConflictError";
  }
}

export class AutosaveDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutosaveDraftError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const interruptedMessage = "Предыдущий черновик не был подтверждён сервером и мог быть потерян.";
const unloadMessage = "Есть изменения, которые сервер ещё не подтвердил.";

export function createPendingDraftMarkerStore(
  storage: KeyValueStorage,
  key: string,
): PendingDraftMarkerStore {
  if (key.trim() === "") throw new Error("Ключ маркера автосохранения не задан.");

  return Object.freeze({
    exists: () => storage.getItem(key) !== null,
    mark: (expectedRevision: number) => storage.setItem(key, JSON.stringify({
      version: 1,
      expectedRevision,
      markedUtc: new Date().toISOString(),
    })),
    clear: () => storage.removeItem(key),
  });
}

export class AutosaveController<TDraft extends object> {
  private readonly send: AutosaveControllerOptions<TDraft>["send"];
  private readonly markerStore: PendingDraftMarkerStore;
  private readonly createCommandId: () => string;
  private readonly debounceMilliseconds: number;
  private readonly listeners = new Set<(snapshot: AutosaveSnapshot) => void>();
  private revision: number;
  private pendingDraft: Partial<TDraft> | null = null;
  private inFlightDraft: Partial<TDraft> | null = null;
  private inFlightCommand: AutosaveCommand<TDraft> | null = null;
  private replayCommand: AutosaveCommand<TDraft> | null = null;
  private inFlightPromise: Promise<void> | null = null;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  private debounceElapsed = false;
  private status: AutosaveStatus;
  private message: string | null;
  private interruptedDraft: boolean;
  private disposed = false;

  constructor(options: AutosaveControllerOptions<TDraft>) {
    if (!Number.isSafeInteger(options.initialRevision) || options.initialRevision < 0) {
      throw new Error("Начальная ревизия автосохранения задана неверно.");
    }
    const debounceMilliseconds = options.debounceMilliseconds ?? AUTOSAVE_DEBOUNCE_MILLISECONDS;
    if (!Number.isFinite(debounceMilliseconds) || debounceMilliseconds < 1_000 || debounceMilliseconds > 2_000) {
      throw new Error("Задержка автосохранения должна быть от 1000 до 2000 мс.");
    }

    this.send = options.send;
    this.markerStore = options.markerStore;
    this.createCommandId = options.createCommandId ?? (() => globalThis.crypto.randomUUID());
    this.debounceMilliseconds = debounceMilliseconds;
    this.revision = options.initialRevision;
    this.interruptedDraft = options.markerStore.exists();
    this.status = this.interruptedDraft ? "error" : "acknowledged";
    this.message = this.interruptedDraft ? interruptedMessage : null;
  }

  get snapshot(): AutosaveSnapshot {
    const hasPendingDraft = this.pendingDraft !== null ||
      this.inFlightDraft !== null ||
      this.replayCommand !== null;
    return Object.freeze({
      status: this.status,
      revision: this.revision,
      hasPendingDraft,
      commandInFlight: this.inFlightDraft !== null,
      interruptedDraft: this.interruptedDraft,
      unloadWarning: hasPendingDraft || this.interruptedDraft ? unloadMessage : null,
      message: this.message,
    });
  }

  subscribe(listener: (snapshot: AutosaveSnapshot) => void): () => void {
    this.throwIfDisposed();
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  edit(patch: Readonly<Partial<TDraft>>): void {
    this.throwIfDisposed();
    if (Object.keys(patch).length === 0) return;

    this.pendingDraft = { ...this.pendingDraft, ...patch };
    this.markerStore.mark(this.revision);
    if (this.replayCommand === null) {
      this.status = "pending";
      this.message = null;
      this.debounceElapsed = false;
      this.schedule();
    }
    this.emit();
  }

  async flush(): Promise<void> {
    this.throwIfDisposed();
    this.cancelDebounce();

    while (true) {
      if (this.inFlightPromise) {
        await this.inFlightPromise;
        this.cancelDebounce();
        continue;
      }
      if ((this.pendingDraft || this.replayCommand) && this.status === "pending") {
        this.startSend();
        continue;
      }
      return;
    }
  }

  retry(): void {
    this.throwIfDisposed();
    if ((!this.pendingDraft && !this.replayCommand) || this.inFlightDraft) return;
    this.status = "pending";
    this.message = null;
    this.schedule();
    this.emit();
  }

  resumeAtRevision(revision: number): void {
    this.throwIfDisposed();
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error("Ревизия автосохранения задана неверно.");
    }
    if (this.inFlightDraft) {
      throw new Error("Нельзя изменить ожидаемую ревизию во время отправки команды.");
    }

    if (this.replayCommand) {
      this.pendingDraft = { ...this.replayCommand.draft, ...this.pendingDraft };
      this.replayCommand = null;
    }
    this.revision = revision;
    this.status = this.pendingDraft || this.replayCommand ? "pending" : "acknowledged";
    this.message = null;
    if (this.pendingDraft || this.replayCommand) this.schedule();
    else this.clearMarkerAndInterruptedState();
    this.emit();
  }

  discardPendingDraft(revision = this.revision): void {
    this.throwIfDisposed();
    if (this.inFlightDraft) {
      throw new Error("Нельзя удалить черновик во время отправки команды.");
    }
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error("Ревизия автосохранения задана неверно.");
    }

    this.cancelDebounce();
    this.revision = revision;
    this.pendingDraft = null;
    this.replayCommand = null;
    this.status = "acknowledged";
    this.message = null;
    this.clearMarkerAndInterruptedState();
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelDebounce();
    this.listeners.clear();
  }

  private schedule(): void {
    if (this.disposed) return;
    this.cancelDebounce();
    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = null;
      if (this.inFlightDraft) {
        this.debounceElapsed = true;
      } else {
        this.startSend();
      }
    }, this.debounceMilliseconds);
  }

  private startSend(): void {
    if (
      this.disposed || this.inFlightDraft ||
      (!this.pendingDraft && !this.replayCommand) || this.status !== "pending"
    ) return;

    const replay = this.replayCommand;
    const draft = replay?.draft ?? Object.freeze({ ...this.pendingDraft });
    if (!replay) this.pendingDraft = null;
    this.inFlightDraft = draft;
    const expectedRevision = replay?.expectedRevision ?? this.revision;
    const commandId = replay?.commandId ?? this.createCommandId();
    if (!uuidPattern.test(commandId)) {
      this.failSend(
        { commandId, expectedRevision, draft },
        new AutosaveDraftError("Фабрика commandId вернула некорректный UUID."),
      );
      return;
    }

    this.emit();
    const command = Object.freeze({ commandId, expectedRevision, draft });
    this.inFlightCommand = command;
    const operation = Promise.resolve()
      .then(() => this.send(command))
      .then(
        acknowledgement => this.acknowledge(acknowledgement, expectedRevision),
        error => this.failSend(command, error),
      )
      .finally(() => {
        if (this.inFlightPromise === operation) this.inFlightPromise = null;
      });
    this.inFlightPromise = operation;
  }

  private acknowledge(
    acknowledgement: AutosaveAcknowledgement,
    expectedRevision: number,
  ): void {
    if (!Number.isSafeInteger(acknowledgement.revision) || acknowledgement.revision <= expectedRevision) {
      this.failSend(
        this.inFlightCommand ?? {
          commandId: "",
          expectedRevision,
          draft: this.inFlightDraft ?? {} as Partial<TDraft>,
        },
        new Error("Сервер вернул некорректную ревизию автосохранения."),
      );
      return;
    }

    this.revision = acknowledgement.revision;
    this.inFlightDraft = null;
    this.inFlightCommand = null;
    this.replayCommand = null;
    if (this.pendingDraft) {
      this.status = "pending";
      if (this.debounceElapsed) this.startSend();
      else if (this.debounceHandle === null) this.schedule();
    } else {
      this.status = "acknowledged";
      this.message = null;
      this.clearMarkerAndInterruptedState();
    }
    this.emit();
  }

  private failSend(command: AutosaveCommand<TDraft>, error: unknown): void {
    this.inFlightDraft = null;
    this.inFlightCommand = null;
    if (error instanceof AutosaveDraftError) {
      this.replayCommand = null;
      this.pendingDraft = { ...command.draft, ...this.pendingDraft };
    } else {
      this.replayCommand = command;
    }
    const conflict = error instanceof AutosaveConflictError;
    this.status = conflict ? "conflict" : "error";
    this.message = error instanceof Error ? error.message : "Автосохранение завершилось ошибкой.";
    this.emit();
  }

  private clearMarkerAndInterruptedState(): void {
    this.markerStore.clear();
    this.interruptedDraft = false;
  }

  private cancelDebounce(): void {
    if (this.debounceHandle === null) return;
    clearTimeout(this.debounceHandle);
    this.debounceHandle = null;
    this.debounceElapsed = false;
  }

  private emit(): void {
    if (this.disposed) return;
    const snapshot = this.snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }

  private throwIfDisposed(): void {
    if (this.disposed) throw new Error("Контроллер автосохранения уже закрыт.");
  }
}
