chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "WT_WHOAMI") {
    sendResponse({ tabId: sender.tab ? sender.tab.id : null });
  }
  return false;
});
