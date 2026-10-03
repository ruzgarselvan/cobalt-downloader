// The toast shown when a video link is copied. Injected into every page, and on
// demand into tabs that were open before install, hence the guard.
if (!window.__cobaltIndir) {
  window.__cobaltIndir = true;

  const STYLE = `
    :host { all: initial; }
    .toast {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      width: 320px; box-sizing: border-box; padding: 14px;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #1d1d1f; background: #ffffffee; backdrop-filter: blur(16px);
      border: 1px solid #0000001a; border-radius: 14px;
      box-shadow: 0 10px 30px #00000026;
      animation: in .18s ease-out;
    }
    @keyframes in { from { opacity: 0; transform: translateY(8px); } }
    .head { display: flex; align-items: center; gap: 8px; }
    .title { font-weight: 600; flex: 1; }
    .close { all: unset; cursor: pointer; padding: 0 4px; font-size: 16px; opacity: .5; }
    .close:hover { opacity: 1; }
    .link { margin: 4px 0 12px; opacity: .6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .actions { display: flex; gap: 8px; }
    button.btn {
      all: unset; cursor: pointer; flex: 1; text-align: center; padding: 7px 0;
      border-radius: 8px; font-weight: 500; background: #0000000d;
    }
    button.btn.primary { background: #0a84ff; color: #fff; }
    button.btn:hover { filter: brightness(.95); }
    button.btn:disabled { cursor: default; opacity: .5; }
    .status { margin-top: 10px; }
    .status:empty { display: none; }
    .status.error { color: #d70015; }
    @media (prefers-color-scheme: dark) {
      .toast { color: #f5f5f7; background: #1d1d1fee; border-color: #ffffff1f; }
      button.btn { background: #ffffff1a; }
      .status.error { color: #ff6961; }
    }
  `;

  let current = null;

  function show(link, kind) {
    const viaTorbox = kind === "torbox";
    current?.remove();
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="toast" role="dialog" aria-label="Video indir">
        <div class="head">
          <span class="title"></span>
          <button class="close" aria-label="Kapat">×</button>
        </div>
        <div class="link"></div>
        <div class="actions">
          <button class="btn primary" data-mode="auto">İndir</button>
          <button class="btn" data-mode="audio">Sadece ses</button>
        </div>
        <div class="status"></div>
      </div>`;
    const $ = (s) => root.querySelector(s);
    const status = $(".status");
    const actions = $(".actions");
    $(".title").textContent = !viaTorbox
      ? "Video linki algılandı"
      : link.startsWith("magnet:") ? "Magnet linki algılandı" : "Dosya linki algılandı";
    if (viaTorbox) {
      $("[data-mode=auto]").textContent = "TorBox ile indir";
      $("[data-mode=audio]").remove();
    }
    $(".link").textContent = link;
    $(".link").title = link;
    $(".close").onclick = close;

    // Auto-dismiss after 3 s unless a button is pressed. Compares against the clock
    // because browsers throttle timers in background windows.
    let deadline = Date.now() + 3000;
    let busy = false;
    const timer = setInterval(() => {
      if (!busy && Date.now() >= deadline) close();
    }, 200);

    function close() {
      clearInterval(timer);
      host.remove();
      if (current === host) current = null;
    }

    for (const btn of root.querySelectorAll("[data-mode]")) {
      btn.onclick = async () => {
        busy = true;
        actions.querySelectorAll("button").forEach((b) => (b.disabled = true));
        status.className = "status";
        status.textContent = viaTorbox ? "TorBox'a gönderiliyor…" : "Uygun instance aranıyor…";
        const result = await chrome.runtime.sendMessage({ type: "download", link, mode: btn.dataset.mode, kind });
        if (result.ok) {
          status.textContent = result.queued
            ? "TorBox'a eklendi. Hazır olunca otomatik inecek."
            : `İndirme başladı (${result.host})`;
          busy = false;
          deadline = Date.now() + (result.queued ? 6000 : 3000);
          return;
        }
        status.className = "status error";
        busy = false;
        if (!result.frontend) {
          status.textContent = `TorBox indiremedi: ${result.error}`;
          return;
        }
        const triedTorbox = result.errors.some((e) => e.startsWith("TorBox:"));
        status.textContent = triedTorbox
          ? "Cobalt instance'ları ve TorBox bu linki indiremedi."
          : "Turnstile'sız instance'lar bu linki indiremedi.";
        status.title = result.errors.join("\n") || "Kullanılabilir instance yok";
        const open = document.createElement("button");
        open.className = "btn primary";
        open.textContent = `${new URL(result.frontend).host} sitesinde aç`;
        open.onclick = () => {
          chrome.runtime.sendMessage({ type: "openFrontend", link, frontend: result.frontend });
          close();
        };
        actions.replaceChildren(open);
      };
    }

    document.documentElement.append(host);
    current = host;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "prompt" && window === window.top) show(msg.link, msg.kind);
  });
}
