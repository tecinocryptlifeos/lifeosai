/* LIFEOS_GOLDEN_VOICE_VISUALIZER_V5 */
/* LIFEOS_MOBILE_VOICE_POWER_V1 */
(function () {
  "use strict";

  const VERSION = "1.1.0-low-power";
  const GOLD = [244, 190, 72];
  const SOFT_GOLD = [255, 224, 143];
  const ACTIVE_FRAME_INTERVAL_MS = 50;
  const IDLE_FRAME_INTERVAL_MS = 250;
  const MOBILE_MEDIA = window.matchMedia("(max-width:700px), (hover:none) and (pointer:coarse)");

  let orb = null;
  let orbCanvas = null;
  let orbCtx = null;
  let ambientCanvas = null;
  let ambientCtx = null;
  let active = false;
  let micAnalyser = null;
  let micData = null;
  let aiAnalyser = null;
  let aiData = null;
  let micSource = null;
  let aiTapGain = null;
  let lastTime = performance.now();
  let micLevel = 0;
  let aiLevel = 0;
  let smoothMic = 0;
  let smoothAi = 0;
  let particles = [];
  let smoke = [];
  let topWavePhase = 0;
  let animationFrame = 0;
  let frameTimer = 0;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rmsFromTimeData(analyser, data) {
    if (!analyser || !data) return 0;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      const normalized = (data[i] - 128) / 128;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / data.length);
  }

  function ensureCanvasSize(canvas, ctx) {
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dprCap = MOBILE_MEDIA.matches ? 1.25 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function buildVisualLayer() {
    orb = document.getElementById("orb");
    if (!orb || document.getElementById("lifeosGoldenOrbCanvasV1")) return;

    orb.style.position = "relative";
    orb.style.overflow = "visible";
    orb.style.transformOrigin = "center center";
    orb.style.willChange = "transform, filter";

    orbCanvas = document.createElement("canvas");
    orbCanvas.id = "lifeosGoldenOrbCanvasV1";
    orbCanvas.setAttribute("aria-hidden", "true");
    Object.assign(orbCanvas.style, {
      position: "absolute",
      inset: "-8%",
      width: "116%",
      height: "116%",
      borderRadius: "50%",
      pointerEvents: "none",
      zIndex: "3"
    });
    orb.appendChild(orbCanvas);
    orbCtx = orbCanvas.getContext("2d", { alpha: true });

    ambientCanvas = document.createElement("canvas");
    ambientCanvas.id = "lifeosGoldenAmbientCanvasV1";
    ambientCanvas.setAttribute("aria-hidden", "true");
    Object.assign(ambientCanvas.style, {
      position: "fixed",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "1",
      opacity: "0",
      transition: "opacity 500ms ease"
    });
    document.body.appendChild(ambientCanvas);
    ambientCtx = ambientCanvas.getContext("2d", { alpha: true });

    const main = document.querySelector("main");
    if (main) {
      main.style.position = "relative";
      main.style.zIndex = "2";
    }

    createParticles();
    createSmoke();
  }

  function createParticles() {
    particles = [];
    const count = MOBILE_MEDIA.matches ? 30 : 72;
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x: Math.random(),
        y: Math.random(),
        radius: 0.45 + Math.random() * 1.55,
        speed: 0.008 + Math.random() * 0.018,
        drift: (Math.random() - 0.5) * 0.015,
        alpha: 0.08 + Math.random() * 0.44,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  function createSmoke() {
    smoke = [];
    const count = MOBILE_MEDIA.matches ? 16 : 28;
    for (let i = 0; i < count; i += 1) {
      smoke.push({
        angle: Math.random() * Math.PI * 2,
        radius: 0.05 + Math.random() * 0.38,
        size: 8 + Math.random() * 24,
        speed: 0.09 + Math.random() * 0.24,
        phase: Math.random() * Math.PI * 2,
        alpha: 0.035 + Math.random() * 0.11
      });
    }
  }

  function activate() {
    if (!active) {
      active = true;
      if (ambientCanvas) ambientCanvas.style.opacity = "1";
      document.documentElement.classList.add("lifeos-golden-live-v1");
      clearFrameSchedule();
      scheduleFrame(0);
    }
  }

  function deactivate() {
    active = false;
    smoothMic = 0;
    smoothAi = 0;
    if (ambientCanvas) ambientCanvas.style.opacity = "0";
    document.documentElement.classList.remove("lifeos-golden-live-v1");
    if (orb) {
      orb.style.transform = "scale(1)";
      orb.style.filter = "";
    }
  }

  function attachMicrophoneNode(node, context) {
    try {
      detachMicrophone();
      if (!node || !context) return;
      micSource = node;
      micAnalyser = context.createAnalyser();
      micAnalyser.fftSize = 256;
      micAnalyser.smoothingTimeConstant = 0.45;
      micData = new Uint8Array(micAnalyser.fftSize);
      micSource.connect(micAnalyser);
    } catch (error) {
      detachMicrophone();
      console.warn("LifeOS visualizer microphone analyser unavailable:", error);
    }
  }

  function detachMicrophone() {
    if (micSource && micAnalyser) {
      try { micSource.disconnect(micAnalyser); } catch (error) {}
    }
    if (micAnalyser) {
      try { micAnalyser.disconnect(); } catch (error) {}
    }
    micSource = null;
    micAnalyser = null;
    micData = null;
    micLevel = 0;
    smoothMic = 0;
  }

  function attachSophiaNode(node, context) {
    try {
      if (!node || !context || aiAnalyser) return;
      aiAnalyser = context.createAnalyser();
      aiAnalyser.fftSize = 256;
      aiAnalyser.smoothingTimeConstant = 0.52;
      aiData = new Uint8Array(aiAnalyser.fftSize);

      aiTapGain = context.createGain();
      aiTapGain.gain.value = 0;
      node.connect(aiAnalyser);
      aiAnalyser.connect(aiTapGain);
      aiTapGain.connect(context.destination);
    } catch (error) {
      console.warn("LifeOS visualizer Sophia analyser unavailable:", error);
    }
  }

  function bindStartButton() {
    const button = document.getElementById("liveButton");
    if (!button || button.dataset.goldenVisualizerBound === "1") return;
    button.dataset.goldenVisualizerBound = "1";

    button.addEventListener(
      "click",
      function () {
        const text = (button.textContent || "").toLowerCase();
        if (text.includes("stop") || text.includes("end")) deactivate();
        else activate();
      },
      { capture: true }
    );
  }

  function drawAmbient(now, dt) {
    if (!ambientCtx || !ambientCanvas) return;
    ensureCanvasSize(ambientCanvas, ambientCtx);

    const width = window.innerWidth;
    const height = window.innerHeight;
    ambientCtx.clearRect(0, 0, width, height);
    if (!active) return;

    topWavePhase += dt * 0.00045;
    const waveY = Math.max(52, Math.min(118, height * 0.095));

    ambientCtx.save();
    ambientCtx.lineCap = "round";
    for (let layer = 0; layer < 3; layer += 1) {
      ambientCtx.beginPath();
      for (let x = -20; x <= width + 20; x += 8) {
        const y =
          waveY +
          layer * 8 +
          Math.sin(x * 0.018 + topWavePhase * (1.1 + layer * 0.14)) *
            (5 + layer * 2.5) +
          Math.sin(x * 0.006 - topWavePhase * 0.7) * 3;
        if (x === -20) ambientCtx.moveTo(x, y);
        else ambientCtx.lineTo(x, y);
      }
      ambientCtx.strokeStyle =
        `rgba(${GOLD[0]},${GOLD[1]},${GOLD[2]},${0.10 + layer * 0.035})`;
      ambientCtx.lineWidth = 1.2 + layer * 0.65;
      ambientCtx.shadowColor = "rgba(255,191,64,.42)";
      ambientCtx.shadowBlur = 9 + layer * 5;
      ambientCtx.stroke();
    }
    ambientCtx.restore();

    for (const particle of particles) {
      particle.y -= particle.speed * dt * 0.06;
      particle.x +=
        (particle.drift + Math.sin(now * 0.0005 + particle.phase) * 0.004) *
        dt *
        0.02;

      if (particle.y < -0.03) {
        particle.y = 1.03;
        particle.x = Math.random();
      }
      if (particle.x < -0.03) particle.x = 1.03;
      if (particle.x > 1.03) particle.x = -0.03;

      const x = particle.x * width;
      const y = particle.y * height;
      const twinkle =
        0.48 + 0.52 * Math.sin(now * 0.0018 + particle.phase);
      const alpha = particle.alpha * twinkle;

      ambientCtx.beginPath();
      ambientCtx.arc(x, y, particle.radius, 0, Math.PI * 2);
      ambientCtx.fillStyle =
        `rgba(${SOFT_GOLD[0]},${SOFT_GOLD[1]},${SOFT_GOLD[2]},${alpha})`;
      ambientCtx.shadowColor = "rgba(255,190,54,.72)";
      ambientCtx.shadowBlur = 5 + particle.radius * 5;
      ambientCtx.fill();
    }
    ambientCtx.shadowBlur = 0;
  }

  function drawOrb(now, dt) {
    if (!orbCtx || !orbCanvas || !orb) return;
    ensureCanvasSize(orbCanvas, orbCtx);

    const rect = orbCanvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const cx = width / 2;
    const cy = height / 2;
    const baseRadius = Math.min(width, height) * 0.39;

    orbCtx.clearRect(0, 0, width, height);

    micLevel = active ? rmsFromTimeData(micAnalyser, micData) : 0;
    aiLevel = active ? rmsFromTimeData(aiAnalyser, aiData) : 0;

    smoothMic += (micLevel - smoothMic) * (micLevel > smoothMic ? 0.42 : 0.13);
    smoothAi += (aiLevel - smoothAi) * (aiLevel > smoothAi ? 0.36 : 0.10);

    const userVoice = clamp((smoothMic - 0.018) * 8.5, 0, 1);
    const sophiaVoice = clamp((smoothAi - 0.010) * 11.0, 0, 1);

    const beatScale = active ? 1 + userVoice * 0.105 : 1;
    orb.style.transform = `scale(${beatScale.toFixed(4)})`;
    orb.style.filter = active
      ? `drop-shadow(0 0 ${12 + userVoice * 24}px rgba(244,190,72,${0.28 + userVoice * 0.38}))`
      : "";

    if (!active) return;

    const idle = 0.13;
    const energy = Math.max(idle, sophiaVoice);

    const ringRadius = baseRadius * (1 + userVoice * 0.045);
    orbCtx.save();
    orbCtx.beginPath();
    orbCtx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
    orbCtx.strokeStyle =
      `rgba(255,207,92,${0.18 + userVoice * 0.58})`;
    orbCtx.lineWidth = 1.4 + userVoice * 4.8;
    orbCtx.shadowColor = "rgba(255,190,45,.88)";
    orbCtx.shadowBlur = 12 + userVoice * 28;
    orbCtx.stroke();
    orbCtx.restore();

    const smokeSpeed = 0.00045 + sophiaVoice * 0.0032;
    for (let i = 0; i < smoke.length; i += 1) {
      const puff = smoke[i];
      puff.angle += dt * smokeSpeed * puff.speed;
      const breathing =
        Math.sin(now * 0.0012 + puff.phase) * (0.025 + sophiaVoice * 0.06);
      const radius =
        baseRadius * clamp(puff.radius + breathing, 0.02, 0.55);
      const x =
        cx +
        Math.cos(puff.angle + Math.sin(now * 0.0007 + puff.phase) * 0.45) *
          radius;
      const y =
        cy +
        Math.sin(puff.angle * 1.18 + puff.phase) *
          radius *
          (0.63 + sophiaVoice * 0.22);
      const size = puff.size * (0.7 + energy * 1.9);
      const gradient = orbCtx.createRadialGradient(
        x,
        y,
        0,
        x,
        y,
        size
      );

      gradient.addColorStop(
        0,
        `rgba(255,220,118,${puff.alpha * (1.2 + energy * 2.8)})`
      );
      gradient.addColorStop(
        0.36,
        `rgba(244,177,49,${puff.alpha * (0.8 + energy * 2.0)})`
      );
      gradient.addColorStop(1, "rgba(120,67,0,0)");

      orbCtx.fillStyle = gradient;
      orbCtx.beginPath();
      orbCtx.arc(x, y, size, 0, Math.PI * 2);
      orbCtx.fill();
    }

    const dustCount = 42;
    for (let i = 0; i < dustCount; i += 1) {
      const phase = i * 2.39996 + now * (0.00018 + sophiaVoice * 0.0007);
      const radial =
        baseRadius *
        (0.14 + ((i * 37) % 100) / 100 * (0.68 + sophiaVoice * 0.12));
      const x = cx + Math.cos(phase) * radial;
      const y =
        cy +
        Math.sin(phase * 1.08) *
          radial *
          (0.56 + sophiaVoice * 0.20);
      const size = 0.6 + ((i * 17) % 9) / 9 * (1.4 + sophiaVoice * 2.0);
      const alpha =
        0.10 +
        energy * 0.42 +
        Math.sin(now * 0.002 + i) * 0.05;

      orbCtx.beginPath();
      orbCtx.arc(x, y, size, 0, Math.PI * 2);
      orbCtx.fillStyle = `rgba(255,218,105,${clamp(alpha, 0.04, 0.72)})`;
      orbCtx.shadowColor = "rgba(255,184,48,.8)";
      orbCtx.shadowBlur = 4 + sophiaVoice * 10;
      orbCtx.fill();
    }
    orbCtx.shadowBlur = 0;
  }

  function clearFrameSchedule() {
    if (frameTimer) clearTimeout(frameTimer);
    if (animationFrame) cancelAnimationFrame(animationFrame);
    frameTimer = 0;
    animationFrame = 0;
  }

  function scheduleFrame(delay) {
    if (document.hidden || frameTimer || animationFrame) return;
    const wait = Number.isFinite(delay)
      ? Math.max(0, delay)
      : active
        ? ACTIVE_FRAME_INTERVAL_MS
        : IDLE_FRAME_INTERVAL_MS;

    frameTimer = window.setTimeout(function () {
      frameTimer = 0;
      if (!document.hidden) animationFrame = requestAnimationFrame(frame);
    }, wait);
  }

  function frame(now) {
    animationFrame = 0;
    if (document.hidden) return;
    const dt = Math.min(100, Math.max(0, now - lastTime));
    lastTime = now;
    drawAmbient(now, dt);
    drawOrb(now, dt);
    scheduleFrame();
  }

  function syncVisibility() {
    document.documentElement.classList.toggle(
      "lifeos-voice-page-hidden",
      document.hidden
    );

    clearFrameSchedule();
    if (!document.hidden) {
      lastTime = performance.now();
      scheduleFrame(0);
    }
  }

  function init() {
    buildVisualLayer();
    bindStartButton();
    document.addEventListener("visibilitychange", syncVisibility, { passive: true });
    syncVisibility();
  }

  window.LifeOSGoldenVisualizer = {
    version: VERSION,
    activate,
    deactivate,
    attachMicrophoneNode,
    detachMicrophone,
    attachSophiaNode
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
}());
