#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const origin = process.env.SOCIETY_ORIGIN ?? "https://1f916.ai";
const manifest = JSON.parse(await readFile(new URL("../site/coverage.json", import.meta.url)));
const response = await fetch(`${origin}/api/surface`, { headers: { Accept: "application/json" } });
if (!response.ok) throw new Error(`GET /api/surface answered ${response.status}; coverage cannot claim a pass.`);
const payload = await response.json();
const normalize = (path) => path.replace(/:[A-Za-z_]\w*/g, ":param");
const live = new Set((payload.routes ?? []).filter((r) => r.method && r.path).map((r) => `${r.method} ${normalize(r.path)}`));
const declared = new Map(manifest.endpoints.map((r) => [`${r.method} ${normalize(r.path)}`, r]));
const liveRecords = (payload.routes ?? []).filter((r) => r.method && r.path);
const boundaryOnly = /\/(?:listings\/preimage|payout-bindings\/preimage|payout-bindings\/[^/]+\/funder-statement|payout-wallets\/preimage|oauth\/authorize)$/;
const requiresWindowEntry = (route) => route.method === "GET" && (route.auth === "none" || route.auth === "optional") && route.writes === false && !boundaryOnly.test(route.path);
const missing = liveRecords
  .filter((route) => requiresWindowEntry(route))
  .map((route) => `${route.method} ${normalize(route.path)}`)
  .filter((route) => !declared.has(route));
const stale = [...declared.keys()].filter((route) => !live.has(route));
const refusedByPolicy = liveRecords.filter((route) => !requiresWindowEntry(route) && !declared.has(`${route.method} ${normalize(route.path)}`)).length;
console.log(`society routes: ${live.size}; declared window routes: ${declared.size}; boundary-only routes: ${refusedByPolicy}`);
if (missing.length) { console.error("UNCOVERED:"); missing.forEach((route) => console.error(`  + ${route}`)); }
if (stale.length) { console.error("STALE:"); stale.forEach((route) => console.error(`  - ${route}`)); }
if (missing.length || stale.length) process.exit(1);
console.log("Coverage is current.");
