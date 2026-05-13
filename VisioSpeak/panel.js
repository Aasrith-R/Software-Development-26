const $ = (id) => document.getElementById(id);

const els = {
  captions: $("captions"),
  interim:  $("interim"),
  hint:     $("hint"),
  errorBox: $("errorBox"),
  pill:     $("pill"),
  pillText: $("pillText"),
  lang:     $("lang"),
  fontSize: $("fontSize"),
  btnStart: $("btnStart"),
  btnStop:  $("btnStop"),
  btnClear: $("btnClear"),
  btnCopy:  $("btnCopy"),
};

let recognition = null;
let running = false;
let lastFinal = "";

// ── Status helpers ────────────────────────────────────────────────────
function setPill(state, text) {
  els.pill.dataset.state = state;
  els.pillText.textContent = text;
}

function setRunning(val) {
  running = val;
  els.btnStart.disabled = val;
  els.btnStop.disabled = !val;
}

function showError(msg) {
  els.errorBox.hidden = false;
  els.errorBox.textContent = msg;
  setPill("error", "Error");
}

function clearError() {
  els.errorBox.hidden = true;
  els.errorBox.textContent = "";
}

function appendLine(text) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const line = document.createElement("div");
  line.className = "caption-line";
  line.innerHTML = `<span class="caption-time">${time}</span>${esc(text)}`;
  els.captions.appendChild(line);
  els.captions.scrollTop = els.captions.scrollHeight;
  els.hint.hidden = true;
}

function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ── SpeechRecognition ─────────────────────────────────────────────────
async function startListening() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showError("SpeechRecognition is not supported in this browser. Please use Chrome.");
    setRunning(false);
    return;
  }

  // Request mic permission explicitly so the browser shows the Allow prompt.
  // SpeechRecognition alone on extension pages doesn't always trigger it.
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch (e) {
    if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
      showError("Microphone access was denied. Click the camera/mic icon in the address bar, set microphone to Allow, then try again.");
    } else {
      showError(`Microphone error: ${e.message}`);
    }
    setRunning(false);
    return;
  }

  if (recognition) {
    try { recognition.abort(); } catch (_) {}
    recognition = null;
  }

  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = els.lang.value || "en-US";

  recognition.onstart = () => {
    setPill("listening", "Listening");
  };

  recognition.onresult = (evt) => {
    let interim = "";
    for (let i = evt.resultIndex; i < evt.results.length; i++) {
      const r = evt.results[i];
      const text = r[0]?.transcript ?? "";
      if (r.isFinal) {
        const t = text.trim();
        if (t && t !== lastFinal) {
          appendLine(t);
          lastFinal = t;
        }
        els.interim.textContent = "";
      } else {
        interim += text;
      }
    }
    if (interim) els.interim.textContent = interim;
  };

  recognition.onerror = (evt) => {
    const err = evt.error;
    console.error("STT error:", err);
    if (err === "no-speech" || err === "aborted") return;
    if (err === "network") {
      // Transient — onend will restart.
      return;
    }
    let msg = `Speech error: ${err}`;
    if (err === "not-allowed") {
      msg = "Microphone not allowed. Check site permissions for this extension page.";
      running = false;
      recognition = null;
      setRunning(false);
    }
    showError(msg);
  };

  recognition.onend = () => {
    if (!running) {
      setPill("idle", "Idle");
      return;
    }
    // Keep restarting while user hasn't pressed Stop.
    try {
      recognition.start();
    } catch (e) {
      console.error("restart failed:", e);
      running = false;
      recognition = null;
      setRunning(false);
      setPill("idle", "Idle");
      showError(`Restart failed: ${e.message}`);
    }
  };

  recognition.start();
}

// ── Button wiring ─────────────────────────────────────────────────────
els.btnStart.addEventListener("click", async () => {
  if (running) return;
  clearError();
  setRunning(true);
  setPill("idle", "Requesting mic…");
  els.interim.textContent = "";
  lastFinal = "";
  await startListening();
});

els.btnStop.addEventListener("click", () => {
  running = false;
  try { recognition?.stop(); } catch (_) {}
  recognition = null;
  els.interim.textContent = "";
  setRunning(false);
  setPill("idle", "Idle");
});

els.btnClear.addEventListener("click", () => {
  els.captions.innerHTML = "";
  els.interim.textContent = "";
  els.hint.hidden = false;
  lastFinal = "";
});

els.btnCopy.addEventListener("click", async () => {
  const lines = [...els.captions.querySelectorAll(".caption-line")]
    .map((el) => el.textContent.trim())
    .join("\n");
  if (!lines) return;
  try { await navigator.clipboard.writeText(lines); } catch (e) { console.error(e); }
});

els.fontSize.addEventListener("input", () => {
  document.documentElement.style.setProperty("--font-size", `${els.fontSize.value}px`);
});

// ── Autostart ─────────────────────────────────────────────────────────
if (new URLSearchParams(location.search).get("autostart") === "1") {
  els.btnStart.click();
}
