"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../services/edge-gateway/src/gemini.js"),"utf8");
const identity=fs.readFileSync(path.join(__dirname,"../services/edge-gateway/src/sophia-identity.js"),"utf8");
assert.match(source,/fieldMask:\s*["']bidiGenerateContentSetup\.systemInstruction["']/);
assert.match(source,/SOPHIA_OFFICIAL_IDENTITY_INSTRUCTION/);
for(const token of ["LifeOS Synthetic Intelligence was built by LifeOS AI","powered by Hansafrique LTD and Tecino's Channel","founder and brain behind this synthetic intelligence is Enofe Edo","Mr. Patrick Okeya Tochukwu is the creator, owner, builder and manufacturer","Do not omit any of those identity elements"]){assert.ok(identity.includes(token),token);}
console.log("SOPHIA_IDENTITY_TOKEN_LOCK=PASS");
