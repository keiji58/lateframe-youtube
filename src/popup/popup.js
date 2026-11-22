const { DEFAULT_SETTINGS, MAX_DELAY_MS, PRESET_DELAYS_MS, STORAGE_KEYS } =
  LATE_FRAME;

const enabledEl = document.getElementById("enabled");
const delayMsEl = document.getElementById("delayMs");
const delayValueEl = document.getElementById("delayValue");
const statusEl = document.getElementById("statusLine");
const presetsEl = document.getElementById("presets");
const delaySectionEl = document.querySelector(".delay-section");

function t(key) {
  return chrome.i18n.getMessage(key);
}

function applyI18n() {
  document.documentElement.lang = t("@@ui_locale") || "en";

  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    el.title = t(el.dataset.i18nTitle);
  }
  for (const el of document.querySelectorAll("[data-i18n-aria-label]")) {
    el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel));
  }
}

function updateDelayLabel(ms) {
  delayValueEl.textContent = String(ms);
}

function updateStatus() {
  const enabled = enabledEl.checked;
  const ms = parseInt(delayMsEl.value, 10);
  if (!enabled) {
    statusEl.textContent = t("statusOff");
    statusEl.className = "status off";
  } else if (ms === 0) {
    statusEl.textContent = t("statusZero");
    statusEl.className = "status zero";
  } else {
    statusEl.textContent = t("statusOn");
    statusEl.className = "status on";
  }
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
  updateStatus();
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
  updateStatus();
  renderPresets(delayMs);
}

applyI18n();

enabledEl.addEventListener("change", saveSettings);
delayMsEl.addEventListener("input", () => {
  updateDelayLabel(parseInt(delayMsEl.value, 10));
  saveSettings();
});

loadSettings();
