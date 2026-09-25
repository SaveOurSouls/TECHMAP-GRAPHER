import {expect,it,vi} from 'vitest';
import {createElement,isValidElement,type ReactNode,type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beginPipeBundle,togglePipeBundleMember,pipeBundleDraftTopology,pipeBundleDraftHighlights,PipeBundleEditor} from './PipeBundleEditor';
import {physicalFixture} from './physical-topology-fixture';
import {createEditorHistory,executeEditorCommand,undoEditorCommand} from './history';
import {parseHarnessDesignDocument} from './model';

function fixture(){const d=physicalFixture();return {...d,physicalTopology:{...d.physicalTopology!,coverings:[{id:'wrap',name:'Термоусадка',width:0,color:'#112233',lengthMm:null,spans:[{segmentId:'S0',from:.2,to:.8}]}]}};}
function elements(node:ReactNode):ReactElement<Record<string,any>>[]{return Array.isArray(node)?node.flatMap(elements):isValidElement<Record<string,any>>(node)?[node,...elements(node.props.children)]:[];}
it('keeps selection drafts outside the document, saves once and undoes the entire group',()=>{
 const d=fixture(),before=JSON.stringify(d),t=d.physicalTopology;
 const draft=togglePipeBundleMember(t,beginPipeBundle(t,'wrap')!,'S1');
 expect(JSON.stringify(d)).toBe(before);
 expect(pipeBundleDraftHighlights(t,draft)).toEqual(['wrap','S0','S1']);
 const h=executeEditorCommand(createEditorHistory(d),{type:'set-physical-topology',topology:pipeBundleDraftTopology(t,draft)});
 expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(h.present))).physicalTopology!.coverings![0]!.bundle).toEqual(draft.bundle);
 expect(h.present.wires).toBe(d.wires);expect(h.present.physicalTopology!.routes).toEqual(t.routes);
 expect(undoEditorCommand(h).present).toBe(d);
});
it('requires the supporting pipe and two distinct members, rejects cycles and overlapping nested leaves',()=>{
 const d=fixture(),t=d.physicalTopology,initial=beginPipeBundle(t,'wrap')!;
 expect(()=>pipeBundleDraftTopology(t,initial)).toThrow();
 const valid=togglePipeBundleMember(t,initial,'S1');
 const removed=togglePipeBundleMember(t,togglePipeBundleMember(t,valid,'S0'),'S2');
 expect(()=>pipeBundleDraftTopology(t,removed)).toThrow();
 const grouped=pipeBundleDraftTopology(t,valid);
 const outer={...t.coverings[0]!,id:'outer'};
 const next={...grouped,coverings:[...grouped.coverings!,outer]};
 let draft=beginPipeBundle(next,'outer')!;
 draft=togglePipeBundleMember(next,draft,'wrap');
 expect(()=>pipeBundleDraftTopology(next,draft)).toThrow();
 draft=togglePipeBundleMember(next,draft,'S0');draft=togglePipeBundleMember(next,draft,'S2');
 expect(pipeBundleDraftHighlights(next,draft)).toEqual(['outer','wrap','S0','S1','S2']);
 const nested=pipeBundleDraftTopology(next,draft);
 expect(()=>pipeBundleDraftTopology(nested,togglePipeBundleMember(nested,beginPipeBundle(nested,'wrap')!,'outer'))).toThrow();
});
it('exposes concise controls, disabled invalid save, cancellation and all candidates',()=>{
 const t=fixture().physicalTopology,draft=beginPipeBundle(t,'wrap')!,save=vi.fn(),cancel=vi.fn(),change=vi.fn();
 const props={topology:t,draft,onChange:change,onSave:save,onCancel:cancel};
 const tree=PipeBundleEditor(props),controls=elements(tree);
 expect(controls.find(e=>e.type==='button'&&e.props.children==='Сохранить')!.props.disabled).toBe(true);
 controls.find(e=>e.type==='select'&&e.props['aria-label']==='Добавить участника группы')!.props.onChange({target:{value:'S1'}});
 const valid=change.mock.calls[0]![0];
 const ready=elements(PipeBundleEditor({...props,draft:valid})).find(e=>e.type==='button'&&e.props.children==='Сохранить')!;
 expect(ready.props.disabled).toBe(false);ready.props.onClick();expect(save).toHaveBeenCalledOnce();
 controls.find(e=>e.type==='button'&&e.props.children==='Отмена')!.props.onClick();expect(cancel).toHaveBeenCalledOnce();
 const html=renderToStaticMarkup(createElement(PipeBundleEditor,props));
 expect(html).toContain('Объёмная');expect(html).toContain('Плоская');expect(html).toContain('Состав группы');
});
