(function (global) {
  "use strict";

  const VERSION = "2.0.6";

  function splitForReveal(value) {
    const text = String(value || "");
    return text.match(/\S+\s*/gu) || (text ? [text] : []);
  }

  function reducedMotion() {
    return Boolean(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function pause(milliseconds) {
    return new Promise((resolve) => global.setTimeout(resolve, milliseconds));
  }

  async function reveal(node, value, options) {
    if (!node) throw new Error("A message element is required.");
    const text = String(value || "");
    const settings = options || {};
    const pieces = splitForReveal(text);
    const delay = Math.max(8, Math.min(80, Number(settings.delay) || 24));
    let skipRequested = false;
    const skip = function () { skipRequested = true; };

    node.textContent = "";
    node.classList.add("lifeos-revealing");
    node.setAttribute("aria-busy", "true");
    node.title = "Tap to show the complete response";
    node.addEventListener("click", skip, { once: true });

    try {
      if (reducedMotion() || pieces.length < 2) {
        node.textContent = text;
      } else {
        for (const piece of pieces) {
          if (skipRequested) break;
          node.textContent += piece;
          if (typeof settings.onProgress === "function") settings.onProgress(node.textContent);
          await pause(delay);
        }
        node.textContent = text;
      }
    } finally {
      node.removeEventListener("click", skip);
      node.classList.remove("lifeos-revealing");
      node.removeAttribute("aria-busy");
      node.removeAttribute("title");
      if (typeof settings.onComplete === "function") settings.onComplete(text);
    }
    return text;
  }

  global.LifeOSChatDelivery = Object.freeze({ VERSION, reveal, splitForReveal });
}(window));
