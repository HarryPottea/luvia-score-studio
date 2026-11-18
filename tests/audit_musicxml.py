#!/usr/bin/env python3
"""Read-only MusicXML timing audit: compare onset/duration/voice/chord/tuplet invariants.

This is a development aid, not an independent validation of exported Logic Pro
scores. XML parsing uses stdlib only; refuses DTD/entity declarations.
"""
import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET

MAX_BYTES = 15 * 1024 * 1024
MAX_NOTES = 20000


def bare(tag):
    return tag.rsplit("}", 1)[-1]


def kids(el, tag):
    return [x for x in el if bare(x.tag) == tag]


def first(el, tag):
    return next((x for x in el if bare(x.tag) == tag), None)


def val(el, tag, default=""):
    x = first(el, tag)
    return x.text.strip() if x is not None and x.text else default


def positive(text):
    try:
        number = int(text)
        if number <= 0:
            raise ValueError
        return number
    except (ValueError, TypeError):
        raise ValueError("MusicXML has missing/invalid duration or meter")


def score_events(filepath):
    raw = Path(filepath).read_bytes()
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError("Invalid MusicXML input size")
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ValueError("DTD/entity input is not accepted")
    root = ET.fromstring(raw)
    if bare(root.tag) != "score-partwise":
        raise ValueError("Only score-partwise MusicXML is supported")
    total = 0
    records, warnings = [], []
    for part in kids(root, "part"):
        part_id = part.attrib.get("id", "")
        divisions, beats, beat_type = None, None, None
        for measure_index, measure in enumerate(kids(part, "measure")):
            for attrs in kids(measure, "attributes"):
                if val(attrs, "divisions"):
                    divisions = positive(val(attrs, "divisions"))
                time = first(attrs, "time")
                if time is not None:
                    beats = positive(val(time, "beats"))
                    beat_type = positive(val(time, "beat-type"))
            maximum = (divisions * beats * 4 / beat_type) if all((divisions, beats, beat_type)) else None
            cursor, last_start = 0, None
            lanes = {}
            for element in measure:
                tag = bare(element.tag)
                if tag in ("backup", "forward"):
                    delta = positive(val(element, "duration"))
                    cursor += delta if tag == "forward" else -delta
                    if cursor < 0:
                        raise ValueError(f"{part_id} measure {measure_index}: negative voice cursor")
                    last_start = None
                    continue
                if tag != "note":
                    continue
                duration = positive(val(element, "duration"))
                is_chord = first(element, "chord") is not None
                onset = last_start if is_chord else cursor
                if onset is None or (maximum is not None and onset + duration > maximum):
                    raise ValueError(f"{part_id} measure {measure_index}: invalid chord/onset")
                voice = val(element, "voice", "1")
                staff = val(element, "staff", "1")
                pitch = first(element, "pitch")
                pitch_tuple = (
                    val(pitch, "step"),
                    val(pitch, "alter", "0"),
                    val(pitch, "octave"),
                ) if pitch is not None else None
                mod = first(element, "time-modification")
                tuplets = (
                    positive(val(mod, "actual-notes")),
                    positive(val(mod, "normal-notes")),
                ) if mod is not None else None
                tie = tuple(x.attrib.get("type") for x in kids(element, "tie"))
                lyrics = tuple(val(x, "text") for x in kids(element, "lyric"))
                records.append({
                    "part": part_id, "measure": measure_index,
                    "voice": voice, "staff": staff, "onset": onset,
                    "duration": duration, "chord": is_chord,
                    "pitch": pitch_tuple, "rest": first(element, "rest") is not None,
                    "tuplets": tuplets, "tie": tie, "lyrics": lyrics,
                })
                if not is_chord:
                    lanes.setdefault((voice, staff), []).append((onset, onset + duration))
                    cursor += duration
                    last_start = onset
                total += 1
                if total > MAX_NOTES:
                    raise ValueError("Score has too many note records")
            for lane, events in lanes.items():
                ordered = sorted(events)
                if any(now[0] < prev[1] for prev, now in zip(ordered, ordered[1:])):
                    raise ValueError(f"{part_id} measure {measure_index}: overlap within voice/staff {lane}")
                if maximum and ordered and ordered[-1][1] != maximum:
                    warnings.append(f"{part_id} measure {measure_index}: incomplete lane {lane}")
    return {"events": records, "warnings": warnings, "partCount": len(kids(root, "part"))}


def compare(left, right, allow_pitch=False):
    a = left["events"]
    b = right["events"]
    if len(a) != len(b):
        raise ValueError("Note count changed; independent manual review required")
    pitch_changes = 0
    for index, (original, updated) in enumerate(zip(a, b)):
        if original["pitch"] != updated["pitch"]:
            pitch_changes += 1
        other_a = {k: v for k, v in original.items() if k != "pitch"}
        other_b = {k: v for k, v in updated.items() if k != "pitch"}
        if other_a != other_b:
            raise ValueError(f"Note #{index+1}: onset/duration/voice/chord/tuplet/tie changed")
    if pitch_changes and not allow_pitch:
        raise ValueError(f"{pitch_changes} pitch changes require --allow-pitch")
    return {"status": "STRUCTURE_MATCH", "pitchChanges": pitch_changes, "eventCount": len(a)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", nargs="?")
    parser.add_argument("--compare", metavar="MUSICXML")
    parser.add_argument("--allow-pitch", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        if args.self_test:
            prefix = Path(__file__).resolve().parent / "fixtures"
            original = score_events(prefix / "complex-voices-original.musicxml")
            edited = score_events(prefix / "complex-voices-pitch-edited.musicxml")
            assert original["partCount"] == 1
            assert len(original["events"]) == 11
            assert compare(original, edited, allow_pitch=True)["pitchChanges"] == 1
            try:
                compare(original, edited)
                raise AssertionError("Unapproved pitch edit was not rejected")
            except ValueError:
                pass
            print(json.dumps({"status": "PASS_SYNTHETIC_FIXTURES", "events": 11}))
        else:
            if not args.input:
                parser.error("MusicXML input file is required")
            base = score_events(args.input)
            result = {"status": "INSPECTED_NOT_CERTIFIED", "partCount": base["partCount"],
                      "noteCount": len(base["events"]), "warnings": base["warnings"][:15]}
            if args.compare:
                result["comparison"] = compare(base, score_events(args.compare), args.allow_pitch)
            print(json.dumps(result, ensure_ascii=False))
    except (ValueError, ET.ParseError, OSError, AssertionError) as exc:
        print(json.dumps({"status": "BLOCKED", "reason": str(exc)}, ensure_ascii=False))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
