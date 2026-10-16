import { type RuntimeConfig } from "../runtime-config";
import { type LocalSession } from "../local-session";
import { type DrawingGenerator } from "./drawing-generator";
import { type ConnectorSchematicPresentation } from "../editor/model";
import { type ArticleDrawing, type DrawingContactBinding } from "./drawing-bindings";
import { type TemplateAsset, type ArticleBinding, type ComponentTemplate } from "./component-template-api";
import { type TemplateContentV3 as TemplateContentV2 } from "./template-model-v3";
import { type CompatibleSealV5, type TerminalContactTypeBindingV5 } from "./template-model-v5";
import { type E4ConnectorSeriesTable } from "./e4-connector-series-table";

export interface Props { config: RuntimeConfig; session: LocalSession; onNavigationGuard?: (guard: (() => Promise<boolean>) | null) => void; }
export interface Draft { drawingGenerators?: DrawingGenerator[]; e4Presentation?: ConnectorSchematicPresentation; articleDrawings?: ArticleDrawing[]; drawingContactBindings?: DrawingContactBinding[]; templateId: string | null; version: number; draftRevision: number; code: string; name: string; assets: TemplateAsset[]; content: TemplateContentV2; compatibleTerminalArticleKeys: ArticleBinding[]; compatibleSeals?: CompatibleSealV5[]; terminalContactTypeBindings: TerminalContactTypeBindingV5[] | null; e4ConnectorTable: E4ConnectorSeriesTable; }
export type LoadedTemplate = Pick<ComponentTemplate, "templateId" | "code" | "name" | "articleBindings" | "assets" | "content"> & { readonly version: number; readonly draftRevision: number };
