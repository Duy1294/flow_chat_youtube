// giovang.js
console.log("Flow Chat loaded on:", window.location.pathname);

let isEnabled = false;
let overlayContainer = null;
let chatObserver = null;

let settings = {
  enabled: false,
  opacity: 100,
  speed: 10,
  fontSize: 24,
  marginTop: 0,
  marginBottom: 0,
  marginLeft: 0,
  marginRight: 0,
  radiantStroke: false
};

// Load settings from storage
chrome.storage.local.get(['flowChatSettings'], (result) => {
  if (result.flowChatSettings) {
    settings = { ...settings, ...result.flowChatSettings };
  }
  isEnabled = settings.enabled;
  
  if (isEnabled) {
      startObserving();
  }
});

// Listen for toggle commands from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "action_button_clicked") {
    settings.enabled = !settings.enabled;
    isEnabled = settings.enabled;

    chrome.storage.local.set({ flowChatSettings: settings });

    if (overlayContainer) {
      overlayContainer.style.display = isEnabled ? "block" : "none";
    } else if (isEnabled) {
      setupOverlay();
    }

    chrome.runtime.sendMessage({ action: "update_badge", state: isEnabled }).catch(() => { });
    
    // Toggle observer
    if (isEnabled) {
      startObserving();
    } else {
      if (chatObserver) {
        chatObserver.disconnect();
        chatObserver = null;
      }
    }
  }
});

const updateOverlayMargins = () => {
  if (!overlayContainer) return;
  overlayContainer.style.top = settings.marginTop + '%';
  overlayContainer.style.bottom = settings.marginBottom + '%';
  overlayContainer.style.left = settings.marginLeft + '%';
  overlayContainer.style.right = settings.marginRight + '%';
  overlayContainer.style.width = 'auto';
  overlayContainer.style.height = 'auto';
};

const setupOverlay = () => {
  // Tìm khung chứa video trên giovang.city
  const videoPlayer = document.querySelector('.dplayer-video-wrap') || document.querySelector('.video-wrapper') || document.querySelector('.box-livestream-video') || document.querySelector('video')?.parentElement;
  
  if (videoPlayer && !document.getElementById('flow-chat-overlay')) {
    console.log("Flow Chat: Found video player, injecting overlay");
    overlayContainer = document.createElement('div');
    overlayContainer.id = 'flow-chat-overlay';
    overlayContainer.className = 'flow-chat-overlay';

    overlayContainer.style.display = settings.enabled ? "block" : "none";
    overlayContainer.style.setProperty('--fc-opacity', settings.opacity / 100);
    updateOverlayMargins();

    videoPlayer.style.position = 'relative'; // Đảm bảo relative để overlay hiển thị đúng
    // Đặt z-index để chắc chắn đè lên trên video player (đặc biệt là DPlayer)
    overlayContainer.style.zIndex = '9999';
    videoPlayer.appendChild(overlayContainer);
  } else if (videoPlayer) {
    overlayContainer = document.getElementById('flow-chat-overlay');
    updateOverlayMargins();
  }
};

const createDanmaku = (html) => {
  // Đảm bảo overlayContainer luôn hợp lệ
  if (!overlayContainer || !document.body.contains(overlayContainer)) {
      setupOverlay();
  }
  if (document.hidden || !overlayContainer) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = 'flow-chat-message';
  if (settings.radiantStroke) {
    msgDiv.classList.add('radiant-stroke');
  }
  
  // Basic sanitization or direct insertion. Assuming the chat DOM is safe or we just want text.
  msgDiv.innerHTML = html; 

  msgDiv.style.fontSize = `${settings.fontSize}px`;

  // Dùng % đơn giản để đảm bảo tương thích 100% với mọi trình duyệt
  const topPercent = Math.random() * 90;
  msgDiv.style.top = `${topPercent}%`;

  overlayContainer.appendChild(msgDiv);

  const baseDuration = parseFloat(settings.speed);
  const duration = baseDuration + Math.random() * 2;
  const durationMs = duration * 1000;

  const animation = msgDiv.animate([
    { transform: 'translateX(100cqw)' },
    { transform: 'translateX(-100%)' }
  ], {
    duration: durationMs,
    easing: 'linear',
    fill: 'forwards'
  });

  animation.onfinish = () => {
    msgDiv.remove();
  };
};

function startObserving() {
  if (chatObserver) return;

  setupOverlay();

  console.log("Flow Chat: Starting chat observer for giovang.city");

  const chatContainer = document.body; // Luôn theo dõi body để tránh mất kết nối khi trang web tải lại DOM một phần

  chatObserver = new MutationObserver((mutations) => {
    if (!isEnabled) return;
    
    // Kiểm tra xem overlay còn tồn tại trên màn hình không (trường hợp trang web SPA thay đổi video)
    if (overlayContainer && !document.body.contains(overlayContainer)) {
        overlayContainer = null;
        setupOverlay();
    }
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;

          let contentNodes = [];
          
          // Trực tiếp gom tất cả các thẻ chứa nội dung chat
          if (node.matches && node.matches('.item-content')) {
             contentNodes.push(node);
          }
          if (node.querySelectorAll) {
             const found = node.querySelectorAll('.item-content');
             if (found.length) {
                 contentNodes.push(...found);
             }
          }

          contentNodes.forEach((contentNode) => {
             const text = contentNode.innerHTML || contentNode.textContent;
             if (text && text.trim().length > 0) {
                 createDanmaku(text);
             }
          });
        });
      }
    }
  });

  chatObserver.observe(chatContainer, { childList: true, subtree: true });
}

// Handle visibility change so danmaku pauses when the user switches tabs.
document.addEventListener('visibilitychange', () => {
  if (overlayContainer) {
    const messages = overlayContainer.querySelectorAll('.flow-chat-message');
    messages.forEach(msg => {
      const anims = msg.getAnimations();
      anims.forEach(a => {
        if (document.hidden) {
          a.pause();
        } else {
          a.play();
        }
      });
    });
  }
});
