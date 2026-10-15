import type { HarnessDesignDocument } from './model';
import { emptyTerminationDocument, parseTerminationComponent, parseTerminationDocument, sameContact, usedTerminationArtifactIds, validateTerminationComponents, validateTerminationCircuits, wireEndKey, type EndPreparation, type PhysicalTwistGroup, type TerminationArtifact, type TerminationComponent, type TerminationDocument, type TerminationGroup, type TerminationOperation } from './termination-model';

export type TerminationCommand =
  | { readonly type:'add-termination-component'; readonly connector:HarnessDesignDocument['connectors'][number]; readonly artifact?:TerminationArtifact }
  | { readonly type:'set-termination-component'; readonly connectorId:string; readonly component:TerminationComponent;readonly artifact?:TerminationArtifact }
  | { readonly type:'set-termination-document'; readonly terminations:TerminationDocument|null }
  | { readonly type:'upsert-termination-artifact'; readonly artifact:TerminationArtifact }
  | { readonly type:'remove-termination-artifact'; readonly artifactId:string }
  | { readonly type:'upsert-termination-group'; readonly group:TerminationGroup }
  | { readonly type:'remove-termination-group'; readonly groupId:string }
  | { readonly type:'set-end-preparation'; readonly preparation:EndPreparation }
  | { readonly type:'remove-end-preparation'; readonly wireId:string; readonly end:'from'|'to' }
  | { readonly type:'upsert-termination-operation'; readonly operation:TerminationOperation }
  | { readonly type:'remove-termination-operation'; readonly operationId:string }
  | { readonly type:'upsert-physical-twist'; readonly twist:PhysicalTwistGroup }
  | { readonly type:'remove-physical-twist'; readonly twistId:string };
export const isTerminationCommand = (command:{type:string}):command is TerminationCommand => ['add-termination-component','set-termination-component','set-termination-document','upsert-termination-artifact','remove-termination-artifact','upsert-termination-group','remove-termination-group','set-end-preparation','remove-end-preparation','upsert-termination-operation','remove-termination-operation','upsert-physical-twist','remove-physical-twist'].includes(command.type);
const upsert=<T extends {id:string}>(rows:readonly T[],row:T):readonly T[]=>rows.some(x=>x.id===row.id)?rows.map(x=>x.id===row.id?row:x):[...rows,row];

/** Parse the complete candidate before returning: failure cannot mutate the original. */
export function applyTerminationCommand(document:HarnessDesignDocument,command:TerminationCommand):HarnessDesignDocument {
  let candidate=document;
  let t=document.terminations??emptyTerminationDocument();
  switch(command.type){
    case 'add-termination-component':{
      if(document.connectors.some(c=>c.id===command.connector.id)||!command.connector.terminationComponent)throw new Error('Неверный или повторный компонент оконцовки.');
      if(command.artifact)t={...t,artifacts:upsert(t.artifacts,command.artifact)};
      candidate={...document,connectors:[...document.connectors,command.connector]};break;
    }
    case 'set-termination-component':{
      if(!document.connectors.some(c=>c.id===command.connectorId))throw new Error('Компонент оконцовки отсутствует.');
      let component=parseTerminationComponent(command.component);
      if(command.artifact)t={...t,artifacts:upsert(t.artifacts,command.artifact)};
      const previous=document.connectors.find(c=>c.id===command.connectorId)?.terminationComponent;
      const old=previous?.artifactId;
      const modeChanged=previous?.preparationMode!==component.preparationMode;
      const bare=component.kind==='preparation'&&['cut','copper','tin'].includes(component.preparationMode??'cut');
      if(component.kind==='preparation'&&(bare||modeChanged&&component.preparationMode!=='lug'&&!command.artifact)){
        const {artifactId:_artifact,catalogBinding:_binding,color:_color,...point}=component;component=point;
        t=pruneOperationTargets({...t,groups:t.groups.filter(g=>g.target.connectorId!==command.connectorId)},document);
      }
      candidate={...document,connectors:document.connectors.map(c=>c.id===command.connectorId?{...c,terminationComponent:component}:c)};
      if(old&&old!==component.artifactId&&component.artifactId){
        t={...t,groups:t.groups.map(g=>g.target.connectorId===command.connectorId&&g.artifactId===old?{...g,artifactId:component.artifactId!}:g),endPreparations:t.endPreparations.map(p=>document.wires.some(w=>w.id===p.wireId&&w[p.end].connectorId===command.connectorId)&&p.artifactId===old?{...p,artifactId:component.artifactId!}:p)};
        const used=usedTerminationArtifactIds({...candidate,terminations:t});if(!used.has(old))t={...t,artifacts:t.artifacts.filter(a=>a.id!==old)};
      }
      break;
    }
    case 'set-termination-document':{
      if(command.terminations===null){const {terminations:_removed,...rest}=document;validateTerminationComponents(rest);return rest;}
      t=command.terminations;break;
    }
    case 'upsert-termination-artifact':t={...t,artifacts:upsert(t.artifacts,command.artifact)};break;
    case 'remove-termination-artifact':t={...t,artifacts:t.artifacts.filter(a=>a.id!==command.artifactId)};break;
    case 'upsert-termination-group':t={...t,groups:upsert(t.groups,command.group)};break;
    case 'remove-termination-group':t=pruneOperationTargets({...t,groups:t.groups.filter(g=>g.id!==command.groupId)},document);break;
    case 'set-end-preparation':t={...t,endPreparations:upsert(t.endPreparations.filter(p=>wireEndKey(p)!==wireEndKey(command.preparation)),command.preparation)};break;
    case 'remove-end-preparation':t={...t,endPreparations:t.endPreparations.filter(p=>wireEndKey(p)!==wireEndKey(command))};break;
    case 'upsert-termination-operation':t={...t,operations:upsert(t.operations,command.operation)};break;
    case 'remove-termination-operation':t={...t,operations:t.operations.filter(o=>o.id!==command.operationId).map(o=>({...o,dependsOn:o.dependsOn?.filter(id=>id!==command.operationId)}))};break;
    case 'upsert-physical-twist':t={...t,twists:upsert(t.twists,command.twist)};break;
    case 'remove-physical-twist':t=pruneOperationTargets({...t,twists:t.twists.filter(g=>g.id!==command.twistId)},document);break;
  }
  // A group article choice replaces the physical component instance as well;
  // never leave both its old material and the newly chosen group material used.
  if(command.type==='set-termination-document'||command.type==='upsert-termination-group'){
    const connectors=candidate.connectors.map(c=>{
      const m=c.terminationComponent;if(!m||m.kind==='sleeve')return c;
      const g=t.groups.find(g=>g.target.connectorId===c.id);
      if(!g||g.artifactId===m.artifactId)return c;
      const a=t.artifacts.find(a=>a.id===g.artifactId);if(!a||a.kind!=='terminal')return c;
      const old=m.artifactId;
      if(old)t={...t,endPreparations:t.endPreparations.map(p=>p.artifactId===old&&candidate.wires.some(w=>w.id===p.wireId&&w[p.end].connectorId===c.id)?{...p,artifactId:a.id}:p)};
      const preparationMode=m.preparationMode&&!['cut','copper','tin'].includes(m.preparationMode)?m.preparationMode:'lug';
      return {...c,terminationComponent:{...m,artifactId:a.id,symbolId:m.kind==='preparation'?m.symbolId:a.symbolId,...(m.kind==='preparation'?{preparationMode}:{}),catalogBinding:a.catalogBinding,color:a.color}};
    });
    candidate={...candidate,connectors};
  }
  const priorUsed=usedTerminationArtifactIds(document),used=usedTerminationArtifactIds({...candidate,terminations:t});
  t={...t,artifacts:t.artifacts.filter(a=>!priorUsed.has(a.id)||used.has(a.id))};
  const result={...candidate,terminations:parseTerminationDocument(t,candidate),requiredWriterContractVersion:3 as const};
  validateTerminationComponents(result);validateTerminationCircuits(result);return result;
}

function pruneOperationTargets(t:TerminationDocument,d:HarnessDesignDocument):TerminationDocument {
  const operations=t.operations.filter(o=>{const v=o.target;return v.kind==='group'?t.groups.some(g=>g.id===v.groupId):v.kind==='twist'?t.twists.some(g=>g.id===v.twistId):v.kind==='wireEnd'?d.wires.some(w=>w.id===v.wireId):d.connectors.some(c=>c.id===v.connectorId&&v.contactIds.every(id=>c.contacts.some(p=>p.id===id)));});
  const ids=new Set(operations.map(o=>o.id));return {...t,operations:operations.map(o=>({...o,dependsOn:o.dependsOn?.filter(id=>ids.has(id))}))};
}
/** Deleting/reconnecting source objects removes only their invalid memberships. */
export function reconcileTerminationReferences(document:HarnessDesignDocument):HarnessDesignDocument {
  if(!document.terminations){validateTerminationComponents(document);return document.connectors.some(c=>c.terminationComponent)?{...document,requiredWriterContractVersion:3}:document;}
  const t=document.terminations;
  const wires=new Map(document.wires.map(w=>[w.id,w]));
  const groups=t.groups.map(g=>({...g,memberEnds:g.memberEnds.filter(e=>{const w=wires.get(e.wireId);return w&&sameContact(w[e.end],g.target);})})).filter(g=>g.memberEnds.length&&document.connectors.some(c=>c.id===g.target.connectorId&&c.contacts.some(p=>p.id===g.target.contactId)));
  const endPreparations=t.endPreparations.filter(p=>wires.has(p.wireId));
  const twists=t.twists.map(g=>({...g,memberWireIds:g.memberWireIds.filter(id=>wires.has(id))})).filter(g=>g.memberWireIds.length>=2&&g.segmentIds.every(id=>document.physicalTopology?.segments.some(s=>s.id===id)&&g.memberWireIds.every(w=>document.physicalTopology?.routes.find(r=>r.wireId===w)?.steps.some(s=>s.segmentId===id))));
  const candidate={...document,terminations:pruneOperationTargets({...t,groups,endPreparations,twists},document),requiredWriterContractVersion:3 as const};
  return {...candidate,terminations:parseTerminationDocument(candidate.terminations,candidate)};
}
