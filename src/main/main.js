'use strict';

const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  desktopCapturer,
  session,
  screen,
} = require('electron');
const path = require('node:path');

const config = require('./config');
const { CHANNELS } = require('./channels');
const { createSidecar } = require('../whisper/sidecar');
const { createWhisperClient } = require('../whisper/client');
const { createSerialQueue } = require('../whisper/queue');
const { createOllamaClient } = require('../ollama/client');
const { createRetrievalClient } = require('../qdrant/client');
const { createSettingsStore } = require('./settings-store');

const IS_DEV = !app.isPackaged || process.env.INVISIBLE_DEV === '1';
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// ---------------------------------------------------------------------------
// Command-line switches. These MUST run before app.whenReady().
// ---------------------------------------------------------------------------

// Windows' native occlusion detector treats a transparent always-on-top window
// as covered and throttles or blanks its renderer. Disabling it is required for
// the overlay to keep painting while a full-screen meeting app is in front.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// The audio worker is a hidden window; without these it gets timer-throttled
// and VAD frames arrive in bursts instead of in real time.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// ---------------------------------------------------------------------------
// Process-wide state
// ---------------------------------------------------------------------------

/** @type {BrowserWindow | null} */
let overlayWin = null;
/** @type {BrowserWindow | null} */
let audioWin = null;
/** @type {import('../graph/graph').AgentRuntime | null} */
let agent = null;
/** @type {ReturnType<typeof createSidecar> | null} */
let sidecar = null;
/** @type {ReturnType<typeof createSettingsStore> | null} */
let settings = null;

const state = {
  visible: true,
  /** When true the overlay accepts clicks and can be focused. */
  interactive: false,
  /** True once the audio worker reports a live capture graph. */
  capturing: false,
  /** whisper-server lifecycle, mirrored to the overlay. */
  stt: 'stopped',
  /** Utterances discarded because the transcription backlog was full. */
  dropped: 0,
  /** Ollama reachability, mirrored to the overlay. */
  llm: 'unknown',
  /** Retrieval readiness, mirrored to the overlay. */
  rag: 'unknown',
};

/** Per-turn timing, keyed by turnId. Entries are deleted on turn end. */
const turnMetrics = new Map();

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function sendToOverlay(channel, payload) {
  if (overlayWin && !overlayWin.isDestroyed() && !overlayWin.webContents.isDestroyed()) {
    overlayWin.webContents.send(channel, payload);
  }
}

function sendToAudio(channel, payload) {
  if (audioWin && !audioWin.isDestroyed() && !audioWin.webContents.isDestroyed()) {
    audioWin.webContents.send(channel, payload);
  }
}

function pushStatus(patch) {
  sendToOverlay(CHANNELS.STATUS, { ...state, ...patch });
}

function log(...args) {
  if (IS_DEV) console.log('[invisible]', ...args);
}

// ---------------------------------------------------------------------------
// Invisibility hardening
// ---------------------------------------------------------------------------

/**
 * Applies every property that keeps the overlay out of screen shares and out of
 * the way of the app underneath.
 *
 * setContentProtection maps to SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)
 * on Windows 10 2004+ and to NSWindowSharingNone on macOS. It is not sticky:
 * some driver resets, display hot-plugs, and window re-creation events drop the
 * affinity flag, so this is re-applied on every show/restore rather than once.
 */
function applyStealth(win) {
  if (!win || win.isDestroyed()) return;

  win.setContentProtection(true);

  // 'screen-saver' is the highest level Electron exposes and is the only one
  // that reliably stays above full-screen Zoom/Teams windows on Windows.
  win.setAlwaysOnTop(true, 'screen-saver', 1);

  // Keeps the overlay present when the user switches virtual desktops or a
  // meeting app goes full screen (macOS/Linux; no-op on Windows).
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // skipTaskbar sets WS_EX_TOOLWINDOW on Windows, which also removes the
  // window from the Alt-Tab switcher.
  win.setSkipTaskbar(true);
}

/**
 * Click-through toggle. `forward: true` keeps delivering mousemove to the
 * renderer so hover/affordance styling still works while clicks pass through
 * to the app underneath.
 */
function setInteractive(next) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  state.interactive = next;

  overlayWin.setIgnoreMouseEvents(!next, { forward: true });
  overlayWin.setFocusable(next);

  if (next) {
    overlayWin.showInactive();
    overlayWin.focus();
  } else if (IS_MAC) {
    // Returning focus to whatever was behind us, so keystrokes land in the
    // interview app and not in a window the user thinks is dismissed.
    app.hide?.();
    app.show?.();
  }

  sendToOverlay(CHANNELS.OVERLAY_MODE, { interactive: next });
  pushStatus({});
  log('interactive =', next);
}

function setVisible(next) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  state.visible = next;

  if (next) {
    overlayWin.showInactive();
    applyStealth(overlayWin);
  } else {
    // If we hide while interactive, the click-through state would be stale on
    // the next show. Normalise first.
    if (state.interactive) setInteractive(false);
    overlayWin.hide();
  }
  pushStatus({});
}

function nudge(dx, dy) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const [x, y] = overlayWin.getPosition();
  overlayWin.setPosition(x + dx, y + dy, false);
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function createOverlayWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const { width, height, margin } = config.overlay;

  overlayWin = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - margin,
    y: workArea.y + margin,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    thickFrame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Never steal focus from the app the user is actually being interviewed in.
    focusable: false,
    acceptFirstMouse: false,
    alwaysOnTop: true,
    // 'panel' keeps the window above full-screen spaces on macOS.
    ...(IS_MAC ? { type: 'panel', vibrancy: undefined } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: false is required for the preload to `require('./channels')`.
      // A sandboxed preload's `require` is a polyfill covering only `electron`
      // and a few Node built-ins, so relative imports fail. contextIsolation
      // stays on, so the renderer world still has no Node access — only the
      // preload does, and the renderer loads local files with navigation and
      // window.open already blocked.
      sandbox: false,
      backgroundThrottling: false,
      devTools: IS_DEV,
      spellcheck: false,
    },
  });

  applyStealth(overlayWin);
  overlayWin.setIgnoreMouseEvents(true, { forward: true });

  // Re-assert on every event that is known to drop display affinity.
  for (const evt of ['show', 'restore', 'always-on-top-changed']) {
    overlayWin.on(evt, () => applyStealth(overlayWin));
  }
  screen.on('display-metrics-changed', () => applyStealth(overlayWin));
  screen.on('display-added', () => applyStealth(overlayWin));
  screen.on('display-removed', () => applyStealth(overlayWin));

  // The overlay is click-through and non-focusable, so reaching its DevTools
  // means first toggling interactive mode. A React render error would
  // otherwise show up as a silently blank panel.
  if (IS_DEV) {
    overlayWin.webContents.on('console-message', (event) => {
      const level = ['debug', 'info', 'warning', 'error'][event.level] ?? event.level;
      log(`overlay[${level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    });
    overlayWin.webContents.on('render-process-gone', (_e, details) => {
      log('overlay process gone:', details.reason);
    });
  }

  // Nothing in this window should ever navigate or open a browser window.
  overlayWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlayWin.webContents.on('will-navigate', (e) => e.preventDefault());

  overlayWin.on('closed', () => {
    overlayWin = null;
  });

  overlayWin.loadFile(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'));

  overlayWin.once('ready-to-show', () => {
    if (state.visible) overlayWin.showInactive();
    applyStealth(overlayWin);
  });

  // Dev-only design check. The overlay is click-through, non-focusable, and
  // excluded from screen capture, so the only way to actually look at it is to
  // ask the renderer for its own surface — capturePage reads that rather than
  // the screen, so display affinity does not block it.
  if (IS_DEV && process.env.INVISIBLE_CAPTURE) {
    const target = process.env.INVISIBLE_CAPTURE;
    const delay = Number(process.env.INVISIBLE_CAPTURE_DELAY_MS ?? 3000);
    setTimeout(async () => {
      try {
        const image = await overlayWin.webContents.capturePage();
        require('node:fs').writeFileSync(target, image.toPNG());
        log('captured overlay to', target);
      } catch (err) {
        log('capture failed:', err.message);
      }
    }, delay);
  }

  return overlayWin;
}

/**
 * Hidden renderer used purely as an audio host.
 *
 * getUserMedia / getDisplayMedia / AudioWorklet only exist in a renderer
 * process, so system-loopback and microphone capture cannot run in main. This
 * window renders nothing; it owns the capture graph, the Silero VAD, and the
 * resampler, and ships finished utterances back over IPC.
 */
function createAudioWorker() {
  audioWin = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-audio.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: false is required for the preload to `require('./channels')`.
      // A sandboxed preload's `require` is a polyfill covering only `electron`
      // and a few Node built-ins, so relative imports fail. contextIsolation
      // stays on, so the renderer world still has no Node access — only the
      // preload does, and the renderer loads local files with navigation and
      // window.open already blocked.
      sandbox: false,
      backgroundThrottling: false,
      devTools: IS_DEV,
    },
  });

  // The worker window is never shown, but it still participates in screen
  // capture enumeration on some platforms. Cheap insurance.
  audioWin.setContentProtection(true);

  // The worker window is never shown, so its DevTools console is unreachable in
  // practice. Without this, a failed VAD asset fetch or worklet error is
  // completely silent and looks identical to "no one is speaking".
  if (IS_DEV) {
    audioWin.webContents.on('console-message', (event) => {
      const level = ['debug', 'info', 'warning', 'error'][event.level] ?? event.level;
      log(`worker[${level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    });
    audioWin.webContents.on('render-process-gone', (_e, details) => {
      log('worker process gone:', details.reason);
    });
  }

  audioWin.on('closed', () => {
    audioWin = null;
    state.capturing = false;
  });

  audioWin.loadFile(path.join(__dirname, '..', 'audio', 'audio-worker.html'));
  return audioWin;
}

// ---------------------------------------------------------------------------
// Session: media permissions + loopback capture
// ---------------------------------------------------------------------------

function configureSession() {
  const ses = session.defaultSession;

  // Only the microphone is ever requested; deny everything else outright.
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'audioCapture');
  });
  ses.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media' || permission === 'audioCapture';
  });

  // System audio path. Electron 31+ exposes `audio: 'loopback'` here, which is
  // the WASAPI loopback stream on Windows. Chromium still requires a video
  // source to be handed back for the request to resolve; the worker stops that
  // video track the moment the stream arrives.
  ses.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 0, height: 0 },
        });
        if (!sources.length || process.env.INVISIBLE_BREAK_LOOPBACK === '1') {
          callback({});
          return;
        }
        callback({ video: sources[0], audio: 'loopback' });
      } catch (err) {
        log('display media handler failed:', err);
        callback({});
      }
    },
    { useSystemPicker: false }
  );
}

// ---------------------------------------------------------------------------
// Global shortcuts
// ---------------------------------------------------------------------------

function registerShortcuts() {
  const { shortcuts } = config;
  const bindings = [
    [shortcuts.toggleVisibility, () => setVisible(!state.visible)],
    [shortcuts.toggleInteractive, () => setInteractive(!state.interactive)],
    [shortcuts.manualAsk, () => agent?.ask()],
    [shortcuts.clearContext, () => clearContext()],
    [shortcuts.panic, () => panic()],
    [shortcuts.nudgeUp, () => nudge(0, -config.overlay.nudgeStep)],
    [shortcuts.nudgeDown, () => nudge(0, config.overlay.nudgeStep)],
    [shortcuts.nudgeLeft, () => nudge(-config.overlay.nudgeStep, 0)],
    [shortcuts.nudgeRight, () => nudge(config.overlay.nudgeStep, 0)],
  ];

  const failed = [];
  for (const [accelerator, handler] of bindings) {
    if (!accelerator) continue;
    try {
      // register() returns false when another process already owns the combo,
      // but *throws* on a malformed accelerator. Both are per-binding problems
      // and neither may abort the loop — losing one shortcut must not cost the
      // other eight, nor the app startup that follows this call.
      if (!globalShortcut.register(accelerator, handler)) failed.push(accelerator);
    } catch (err) {
      failed.push(`${accelerator} (${err.message})`);
    }
  }

  if (failed.length) {
    // Non-fatal: report it rather than silently losing a control.
    log('shortcuts unavailable (already claimed by another app):', failed.join(', '));
    sendToOverlay(CHANNELS.AGENT_ERROR, {
      scope: 'shortcuts',
      message: `Unavailable: ${failed.join(', ')}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Control actions
// ---------------------------------------------------------------------------

function clearContext() {
  agent?.clear();
  sendToOverlay(CHANNELS.AGENT_CLEAR, {});
  log('context cleared');
}

/** Stop capture, drop all state, hide. One keystroke, no confirmation. */
function panic() {
  sendToAudio(CHANNELS.AUDIO_STOP, {});
  state.capturing = false;
  agent?.cancel();
  agent?.clear();
  setVisible(false);
  log('panic');
}

// ---------------------------------------------------------------------------
// Agent runtime bridge
// ---------------------------------------------------------------------------

/**
 * Loads the LangGraph runtime lazily so a missing/broken graph module degrades
 * to "overlay runs, agent reports an error" instead of a failed app launch.
 */
function initAgent() {
  let createAgentRuntime;
  try {
    ({ createAgentRuntime } = require('../graph/graph'));
  } catch (err) {
    log('agent runtime unavailable:', err.message);
    sendToOverlay(CHANNELS.AGENT_ERROR, {
      scope: 'agent',
      message: `Graph failed to load: ${err.message}`,
    });
    return null;
  }

  const client = createWhisperClient({
    baseUrl: sidecar.baseUrl,
    timeoutMs: config.whisper.requestTimeoutMs,
    language: config.whisper.language,
  });

  const queue = createSerialQueue({
    maxDepth: config.whisper.maxQueueDepth,
    onDrop: (n) => {
      state.dropped += n;
      log('dropped utterance, backlog full; total', state.dropped);
      pushStatus({});
    },
  });

  /**
   * The transcribe function handed to the graph. Serialised here rather than
   * inside the client, so the backlog is bounded and observable instead of
   * queueing invisibly inside whisper-server.
   */
  async function transcribe(pcm, sampleRate) {
    if (!sidecar.isReady()) {
      throw new Error('whisper-server is not ready');
    }
    const { text, ms } = await queue.push(() => client.transcribe(pcm, sampleRate));
    log('transcribed', `${ms}ms`, `${(pcm.length / sampleRate).toFixed(1)}s audio`, JSON.stringify(text));
    return text;
  }

  const ollama = createOllamaClient({
    baseUrl: config.agent.ollamaBaseUrl,
    model: config.agent.model,
    temperature: config.agent.temperature,
    numPredict: config.agent.numPredict,
    keepAlive: config.agent.keepAlive,
    historyTurns: config.agent.historyTurns,
  });

  // Probed once at startup rather than per turn: a per-turn probe would add a
  // round trip to the latency path to answer a question that changes rarely.
  ollama
    .probe()
    .then((result) => {
      state.llm = result.ok ? (result.hasModel ? 'ready' : 'no-model') : 'offline';
      log('ollama', state.llm, result.error ?? '');
      pushStatus({});

      if (state.llm === 'ready') {
        // Not awaited: the cold load takes ~18 s and must not gate startup.
        // Without it that cost lands on the first question of the interview.
        ollama.warmup().then((warm) => {
          log('ollama warmup', warm.ok ? `${warm.ms}ms` : `failed: ${warm.error}`);
        });
      }

      if (state.llm === 'no-model') {
        sendToOverlay(CHANNELS.AGENT_ERROR, {
          scope: 'llm',
          message: `${config.agent.model} not pulled - run \`npm run ollama:pull\``,
        });
      } else if (state.llm === 'offline') {
        sendToOverlay(CHANNELS.AGENT_ERROR, {
          scope: 'llm',
          message: `Ollama unreachable at ${config.agent.ollamaBaseUrl} - run \`npm run ollama:up\``,
        });
      }
    })
    .catch((err) => log('ollama probe failed:', err.message));

  const retrieval = createRetrievalClient({
    url: config.agent.qdrant.url,
    collection: config.agent.qdrant.collection,
    topK: config.agent.qdrant.topK,
    scoreThreshold: config.agent.qdrant.scoreThreshold,
    ollamaBaseUrl: config.agent.ollamaBaseUrl,
    embedModel: config.agent.embedModel,
  });

  // Probed once at startup. An empty or missing collection is deliberately not
  // an error: the app is fully usable with no corpus at all, just less
  // specific, and a red banner on a fresh clone trains the operator to ignore
  // banners.
  retrieval
    .probe()
    .then((result) => {
      state.rag = !result.ok ? 'offline' : result.exists && result.points > 0 ? 'ready' : 'empty';
      log('qdrant', state.rag, result.exists ? `${result.points} points` : '', result.error ?? '');
      pushStatus({});
    })
    .catch((err) => log('qdrant probe failed:', err.message));

  return createAgentRuntime({
    config: config.agent,
    transcribe,
    search: retrieval.search,
    stream: ollama.stream,
    // Every emitter below is the single path from graph -> UI.
    onTurnStart: (turn) => {
      // Time-to-first-token is the number the operator actually feels; steady
      // state throughput is far above reading speed. Tracked per turn so a
      // regression shows up in the log rather than only as a vibe.
      turnMetrics.set(turn.turnId, { startedAt: Date.now(), firstTokenMs: null, tokens: 0 });
      log('turn start', turn.turnId, turn.speaker);
      sendToOverlay(CHANNELS.AGENT_TURN_START, turn);
    },
    onToken: (turnId, token) => {
      const metric = turnMetrics.get(turnId);
      if (metric) {
        if (metric.firstTokenMs === null) metric.firstTokenMs = Date.now() - metric.startedAt;
        metric.tokens += 1;
      }
      sendToOverlay(CHANNELS.AGENT_TOKEN, { turnId, token });
    },
    onTurnEnd: (turn) => {
      const metric = turnMetrics.get(turn.turnId);
      turnMetrics.delete(turn.turnId);
      log(
        'turn end',
        turn.turnId,
        turn.aborted ? 'aborted' : 'complete',
        metric ? `first-token ${metric.firstTokenMs}ms, ${metric.tokens} tokens in ${Date.now() - metric.startedAt}ms` : ''
      );
      sendToOverlay(CHANNELS.AGENT_TURN_END, turn);
    },
    onTranscriptFinal: (seg) => sendToOverlay(CHANNELS.TRANSCRIPT_FINAL, seg),
    onTranscriptPartial: (seg) => sendToOverlay(CHANNELS.TRANSCRIPT_PARTIAL, seg),
    onError: (err) => {
      // Logged as well as sent: without this, an agent-path failure is visible
      // only on the overlay, which is exactly the surface you cannot read while
      // diagnosing one.
      log('agent error:', err?.message ?? String(err));
      sendToOverlay(CHANNELS.AGENT_ERROR, {
        scope: 'agent',
        message: err?.message ?? String(err),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  // --- overlay renderer -> main -------------------------------------------
  ipcMain.on(CHANNELS.OVERLAY_READY, (event) => {
    if (overlayWin && event.sender === overlayWin.webContents) {
      // Proves the renderer mounted and the bridge is live. Without it, a
      // renderer that failed to boot looks identical to one that is simply
      // idle, because every other log line comes from main.
      log('overlay ready');
      pushStatus({});
    }
  });

  ipcMain.handle(CHANNELS.SETTINGS_GET, () => settings.get());

  ipcMain.handle(CHANNELS.SETTINGS_SET, (_event, patch) => {
    // Returned rather than thrown: a rejected promise across the bridge loses
    // the message, and the message is the whole point of validation.
    try {
      return { ok: true, settings: settings.set(patch) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(CHANNELS.SETTINGS_RESET, () => ({ ok: true, settings: settings.reset() }));

  ipcMain.on(CHANNELS.AGENT_CANCEL, () => agent?.cancel());
  ipcMain.on(CHANNELS.AGENT_CLEAR, () => clearContext());

  ipcMain.on(CHANNELS.AGENT_ASK, (_event, payload) => {
    const question = typeof payload?.question === 'string' ? payload.question : '';
    agent?.ask(question);
  });

  ipcMain.on(CHANNELS.OVERLAY_SET_INTERACTIVE, (_event, payload) => {
    setInteractive(Boolean(payload?.interactive));
  });

  // --- audio worker -> main ------------------------------------------------
  ipcMain.on(CHANNELS.AUDIO_READY, () => {
    state.capturing = true;
    pushStatus({});
    log('audio worker ready');
  });

  ipcMain.on(CHANNELS.AUDIO_SPEECH_START, (_event, payload) => {
    sendToOverlay(CHANNELS.STATUS, { ...state, speaking: payload?.speaker ?? 'remote' });
  });

  /**
   * payload: { speaker: 'user' | 'remote', pcm: ArrayBuffer, sampleRate, durationMs }
   * `pcm` is Float32 mono at config.audio.sampleRate. Electron's structured
   * clone moves the ArrayBuffer without a base64 round trip.
   */
  ipcMain.on(CHANNELS.AUDIO_UTTERANCE, (_event, payload) => {
    log('utterance', payload?.speaker, `${payload?.durationMs}ms`,
        `${payload?.pcm?.byteLength ?? 0}B`);
    if (!agent || !payload?.pcm) return;
    agent.submitUtterance({
      speaker: payload.speaker === 'user' ? 'user' : 'remote',
      pcm: new Float32Array(payload.pcm),
      sampleRate: payload.sampleRate ?? config.audio.sampleRate,
      durationMs: payload.durationMs ?? 0,
    });
  });

  ipcMain.on(CHANNELS.AUDIO_LEVEL, (_event, payload) => {
    sendToOverlay(CHANNELS.STATUS, {
      ...state,
      speakerLevel: payload?.speaker ?? 'remote',
      level: payload?.level ?? 0,
    });
  });

  ipcMain.on(CHANNELS.AUDIO_ERROR, (_event, payload) => {
    state.capturing = false;
    log('audio error:', payload?.message);
    sendToOverlay(CHANNELS.AGENT_ERROR, {
      scope: 'audio',
      message: payload?.message ?? 'Audio capture failed',
    });
    pushStatus({});
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// A second instance would race for the same global shortcuts and silently
// break the first one's controls.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (overlayWin) setVisible(true);
  });

  app.whenReady().then(() => {
    if (IS_MAC) app.dock?.hide();

    settings = createSettingsStore({
      defaults: config,
      filePath: path.join(app.getPath('userData'), 'settings.json'),
    });

    configureSession();
    createOverlayWindow();
    createAudioWorker();

    // Constructed before initAgent, which reads sidecar.baseUrl when it builds
    // the whisper client.
    sidecar = createSidecar({
      config: config.whisper,
      root: path.join(__dirname, '..', '..'),
      onLog: (line) => log('whisper:', line),
      onStateChange: (next, detail) => {
        state.stt = next;
        pushStatus({});
        if (next === 'failed') {
          sendToOverlay(CHANNELS.AGENT_ERROR, {
            scope: 'stt',
            message: detail ?? 'whisper-server failed',
          });
        }
      },
    });

    agent = initAgent();
    registerIpc();
    registerShortcuts();

    // Deliberately not awaited: the overlay and both capture chains must come
    // up immediately. Utterances that arrive before the model finishes loading
    // fail with "whisper-server is not ready", which surfaces as an error
    // rather than a hang.
    sidecar.start().catch((err) => log('whisper failed to start:', err.message));

    // Kick off capture once the worker's preload has attached.
    audioWin?.webContents.once('did-finish-load', () => {
      sendToAudio(CHANNELS.AUDIO_START, { audio: config.audio });
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createOverlayWindow();
        createAudioWorker();
      }
    });
  });

  // The overlay has no visible chrome, so closing the last window is never a
  // user-initiated quit on Windows either. Quit only on explicit request.
  app.on('window-all-closed', () => app.quit());

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    agent?.dispose();
    // An orphaned whisper-server would hold 1.6 GB of VRAM after the app exits.
    sidecar?.stop();
  });

  // A crash in a node must not take the overlay down mid-interview.
  process.on('uncaughtException', (err) => {
    log('uncaught:', err);
    sendToOverlay(CHANNELS.AGENT_ERROR, { scope: 'main', message: err.message });
  });
  process.on('unhandledRejection', (err) => {
    log('unhandled rejection:', err);
  });
}
