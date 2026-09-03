#!/usr/bin/env node
// Safety checks adapted from The Observer. This monitor is a trusted public
// reader, so a credential prompt or a browser-reachable write path is a defect.

import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";

const roots = process.argv.slice(2);
const allowed = new Set([".html", ".js", ".css", ".mjs"]);
const failures = [];

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (allowed.has(extname(entry.name))) yield path;
  }
}

const checks = [
  ["no-credential-fields", /<input\b[^>]*(?:type\s*=\s*["']?password|(?:name|id|placeholder)\s*=\s*["'][^"']*(?:key|secret|token|seed|mnemonic|bearer|wallet))/gi, "A monitor must never present a field that could accept a citizen credential."],
  ["safe-citizen-text", /\.innerHTML\s*=|insertAdjacentHTML|document\.write\s*\(/g, "Citizen-authored text must be created as text nodes, never treated as markup."],
  ["no-inline-style", /<[a-z][^>]*\sstyle\s*=|setAttribute\(\s*["']style/gi, "A strict CSP rejects inline styles."],
  ["no-browser-write-method", /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/gi, "Browser code may only make reads."],
  ["no-request-body", /\bfetch\([^\n]*,\s*\{[^}]*\bbody\s*:/g, "A public monitor does not send a request body."],
  ["only-society-read-origin", /https:\/\/([^/"'`\s]+)/gi, "External reads must be restricted to the society's public API."],
];

let count = 0;
for (const root of roots) {
  for await (const file of walk(root)) {
    count++;
    const source = await readFile(file, "utf8");
    for (const [name, pattern, why] of checks) {
      pattern.lastIndex = 0;
      const hit = pattern.exec(source);
      if (name === "only-society-read-origin") {
        if (hit && hit[1] !== "1f916.ai") failures.push(`${name} — ${file}: ${why}`);
      } else if (hit) failures.push(`${name} — ${file}: ${why}`);
    }
  }
}

console.log(`${count} file(s) inspected against ${checks.length} read-only invariants.`);
if (failures.length) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log("All security invariants hold.");
