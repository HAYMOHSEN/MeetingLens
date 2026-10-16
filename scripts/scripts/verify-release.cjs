#!/usr/bin/env node
/* Run all browser regression suites against the same source checkout. */
"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const suites = [
  "verify-studio.cjs", "verify-backgrounds.cjs", "verify-offline.cjs",
  "verify-advanced.cjs", "verify-photo-workbench.cjs", "verify-session.cjs",
  "verify-native-report.cjs", "verify-offline-tools.cjs",
  "verify-shipping-camera.cjs", "verify-shipping-photo.cjs",
  "verify-shipping-session.cjs", "verify-shipping-shell.cjs",
  "../assets/vendor/vision/verify-vision.cjs"
];
for (const suite of suites) {
  process.stdout.write(`\nRunning ${suite}\n`);
  const result = spawnSync(process.execPath, [path.join(__dirname, suite)], {
    cwd: root, env: process.env, stdio: "inherit"
  });
  if (result.error || result.status !== 0) {
    if (result.error) process.stderr.write(result.error.message + "\n");
    process.exit(result.status || 1);
  }
}
process.stdout.write("\nAll browser regression suites passed. Windows packaging and physical hardware checks remain separate.\n");
