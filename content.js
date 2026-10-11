// The toast shown when a video link is copied. Injected into every page, and on
// demand into tabs that were open before install, hence the guard.
if (!window.__cobaltIndir) {
  window.__cobaltIndir = true;

  const DISMISS_MS = 3000;

  const icon = (paths) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    download: icon('<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>'),
    audio: icon('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
    close: icon('<path d="M17 7 7 17M7 7l10 10"/>'),
    done: icon('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    alert: icon('<path d="M12 7v6"/><path d="M12 17h.01"/>'),
  };

  const STYLE = `
    :host { all: initial; }
    .toast {
      --fg: #111; --muted: #6e6e73; --bg: #ffffffec; --line: #00000014;
      --primary-bg: #111; --primary-fg: #fff; --soft: #0000000a; --soft-hover: #00000014;
      --error: #d70015;
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      width: 340px; box-sizing: border-box; padding: 10px 10px 10px 14px; overflow: hidden;
      font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      color: var(--fg); background: var(--bg); backdrop-filter: blur(20px) saturate(1.6);
      border: 1px solid var(--line); border-radius: 18px;
      box-shadow: 0 12px 32px #0000002e, 0 2px 6px #0000001a;
      animation: in .22s cubic-bezier(.2, .9, .3, 1.2);
    }
    @keyframes in { from { opacity: 0; transform: translateY(10px) scale(.97); } }
    .row { display: flex; align-items: center; gap: 6px; }
    .text { flex: 1; min-width: 0; margin-right: 4px; }
    .host { font-weight: 650; letter-spacing: -.01em; }
    .link, .host { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .link { color: var(--muted); font-size: 12px; margin-top: 1px; }
    button {
      all: unset; box-sizing: border-box; cursor: pointer; flex: none;
      display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px;
      background: var(--soft); color: var(--fg); transition: background .12s, transform .12s;
    }
    button:hover { background: var(--soft-hover); }
    button:active { transform: scale(.94); }
    button:focus-visible { outline: 2px solid #0a84ff; outline-offset: 2px; }
    button.primary { background: var(--primary-bg); color: var(--primary-fg); }
    button.primary:hover { opacity: .88; }
    button.ghost { background: none; width: 26px; color: var(--muted); }
    button.ghost:hover { color: var(--fg); }
    button:disabled { cursor: default; opacity: .4; }
    button.busy { opacity: 1; }
    svg { width: 18px; height: 18px; }
    button.ghost svg { width: 15px; height: 15px; }
    .spinner {
      width: 16px; height: 16px; border-radius: 50%;
      border: 2.2px solid currentColor; border-right-color: transparent;
      animation: spin .7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .status { margin-top: 8px; font-size: 12px; color: var(--muted); }
    .status:empty { display: none; }
    .status.error { color: var(--error); }
    .fallback {
      width: auto; height: 30px; margin-top: 8px; padding: 0 12px; font-size: 12px; font-weight: 600;
    }
    .timer {
      position: absolute; left: 0; bottom: 0; height: 2px; width: 100%;
      background: var(--fg); opacity: .25; transform-origin: left;
      animation: shrink ${DISMISS_MS}ms linear forwards;
    }
    @keyframes shrink { to { transform: scaleX(0); } }
    .job { width: 300px; padding: 10px 8px 10px 10px; }
    .job .text { margin-left: 4px; }
    .state {
      flex: none; display: grid; place-items: center; width: 30px; height: 30px;
      border-radius: 50%; background: var(--soft);
    }
    .state .spinner { width: 13px; height: 13px; }
    .state svg { width: 16px; height: 16px; }
    .state.done { color: #34c759; background: #34c75922; }
    .state.error { color: var(--error); background: #ff3b3022; }
    .bar { height: 3px; margin-top: 9px; border-radius: 2px; background: var(--soft); overflow: hidden; }
    .fill { height: 100%; width: 0; border-radius: 2px; background: var(--fg); transition: width .3s; }
    .fill.indeterminate { width: 30%; animation: slide 1.2s ease-in-out infinite; }
    @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
    @media (prefers-color-scheme: dark) {
      .toast {
        --fg: #f5f5f7; --muted: #a1a1a6; --bg: #1c1c1eeb; --line: #ffffff1a;
        --primary-bg: #f5f5f7; --primary-fg: #111; --soft: #ffffff14; --soft-hover: #ffffff24;
        --error: #ff6961;
      }
    }
  `;

  let current = null;
  let onProgress = null;

  const hostLabel = (link) =>
    link.startsWith("magnet:") ? "Magnet link" : new URL(link).hostname.replace(/^www\./, "");

  function show(link, kind) {
    const viaTorbox = kind === "torbox";
    current?.remove();
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="toast" role="dialog" aria-label="Download">
        <div class="row">
          <div class="text"><div class="host"></div><div class="link"></div></div>
          <button class="primary" data-mode="auto">${ICONS.download}</button>
          <button data-mode="audio" title="Audio only" aria-label="Audio only">${ICONS.audio}</button>
          <button class="ghost close" title="Close" aria-label="Close">${ICONS.close}</button>
        </div>
        <div class="status" role="status"></div>
        <div class="timer"></div>
      </div>`;
    const $ = (s) => root.querySelector(s);
    const status = $(".status");
    const primary = $("[data-mode=auto]");
    const label = viaTorbox ? "Download with TorBox" : "Download";
    primary.title = label;
    primary.setAttribute("aria-label", label);
    if (viaTorbox) $("[data-mode=audio]").remove();
    $(".host").textContent = hostLabel(link) + (viaTorbox && !link.startsWith("magnet:") ? " · TorBox" : "");
    $(".link").textContent = link;
    $(".link").title = link;
    $(".close").onclick = close;

    // Auto-dismiss after 3 s unless a button is pressed. Compares against the clock
    // because browsers throttle timers in background windows.
    let deadline = Date.now() + DISMISS_MS;
    let busy = false;
    const timer = setInterval(() => {
      if (!busy && Date.now() >= deadline) close();
    }, 200);

    function close() {
      clearInterval(timer);
      onProgress = null;
      host.remove();
      if (current === host) current = null;
    }

    for (const btn of root.querySelectorAll("[data-mode]")) {
      btn.onclick = async () => {
        busy = true;
        $(".timer").remove();
        root.querySelectorAll("[data-mode]").forEach((b) => (b.disabled = true));
        btn.classList.add("busy");
        btn.innerHTML = '<div class="spinner"></div>';
        status.className = "status";
        status.textContent = viaTorbox ? "Sending to TorBox…" : "Finding a working instance…";
        onProgress = (text) => (status.textContent = text);
        const result = await chrome.runtime.sendMessage({ type: "download", link, mode: btn.dataset.mode, kind });
        busy = false;
        onProgress = null;
        btn.classList.remove("busy");
        if (result.ok) {
          btn.innerHTML = ICONS.done;
          status.textContent = result.queued
            ? "Added to TorBox. It will download automatically when ready."
            : result.existing
              ? "Already in your Downloads folder"
              : result.saved ? "Saved to Downloads" : `Downloading via ${result.host}`;
          deadline = Date.now() + (result.queued ? 5000 : 2000);
          return;
        }
        btn.innerHTML = btn.dataset.mode === "audio" ? ICONS.audio : ICONS.download;
        status.className = "status error";
        if (!result.frontend) {
          status.textContent = result.message ?? `TorBox couldn't download this: ${result.error}`;
          deadline = Date.now() + 6000;
          return;
        }
        const triedTorbox = result.errors.some((e) => e.startsWith("TorBox:"));
        status.textContent =
          result.message ??
          (triedTorbox
            ? "Neither the cobalt instances nor TorBox could download this link."
            : "No Turnstile-free instance could download this link.");
        status.title = result.errors.join("\n") || "No usable instance";
        const open = document.createElement("button");
        open.className = "primary fallback";
        open.textContent = `Open on ${new URL(result.frontend).host}`;
        open.onclick = () => {
          chrome.runtime.sendMessage({ type: "openFrontend", link, frontend: result.frontend });
          close();
        };
        status.after(open);
        busy = true; // keep the fallback offer on screen until used or closed
      };
    }

    document.documentElement.append(host);
    current = host;
  }

  // Status toast for downloads started from the toolbar button, updated as they run.
  let job = null;

  function showJob(msg) {
    if (job?.link !== msg.link || !job.host.isConnected) job = createJobToast(msg.link);
    job.update(msg);
  }

  function createJobToast(link) {
    current?.remove();
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="toast job" role="status">
        <div class="row">
          <div class="state"></div>
          <div class="text"><div class="host"></div><div class="link"></div></div>
          <button class="ghost cancel" title="Cancel download" aria-label="Cancel download">${ICONS.close}</button>
        </div>
        <div class="bar"><div class="fill"></div></div>
      </div>`;
    const $ = (s) => root.querySelector(s);
    $(".host").textContent = hostLabel(link);
    $(".cancel").onclick = () => chrome.runtime.sendMessage({ type: "cancelJob" });
    let hideTimer;
    const close = () => {
      host.remove();
      if (current === host) current = null;
    };
    document.documentElement.append(host);
    current = host;

    return {
      link,
      host,
      update({ state, text, percent, frontend }) {
        clearTimeout(hideTimer);
        const working = state === "working";
        $(".link").textContent = text;
        $(".state").className = `state ${state}`;
        $(".state").innerHTML = working
          ? '<div class="spinner"></div>'
          : { done: ICONS.done, error: ICONS.alert, cancelled: ICONS.close }[state];
        $(".bar").style.display = working ? "" : "none";
        $(".fill").classList.toggle("indeterminate", percent == null);
        $(".fill").style.width = percent == null ? "" : `${percent}%`;
        $(".cancel").title = working ? "Cancel download" : "Close";
        $(".cancel").onclick = working ? () => chrome.runtime.sendMessage({ type: "cancelJob" }) : close;
        if (frontend && !$(".fallback")) {
          const open = document.createElement("button");
          open.className = "primary fallback";
          open.textContent = `Open on ${new URL(frontend).host}`;
          open.onclick = () => {
            chrome.runtime.sendMessage({ type: "openFrontend", link, frontend });
            close();
          };
          $(".row").after(open);
        }
        if (!working) hideTimer = setTimeout(close, { done: 3000, cancelled: 2000 }[state] ?? 10000);
      },
    };
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "job" && window === window.top) showJob(msg);
    if (msg.type === "prompt" && window === window.top) show(msg.link, msg.kind);
    if (msg.type === "progress") onProgress?.(msg.text);
  });
}
