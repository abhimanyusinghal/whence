#!/usr/bin/env bash
# Dev runner. Backend only for now; extension build will be added in step 6.
set -euo pipefail
cd "$(dirname "$0")/.."
cd backend
npm run dev
