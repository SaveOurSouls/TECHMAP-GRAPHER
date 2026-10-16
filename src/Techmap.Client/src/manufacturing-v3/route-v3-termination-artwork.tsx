import type {HarnessDesignDocument} from '../editor/model';
import type {RouteSourceRef,RouteSourceItem} from '../manufacturing/route-source';
import {TerminationSymbol} from '../termination-library/TerminationSymbol';
import {RouteSourceArtwork} from '../manufacturing/RouteSourceArtwork';

export function RouteV3SourceArtwork(props:{document:HarnessDesignDocument;ref:RouteSourceRef;item?:RouteSourceItem;textureUrls?:Readonly<Record<string,string>>}){
  const a=props.ref.kind==='termination-artifact'?props.document.terminations?.artifacts.find(a=>a.id===props.ref.id):undefined;
  return a?<span className="route-v3-termination-artifact"><TerminationSymbol selection={{symbolId:a.symbolId,color:a.color}} width={220} height={100} alt={a.article||'Оконцовка'}/><small>{a.article}</small></span>:<RouteSourceArtwork {...props}/>;
}
