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
  radiantStroke: false,
  strokeSize: 1
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

// Listen for settings changes from other tabs (like YouTube)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.flowChatSettings) {
    settings = { ...settings, ...changes.flowChatSettings.newValue };
    isEnabled = settings.enabled;
    updateOverlayMargins(); // Update margins and stroke size immediately
    
    if (overlayContainer) {
      overlayContainer.style.display = isEnabled ? "block" : "none";
      overlayContainer.style.setProperty('--fc-opacity', settings.opacity / 100);
    }
    
    if (isEnabled) {
      startObserving();
    } else if (chatObserver) {
      chatObserver.disconnect();
      chatObserver = null;
    }
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

let marginEditingTimeout;
const updateOverlayMargins = () => {
  if (!overlayContainer) return;
  overlayContainer.style.top = settings.marginTop + '%';
  overlayContainer.style.bottom = settings.marginBottom + '%';
  overlayContainer.style.left = settings.marginLeft + '%';
  overlayContainer.style.right = settings.marginRight + '%';
  overlayContainer.style.setProperty('--fc-stroke', settings.strokeSize + 'px');
  overlayContainer.style.width = 'auto';
  overlayContainer.style.height = 'auto';
  
  // Show visual guide line when editing margins
  overlayContainer.classList.add('fc-margin-editing');
  clearTimeout(marginEditingTimeout);
  marginEditingTimeout = setTimeout(() => {
    if (overlayContainer) overlayContainer.classList.remove('fc-margin-editing');
  }, 1000);
};

const setupOverlay = () => {
  // Ưu tiên .dplayer-video-wrap vì trên trang có custom-subtitle-container nằm trong này và hiển thị tốt lúc fullscreen
  const videoPlayer = document.querySelector('.dplayer-video-wrap') || document.querySelector('.dplayer') || document.querySelector('.video-wrapper') || document.querySelector('.box-livestream-video') || document.querySelector('video')?.parentElement;
  
  if (videoPlayer && !document.getElementById('flow-chat-overlay')) {
    console.log("Flow Chat: Found video player, injecting overlay into", videoPlayer.className);
    overlayContainer = document.createElement('div');
    overlayContainer.id = 'flow-chat-overlay';
    overlayContainer.className = 'flow-chat-overlay';

    overlayContainer.style.display = settings.enabled ? "block" : "none";
    overlayContainer.style.setProperty('--fc-opacity', settings.opacity / 100);
    updateOverlayMargins();

    videoPlayer.style.setProperty('position', 'relative', 'important'); // Đảm bảo container giữ relative
    // Đặt z-index cực cao để chắc chắn đè lên mọi UI của DPlayer trong fullscreen
    overlayContainer.style.setProperty('z-index', '2147483647', 'important');
    overlayContainer.style.setProperty('position', 'absolute', 'important');
    overlayContainer.style.setProperty('top', '0', 'important');
    overlayContainer.style.setProperty('left', '0', 'important');
    overlayContainer.style.setProperty('width', '100%', 'important');
    overlayContainer.style.setProperty('height', '100%', 'important');
    overlayContainer.style.setProperty('pointer-events', 'none', 'important');
    
    videoPlayer.appendChild(overlayContainer);
  } else if (videoPlayer && overlayContainer && overlayContainer.parentElement !== videoPlayer) {
    videoPlayer.appendChild(overlayContainer);
    updateOverlayMargins();
  } else if (videoPlayer) {
    overlayContainer = document.getElementById('flow-chat-overlay');
    updateOverlayMargins();
  }
  
  if (videoPlayer) {
    injectSettingsUI(videoPlayer);
  }
};

const injectSettingsUI = (videoPlayer) => {
  if (document.querySelector('.flow-chat-gv-ui')) return;

  const uiContainer = document.createElement('div');
  uiContainer.className = 'flow-chat-gv-ui';
  uiContainer.style.position = 'absolute';
  uiContainer.style.bottom = '60px';
  uiContainer.style.right = '20px';
  uiContainer.style.zIndex = '2147483647'; // ensure it's on top

  const btn = document.createElement('button');
  btn.className = 'flow-chat-gv-btn';
  btn.setAttribute('aria-label', 'Flow Chat Settings');
  btn.setAttribute('title', 'Flow Chat Settings');
  btn.style.background = 'rgba(0, 0, 0, 0.6)';
  btn.style.border = '1px solid rgba(255,255,255,0.2)';
  btn.style.borderRadius = '50%';
  btn.style.width = '40px';
  btn.style.height = '40px';
  btn.style.cursor = 'pointer';
  btn.style.display = 'flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';
  btn.style.opacity = '0.7';
  btn.style.transition = 'opacity 0.2s';
  btn.onmouseenter = () => btn.style.opacity = '1';
  btn.onmouseleave = () => btn.style.opacity = '0.7';
  
  btn.innerHTML = `<svg height="24" version="1.1" viewBox="0 0 36 36" width="24">
    <path style="fill: #fff" d="M11 11 C9.9 11 9 11.9 9 13 L9 23 C9 24.1 9.9 25 11 25 L15 25 L18 28 L21 25 L25 25 C26.1 25 27 24.1 27 23 L27 13 C27 11.9 26.1 11 25 11 L11 11 Z"></path>
  </svg>`;

  const panel = document.createElement('div');
  panel.className = 'flow-chat-settings-panel';
  panel.style.bottom = '50px';
  panel.style.right = '0';
  panel.style.maxHeight = '400px';
  panel.style.overflowY = 'auto';
  
  panel.innerHTML = `
      <div class="flow-chat-setting-item">
        <div class="flow-chat-setting-header">
          <span>Flow Chat</span>
          <label class="flow-chat-switch">
            <input type="checkbox" id="fc-toggle" ${settings.enabled ? 'checked' : ''}>
            <span class="flow-chat-slider"></span>
          </label>
        </div>
      </div>
      <div class="flow-chat-setting-item">
        <div class="flow-chat-setting-header">
          <span>Radiant Stroke</span>
          <label class="flow-chat-switch">
            <input type="checkbox" id="fc-radiant-toggle" ${settings.radiantStroke ? 'checked' : ''}>
            <span class="flow-chat-slider"></span>
          </label>
        </div>
      </div>
      <div class="flow-chat-setting-item">
        <div class="flow-chat-setting-header">
          <span>Stroke Size (<span id="fc-stroke-val">${settings.strokeSize}</span>px)</span>
        </div>
        <input type="range" id="fc-stroke" min="0.1" max="3" step="0.1" value="${settings.strokeSize}">
      </div>
      <div class="flow-chat-setting-item">
        <div class="flow-chat-setting-header">
          <span>Opacity (<span id="fc-opacity-val">${settings.opacity}</span>%)</span>
        </div>
        <input type="range" id="fc-opacity" min="10" max="100" step="0.1" value="${settings.opacity}">
      </div>
      <div class="flow-chat-setting-item">
        <div class="flow-chat-setting-header">
          <span>Speed (<span id="fc-speed-val">${settings.speed}</span>s)</span>
        </div>
        <input type="range" id="fc-speed" min="1" max="20" step="0.1" value="${settings.speed}">
      </div>
      <div class="flow-chat-setting-item">
        <div class="flow-chat-setting-header">
          <span>Font Size (<span id="fc-font-val">${settings.fontSize}</span>px)</span>
        </div>
        <input type="range" id="fc-font" min="14" max="48" step="0.1" value="${settings.fontSize}">
      </div>
      <div class="flow-chat-setting-item">
        <div class="flow-chat-setting-header">
          <span>Margin Top (<span id="fc-mt-val">${settings.marginTop}</span>%)</span>
        </div>
        <input type="range" id="fc-mt" min="0" max="95" step="0.1" value="${settings.marginTop}">
      </div>
      <div class="flow-chat-setting-item">
        <div class="flow-chat-setting-header">
          <span>Margin Bottom (<span id="fc-mb-val">${settings.marginBottom}</span>%)</span>
        </div>
        <input type="range" id="fc-mb" min="0" max="95" step="0.1" value="${settings.marginBottom}">
      </div>
      <div class="flow-chat-setting-item">
        <div class="flow-chat-setting-header">
          <span>Margin Left (<span id="fc-ml-val">${settings.marginLeft}</span>%)</span>
        </div>
        <input type="range" id="fc-ml" min="0" max="95" step="0.1" value="${settings.marginLeft}">
      </div>
      <div class="flow-chat-setting-item">
        <div class="flow-chat-setting-header">
          <span>Margin Right (<span id="fc-mr-val">${settings.marginRight}</span>%)</span>
        </div>
        <input type="range" id="fc-mr" min="0" max="95" step="0.1" value="${settings.marginRight}">
      </div>
  `;

  uiContainer.appendChild(btn);
  uiContainer.appendChild(panel);
  videoPlayer.appendChild(uiContainer);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('active');
  });

  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && !btn.contains(e.target)) {
      panel.classList.remove('active');
    }
  });

  ['keydown', 'keyup', 'keypress'].forEach(eventType => {
    panel.addEventListener(eventType, (e) => {
      e.stopPropagation();
    });
  });

  const saveSettings = () => {
    chrome.storage.local.set({ flowChatSettings: settings });
  };

  document.getElementById('fc-toggle').addEventListener('change', (e) => {
    settings.enabled = e.target.checked;
    isEnabled = settings.enabled;
    saveSettings();
    if (overlayContainer) overlayContainer.style.display = isEnabled ? "block" : "none";
    if (isEnabled) {
      startObserving();
    } else if (chatObserver) {
      chatObserver.disconnect();
      chatObserver = null;
    }
  });

  document.getElementById('fc-radiant-toggle').addEventListener('change', (e) => {
    settings.radiantStroke = e.target.checked;
    saveSettings();
  });

  ['stroke', 'opacity', 'speed', 'font', 'mt', 'mb', 'ml', 'mr'].forEach(id => {
    document.getElementById('fc-' + id).addEventListener('input', (e) => {
      const val = e.target.value;
      document.getElementById('fc-' + id + '-val').innerText = val;
      
      if (id === 'stroke') settings.strokeSize = val;
      if (id === 'opacity') { settings.opacity = val; if(overlayContainer) overlayContainer.style.setProperty('--fc-opacity', val / 100); }
      if (id === 'speed') settings.speed = val;
      if (id === 'font') settings.fontSize = val;
      if (id === 'mt') settings.marginTop = val;
      if (id === 'mb') settings.marginBottom = val;
      if (id === 'ml') settings.marginLeft = val;
      if (id === 'mr') settings.marginRight = val;
      
      saveSettings();
      if (['stroke', 'mt', 'mb', 'ml', 'mr'].includes(id)) {
        updateOverlayMargins();
      }
    });
  });
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

  // Randomize vertical position dynamically based on font size to prevent cutoff
  let maxTop = 95; // Default safe fallback
  if (overlayContainer && overlayContainer.clientHeight > 0) {
    // Estimated height of a message is roughly fontSize * 1.3
    const msgHeightPx = settings.fontSize * 1.3; 
    const msgHeightPercent = (msgHeightPx / overlayContainer.clientHeight) * 100;
    maxTop = 100 - msgHeightPercent;
    if (maxTop < 0) maxTop = 0;
  }
  const topPercent = Math.random() * maxTop;
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

// Liên tục kiểm tra xem trang web có xóa mất overlay của chúng ta khi chuyển sang fullscreen không
// (Nhiều trang web có thói quen xóa hoặc render lại toàn bộ player khi ấn fullscreen)
setInterval(() => {
  if (isEnabled) {
    const videoPlayer = document.querySelector('.dplayer-video-wrap') || document.querySelector('.dplayer') || document.querySelector('.video-wrapper') || document.querySelector('.box-livestream-video') || document.querySelector('video')?.parentElement;
    const overlay = document.getElementById('flow-chat-overlay');
    
    if (!overlay || !document.body.contains(overlay)) {
      if (videoPlayer) setupOverlay();
    } else if (videoPlayer && overlay.parentElement !== videoPlayer) {
      setupOverlay();
    }
  }
}, 1000);
