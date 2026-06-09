import sys
from pathlib import Path

# Make `runtime.*` and the sibling hermes-agent importable in tests.
_ROOT = Path(__file__).resolve().parents[1]
_AGENT = _ROOT.parent / "hermes-agent"
for p in (_ROOT, _AGENT):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
