#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${TWINE_PASSWORD:-}" ]]; then
  echo "Missing TWINE_PASSWORD."
  echo ""
  echo "1. Create a token: https://pypi.org/manage/account/token/"
  echo "   Scope: entire account (first upload) or project kgviz"
  echo "2. Export it (do NOT use your PyPI login password):"
  echo ""
  echo "   export TWINE_USERNAME=__token__"
  echo "   export TWINE_PASSWORD='pypi-xxxxxxxx'"
  echo ""
  echo "Then re-run: bash scripts/publish_pypi.sh"
  exit 1
fi

export TWINE_USERNAME="${TWINE_USERNAME:-__token__}"

if [[ "$TWINE_USERNAME" != "__token__" ]]; then
  echo "TWINE_USERNAME must be __token__ (got: $TWINE_USERNAME)."
  echo "PyPI disabled username/password uploads. Use an API token instead."
  exit 1
fi

if [[ ! "$TWINE_PASSWORD" =~ ^pypi- ]]; then
  echo "TWINE_PASSWORD should start with pypi- (API token), not your account password."
  exit 1
fi

echo "Building viewer + Python package..."
(cd viewer && npm run build)
rm -rf dist/
python3 -m pip install -q build twine
python3 -m build
python3 -m twine check dist/*

echo "Uploading to PyPI..."
python3 -m twine upload dist/* --non-interactive

echo "Done. Verify: pip install kgviz==$(python3 -c "import tomllib; print(tomllib.load(open('pyproject.toml','rb'))['project']['version'])")"
