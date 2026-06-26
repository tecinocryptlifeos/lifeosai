/*
 * LifeOS Realtime Voice Controller - Foundation V1
 *
 * Inactive foundation only.
 * No automatic microphone, WebRTC, network,
 * audio playback or DOM activity starts here.
 */

(function (global) {
  "use strict";

  var VERSION = "1.0.0-foundation";

  var STATES = Object.freeze({
    IDLE: "idle",
    CONNECTING: "connecting",
    USER_SPEAKING: "user_speaking",
    ANALYSING: "analysing",
    SOPHIA_SPEAKING: "sophia_speaking",
    INTERRUPTED: "interrupted",
    RECONNECTING: "reconnecting",
    ERROR: "error",
    STOPPED: "stopped"
  });

  var DEFAULT_PREFERENCES = Object.freeze({
    accentId: "en-GB-london",
    accentLabel: "London English",
    allowVisitorAccentSelection: true,
    voiceId: "marin",
    speakingStyle:
      "Warm, calm, natural contemporary London English " +
      "with varied intonation, measured pacing and natural pauses."
  });

  function RealtimeVoiceController(options) {
    options = options || {};

    this.endpoint =
      options.endpoint || "/api/realtime-session";

    this.state = STATES.IDLE;

    this.preferences = {
      accentId: DEFAULT_PREFERENCES.accentId,
      accentLabel: DEFAULT_PREFERENCES.accentLabel,
      allowVisitorAccentSelection:
        DEFAULT_PREFERENCES
          .allowVisitorAccentSelection,
      voiceId: DEFAULT_PREFERENCES.voiceId,
      speakingStyle:
        DEFAULT_PREFERENCES.speakingStyle
    };

    this.peerConnection = null;
    this.localMicrophoneStream = null;
    this.remoteSophiaStream = null;
    this.microphoneAnalyser = null;
    this.sophiaAnalyser = null;
    this.dataChannel = null;
    this.interruptionController = null;

    this.onStateChange =
      typeof options.onStateChange === "function"
        ? options.onStateChange
        : null;
  }

  RealtimeVoiceController.prototype.setState =
    function (nextState, detail) {
      var previousState = this.state;

      this.state = nextState;

      if (this.onStateChange) {
        this.onStateChange({
          previousState: previousState,
          state: nextState,
          detail: detail || null,
          changedAt: Date.now()
        });
      }
    };

  RealtimeVoiceController.prototype.setAccent =
    function (accentId, accentLabel) {
      if (
        typeof accentId !== "string" ||
        accentId.trim() === ""
      ) {
        throw new Error(
          "A valid accent identifier is required."
        );
      }

      this.preferences.accentId =
        accentId.trim();

      if (
        typeof accentLabel === "string" &&
        accentLabel.trim() !== ""
      ) {
        this.preferences.accentLabel =
          accentLabel.trim();
      }

      return this.snapshot();
    };

  RealtimeVoiceController.prototype.setVoice =
    function (voiceId) {
      if (
        typeof voiceId !== "string" ||
        voiceId.trim() === ""
      ) {
        throw new Error(
          "A valid voice identifier is required."
        );
      }

      this.preferences.voiceId =
        voiceId.trim();

      return this.snapshot();
    };

  RealtimeVoiceController.prototype.snapshot =
    function () {
      return {
        version: VERSION,
        endpoint: this.endpoint,
        state: this.state,
        preferences: {
          accentId:
            this.preferences.accentId,
          accentLabel:
            this.preferences.accentLabel,
          allowVisitorAccentSelection:
            this.preferences
              .allowVisitorAccentSelection,
          voiceId:
            this.preferences.voiceId,
          speakingStyle:
            this.preferences.speakingStyle
        }
      };
    };

  global.LifeOSRealtimeVoiceV1 =
    Object.freeze({
      version: VERSION,
      states: STATES,
      defaultPreferences:
        DEFAULT_PREFERENCES,
      RealtimeVoiceController:
        RealtimeVoiceController
    });
}(
  typeof window !== "undefined"
    ? window
    : this
));
