#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: scripts/bump-version.sh <version>"
  exit 1
fi

VERSION="$1"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CARGO_TOML="$ROOT_DIR/server/Cargo.toml"
PACKAGE_JSON="$ROOT_DIR/package.json"

if [[ ! -f "$CARGO_TOML" ]]; then
  echo "Missing $CARGO_TOML"
  exit 1
fi

if [[ ! -f "$PACKAGE_JSON" ]]; then
  echo "Missing $PACKAGE_JSON"
  exit 1
fi

if [[ "$OSTYPE" == darwin* ]]; then
  sed -i '' "s/^version = .*/version = \"$VERSION\"/" "$CARGO_TOML"
else
  sed -i "s/^version = .*/version = \"$VERSION\"/" "$CARGO_TOML"
fi

cd "$ROOT_DIR"
npm version "$VERSION" --no-git-tag-version

echo "Updated versions to $VERSION"
echo "Next:"
echo "  git add server/Cargo.toml package.json pnpm-lock.yaml"
echo "  git commit -m \"v$VERSION\""
echo "  git tag \"v$VERSION\""

