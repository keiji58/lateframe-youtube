const FRAME_QUEUE_MAX = LATE_FRAME.FRAME_QUEUE_MAX;

const OVERLAY_CLASS = "late-frame-overlay";
const OVERLAY_VISIBLE_CLASS = "late-frame-overlay-visible";
const STATUS_CLASS = "late-frame-status";
const HIDDEN_VIDEO_CLASS = "late-frame-video-hidden";
const PLAYER_ACTIVE_CLASS = "late-frame-player-active";
/** Video layer; chrome boosted via CSS when active */
const OVERLAY_Z_INDEX = 60;
const CONTROLS_HIDE_DELAY_MS = 2500;
const LONG_PRESS_MS = 450;
const LONG_PRESS_PLAYBACK_RATE = 2;
const CHROME_SELECTOR =
  ".ytp-chrome-bottom, .ytp-chrome-top, .ytp-button, .ytp-progress-bar-container, .ytp-progress-bar, .ytp-play-button, .ytp-tooltip, .ytp-panel, .ytp-popup";

/**
 * Delays video display via frame buffer + canvas while audio plays from the source video.
 */
class FrameDelay {
  #video;
  #container;
  #canvas;
  #ctx;
  #statusEl = null;
  #frameQueue = [];
  #delayMs = 0;
  #rvfcId = null;
  #rafId = null;
  #resizeObserver = null;
  #usingRvfc = false;
  #active = false;
  #captureCanvas;
  #captureCtx = null;
  #overlayEl = null;
  #onPlayerPointerActivity = null;
  #onPlayerClick = null;
  #onPlayerDblClick = null;
  #onPlayerPointerDown = null;
  #onPlayerPointerUp = null;
  #onGlobalPointerUp = null;
  #controlsHideTimer = null;
  #longPressTimer = null;
  #longPressPointerId = null;
  #didLongPress = false;
  #suppressNextClick = false;
  #savedPlaybackRate = 1;
  #bufferReady = false;

  constructor(video, playerRoot) {
    this.#video = video;
    this.#container = playerRoot;
    this.#captureCanvas = document.createElement("canvas");
  }

  setDelayMs(ms) {
    const prev = this.#delayMs;
    this.#delayMs = Math.max(0, ms);
    this.#trimQueue();
    if (this.#active && (prev === 0) !== (this.#delayMs === 0)) {
      this.#startCaptureLoop();
    }
  }

  start() {
    if (this.#active) {
      return;
    }
    this.#active = true;
    this.#bufferReady = false;
    this.#mountOverlay();
    this.#bindPlayerControls();
    this.#updateVideoVisibility();
    this.#startCaptureLoop();
    this.#bindVideoEvents();
    this.#setStatus("", { ready: false });
  }

  stop() {
    if (!this.#active) {
      return;
    }
    this.#active = false;
    this.#stopCaptureLoop();
    this.#unbindVideoEvents();
    this.#unbindPlayerControls();
    this.#video.classList.remove(HIDDEN_VIDEO_CLASS);
    this.#frameQueue = [];
    this.#unmountOverlay();
  }

  destroy() {
    this.stop();
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
  }

  #mountOverlay() {
    const player =
      this.#container.querySelector(".html5-video-player") ||
      this.#container;

    let overlay = this.#container.querySelector(`.${OVERLAY_CLASS}`);
    const chromeBottom = player.querySelector(".ytp-chrome-bottom");
    if (overlay && chromeBottom) {
      player.insertBefore(overlay, chromeBottom);
    }
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = OVERLAY_CLASS;
      overlay.innerHTML = `<canvas></canvas><div class="${STATUS_CLASS}"></div>`;
      const style = document.createElement("style");
      style.textContent = `
        .${OVERLAY_CLASS} {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: ${OVERLAY_Z_INDEX};
          overflow: hidden;
        }
        #movie_player.${PLAYER_ACTIVE_CLASS} .ytp-chrome-bottom,
        #movie_player.${PLAYER_ACTIVE_CLASS} .ytp-chrome-top {
          z-index: 100 !important;
        }
        #movie_player.${PLAYER_ACTIVE_CLASS}.ytp-show-controls .ytp-chrome-bottom,
        #movie_player.${PLAYER_ACTIVE_CLASS}.ytp-show-controls .ytp-chrome-top {
          opacity: 1 !important;
          visibility: visible !important;
        }
        #movie_player.${PLAYER_ACTIVE_CLASS}.ytp-show-controls .ytp-gradient-bottom {
          opacity: 1 !important;
        }
        .${STATUS_CLASS} {
          position: absolute;
          top: 8px;
          left: 8px;
          z-index: ${OVERLAY_Z_INDEX + 1};
          padding: 4px 8px;
          border-radius: 4px;
          font: 12px/1.4 system-ui, sans-serif;
          color: #fff;
          background: rgba(0, 0, 0, 0.75);
          pointer-events: none;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.25s ease;
        }
        #movie_player.${PLAYER_ACTIVE_CLASS}.ytp-show-controls .${STATUS_CLASS}.${STATUS_CLASS}-ready {
          opacity: 1;
          visibility: visible;
        }
        .${OVERLAY_CLASS} canvas {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: contain;
          background: #000;
        }
        .${OVERLAY_CLASS}:not(.${OVERLAY_VISIBLE_CLASS}) {
          visibility: hidden;
        }
        .${HIDDEN_VIDEO_CLASS} {
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `;
      if (!document.getElementById("late-frame-styles")) {
        style.id = "late-frame-styles";
        document.head.appendChild(style);
      }
      const computed = getComputedStyle(player);
      if (computed.position === "static") {
        player.style.position = "relative";
      }
      if (chromeBottom) {
        player.insertBefore(overlay, chromeBottom);
      } else {
        player.appendChild(overlay);
      }
    }

    this.#overlayEl = overlay;
    this.#canvas = overlay.querySelector("canvas");
    this.#statusEl = overlay.querySelector(`.${STATUS_CLASS}`);
    this.#ctx = this.#canvas.getContext("2d", { alpha: false });
    this.#captureCtx = null;
    this.#resizeCanvas();

    this.#resizeObserver?.disconnect();
    this.#resizeObserver = new ResizeObserver(() => {
      this.#resizeCanvas();
    });
    this.#resizeObserver.observe(this.#video);
    this.#resizeObserver.observe(player);

    document.addEventListener("fullscreenchange", this.#onFullscreenChange);
  }

  #isYoutubeChromeTarget(target) {
    return target instanceof Element && target.closest(CHROME_SELECTOR);
  }

  #shouldIgnorePlaybackGesture(event) {
    return (
      LATE_FRAME.isAdPlaying(this.#container) ||
      LATE_FRAME.isAdTarget(event.target)
    );
  }

  #scheduleControlsHide() {
    clearTimeout(this.#controlsHideTimer);
    this.#controlsHideTimer = setTimeout(() => {
      this.#container.classList.remove("ytp-show-controls");
    }, CONTROLS_HIDE_DELAY_MS);
  }

  #showControls() {
    this.#container.classList.add("ytp-show-controls");
    this.#scheduleControlsHide();
  }

  #findInteractionTarget() {
    const player =
      this.#container.querySelector(".html5-video-player") || this.#container;
    return (
      player.querySelector(".ytp-clickwrap") ||
      player.querySelector(".html5-video-container") ||
      this.#video
    );
  }

  #eventInit(event) {
    return {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      button: event.button,
      buttons: event.buttons,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    };
  }

  #cancelLongPress() {
    clearTimeout(this.#longPressTimer);
    this.#longPressTimer = null;
    this.#longPressPointerId = null;
    this.#unbindGlobalPointerUp();
    if (this.#didLongPress) {
      this.#video.playbackRate = this.#savedPlaybackRate;
      this.#didLongPress = false;
      this.#suppressNextClick = true;
    }
  }

  #bindGlobalPointerUp() {
    if (this.#onGlobalPointerUp) {
      return;
    }
    this.#onGlobalPointerUp = (event) => {
      if (
        this.#longPressPointerId != null &&
        event.pointerId !== this.#longPressPointerId
      ) {
        return;
      }
      this.#cancelLongPress();
    };
    document.addEventListener("pointerup", this.#onGlobalPointerUp, true);
    document.addEventListener("pointercancel", this.#onGlobalPointerUp, true);
  }

  #unbindGlobalPointerUp() {
    if (!this.#onGlobalPointerUp) {
      return;
    }
    document.removeEventListener("pointerup", this.#onGlobalPointerUp, true);
    document.removeEventListener(
      "pointercancel",
      this.#onGlobalPointerUp,
      true
    );
    this.#onGlobalPointerUp = null;
  }

  #bindPlayerControls() {
    this.#onPlayerPointerActivity = (event) => {
      if (LATE_FRAME.isAdPlaying(this.#container)) {
        return;
      }
      if (event?.target && LATE_FRAME.isAdTarget(event.target)) {
        return;
      }
      this.#showControls();
    };

    this.#onPlayerPointerDown = (event) => {
      if (
        !this.#bufferReady ||
        this.#shouldIgnorePlaybackGesture(event) ||
        this.#isYoutubeChromeTarget(event.target)
      ) {
        return;
      }
      if (event.button !== 0) {
        return;
      }

      // Restore any stuck long-press rate before sampling the baseline.
      this.#cancelLongPress();
      this.#savedPlaybackRate = this.#video.playbackRate;
      this.#longPressPointerId = event.pointerId;
      this.#bindGlobalPointerUp();
      this.#longPressTimer = setTimeout(() => {
        this.#didLongPress = true;
        this.#video.playbackRate = LONG_PRESS_PLAYBACK_RATE;
      }, LONG_PRESS_MS);
    };

    // Always cancel — do not gate on chrome/ad targets, or the 2x timer can
    // keep firing after the user already released.
    this.#onPlayerPointerUp = () => {
      this.#cancelLongPress();
    };

    this.#onPlayerClick = (event) => {
      if (
        !this.#bufferReady ||
        this.#shouldIgnorePlaybackGesture(event) ||
        this.#isYoutubeChromeTarget(event.target)
      ) {
        return;
      }
      if (this.#suppressNextClick) {
        this.#suppressNextClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.#video.paused) {
        this.#video.play().catch(() => {});
      } else {
        this.#video.pause();
      }
    };

    this.#onPlayerDblClick = (event) => {
      if (
        !this.#bufferReady ||
        this.#shouldIgnorePlaybackGesture(event) ||
        this.#isYoutubeChromeTarget(event.target)
      ) {
        return;
      }
      const target = this.#findInteractionTarget();
      target.dispatchEvent(
        new MouseEvent("dblclick", this.#eventInit(event))
      );
    };

    this.#container.classList.add(PLAYER_ACTIVE_CLASS);
    this.#container.addEventListener(
      "pointermove",
      this.#onPlayerPointerActivity,
      true
    );
    this.#container.addEventListener(
      "pointerenter",
      this.#onPlayerPointerActivity,
      true
    );
    this.#container.addEventListener(
      "pointerdown",
      this.#onPlayerPointerDown,
      true
    );
    this.#container.addEventListener("pointerup", this.#onPlayerPointerUp, true);
    this.#container.addEventListener(
      "pointercancel",
      this.#onPlayerPointerUp,
      true
    );
    this.#container.addEventListener("click", this.#onPlayerClick, true);
    this.#container.addEventListener("dblclick", this.#onPlayerDblClick, true);
  }

  #unbindPlayerControls() {
    clearTimeout(this.#controlsHideTimer);
    this.#controlsHideTimer = null;
    this.#cancelLongPress();

    if (this.#onPlayerPointerActivity) {
      this.#container.removeEventListener(
        "pointermove",
        this.#onPlayerPointerActivity,
        true
      );
      this.#container.removeEventListener(
        "pointerenter",
        this.#onPlayerPointerActivity,
        true
      );
      this.#onPlayerPointerActivity = null;
    }

    if (this.#onPlayerPointerDown) {
      this.#container.removeEventListener(
        "pointerdown",
        this.#onPlayerPointerDown,
        true
      );
      this.#onPlayerPointerDown = null;
    }
    if (this.#onPlayerPointerUp) {
      this.#container.removeEventListener(
        "pointerup",
        this.#onPlayerPointerUp,
        true
      );
      this.#container.removeEventListener(
        "pointercancel",
        this.#onPlayerPointerUp,
        true
      );
      this.#onPlayerPointerUp = null;
    }
    if (this.#onPlayerClick) {
      this.#container.removeEventListener("click", this.#onPlayerClick, true);
      this.#onPlayerClick = null;
    }
    if (this.#onPlayerDblClick) {
      this.#container.removeEventListener(
        "dblclick",
        this.#onPlayerDblClick,
        true
      );
      this.#onPlayerDblClick = null;
    }

    this.#video.playbackRate = this.#savedPlaybackRate || 1;
    this.#container.classList.remove(PLAYER_ACTIVE_CLASS, "ytp-show-controls");
  }

  #unmountOverlay() {
    document.removeEventListener("fullscreenchange", this.#onFullscreenChange);
    const overlay = this.#container.querySelector(`.${OVERLAY_CLASS}`);
    overlay?.remove();
    this.#overlayEl = null;
    this.#canvas = null;
    this.#ctx = null;
  }

  #onFullscreenChange = () => {
    requestAnimationFrame(() => this.#resizeCanvas());
  };

  #resizeCanvas() {
    if (!this.#canvas || !this.#video) {
      return;
    }
    const rect = this.#video.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (this.#canvas.width !== w || this.#canvas.height !== h) {
      this.#canvas.width = w;
      this.#canvas.height = h;
    }
  }

  /** 映像はプレイヤー全体に描画し、再生バーは z-index で上に重なる */
  #drawVideoFrame(ctx, source) {
    const vw = this.#video.videoWidth;
    const vh = this.#video.videoHeight;
    if (!ctx || !vw || !vh || !this.#canvas) {
      return;
    }
    try {
      ctx.drawImage(
        source,
        0,
        0,
        vw,
        vh,
        0,
        0,
        this.#canvas.width,
        this.#canvas.height
      );
    } catch {
      // ignore draw errors during transitions
    }
  }

  #bindVideoEvents() {
    this.#video.addEventListener("pause", this.#onPause);
    this.#video.addEventListener("play", this.#onPlay);
    this.#video.addEventListener("seeked", this.#onSeeked);
    this.#video.addEventListener("emptied", this.#onSeeked);
  }

  #unbindVideoEvents() {
    this.#video.removeEventListener("pause", this.#onPause);
    this.#video.removeEventListener("play", this.#onPlay);
    this.#video.removeEventListener("seeked", this.#onSeeked);
    this.#video.removeEventListener("emptied", this.#onSeeked);
  }

  #onPause = () => {
    this.#stopCaptureLoop();
    this.#frameQueue = [];
  };

  #onPlay = () => {
    if (this.#active && this.#delayMs >= 0) {
      this.#startCaptureLoop();
    }
  };

  #onSeeked = () => {
    this.#frameQueue = [];
    this.#bufferReady = false;
    this.#updateVideoVisibility();
    this.#setStatus("", { ready: false });
  };

  #updateVideoVisibility() {
    const showOverlay = this.#bufferReady && this.#delayMs > 0;
    if (showOverlay) {
      this.#video.classList.add(HIDDEN_VIDEO_CLASS);
      this.#overlayEl?.classList.add(OVERLAY_VISIBLE_CLASS);
    } else {
      this.#video.classList.remove(HIDDEN_VIDEO_CLASS);
      this.#overlayEl?.classList.remove(OVERLAY_VISIBLE_CLASS);
    }
  }

  #setStatus(text, { ready = false } = {}) {
    if (!this.#statusEl) {
      return;
    }
    this.#statusEl.textContent = text;
    this.#statusEl.classList.toggle(`${STATUS_CLASS}-ready`, ready);
  }

  #checkBufferReady() {
    if (this.#delayMs <= 0 || this.#frameQueue.length < 2) {
      return false;
    }
    const span =
      this.#frameQueue[this.#frameQueue.length - 1].mediaTime -
      this.#frameQueue[0].mediaTime;
    const need = (this.#delayMs / 1000) * 0.85;
    return span >= need;
  }

  #startCaptureLoop() {
    this.#stopCaptureLoop();
    if (this.#video.paused || this.#video.ended) {
      return;
    }
    if (this.#delayMs <= 0) {
      this.#startZeroDelayLoop();
      return;
    }
    if (typeof this.#video.requestVideoFrameCallback === "function") {
      this.#usingRvfc = true;
      this.#rvfcId = this.#video.requestVideoFrameCallback(this.#onVideoFrame);
    } else {
      this.#usingRvfc = false;
      this.#fallbackLoop();
    }
  }

  #stopCaptureLoop() {
    if (this.#rvfcId != null && this.#usingRvfc) {
      this.#video.cancelVideoFrameCallback(this.#rvfcId);
      this.#rvfcId = null;
    }
    if (this.#rafId != null) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }
  }

  #startZeroDelayLoop() {
    const draw = () => {
      if (!this.#active || !this.#ctx) {
        return;
      }
      this.#resizeCanvas();
      this.#drawVideoFrame(this.#ctx, this.#video);
      this.#rafId = requestAnimationFrame(draw);
    };
    draw();
  }

  #onVideoFrame = (_now, metadata) => {
    if (!this.#active) {
      return;
    }

    this.#captureFrame(metadata.mediaTime);
    this.#displayDelayedFrame(metadata.mediaTime);
    this.#rvfcId = this.#video.requestVideoFrameCallback(this.#onVideoFrame);
  };

  #fallbackLoop() {
    const tick = () => {
      if (!this.#active) {
        return;
      }
      const mediaTime = this.#video.currentTime;
      this.#captureFrame(mediaTime);
      this.#displayDelayedFrame(mediaTime);
      this.#rafId = requestAnimationFrame(tick);
    };
    tick();
  }

  #captureFrame(mediaTime) {
    const vw = this.#video.videoWidth;
    const vh = this.#video.videoHeight;
    if (!vw || !vh || !this.#canvas) {
      return;
    }

    const dw = this.#canvas.width;
    const dh = this.#canvas.height;
    if (dw < 1 || dh < 1) {
      return;
    }

    if (this.#captureCanvas.width !== dw || this.#captureCanvas.height !== dh) {
      this.#captureCanvas.width = dw;
      this.#captureCanvas.height = dh;
      this.#captureCtx = this.#captureCanvas.getContext("2d", {
        alpha: false,
        willReadFrequently: true,
      });
    }

    const capCtx =
      this.#captureCtx ||
      this.#captureCanvas.getContext("2d", {
        alpha: false,
        willReadFrequently: true,
      });
    this.#captureCtx = capCtx;

    this.#video.classList.remove(HIDDEN_VIDEO_CLASS);
    try {
      this.#drawVideoFrame(capCtx, this.#video);
    } catch {
      return;
    } finally {
      if (this.#bufferReady && this.#delayMs > 0) {
        this.#video.classList.add(HIDDEN_VIDEO_CLASS);
      }
    }

    this.#frameQueue.push({
      mediaTime,
      imageData: capCtx.getImageData(0, 0, dw, dh),
      width: dw,
      height: dh,
    });

    this.#trimQueue();

    const wasReady = this.#bufferReady;
    this.#bufferReady = this.#checkBufferReady();
    if (this.#bufferReady && !wasReady) {
      this.#updateVideoVisibility();
      this.#setStatus(`LateFrame: +${this.#delayMs}ms`, { ready: true });
    }
  }

  #trimQueue() {
    const delaySec = this.#delayMs / 1000;
    const cutoff = this.#video.currentTime - delaySec - 1;
    while (
      this.#frameQueue.length > 0 &&
      this.#frameQueue[0].mediaTime < cutoff
    ) {
      this.#frameQueue.shift();
    }
    while (this.#frameQueue.length > FRAME_QUEUE_MAX) {
      this.#frameQueue.shift();
    }
  }

  #displayDelayedFrame(currentMediaTime) {
    if (!this.#ctx || !this.#canvas) {
      return;
    }

    this.#resizeCanvas();

    if (this.#delayMs <= 0) {
      return;
    }

    if (!this.#bufferReady) {
      return;
    }

    const targetTime = currentMediaTime - this.#delayMs / 1000;
    let frame = null;

    for (let i = this.#frameQueue.length - 1; i >= 0; i--) {
      if (this.#frameQueue[i].mediaTime <= targetTime) {
        frame = this.#frameQueue[i];
        break;
      }
    }

    // ウォームアップ直後: 取れるだけ古いフレームを使う（遅延を最大化）
    if (!frame && this.#frameQueue.length > 0) {
      frame = this.#frameQueue[0];
    }

    if (!frame) {
      return;
    }

    if (
      this.#captureCanvas.width !== frame.width ||
      this.#captureCanvas.height !== frame.height
    ) {
      this.#captureCanvas.width = frame.width;
      this.#captureCanvas.height = frame.height;
    }

    const capCtx = this.#captureCanvas.getContext("2d", { alpha: false });
    capCtx.putImageData(frame.imageData, 0, 0);

    try {
      this.#ctx.drawImage(
        this.#captureCanvas,
        0,
        0,
        frame.width,
        frame.height,
        0,
        0,
        this.#canvas.width,
        this.#canvas.height
      );
    } catch {
      // ignore
    }
  }
}
