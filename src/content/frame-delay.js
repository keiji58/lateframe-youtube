const FRAME_QUEUE_MAX = SYNC_TUBE.FRAME_QUEUE_MAX;

const OVERLAY_CLASS = "sync-tube-overlay";
const STATUS_CLASS = "sync-tube-status";
const HIDDEN_VIDEO_CLASS = "sync-tube-video-hidden";
const OVERLAY_Z_INDEX = 2500;

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
  #debug = false;
  #bufferReady = false;

  constructor(video, playerRoot, options = {}) {
    this.#video = video;
    this.#container = playerRoot;
    this.#captureCanvas = document.createElement("canvas");
    this.#debug = !!options.debug;
  }

  setDebug(enabled) {
    this.#debug = !!enabled;
  }

  getStatus() {
    const span =
      this.#frameQueue.length >= 2
        ? this.#frameQueue[this.#frameQueue.length - 1].mediaTime -
          this.#frameQueue[0].mediaTime
        : 0;
    return {
      active: this.#active,
      delayMs: this.#delayMs,
      bufferReady: this.#bufferReady,
      queueLength: this.#frameQueue.length,
      queueSpanSec: span,
      videoPaused: this.#video.paused,
      overlay: !!this.#container.querySelector(`.${OVERLAY_CLASS}`),
    };
  }

  #log(...args) {
    if (this.#debug) {
      console.log("[Sync Tube]", ...args);
    }
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
    this.#updateVideoVisibility();
    this.#startCaptureLoop();
    this.#bindVideoEvents();
    this.#setStatus("バッファ準備中…", { show: false });
  }

  stop() {
    if (!this.#active) {
      return;
    }
    this.#active = false;
    this.#stopCaptureLoop();
    this.#unbindVideoEvents();
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

    let overlay = player.querySelector(`.${OVERLAY_CLASS}`);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = OVERLAY_CLASS;
      overlay.innerHTML = `<canvas></canvas><div class="${STATUS_CLASS}" hidden></div>`;
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
        }
        .${OVERLAY_CLASS} canvas {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: contain;
          background: #000;
        }
        .${HIDDEN_VIDEO_CLASS} {
          opacity: 0 !important;
        }
      `;
      if (!document.getElementById("sync-tube-styles")) {
        style.id = "sync-tube-styles";
        document.head.appendChild(style);
      }
      const computed = getComputedStyle(player);
      if (computed.position === "static") {
        player.style.position = "relative";
      }
      player.appendChild(overlay);
    }

    this.#canvas = overlay.querySelector("canvas");
    this.#statusEl = overlay.querySelector(`.${STATUS_CLASS}`);
    this.#ctx = this.#canvas.getContext("2d", { alpha: false });
    this.#resizeCanvas();

    this.#resizeObserver?.disconnect();
    this.#resizeObserver = new ResizeObserver(() => this.#resizeCanvas());
    this.#resizeObserver.observe(this.#video);
    this.#resizeObserver.observe(player);

    document.addEventListener("fullscreenchange", this.#onFullscreenChange);
  }

  #unmountOverlay() {
    document.removeEventListener("fullscreenchange", this.#onFullscreenChange);
    const overlay = this.#container.querySelector(`.${OVERLAY_CLASS}`);
    overlay?.remove();
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
    this.#setStatus("バッファ準備中…", { show: false });
  };

  #updateVideoVisibility() {
    if (this.#bufferReady && this.#delayMs > 0) {
      this.#video.classList.add(HIDDEN_VIDEO_CLASS);
    } else {
      this.#video.classList.remove(HIDDEN_VIDEO_CLASS);
    }
  }

  #setStatus(text, { show = false } = {}) {
    if (!this.#statusEl) {
      return;
    }
    const visible = show || this.#debug;
    if (!visible) {
      this.#statusEl.hidden = true;
      return;
    }
    this.#statusEl.hidden = false;
    this.#statusEl.textContent = text;
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
      try {
        this.#ctx.drawImage(this.#video, 0, 0, this.#canvas.width, this.#canvas.height);
      } catch {
        // ignore draw errors during transitions
      }
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
    }

    const capCtx = this.#captureCanvas.getContext("2d", { alpha: false });
    try {
      capCtx.drawImage(this.#video, 0, 0, dw, dh);
    } catch {
      return;
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
      this.#setStatus(`Sync Tube: 映像 +${this.#delayMs}ms`, { show: true });
      this.#log("buffer ready", this.getStatus());
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
