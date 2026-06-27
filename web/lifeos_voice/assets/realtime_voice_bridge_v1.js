/*
 * LifeOS Realtime Voice UI Bridge V1.
 * Loaded only after LIFEOS_REALTIME_FRONTEND_ENABLED becomes true.
 * It never connects until the visitor presses Start Conversation.
 */
(function (global) {
  "use strict";

  if (global.LIFEOS_REALTIME_FRONTEND_ENABLED !== true) return;

  const API = global.LifeOSRealtimeVoiceV1;
  if (!API || typeof API.RealtimeVoiceController !== "function") {
    if (global.console) {
      global.console.error("LifeOS realtime controller is unavailable.");
    }
    return;
  }

  const ACCENTS = Object.freeze([
    {
      id: "en-GB-london",
      label: "London English",
      instruction:
        "Speak in natural contemporary London English with warm, clear articulation, varied intonation and measured pacing."
    },
    {
      id: "en-GB-neutral",
      label: "British English",
      instruction:
        "Speak in natural modern British English with clear articulation, balanced pacing and a warm conversational tone."
    },
    {
      id: "en-NG",
      label: "Nigerian English",
      instruction:
        "Speak in natural polished Nigerian English with clear articulation, warm rhythm and a professional conversational tone."
    },
    {
      id: "en-US",
      label: "American English",
      instruction:
        "Speak in natural contemporary American English with clear articulation, varied intonation and relaxed pacing."
    },
    {
      id: "en-AU",
      label: "Australian English",
      instruction:
        "Speak in natural contemporary Australian English with clear articulation, varied intonation and relaxed pacing."
    }
  ]);

  const STORAGE_KEY = "lifeos_realtime_accent_v1";
  const STATE_CLASSES = [
    "lifeos-rt-idle",
    "lifeos-rt-connecting",
    "lifeos-rt-user",
    "lifeos-rt-analysing",
    "lifeos-rt-sophia",
    "lifeos-rt-interrupted",
    "lifeos-rt-error"
  ];

  function ready(callback) {
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", callback, {
        once: true
      });
    } else {
      callback();
    }
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function clamp(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(1, numeric));
  }

  ready(function () {
    const document = global.document;
    const page = document.getElementById("lifeosVC");

    if (!page) {
      if (global.console) {
        global.console.error("LifeOS voice page was not found.");
      }
      return;
    }

    const orb = page.querySelector(".vcOrb");
    const logo = page.querySelector("#lifeosVCLogo");
    const status = page.querySelector(".vcStatus");
    const note = page.querySelector(".vcNote");
    const buttons = Array.from(page.querySelectorAll("button"));

    function findButton(labels) {
      const expected = labels.map(normalizeText);
      return buttons.find(function (button) {
        return expected.indexOf(normalizeText(button.textContent)) !== -1;
      }) || null;
    }

    const startButton = findButton([
      "Start Conversation",
      "Pause Conversation"
    ]);
    const micButton = findButton([
      "Mute Mic",
      "Unmute Mic"
    ]);
    const speakerButton = findButton([
      "Speaker On",
      "Speaker Off"
    ]);

    if (
      !orb ||
      !logo ||
      !status ||
      !note ||
      !startButton ||
      !micButton ||
      !speakerButton
    ) {
      if (global.console) {
        global.console.error(
          "LifeOS realtime UI bridge could not verify every required control."
        );
      }
      return;
    }

    const style = document.createElement("style");
    style.id = "lifeos-realtime-ui-bridge-v1-style";
    style.textContent = `
body.lifeos-realtime-active #lifeosVC .vcOrb {
  --lifeos-rt-user-ring-scale: .82;
  --lifeos-rt-user-ring-scale-outer: .9;
  --lifeos-rt-user-ring-opacity: 0;
  --lifeos-rt-user-ring-opacity-outer: 0;
  --lifeos-rt-sophia-logo-scale: 1;
  perspective: 900px !important;
  transform-style: preserve-3d !important;
}

body.lifeos-realtime-active #lifeosVC .vcOrb::before,
body.lifeos-realtime-active #lifeosVC .vcOrb::after {
  animation: none !important;
  opacity: 0 !important;
  transition:
    transform 70ms linear,
    opacity 70ms linear !important;
}

body.lifeos-realtime-active #lifeosVC .vcOrb.lifeos-rt-user::before {
  opacity: var(--lifeos-rt-user-ring-opacity) !important;
  transform:
    translate(-50%, -50%)
    scale(var(--lifeos-rt-user-ring-scale)) !important;
}

body.lifeos-realtime-active #lifeosVC .vcOrb.lifeos-rt-user::after {
  opacity: var(--lifeos-rt-user-ring-opacity-outer) !important;
  transform:
    translate(-50%, -50%)
    scale(var(--lifeos-rt-user-ring-scale-outer)) !important;
}

body.lifeos-realtime-active #lifeosVC .vcOrb.lifeos-rt-analysing::before,
body.lifeos-realtime-active #lifeosVC .vcOrb.lifeos-rt-analysing::after,
body.lifeos-realtime-active #lifeosVC .vcOrb.lifeos-rt-sophia::before,
body.lifeos-realtime-active #lifeosVC .vcOrb.lifeos-rt-sophia::after {
  opacity: 0 !important;
  animation: none !important;
}

body.lifeos-realtime-active #lifeosVC .vcOrb.lifeos-rt-analysing #lifeosVCLogo {
  animation:
    lifeosRealtimeCoinRotateV1 1.08s linear infinite !important;
  transform-origin: center center !important;
  transform-style: preserve-3d !important;
  backface-visibility: visible !important;
}

body.lifeos-realtime-active #lifeosVC .vcOrb.lifeos-rt-sophia #lifeosVCLogo {
  animation: none !important;
  transform:
    scale(var(--lifeos-rt-sophia-logo-scale)) !important;
  transition: transform 55ms linear !important;
  filter:
    drop-shadow(0 0 24px rgba(255, 198, 55, .82)) !important;
}

body.lifeos-realtime-active #lifeosVC .vcOrb.lifeos-rt-user #lifeosVCLogo,
body.lifeos-realtime-active #lifeosVC .vcOrb.lifeos-rt-interrupted #lifeosVCLogo,
body.lifeos-realtime-active #lifeosVC .vcOrb.lifeos-rt-idle #lifeosVCLogo,
body.lifeos-realtime-active #lifeosVC .vcOrb.lifeos-rt-connecting #lifeosVCLogo,
body.lifeos-realtime-active #lifeosVC .vcOrb.lifeos-rt-error #lifeosVCLogo {
  animation: none !important;
  transform: scale(1) rotateY(0deg) !important;
}

#lifeosRealtimeAccentWrapV1 {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

#lifeosRealtimeAccentWrapV1 span {
  font-size: .72rem;
  font-weight: 750;
  white-space: nowrap;
}

#lifeosRealtimeAccentV1 {
  min-width: 0;
  max-width: 160px;
  min-height: 36px;
  padding: 6px 8px;
  border: 1px solid rgba(255, 198, 62, .68);
  border-radius: 9px;
  background: rgba(9, 12, 18, .92);
  color: #fff3bf;
  font: inherit;
  font-size: .76rem;
}

@keyframes lifeosRealtimeCoinRotateV1 {
  0% {
    transform: rotateY(0deg) scale(1);
  }
  50% {
    transform: rotateY(180deg) scale(1.025);
  }
  100% {
    transform: rotateY(360deg) scale(1);
  }
}
`;
    document.head.appendChild(style);

    const accentWrap = document.createElement("label");
    accentWrap.id = "lifeosRealtimeAccentWrapV1";

    const accentLabel = document.createElement("span");
    accentLabel.textContent = "Sophia accent";

    const accentSelect = document.createElement("select");
    accentSelect.id = "lifeosRealtimeAccentV1";
    accentSelect.setAttribute("aria-label", "Choose Sophia's accent");

    ACCENTS.forEach(function (accent) {
      const option = document.createElement("option");
      option.value = accent.id;
      option.textContent = accent.label;
      accentSelect.appendChild(option);
    });

    accentWrap.appendChild(accentLabel);
    accentWrap.appendChild(accentSelect);

    const controlsHost =
      startButton.parentElement || page;
    controlsHost.appendChild(accentWrap);

    let storedAccent = "";
    try {
      storedAccent = global.localStorage.getItem(STORAGE_KEY) || "";
    } catch (error) {}

    const initialAccent =
      ACCENTS.find(function (accent) {
        return accent.id === storedAccent;
      }) || ACCENTS[0];

    accentSelect.value = initialAccent.id;

    function setStatus(label, active, detail) {
      if (typeof global.lifeosVCSetStatus === "function") {
        global.lifeosVCSetStatus(label, active, detail);
        return;
      }

      status.textContent = label;
      if (detail) note.textContent = detail;
      orb.classList.toggle("on", Boolean(active));
    }

    function clearStateClasses() {
      STATE_CLASSES.forEach(function (name) {
        orb.classList.remove(name);
      });
    }

    function resetLevels() {
      orb.style.setProperty("--lifeos-rt-user-ring-scale", ".82");
      orb.style.setProperty("--lifeos-rt-user-ring-scale-outer", ".9");
      orb.style.setProperty("--lifeos-rt-user-ring-opacity", "0");
      orb.style.setProperty("--lifeos-rt-user-ring-opacity-outer", "0");
      orb.style.setProperty("--lifeos-rt-sophia-logo-scale", "1");
    }

    function applyState(nextState) {
      clearStateClasses();
      resetLevels();

      switch (nextState) {
        case API.states.CONNECTING:
          orb.classList.add("lifeos-rt-connecting");
          setStatus(
            "CONNECTING",
            true,
            "Preparing the realtime conversation."
          );
          break;

        case API.states.USER_SPEAKING:
          orb.classList.add("lifeos-rt-user");
          setStatus(
            "YOU ARE SPEAKING",
            true,
            "Sophia is listening and can be interrupted naturally."
          );
          break;

        case API.states.ANALYSING:
          orb.classList.add("lifeos-rt-analysing");
          setStatus(
            "SOPHIA IS ANALYSING",
            true,
            "Building the decision response."
          );
          break;

        case API.states.SOPHIA_SPEAKING:
          orb.classList.add("lifeos-rt-sophia");
          setStatus(
            "SOPHIA IS SPEAKING",
            true,
            "Speak at any moment to interrupt."
          );
          break;

        case API.states.INTERRUPTED:
          orb.classList.add("lifeos-rt-interrupted");
          setStatus(
            "INTERRUPTED — LISTENING",
            true,
            "Sophia stopped immediately and is listening."
          );
          break;

        case API.states.ERROR:
          orb.classList.add("lifeos-rt-error");
          setStatus(
            "REALTIME VOICE ERROR",
            false,
            "Realtime voice could not start. Check the server configuration and try again."
          );
          break;

        default:
          orb.classList.add("lifeos-rt-idle");
          setStatus(
            "LISTENING",
            true,
            "Speak naturally. Sophia is ready."
          );
      }
    }

    let realtimeActive = false;
    let connecting = false;
    let microphoneMuted = false;
    let speakerMuted = false;
    let fallbackMode = false;

    const controller = new API.RealtimeVoiceController({
      endpoint: "/api/realtime-session",

      onStateChange: function (payload) {
        applyState(payload.state);
      },

      onMicrophoneLevel: function (payload) {
        const state = controller.state;
        const level =
          state === API.states.USER_SPEAKING
            ? clamp(payload.level)
            : 0;

        const visible = level < .018 ? 0 : level;
        const innerScale = .82 + visible * .52;
        const outerScale = .9 + visible * .64;
        const innerOpacity =
          visible === 0 ? 0 : Math.min(.95, .15 + visible * .82);
        const outerOpacity =
          visible === 0 ? 0 : Math.min(.7, .08 + visible * .56);

        orb.style.setProperty(
          "--lifeos-rt-user-ring-scale",
          innerScale.toFixed(3)
        );
        orb.style.setProperty(
          "--lifeos-rt-user-ring-scale-outer",
          outerScale.toFixed(3)
        );
        orb.style.setProperty(
          "--lifeos-rt-user-ring-opacity",
          innerOpacity.toFixed(3)
        );
        orb.style.setProperty(
          "--lifeos-rt-user-ring-opacity-outer",
          outerOpacity.toFixed(3)
        );
      },

      onSophiaLevel: function (payload) {
        const level =
          controller.state === API.states.SOPHIA_SPEAKING
            ? clamp(payload.level)
            : 0;

        const scale = 1 + level * .095;
        orb.style.setProperty(
          "--lifeos-rt-sophia-logo-scale",
          scale.toFixed(3)
        );
      },

      onInterrupt: function () {
        orb.style.setProperty(
          "--lifeos-rt-sophia-logo-scale",
          "1"
        );
        clearStateClasses();
        orb.classList.add("lifeos-rt-interrupted");
      },

      onConnectionChange: function (payload) {
        if (
          payload.connectionState === "failed" ||
          payload.connectionState === "disconnected"
        ) {
          setStatus(
            "CONNECTION INTERRUPTED",
            false,
            "Realtime voice lost its connection."
          );
        }
      },

      onFallbackRequired: function () {
        fallbackMode = true;
        realtimeActive = false;
        connecting = false;
        document.body.classList.remove(
          "lifeos-realtime-active"
        );
        startButton.disabled = false;
        startButton.textContent = "Start Conversation";
        setStatus(
          "STANDARD VOICE AVAILABLE",
          false,
          "Tap Start Conversation again to use the existing voice system."
        );
      },

      onError: function (error) {
        if (global.console) {
          global.console.error(
            "LifeOS realtime voice error:",
            error
          );
        }
      }
    });

    controller.setAccent(
      initialAccent.id,
      initialAccent.label,
      initialAccent.instruction
    );

    function stopLegacyOutput() {
      const legacyAudio =
        document.getElementById("lifeosVoicePlayer");

      if (legacyAudio) {
        try {
          legacyAudio.pause();
          legacyAudio.removeAttribute("src");
        } catch (error) {}
      }

      if (
        "speechSynthesis" in global &&
        global.speechSynthesis.speaking
      ) {
        global.speechSynthesis.cancel();
      }
    }

    async function startRealtime() {
      if (connecting || realtimeActive) return;

      connecting = true;
      fallbackMode = false;
      startButton.disabled = true;
      startButton.textContent = "Connecting…";
      stopLegacyOutput();
      document.body.classList.add(
        "lifeos-realtime-active"
      );
      applyState(API.states.CONNECTING);

      try {
        await controller.connect();

        realtimeActive = true;
        microphoneMuted = false;
        speakerMuted = false;

        controller.setMicrophoneMuted(false);
        controller.setSpeakerMuted(false);

        global.lifeosVCMicMuted = false;
        global.lifeosVCSpeakerEnabled = true;

        startButton.textContent = "Pause Conversation";
        micButton.textContent = "Mute Mic";
        speakerButton.textContent = "Speaker On";
        applyState(API.states.IDLE);
      } catch (error) {
        fallbackMode = true;
        realtimeActive = false;
        document.body.classList.remove(
          "lifeos-realtime-active"
        );
        startButton.textContent = "Start Conversation";
        applyState(API.states.ERROR);
      } finally {
        connecting = false;
        startButton.disabled = false;
      }
    }

    function stopRealtime() {
      controller.disconnect();
      realtimeActive = false;
      connecting = false;
      microphoneMuted = false;
      speakerMuted = false;

      document.body.classList.remove(
        "lifeos-realtime-active"
      );

      clearStateClasses();
      resetLevels();

      startButton.disabled = false;
      startButton.textContent = "Start Conversation";
      micButton.textContent = "Mute Mic";
      speakerButton.textContent = "Speaker On";

      global.lifeosVCMicMuted = true;
      global.lifeosVCSpeakerEnabled = true;

      setStatus(
        "CONVERSATION PAUSED",
        false,
        "Tap Start Conversation to continue."
      );
    }

    function toggleMicrophone() {
      if (!realtimeActive) return;

      microphoneMuted = !microphoneMuted;
      controller.setMicrophoneMuted(microphoneMuted);
      global.lifeosVCMicMuted = microphoneMuted;

      micButton.textContent =
        microphoneMuted ? "Unmute Mic" : "Mute Mic";

      setStatus(
        microphoneMuted ? "MIC MUTED" : "MIC ACTIVE",
        !microphoneMuted,
        microphoneMuted
          ? "Only your microphone is off. Sophia remains audible."
          : "Your microphone is listening again."
      );
    }

    function toggleSpeaker() {
      if (!realtimeActive) return;

      speakerMuted = !speakerMuted;
      controller.setSpeakerMuted(speakerMuted);
      global.lifeosVCSpeakerEnabled = !speakerMuted;

      speakerButton.textContent =
        speakerMuted ? "Speaker Off" : "Speaker On";

      setStatus(
        speakerMuted ? "SPEAKER OFF" : "SPEAKER ON",
        realtimeActive,
        speakerMuted
          ? "Sophia is muted. Your microphone remains active."
          : "Sophia is audible again."
      );
    }

    accentSelect.addEventListener("change", function () {
      const accent =
        ACCENTS.find(function (item) {
          return item.id === accentSelect.value;
        }) || ACCENTS[0];

      controller.setAccent(
        accent.id,
        accent.label,
        accent.instruction
      );

      try {
        global.localStorage.setItem(
          STORAGE_KEY,
          accent.id
        );
      } catch (error) {}

      setStatus(
        "ACCENT UPDATED",
        realtimeActive,
        accent.label + " is selected."
      );
    });

    page.addEventListener(
      "click",
      function (event) {
        const target =
          event.target && event.target.closest
            ? event.target.closest("button")
            : null;

        if (
          target !== startButton &&
          target !== micButton &&
          target !== speakerButton
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) {
          event.stopImmediatePropagation();
        }

        if (target === startButton) {
          if (realtimeActive || connecting) {
            stopRealtime();
          } else {
            startRealtime();
          }
          return;
        }

        if (target === micButton) {
          toggleMicrophone();
          return;
        }

        if (target === speakerButton) {
          toggleSpeaker();
        }
      },
      true
    );

    if (typeof global.MutationObserver === "function") {
      const observer = new global.MutationObserver(
        function () {
          if (
            realtimeActive &&
            (
              page.hidden ||
              !document.body.classList.contains(
                "lifeos-vc-on"
              )
            )
          ) {
            stopRealtime();
          }
        }
      );

      observer.observe(page, {
        attributes: true,
        attributeFilter: ["hidden"]
      });

      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"]
      });
    }

    global.LifeOSRealtimeBridgeV1 = Object.freeze({
      version: "1.0.0-disabled-integration",
      controller: controller,

      start: startRealtime,
      stop: stopRealtime,

      interrupt: function (reason) {
        return controller.interrupt(
          reason || "bridge_requested"
        );
      },

      setAccent: function (
        accentId,
        accentLabelValue,
        accentInstruction
      ) {
        return controller.setAccent(
          accentId,
          accentLabelValue,
          accentInstruction
        );
      },

      snapshot: function () {
        return {
          realtimeActive: realtimeActive,
          connecting: connecting,
          fallbackMode: fallbackMode,
          controller: controller.snapshot()
        };
      }
    });
  });
}(typeof window !== "undefined" ? window : globalThis));
