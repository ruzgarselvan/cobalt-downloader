export const DEFAULTS = {
  watchClipboard: true,
  quality: "1080",
  customApi: "",
  apiKey: "",
  torboxKey: "",
};

export const getSettings = () => chrome.storage.sync.get(DEFAULTS);
