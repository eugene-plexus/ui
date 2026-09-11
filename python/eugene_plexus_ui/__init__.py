"""Where the Eugene Plexus web UI's static files are.

This package is data, not code: a Next.js static export shipped as a
Python distribution so it lands in the same virtualenv the agent runs
from. The agent asks for `static_dir()` and mounts it at `/`.

**A function is the contract, not a directory layout.** The agent could
have reached for `importlib.resources.files("eugene_plexus_ui") /
"static"` directly, and then this package could never move its own
files without breaking an agent that was already installed. An
attribute that is missing is also a loud, specific failure — "installed
but too old" — where a path that has moved is a silent empty mount that
404s every route and looks like a routing bug.
"""

from __future__ import annotations

from importlib.resources import files
from pathlib import Path

__version__ = "0.1.0"

__all__ = ["__version__", "static_dir"]


def static_dir() -> Path:
    """The directory holding `index.html` and the rest of the export."""
    return Path(str(files(__package__ or "eugene_plexus_ui") / "static"))
