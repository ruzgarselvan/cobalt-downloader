#!/usr/bin/env python3
"""Native messaging helper for Cobalt Downloader: downloads links with yt-dlp.

The browser starts this script when the extension asks for a yt-dlp download.
Messages are length-prefixed JSON on stdin/stdout (Chrome native messaging).
"""
import json
import os
import re
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import threading

# Browsers start helpers with a minimal PATH; add the usual install locations.
os.environ["PATH"] = os.pathsep.join(
    [os.environ.get("PATH", ""), "/opt/homebrew/bin", "/usr/local/bin", os.path.expanduser("~/.local/bin")]
)
DOWNLOADS = os.path.expanduser("~/Downloads")

cancelled = threading.Event()
process = None  # the running yt-dlp


def read():
    header = sys.stdin.buffer.read(4)
    if len(header) < 4:
        return None
    return json.loads(sys.stdin.buffer.read(struct.unpack("<I", header)[0]))


def send(message):
    data = json.dumps(message).encode()
    sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
    sys.stdout.buffer.flush()


def cancel(*_):
    """Stops yt-dlp and the ffmpeg it started (they share a process group)."""
    cancelled.set()
    if process and process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def watch_for_cancel():
    # The extension cancels with {"type": "cancel"}; a closed pipe means it went away.
    while True:
        message = read()
        if message is None or message.get("type") == "cancel":
            return cancel()


def remove_partial_files(destination):
    """Deletes what a cancelled download leaves behind: .part, .ytdl, .fNNN and .temp files."""
    if not destination:
        return
    folder, stem = os.path.split(os.path.splitext(destination)[0])
    for name in os.listdir(folder or "."):
        if name.startswith(stem) and re.search(r"\.(part|ytdl)$|\.f\d+\.|\.temp\.", name[len(stem):]):
            os.remove(os.path.join(folder, name))


def download(request):
    ytdlp = shutil.which("yt-dlp")
    if not ytdlp:
        return send({"type": "error", "error": "yt-dlp is not installed"})

    quality = request.get("quality", "1080")
    resolution = "res" if quality == "max" else f"res:{quality}"
    args = [
        ytdlp, "--no-playlist", "--no-warnings", "--newline", "--progress",
        "--progress-template", "download:PROGRESS %(progress._percent_str)s",
        "--print", "before_dl:DEST %(filename)s",
        "--print", "after_move:FILE %(filepath)s",
        "-o", os.path.join(DOWNLOADS, "%(title)s.%(ext)s"),
    ]
    if request.get("mode") == "audio":
        args += ["-x", "--audio-format", "mp3"]
    else:
        # Prefer H.264/AAC so the file plays everywhere, QuickTime included.
        args += ["-S", f"{resolution},vcodec:h264,acodec:m4a", "--merge-output-format", "mp4"]
    args.append(request["url"])

    threading.Thread(target=watch_for_cancel, daemon=True).start()
    signal.signal(signal.SIGTERM, cancel)

    returncode, path, destination, stderr, downloaded = run(args)
    if returncode != 0 and "HTTP Error 403" in stderr and not cancelled.is_set():
        # YouTube sometimes refuses a stream URL once; a fresh attempt usually works.
        returncode, path, destination, stderr, downloaded = run(args)

    if cancelled.is_set():
        remove_partial_files(destination)
        send({"type": "cancelled"})
    elif returncode == 0:
        # No progress at all means yt-dlp found the file already downloaded.
        send({"type": "done", "file": path, "existing": not downloaded})
    else:
        lines = [l for l in stderr.splitlines() if "ERROR" in l]
        send({"type": "error", "error": (lines[-1] if lines else stderr.strip()[-300:]) or "yt-dlp failed"})


def run(args):
    """Runs yt-dlp, forwarding progress.

    Returns (returncode, final path, planned path, stderr, whether anything was downloaded).

    Video and audio are downloaded one after the other, so the percentage starts over;
    each restart bumps "stage" so the extension can say which part is downloading.
    """
    global process
    with tempfile.TemporaryFile(mode="w+") as errors:
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=errors, text=True, start_new_session=True)
        if cancelled.is_set():
            cancel()
        last, stage, path, destination = -1.0, 0, "", ""
        for line in process.stdout:
            line = line.strip()
            if line.startswith("PROGRESS "):
                try:
                    percent = float(line[len("PROGRESS "):].strip().rstrip("%"))
                except ValueError:
                    continue
                if percent < last - 50:
                    stage += 1
                if int(percent) != int(last):
                    send({"type": "progress", "percent": percent, "stage": stage})
                last = percent
            elif line.startswith("DEST "):
                destination = line[len("DEST "):]
            elif line.startswith("FILE "):
                path = line[len("FILE "):]
        process.wait()
        errors.seek(0)
        return process.returncode, path, destination, errors.read(), last >= 0


message = read()
if message and message.get("type") == "ping":
    send({"type": "pong", "ytdlp": bool(shutil.which("yt-dlp"))})
elif message and message.get("type") == "download":
    download(message)
# Exit right away: a normal interpreter shutdown aborts (SIGABRT) while the cancel
# watcher thread is still blocked reading stdin.
os._exit(0)
