const SYNC_TUBE = {
  STORAGE_KEYS: {
    enabled: "enabled",
    delayMs: "delayMs",
  },
  DEFAULT_SETTINGS: {
    enabled: true,
    delayMs: 0,
  },
  MAX_DELAY_MS: 500,
  DELAY_STEP_MS: 10,
  PRESET_DELAYS_MS: [0, 100, 200, 300],
  FRAME_QUEUE_MAX: 60,
  AD_PLAYER_CLASSES: ["ad-showing", "ad-interrupting"],
  AD_SELECTOR:
    ".ytp-ad-module, .ytp-ad-player-overlay, .ytp-ad-preview-container, .ytp-ad-overlay-container, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-button, .ytp-ad-text, .ytp-ad-image, .ytp-ad-visit-advertiser-button, .video-ads",

  isElementVisible(el) {
    if (!el) {
      return false;
    }
    const style = getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  },

  isAdPlaying(player) {
    if (!player) {
      return false;
    }
    for (const cls of SYNC_TUBE.AD_PLAYER_CLASSES) {
      if (player.classList.contains(cls)) {
        return true;
      }
    }
    // DOM だけでは判定しない（非表示の広告用要素が常駐しているため）
    for (const selector of [
      ".ytp-ad-player-overlay",
      ".ytp-ad-module",
      ".ytp-ad-preview-container",
    ]) {
      const el = player.querySelector(selector);
      if (SYNC_TUBE.isElementVisible(el)) {
        return true;
      }
    }
    return false;
  },

  isAdTarget(target) {
    return (
      target instanceof Element &&
      !!target.closest(SYNC_TUBE.AD_SELECTOR)
    );
  },
};
