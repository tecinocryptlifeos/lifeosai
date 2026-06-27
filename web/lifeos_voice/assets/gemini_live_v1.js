/* LIFEOS_GEMINI_LIVE_V1 */
(function () {
  "use strict";

  const INPUT_RATE = 16000;
  const OUTPUT_RATE = 24000;
  const button = document.getElementById("liveButton");
  const statusBox = document.getElementById("status");
  const orb = document.getElementById("orb");

  let socket = null;
  let micStream = null;
  let inputContext = null;
  let inputSource = null;
  let processor = null;
  let muteGain = null;
  let outputContext = null;
  let nextOutputTime = 0;
  let outputSources = new Set();
  let starting = false;
  let active = false;
  let setupReady = false;
  let closingNormally = false;

  function setStatus(text, state) {
    statusBox.textContent = text;
    statusBox.classList.toggle("active", state === "active");
    statusBox.classList.toggle("error", state === "error");
    orb.classList.toggle("active", state === "active");
    button.disabled = starting;
    button.textContent = active ? "End Live Conversation" : "Start Live Conversation";
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 8192));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function resampleToPcm16(input, sourceRate) {
    const ratio = sourceRate / INPUT_RATE;
    const outputLength = Math.max(1, Math.floor(input.length / ratio));
    const output = new Int16Array(outputLength);

    for (let outIndex = 0; outIndex < outputLength; outIndex += 1) {
      const start = Math.floor(outIndex * ratio);
      const end = Math.min(input.length, Math.floor((outIndex + 1) * ratio));
      let total = 0;
      let count = 0;

      for (let inIndex = start; inIndex < end; inIndex += 1) {
        total += input[inIndex];
        count += 1;
      }

      const sample = Math.max(-1, Math.min(1, count ? total / count : input[start] || 0));
      output[outIndex] = sample < 0 ? sample * 32768 : sample * 32767;
    }
    return output;
  }

  async function ensureOutputContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is not supported.");

    if (!outputContext || outputContext.state === "closed") {
      outputContext = new AudioContextClass({ sampleRate: OUTPUT_RATE });
      nextOutputTime = outputContext.currentTime;
    }
    if (outputContext.state === "suspended") await outputContext.resume();
  }

  async function playAudio(base64Audio) {
    await ensureOutputContext();
    const bytes = base64ToBytes(base64Audio);
    const sampleCount = Math.floor(bytes.length / 2);
    if (!sampleCount) return;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const samples = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 32768;
    }

    const buffer = outputContext.createBuffer(1, sampleCount, OUTPUT_RATE);
    buffer.copyToChannel(samples, 0);

    const source = outputContext.createBufferSource();
    source.buffer = buffer;
    source.connect(outputContext.destination);
    source.addEventListener("ended", function () { outputSources.delete(source); });

    const startTime = Math.max(outputContext.currentTime + 0.025, nextOutputTime);
    source.start(startTime);
    nextOutputTime = startTime + buffer.duration;
    outputSources.add(source);
  }

  function clearOutput() {
    outputSources.forEach(function (source) {
      try { source.stop(); } catch (error) {}
    });
    outputSources.clear();
    if (outputContext) nextOutputTime = outputContext.currentTime;
  }

  async function startMicrophone() {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    inputContext = new AudioContextClass();
    await inputContext.resume();

    inputSource = inputContext.createMediaStreamSource(micStream);
    processor = inputContext.createScriptProcessor(4096, 1, 1);
    muteGain = inputContext.createGain();
    muteGain.gain.value = 0;

    processor.onaudioprocess = function (event) {
      event.outputBuffer.getChannelData(0).fill(0);
      if (!setupReady || !socket || socket.readyState !== WebSocket.OPEN) return;

      const input = event.inputBuffer.getChannelData(0);
      const pcm = resampleToPcm16(input, inputContext.sampleRate);

      socket.send(JSON.stringify({
        realtimeInput: {
          audio: {
            data: bytesToBase64(new Uint8Array(pcm.buffer)),
            mimeType: "audio/pcm;rate=16000"
          }
        }
      }));
    };

    inputSource.connect(processor);
    processor.connect(muteGain);
    muteGain.connect(inputContext.destination);
  }

  async function handleMessage(event) {
    try {
      const text = typeof event.data === "string" ? event.data : await event.data.text();
      const message = JSON.parse(text);

      if (message.setupComplete) {
        setupReady = true;
        await startMicrophone();
        starting = false;
        active = true;
        setStatus("Live conversation active — speak naturally.", "active");
        return;
      }

      const content = message.serverContent;
      if (!content) return;

      if (content.interrupted) clearOutput();

      const parts = content.modelTurn && Array.isArray(content.modelTurn.parts)
        ? content.modelTurn.parts
        : [];

      for (const part of parts) {
        const inline = part.inlineData || part.inline_data;
        if (inline && inline.data) await playAudio(inline.data);
      }

      if (content.inputTranscription && content.inputTranscription.text) {
        setStatus("Sophia is analysing…", "active");
      }
      if (content.outputTranscription && content.outputTranscription.text) {
        setStatus("Sophia is speaking…", "active");
      }
      if (content.turnComplete) {
        setStatus("Live conversation active — speak naturally.", "active");
      }
    } catch (error) {
      console.error("LifeOS Gemini Live message error:", error);
    }
  }

  async function startConversation() {
    if (!window.isSecureContext) {
      setStatus("Gemini Live requires HTTPS.", "error");
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("This browser cannot stream microphone audio.", "error");
      return;
    }

    starting = true;
    closingNormally = false;
    setStatus("Connecting to Gemini Live…", "connecting");

    try {
      await ensureOutputContext();

      const response = await fetch("/api/gemini-live-token", {
        method: "POST",
        headers: { "Accept": "application/json" },
        cache: "no-store"
      });
      const payload = await response.json().catch(function () { return {}; });

      if (!response.ok || !payload.ok || !payload.token) {
        throw new Error(payload.error || "Gemini Live token request failed.");
      }

      socket = new WebSocket(
        payload.websocket_url + "?access_token=" + encodeURIComponent(payload.token)
      );

      socket.addEventListener("open", function () {
        socket.send(JSON.stringify({
          setup: {
            model: "models/" + payload.model,
            generationConfig: {
              responseModalities: ["AUDIO"],
              temperature: 0.55
            },
            systemInstruction: {
              parts: [{
                text: "You are Sophia, the LifeOS AI decision-intelligence voice assistant. Speak naturally, calmly, directly, and concisely. Help the user identify the likely outcome, main risk, hidden cost, better move, and immediate next action. Do not read headings or markdown aloud. Complete every spoken response."
              }]
            },
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
                endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
                prefixPaddingMs: 120,
                silenceDurationMs: 650
              },
              activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
              turnCoverage: "TURN_INCLUDES_ONLY_ACTIVITY"
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {}
          }
        }));
      });

      socket.addEventListener("message", function (event) {
        handleMessage(event).catch(function (error) {
          stopAndClean(error.message || "Gemini Live message failed.", "error");
        });
      });

      socket.addEventListener("error", function () {
        setStatus("Gemini Live connection error.", "error");
      });

      socket.addEventListener("close", function (event) {
        const normal = closingNormally || event.code === 1000;
        stopAndClean(
          normal ? "Live conversation ended." : "Gemini Live disconnected. Code: " + event.code,
          normal ? "idle" : "error",
          true
        );
      });
    } catch (error) {
      stopAndClean(error.message || "Gemini Live could not start.", "error");
    }
  }

  function stopAndClean(message, state, socketAlreadyClosed) {
    starting = false;
    active = false;
    setupReady = false;
    clearOutput();

    if (processor) {
      processor.onaudioprocess = null;
      try { processor.disconnect(); } catch (error) {}
    }
    if (inputSource) {
      try { inputSource.disconnect(); } catch (error) {}
    }
    if (muteGain) {
      try { muteGain.disconnect(); } catch (error) {}
    }
    if (micStream) {
      micStream.getTracks().forEach(function (track) { track.stop(); });
    }
    if (inputContext && inputContext.state !== "closed") {
      inputContext.close().catch(function () {});
    }
    if (!socketAlreadyClosed && socket && socket.readyState < WebSocket.CLOSING) {
      try { socket.close(1000, "LifeOS Gemini Live ended"); } catch (error) {}
    }

    socket = null;
    micStream = null;
    inputContext = null;
    inputSource = null;
    processor = null;
    muteGain = null;
    setStatus(message || "Ready", state || "idle");
  }

  function endConversation() {
    closingNormally = true;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      } catch (error) {}
    }
    stopAndClean("Live conversation ended.", "idle");
  }

  button.addEventListener("click", function () {
    if (active) endConversation();
    else if (!starting) startConversation();
  });

  window.addEventListener("pagehide", function () {
    if (active || starting) endConversation();
  });

  window.LifeOSGeminiLiveV1 = {
    version: "1.0.0",
    start: startConversation,
    stop: endConversation
  };
}());
