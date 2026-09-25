export interface WidthSample { readonly at: number; readonly halfWidth: number }

/** Envelop a stepped support with short ramps on the thinner side. Both ends
 * of every ramp are explicit: flat / diagonal / flat, never one long taper.
 * `at` is distance along the pipe, not manufacturing length. */
export function coveringWidthProfile(
  from: number, to: number, boundaries: readonly number[], halfAt: (at: number) => number,
): readonly WidthSample[] {
  if (to <= from) return [];
  const stops = [...new Set([from, ...boundaries.filter(n => n > from && n < to), to])].sort((a,b) => a-b);
  const widths = stops.slice(1).map((end,i) => halfAt((stops[i]! + end)/2));
  const result: WidthSample[] = [{ at: from, halfWidth: widths[0]! }];
  for (let i=1; i<stops.length-1; i++) {
    const at=stops[i]!, before=widths[i-1]!, after=widths[i]!;
    if (Math.abs(after-before)<1e-9) continue;
    // A steep ramp (at least 2:1 radial/axial), capped before neighbouring ramps.
    const run=Math.min(Math.abs(after-before)/2,(at-stops[i-1]!)/4,(stops[i+1]!-at)/4);
    result.push({at:after>before?at-run:at,halfWidth:before});
    result.push({at:after>before?at:at+run,halfWidth:after});
  }
  result.push({ at: to, halfWidth: widths.at(-1)! });
  return result;
}

export function profileHalfWidth(profile: readonly WidthSample[], at: number): number {
  if (!profile.length) return 0;
  const i=profile.findIndex(p=>p.at>=at);
  if(i===0)return profile[0]!.halfWidth;
  if(i<0)return profile.at(-1)!.halfWidth;
  const a=profile[i-1]!,b=profile[i]!;
  return a.halfWidth+(b.halfWidth-a.halfWidth)*(at-a.at)/(b.at-a.at);
}
