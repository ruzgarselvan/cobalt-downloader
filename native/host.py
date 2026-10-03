#!/usr/bin/env python3
"""Native messaging helper for Cobalt Downloader: downloads links with yt-dlp.

The browser starts this script when the extension asks for a yt-dlp download.
Messages are length-prefixed JSON on stdin/stdout (Chrome native messaging).
"""
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile

# Browsers start helpers with a minimal PATH; add the usual install locations.
os.environ["PATH"] = os.pathsep.join(
    [os.environ.get("PATH", ""), "/opt/homebrew/bin", "/usr/local/bin", os.path.expanduser("~/.local/bin")]
)
DOWNLOADS = os.path.expanduser("~/Downloads")


def read():
    header = sys.stdin.buffer.read(4)
    if len(header) < 4:
        return None
    return json.loads(sys.stdin.buffer.read(struct.unpack("<I", header)[0]))


def send(message):
    data = json.dumps(message).encode()
    sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
    sys.stdout.buffer.flush()


def download(request):
    ytdlp = shutil.which("yt-dlp")
    if not ytdlp:
        return send({"type": "error", "error": "yt-dlp is not installed"})

    quality = request.get("quality", "1080")
    resolution = "res" if quality == "max" else f"res:{quality}"
    args = [
        ytdlp, "--no-playlist", "--no-warnings", "--newline", "--progress",
        "--progress-template", "download:PROGRESS %(progress._percent_str)s",
        "--print", "after_move:FILE %(filepath)s",
        "-o", os.path.join(DOWNLOADS, "%(title)s.%(ext)s"),
    ]
    if request.get("mode") == "audio":
        args += ["-x", "--audio-format", "mp3"]
    else:
        # Prefer H.264/AAC so the file plays everywhere, QuickTime included.
        args += ["-S", f"{resolution},vcodec:h264,acodec:m4a", "--merge-output-format", "mp4"]
    args.append(request["url"])

    returncode, path, stderr = run(args)
    if returncode != 0 and "HTTP Error 403" in stderr:
        # YouTube sometimes refuses a stream URL once; a fresh attempt usually works.
        returncode, path, stderr = run(args)

    if returncode == 0:
        send({"type": "done", "file": path})
    else:
        lines = [l for l in stderr.splitlines() if "ERROR" in l]
        send({"type": "error", "error": (lines[-1] if lines else stderr.strip()[-300:]) or "yt-dlp failed"})


def run(args):
    """Runs yt-dlp, forwarding progress; returns (returncode, final file path, stderr)."""
    with tempfile.TemporaryFile(mode="w+") as errors:
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=errors, text=True)
        last, path = None, ""
        for line in process.stdout:
            line = line.strip()
            if line.startswith("PROGRESS "):
                percent = line[len("PROGRESS "):].strip()
                if percent != last:
                    last = percent
                    send({"type": "progress", "percent": percent})
            elif line.startswith("FILE "):
                path = line[len("FILE "):]
        process.wait()
        errors.seek(0)
        return process.returncode, path, errors.read()


message = read()
if message and message.get("type") == "ping":
    send({"type": "pong", "ytdlp": bool(shutil.which("yt-dlp"))})
elif message and message.get("type") == "download":
    download(message)
