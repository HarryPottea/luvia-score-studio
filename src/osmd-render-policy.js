// Always show individual source measures while authoring or printing part scores.
// OSMD otherwise condenses consecutive rest-only measures into a multi-measure rest
// when other instruments are hidden, making a changed bar count appear unchanged.
// This disables only automatic condensation; explicit MusicXML multirests are preserved.
export function editableScoreRenderOptions(options = {}) {
  return {...options,
    autoGenerateMultipleRestMeasuresFromRestMeasures: false,
    newSystemFromXML: true,
    newPageFromXML: true,
  };
}
