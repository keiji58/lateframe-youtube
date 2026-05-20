const { DEFAULT_SETTINGS, MAX_DELAY_MS, PRESET_DELAYS_MS, STORAGE_KEYS } =
  SYNC_TUBE;

const enabledEl = document.getElementById("enabled");
const delayMsEl = document.getElementById("delayMs");
const delayValueEl = document.getElementById("delayValue");
const presetsEl = document.getElementById("presets");
const delaySectionEl = document.querySelector(".delay-section");

function updateDelayLabel(ms) {
  delayValueEl.textContent = `${ms} ms`;
}

function setDelaySectionEnabled(enabled) {
  delaySectionEl.classList.toggle("disabled", !enabled);
  delayMsEl.disabled = !enabled;
}

function renderPresets(activeMs) {
  presetsEl.innerHTML = "";
  for (const ms of PRESET_DELAYS_MS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset-btn";
    btn.textContent = `${ms} ms`;
    if (ms === activeMs) {
      btn.classList.add("active");
    }
    btn.addEventListener("click", () => {
      delayMsEl.value = String(ms);
      updateDelayLabel(ms);
      saveSettings();
    });
    presetsEl.appendChild(btn);
  }
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get([
    STORAGE_KEYS.enabled,
    STORAGE_KEYS.delayMs,
  ]);

  const enabled =
    stored[STORAGE_KEYS.enabled] ?? DEFAULT_SETTINGS.enabled;
  const delayMs = Math.min(
    MAX_DELAY_MS,
    Math.max(0, stored[STORAGE_KEYS.delayMs] ?? DEFAULT_SETTINGS.delayMs)
  );

  enabledEl.checked = enabled;
  delayMsEl.value = String(delayMs);
  updateDelayLabel(delayMs);
  setDelaySectionEnabled(enabled);
  renderPresets(delayMs);
}

function saveSettings() {
  const enabled = enabledEl.checked;
  const delayMs = parseInt(delayMsEl.value, 10);

  chrome.storage.sync.set({
    [STORAGE_KEYS.enabled]: enabled,
    [STORAGE_KEYS.delayMs]: delayMs,
  });

  setDelaySectionEnabled(enabled);
  renderPresets(delayMs);
}

enabledEl.addEventListener("change", saveSettings);
delayMsEl.addEventListener("input", () => {
  updateDelayLabel(parseInt(delayMsEl.value, 10));
  saveSettings();
});

loadSettings();
