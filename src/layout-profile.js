// Conservative output profiles for OpenSheetMusicDisplay engraving rules.
export const LAYOUT_PRESETS = ['auto','standard','comfortable','compact'];
const elements = (n, tag) => n ? [...n.children].filter(c=>c.localName===tag) : [];
export function suggestLayout(doc) {
  const parts = elements(doc?.documentElement,'part');
  let lyrics=0, notes=0;
  for (const part of parts) for (const measure of elements(part,'measure')) for (const note of elements(measure,'note')) {
    notes++; if (elements(note,'lyric').length) lyrics++;
  }
  const reason = lyrics ? '가사 음표가 있어 여유 있는 보표 간격 권장' : parts.length>4 ? '악기 수가 많아 가로·세로 밀도 검토 권장' : '일반 악보 기본 간격 권장';
  const preset = lyrics ? 'comfortable' : parts.length>4 ? 'compact' : 'standard';
  return { preset, reason, parts:parts.length,notes,lyrics };
}
export function resolveLayoutPreset(value, doc) {
  if (!LAYOUT_PRESETS.includes(value)) throw new Error('지원하지 않는 레이아웃 설정입니다.');
  return value === 'auto' ? suggestLayout(doc).preset : value;
}
export function applyLayoutPreset(osmd, value, doc) {
  const preset=resolveLayoutPreset(value,doc);
  const rules=osmd.EngravingRules;
  if (!rules) throw new Error('악보 간격 설정을 사용할 수 없습니다.');
  // Modest factors avoid forced collisions; OSMD retains collision avoidance rules.
  const factor = preset==='comfortable' ? 1.16 : preset==='compact' ? 0.94 : 1;
  for (const prop of ['MinimumDistanceBetweenSystems','StaffDistance','BetweenStaffDistance']) {
    const base = rules[prop];
    if (typeof base==='number' && Number.isFinite(base) && base>0) rules[prop]=base*factor;
  }
  return preset;
}
