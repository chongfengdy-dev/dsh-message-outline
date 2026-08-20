#!/usr/bin/env node
// Syntax check both entry files (used by CI / local dev).
const { execFileSync } = require("node:child_process");
for (const f of ["lib/client.js", "lib/index.js"]) {
  execFileSync(process.execPath, ["--check", f]);
  console.log("OK", f);
}
