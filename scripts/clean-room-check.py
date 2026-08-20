#!/usr/bin/env python3
"""Clean-room scanner (shared with the permitportal repository).

Screens the working tree for terms that must never appear in this repository.

The sensitive term list is NOT stored in this repository. A plaintext denylist
committed to a public repo discloses exactly what it exists to protect. Terms come
from, in order of precedence:

  1. $CLEAN_ROOM_DENYLIST        (newline-separated; CI writes the repo secret here)
  2. $CLEAN_ROOM_DENYLIST_FILE   (path to a file; used by the pre-commit hook)
  3. ~/.config/permitportal/denylist.txt

A generic list of non-sensitive markers ships in .github/clean-room-generic.txt and
is always applied.

Findings never print the matched term. They also never print file and line UNLESS
--local is passed, because on a PUBLIC repository that pointer is itself the disclosure:
Actions logs are world-readable, so "line 87 of docs/foo.md contains a denylisted term"
plus a public docs/foo.md recovers the term by inspection.

  default (CI):  count only, non-zero exit
  --local:       file and line, for the pre-commit hook where the tree is not yet public

Exit codes: 0 clean, 1 findings, 2 configuration error.
"""

from __future__ import annotations

import os
import re
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GENERIC_LIST = REPO / ".github" / "clean-room-generic.txt"

SKIP_DIRS = {
    ".git", "node_modules", ".venv", "__pycache__", ".terraform",
    ".next", "dist", "site", ".pytest_cache", ".ruff_cache", ".mypy_cache",
}
SKIP_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".ico", ".woff", ".woff2",
    ".zip", ".gz", ".tar", ".parquet", ".xlsx", ".sqlite", ".db",
}
# The licence texts are third-party verbatim and are not ours to edit.
SKIP_PATHS = {"LICENSE", ".github/clean-room-generic.txt"}


def normalize(text: str) -> str:
    """Fold case, strip accents, and collapse punctuation and whitespace to single
    spaces, so that 'Foo-Bar', 'foo bar', and 'FOO_BAR' all match one term."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.casefold()
    return re.sub(r"[^a-z0-9]+", " ", text)


def load_terms() -> tuple[list[str], list[str]]:
    """Return (sensitive_terms, generic_terms). Sensitive terms are never logged."""
    raw = os.environ.get("CLEAN_ROOM_DENYLIST")
    if raw is None:
        path_env = os.environ.get("CLEAN_ROOM_DENYLIST_FILE")
        if path_env:
            # An explicitly-named file that does not exist is a CONFIGURATION ERROR,
            # never a reason to fall back. Falling back would scan against a different
            # list than the one asked for and report a pass -- the operator would
            # believe they had checked something they had not. Silently substituting a
            # source is the same defect as silently having no source.
            explicit = Path(path_env)
            if not explicit.is_file():
                print(
                    f"clean-room: CLEAN_ROOM_DENYLIST_FILE points at {path_env!r}, "
                    f"which does not exist.\n"
                    "  Refusing to fall back to the default list: a pass against a list "
                    "you did not ask for is worse than no scan at all.",
                    file=sys.stderr,
                )
                raise SystemExit(2)
            raw = explicit.read_text(encoding="utf-8")
        else:
            default = Path.home() / ".config" / "permitportal" / "denylist.txt"
            raw = default.read_text(encoding="utf-8") if default.is_file() else ""

    sensitive = [t.strip() for t in raw.splitlines() if t.strip() and not t.startswith("#")]

    generic: list[str] = []
    if GENERIC_LIST.is_file():
        generic = [
            t.strip()
            for t in GENERIC_LIST.read_text(encoding="utf-8").splitlines()
            if t.strip() and not t.startswith("#")
        ]
    return sensitive, generic


def build_pattern(terms: list[str]) -> re.Pattern[str] | None:
    """Whole-word alternation over normalized terms. Acronyms match as whole words
    only, so a three-letter term does not fire inside a longer word that contains it."""
    normalized = sorted({normalize(t).strip() for t in terms if normalize(t).strip()}, key=len, reverse=True)
    if not normalized:
        return None
    alternation = "|".join(re.escape(t) for t in normalized)
    return re.compile(rf"(?<![a-z0-9])(?:{alternation})(?![a-z0-9])")


def iter_files():
    for path in sorted(REPO.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        rel = path.relative_to(REPO)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if path.suffix.lower() in SKIP_SUFFIXES:
            continue
        if str(rel) in SKIP_PATHS:
            continue
        yield rel, path


def main() -> int:
    # Locations are printed only when the tree is still private. See the module docstring.
    local = "--local" in sys.argv
    sensitive, generic = load_terms()
    if not sensitive:
        # Hard failure, not a warning. In CI, `CLEAN_ROOM_DENYLIST: ${{ secrets.X }}`
        # expands to an EMPTY STRING when the secret is missing or was deleted -- so a
        # warning here would let the gate degrade to generic-terms-only and still go
        # green. The generic list is additive; the sensitive list IS the control.
        print("clean-room: no sensitive terms configured.", file=sys.stderr)
        print(
            "  Set CLEAN_ROOM_DENYLIST, or create ~/.config/permitportal/denylist.txt.\n"
            "  The generic list alone is not this control and does not substitute for it.\n"
            "  Refusing to report a pass without having checked what matters.\n"
            "  (On a fork pull request this is expected: forks receive no secrets.)",
            file=sys.stderr,
        )
        return 2

    patterns = [
        ("sensitive", build_pattern(sensitive)),
        ("generic", build_pattern(generic)),
    ]

    findings = 0
    scanned = 0
    for rel, path in iter_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        scanned += 1
        for lineno, line in enumerate(text.splitlines(), start=1):
            # Escape hatch for lines that legitimately discuss a marker phrase -- for
            # example this file, and docs/clean-room.md. Deliberately verbose so it is
            # obvious in a diff, and deliberately unavailable for the secret list.
            if "clean-room-allow" in line:
                continue
            haystack = normalize(line)
            for kind, pattern in patterns:
                if pattern and pattern.search(haystack):
                    # Never the term, and never the location unless the tree is private.
                    if local:
                        print(f"{rel}:{lineno}: clean-room finding ({kind} list)")
                    findings += 1
                    break

    if findings:
        print(f"\nclean-room: {findings} finding(s) across {scanned} files. See docs/clean-room.md.")
        if not local:
            print(
                "Locations withheld: printing them in a public CI log would disclose the "
                "terms this scan exists to protect.\n"
                "Reproduce locally with:  python3 scripts/clean-room-check.py --local"
            )
        return 1
    print(f"clean-room: clean ({scanned} files scanned).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
