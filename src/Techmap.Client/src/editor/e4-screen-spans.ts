type Point = { readonly x: number; readonly y: number };
type Orientation = "horizontal" | "vertical";
interface Segment { readonly index:number; readonly start:Point; readonly end:Point; readonly orientation:Orientation }
export interface ScreenCrossSection {
  readonly orientation:Orientation;
  readonly start:number;
  readonly end:number;
  readonly crossMinimum:number;
  readonly crossMaximum:number;
  readonly firstWireDirection:1|-1;
  readonly routeIndex:number;
  readonly segmentByWireId:Readonly<Record<string,Segment>>;
}

/** Sweep every route at the same X, independently of its bend indices.
 * A shield stays upright through staggered bends. Pure vertical bundles retain
 * their perpendicular shield as a fallback. Neither case modifies a route.
 */
export function screenCrossSections(paths:readonly {id:string;points:readonly Point[]}[]):ScreenCrossSection[] {
  if(!paths.length)return [];
  for(const orientation of ["horizontal","vertical"] as const){
    const along=(p:Point)=>orientation==="horizontal"?p.x:p.y;
    const cross=(p:Point)=>orientation==="horizontal"?p.y:p.x;
    const lists=paths.map(path=>path.points.slice(1).flatMap((end,index)=>{
      const start=path.points[index]!;
      return cross(start)===cross(end)&&along(start)!==along(end)?[{index,start,end,orientation}]:[];
    }));
    if(lists.some(list=>!list.length))continue;
    const breaks=[...new Set(lists.flatMap(list=>list.flatMap(s=>[along(s.start),along(s.end)])))].sort((a,b)=>a-b);
    const direction=along(lists[0]![0]!.end)>along(lists[0]![0]!.start)?1:-1;
    const spans:ScreenCrossSection[]=[];
    for(let i=1;i<breaks.length;i++){
      const start=breaks[i-1]!,end=breaks[i]!,middle=(start+end)/2;
      const selected=lists.map(list=>list.filter(s=>Math.min(along(s.start),along(s.end))<middle&&Math.max(along(s.start),along(s.end))>middle));
      if(selected.some(list=>!list.length))continue;
      const crosses=selected.flatMap(list=>list.map(s=>cross(s.start)));
      spans.push({orientation,start,end,crossMinimum:Math.min(...crosses),crossMaximum:Math.max(...crosses),firstWireDirection:direction,routeIndex:0,
        segmentByWireId:Object.fromEntries(paths.map((path,index)=>[path.id,selected[index]![0]!]))});
    }
    if(spans.length)return spans.sort((a,b)=>direction*(a.start-b.start));
  }
  return [];
}
