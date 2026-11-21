const { DEFAULT_SETTINGS, STORAGE_KEYS } = LATE_FRAME;

const INIT_DEBOUNCE_MS = 500;
const RETRY_INTERVAL_MS = 1000;

let settings = { ...DEFAULT_SETTINGS };
let frameDelay = null;
let attachedVideo = null;
let initTimer = null;
let retryTimer = null;
let adChangeTimer = null;

// --- Boot: loadSettings → applySettings ---

/**
 * Load enabled/delay from sync storage and apply to the current player.
 */
async function loadSettings() {
  const stored = await chrome.storage.sync.get([
    STORAGE_KEYS.enabled,
    STORAGE_KEYS.delayMs,
  ]);
  settings = {
    enabled: stored[STORAGE_KEYS.enabled] ?? DEFAULT_SETTINGS.enabled,
    delayMs: stored[STORAGE_KEYS.delayMs] ?? DEFAULT_SETTINGS.delayMs,
  };
  applySettings();
}

/**
 * Attach or update FrameDelay when enabled with delay > 0; tear down otherwise.
 * Skips while a YouTube ad is showing.
 */
function applySettings() {
  if (!settings.enabled || settings.delayMs <= 0) {
    teardown();
    return;
  }

  const player = findMoviePlayer();

  if (LATE_FRAME.isAdPlaying(player)) {
    teardown();
    return;
  }

  const video = findMainVideo(player);

  if (!video || !player) {
    return;
  }

  if (attachedVideo !== video) {
    teardown();
    attachedVideo = video;
    bindVideoLifecycle(video);
    frameDelay = new FrameDelay(video, player);
    frameDelay.start();
  }

  frameDelay.setDelayMs(settings.delayMs);
}

function teardown() {
  frameDelay?.destroy();
  frameDelay = null;
  attachedVideo = null;
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
  // Even at readyState 0, keep the element if it has a source; loadeddata retries later.
  if (video.readyState === 0 && !video.src && !video.currentSrc) {
    return null;
  }
  return video;
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

function scheduleInit() {
  clearTimeout(initTimer);
  initTimer = setTimeout(() => {
    teardown();
    applySettings();
  }, INIT_DEBOUNCE_MS);
}

// --- Persistent watchers ---

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
    if (!player || player.dataset.lateFrameAdWatch) {
      return;
    }
    player.dataset.lateFrameAdWatch = "1";
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

function startRetryLoop() {
  retryTimer = setInterval(() => {
    if (settings.enabled && settings.delayMs > 0 && !frameDelay) {
      applySettings();
    }
  }, RETRY_INTERVAL_MS);
}

// --- Settings changes from the popup ---

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

  if (!settings.enabled) {
    teardown();
    return;
  }

  applySettings();
});

// --- Start ---

loadSettings();
watchNavigation();
watchPlayerMount();
watchAdState();
startRetryLoop();
