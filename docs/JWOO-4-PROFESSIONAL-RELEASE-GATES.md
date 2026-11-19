# J-WOO 4.0 — Professional Composer Release Contract

**Status:** TARGET_DEFINED / NOT_PROFESSIONALLY_CERTIFIED
**Owner scope:** Logic Pro composers preparing vocal, piano grand-staff and small-ensemble sheet music.
**Final outcome:** A composer can complete score entry, revisions, notation, player-specific engraving/parts, audition and printable distribution inside J-WOO without requiring MuseScore or Dorico for these works.

## Fixed definition of "4.0 complete"

Mark 4.0 **COMPLETE** only after all gates below are independently evidenced.
A passing synthetic unit test proves a particular function, not the entire goal.
Fail-closed messages, omissions or protected constructs do not count as supported editing.

| Gate | Ship requirement | Objective evidence | Current baseline |
|---|---|---|---|
| G1 Edit freedom | Notes, rests, chords, multi-voice/staff, notes across measure boundaries, ties, slurs, lyrics (including multiple verses/melisma), articulations, dynamics, 3:2 and commonly used tuplets, meter/key changes; keyboard/mouse direct editing, undo | End-to-end edit→serialize→reload tests for every operation; no corrupted untouched voice/staff | PARTIAL; many protected constructs |
| G2 Musical correctness | No unrequested changes to written/played pitch, accidental, onsets, ticks, voice/staff, ties, lyrics and meter. Invalid edit must leave original byte- and model-state untouched | Structural diff for unedited regions, MusicXML 4.0 XSD validation, timing and tuplets oracle, playback comparison | PARTIAL; no independent XSD gate |
| G3 Engraving | Vocal/piano/ensemble parts without collisions, sensible system breaks, page turns, lyric alignment and print-safe A4 staff heights | Reference screenshot/per-page visual review by composer; deterministic layout diff for regression corpus | PARTIAL; OSMD-dependent |
| G4 Export | Separate score and part PDFs with vector staff/notation (not JPEG), stable physical A4 dimensions, selectable fonts where feasible | Parse PDF objects: pages, vector paths and absence of sole full-page DCT image; compare to SVG; print sample | NOT MET: batch PDFs are JPEG pages |
| G5 Work reliability | Recoverable local project history, explicit save, round-trip MXL/MusicXML, privacy and no irreversible silent data loss | Crash/reload/restore tests; local data stays on device; unsupported browser storage clearly surfaced | PARTIAL; local IndexedDB |
| G6 Real composer acceptance | Representative Logic Pro MXL corpus of **10 distinct real score cases**: melodic vocal, Korean lyrics, piano two staves, two voices, chord textures, triplets, ties/slurs/wedges, tempo/meter/key changes, multi-page ensemble parts, pickup/complex imported files | For each: Logic export → J-WOO edits → MusicXML export → independent importer comparison → player-readability + print review; zero unexplained note/time mutations or high-severity document loss | NOT MET: no user-supplied representative corpus verified |

G1-G6 are all mandatory. In particular, **the project is not finished when its UI buttons exist**, or when a single Chromium smoke test is green.

## Integrity report meaning

J-WOO's score audit is a local, **read-only structural preflight**. It checks basic musical time, voice overlap, chord anchor, tuplet ratio, and open ties/slurs/wedges. It does **not** implement the full MusicXML XSD, instrument transposition, engraving collisions or Logic round-trip acceptance.

- **BLOCKED:** definite structural/timing problem detected. Do not distribute without correction or independent professional review.
- **REVIEW:** potential issues or a format outside the supported audit grammar. Investigate manually.
- **CLEAN:** no findings within this **limited audit grammar**; this is *not* a professional-quality release certification.

The audit does not alter the source file. Users retain the ability to save/download a damaged original for recovery.

## Development rules

1. **Keep a single J-WOO 4.0 goal**; do not relabel a limited feature release as a new major completion.
2. Build capabilities in integrated slices, not a chain of UI-only micro-features. Every edit must preserve the MusicXML semantic model or fail clearly.
3. Existing production and the proven iPhone standalone installation remain protected. Create branch and PR, run unit/Chromium CI, check the deployed commit before announcing a shipped release.
4. Add an automatic regression test with each material fix. Test dangerous and ambiguous inputs as well as successful ones.
5. Never claim that a synthetic fixture establishes real Logic Pro accuracy or a visually correct printed PDF.
6. When the user provides actual MXL examples, test and document them against the G6 corpus; preserve unreleased copyrighted scores and never upload them to a public GitHub repository without authorization.

## Ordered engineering path

1. **Score integrity and schema gate:** read-only musical preflight (current slice), independent MusicXML XSD validation, semantic round-trip diff.
2. **Editor generalization:** multi-staff voices and rhythms, tie chains, multi-verse lyrics, bracketed tuplets, accidentals and all common notation.
3. **Engraver and output:** vector batch PDF of full score and each part, print-boundary/overlap checks, editable system breaks.
4. **Professional usability:** direct mouse+keyboard note entry, fast selection, undo/redo, playback tracking and reliable recovery.
5. **G6 real-world certification:** real Logic samples, compare against MuseScore/Dorico, fix all blocking defects, obtain composer acceptance.

**End condition:** move status to COMPLETE only after G1-G6 each have documented passing evidence. Until then, show "4.0 development in progress" rather than claiming professional replacement.
