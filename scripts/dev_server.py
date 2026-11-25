#!/usr/bin/env python3
"""
Pocket-AP local development server.
Usage:
  python3 scripts/dev_server.py --proxy http://192.168.1.1 --port 8080
  python3 scripts/dev_server.py --mock --port 8080
"""

import argparse
import http.server
import json
import os
import socketserver
import urllib.request
import urllib.error

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "www"))


def make_handler(proxy_target: str | None, mock: bool):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=ROOT_DIR, **kwargs)

        def do_GET(self):
            if self.path == "/":
                self.send_response(302)
                suffix = "?mock=1" if mock else ""
                self.send_header("Location", f"/pocket-ap/{suffix}")
                self.end_headers()
                return
            super().do_GET()

        def do_POST(self):
            if self.path == "/ubus" and proxy_target:
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length)
                req = urllib.request.Request(
                    f"{proxy_target.rstrip('/')}/ubus",
                    data=body,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                try:
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        data = resp.read()
                        self.send_response(resp.status)
                        self.send_header("Content-Type", "application/json")
                        self.send_header("Content-Length", str(len(data)))
                        self.end_headers()
                        self.wfile.write(data)
                except urllib.error.HTTPError as e:
                    data = e.read()
                    self.send_response(e.code)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(data)
                except Exception as e:
                    msg = json.dumps({"jsonrpc": "2.0", "error": {"code": -32000, "message": f"Proxy error: {e}"}}).encode()
                    self.send_response(502)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(msg)
                return

            self.send_error(404, "Not Found")

    return Handler


def main():
    p = argparse.ArgumentParser(description="Pocket-AP local dev server")
    p.add_argument("--port", type=int, default=8080)
    p.add_argument("--proxy", type=str, default=None, help="Live OpenWrt router URL, e.g. http://192.168.1.1")
    p.add_argument("--mock", action="store_true", help="Redirect root to ?mock=1 demo mode")
    args = p.parse_args()

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", args.port), make_handler(args.proxy, args.mock)) as httpd:
        mode = f"proxy -> {args.proxy}" if args.proxy else ("mock demo" if args.mock else "static")
        print(f"Pocket-AP dev server ({mode}) at http://127.0.0.1:{args.port}/pocket-ap/{'?mock=1' if args.mock else ''}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
