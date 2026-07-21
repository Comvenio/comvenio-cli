#!/usr/bin/env bun

// Keep the established CLI composition root stable while command modules
// migrate into the workspace package by package.
await import("../../../src/index.ts");

export {};
