import { DEFAULTS, getSettings } from "./settings.js";

const settings = await getSettings();
for (const key of Object.keys(DEFAULTS)) {
  const el = document.getElementById(key);
  const prop = el.type === "checkbox" ? "checked" : "value";
  el[prop] = settings[key];
  el.addEventListener("change", () => chrome.storage.sync.set({ [key]: el[prop] }));
}

async function render(force) {
  const list = document.getElementById("list");
  const instances = await chrome.runtime.sendMessage({ type: "instances", force });
  list.replaceChildren(
    ...instances.map((i) => {
      const li = document.createElement("li");
      li.textContent = `${new URL(i.api).host} · ${i.score}%`;
      if (i.turnstile) {
        li.className = "muted";
        li.textContent += " · Turnstile (opened on its website only)";
      }
      return li;
    }),
  );
  if (!instances.length) list.innerHTML = "<li>Couldn't load the list.</li>";
}

const YTDLP_STATUS = {
  ready: "yt-dlp helper is installed. YouTube links download with yt-dlp.",
  "no-ytdlp": "The helper is installed but yt-dlp isn't. Run: brew install yt-dlp ffmpeg deno",
  "no-helper": "The yt-dlp helper isn't installed, so YouTube falls back to cobalt, which often fails. Run native/install.sh (see the README).",
};
chrome.runtime
  .sendMessage({ type: "ytdlpStatus" })
  .then((status) => (document.getElementById("ytdlpStatus").textContent = YTDLP_STATUS[status]));

document.getElementById("refresh").onclick = () => render(true);
render(false);
