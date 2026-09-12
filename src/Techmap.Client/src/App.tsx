import type { RuntimeConfig } from "./runtime-config";

interface AppProps {
  readonly config: RuntimeConfig;
}

const sections = ["Проекты", "Схема Э4", "Чертёж", "Маршрут", "Справочники"] as const;

export function App({ config }: AppProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="product-mark" aria-hidden="true">T</span>
          <span className="product-name">TECHMAP-GRAPHER</span>
        </div>
        <div className="runtime-status" title={`API ${config.apiVersion}; схема ${config.schemaVersion}`}>
          <span className="status-dot" aria-hidden="true" />
          Локальный режим · {config.appVersion}
        </div>
      </header>

      <div className="workspace">
        <nav className="sidebar" aria-label="Разделы приложения">
          {sections.map((section, index) => (
            <button className={index === 0 ? "nav-item active" : "nav-item"} type="button" key={section}>
              <span className="nav-index">{String(index + 1).padStart(2, "0")}</span>
              {section}
            </button>
          ))}
        </nav>

        <main className="content">
          <div className="content-heading">
            <div>
              <p className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p>
              <h1>Проекты жгутов</h1>
              <p>Создавайте проекты, переключайтесь между жгутами и продолжайте сохранённую работу.</p>
            </div>
            <button className="primary-action" type="button">Создать проект</button>
          </div>

          <section className="empty-state" aria-labelledby="empty-title">
            <div className="empty-glyph" aria-hidden="true">
              <span /><span /><span />
            </div>
            <h2 id="empty-title">Проектов пока нет</h2>
            <p>Создайте первый проект или откройте ранее сохранённый архив.</p>
            <div className="empty-actions">
              <button className="primary-action" type="button">Новый проект</button>
              <button className="secondary-action" type="button">Открыть архив</button>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
