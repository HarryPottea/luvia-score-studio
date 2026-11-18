// Conservative notation cleanups; never adjust pitches, sounded note durations, or playback timing.
const REST_PAIR_TYPES = new Map([['16th', ['eighth', 4]], ['eighth', ['quarter', 2]]]);

export function findSafeRestPairs({ divisions, beats, beatType, events }) {
  if (!Number.isSafeInteger(divisions) || divisions <= 0 || ![2, 3, 4].includes(beats) || beatType !== 4 || !Array.isArray(events)) return [];
  const annotated = [];
  let position = 0;
  for (const event of events) {
    if (event.kind === 'note' || event.kind === 'rest') {
      if (!Number.isSafeInteger(event.duration) || event.duration <= 0) return [];
      annotated.push({ ...event, start: position });
      position += event.duration;
    } else {
      annotated.push({ ...event, start: position });
    }
  }
  // Pickup, incomplete, or malformed bars require human review; no rewrite.
  if (position !== divisions * beats) return [];
  const matches = [];
  for (let i = 0; i < annotated.length - 1; i++) {
    const first = annotated[i];
    const second = annotated[i + 1];
    if (first.kind !== 'rest' || second.kind !== 'rest' || !first.safeRest || !second.safeRest) continue;
    if (first.type !== second.type || first.duration !== second.duration) continue;
    const rule = REST_PAIR_TYPES.get(first.type);
    if (!rule) continue;
    const [targetType, divisor] = rule;
    const requiredDuration = (divisions * 1) / divisor;
    if (!Number.isSafeInteger(requiredDuration) || first.duration !== requiredDuration) continue;
    const mergedDuration = first.duration * 2;
    // Strict alignment prevents merging a rest across a natural metrical subdivision.
    if (first.start % mergedDuration !== 0) continue;
    matches.push({ firstIndex: first.index, secondIndex: second.index, type: targetType, duration: mergedDuration });
    i++; // Do not produce overlapping pairs within the same pass.
  }
  return matches;
}
