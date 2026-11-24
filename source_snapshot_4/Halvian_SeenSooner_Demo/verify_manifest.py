from __future__ import annotations

import csv
import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "MANIFEST_SHA256.csv"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    failures: list[str] = []
    with MANIFEST.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    for row in rows:
        path = ROOT / row["relative_path"]
        if not path.is_file():
            failures.append(f"MISSING {row['relative_path']}")
        elif path.stat().st_size != int(row["bytes"]):
            failures.append(f"SIZE {row['relative_path']}")
        elif sha256(path) != row["sha256"]:
            failures.append(f"HASH {row['relative_path']}")
    print(f"Manifest verification: {len(rows) - len(failures)}/{len(rows)} PASS")
    for failure in failures:
        print(failure)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
