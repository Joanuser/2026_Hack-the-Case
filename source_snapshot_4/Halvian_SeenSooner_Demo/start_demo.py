from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def wait_for(url: str, timeout_seconds: float = 45.0) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as response:
                if response.status < 500:
                    return True
        except Exception:
            time.sleep(0.4)
    return False


def main() -> None:
    python = ROOT / ".venv" / "Scripts" / "python.exe"
    if not python.exists():
        raise SystemExit("Missing .venv. Run this first: .\\setup-demo.ps1")

    npm = "npm.cmd" if os.name == "nt" else "npm"
    creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    specs = [
        ("Python API", [str(python), "server.py", "--host", "127.0.0.1", "--port", "8000"], ROOT / "backend"),
        ("Patient Portal", [npm, "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], ROOT / "patient-app"),
        ("Waiting Room Display", [npm, "run", "dev", "--", "--host", "127.0.0.1", "--port", "5174", "--strictPort"], ROOT / "display-app"),
        ("Nurse Dashboard", [npm, "run", "dev", "--", "--host", "127.0.0.1", "--port", "5175", "--strictPort"], ROOT / "nurse-app"),
    ]
    processes: list[tuple[str, subprocess.Popen[bytes]]] = []
    try:
        for name, command, cwd in specs:
            processes.append((name, subprocess.Popen(command, cwd=cwd, creationflags=creation_flags)))

        endpoints = [
            ("Python API", "http://127.0.0.1:8000/api/public/queue"),
            ("Patient Portal", "http://127.0.0.1:5173"),
            ("Waiting Room Display", "http://127.0.0.1:5174"),
            ("Nurse Dashboard", "http://127.0.0.1:5175"),
        ]
        failures = [name for name, url in endpoints if not wait_for(url)]
        if failures:
            raise RuntimeError("Startup health checks failed: " + ", ".join(failures))

        print("\nSeenSooner local demo started:")
        print("  Patient portal  http://127.0.0.1:5173")
        print("  Waiting room display http://127.0.0.1:5174")
        print("  Nurse dashboard  http://127.0.0.1:5175")
        print("  Local API http://127.0.0.1:8000")
        print("\nPress Ctrl+C to stop all services.\n")

        while True:
            stopped = [(name, process.returncode) for name, process in processes if process.poll() is not None]
            if stopped:
                raise RuntimeError(f"Service exited unexpectedly: {stopped}")
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping all services...")
    finally:
        for _, process in processes:
            if process.poll() is None:
                if os.name == "nt":
                    process.send_signal(signal.CTRL_BREAK_EVENT)
                else:
                    process.terminate()
        for _, process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    main()
