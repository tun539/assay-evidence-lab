"""Open the offline Assay Evidence Studio in your default browser."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser


def main() -> None:
    studio = Path(__file__).resolve().parents[1] / "studio"
    handler = partial(SimpleHTTPRequestHandler, directory=str(studio))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", 8765), handler)
    except OSError:
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    with server:
        url = f"http://127.0.0.1:{server.server_port}/atlas.html"
        print(f"Studio is ready at {url}\nPress Ctrl+C to stop.", flush=True)
        webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
