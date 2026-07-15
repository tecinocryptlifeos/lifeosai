"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeClassList {
  toggle() {}
}

class FakeElement {
  constructor() {
    this.textContent = "";
    this.disabled = false;
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.srcObject = null;
    this.muted = false;
    this.volume = 1;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  pause() {}
  async play() {}
}

const scheduledRampValues = [];
function audioParam(value = 0) {
  return {
    value,
    setTargetAtTime() {},
    setValueAtTime() {},
    exponentialRampToValueAtTime(nextValue) { scheduledRampValues.push(nextValue); },
  };
}

function audioNode() {
  return {
    gain: audioParam(1),
    frequency: audioParam(),
    Q: audioParam(),
    threshold: audioParam(),
    knee: audioParam(),
    ratio: audioParam(),
    attack: audioParam(),
    release: audioParam(),
    connect() {},
    disconnect() {},
  };
}

let oscillatorStarts = 0;
class FakeAudioContext {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 48000;
    this.currentTime = 0;
    this.state = "running";
    this.destination = {};
  }

  createGain() { return audioNode(); }
  createBiquadFilter() { return audioNode(); }
  createDynamicsCompressor() { return audioNode(); }
  createMediaStreamSource() { return audioNode(); }
  createScriptProcessor() { return audioNode(); }
  createOscillator() {
    const node = audioNode();
    node.start = () => { oscillatorStarts += 1; };
    node.stop = () => {};
    return node;
  }
  async resume() { this.state = "running"; }
  async close() { this.state = "closed"; }
}

const sockets = [];
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.listeners = new Map();
    this.sent = [];
    this.closeCall = null;
    sockets.push(this);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  message(payload) {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close(code, reason) {
    this.closeCall = { code, reason };
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { code, reason });
  }
}

const elements = new Map();
for (const id of ["liveButton", "micButton", "speakerButton", "outputButton", "outputLabel", "status", "orb", "sophiaAudio"]) {
  elements.set(id, new FakeElement());
}

let tokenRequests = 0;
let microphoneRequests = 0;
const track = { enabled: true, stop() {} };

global.document = { getElementById: id => elements.get(id) };
global.location = { pathname: "/voice" };
global.history = { replaceState() {} };
Object.defineProperty(global, "navigator", {
  configurable: true,
  value: {
    mediaDevices: {
      async getUserMedia() {
        microphoneRequests += 1;
        return {
          getAudioTracks: () => [track],
          getTracks: () => [track],
        };
      },
    },
  },
});

global.WebSocket = FakeWebSocket;
global.window = global;
window.isSecureContext = true;
window.AudioContext = FakeAudioContext;
window.addEventListener = () => {};
window.LifeOSGoldenVisualizer = {
  attachSophiaNode() {},
  attachMicrophoneNode() {},
  detachMicrophone() {},
};
window.LifeOSAuth = {
  session: { user: { id: "test-user" } },
  async whenReady() {},
  async authFetch() {
    tokenRequests += 1;
    return {
      ok: true,
      async json() {
        return {
          ok: true,
          token: `token-${tokenRequests}`,
          websocket_url: "wss://live.example.test",
          model: "gemini-live-test",
        };
      },
    };
  },
  event() {},
};

const source = fs.readFileSync(
  path.join(__dirname, "../web/lifeos_voice/assets/gemini_live_v1.js"),
  "utf8"
);
vm.runInThisContext(source, { filename: "gemini_live_v1.js" });

const flush = () => new Promise(resolve => setImmediate(resolve));

async function main() {
  await window.LifeOSGeminiLiveV1.start();
  assert.equal(sockets.length, 1, "the initial connection should be created");
  assert.equal(oscillatorStarts, 1, "starting should play one quiet progress tone");

  const first = sockets[0];
  first.open();
  assert.deepEqual(first.sent[0].setup.sessionResumption, {});
  assert.deepEqual(first.sent[0].setup.contextWindowCompression, { slidingWindow: {} });
  assert.deepEqual(first.sent[0].setup.tools, [{ googleSearch: {} }]);
  assert.equal(first.sent[0].setup.generationConfig.thinkingConfig.thinkingLevel, "medium");
  assert.match(first.sent[0].setup.systemInstruction.parts[0].text, /PREMIUM IGBO PRIORITY/);
  assert.match(first.sent[0].setup.systemInstruction.parts[0].text, /Google Search grounding is available/);

  first.message({ setupComplete: {} });
  await flush();
  await flush();
  assert.equal(microphoneRequests, 1, "the microphone should open once");
  assert.equal(oscillatorStarts, 4, "the connected cue should add three clear tones");
  assert.ok(Math.max(...scheduledRampValues) >= 0.22, "the connected cue must reach an audible protected level");

  first.message({
    sessionResumptionUpdate: { resumable: true, newHandle: "resume-handle-1" },
  });
  await flush();
  first.message({ goAway: { timeLeft: "5s" } });
  await flush();
  await flush();

  assert.deepEqual(first.closeCall, {
    code: 1000,
    reason: "Gemini GoAway acknowledged",
  });
  assert.equal(sockets.length, 2, "a fresh connection should replace the retiring one");
  assert.equal(tokenRequests, 2, "the renewed connection should use a fresh ephemeral token");

  const second = sockets[1];
  second.open();
  assert.equal(second.sent[0].setup.sessionResumption.handle, "resume-handle-1");
  assert.deepEqual(second.sent[0].setup.contextWindowCompression, { slidingWindow: {} });
  assert.deepEqual(second.sent[0].setup.tools, [{ googleSearch: {} }]);

  second.message({ setupComplete: {} });
  await flush();
  await flush();
  assert.equal(microphoneRequests, 1, "renewal must reuse the existing microphone stream");
  assert.equal(oscillatorStarts, 7, "the resumed connection should play the connected cue");
  assert.match(elements.get("status").textContent, /resumed/i);

  window.LifeOSGeminiLiveV1.stop();
  assert.equal(second.closeCall.code, 1000);
  console.log("Gemini Live GoAway renewal simulation passed");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
