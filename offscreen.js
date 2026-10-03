// Reads the clipboard once a second and reports only changes. The text never
// leaves the browser unless the user chooses to download a detected link.
const box = document.querySelector("textarea");
let last = null;

function readClipboard() {
  box.value = "";
  box.focus();
  document.execCommand("paste");
  return box.value;
}

setInterval(() => {
  const text = readClipboard();
  if (last !== null && text && text !== last && text.length <= 8192) {
    chrome.runtime.sendMessage({ type: "clipboard", text });
  }
  last = text;
}, 1000);
