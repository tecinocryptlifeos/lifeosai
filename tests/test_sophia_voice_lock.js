import assert from "node:assert/strict";
import { SOPHIA_VOICE_INSTRUCTION, SOPHIA_PREBUILT_VOICE_NAME } from "../services/edge-gateway/src/sophia-voice.js";

assert.equal(SOPHIA_PREBUILT_VOICE_NAME, "Despina");
assert.match(SOPHIA_VOICE_INSTRUCTION, /natural contemporary native London English/i);
assert.match(SOPHIA_VOICE_INSTRUCTION, /clear mother-tongue London articulation/i);
assert.match(SOPHIA_VOICE_INSTRUCTION, /Preserve the same voice, timbre, apparent age, accent, and vocal character/i);
assert.match(SOPHIA_VOICE_INSTRUCTION, /Do not drift.*American, neutral international, Scottish/i);
console.log("Sophia London voice lock regression passed");
