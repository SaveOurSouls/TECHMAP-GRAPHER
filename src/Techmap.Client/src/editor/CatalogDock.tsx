import { useMemo, useState, type DragEvent } from "react";
import type { EditorCatalogItem } from "./editor-types";

export interface CatalogDockProps {
  readonly items: readonly EditorCatalogItem[];
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly onActivate: (item: EditorCatalogItem) => void;
}

export function CatalogDock({ items, expanded, onExpandedChange, onActivate }: CatalogDockProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Все");
  const categories = useMemo(
    () => ["Все", ...new Set(items.map((item) => item.category))],
    [items],
  );
  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru");
    return items.filter((item) =>
      (category === "Все" || item.category === category) &&
      (!query || `${item.title} ${item.subtitle}`.toLocaleLowerCase("ru").includes(query)),
    );
  }, [category, items, search]);

  const beginDrag = (event: DragEvent<HTMLButtonElement>, item: EditorCatalogItem) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-techmap-catalog-item", item.id);
    event.dataTransfer.setData("text/plain", item.title);
  };

  return (
    <section className={expanded ? "he-catalog expanded" : "he-catalog collapsed"} aria-label="Каталог объектов">
      <header className="he-catalog-header">
        <button
          className="he-catalog-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => onExpandedChange(!expanded)}
        >
          <span aria-hidden="true">{expanded ? "⌄" : "⌃"}</span>
          Объекты и материалы
          <small>{items.length}</small>
        </button>
        {expanded && (
          <>
            <label className="he-catalog-search">
              <span aria-hidden="true">⌕</span>
              <span className="visually-hidden">Поиск по каталогу</span>
              <input
                type="search"
                placeholder="Артикул, название или характеристика"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <span className="he-catalog-hint">Перетащите на поле или нажмите дважды</span>
          </>
        )}
      </header>
      {expanded && (
        <div className="he-catalog-content">
          <nav className="he-catalog-categories" aria-label="Категории каталога">
            {categories.map((value) => (
              <button
                type="button"
                className={value === category ? "active" : ""}
                aria-pressed={value === category}
                key={value}
                onClick={() => setCategory(value)}
              >{value}</button>
            ))}
          </nav>
          <div className="he-catalog-results" role="list" aria-label="Результаты каталога">
            {visibleItems.length === 0 ? (
              <div className="he-catalog-empty">Ничего не найдено. Измените запрос или категорию.</div>
            ) : visibleItems.map((item) => (
              <button
                type="button"
                className="he-catalog-card"
                role="listitem"
                key={item.id}
                draggable
                onDragStart={(event) => beginDrag(event, item)}
                onDoubleClick={() => onActivate(item)}
              >
                <span className="he-catalog-thumbnail" style={{ "--catalog-accent": item.accent } as React.CSSProperties} aria-hidden="true">▣</span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </span>
                <span className="he-catalog-add" aria-hidden="true">＋</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

