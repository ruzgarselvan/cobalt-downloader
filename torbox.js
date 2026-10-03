// TorBox (torbox.app) API: torrents for magnet links, web downloads for file hosters
// and for video links cobalt couldn't handle.
const API = "https://api.torbox.app/v1/api";

// Hosters TorBox lists that are general-purpose sites; matching them would pop the
// toast for every ordinary link copied from them.
const NOISY_HOSTERS = new Set([
  "GitHub", "BlueSky", "Imgur", "Scribd", "4Chan", "NexusMods", "Castbox", "Archive.org",
  "Hentai Foundry", "NHentai", "Rule34", "Kemono", "Coomer",
]);
const HOSTERS_TTL = 24 * 60 * 60 * 1000;

const KINDS = {
  torrent: {
    create: "/torrents/createtorrent", field: "magnet", idKey: "torrent_id",
    list: "/torrents/mylist", request: "/torrents/requestdl", idParam: "torrent_id",
  },
  webdl: {
    create: "/webdl/createwebdownload", field: "link", idKey: "webdownload_id",
    list: "/webdl/mylist", request: "/webdl/requestdl", idParam: "web_id",
  },
};

async function call(key, path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
  return data.data;
}

export const isMagnet = (text) => /^magnet:\?xt=urn:bt[im]h:/i.test(text);

export async function getHosterPatterns() {
  const { torboxHosters, torboxHostersAt = 0 } = await chrome.storage.local.get(["torboxHosters", "torboxHostersAt"]);
  if (torboxHosters && Date.now() - torboxHostersAt < HOSTERS_TTL) return torboxHosters;
  try {
    const res = await fetch(`${API}/webdl/hosters`, { signal: AbortSignal.timeout(15000) });
    const list = (await res.json()).data
      .filter((h) => h.type === "hoster" && h.status && !NOISY_HOSTERS.has(h.name))
      .map((h) => h.regex);
    await chrome.storage.local.set({ torboxHosters: list, torboxHostersAt: Date.now() });
    return list;
  } catch {
    return torboxHosters ?? [];
  }
}

export async function add(key, link) {
  const kind = isMagnet(link) ? "torrent" : "webdl";
  const { create, field, idKey } = KINDS[kind];
  const form = new FormData();
  form.append(field, link);
  const data = await call(key, create, { method: "POST", body: form });
  return { kind, id: data[idKey] };
}

// Returns { name, files } once TorBox has the content, or null while it is still fetching.
export async function check(key, job) {
  const { list, request, idParam } = KINDS[job.kind];
  const item = await call(key, `${list}?id=${job.id}&bypass_cache=true`);
  if (/error|failed/i.test(item.download_state)) throw new Error(item.download_state);
  if (!item.download_finished || !item.download_present) return null;
  const folder = item.files.length > 1 ? `${item.name}/` : "";
  const files = await Promise.all(
    item.files.map(async (f) => ({
      url: await call(key, `${request}?token=${key}&${idParam}=${job.id}&file_id=${f.id}`),
      filename: folder + f.short_name,
    })),
  );
  return { name: item.name, files };
}
