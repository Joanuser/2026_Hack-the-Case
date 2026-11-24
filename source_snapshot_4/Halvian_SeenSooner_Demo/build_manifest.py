from __future__ import annotations

import csv
import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "MANIFEST_SHA256.csv"
SKIP_PARTS = {"node_modules", ".venv", "__pycache__", ".pytest_cache"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def included(path: Path) -> bool:
    relative = path.relative_to(ROOT)
    if path == OUTPUT or any(part in SKIP_PARTS for part in relative.parts):
        return False
    if len(relative.parts) >= 2 and relative.parts[:2] == ("simulation", "outputs"):
        return False
    return path.is_file()


def main() -> None:
    files = sorted((path for path in ROOT.rglob("*") if included(path)), key=lambda p: p.as_posix())
    with OUTPUT.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["relative_path", "bytes", "sha256"])
        for path in files:
            writer.writerow([path.relative_to(ROOT).as_posix(), path.stat().st_size, sha256(path)])
    print(f"Manifest: {len(files)} files -> {OUTPUT}")


if __name__ == "__main__":
    main()
