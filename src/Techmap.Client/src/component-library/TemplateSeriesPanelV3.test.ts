import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  TemplateSeriesPanelV3,
  articleAddPreviewV3,
  appendTerminalArticleKeyV3,
  articleContactGroupEditorValueV3,
  contactTypeNameExistsV3,
  formatTerminalArticleKeysV3,
  parseTerminalArticleKeysV3,
  updateTerminalArticleKeyV3,
} from "./TemplateSeriesPanelV3";
import { addContactPointV3, addContactTypeGroupV3, newTemplateContentV3, upsertArticleVariantV3 } from "./template-commands-v3";
import { upgradeTemplateContentV2ToV3 } from "./template-upgrade-v3";
import { newTemplateContentV2 } from "./template-commands-v2";

describe("TemplateSeriesPanelV3", () => {
  it("recognizes contact type duplicates ignoring case and surrounding spaces", () => {
    const content = newTemplateContentV3();
    content.contactTypeGroups.push({ id: crypto.randomUUID(), name: "Сигнальные" });
    expect(contactTypeNameExistsV3(content, " сигнальные ")).toBe(true);
    expect(contactTypeNameExistsV3(content, "Силовые")).toBe(false);
    expect(contactTypeNameExistsV3(content, " ")).toBe(false);
  });

  it("previews a pattern using fixed connector catalog identity and reports collisions in Russian", () => {
    const content = newTemplateContentV3();
    content.articleVariants.push({ id: crypto.randomUUID(), sourceId: "БД.СОЕД", entityType: "connector", articleKey: "PHR-02", parameterValues: [], contactGroups: null });
    expect(articleAddPreviewV3(content, "pattern", "", "PHR-XX", "01-03")).toEqual({
      articles: [], error: "Артикул «PHR-02» уже есть в этой серии.",
    });
    expect(articleAddPreviewV3(content, "pattern", "", "PHR-XX", "01, 03")).toEqual({
      articles: ["PHR-01", "PHR-03"], error: null,
    });
  });

  it("renders contact groups, article variants and editable terminal configuration", () => {
    const content = upgradeTemplateContentV2ToV3(newTemplateContentV2()).content;
    const groupId = crypto.randomUUID();
    content.contactTypeGroups.push({ id: groupId, name: "Сигнальные" });
    content.articleVariants.push({ id: crypto.randomUUID(), sourceId: "БД.СОЕД", entityType: "connector", articleKey: "B2B-XH-A", parameterValues: [], contactGroups: [{ contactTypeGroupId: groupId, contactCount: 2, allowedTerminalArticleKeys: [{ sourceId: "БД.ТЕР", entityType: "terminal", articleKey: "SXH-001T-P0.6" }] }] });
    const markup = renderToStaticMarkup(createElement(TemplateSeriesPanelV3, {
      content, onAddContactTypeGroup: vi.fn(), onRenameContactTypeGroup: vi.fn(), onDeleteContactTypeGroup: vi.fn(),
      onAddArticleVariants: vi.fn(), onDeleteArticleVariant: vi.fn(), onSetArticleContactGroup: vi.fn(), onRemoveArticleContactGroup: vi.fn(),
      selectedArticleVariantId: content.articleVariants[0]!.id,
      articlePreviewMessage: "B2B-XH-A: 2 контакта",
      articlePreviewRows: [{ key: "row-1", number: "1", name: "DATA+", circuitText: "NET-DATA+", contactTypeGroupId: groupId }],
    }));
    expect(markup).toContain("Серия и артикулы");
    expect(markup).toContain("Типы контактов");
    expect(markup).toContain("Силовые");
    expect(markup).toContain("Дополнительные");
    expect(markup).toContain("Другой тип");
    expect(markup).toContain("Тип «Сигнальные» уже добавлен.");
    expect(markup).toContain('<button type="submit" disabled="">+ Тип</button>');
    expect(markup).toContain("Сигнальные");
    expect(markup).toContain("B2B-XH-A");
    expect(markup).toContain("SXH-001T-P0.6");
    expect(markup).toContain("Итоговое количество контактов");
    expect(markup).toContain("не имеет повторяемого сегмента");
    expect(markup).toContain("Создайте прототип контакта и один домен повтора");
    expect(markup).toContain("либо укажите 0");
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain("Допустимые терминалы");
    expect(markup).toContain("Артикул для предпросмотра");
    expect(markup).toContain("Один артикул");
    expect(markup).toContain("По шаблону");
    expect(markup).toContain('name="article-add-mode"');
    expect(markup).toContain("B2B-XH-A: 2 контакта");
    expect(markup).toContain("Материализованные строки контактов");
    expect(markup).toContain("NET-DATA+");
    expect(markup).toContain('class="series-v3-terminal-heading"');
    expect(markup).toContain('class="series-v3-terminal-list"');
    expect(markup).toContain('class="series-v3-terminal-row"');

    const guideStart = markup.indexOf('<details class="series-v3-guide">');
    const guideEnd = markup.indexOf("</details>", guideStart);
    const guideMarkup = markup.slice(guideStart, guideEnd);
    expect(guideStart).toBeGreaterThan(-1);
    expect(guideMarkup).not.toContain(" open=");
    expect(guideMarkup).toContain("<summary>Как заполнить шаблон</summary>");
    expect(guideMarkup).toContain('<ol aria-label="Порядок заполнения шаблона">');
    const guideSteps = [
      "Укажите серию соединителя и краткое описание.",
      "Добавьте нужные типы контактов. В одной серии может быть несколько типов.",
      "Добавьте артикулы по одному или массово по шаблону с <code>XX</code>. Ведущие нули сохраняются.",
      "Для каждого артикула задайте количество контактов каждого типа.",
      "Укажите допустимые терминалы из БД.ТЕР.",
      "Выберите артикул и проверьте автоматически подготовленную таблицу Э4.",
      "Сохраните новую версию серии.",
    ];
    expect(guideMarkup.match(/<li>/g)).toHaveLength(guideSteps.length);
    guideSteps.reduce((previousIndex, step) => {
      const stepIndex = guideMarkup.indexOf(step);
      expect(stepIndex).toBeGreaterThan(previousIndex);
      return stepIndex;
    }, -1);
    expect(guideMarkup).toContain("Основной вид Э4 всегда формируется как таблица.");
    expect(guideMarkup).not.toContain("опубликуйте");
  });

  it("parses terminal keys without silently accepting invalid or duplicate rows", () => {
    expect(parseTerminalArticleKeysV3("БД.ТЕР|terminal|A\nБД.ТЕР|terminal|B")).toEqual([
      { sourceId: "БД.ТЕР", entityType: "terminal", articleKey: "A" },
      { sourceId: "БД.ТЕР", entityType: "terminal", articleKey: "B" },
    ]);
    expect(parseTerminalArticleKeysV3("БД.ТЕР|terminal|A; БД.ТЕР|terminal|A")).toBeNull();
    expect(parseTerminalArticleKeysV3("только артикул")).toBeNull();
    expect(formatTerminalArticleKeysV3([{ sourceId: "db", entityType: "terminal", articleKey: "T1" }])).toBe("db|terminal|T1");
  });

  it("round-trips delimiters through the legacy import/export helper", () => {
    const keys = [{ sourceId: "БД|ТЕР", entityType: "terminal", articleKey: "T;1\\A" }];
    const encoded = formatTerminalArticleKeysV3(keys);
    expect(parseTerminalArticleKeysV3(encoded)).toEqual(keys);
  });

  it("updates one structured terminal row atomically and rejects incomplete duplicates", () => {
    const keys = [
      { sourceId: "БД.ТЕР", entityType: "terminal", articleKey: "T-1" },
      { sourceId: "БД.ТЕР", entityType: "terminal", articleKey: "T-2" },
    ];
    expect(updateTerminalArticleKeyV3(keys, 0, { articleKey: "T-1-A" })).toEqual([
      { sourceId: "БД.ТЕР", entityType: "terminal", articleKey: "T-1-A" }, keys[1],
    ]);
    expect(updateTerminalArticleKeyV3(keys, 0, { articleKey: "" })).toBeNull();
    expect(updateTerminalArticleKeyV3(keys, 0, { articleKey: "T-2" })).toBeNull();
    expect(appendTerminalArticleKeyV3(keys, { sourceId: "БД.ТЕР", entityType: "terminal", articleKey: "T-3" })).toEqual([
      ...keys, { sourceId: "БД.ТЕР", entityType: "terminal", articleKey: "T-3" },
    ]);
  });

  it("reports inherited contact counts separately from explicit overrides", () => {
    const initial = newTemplateContentV3();
    const [grouped, groupId] = addContactTypeGroupV3(initial, "Сигнальные");
    const [withContact] = addContactPointV3(grouped, grouped.views[0]!.id, { contactTypeGroupId: groupId });
    const [withVariant, variantId] = upsertArticleVariantV3(withContact, { sourceId: "БД.СОЕД", entityType: "connector", articleKey: "X-1" });
    expect(articleContactGroupEditorValueV3(withVariant, variantId, groupId)).toMatchObject({ contactCount: 1, inherited: true, configured: false });
  });
});
