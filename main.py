import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"

BACKEND_PORT = 5000
FRONTEND_PORT = 5500


# Keep child processes so we can stop both cleanly on Ctrl+C.
processes = []


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex((host, port)) == 0


def find_free_port(start_port: int, host: str = "127.0.0.1") -> int:
    port = start_port
    while is_port_in_use(port, host):
        port += 1
    return port


def stop_all(*_):
    for proc in processes:
        if proc.poll() is None:
            proc.terminate()

    # Give processes a moment to exit gracefully, then force kill.
    deadline = time.time() + 3
    for proc in processes:
        if proc.poll() is not None:
            continue
        while time.time() < deadline and proc.poll() is None:
            time.sleep(0.1)
        if proc.poll() is None:
            proc.kill()

    raise SystemExit(0)


def start() -> None:
    if not BACKEND_DIR.exists() or not FRONTEND_DIR.exists():
        raise SystemExit("Expected 'backend' and 'frontend' folders next to main.py")

    backend_proc = None
    frontend_proc = None

    if is_port_in_use(BACKEND_PORT):
        print(f"Backend already running at:  http://127.0.0.1:{BACKEND_PORT}")
    else:
        backend_cmd = [sys.executable, "app.py"]
        backend_env = dict(os.environ)
        backend_env["FLASK_DEBUG"] = "0"
        backend_proc = subprocess.Popen(backend_cmd, cwd=BACKEND_DIR, env=backend_env)
        processes.append(backend_proc)
        print(f"Backend running at:  http://127.0.0.1:{BACKEND_PORT}")

    frontend_port = find_free_port(FRONTEND_PORT)
    frontend_cmd = [sys.executable, "-m", "http.server", str(frontend_port)]
    frontend_proc = subprocess.Popen(frontend_cmd, cwd=FRONTEND_DIR)
    processes.append(frontend_proc)
    print(f"Frontend running at: http://127.0.0.1:{frontend_port}")
    print("Press Ctrl+C to stop both servers.")

    # If we reused backend and only started frontend, monitor frontend only.
    # If both were started, exit when either one crashes and clean up.
    while True:
        if backend_proc is not None and backend_proc.poll() is not None:
            print("Backend stopped. Shutting down frontend...")
            stop_all()
        if frontend_proc is not None and frontend_proc.poll() is not None:
            print("Frontend stopped. Shutting down backend...")
            stop_all()
        time.sleep(0.5)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, stop_all)
    signal.signal(signal.SIGTERM, stop_all)
    start()
