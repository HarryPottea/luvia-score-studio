#!/usr/bin/env python3
"""Independent MusicXML 4.0 XSD conformance gate.

CI only: loads locally vendored, SHA-pinned W3C schema plus an independent
MusicXML test corpus, pinned by immutable Git blob SHA-1. Compiles XML Schema with lxml/libxml2 and validates real XML
documents, not a custom handwritten subset. No network resolution is
permitted while parsing XML or compiling XSDs. This script is not a claim
that the browser contains a full live XSD validator.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from lxml import etree

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "tests" / "musicxml-4-pinned-corpus.json"
MAX_XML = 8 * 1024 * 1024
MAX_SCHEMA = 4 * 1024 * 1024
MAX_FILES = 250


def gate(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def blob_sha1(content: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()


def read_manifest() -> dict:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    for section in ("schema", "corpus"):
        s = data[section]
        gate(isinstance(s["repository"], str) and re.fullmatch(r"[\w.-]+/[\w.-]+", s["repository"]) is not None,
             "Invalid pinned repository")
        gate(re.fullmatch(r"[\w.-]+", s["ref"]) is not None, "Invalid pinned revision")
        gate(1 <= len(s["files"]) <= 50, "Invalid pinned file count")
        for filename, sha in s["files"].items():
            gate(re.fullmatch(r"[\w.-]+", filename) is not None and
                 re.fullmatch(r"[0-9a-f]{40}", sha) is not None,
                 "Invalid pinned filename or blob digest")
    return data


def collect_pinned(section: dict, cache: Path, prefix: str, max_bytes: int) -> list[Path]:
    """Copy vendored, hash-pinned sources into an isolated working cache.

    No CI network dependency or runtime fetch. Official copies remain untouched
    and retain their original Git blob hashes.
    """
    cache.mkdir(parents=True, exist_ok=True)
    subdir = "schema" if prefix == "schema/" else "corpus"
    pinned = ROOT / "tests" / "musicxml4-official" / subdir
    copied = []
    for filename, sha in section["files"].items():
        original = pinned / filename
        gate(original.is_file(), "Missing pinned W3C resource: " + filename)
        content = original.read_bytes()
        gate(0 < len(content) <= max_bytes, "Pinned W3C file exceeds size bound: " + filename)
        gate(blob_sha1(content) == sha,
             "Vendored W3C file hash mismatch: " + filename)
        destination = cache / filename
        if destination.exists():
            gate(destination.read_bytes() == content,
                 "Prepared schema/corpus cache was altered: " + filename)
        else:
            destination.write_bytes(content)
        copied.append(destination)
    return copied


def xml_parser() -> etree.XMLParser:
    return etree.XMLParser(
        no_network=True, load_dtd=False, resolve_entities=False,
        recover=False, huge_tree=False, remove_blank_text=False,
        remove_comments=False
    )


def parse_xml(data: bytes, source: str) -> etree._Element:
    gate(0 < len(data) <= MAX_XML, source + ": MusicXML file size out of bounds")
    # External PUBLIC DTDs from normal MusicXML exports are allowed, but will
    # never be fetched. Internal entity definitions are blocked entirely.
    gate(re.search(rb"<!ENTITY\b", data, re.I) is None,
         source + ": entity declaration blocked")
    try:
        root = etree.fromstring(data, parser=xml_parser(), base_url="file:///musicxml-validator/")
    except etree.XMLSyntaxError as exc:
        raise RuntimeError(source + ": invalid XML syntax: " + str(exc)) from exc
    gate(root.tag == "score-partwise" and root.get("version") == "4.0",
         source + ": expected score-partwise MusicXML 4.0")
    return root


def compile_schema(schema_dir: Path) -> etree.XMLSchema:
    original = (schema_dir / "musicxml.xsd").read_bytes()
    substitutions = (
        (b'http://www.musicxml.org/xsd/xml.xsd', b'xml.xsd'),
        (b'http://www.musicxml.org/xsd/xlink.xsd', b'xlink.xsd'),
    )
    patched = original
    for before, after in substitutions:
        gate(before in patched, "Pinned W3C XSD import changed unexpectedly")
        patched = patched.replace(before, after)
    # Only rewrite verified import locations, never any schema definitions.
    # The resolved local XSDs have also been individually SHA-pinned.
    main = schema_dir / "_resolved_musicxml.xsd"
    main.write_bytes(patched)
    try:
        tree = etree.parse(str(main), parser=xml_parser())
        return etree.XMLSchema(tree)
    except (etree.XMLSchemaParseError, etree.XMLSyntaxError) as exc:
        raise RuntimeError("W3C MusicXML 4.0 XSD compilation failed: " + str(exc)) from exc


def validate(schema: etree.XMLSchema, path: Path) -> None:
    doc = parse_xml(path.read_bytes(), str(path))
    if not schema.validate(doc):
        error = schema.error_log.last_error
        raise RuntimeError(str(path) + ": MusicXML 4.0 XSD INVALID: " + str(error))


def negative_controls(schema: etree.XMLSchema, seed: Path) -> None:
    root = parse_xml(seed.read_bytes(), str(seed))
    invalid = etree.fromstring(etree.tostring(root), parser=xml_parser())
    invalid.insert(0, etree.Element("not-in-musicxml-40"))
    gate(not schema.validate(invalid),
         "Schema negative control did not reject invalid element")
    invalid2 = etree.fromstring(etree.tostring(root), parser=xml_parser())
    invalid2.set("version", "invalid-version")
    gate(not schema.validate(invalid2),
         "Schema negative control did not reject invalid version")
    try:
        parse_xml(b'''<?xml version="1.0"?><!DOCTYPE score-partwise [
        <!ENTITY attack SYSTEM "file:///etc/passwd">]>
        <score-partwise version="4.0">&attack;</score-partwise>''', "XXE")
    except RuntimeError:
        pass
    else:
        raise RuntimeError("XXE negative control did not reject entity declaration")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", default=".ci-musicxml4-cache")
    parser.add_argument("--exports-dir")
    args = parser.parse_args()
    cache = (ROOT / args.cache).resolve()
    gate(cache.is_relative_to(ROOT), "Cache must remain inside the project workspace")
    manifest = read_manifest()
    schemas = collect_pinned(manifest["schema"], cache / "schema", "schema/", MAX_SCHEMA)
    corpus = collect_pinned(manifest["corpus"], cache / "corpus", "xmlFiles/", MAX_XML)
    gate(len(schemas) == 3 and len(corpus) == 10, "W3C independent fixture count changed")
    xsd = compile_schema(cache / "schema")
    validated = []
    for path in corpus:
        validate(xsd, path)
        validated.append(path.name)
    for name in manifest.get("local", []):
        file = (ROOT / name).resolve()
        gate(file.is_relative_to(ROOT), "Fixture escaped repo")
        validate(xsd, file)
        validated.append(name)
    negative_controls(xsd, corpus[0])
    exported = []
    if args.exports_dir:
        directory = (ROOT / args.exports_dir).resolve()
        gate(directory.is_relative_to(ROOT) and directory.is_dir(),
             "Browser export directory missing")
        outputs = sorted(directory.glob("*.musicxml"))
        gate(3 <= len(outputs) <= MAX_FILES, "Expected at least three real browser exports")
        for output in outputs:
            validate(xsd, output)
            exported.append(output.name)
    print(json.dumps({
        "status": "PASS_MUSICXML_4_XSD",
        "schema": "W3C MusicXML v4.0",
        "schema_files_pinned": len(schemas),
        "independent_corpus_validated": len(corpus),
        "local_baseline_validated": len(validated) - len(corpus),
        "actual_browser_exports_validated": len(exported),
        "export_names": exported,
        "negative_controls": 3,
        "network_during_xml_parse": False,
        "logic_specific_real_score_verified": False
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError) as error:
        print("MUSICXML_XSD_GATE=FAIL " + str(error), file=sys.stderr)
        sys.exit(1)
