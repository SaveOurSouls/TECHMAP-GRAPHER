import type { HarnessDesignDocument, WireEndpoint } from './model';

export const endPreparationModes = ['cut', 'copper', 'tin', 'pin', 'socket', 'pin-sealed', 'socket-sealed', 'lug'] as const;
export type EndPreparationMode = typeof endPreparationModes[number];
export interface WireEndRef { readonly wireId: string; readonly end: 'from' | 'to' }
export interface ContactRef { readonly connectorId: string; readonly contactId: string }
export interface TerminationCatalogBinding {
  readonly sourceId: string; readonly snapshotId: string; readonly snapshotSha256: string;
  readonly recordId: string; readonly sourceKey: string; readonly displayName: string;
  /** Immutable record data, retained even when the active catalogue is unavailable. */
  readonly payload?: Readonly<Record<string, unknown>>;
}
export interface TerminationComponent {
  readonly kind: 'terminal' | 'sleeve' | 'preparation'; readonly symbolId: string;
  readonly artifactId?: string; readonly preparationMode?: EndPreparationMode; readonly color?: string;
  readonly catalogBinding?: TerminationCatalogBinding; readonly conductive?: boolean;
}
export interface TerminationCapacity {
  readonly confirmed: boolean; readonly minWireCount?: number; readonly maxWireCount?: number;
  readonly combinations?: readonly { readonly sections: readonly number[]; readonly unit: 'mm2' | 'awg'; readonly material?: string }[];
}
export interface TerminationArtifact {
  readonly id: string; readonly kind: 'terminal' | 'sleeve' | 'seal'; readonly article: string; readonly symbolId: string;
  readonly color?: string; readonly dimensions?: Readonly<Record<string, number>>;
  readonly catalogBinding?: TerminationCatalogBinding; readonly capacity?: TerminationCapacity;
}
export interface TerminationGroup {
  readonly id: string; readonly target: ContactRef; readonly artifactId: string; readonly memberEnds: readonly WireEndRef[];
}
export interface EndPreparation extends WireEndRef {
  readonly id: string; readonly mode: EndPreparationMode; readonly artifactId?: string; readonly sealArtifactId?: string;
  readonly stripLengthMm?: number | null;
}
export type TerminationOperationTarget =
  | { readonly kind: 'wireEnd'; readonly wireId: string; readonly end: 'from' | 'to' }
  | { readonly kind: 'group'; readonly groupId: string }
  | { readonly kind: 'portSet'; readonly connectorId: string; readonly contactIds: readonly string[] }
  | { readonly kind: 'twist'; readonly twistId: string };
export interface TerminationOperation {
  readonly id: string; readonly kind: 'strip' | 'tin' | 'crimp' | 'ultrasonic-weld' | 'twist';
  readonly target: TerminationOperationTarget; readonly executionCount: number | null;
  readonly recipe?: TerminationCatalogBinding; readonly processCapacity?: number | null; readonly dependsOn?: readonly string[];
  readonly norm?: { readonly machineSeconds: number | null; readonly humanSeconds: number | null; readonly setupSeconds: number | null };
}
export interface PhysicalTwistGroup {
  readonly id: string; readonly memberWireIds: readonly string[]; readonly segmentIds: readonly string[];
  readonly pitchMm: number | null; readonly direction: 'left' | 'right';
}
export interface TerminationDocument {
  readonly version: 1; readonly artifacts: readonly TerminationArtifact[]; readonly groups: readonly TerminationGroup[];
  readonly endPreparations: readonly EndPreparation[]; readonly operations: readonly TerminationOperation[];
  readonly twists: readonly PhysicalTwistGroup[];
}
export const emptyTerminationDocument = (): TerminationDocument => ({ version: 1, artifacts: [], groups: [], endPreparations: [], operations: [], twists: [] });
export function usedTerminationArtifactIds(document:HarnessDesignDocument):Set<string>{
  return new Set([...document.connectors.flatMap(c=>c.terminationComponent?.artifactId?[c.terminationComponent.artifactId]:[]),...(document.terminations?.groups.map(g=>g.artifactId)??[]),...(document.terminations?.endPreparations.flatMap(p=>[p.artifactId,p.sealArtifactId].filter((id):id is string=>!!id))??[])]);
}
export const wireEndKey = (end: WireEndRef): string => JSON.stringify([end.wireId, end.end]);
export const sameContact = (endpoint: WireEndpoint, target: ContactRef): boolean => !endpoint.junctionId && !endpoint.screenId && endpoint.connectorId === target.connectorId && endpoint.contactId === target.contactId;
const fail = (message: string): never => { throw new Error('Некорректная оконцовка: ' + message); };
function obj(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('ожидается объект.'); return v as Record<string, unknown>; }
function text(v: unknown, empty = false): string { if (typeof v !== 'string' || v.length > 1024 || (!empty && !v.trim())) return fail('неверный текст или ID.'); return v; }
function num(v: unknown, positive = false, integer = false): number { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e9 || (positive && v === 0) || (integer && !Number.isSafeInteger(v))) return fail('неверное числовое значение.'); return v; }
function list<T>(v: unknown, parse: (v: unknown) => T): T[] { if (!Array.isArray(v) || v.length > 10000) return fail('неверный список.'); return v.map(parse); }
function choice<T extends string>(v: unknown, values: readonly T[]): T { if (!values.includes(v as T)) return fail('неизвестный режим.'); return v as T; }
function unique(values: readonly string[]): void { if (new Set(values).size !== values.length) fail('повторяющиеся ID/ссылки.'); }
function end(v: unknown): WireEndRef { const r = obj(v); return { wireId: text(r.wireId), end: choice(r.end, ['from', 'to']) }; }
function binding(v: unknown): TerminationCatalogBinding { const r = obj(v); if(typeof r.snapshotSha256!=='string'||!/^[a-f0-9]{64}$/i.test(r.snapshotSha256))fail('неверный SHA-256 snapshot.'); const payload = r.payload === undefined ? {} : { payload: JSON.parse(JSON.stringify(obj(r.payload))) as Readonly<Record<string, unknown>> }; return { sourceId: text(r.sourceId), snapshotId: text(r.snapshotId), snapshotSha256: text(r.snapshotSha256), recordId: text(r.recordId), sourceKey: text(r.sourceKey), displayName: text(r.displayName), ...payload }; }
export function parseTerminationComponent(v: unknown): TerminationComponent {
  const r = obj(v);
  if (r.conductive !== undefined && typeof r.conductive !== 'boolean') fail('неверная проводимость.');
  return { kind: choice(r.kind, ['terminal', 'sleeve', 'preparation']), symbolId: text(r.symbolId),
    ...(r.artifactId === undefined ? {} : { artifactId: text(r.artifactId) }),
    ...(r.preparationMode === undefined ? {} : { preparationMode: choice(r.preparationMode, endPreparationModes) }),
    ...(r.color === undefined ? {} : { color: text(r.color) }),
    ...(r.catalogBinding === undefined ? {} : { catalogBinding: binding(r.catalogBinding) }),
    ...(r.conductive === undefined ? {} : { conductive: r.conductive as boolean }) };
}
export function validateTerminationComponents(document: HarnessDesignDocument): void {
  for (const c of document.connectors) if (c.terminationComponent) {
    const m = parseTerminationComponent(c.terminationComponent);
    if (c.contacts.length !== (m.kind === 'sleeve' ? 2 : 1)) fail('наконечник/Разделка требует одну точку, гильза две.');
    if (m.artifactId && !document.terminations?.artifacts.some(a => a.id === m.artifactId)) fail('артефакт компонента отсутствует.');
    if(m.artifactId&&document.terminations?.artifacts.find(a=>a.id===m.artifactId)?.kind!==(m.kind==='sleeve'?'sleeve':'terminal'))fail('тип артефакта компонента не совпадает.');
  }
}
export function parseTerminationDocument(value: unknown, document: HarnessDesignDocument): TerminationDocument {
  const r = obj(value); if (r.version !== 1) fail('неподдерживаемая версия.');
  const artifacts = list(r.artifacts, v => { const a = obj(v); const capacity = a.capacity === undefined ? undefined : (() => {
    const c = obj(a.capacity); if (typeof c.confirmed !== 'boolean') fail('неверное подтверждение capacity.');
    const combinations = c.combinations === undefined ? undefined : list(c.combinations, v => { const x = obj(v); const sections = list(x.sections, v => num(v, true)); if (!sections.length) fail('пустая комбинация сечений.'); return { sections, unit: choice(x.unit, ['mm2', 'awg']), ...(x.material === undefined ? {} : { material: text(x.material) }) }; });
    const minWireCount = c.minWireCount === undefined ? undefined : num(c.minWireCount, true, true), maxWireCount = c.maxWireCount === undefined ? undefined : num(c.maxWireCount, true, true);
    if (minWireCount !== undefined && maxWireCount !== undefined && minWireCount > maxWireCount) fail('перевёрнутая capacity.');
    return { confirmed: c.confirmed as boolean, ...(minWireCount === undefined ? {} : {minWireCount}), ...(maxWireCount === undefined ? {} : {maxWireCount}), ...(combinations === undefined ? {} : { combinations }) };
  })(); return { id: text(a.id), kind: choice(a.kind, ['terminal', 'sleeve', 'seal']), article: text(a.article, true), symbolId: text(a.symbolId),
    ...(a.catalogBinding === undefined ? {} : { catalogBinding: binding(a.catalogBinding) }), ...(capacity === undefined ? {} : { capacity }),
    ...(a.color === undefined ? {} : { color: text(a.color) }), ...(a.dimensions === undefined ? {} : { dimensions: Object.fromEntries(Object.entries(obj(a.dimensions)).map(([k,v]) => [text(k),num(v)])) }) }; });
  const groups = list(r.groups, v => { const g = obj(v), t = obj(g.target); return { id: text(g.id), target: {connectorId:text(t.connectorId),contactId:text(t.contactId)}, artifactId:text(g.artifactId),memberEnds:list(g.memberEnds,end) }; });
  const endPreparations = list(r.endPreparations, v => { const p = obj(v); return {id:text(p.id),...end(p),mode:choice(p.mode,endPreparationModes),
    ...(p.artifactId === undefined ? {} : {artifactId:text(p.artifactId)}), ...(p.sealArtifactId === undefined ? {} : {sealArtifactId:text(p.sealArtifactId)}),
    ...(p.stripLengthMm === undefined ? {} : {stripLengthMm:p.stripLengthMm === null ? null : num(p.stripLengthMm)}) }; });
  const twists = list(r.twists, v => { const t=obj(v); return {id:text(t.id),memberWireIds:list(t.memberWireIds,v=>text(v)),segmentIds:list(t.segmentIds,v=>text(v)),pitchMm:t.pitchMm===null?null:num(t.pitchMm,true),direction:choice(t.direction,['left','right'])}; });
  const operations = list(r.operations, v => { const o=obj(v), t=obj(o.target); let target:TerminationOperationTarget;
    switch(t.kind) { case 'wireEnd': target={kind:'wireEnd',...end(t)};break;case 'group':target={kind:'group',groupId:text(t.groupId)};break;
      case 'portSet':target={kind:'portSet',connectorId:text(t.connectorId),contactIds:list(t.contactIds,v=>text(v))};break;
      case 'twist':target={kind:'twist',twistId:text(t.twistId)};break;default:return fail('неизвестная цель операции.'); }
    return {id:text(o.id),kind:choice(o.kind,['strip','tin','crimp','ultrasonic-weld','twist']),target,executionCount:o.executionCount===null?null:num(o.executionCount,true,true),
      ...(o.recipe===undefined?{}:{recipe:binding(o.recipe)}),...(o.processCapacity===undefined?{}:{processCapacity:o.processCapacity===null?null:num(o.processCapacity,true,true)}),
      ...(o.dependsOn===undefined?{}:{dependsOn:list(o.dependsOn,v=>text(v))}),...(o.norm===undefined?{}:{norm:Object.fromEntries(['machineSeconds','humanSeconds','setupSeconds'].map(k=>[k,obj(o.norm)[k]===null?null:num(obj(o.norm)[k])])) as unknown as NonNullable<TerminationOperation['norm']>})}; });
  const result:TerminationDocument={version:1,artifacts,groups,endPreparations,operations,twists};
  unique([...artifacts,...groups,...endPreparations,...operations,...twists].map(x=>x.id));
  const wires=new Map(document.wires.map(w=>[w.id,w]));
  const requireEnd=(e:WireEndRef) => {const w=wires.get(e.wireId);if(!w) return fail('конец ссылается на отсутствующий провод.');return w[e.end];};
  const requireArtifact=(id:string|undefined,kind?:TerminationArtifact['kind'])=>{if(!id)return;const a=artifacts.find(a=>a.id===id);if(!a||kind&&a.kind!==kind)fail('артефакт отсутствует или имеет неверный тип.');};
  unique(groups.flatMap(g=>g.memberEnds.map(wireEndKey)));
  unique(groups.map(g=>JSON.stringify(g.target)));
  for(const g of groups){const c=document.connectors.find(c=>c.id===g.target.connectorId),contact=c?.contacts.find(x=>x.id===g.target.contactId);if(!contact||contact.connectionStatus==='not-connected')fail('контакт группы отсутствует/отключён.');requireArtifact(g.artifactId);if(artifacts.find(a=>a.id===g.artifactId)?.kind==='seal')fail('уплотнитель не является общим контактом.');if(!g.memberEnds.length)fail('пустая группа.');for(const e of g.memberEnds)if(!sameContact(requireEnd(e),g.target))fail('участник группы подключён к другой точке.');}
  for(const g of groups){const component=document.connectors.find(c=>c.id===g.target.connectorId)?.terminationComponent;if(component?.artifactId&&component.artifactId!==g.artifactId)fail('артикул группы должен совпадать с физическим экземпляром компонента оконцовки.');}
  unique(endPreparations.map(wireEndKey));for(const p of endPreparations){requireEnd(p);requireArtifact(p.artifactId,'terminal');requireArtifact(p.sealArtifactId,'seal');if(['cut','copper','tin'].includes(p.mode)&&(p.artifactId||p.sealArtifactId))fail('свободная Разделка не содержит терминал/уплотнитель.');if(!['pin-sealed','socket-sealed'].includes(p.mode)&&p.sealArtifactId)fail('уплотнитель не соответствует режиму.');}
  for(const p of endPreparations)if(p.artifactId){
    const endpoint=requireEnd(p);
    const group=groups.find(g=>g.memberEnds.some(e=>wireEndKey(e)===wireEndKey(p)));
    const component=document.connectors.find(c=>c.id===endpoint.connectorId)?.terminationComponent;
    const sharedArtifact=group?.artifactId??component?.artifactId;
    if(sharedArtifact&&sharedArtifact!==p.artifactId)fail('конец уже имеет общую оконцовку: снимите индивидуальный наконечник перед назначением другой группы или артикула.');
  }
  for(const a of artifacts){
    const owners=document.connectors.filter(c=>c.terminationComponent?.artifactId===a.id);
    const targets=new Set(groups.filter(g=>g.artifactId===a.id).map(g=>JSON.stringify(g.target)));
    for(const p of endPreparations.filter(p=>p.artifactId===a.id)){const e=requireEnd(p);targets.add(JSON.stringify({connectorId:e.connectorId,contactId:e.contactId}));}
    for(const c of owners)for(const p of c.contacts)targets.add(JSON.stringify({connectorId:c.id,contactId:p.id}));
    if(a.kind==='terminal'&&targets.size>1)fail('один экземпляр наконечника нельзя установить на разных контактах.');
    if(a.kind==='sleeve'){
      const connectorIds=new Set(groups.filter(g=>g.artifactId===a.id).map(g=>g.target.connectorId));for(const c of owners)connectorIds.add(c.id);
      if(connectorIds.size>1||[...connectorIds].some(id=>document.connectors.find(c=>c.id===id)?.terminationComponent?.kind!=='sleeve'))fail('одна гильза принадлежит двум портам одного компонента.');
    }
  }
  for(const t of twists){unique(t.memberWireIds);unique(t.segmentIds);if(t.memberWireIds.length<2||t.memberWireIds.some(id=>!wires.has(id)))fail('скрутка требует 2+ существующих провода.');if(!t.segmentIds.length)fail('скрутка требует общий физический участок.');for(const id of t.segmentIds){if(!document.physicalTopology?.segments.some(s=>s.id===id)||t.memberWireIds.some(w=>!document.physicalTopology?.routes.find(r=>r.wireId===w)?.steps.some(s=>s.segmentId===id)))fail('нет общей трассы скрутки.');}}
  unique(twists.flatMap(t=>t.memberWireIds.flatMap(wireId=>t.segmentIds.map(segmentId=>JSON.stringify([wireId,segmentId])))));
  for(const o of operations){const t=o.target;if(t.kind==='wireEnd')requireEnd(t);else if(t.kind==='group'){if(!groups.some(g=>g.id===t.groupId))fail('группа операции отсутствует.');}else if(t.kind==='twist'){if(!twists.some(g=>g.id===t.twistId))fail('скрутка операции отсутствует.');}else{const c=document.connectors.find(c=>c.id===t.connectorId);unique(t.contactIds);if(c?.terminationComponent?.kind!=='sleeve'||!t.contactIds.length||t.contactIds.some(id=>!c.contacts.some(p=>p.id===id)))fail('неверные порты гильзы.');}unique(o.dependsOn??[]);if(o.dependsOn?.some(id=>!operations.some(x=>x.id===id)))fail('зависимость операции отсутствует.');}
  const active=new Set<string>(),done=new Set<string>();const visit=(id:string)=>{if(active.has(id))fail('цикл операций.');if(done.has(id))return;active.add(id);for(const dep of operations.find(o=>o.id===id)?.dependsOn??[])visit(dep);active.delete(id);done.add(id);};for(const o of operations)visit(o.id);
  return result;
}

/** Includes shared contacts and the sleeve A↔B edge, never physical twist/coverings. */
export function connectedTerminationWireIds(document: HarnessDesignDocument, initial: readonly string[]): Set<string> {
  const ids=new Set(initial); let prior=-1;
  while(prior!==ids.size){prior=ids.size;const contacts=new Set<string>(),junctions=new Set<string>(),screens=new Set<string>();
    const key=(e:WireEndpoint)=>JSON.stringify([e.connectorId,e.contactId]);
    for(const w of document.wires.filter(w=>ids.has(w.id)))for(const e of [w.from,w.to]){if(e.junctionId)junctions.add(e.junctionId);else if(e.screenId)screens.add(e.screenId);else{const c=document.connectors.find(c=>c.id===e.connectorId),m=c?.terminationComponent;const free=m?.kind==='preparation'&&['cut','copper','tin'].includes(m.preparationMode??'cut');if(!free&&m?.conductive!==false)contacts.add(key(e));if(m?.kind==='sleeve')for(const p of c!.contacts)contacts.add(key({connectorId:c!.id,contactId:p.id}));}}
    for(const j of document.junctions)if(j.wireIds.some(id=>ids.has(id)))for(const id of j.wireIds)ids.add(id);
    for(const w of document.wires)if([w.from,w.to].some(e=>e.junctionId?junctions.has(e.junctionId):e.screenId?screens.has(e.screenId):contacts.has(key(e))))ids.add(w.id);
  }return ids;
}
/** Individual end overrides win over the component default, including new wires. */
export function effectiveEndPreparation(document:HarnessDesignDocument,ref:WireEndRef):EndPreparation|undefined {
  const explicit=document.terminations?.endPreparations.find(p=>wireEndKey(p)===wireEndKey(ref));if(explicit)return explicit;
  const w=document.wires.find(w=>w.id===ref.wireId);if(!w)return;
  const m=document.connectors.find(c=>c.id===w[ref.end].connectorId)?.terminationComponent;
  if(!m)return;return {id:'inherited:'+wireEndKey(ref),...ref,mode:m.preparationMode??(m.kind==='terminal'?'lug':'cut'),...(m.artifactId?{artifactId:m.artifactId}:{})};
}
export function validateTerminationCircuits(document: HarnessDesignDocument): void {
  const visited=new Set<string>();for(const w of document.wires){if(visited.has(w.id))continue;const ids=connectedTerminationWireIds(document,[w.id]);for(const id of ids)visited.add(id);if(new Set(document.wires.filter(w=>ids.has(w.id)&&w.circuit).map(w=>w.circuit)).size>1)fail('соединённые провода имеют разные цепи.');}
}
export function terminationGroupCompatibility(document:HarnessDesignDocument,group:TerminationGroup):'compatible'|'incompatible'|'unknown'{
  const a=document.terminations?.artifacts.find(a=>a.id===group.artifactId),c=a?.capacity;
  if(!c?.confirmed||!a?.catalogBinding)return 'unknown';
  if(c.minWireCount!==undefined&&group.memberEnds.length<c.minWireCount||c.maxWireCount!==undefined&&group.memberEnds.length>c.maxWireCount)return 'incompatible';
  if(!c.combinations?.length)return 'unknown';
  // The wire binding currently has no verified conductor-material field.
  if(c.combinations.some(x=>x.material))return 'unknown';
  const values=group.memberEnds.map(e=>document.wires.find(w=>w.id===e.wireId));if(values.some(w=>!w?.wireSection||!w.materialBinding?.sectionUnit))return 'unknown';
  const sections=values.map(w=>Number(w!.wireSection!.replace(',','.'))).sort((a,b)=>a-b);if(sections.some(n=>!Number.isFinite(n)))return 'unknown';
  return c.combinations.some(x=>x.unit===values[0]!.materialBinding!.sectionUnit&&values.every(w=>w!.materialBinding!.sectionUnit===x.unit)&&(!x.material||values.every(w=>w!.wireMark===x.material))&&JSON.stringify([...x.sections].sort((a,b)=>a-b))===JSON.stringify(sections))?'compatible':'incompatible';
}
