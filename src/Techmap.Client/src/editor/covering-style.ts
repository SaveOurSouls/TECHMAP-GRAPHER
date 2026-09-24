import type { CoveringKind } from "./physical-coverings";

export const coveringTextureOptions = ["auto", "none", "Rubber002", "Fabric061", "Metal049A"] as const;
export const coveringHatchOptions = ["none", "parallel", "cross", "dots"] as const;
export interface CoveringStyle {
  readonly texture?: typeof coveringTextureOptions[number];
  readonly textureScale?: number;
  readonly textureRotation?: number;
  readonly hatch?: typeof coveringHatchOptions[number];
  readonly hatchColor?: string;
  readonly hatchSpacing?: number;
  readonly hatchRotation?: number;
  readonly lineColor?: string;
}
export const defaultCoveringStyle: Required<CoveringStyle> = {
  texture:"auto", textureScale:1, textureRotation:0, hatch:"none",
  hatchColor:"#34434e", hatchSpacing:8, hatchRotation:45, lineColor:"#34434e",
};
export const resolvedCoveringStyle=(style?:CoveringStyle):Required<CoveringStyle>=>({...defaultCoveringStyle,...style});
const files:Record<CoveringKind,string>={"heat-shrink":"Rubber002",nylon:"Fabric061",braid:"Fabric061","metal-braid":"Metal049A",tape:"Rubber002",band:"Fabric061"};
export function coveringTextureFile(kind:CoveringKind,style?:CoveringStyle):string|null {
  const value=style?.texture??"auto";return value==="none"?null:value==="auto"?files[kind]:value;
}
export function validCoveringStyle(value:unknown):value is CoveringStyle {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const s=value as CoveringStyle;
  if(s.texture!==undefined&&!coveringTextureOptions.includes(s.texture)||s.hatch!==undefined&&!coveringHatchOptions.includes(s.hatch))return false;
  for(const key of ["hatchColor","lineColor"] as const)if(s[key]!==undefined&&(typeof s[key]!=="string"||!/^#[\da-f]{6}$/i.test(s[key])))return false;
  return ([['textureScale',.1,10],['textureRotation',-180,180],['hatchSpacing',1,100],['hatchRotation',-180,180]] as const)
    .every(([key,min,max])=>s[key]===undefined||typeof s[key]==="number"&&Number.isFinite(s[key])&&s[key]>=min&&s[key]<=max);
}
