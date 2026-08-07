// Background service worker for Flow Chat
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: "action_button_clicked" }).catch(() => {});
});
