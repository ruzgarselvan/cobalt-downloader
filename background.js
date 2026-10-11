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

const YTDLP_HOST = "com.cobalt_downloader.ytdlp";
const isYouTube = (link) => /^((www|m|music)\.)?youtube\.com$|^youtu\.be$/.test(new URL(link).hostname);

const CANCELLED = { ok: false, cancelled: true };

// Says which part yt-dlp is on: video and audio download one after the other.
function progressText({ percent, stage }, mode) {
  if (percent >= 100) return "Finishing…";
  const part = mode === "audio" ? "" : stage ? " audio" : " video";
  return `Downloading${part} · ${Math.floor(percent)}%`;
}

async function download(link, mode, kind, onProgress, signal) {
  const { torboxKey, useYtdlp, quality } = await getSettings();
  if (kind === "torbox") return torboxDownload(torboxKey, link, signal);
  // Public cobalt instances fail on YouTube too often, so when the local yt-dlp helper is
  // installed (see native/) YouTube goes only there. The cobalt website stays on offer.
  const ytdlp = useYtdlp && isYouTube(link);
  if (ytdlp) {
    const viaYtdlp = await ytdlpDownload(link, mode, quality, onProgress, signal);
    if (viaYtdlp.ok || viaYtdlp.cancelled) return viaYtdlp;
    if (!viaYtdlp.missing) {
      return {
        ok: false,
        errors: [`yt-dlp: ${viaYtdlp.error}`],
        frontend: await websiteFallback(),
        message: `yt-dlp couldn't download this: ${viaYtdlp.error}`,
      };
    }
  }
  const result = await cobaltDownload(link, mode, signal);
  if (result.cancelled) return result;
  if (!result.ok && ytdlp) {
    result.message = "cobalt couldn't download this. Set up the yt-dlp helper for reliable YouTube downloads.";
  }
  // TorBox has no audio-only mode, so it is only a fallback for full downloads. For
  // YouTube it returns low-resolution AV1 WebM files, so the cobalt website (H.264 MP4)
  // is the better fallback there.
  if (result.ok || !torboxKey || mode === "audio" || isYouTube(link)) return result;
  const viaTorbox = await torboxDownload(torboxKey, link, signal);
  if (viaTorbox.cancelled) return viaTorbox;
  return viaTorbox.ok ? viaTorbox : { ...result, errors: [...result.errors, `TorBox: ${viaTorbox.error}`] };
}

// Runs the download through the native yt-dlp helper and resolves when it finishes,
// reporting progress ({ percent, stage }) along the way. Aborting the signal asks the
// helper to stop yt-dlp and delete the partial files.
function ytdlpDownload(link, mode, quality, onProgress, signal) {
  return new Promise((resolve) => {
    const port = chrome.runtime.connectNative(YTDLP_HOST);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
      port.disconnect();
    };
    port.onMessage.addListener((msg) => {
      if (msg.type === "progress") {
        onProgress?.(progressText(msg, mode), msg.percent);
      } else if (msg.type === "done") {
        finish({ ok: true, host: "yt-dlp", saved: true, existing: msg.existing, file: msg.file });
      } else if (msg.type === "cancelled") {
        finish(CANCELLED);
      } else if (msg.type === "error") {
        finish({ ok: false, error: msg.error });
      }
    });
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message ?? "the helper stopped";
      finish({ ok: false, error, missing: /not found|forbidden/i.test(error) });
    });
    signal?.addEventListener("abort", () => {
      port.postMessage({ type: "cancel" });
      setTimeout(() => finish(CANCELLED), 3000); // in case the helper doesn't answer
    });
    port.postMessage({ type: "download", url: link, mode, quality });
  });
}

function ytdlpStatus() {
  return chrome.runtime
    .sendNativeMessage(YTDLP_HOST, { type: "ping" })
    .then((res) => (res.ytdlp ? "ready" : "no-ytdlp"))
    .catch(() => "no-helper");
}

async function torboxDownload(key, link, signal) {
  try {
    const job = await torbox.add(key, link);
    const ready = await torbox.check(key, job);
    if (signal?.aborted) return CANCELLED;
    if (ready) {
      const downloadIds = [];
      for (const file of ready.files) downloadIds.push(await save(file.url, file.filename));
      return { ok: true, host: "TorBox", downloadIds };
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
        notify("TorBox download ready", ready.name);
      } else if (Date.now() - job.addedAt < TORBOX_JOB_TIMEOUT) {
        pending.push(job);
      } else {
        notify("TorBox download timed out", job.link);
      }
    } catch (e) {
      // Network hiccups are retried on the next tick; API errors end the job.
      if (["TypeError", "TimeoutError", "AbortError"].includes(e.name)) pending.push(job);
      else notify("TorBox couldn't download this", `${e.message}\n${job.link}`);
    }
  }
  const { torboxJobs: now = [] } = await chrome.storage.local.get("torboxJobs");
  const added = now.filter((j) => !jobs.some((o) => o.kind === j.kind && o.id === j.id));
  await chrome.storage.local.set({ torboxJobs: [...pending, ...added] });
  if (!pending.length && !added.length) chrome.alarms.clear("torbox");
});

// When an instance can't fetch a video it may still answer with a tunnel that streams
// 0 bytes. The headers already say so (Content-Length 0, Estimated-Content-Length -1),
// so peek at them and abort before downloading. Tunnels can be requested again.
async function tunnelHasData(url) {
  const ctrl = new AbortController();
  try {
    const res = await fetch(url, { signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(20000)]) });
    const estimate = res.headers.get("estimated-content-length");
    return res.ok && res.headers.get("content-length") !== "0" && !(estimate && Number(estimate) <= 0);
  } catch {
    return false;
  } finally {
    ctrl.abort();
  }
}

async function cobaltDownload(link, mode, signal) {
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
    if (signal?.aborted) return CANCELLED;
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
        if (data.status === "tunnel" && !(await tunnelHasData(data.url))) {
          errors.push(`${host}: empty file`);
          continue;
        }
        if (signal?.aborted) return CANCELLED;
        return { ok: true, host, downloadIds: [await save(data.url, data.filename)] };
      }
      if (data.status === "picker") {
        if (signal?.aborted) return CANCELLED;
        const downloadIds = [];
        if (mode === "audio" && data.audio) downloadIds.push(await save(data.audio, data.audioFilename));
        else for (const item of data.picker) downloadIds.push(await save(item.url));
        return { ok: true, host, downloadIds };
      }
      errors.push(`${host}: ${data.error?.code ?? data.status}`);
    } catch (e) {
      errors.push(`${host}: ${e.message}`);
    }
  }
  return { ok: false, errors, frontend: await websiteFallback() };
}

// The best-scoring Turnstile instance's website, which can download in the browser.
async function websiteFallback() {
  const list = await getInstances();
  return list.find((i) => i.turnstile && i.frontend)?.frontend ?? FALLBACK_FRONTEND;
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
    const tabId = sender.tab?.id;
    const onProgress = (text) =>
      chrome.tabs.sendMessage(tabId, { type: "progress", link: msg.link, text }).catch(() => {});
    download(msg.link, msg.mode, msg.kind, tabId && onProgress).then(respond);
    return true;
  } else if (msg.type === "openFrontend") {
    openFrontend(msg.link, msg.frontend);
  } else if (msg.type === "instances") {
    getInstances(msg.force).then(respond);
    return true;
  } else if (msg.type === "cancelJob") {
    jobs.get(sender.tab?.id)?.abort();
  } else if (msg.type === "ytdlpStatus") {
    ytdlpStatus().then(respond);
    return true;
  }
});

// The toolbar button downloads the current page right away and shows a compact status
// toast in the tab. Clicking it again (or the toast's ×) cancels the download.
const jobs = new Map(); // tabId -> AbortController

chrome.action.onClicked.addListener(async (tab) => {
  const running = jobs.get(tab.id);
  if (running) return running.abort();
  if (!/^https?:|^magnet:/.test(tab.url ?? "")) return;

  const controller = new AbortController();
  jobs.set(tab.id, controller);
  const link = tab.url;
  const show = (state, text, extra = {}) => {
    chrome.action.setBadgeText({ tabId: tab.id, text: state === "working" ? "…" : "" });
    return report(tab.id, { type: "job", link, state, text, ...extra });
  };
  try {
    await show("working", "Starting…");
    const found = await classify(link);
    const result = await download(
      link, "auto", found?.kind ?? "video",
      (text, percent) => show("working", text, { percent }),
      controller.signal,
    );
    if (result.cancelled) return show("cancelled", "Download cancelled");
    if (result.queued) return show("done", "Added to TorBox. It will download when ready.");
    if (!result.ok) {
      const text = result.message ?? result.error ?? "No working instance could download this link.";
      if (!(await show("error", text, { frontend: result.frontend }))) notify("Couldn't download this", text);
      return;
    }
    const outcome = result.downloadIds
      ? await followDownloads(result.downloadIds, controller.signal, (text, percent) => show("working", text, { percent }))
      : "done";
    if (outcome === "cancelled") return show("cancelled", "Download cancelled");
    if (outcome !== "done") return show("error", `Download failed: ${outcome}`);
    const done = result.existing ? "Already in your Downloads folder" : "Saved to Downloads";
    if (!(await show("done", done))) notify(done, result.file?.split("/").pop() ?? link);
  } finally {
    jobs.delete(tab.id);
  }
});

const formatBytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

// Follows browser downloads to the end, reporting progress. Returns "done",
// "cancelled" or the browser's error.
async function followDownloads(ids, signal, onProgress) {
  while (true) {
    const items = (await Promise.all(ids.map((id) => chrome.downloads.search({ id })))).flat();
    if (signal.aborted) {
      await Promise.all(items.filter((d) => d.state === "in_progress").map((d) => chrome.downloads.cancel(d.id)));
      return "cancelled";
    }
    const failed = items.find((d) => d.state === "interrupted");
    if (failed) return failed.error ?? "interrupted";
    if (items.every((d) => d.state === "complete")) return "done";
    const received = items.reduce((sum, d) => sum + d.bytesReceived, 0);
    const total = items.every((d) => d.totalBytes > 0) ? items.reduce((sum, d) => sum + d.totalBytes, 0) : 0;
    const percent = total ? Math.floor((received / total) * 100) : undefined;
    onProgress(total ? `Downloading · ${percent}%` : `Downloading · ${formatBytes(received)}`, percent);
    await new Promise((r) => setTimeout(r, 700));
  }
}

// Sends a status update to the tab's toast, injecting the content script into tabs
// opened before install. Returns false where no toast can be shown (e.g. new tab page).
async function report(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
    return true;
  } catch {}
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tabId, msg);
    return true;
  } catch {
    return false;
  }
}

// The offscreen document polls the clipboard; it only exists while watching is on.
async function syncOffscreen() {
  const { watchClipboard } = await getSettings();
  const open = await chrome.offscreen.hasDocument();
  try {
    if (watchClipboard && !open) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["CLIPBOARD"],
        justification: "Detect copied video links",
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
