// Background service worker for Flow Chat

// Set initial badge
chrome.action.setBadgeText({ text: "OFF" });
chrome.action.setBadgeBackgroundColor({ color: "#717171" });

// Listen for messages from content script to update badge
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "update_badge") {
    chrome.action.setBadgeText({ text: request.state ? "ON" : "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: request.state ? "#3ea6ff" : "#717171" });
  }
});

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: "action_button_clicked" }).catch(() => {});
});
