/* LifeOS Realtime Voice Controller V1. Inactive until connect() is called. */
(function (global) {
  "use strict";

  const VERSION = "1.1.1-controller-inactive";
  const STATES = Object.freeze({
    IDLE: "idle", CONNECTING: "connecting", USER_SPEAKING: "user_speaking",
    ANALYSING: "analysing", SOPHIA_SPEAKING: "sophia_speaking",
    INTERRUPTED: "interrupted", RECONNECTING: "reconnecting",
    ERROR: "error", STOPPED: "stopped"
  });
  const VOICES = Object.freeze(["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"]);
  const DEFAULTS = Object.freeze({
    accentId: "en-GB-london",
    accentLabel: "London English",
    accentInstruction: "Speak in natural contemporary London English with warm, clear articulation, varied intonation and measured pacing.",
    allowVisitorAccentSelection: true,
    voiceId: "marin"
  });

  const makeError = (message, code) => Object.assign(new Error(message), { code });
  const makeId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const rms = (analyser, data) => {
    if (!analyser || !data) return 0;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      const value = (data[i] - 128) / 128;
      sum += value * value;
    }
    return Math.max(0, Math.min(1, Math.sqrt(sum / data.length) * 2.5));
  };

  class RealtimeVoiceController {
    constructor(options = {}) {
      this.endpoint = options.endpoint || "/api/realtime-session";
      this.connectionTimeoutMs = Number(options.connectionTimeoutMs) > 0 ? Number(options.connectionTimeoutMs) : 30000;
      this.rtcConfiguration = options.rtcConfiguration || {};
      this.state = STATES.IDLE;
      this.preferences = { ...DEFAULTS };
      this.peerConnection = null;
      this.localMicrophoneStream = null;
      this.remoteSophiaStream = null;
      this.dataChannel = null;
      this.audioContext = null;
      this.microphoneAnalyser = null;
      this.sophiaAnalyser = null;
      this.interruptionController = this;
      this.remoteAudioElement = options.remoteAudioElement || null;
      this._providedAudio = this.remoteAudioElement;
      this._ownsAudio = !this.remoteAudioElement;
      this._micSource = null;
      this._sophiaSource = null;
      this._micData = null;
      this._sophiaData = null;
      this._animationFrame = null;
      this._connecting = null;
      this._lastOptions = null;
      this._destroyed = false;
      this._voiceLocked = false;
      this._responseActive = false;
      this._responseId = null;
      this._remoteMuted = false;
      ["onStateChange", "onEvent", "onError", "onConnectionChange", "onMicrophoneLevel", "onSophiaLevel", "onInterrupt", "onFallbackRequired"].forEach((name) => {
        this[name] = typeof options[name] === "function" ? options[name] : null;
      });
    }

    _emit(name, payload) {
      try { if (this[name]) this[name](payload); }
      catch (error) { if (global.console) global.console.error("LifeOS realtime callback error:", error); }
    }

    _state(next, detail = null) {
      if (Object.values(STATES).indexOf(next) === -1) throw makeError(`Unsupported state: ${next}`, "INVALID_STATE");
      const previousState = this.state;
      this.state = next;
      if (previousState !== next || detail) this._emit("onStateChange", { previousState, state: next, detail, changedAt: Date.now() });
    }

    setAccent(accentId, accentLabel, accentInstruction) {
      if (typeof accentId !== "string" || !accentId.trim()) throw makeError("A valid accent identifier is required.", "INVALID_ACCENT");
      this.preferences.accentId = accentId.trim();
      this.preferences.accentLabel = typeof accentLabel === "string" && accentLabel.trim() ? accentLabel.trim() : accentId.trim();
      this.preferences.accentInstruction = typeof accentInstruction === "string" && accentInstruction.trim()
        ? accentInstruction.trim()
        : "Speak naturally and clearly in the visitor-selected accent.";
      if (this.dataChannel && this.dataChannel.readyState === "open") this._sendSessionUpdate();
      return this.snapshot();
    }

    setVoice(voiceId) {
      if (VOICES.indexOf(voiceId) === -1) throw makeError(`Unsupported voice: ${voiceId}`, "INVALID_VOICE");
      if (this._voiceLocked && voiceId !== this.preferences.voiceId) throw makeError("Voice cannot change after audio output begins.", "VOICE_LOCKED");
      this.preferences.voiceId = voiceId;
      if (this.dataChannel && this.dataChannel.readyState === "open") this._sendSessionUpdate();
      return this.snapshot();
    }

    _instructions() {
      return [
        "You are Sophia, the LifeOS voice decision assistant.",
        this.preferences.accentInstruction,
        "Sound warm, calm, natural and conversational, with varied intonation and natural pauses.",
        "Never sound robotic or like a walkie-talkie. Never play or imitate authorization beeps.",
        "The visitor may interrupt at any moment. Stop immediately, listen fully, then answer the latest words.",
        "Keep answers focused unless more detail is requested."
      ].join(" ");
    }

    _sessionUpdate() {
      return {
        event_id: makeId("session_update"),
        type: "session.update",
        session: {
          instructions: this._instructions(),
          audio: {
            input: {
              noise_reduction: { type: "near_field" },
              turn_detection: {
                type: "server_vad", threshold: 0.5, prefix_padding_ms: 300,
                silence_duration_ms: 500, create_response: true, interrupt_response: true
              }
            },
            output: { voice: this.preferences.voiceId }
          }
        }
      };
    }

    sendEvent(event) {
      if (!this.dataChannel || this.dataChannel.readyState !== "open") throw makeError("Realtime event channel is not open.", "DATA_CHANNEL_NOT_OPEN");
      if (!event || typeof event.type !== "string") throw makeError("A typed realtime event is required.", "INVALID_EVENT");
      if (!event.event_id) event.event_id = makeId("client");
      this.dataChannel.send(JSON.stringify(event));
      return event.event_id;
    }

    _sendSessionUpdate() { return this.sendEvent(this._sessionUpdate()); }

    _audioElement() {
      if (this.remoteAudioElement) return this.remoteAudioElement;
      if (!global.document) throw makeError("Browser document unavailable.", "DOCUMENT_UNAVAILABLE");
      const audio = global.document.createElement("audio");
      audio.autoplay = true;
      audio.playsInline = true;
      audio.style.display = "none";
      audio.setAttribute("data-lifeos-realtime-audio", "sophia");
      (global.document.body || global.document.documentElement).appendChild(audio);
      this.remoteAudioElement = audio;
      this._ownsAudio = true;
      return audio;
    }

    async _audioContextReady() {
      const AudioContext = global.AudioContext || global.webkitAudioContext;
      if (!AudioContext) return;
      if (!this.audioContext || this.audioContext.state === "closed") this.audioContext = new AudioContext();
      if (this.audioContext.state === "suspended") await this.audioContext.resume();
    }

    _analyser(stream) {
      if (!this.audioContext || !stream) return null;
      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      return { source, analyser, data: new Uint8Array(analyser.fftSize) };
    }

    _setMicAnalyser(stream) {
      const bundle = this._analyser(stream);
      if (!bundle) return;
      this._micSource = bundle.source;
      this.microphoneAnalyser = bundle.analyser;
      this._micData = bundle.data;
    }

    _setSophiaAnalyser(stream) {
      if (this._sophiaSource) try { this._sophiaSource.disconnect(); } catch (_) {}
      const bundle = this._analyser(stream);
      if (!bundle) return;
      this._sophiaSource = bundle.source;
      this.sophiaAnalyser = bundle.analyser;
      this._sophiaData = bundle.data;
    }

    getMicrophoneLevel() { return rms(this.microphoneAnalyser, this._micData); }
    getSophiaLevel() { return this._remoteMuted ? 0 : rms(this.sophiaAnalyser, this._sophiaData); }

    _startLevels() {
      if (this._animationFrame !== null || typeof global.requestAnimationFrame !== "function") return;
      const frame = () => {
        this._emit("onMicrophoneLevel", { level: this.getMicrophoneLevel(), state: this.state, measuredAt: Date.now() });
        this._emit("onSophiaLevel", { level: this.getSophiaLevel(), state: this.state, measuredAt: Date.now() });
        this._animationFrame = global.requestAnimationFrame(frame);
      };
      this._animationFrame = global.requestAnimationFrame(frame);
    }

    _muteRemote(muted) {
      this._remoteMuted = Boolean(muted);
      if (this.remoteAudioElement) this.remoteAudioElement.muted = this._remoteMuted;
    }

    _resumeRemote() {
      this._muteRemote(false);
      if (!this.remoteAudioElement) return;
      const result = this.remoteAudioElement.play();
      if (result && result.catch) result.catch((error) => this._emit("onError", error));
    }

    _cancelOutput(reason) {
      const active = this._responseActive || this.state === STATES.ANALYSING || this.state === STATES.SOPHIA_SPEAKING;
      this._muteRemote(true);
      if (active && this.dataChannel && this.dataChannel.readyState === "open") {
        try { this.sendEvent({ type: "response.cancel" }); } catch (_) {}
        try { this.sendEvent({ type: "output_audio_buffer.clear" }); } catch (_) {}
      }
      this._responseActive = false;
      this._emit("onInterrupt", { reason, interruptedAt: Date.now() });
    }

    interrupt(reason = "manual") {
      this._cancelOutput(reason);
      this._state(STATES.INTERRUPTED, { reason });
      return this.snapshot();
    }

    stopSpeaking() { return this.interrupt("stop_requested"); }

    _serverEvent(event) {
      this._emit("onEvent", event);
      switch (event && event.type) {
        case "session.created":
        case "session.updated":
          if (this.state === STATES.CONNECTING) this._state(STATES.IDLE, { event });
          break;
        case "input_audio_buffer.speech_started":
          this._cancelOutput("user_speech");
          this._state(STATES.USER_SPEAKING, { event });
          break;
        case "input_audio_buffer.speech_stopped":
        case "input_audio_buffer.committed":
          this._state(STATES.ANALYSING, { event });
          break;
        case "response.created":
          this._responseActive = true;
          if (event.response && event.response.id) this._responseId = event.response.id;
          this._state(STATES.ANALYSING, { event });
          break;
        case "response.output_audio.delta":
        case "response.audio.delta":
        case "response.output_audio.started":
        case "output_audio_buffer.started":
          this._voiceLocked = true;
          this._responseActive = true;
          this._resumeRemote();
          this._state(STATES.SOPHIA_SPEAKING, { event });
          break;
        case "response.done":
          this._responseActive = false;
          this._responseId = null;
          if (this.state === STATES.ANALYSING) this._state(STATES.IDLE, { event });
          break;
        case "output_audio_buffer.stopped":
          if (this.state === STATES.SOPHIA_SPEAKING) this._state(STATES.IDLE, { event });
          break;
        case "output_audio_buffer.cleared":
          this._muteRemote(true);
          break;
        case "error":
          this._emit("onError", event.error || event);
          break;
      }
    }

    _waitForChannel() {
      if (this.dataChannel && this.dataChannel.readyState === "open") return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = global.setTimeout(() => reject(makeError("Realtime event channel timed out.", "DATA_CHANNEL_TIMEOUT")), this.connectionTimeoutMs);
        const open = () => { cleanup(); resolve(); };
        const close = () => { cleanup(); reject(makeError("Realtime event channel closed.", "DATA_CHANNEL_CLOSED")); };
        const cleanup = () => {
          global.clearTimeout(timer);
          this.dataChannel.removeEventListener("open", open);
          this.dataChannel.removeEventListener("close", close);
        };
        this.dataChannel.addEventListener("open", open);
        this.dataChannel.addEventListener("close", close);
      });
    }

    _answerSdp(body, contentType) {
      let sdp = String(body || "").trim();
      if (String(contentType || "").includes("application/json") || sdp.startsWith("{")) {
        const json = JSON.parse(sdp);
        sdp = json.sdp || json.answer_sdp || (json.answer && json.answer.sdp) || (json.data && json.data.sdp) || "";
      }
      if (!sdp.startsWith("v=0") || !sdp.includes("m=audio")) throw makeError("Gateway returned invalid SDP.", "INVALID_SDP_ANSWER");
      return sdp;
    }

    async _gateway(offerSdp) {
      const controller = typeof global.AbortController === "function" ? new global.AbortController() : null;
      const timer = global.setTimeout(() => { if (controller) controller.abort(); }, this.connectionTimeoutMs);
      try {
        const response = await global.fetch(this.endpoint, {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "Content-Type": "application/sdp", Accept: "application/sdp, text/plain, application/json" },
          body: offerSdp, signal: controller ? controller.signal : undefined
        });
        const body = await response.text();
        if (!response.ok) throw makeError(`Gateway HTTP ${response.status}: ${body.slice(0, 300)}`, "GATEWAY_HTTP_ERROR");
        return this._answerSdp(body, response.headers.get("content-type") || "");
      } finally {
        global.clearTimeout(timer);
      }
    }

    _peer() {
      const audio = this._audioElement();
      this.peerConnection = new global.RTCPeerConnection(this.rtcConfiguration);
      this.peerConnection.ontrack = (event) => {
        const stream = event.streams && event.streams[0] ? event.streams[0] : new global.MediaStream([event.track]);
        this.remoteSophiaStream = stream;
        audio.srcObject = stream;
        this._setSophiaAnalyser(stream);
        this._resumeRemote();
      };
      this.peerConnection.onconnectionstatechange = () => {
        const connectionState = this.peerConnection ? this.peerConnection.connectionState : "closed";
        this._emit("onConnectionChange", { connectionState, changedAt: Date.now() });
        if (connectionState === "failed") {
          this._state(STATES.ERROR, { reason: "peer_connection_failed" });
          this._emit("onFallbackRequired", { reason: "peer_connection_failed" });
        } else if (connectionState === "disconnected") this._state(STATES.RECONNECTING, { reason: "peer_connection_disconnected" });
      };
      this.dataChannel = this.peerConnection.createDataChannel("oai-events");
      this.dataChannel.addEventListener("message", (message) => {
        try { this._serverEvent(JSON.parse(message.data)); }
        catch (_) { this._emit("onError", makeError("Invalid realtime server event.", "INVALID_SERVER_EVENT")); }
      });
      this.dataChannel.addEventListener("open", () => this._sendSessionUpdate());
    }

    async connect(options = {}) {
      if (this._destroyed) throw makeError("Controller has been destroyed.", "CONTROLLER_DESTROYED");
      if (this._connecting) return this._connecting;
      if (!global.navigator || !global.navigator.mediaDevices || !global.navigator.mediaDevices.getUserMedia) throw makeError("Microphone access unavailable.", "MEDIA_DEVICES_UNAVAILABLE");
      if (!global.RTCPeerConnection || !global.fetch) throw makeError("WebRTC unavailable.", "WEBRTC_UNAVAILABLE");
      this._lastOptions = { ...options };
      this._state(STATES.CONNECTING);
      this._connecting = (async () => {
        try {
          await this._audioContextReady();
          const stream = await global.navigator.mediaDevices.getUserMedia({
            audio: options.microphoneConstraints || { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
            video: false
          });
          this.localMicrophoneStream = stream;
          this._setMicAnalyser(stream);
          this._peer();
          const track = stream.getAudioTracks()[0];
          if (!track) throw makeError("Microphone track missing.", "MICROPHONE_TRACK_MISSING");
          this.peerConnection.addTrack(track, stream);
          const offer = await this.peerConnection.createOffer();
          await this.peerConnection.setLocalDescription(offer);
          const answer = await this._gateway(this.peerConnection.localDescription.sdp);
          await this.peerConnection.setRemoteDescription({ type: "answer", sdp: answer });
          await this._waitForChannel();
          this._startLevels();
          this._state(STATES.IDLE, { reason: "realtime_connected" });
          return this.snapshot();
        } catch (error) {
          this._emit("onError", error);
          this._emit("onFallbackRequired", { reason: "realtime_connect_failed", error });
          this.disconnect({ preserveState: true });
          this._state(STATES.ERROR, { reason: "realtime_connect_failed", error: error.message || String(error) });
          throw error;
        } finally {
          this._connecting = null;
        }
      })();
      return this._connecting;
    }

    reconnect() {
      const options = { ...(this._lastOptions || {}) };
      this._state(STATES.RECONNECTING);
      this.disconnect({ preserveState: true });
      return this.connect(options);
    }

    disconnect(options = {}) {
      if (this._animationFrame !== null && global.cancelAnimationFrame) global.cancelAnimationFrame(this._animationFrame);
      this._animationFrame = null;
      this._muteRemote(true);
      if (this.dataChannel) try { this.dataChannel.close(); } catch (_) {}
      if (this.peerConnection) try { this.peerConnection.close(); } catch (_) {}
      if (this.localMicrophoneStream) this.localMicrophoneStream.getTracks().forEach((track) => track.stop());
      if (this._micSource) try { this._micSource.disconnect(); } catch (_) {}
      if (this._sophiaSource) try { this._sophiaSource.disconnect(); } catch (_) {}
      if (this.audioContext && this.audioContext.state !== "closed") try { this.audioContext.close(); } catch (_) {}
      if (this.remoteAudioElement) {
        this.remoteAudioElement.srcObject = null;
        if (this._ownsAudio && this.remoteAudioElement.parentNode) this.remoteAudioElement.parentNode.removeChild(this.remoteAudioElement);
      }
      this.peerConnection = this.localMicrophoneStream = this.remoteSophiaStream = this.dataChannel = null;
      this.audioContext = this.microphoneAnalyser = this.sophiaAnalyser = null;
      this._micSource = this._sophiaSource = this._micData = this._sophiaData = null;
      this.remoteAudioElement = this._providedAudio;
      this._ownsAudio = !this._providedAudio;
      this._responseActive = false;
      this._responseId = null;
      this._voiceLocked = false;
      this._remoteMuted = false;
      this._connecting = null;
      if (!options.preserveState) this._state(STATES.STOPPED, { reason: "disconnect" });
      return this.snapshot();
    }

    destroy() {
      this.disconnect({ preserveState: true });
      this._destroyed = true;
      this._state(STATES.STOPPED, { reason: "destroy" });
    }

    snapshot() {
      return {
        version: VERSION,
        endpoint: this.endpoint,
        state: this.state,
        connected: Boolean(this.peerConnection && this.peerConnection.connectionState === "connected"),
        dataChannelState: this.dataChannel ? this.dataChannel.readyState : "closed",
        voiceLocked: this._voiceLocked,
        responseInProgress: this._responseActive,
        preferences: { ...this.preferences }
      };
    }
  }

  global.LifeOSRealtimeVoiceV1 = Object.freeze({
    version: VERSION,
    states: STATES,
    voices: VOICES.slice(),
    defaultPreferences: DEFAULTS,
    RealtimeVoiceController
  });
}(typeof window !== "undefined" ? window : globalThis));
