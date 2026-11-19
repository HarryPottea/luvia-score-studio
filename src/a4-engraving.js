// Single source of truth for A4 engraving and fixed physical staff heights.
// A4 dimensions are ISO 216; 96 CSS pixels = 25.4 mm in paged CSS/PDF mapping.
// OSMD uses 10px per staff space at zoom=1 and four spaces per five-line staff.
// Do not tie the print zoom to viewport width, devicePixelRatio or browser pinch zoom.
const PX_PER_MM = 96 / 25.4;
const STAFF_SPACES = 4;
const PX_PER_SPACE_AT_ZOOM_1 = 10;
export const A4_FORMATS = Object.freeze({
  A4_P: Object.freeze({widthMm:210,heightMm:297}),
  A4_L: Object.freeze({widthMm:297,heightMm:210}),
});
export const PRINT_MARGIN_MM = 12;

const children = (parent,tag)=>parent?.children
  ? Array.from(parent.children).filter(child=>child.localName===tag)
  : [];
function staffCount(part) {
  let count=1;
  for(const measure of children(part,'measure')) {
    for(const attributes of children(measure,'attributes')) {
      const declared=children(attributes,'staves')[0];
      const number=declared && Number(declared.textContent);
      if(Number.isInteger(number)&&number>0)count=Math.max(count,number);
    }
    for(const note of children(measure,'note')) {
      const staff=children(note,'staff')[0];
      const number=staff && Number(staff.textContent);
      if(Number.isInteger(number)&&number>0)count=Math.max(count,number);
    }
  }
  return Math.min(count,16);
}
export function recommendStaffHeightMm(doc) {
  const parts=children(doc?.documentElement,'part');
  const staves=parts.reduce((sum,part)=>sum+staffCount(part),0);
  // 7 mm for a single melodic staff (standard part).
  // 6.5 mm for piano or small multi-staff scores.
  // 5.8 mm for larger scores; do not squeeze past safe reading sizes.
  return staves>=5 ? 5.8 : staves>=2 ? 6.5 : 7;
}
export function fixedA4Profile(doc,pageFormat='A4_P') {
  const page=A4_FORMATS[pageFormat];
  if(!page)throw new Error('A4 세로 또는 가로 형식만 지원합니다.');
  const staffHeightMm=recommendStaffHeightMm(doc);
  const zoom=(staffHeightMm*PX_PER_MM)/(PX_PER_SPACE_AT_ZOOM_1*STAFF_SPACES);
  const marginInUnits=PRINT_MARGIN_MM*PX_PER_MM/(PX_PER_SPACE_AT_ZOOM_1*zoom);
  return Object.freeze({
    pageFormat,
    widthMm:page.widthMm,heightMm:page.heightMm,
    pageWidthPx:page.widthMm*PX_PER_MM,pageHeightPx:page.heightMm*PX_PER_MM,
    marginMm:PRINT_MARGIN_MM,staffHeightMm,
    zoom,marginInUnits,
  });
}
export function applyFixedA4Profile(osmd,doc,pageFormat='A4_P') {
  const profile=fixedA4Profile(doc,pageFormat);
  const rules=osmd?.EngravingRules;
  if(!rules)throw new Error('A4 조판 규칙을 설정할 수 없습니다.');
  osmd.zoom=profile.zoom;
  rules.PageLeftMargin=profile.marginInUnits;
  rules.PageRightMargin=profile.marginInUnits;
  rules.PageTopMargin=profile.marginInUnits;
  rules.PageBottomMargin=profile.marginInUnits;
  return profile;
}
