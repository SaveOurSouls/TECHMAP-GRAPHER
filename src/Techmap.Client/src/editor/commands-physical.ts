import { materializePhysicalPath, deletePhysicalBend, editPhysicalBend, carryPhysicalExits } from "./physical-editing";
import { segmentDimensionKey } from "./drawing-dimensions";
import { validateDrawingDocuments } from "./drawing-documents";
import { parsePhysicalTopology } from "./physical-topology-validation";
import {
  editJoiningPipeBend,
  moveJoiningPipe,
  remapJoiningPipeMemberBends,
  removeJoiningPipe,
} from "./physical-joining-pipe-editing";
import { joiningPipePoints, joiningPipeExitVector } from "./physical-joining-pipes";
import { defaultLayerIds, type HarnessDesignDocument } from "./model";
import { physicalNodeLocalPoint } from "./physical-ports";
import { removePhysicalSegment } from "./physical-topology";
import { type EditorCommand } from "./editor-command-types";

export function applyPhysicalCommand(document: HarnessDesignDocument, command: Extract<EditorCommand, { type: "add-visible-pipe-dimension" | "remove-physical-bend" | "edit-physical-bend" | "edit-joining-pipe-bend" | "move-joining-pipe" | "update-joining-pipe-exit" | "update-joining-pipe-member-bend" | "update-joining-pipe-member-boundary" | "clear-joining-pipe-member-boundary" | "update-joining-pipe" | "move-physical-node" | "set-drawing-documents" | "set-physical-topology" | "remove-physical-segment" }>): HarnessDesignDocument {
  switch (command.type) {

    case "add-visible-pipe-dimension": {
      if(document.views.drawing.layers.some(l=>(l.id==="wires"||l.id==="dimensions")&&l.locked))throw new Error("Слой трассы или размеров заблокирован.");
      const changed=materializePhysicalPath(document,command.segmentId);
      const segment=changed.physicalTopology?.segments.find(s=>s.id===command.segmentId);
      if(!segment||segment.path.points.length+2!==command.pointCount)throw new Error("Трасса изменилась. Выберите точки размера заново.");
      const docs=changed.drawingDocuments??{tables:[],leaders:[],bomOrder:[]};
      const dimensions=[...docs.dimensions??[],{id:command.id,segmentId:segment.id,
        from:Math.min(command.from,command.to),to:Math.max(command.from,command.to),
        pointCount:command.pointCount,routeKey:segmentDimensionKey(changed,segment.id),
        mode:command.mode,modeOverride:false,auxiliary:command.auxiliary,offset:40,lengthMm:null}];
      return {...changed,drawingDocuments:validateDrawingDocuments({...docs,showDimensions:true,dimensions},changed)};
    }

    case "remove-physical-bend": {
      if(document.views.drawing.layers.some(l=>l.id==="wires"&&l.locked))throw new Error("Слой проводов заблокирован.");
      const changed=deletePhysicalBend(document,command.segmentId,command.index);
      return {...changed,physicalTopology:parsePhysicalTopology(changed.physicalTopology,changed)};
    }

    case "edit-physical-bend": {
      if(document.views.drawing.layers.some(l=>l.id==="wires"&&l.locked))throw new Error("Слой проводов заблокирован.");
      const changed=editPhysicalBend(document,command.segmentId,command.index,command.position,command.mode,command.insert,command.region,command.displayPosition,command.displayOrigin);
      return {...changed,physicalTopology:parsePhysicalTopology(changed.physicalTopology,changed)};
    }

    case "edit-joining-pipe-bend": {
      if(document.views.drawing.layers.some(l=>l.id==="wires"&&l.locked))throw new Error("Слой трассы заблокирован.");
      if(!document.physicalTopology)return document;
      return {...document,physicalTopology:parsePhysicalTopology(editJoiningPipeBend(document,command.pipeId,command.index,command.position,command.mode,command.insert,command.remove),document)};
    }

    case "move-joining-pipe": {
      if(document.views.drawing.layers.some(l=>l.id==="wires"&&l.locked))throw new Error("Слой трассы заблокирован.");
      const t=document.physicalTopology;if(!t)return document;
      return {...document,physicalTopology:parsePhysicalTopology(moveJoiningPipe(t,command.pipeId,command.delta),document)};
    }

    case "update-joining-pipe-exit": {
      if(document.views.drawing.layers.some(l=>l.id==="wires"&&l.locked))throw new Error("Слой трассы заблокирован.");
      const t=document.physicalTopology,pipe=t?.joiningPipes?.find(p=>p.id===command.pipeId);if(!t||!pipe)return document;
      const axis=joiningPipePoints(pipe),edge=command.side==="from"?axis[0]!:axis.at(-1)!;
      const vector=joiningPipeExitVector(pipe,command.side);
      const length=Math.max(0,Math.min(1e7,(command.position.x-edge.x)*vector.x+(command.position.y-edge.y)*vector.y));
      if(!Number.isFinite(length))throw new Error("Некорректная длина выхода ОП.");
      const key=command.side==="from"?"enterLength":"exitLength";
      return {...document,physicalTopology:parsePhysicalTopology({...t,joiningPipes:t.joiningPipes?.map(p=>p.id===pipe.id?{...p,[key]:length}:p)},document)};
    }

    case "update-joining-pipe-member-bend": {
      if(document.views.drawing.layers.some(l=>l.id==="wires"&&l.locked))throw new Error("Слой трассы заблокирован.");
      const t=document.physicalTopology;if(!t)return document;
      const pipe=t.joiningPipes?.find(p=>p.id===command.pipeId);if(!pipe||!pipe.members[command.memberIndex])return document;
      if(!command.clear&&(!command.position||!Number.isFinite(command.position.x)||!Number.isFinite(command.position.y)))throw new Error("Некорректное положение ручки перехода.");
      const members=pipe.members.map((member,index)=>{
        if(index!==command.memberIndex)return member;
        const bendKey=command.side==="enter"?"enterBend":"exitBend";
        const outerKey=command.side==="enter"?"enterOuter":"exitOuter";
        if(command.clear)return {...member,[bendKey]:null};
        if(command.mode==="carry"){
          const previous=member[bendKey]??command.origin;
          const outer=member[outerKey]??command.outerOrigin;
          if(previous&&outer)return {...member,[bendKey]:command.position,[outerKey]:{
            x:outer.x+command.position!.x-previous.x,y:outer.y+command.position!.y-previous.y,
          }};
        }
        return {...member,[bendKey]:command.position};
      });
      return {...document,physicalTopology:parsePhysicalTopology({...t,joiningPipes:t.joiningPipes?.map(p=>p.id===pipe.id?{...p,members}:p)},document)};
    }

    case "update-joining-pipe-member-boundary": {
      if(document.views.drawing.layers.some(l=>l.id==="wires"&&l.locked))throw new Error("Слой трассы заблокирован.");
      const t=document.physicalTopology,pipe=t?.joiningPipes?.find(p=>p.id===command.pipeId);if(!t||!pipe||!pipe.members[command.memberIndex])return document;
      if(!Number.isFinite(command.position.x)||!Number.isFinite(command.position.y))throw new Error("Некорректное положение точки перегиба.");
      const {boundary,position,origin}=command;
      if(boundary==="axisEnter"||boundary==="axisExit"){
        const key=boundary==="axisEnter"?"start":"end",delta={x:position.x-origin.x,y:position.y-origin.y};
        const changed={...pipe,[key]:{x:pipe[key].x+delta.x,y:pipe[key].y+delta.y}};
        const remapped={...changed,members:remapJoiningPipeMemberBends(pipe,changed)};
        return {...document,physicalTopology:parsePhysicalTopology({...t,joiningPipes:t.joiningPipes?.map(p=>p.id===pipe.id?remapped:p)},document)};
      }
      const key=boundary==="outerEnter"?"enterOuter":"exitOuter";
      const members=pipe.members.map((member,index)=>index===command.memberIndex?{...member,[key]:position}:member);
      return {...document,physicalTopology:parsePhysicalTopology({...t,joiningPipes:t.joiningPipes?.map(p=>p.id===pipe.id?{...p,members}:p)},document)};
    }

    case "clear-joining-pipe-member-boundary": {
      if(document.views.drawing.layers.some(l=>l.id==="wires"&&l.locked))throw new Error("Слой трассы заблокирован.");
      const t=document.physicalTopology,pipe=t?.joiningPipes?.find(p=>p.id===command.pipeId);
      if(!t||!pipe||!pipe.members[command.memberIndex])return document;
      const key=command.boundary==="outerEnter"?"enterOuter":"exitOuter";
      const members=pipe.members.map((member,index)=>index===command.memberIndex?{...member,[key]:undefined}:member);
      return {...document,physicalTopology:parsePhysicalTopology({...t,joiningPipes:t.joiningPipes?.map(p=>p.id===pipe.id?{...p,members}:p)},document)};
    }

    case "update-joining-pipe": {
      if(document.views.drawing.layers.some(l=>l.id==="wires"&&l.locked))throw new Error("Слой трассы заблокирован.");
      const t=document.physicalTopology;if(!t)return document;
      const next=t.joiningPipes?.map(p=>{
        if(p.id!==command.pipeId)return p;
        const changed={...p,...(command.start!==undefined?{start:command.start}:{}),...(command.end!==undefined?{end:command.end}:{}),...(command.mode!==undefined?{mode:command.mode}:{}),...(command.width!==undefined?{width:command.width}:{}),...(command.color!==undefined?{color:command.color}:{}),...(command.opacity!==undefined?{opacity:command.opacity}:{}),...(command.volumeShading!==undefined?{volumeShading:command.volumeShading}:{})};
        return command.start!==undefined||command.end!==undefined?{...changed,members:remapJoiningPipeMemberBends(p,changed)}:changed;
      });
      return {...document,physicalTopology:parsePhysicalTopology({...t,joiningPipes:next},document)};
    }

    case "move-physical-node": {
      if(document.views.drawing.layers.some(l=>(l.id==="wires"||l.id===defaultLayerIds.connectionPoints)&&l.locked))throw new Error("Слой трассы заблокирован.");
      const t=document.physicalTopology,node=t?.nodes.find(n=>n.id===command.nodeId);if(!t||!node)return document;
      const changed={...document,physicalTopology:{...t,nodes:t.nodes.map(n=>n.id===node.id?{...n,position:physicalNodeLocalPoint(document,n,command.position)}:n)}};
      const result=carryPhysicalExits(document,changed,new Set([node.id]),command.mode);
      return {...result,physicalTopology:parsePhysicalTopology(result.physicalTopology,result)};
    }

    case "set-drawing-documents":
      if(document.views.drawing.layers.some(l=>l.id==="dimensions"&&l.locked)) throw new Error("Слой размеров заблокирован.");
      return {...document,drawingDocuments:validateDrawingDocuments(command.documents,document)};

    case "set-physical-topology":
      if (document.views.drawing.layers.some(layer => layer.id === "wires" && layer.locked)) throw new Error("Слой проводов заблокирован.");
      return { ...document, ...(command.coveringLibrary?{drawingDocuments:validateDrawingDocuments({...document.drawingDocuments??{tables:[],leaders:[],bomOrder:[]},coveringLibrary:command.coveringLibrary},document)}:{}), physicalTopology: parsePhysicalTopology(command.topology, document) };

    case "remove-physical-segment":
      if (document.views.drawing.layers.some(layer => layer.id === "wires" && layer.locked)) throw new Error("Слой проводов заблокирован.");
      if(document.physicalTopology?.joiningPipes?.some(p=>p.id===command.segmentId))return {...document,physicalTopology:removeJoiningPipe(document.physicalTopology,command.segmentId)};
      return { ...document, physicalTopology: parsePhysicalTopology(removePhysicalSegment(document, command.segmentId), document) };
  }
}
