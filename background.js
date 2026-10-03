import { getSettings } from "./settings.js";
import * as torbox from "./torbox.js";

const TORBOX_JOB_TIMEOUT = 24 * 60 * 60 * 1000;
const DIRECTORY = "https://cobalt.directory/";
const LIST_TTL = 6 * 60 * 60 * 1000;
const FALLBACK_FRONTEND = "https://cobalt.tools/";

// Links cobalt can handle. Matched against host (without "www.") + path.
const VIDEO_PATTERNS = [
  /(^|\.)youtube\.com\/(watch|shorts\/|live\/|embed\/)/,
  /^youtu\.be\/./,
  /(^|\.)tiktok\.com\/(@[^/]+\/(video|photo)\/|t\/|v\/)|^(vm|vt)\.tiktok\.com\/./,
  /(^|\.)instagram\.com\/((p|reels?|tv|stories)\/|[^/]+\/(p|reel)\/)/,
  /^(mobile\.)?(twitter|x)\.com\/[^/]+\/status\//,
  /(^|\.)reddit\.com\/(r|u|user)\/[^/]+\/(comments|s)\/|^(v\.)?redd\.it\/./,
  /(^|\.)vimeo\.com\/(.+\/)?\d+/,
  /^(m\.)?soundcloud\.com\/[^/]+\/[^/]+|^on\.soundcloud\.com\/./,
  /(^|\.)twitch\.tv\/[^/]+\/clip\/|^clips\.twitch\.tv\/./,
  /(^|\.)bilibili\.(com|tv)\/(.+\/)?video\/|^b23\.tv\/./,
  /(^|\.)pinterest\.[a-z.]+\/pin\/|^pin\.it\/./,
  /(^|\.)tumblr\.com\/.+\/\d+/,
  /(^|\.)facebook\.com\/(watch|reel\/|share\/[rv]\/|[^/]+\/videos\/)|^fb\.watch\/./,
  /(^|\.)dailymotion\.com\/video\/|^dai\.ly\/./,
  /^streamable\.com\/./,
  /^bsky\.app\/profile\/[^/]+\/post\//,
  /(^|\.)loom\.com\/share\//,
  /^(m\.)?ok\.ru\/video\//,
  /(^|\.)(vk\.com|vkvideo\.ru)\/(video|clip)/,
  /^rutube\.ru\/(video|shorts)\//,
  /(^|\.)snapchat\.com\/(spotlight|t\/|add\/[^/]+\/)/,
  /(^|\.)xiaohongshu\.com\/(explore|discovery\/item)\/|^xhslink\.com\/./,
  /(^|\.)newgrounds\.com\/(portal\/view|audio\/listen)\//,
];

function videoUrl(text) {
  text = text.trim();
  if (text.length > 2048 || /\s/.test(text)) return null;
  try {
    const url = new URL(text);
    if (!url.protocol.startsWith("http")) return null;
    const target = url.hostname.replace(/^www\./, "") + url.pathname;
    return VIDEO_PATTERNS.some((p) => p.test(target)) ? url.href : null;
  } catch {
    return null;
  }
}

// cobalt.directory has no public API, so read its instance tables.
function parseDirectory(html) {
  const rows = [];
  for (const [, row] of html.matchAll(/<tr class="rating-[^"]*">([\s\S]*?)<\/tr>/g)) {
    const cells = [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(([, c]) => c);
    if (cells.length < 8) continue;
    const text = cells.map((c) => c.replace(/<[^>]*>/g, "").trim());
    if (text[2] === "Offline") continue;
    rows.push({
      api: text[1].startsWith("http") ? text[1] : `https://${text[1]}/`,
      frontend: cells[0].match(/href="([^"]+)"/)?.[1] ?? null,
      turnstile: text[4] === "✅",
      score: parseInt(text[7]) || 0,
    });
  }
  return rows.sort((a, b) => b.score - a.score);
}

// Decides what a copied text is: a video link for cobalt, or (with a TorBox key) a
// magnet or file-hoster link for TorBox.
async function classify(text) {
  text = text.trim();
  if (/\s/.test(text)) return null;
  const { torboxKey } = await getSettings();
  if (torboxKey && torbox.isMagnet(text)) return { link: text, kind: "torbox" };
  const video = videoUrl(text);
  if (video) return { link: video, kind: "video" };
  if (torboxKey && /^https?:\/\//.test(text)) {
    const patterns = await torbox.getHosterPatterns();
    if (patterns.some((p) => new RegExp(p, "i").test(text))) return { link: text, kind: "torbox" };
  }
  return null;
}

async function getInstances(force = false) {
  const { instances, fetchedAt = 0 } = await chrome.storage.local.get(["instances", "fetchedAt"]);
  if (!force && instances && Date.now() - fetchedAt < LIST_TTL) return instances;
  try {
    const res = await fetch(DIRECTORY, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    const list = parseDirectory(await res.text());
    if (list.length) {
      await chrome.storage.local.set({ instances: list, fetchedAt: Date.now() });
      return list;
    }
  } catch {}
  return instances ?? [];
}

// Keeps "/" so multi-file torrents land in their own folder.
const cleanPath = (path) => path.split("/").map((part) => part.replace(/[\\:*?"<>|]/g, "_")).join("/");

const save = (url, filename) => chrome.downloads.download({ url, ...(filename && { filename: cleanPath(filename) }) });

const notify = (title, message) =>
  chrome.notifications.create({ type: "basic", iconUrl: "icons/128.png", title, message });

async function download(link, mode, kind) {
  const { torboxKey } = await getSettings();
  if (kind === "torbox") return torboxDownload(torboxKey, link);
  const result = await cobaltDownload(link, mode);
  // TorBox has no audio-only mode, so it is only a fallback for full downloads.
  if (result.ok || !torboxKey || mode === "audio") return result;
  const viaTorbox = await torboxDownload(torboxKey, link);
  return viaTorbox.ok ? viaTorbox : { ...result, errors: [...result.errors, `TorBox: ${viaTorbox.error}`] };
}

async function torboxDownload(key, link) {
  try {
    const job = await torbox.add(key, link);
    const ready = await torbox.check(key, job);
    if (ready) {
      for (const file of ready.files) await save(file.url, file.filename);
      return { ok: true, host: "TorBox" };
    }
    const { torboxJobs = [] } = await chrome.storage.local.get("torboxJobs");
    await chrome.storage.local.set({ torboxJobs: [...torboxJobs, { ...job, link, addedAt: Date.now() }] });
    chrome.alarms.create("torbox", { periodInMinutes: 0.5 });
    return { ok: true, queued: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Content TorBox doesn't have cached yet (e.g. an uncached torrent) is fetched on its
// side first; poll until it is ready, then download it.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "torbox") return;
  const { torboxKey } = await getSettings();
  const { torboxJobs: jobs = [] } = await chrome.storage.local.get("torboxJobs");
  const pending = [];
  for (const job of jobs) {
    try {
      const ready = await torbox.check(torboxKey, job);
      if (ready) {
        for (const file of ready.files) await save(file.url, file.filename);
        notify("TorBox indirmesi hazır", ready.name);
      } else if (Date.now() - job.addedAt < TORBOX_JOB_TIMEOUT) {
        pending.push(job);
      } else {
        notify("TorBox indirmesi zaman aşımına uğradı", job.link);
      }
    } catch (e) {
      // Network hiccups are retried on the next tick; API errors end the job.
      if (["TypeError", "TimeoutError", "AbortError"].includes(e.name)) pending.push(job);
      else notify("TorBox indiremedi", `${e.message}\n${job.link}`);
    }
  }
  const { torboxJobs: now = [] } = await chrome.storage.local.get("torboxJobs");
  const added = now.filter((j) => !jobs.some((o) => o.kind === j.kind && o.id === j.id));
  await chrome.storage.local.set({ torboxJobs: [...pending, ...added] });
  if (!pending.length && !added.length) chrome.alarms.clear("torbox");
});

async function cobaltDownload(link, mode) {
  const settings = await getSettings();
  const list = await getInstances();
  let apis = list.filter((i) => !i.turnstile).map((i) => i.api);
  if (settings.customApi) {
    apis = [settings.customApi.includes("://") ? settings.customApi : `https://${settings.customApi}`];
  }
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = `Api-Key ${settings.apiKey}`;

  const errors = [];
  for (const api of apis) {
    const host = new URL(api).host;
    try {
      const res = await fetch(api, {
        method: "POST",
        headers,
        body: JSON.stringify({ url: link, downloadMode: mode, videoQuality: settings.quality }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();
      if (data.status === "tunnel" || data.status === "redirect") {
        await save(data.url, data.filename);
        return { ok: true, host };
      }
      if (data.status === "picker") {
        if (mode === "audio" && data.audio) await save(data.audio, data.audioFilename);
        else for (const item of data.picker) await save(item.url);
        return { ok: true, host };
      }
      errors.push(`${host}: ${data.error?.code ?? data.status}`);
    } catch (e) {
      errors.push(`${host}: ${e.message}`);
    }
  }
  const frontend = list.find((i) => i.turnstile && i.frontend)?.frontend ?? FALLBACK_FRONTEND;
  return { ok: false, errors, frontend };
}

function openFrontend(link, frontend) {
  const url = new URL(frontend);
  url.searchParams.set("u", link);
  chrome.tabs.create({ url: url.href });
}

// Shows the toast only in the tab the link was copied from: the active tab of a
// Helium window that has focus. Copies made in other apps are ignored.
async function prompt(link, kind, tab) {
  if (!tab) {
    const win = await chrome.windows.getLastFocused({ populate: true });
    if (!win.focused) return;
    tab = win.tabs.find((t) => t.active);
  }
  if (!tab?.id) return;
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "prompt", link, kind });
  } catch {}
  // Tabs opened before the extension was installed have no content script yet.
  // Pages like the new tab page can't host one at all; nothing is shown there.
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "prompt", link, kind });
  } catch {}
}

let lastLink = null;

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type === "clipboard") {
    classify(msg.text).then((found) => {
      if (found && found.link !== lastLink) prompt(found.link, found.kind);
      lastLink = found?.link ?? null;
    });
  } else if (msg.type === "download") {
    download(msg.link, msg.mode, msg.kind).then(respond);
    return true;
  } else if (msg.type === "openFrontend") {
    openFrontend(msg.link, msg.frontend);
  } else if (msg.type === "instances") {
    getInstances(msg.force).then(respond);
    return true;
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url) return;
  const found = await classify(tab.url);
  prompt(tab.url, found?.kind ?? "video", tab);
});

// The offscreen document polls the clipboard; it only exists while watching is on.
async function syncOffscreen() {
  const { watchClipboard } = await getSettings();
  const open = await chrome.offscreen.hasDocument();
  try {
    if (watchClipboard && !open) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["CLIPBOARD"],
        justification: "Kopyalanan video linklerini algılamak",
      });
    } else if (!watchClipboard && open) {
      await chrome.offscreen.closeDocument();
    }
  } catch {}
}

chrome.runtime.onStartup.addListener(syncOffscreen);
chrome.runtime.onInstalled.addListener(syncOffscreen);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.watchClipboard) syncOffscreen();
});
syncOffscreen();
