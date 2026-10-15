import type {TerminationView,TerminationLibraryRecord} from './catalog';
import {getTerminationSymbol,type TerminationSymbolSelection} from './symbol';
export function TerminationSymbol({record,selection,view='drawing',width=220,height=100,className,alt}:{readonly record?:TerminationLibraryRecord;readonly selection?:TerminationSymbolSelection;readonly view?:TerminationView;readonly width?:number;readonly height?:number;readonly className?:string;readonly alt?:string}){
 const value=record??selection??{},symbol=getTerminationSymbol(value,view);
 return symbol?<img className={className} src={symbol.href} alt={alt??record?.name??symbol.assetId} width={width} height={height} draggable={false}/>:<span className={className} role="img" aria-label="Неизвестный символ оконцовки">?</span>;
}
