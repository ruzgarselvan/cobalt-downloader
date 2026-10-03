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

document.getElementById("refresh").onclick = () => render(true);
render(false);
