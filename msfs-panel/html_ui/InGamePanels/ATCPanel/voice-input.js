/* voice-input.js — local speech-to-text (push-to-talk) for the ATC widget.
 *
 * Self-contained vanilla-JS module (no build step, no imports). It is loaded by atc-widget.html
 * with a plain <script src="voice-input.js"></script> AFTER the main inline script, and exposes a
 * single global initializer: window.VoiceInput.init(deps).
 *
 * Two capture paths, picked automatically:
 *   1) Web Speech API (window.SpeechRecognition / webkitSpeechRecognition) — instant, on-device in
 *      Chromium/Electron. Used when available. This is the in-browser fallback.
 *   2) MediaRecorder -> POST /api/stt — records mic audio to a blob and uploads it to the brain,
 *      which runs whisper.cpp (see src/brain/voice/stt.ts) and returns the transcript. Used when the
 *      Web Speech API is missing OR when the user forces server STT (deps.preferServer === true).
 *
 * Push-to-talk:
 *   - Click the mic button to toggle.
 *   - Hold Space (when the text box is NOT focused) to talk; release to send.
 *   - Ctrl+Shift+Space global shortcut (Electron) toggles even when MSFS is focused — wired via
 *     deps.onPtt (the preload's atcWin.onPtt). Already registered in app/main.js.
 *
 * The module NEVER invents text: it only transcribes mic audio and drops the result into the
 * existing text input, then sends it through the host's sendText() — the same deterministic NLU
 * pipeline the typed path uses.
 *
 * HARDWARE TESTING REQUIRED: microphone capture + (for path 2) a real whisper.cpp binary + model.
 */
(function (global) {
  'use strict';

  // deps (all supplied by the host page):
  //   $:            id->element getter (the widget's existing helper)
  //   sendText:     (text) => void   — host fn that logs "You" + sends pilot_tx over the WS
  //   setInput:     (text) => void   — write interim/final text into the input box
  //   entrySys:     (msg)  => void   — push a system line into the log (for errors/hints)
  //   onPtt:        (cb)   => void   — register the global Ctrl+Shift+Space toggle (optional)
  //   onListening:  (bool) => void   — UI hook fired when listening starts/stops (optional)
  //   httpBase:     ()     => string — base URL for /api/stt (optional; defaults from location)
  //   preferServer: boolean          — force the whisper.cpp upload path even if Web Speech exists
  var D = null;

  var SR = global.SpeechRecognition || global.webkitSpeechRecognition || null;

  var state = {
    mode: 'none', // 'webspeech' | 'recorder' | 'none'
    listening: false,
    rec: null, // SpeechRecognition instance
    heard: '', // finalized Web Speech transcript
    mediaRec: null, // MediaRecorder instance
    chunks: [], // recorded audio blobs
    stream: null, // active MediaStream (so we can stop tracks)
    spaceHeld: false, // dedupe key auto-repeat for hold-to-talk
  };

  function el(id) {
    return D && typeof D.$ === 'function' ? D.$(id) : document.getElementById(id);
  }

  function micBtn() {
    return el('mic');
  }

  function setInput(text) {
    if (D && typeof D.setInput === 'function') {
      D.setInput(text);
      return;
    }
    var i = el('input');
    if (i) i.value = text;
  }

  function sys(msg) {
    if (D && typeof D.entrySys === 'function') D.entrySys(msg);
  }

  function send(text) {
    var t = (text || '').replace(/^\s+|\s+$/g, '');
    if (!t) return;
    if (D && typeof D.sendText === 'function') D.sendText(t);
  }

  function base() {
    if (D && typeof D.httpBase === 'function') {
      try {
        return D.httpBase();
      } catch (e) {
        /* fall through */
      }
    }
    // Derive from the current location (widget is served by the brain over http).
    if (location.protocol.indexOf('http') === 0) return location.origin;
    return 'http://localhost:8742';
  }

  function setListening(on) {
    state.listening = on;
    var b = micBtn();
    if (b) {
      b.classList.toggle('listening', on);
      b.title = on
        ? 'Listening… (click to stop)'
        : 'Push to talk (click, or hold Space · Ctrl+Shift+Space global)';
    }
    var tx = el('txind');
    if (tx) tx.style.display = on ? 'inline-flex' : 'none';
    // Don't transcribe the controller: cancel any in-progress TTS while transmitting.
    if (on) {
      try {
        if (global.speechSynthesis) global.speechSynthesis.cancel();
      } catch (e) {
        /* ignore */
      }
    }
    if (D && typeof D.onListening === 'function') {
      try {
        D.onListening(on);
      } catch (e) {
        /* ignore */
      }
    }
  }

  // ---- Path 1: Web Speech API (browser/Electron, instant) ----
  function startWebSpeech() {
    if (!SR || state.listening) return;
    state.heard = '';
    try {
      var rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onresult = function (e) {
        var fin = '';
        var intr = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var r = e.results[i];
          if (r.isFinal) fin += r[0].transcript;
          else intr += r[0].transcript;
        }
        if (intr) setInput(intr);
        if (fin) {
          state.heard = fin.replace(/^\s+|\s+$/g, '');
          setInput(state.heard);
        }
      };
      rec.onerror = function (ev) {
        if (ev && ev.error === 'not-allowed') sys('mic blocked — allow microphone access');
        else if (ev && ev.error === 'no-speech') sys('no speech heard — try again');
      };
      rec.onend = function () {
        setListening(false);
        state.rec = null;
        if (state.heard) {
          send(state.heard);
          state.heard = '';
        }
      };
      state.rec = rec;
      rec.start();
      setListening(true);
    } catch (e) {
      setListening(false);
    }
  }

  function stopWebSpeech() {
    if (state.rec) {
      try {
        state.rec.stop();
      } catch (e) {
        /* ignore */
      }
    }
  }

  // ---- Path 2: MediaRecorder -> whisper.cpp on the brain ----
  function startRecorder() {
    if (state.listening) return;
    if (!global.navigator || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      sys('voice input unavailable — no microphone API in this build');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, noiseSuppression: true, echoCancellation: true } })
      .then(function (stream) {
        state.stream = stream;
        state.chunks = [];
        var mr;
        try {
          // Prefer a widely-supported container; whisper.cpp side decodes via its WAV pipeline,
          // so the brain endpoint is responsible for transcoding webm/ogg -> 16k mono WAV.
          var mime = pickMime();
          mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        } catch (e) {
          mr = new MediaRecorder(stream);
        }
        state.mediaRec = mr;
        mr.ondataavailable = function (ev) {
          if (ev.data && ev.data.size > 0) state.chunks.push(ev.data);
        };
        mr.onstop = function () {
          stopTracks();
          var blob = new Blob(state.chunks, { type: (mr.mimeType || 'audio/webm') });
          state.chunks = [];
          uploadForTranscription(blob);
        };
        mr.start();
        setListening(true);
      })
      .catch(function () {
        sys('mic blocked — allow microphone access');
        setListening(false);
      });
  }

  function pickMime() {
    if (!global.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') return '';
    var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  function stopRecorder() {
    if (state.mediaRec && state.mediaRec.state !== 'inactive') {
      try {
        state.mediaRec.state === 'recording' && state.mediaRec.stop();
      } catch (e) {
        stopTracks();
      }
    }
    // onstop handles the upload + setListening(false); guard if it never fires.
    setListening(false);
  }

  function stopTracks() {
    if (state.stream) {
      try {
        state.stream.getTracks().forEach(function (t) {
          t.stop();
        });
      } catch (e) {
        /* ignore */
      }
      state.stream = null;
    }
  }

  function uploadForTranscription(blob) {
    if (!blob || !blob.size) {
      sys('no audio captured — try again');
      return;
    }
    sys('transcribing…');
    var url = base().replace(/\/$/, '') + '/api/stt';
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': blob.type || 'application/octet-stream' },
      body: blob,
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (j && j.ok && j.text) {
          setInput(j.text);
          send(j.text);
        } else {
          sys('transcription failed: ' + ((j && j.error) || 'no speech detected'));
        }
      })
      .catch(function (e) {
        sys('transcription error: ' + (e && e.message ? e.message : 'upload failed'));
      });
  }

  // ---- Unified toggle (mode-agnostic) ----
  function start() {
    if (state.mode === 'webspeech') startWebSpeech();
    else if (state.mode === 'recorder') startRecorder();
  }

  function stop() {
    if (state.mode === 'webspeech') stopWebSpeech();
    else if (state.mode === 'recorder') stopRecorder();
  }

  function toggle() {
    if (state.listening) stop();
    else start();
  }

  function bindKeys() {
    // Space = hold-to-talk when the input box is NOT focused.
    document.addEventListener('keydown', function (e) {
      if (e.code !== 'Space') return;
      if (document.activeElement === el('input')) return;
      e.preventDefault();
      if (!state.listening && !state.spaceHeld) {
        state.spaceHeld = true;
        start();
      }
    });
    document.addEventListener('keyup', function (e) {
      if (e.code !== 'Space') return;
      if (document.activeElement === el('input')) return;
      e.preventDefault();
      state.spaceHeld = false;
      if (state.listening) stop();
    });
  }

  // Public API.
  var VoiceInput = {
    /**
     * Initialize voice input. Call once after the DOM + host helpers exist.
     * @param {object} deps see the deps comment block at the top of this file.
     */
    init: function (deps) {
      D = deps || {};
      // Choose a capture path. Web Speech is preferred unless the host forces server STT.
      if (SR && !D.preferServer) state.mode = 'webspeech';
      else if (global.MediaRecorder && global.navigator && navigator.mediaDevices) state.mode = 'recorder';
      else state.mode = 'none';

      var b = micBtn();
      if (state.mode === 'none') {
        if (b) {
          b.classList.add('unsupported');
          b.title = 'Voice input not supported in this build';
        }
        return;
      }
      if (b) {
        b.title =
          state.mode === 'recorder'
            ? 'Push to talk (whisper.cpp) — click, or hold Space'
            : 'Push to talk — click, or hold Space · Ctrl+Shift+Space global';
        b.addEventListener('click', toggle);
      }
      bindKeys();
      // Global Ctrl+Shift+Space (Electron): works even when MSFS is focused.
      if (D && typeof D.onPtt === 'function') {
        try {
          D.onPtt(function () {
            toggle();
          });
        } catch (e) {
          /* ignore */
        }
      }
    },
    /** Programmatic controls (handy for tests / quick buttons). */
    start: start,
    stop: stop,
    toggle: toggle,
    /** Which capture path is active: 'webspeech' | 'recorder' | 'none'. */
    mode: function () {
      return state.mode;
    },
    isListening: function () {
      return state.listening;
    },
  };

  global.VoiceInput = VoiceInput;
})(typeof window !== 'undefined' ? window : this);
