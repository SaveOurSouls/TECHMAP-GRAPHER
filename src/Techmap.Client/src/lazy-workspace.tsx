import { Component, lazy, Suspense, useMemo, useState, type ComponentType, type ReactNode } from "react";

interface WorkspaceLoadBoundaryProps {
  readonly children: ReactNode;
  readonly onRetry: () => void;
}

export class WorkspaceLoadBoundary extends Component<WorkspaceLoadBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <div className="panel-message" role="alert">
      <p>Не удалось отобразить рабочую область.</p>
      <button type="button" onClick={this.props.onRetry}>Повторить загрузку</button>
    </div>;
  }
}

/** Keeps successful loads shared while a rejected lazy instance can be replaced on retry. */
export function createLazyWorkspace<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  loadingMessage: string,
) {
  const initial = lazy(load);
  return function LazyWorkspace(props: Props) {
    const [attempt, setAttempt] = useState(0);
    const Workspace = useMemo(() => attempt === 0 ? initial : lazy(load), [attempt]);
    return <WorkspaceLoadBoundary key={attempt} onRetry={() => setAttempt(value => value + 1)}>
      <Suspense fallback={<div className="panel-message" role="status">{loadingMessage}</div>}>
        <Workspace {...props} />
      </Suspense>
    </WorkspaceLoadBoundary>;
  };
}
