"""Run the desktop/testing API with an immutable loopback transport boundary."""

import argparse

import uvicorn


def server_config(port: int = 8001) -> uvicorn.Config:
    if not 1 <= port <= 65535:
        raise ValueError("Port must be between 1 and 65535")
    # Never trust forwarding headers here. Next adds them automatically, and a
    # trusted ProxyHeadersMiddleware would replace the peer checked by test mode.
    return uvicorn.Config("app.main:app", host="127.0.0.1", port=port,
                          proxy_headers=False, access_log=False, log_level="warning")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Port must be between 1 and 65535")
    uvicorn.Server(server_config(args.port)).run()


if __name__ == "__main__":
    main()
