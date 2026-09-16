"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const gemini = fs.readFileSync(path.join(__dirname, "../services/edge-gateway/src/gemini.js"), "utf8");
const identity = fs.readFileSync(path.join(__dirname, "../services/edge-gateway/src/sophia-identity.js"), "utf8");
const voice = fs.readFileSync(path.join(__dirname, "../services/edge-gateway/src/sophia-voice.js"), "utf8");

assert.match(identity, /LifeOS Synthetic Intelligence/);
assert.match(identity, /Built by LifeOS AI/);
assert.match(identity, /Powered by Hansafrique LTD and Tecino's Channel/);
assert.match(identity, /Founder and brain: Patrick Okeya/);
assert.match(identity, /Mr\. Patrick Okeya Tochukwu is the creator, owner, builder and manufacturer/);
assert.doesNotMatch(identity, /Enofe Edo/);
assert.match(gemini, /SOPHIA_OFFICIAL_IDENTITY_INSTRUCTION/);
assert.match(gemini, /SOPHIA_VOICE_INSTRUCTION/);
assert.match(gemini, /fieldMask:.*bidiGenerateContentSetup\.systemInstruction/);
assert.match(gemini, /bidiGenerateContentSetup\.generationConfig\.speechConfig\.voiceConfig\.prebuiltVoiceConfig\.voiceName/);
assert.match(gemini, /voiceName: SOPHIA_PREBUILT_VOICE_NAME/);
assert.match(voice, /SOPHIA_PREBUILT_VOICE_NAME = "Despina"/);
assert.match(voice, /natural contemporary native London English/);
assert.match(voice, /clear mother-tongue London articulation/);
assert.match(voice, /Preserve the same voice, timbre, apparent age, accent, and vocal character/);
assert.match(voice, /Do not drift.*American, neutral international, Scottish/);
console.log("SOPHIA_IDENTITY_VOICE_LOCK=PASS");
