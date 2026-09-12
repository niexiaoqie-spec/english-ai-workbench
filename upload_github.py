"""Upload project files to GitHub via Contents API (bypasses blocked git protocol)."""
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error

TOKEN = sys.argv[1]
REPO = "niexiaoqie-spec/english-ai-workbench"
ROOT = os.path.dirname(os.path.abspath(__file__))
API = "https://api.github.com"

SKIP_DIRS = {".git", "__pycache__", "node_modules"}
SKIP_FILES = {"english_workbench.db"}

def upload(path_rel, content_bytes):
    url = f"{API}/repos/{REPO}/contents/{path_rel}"
    body = {
        "message": f"add {path_rel}",
        "content": base64.b64encode(content_bytes).decode(),
    }
    # check existing sha for update
    req = urllib.request.Request(url, headers={
        "Authorization": f"token {TOKEN}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "deploy-script",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            existing = json.load(resp)
            body["sha"] = existing["sha"]
            body["message"] = f"update {path_rel}"
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="PUT", headers={
        "Authorization": f"token {TOKEN}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "deploy-script",
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.status

def main():
    ok, fail = 0, 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in sorted(filenames):
            if fn in SKIP_FILES:
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
            with open(full, "rb") as f:
                content = f.read()
            for attempt in range(3):
                try:
                    status = upload(rel, content)
                    print(f"OK  {rel} ({status})")
                    ok += 1
                    break
                except Exception as e:
                    print(f"RETRY {rel}: {e}")
                    time.sleep(2)
            else:
                print(f"FAIL {rel}")
                fail += 1
    print(f"\nDone: {ok} uploaded, {fail} failed")

if __name__ == "__main__":
    main()
