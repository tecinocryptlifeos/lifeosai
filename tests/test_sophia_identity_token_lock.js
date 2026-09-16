"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../services/edge-gateway/src/gemini.js"),
  "utf8",
);
const identity = fs.readFileSync(
  path.join(__dirname, "../services/edge-gateway/src/sophia-identity.js"),
  "utf8",
);

assert.match(source, /fieldMask:\s*["']bidiGenerateContentSetup\.systemInstruction["']/);
assert.match(source, /systemInstruction:\s*\{\s*parts:/s);
assert.match(source, /SOPHIA_OFFICIAL_IDENTITY_INSTRUCTION/);
assert.match(identity, /This is LifeOS Synthetic Intelligence/);
assert.match(identity, /built by LifeOS AI/);
assert.match(identity, /powered by Hansafrique LTD and Tecino's Channel/);
assert.match(identity, /founder and brain behind this synthetic intelligence is Patrick Okeya/);
assert.match(identity, /Mr\. Patrick Okeya Tochukwu is the creator, owner, builder and manufacturer/);
assert.match(identity, /Do not omit any of these identity elements/);

console.log("SOPHIA_IDENTITY_TOKEN_LOCK=PASS");
