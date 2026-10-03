export const DEFAULTS = {
  watchClipboard: true,
  quality: "1080",
  customApi: "",
  apiKey: "",
  torboxKey: "",
  useYtdlp: true,
};

export const getSettings = () => chrome.storage.sync.get(DEFAULTS);
