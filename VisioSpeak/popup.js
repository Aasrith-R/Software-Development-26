function openPanel(autostart) {
  const url = chrome.runtime.getURL("panel.html") + (autostart ? "?autostart=1" : "");
  chrome.tabs.create({ url });
  window.close();
}

document.getElementById("open").addEventListener("click", () => openPanel(false));
document.getElementById("openStart").addEventListener("click", () => openPanel(true));
