const { DEFAULT_SETTINGS, STORAGE_KEYS } = SYNC_TUBE;

const INIT_DEBOUNCE_MS = 500;
const RETRY_INTERVAL_MS = 1000;

let settings = { ...DEFAULT_SETTINGS, debug: false };
let frameDelay = null;
let attachedVideo = null;
let initTimer = null;
let retryTimer = null;

function log(...args) {
  if (settings.debug) {
    console.log("[Sync Tube]", ...args);
  }
}

function findMoviePlayer() {
  return document.getElementById("movie_player");
}

function findMainVideo(player) {
  if (!player) {
    return null;
  }
  const video =
    player.querySelector("video.html5-main-video") ||
    player.querySelector("video");
  if (!video) {
    return null;
  }
  // readyState 0 でも要素があれば後から loadeddata で再試行する
  if (video.readyState === 0 && !video.src && !video.currentSrc) {
    return null;
  }
  return video;
}

function teardown() {
  frameDelay?.destroy();
  frameDelay = null;
  attachedVideo = null;
}

function applySettings() {
  if (!settings.enabled || settings.delayMs <= 0) {
    log("inactive", { enabled: settings.enabled, delayMs: settings.delayMs });
    teardown();
    updateDebugStatus({ active: false, reason: "enabled_or_delay" });
    return;
  }

  const player = findMoviePlayer();

  if (SYNC_TUBE.isAdPlaying(player)) {
    log("ad playing — extension paused");
    teardown();
    updateDebugStatus({ active: false, reason: "ad" });
    return;
  }

  const video = findMainVideo(player);

  if (!video || !player) {
    log("player not ready", { player: !!player, video: !!video });
    updateDebugStatus({
      active: false,
      reason: "no_player",
      moviePlayer: !!player,
    });
    return;
  }

  if (attachedVideo !== video) {
    teardown();
    attachedVideo = video;
    bindVideoLifecycle(video);
    frameDelay = new FrameDelay(video, player, { debug: settings.debug });
    frameDelay.start();
    log("attached", { delayMs: settings.delayMs });
  }

  frameDelay.setDelayMs(settings.delayMs);
  updateDebugStatus(frameDelay.getStatus());
}

function updateDebugStatus(status) {
  window.__syncTube = {
    settings: { ...settings },
    status,
    refresh: () => applySettings(),
  };
}

function scheduleInit() {
  clearTimeout(initTimer);
  initTimer = setTimeout(() => {
    teardown();
    applySettings();
  }, INIT_DEBOUNCE_MS);
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get([
    STORAGE_KEYS.enabled,
    STORAGE_KEYS.delayMs,
    STORAGE_KEYS.debug,
  ]);
  settings = {
    enabled: stored[STORAGE_KEYS.enabled] ?? DEFAULT_SETTINGS.enabled,
    delayMs: stored[STORAGE_KEYS.delayMs] ?? DEFAULT_SETTINGS.delayMs,
    debug: stored[STORAGE_KEYS.debug] ?? false,
  };
  applySettings();
}

function bindVideoLifecycle(video) {
  const onReady = () => {
    if (settings.enabled && settings.delayMs > 0) {
      applySettings();
    }
  };
  video.addEventListener("loadeddata", onReady, { once: false });
  video.addEventListener("playing", onReady, { once: false });
}

function watchNavigation() {
  let lastUrl = location.href;

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleInit();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function watchPlayerMount() {
  const observer = new MutationObserver(() => {
    if (!settings.enabled) {
      return;
    }
    const player = findMoviePlayer();
    const video = findMainVideo(player);
    if (video && video !== attachedVideo) {
      scheduleInit();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function startRetryLoop() {
  retryTimer = setInterval(() => {
    if (settings.enabled && settings.delayMs > 0 && !frameDelay) {
      applySettings();
    }
  }, RETRY_INTERVAL_MS);
}

let adChangeTimer = null;

function watchAdState() {
  const onAdChange = () => {
    if (!settings.enabled || settings.delayMs <= 0) {
      return;
    }
    clearTimeout(adChangeTimer);
    adChangeTimer = setTimeout(() => applySettings(), 150);
  };

  const attachToPlayer = () => {
    const player = findMoviePlayer();
    if (!player || player.dataset.syncTubeAdWatch) {
      return;
    }
    player.dataset.syncTubeAdWatch = "1";
    const observer = new MutationObserver(onAdChange);
    observer.observe(player, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
      childList: true,
    });
  };

  attachToPlayer();
  const bodyObserver = new MutationObserver(attachToPlayer);
  bodyObserver.observe(document.body, { childList: true, subtree: true });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") {
    return;
  }

  if (changes[STORAGE_KEYS.enabled]) {
    settings.enabled = changes[STORAGE_KEYS.enabled].newValue;
  }
  if (changes[STORAGE_KEYS.delayMs]) {
    settings.delayMs = changes[STORAGE_KEYS.delayMs].newValue;
  }
  if (changes[STORAGE_KEYS.debug]) {
    settings.debug = changes[STORAGE_KEYS.debug].newValue;
    frameDelay?.setDebug?.(settings.debug);
  }

  if (!settings.enabled) {
    teardown();
    return;
  }

  applySettings();
});

log("content script loaded", location.href);
loadSettings();
watchNavigation();
watchPlayerMount();
watchAdState();
startRetryLoop();
