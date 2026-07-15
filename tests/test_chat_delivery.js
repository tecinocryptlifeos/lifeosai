"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
}

class FakeNode {
  constructor() {
    this.textContent = "";
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.listeners = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
}

global.window = global;
global.matchMedia = () => ({ matches: false });
const source = fs.readFileSync(
  path.join(__dirname, "../web/lifeos_voice/assets/lifeos_chat_delivery_v2.js"),
  "utf8",
);
vm.runInThisContext(source, { filename: "lifeos_chat_delivery_v2.js" });

async function main() {
  const node = new FakeNode();
  const progress = [];
  const igbo = "Sophia ga-egosi azịza a nwayọọ nwayọọ.";
  await window.LifeOSChatDelivery.reveal(node, igbo, {
    delay: 8,
    onProgress: value => progress.push(value),
  });
  assert.equal(node.textContent, igbo);
  assert.ok(progress.length > 2, "the response should be revealed in multiple steps");
  assert.equal(node.attributes.has("aria-busy"), false);
  assert.equal(node.classList.values.has("lifeos-revealing"), false);
  console.log("LifeOS incremental chat delivery simulation passed");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
