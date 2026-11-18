#!/usr/bin/env bash
exec bun "$(dirname "${BASH_SOURCE[0]}")/run.ts" build
