// content.js
let isEnabled = true;

const updateButtonState = (state) => {
  if (window.location.pathname.startsWith('/live_chat')) return;

  const btn = document.querySelector('.flow-chat-ytp-btn');
  const toggleSwitch = document.querySelector('#fc-toggle')?.closest('.flow-chat-switch');

  if (btn) {
    btn.classList.remove('fc-connecting', 'fc-connected');
    if (state === 'connecting') btn.classList.add('fc-connecting');
    if (state === 'connected') btn.classList.add('fc-connected');
  }

  if (toggleSwitch) {
    toggleSwitch.classList.remove('fc-connecting', 'fc-connected');
    if (state === 'connecting') toggleSwitch.classList.add('fc-connecting');
    if (state === 'connected') toggleSwitch.classList.add('fc-connected');
  }
};

// Listen for toggle commands from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "action_button_clicked") {
    // If settings UI isn't injected yet, we can't toggle correctly based on it,
    // but settings variable holds the state.
    if (typeof settings !== 'undefined') {
      settings.enabled = !settings.enabled;
      isEnabled = settings.enabled;

      // Update local storage
      chrome.storage.local.set({ flowChatSettings: settings });

      // Update overlay visibility
      const overlay = document.getElementById("flow-chat-overlay");
      if (overlay) {
        overlay.style.display = isEnabled ? "block" : "none";
      }

      if (isEnabled) {
        updateButtonState('connecting');
      } else {
        updateButtonState('none');
      }

      // Update UI toggle if it exists
      const fcToggle = document.getElementById('fc-toggle');
      if (fcToggle) {
        fcToggle.checked = settings.enabled;
      }
    }
  }
});

// Determine if we are in the chat iframe or main page
console.log("Flow Chat loaded on:", window.location.pathname);

if (window.location.pathname.startsWith('/live_chat')) {
  console.log("Flow Chat: Initializing inside Chat iframe");

  // --- CHAT IFRAME LOGIC ---

  // Listen for messages to send chat from main page
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SEND_CHAT_MESSAGE') {
      const message = event.data.message;
      const inputField = document.querySelector('#input.yt-live-chat-text-input-field-renderer');
      const sendButton = document.querySelector('#send-button button');

      if (inputField && sendButton) {
        // Focus the input field
        inputField.focus();

        // Method 1: execCommand (Works best but fails if iframe is not visually focused by browser)
        document.execCommand('insertText', false, message);

        // Method 2: Fallback if execCommand failed
        if (inputField.textContent.trim() !== message.trim()) {
          inputField.textContent = message;
          // Dispatch a rich set of events to wake up YouTube's Polymer framework
          inputField.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: message }));
          inputField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
          inputField.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
        }

        // Short delay for Polymer to register input and enable button
        setTimeout(() => {
          // Force remove disabled attribute if it's stubbornly disabled
          if (sendButton.hasAttribute('disabled')) sendButton.removeAttribute('disabled');
          if (sendButton.getAttribute('aria-disabled') === 'true') sendButton.setAttribute('aria-disabled', 'false');
          sendButton.click();

          // Reclaim focus from iframe back to parent page to avoid breaking keyboard shortcuts
          setTimeout(() => {
            inputField.blur();
            window.parent.postMessage({ type: 'CHAT_MESSAGE_SENT_RESTORE_FOCUS' }, '*');
          }, 50);
        }, 150);
      }
    }
  });

  const chatObserver = new MutationObserver((mutations) => {
    if (!isEnabled) return;
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;

          let messages = [];
          if (node.tagName && node.tagName.toLowerCase() === 'yt-live-chat-text-message-renderer') {
            messages.push(node);
          } else if (node.querySelectorAll) {
            const found = node.querySelectorAll('yt-live-chat-text-message-renderer');
            if (found.length) messages.push(...found);
          }

          messages.forEach((msgNode) => {
            const messageId = msgNode.getAttribute('id');
            const messageContent = msgNode.querySelector('#message');
            if (messageContent) {
              // Extract text and emojis
              const clonedContent = messageContent.cloneNode(true);
              let html = clonedContent.innerHTML;

              // Send to parent window
              window.parent.postMessage({
                type: 'FLOW_CHAT_MESSAGE',
                id: messageId,
                html: html
              }, '*');
            }
          });
        });
      }
    }
  });

  // Instead of observing document.body with subtree: true (which is very CPU intensive),
  // we find the specific chat container and observe only its direct children.
  // We use setInterval to re-attach the observer if YouTube replaces the container.
  let currentChatList = null;
  const findAndObserveChat = () => {
    const chatList = document.querySelector('yt-live-chat-item-list-renderer #items') || document.querySelector('yt-live-chat-item-list-renderer');
    if (chatList && chatList !== currentChatList) {
      chatObserver.disconnect();
      chatObserver.observe(chatList, { childList: true });
      currentChatList = chatList;
      window.parent.postMessage({ type: 'FLOW_CHAT_CONNECTED' }, '*');
    }
  };

  setInterval(findAndObserveChat, 2000);
  findAndObserveChat();

  // Prevent YouTube from pausing the chat stream (ngắt tin nhắn giữa chừng) 
  // by keeping it scrolled to the bottom and clicking the 'show more' button if it appears.
  setInterval(() => {
    const scroller = document.querySelector('#item-scroller');
    if (scroller && scroller.scrollHeight > scroller.clientHeight) {
      // If we are not at the bottom, force scroll to bottom to resume chat
      if (scroller.scrollHeight - scroller.scrollTop > scroller.clientHeight + 50) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    }

    // Sometimes YouTube shows a floating "More messages" button when chat pauses
    const showMoreBtn = document.querySelector('#show-more');
    if (showMoreBtn && showMoreBtn.style.display !== 'none' && !showMoreBtn.hasAttribute('hidden')) {
      showMoreBtn.click();
    }
  }, 2500);
} else {
  // --- MAIN PAGE LOGIC (Video Player) ---
  console.log("Flow Chat: Initializing on main page");
  let overlayContainer = null;
  let autoRateApplied = false;

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
    strokeSize: 1,
    zoneEnabled: false,
    zoneX: 0,
    zoneY: 0,
    zoneW: 20,
    zoneH: 20,
    filteredWords: "",
    antiOverlap: false,
    autoKeepUp: false,
    keepUpSpeed: 1.1
  };

  // Load settings from storage
  chrome.storage.local.get(['flowChatSettings'], (result) => {
    if (result.flowChatSettings) {
      settings = { ...settings, ...result.flowChatSettings };
    }
    // Always start disabled on a new page/video, ignoring saved state
    settings.enabled = false;
    isEnabled = false;
  });

  // Listen for YouTube SPA navigations
  document.addEventListener('yt-navigate-finish', () => {
    console.log("Flow Chat: Video changed via SPA, resetting state");

    // Always start disabled on a new video
    settings.enabled = false;
    isEnabled = false;

    // Reset auto keep-up rate on navigation
    if (autoRateApplied) {
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (video) video.playbackRate = 1.0;
      autoRateApplied = false;
    }

    // Destroy hidden iframe on navigation
    const hiddenIframe = document.getElementById('flow-chat-hidden-iframe');
    if (hiddenIframe) {
      hiddenIframe.remove();
    }

    // Update UI elements
    if (overlayContainer) {
      overlayContainer.style.display = "none";
      overlayContainer.innerHTML = ''; // Clear old danmaku
    }

    const fcToggle = document.getElementById('fc-toggle');
    if (fcToggle) {
      fcToggle.checked = false;
    }

    updateButtonState('none');

  });

  let safeZonePreview = null;
  const updateSafeZonePreview = (show) => {
    if (!safeZonePreview) {
      const videoPlayer = document.querySelector('.html5-video-player');
      if (!videoPlayer) return;
      safeZonePreview = document.createElement('div');
      safeZonePreview.className = 'flow-chat-safe-zone-preview';
      videoPlayer.appendChild(safeZonePreview);
    }

    if (show && settings.zoneEnabled) {
      safeZonePreview.style.display = 'block';
      safeZonePreview.style.left = settings.zoneX + '%';
      safeZonePreview.style.top = settings.zoneY + '%';
      safeZonePreview.style.width = settings.zoneW + '%';
      safeZonePreview.style.height = settings.zoneH + '%';

      clearTimeout(safeZonePreview.timeout);
      safeZonePreview.timeout = setTimeout(() => {
        safeZonePreview.style.display = 'none';
      }, 2000);
    } else {
      safeZonePreview.style.display = 'none';
    }
  };

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

    if (settings.zoneEnabled) {
      const zX = parseFloat(settings.zoneX);
      const zY = parseFloat(settings.zoneY);
      const zW = parseFloat(settings.zoneW);
      const zH = parseFloat(settings.zoneH);

      const mT = parseFloat(settings.marginTop) || 0;
      const mB = parseFloat(settings.marginBottom) || 0;
      const mL = parseFloat(settings.marginLeft) || 0;
      const mR = parseFloat(settings.marginRight) || 0;

      // Convert zone coordinates from screen percentages to overlayContainer percentages
      const contWidth = 100 - mL - mR;
      const contHeight = 100 - mT - mB;

      const cX = contWidth > 0 ? ((zX - mL) / contWidth) * 100 : 0;
      const cY = contHeight > 0 ? ((zY - mT) / contHeight) * 100 : 0;
      const cW = contWidth > 0 ? (zW / contWidth) * 100 : 0;
      const cH = contHeight > 0 ? (zH / contHeight) * 100 : 0;

      overlayContainer.style.clipPath = `polygon(
        0% 0%, 
        0% 100%, 
        ${cX}% 100%, 
        ${cX}% ${cY}%, 
        ${cX + cW}% ${cY}%, 
        ${cX + cW}% ${cY + cH}%, 
        ${cX}% ${cY + cH}%, 
        ${cX}% 100%, 
        100% 100%, 
        100% 0%
      )`;
    } else {
      overlayContainer.style.clipPath = 'none';
    }

    // Show visual guide line when editing margins
    overlayContainer.classList.add('fc-margin-editing');
    clearTimeout(marginEditingTimeout);
    marginEditingTimeout = setTimeout(() => {
      if (overlayContainer) overlayContainer.classList.remove('fc-margin-editing');
    }, 1000);
  };

  const setupOverlay = () => {
    const videoPlayer = document.querySelector('.html5-video-player');
    if (videoPlayer && !document.getElementById('flow-chat-overlay')) {
      console.log("Flow Chat: Found video player, injecting overlay");
      overlayContainer = document.createElement('div');
      overlayContainer.id = 'flow-chat-overlay';
      overlayContainer.className = 'flow-chat-overlay';

      // Initial state
      overlayContainer.style.display = settings.enabled ? "block" : "none";
      overlayContainer.style.setProperty('--fc-opacity', settings.opacity / 100);
      updateOverlayMargins();

      videoPlayer.appendChild(overlayContainer);
    } else if (videoPlayer) {
      overlayContainer = document.getElementById('flow-chat-overlay');
    }

    injectSettingsUI();
  };

  // --- AUTO KEEP-UP (LOW LATENCY) ENGINE ---
  const getLiveVideoElement = () => {
    const player = document.querySelector('.html5-video-player');
    const video = player?.querySelector('video') || document.querySelector('video.html5-main-video') || document.querySelector('video');
    const isYtLive = player?.classList.contains('ytp-live') || false;
    const liveBadge = document.querySelector('.ytp-live-badge');
    const isLive = isYtLive || !!liveBadge || (video && video.duration === Infinity);

    return { player, video, isLive, liveBadge };
  };

  const getBufferAhead = (video) => {
    if (!video || !video.buffered || video.buffered.length === 0) return 0;
    const current = video.currentTime;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= current && current <= video.buffered.end(i)) {
        return video.buffered.end(i) - current;
      }
    }
    return 0;
  };

  const syncToLiveEdge = () => {
    const { video, isLive, liveBadge } = getLiveVideoElement();
    if (!isLive || !video) return false;

    // 1. Try native YouTube live badge button click
    if (liveBadge && !liveBadge.disabled && liveBadge.getAttribute('aria-disabled') !== 'true') {
      liveBadge.click();
      if (autoRateApplied) {
        video.playbackRate = 1.0;
        autoRateApplied = false;
      }
      return true;
    }

    // 2. Fallback to seekable live edge
    if (video.seekable && video.seekable.length > 0) {
      const liveEdge = video.seekable.end(video.seekable.length - 1);
      const targetLatency = parseFloat(settings.targetLatency) || 1.3;
      video.currentTime = Math.max(0, liveEdge - targetLatency);
      if (autoRateApplied) {
        video.playbackRate = 1.0;
        autoRateApplied = false;
      }
      return true;
    }

    return false;
  };

  const updateKeepUpStatusUI = (status, text) => {
    const dot = document.getElementById('fc-keepup-dot');
    const textEl = document.getElementById('fc-keepup-status-text');
    if (!dot || !textEl) return;

    dot.className = 'fc-status-dot';
    if (status === 'synced') {
      dot.classList.add('synced');
    } else if (status === 'catching-up') {
      dot.classList.add('catching-up');
    } else {
      dot.classList.add('inactive');
    }

    textEl.textContent = text;
  };

  const tickAutoKeepUp = () => {
    const { video, isLive, liveBadge } = getLiveVideoElement();

    // 1. If feature is disabled, revert any speed boost and exit
    if (!settings.autoKeepUp) {
      if (autoRateApplied && video) {
        video.playbackRate = 1.0;
        autoRateApplied = false;
      }
      updateKeepUpStatusUI('inactive', 'Auto Keep-Up: Off');
      return;
    }

    // 2. If not a live stream, revert and exit
    if (!isLive || !video) {
      if (autoRateApplied && video) {
        video.playbackRate = 1.0;
        autoRateApplied = false;
      }
      updateKeepUpStatusUI('inactive', 'Not a live stream');
      return;
    }

    // 3. If paused, revert and exit
    if (video.paused) {
      if (autoRateApplied) {
        video.playbackRate = 1.0;
        autoRateApplied = false;
      }
      updateKeepUpStatusUI('inactive', 'Paused');
      return;
    }

    // 4. If seeking or currently buffering, don't change rate
    if (video.seeking || video.readyState < 3) {
      updateKeepUpStatusUI('inactive', 'Buffering...');
      return;
    }

    const bufferAhead = getBufferAhead(video);
    const catchUpSpeed = parseFloat(settings.keepUpSpeed) || 1.1;

    // Check if YouTube's native live badge indicates we fell behind
    // On YouTube: button is clickable (not disabled) when behind live, and disabled when at live edge
    const isYtBehind = liveBadge ? (!liveBadge.hasAttribute('disabled') && liveBadge.getAttribute('aria-disabled') !== 'true') : false;

    // Ensure audio pitch is preserved so voices sound completely natural
    if (video.preservesPitch === false) {
      video.preservesPitch = true;
    }

    // CONDITION TO SPEED UP:
    // Only speed up when YouTube says we are behind live AND we have buffer downloaded (> 1.2s).
    // Never speed up if bufferAhead < 1.0s, because that would drain the buffer and cause freezing!
    const shouldCatchUp = isYtBehind && bufferAhead > 1.2;

    if (shouldCatchUp) {
      if (video.playbackRate !== catchUpSpeed) {
        video.playbackRate = catchUpSpeed;
      }
      autoRateApplied = true;
      updateKeepUpStatusUI('catching-up', `Catching up (${catchUpSpeed}x)`);
    } else {
      // Caught up to live edge, or buffer is at safe minimal margin: return to normal 1.0x!
      if (video.playbackRate !== 1.0) {
        video.playbackRate = 1.0;
      }
      autoRateApplied = false;
      updateKeepUpStatusUI('synced', 'Synced (1.0x)');
    }
  };

  // Start background ticker for auto keep-up (every 800ms)
  let autoKeepUpInterval = setInterval(tickAutoKeepUp, 800);

  const injectSettingsUI = () => {
    if (document.querySelector('.flow-chat-ytp-btn')) return;

    const rightControls = document.querySelector('.ytp-right-controls');
    if (!rightControls) return;

    // Inject Button
    const btn = document.createElement('button');
    btn.className = 'ytp-button flow-chat-ytp-btn';
    btn.setAttribute('aria-label', 'Flow Chat Settings');
    btn.setAttribute('title', 'Flow Chat Settings');
    // Using YouTube's native SVG classes for correct sizing, shadows, and hover colors
    btn.innerHTML = `<svg height="100%" version="1.1" viewBox="0 0 36 36" width="100%">
      <use class="ytp-svg-shadow" href="#ytp-id-flow-chat"></use>
      <path style="transform-origin: 18px 18px; transform: scale(1.4);" class="ytp-svg-fill" id="ytp-id-flow-chat" d="M11 11 C9.9 11 9 11.9 9 13 L9 23 C9 24.1 9.9 25 11 25 L15 25 L18 28 L21 25 L25 25 C26.1 25 27 24.1 27 23 L27 13 C27 11.9 26.1 11 25 11 L11 11 Z"></path>
    </svg>`;

    // Inject Input Box
    const chatInput = document.createElement('input');
    chatInput.type = 'text';
    chatInput.className = 'flow-chat-quick-input';
    chatInput.placeholder = 'Chat...';

    // Stop key events from triggering YouTube player shortcuts (e.g., Space to pause, F to fullscreen)
    ['keydown', 'keyup', 'keypress'].forEach(eventType => {
      chatInput.addEventListener(eventType, (e) => {
        e.stopPropagation();
        if (eventType === 'keydown') {
          if (e.key === 'Enter') {
            e.preventDefault(); // Prevent default enter behavior on the input
            const message = chatInput.value.trim();
            if (message) {
              let iframe = document.querySelector('iframe#chatframe');
              if (!iframe || iframe.offsetWidth === 0) {
                iframe = document.getElementById('flow-chat-hidden-iframe');
              }
              if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage({ type: 'SEND_CHAT_MESSAGE', message: message }, '*');
              }
            }
            chatInput.value = '';
            chatInput.blur(); // Always close/unfocus when hitting Enter

            // Explicitly return focus to the video player so YouTube shortcuts (Space, F, etc) continue to work
            const videoPlayer = document.querySelector('.html5-video-player');
            if (videoPlayer) {
              videoPlayer.focus();
              videoPlayer.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
            }
          } else if (e.key === 'Escape') {
            chatInput.blur(); // Close/unfocus when hitting Escape
            const videoPlayer = document.querySelector('.html5-video-player');
            if (videoPlayer) {
              videoPlayer.focus();
              videoPlayer.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
            }
          }
        }
      });
    });
    // Focus states are now handled entirely by CSS :has() for robustness
    rightControls.insertBefore(btn, rightControls.firstChild);
    rightControls.insertBefore(chatInput, btn);

    // Inject Settings Panel
    const panel = document.createElement('div');
    panel.className = 'flow-chat-settings-panel';
    // Make panel scrollable in case there are many settings
    panel.style.maxHeight = '65vh';
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
          <span>Anti-Overlap</span>
          <label class="flow-chat-switch">
            <input type="checkbox" id="fc-overlap-toggle" ${settings.antiOverlap ? 'checked' : ''}>
            <span class="flow-chat-slider"></span>
          </label>
        </div>
      </div>
      <div class="flow-chat-setting-item">
        <div class="flow-chat-setting-header">
          <span>Auto Keep-Up (Live)</span>
          <label class="flow-chat-switch">
            <input type="checkbox" id="fc-keepup-toggle" ${settings.autoKeepUp ? 'checked' : ''}>
            <span class="flow-chat-slider"></span>
          </label>
        </div>
      </div>
      <div id="fc-keepup-settings" style="display: ${settings.autoKeepUp ? 'block' : 'none'}">
        <div class="flow-chat-setting-item fc-keepup-status-item">
          <div class="flow-chat-keepup-status">
            <span class="fc-status-dot" id="fc-keepup-dot"></span>
            <span id="fc-keepup-status-text">Checking status...</span>
          </div>
          <button type="button" class="flow-chat-sync-btn" id="fc-sync-now-btn" title="Jump to live edge">Sync Live</button>
        </div>
        <div class="flow-chat-setting-item">
          <div class="flow-chat-setting-header">
            <span>Catch-Up Speed (<span id="fc-keepup-speed-val">${settings.keepUpSpeed || 1.1}</span>x)</span>
          </div>
          <input type="range" id="fc-keepup-speed" min="1.05" max="1.25" step="0.05" value="${settings.keepUpSpeed || 1.1}">
        </div>
      </div>
      <div class="flow-chat-setting-item">
        <div class="flow-chat-setting-header">
          <span>Safe Zone (Camera)</span>
          <label class="flow-chat-switch">
            <input type="checkbox" id="fc-zone-toggle" ${settings.zoneEnabled ? 'checked' : ''}>
            <span class="flow-chat-slider"></span>
          </label>
        </div>
      </div>
      <div id="fc-zone-settings" style="display: ${settings.zoneEnabled ? 'block' : 'none'}">
        <div class="flow-chat-setting-item">
          <div class="flow-chat-setting-header">
            <span>Zone X (<span id="fc-zx-val">${settings.zoneX}</span>%)</span>
          </div>
          <input type="range" id="fc-zx" min="0" max="100" step="0.1" value="${settings.zoneX}">
        </div>
        <div class="flow-chat-setting-item">
          <div class="flow-chat-setting-header">
            <span>Zone Y (<span id="fc-zy-val">${settings.zoneY}</span>%)</span>
          </div>
          <input type="range" id="fc-zy" min="0" max="100" step="0.1" value="${settings.zoneY}">
        </div>
        <div class="flow-chat-setting-item">
          <div class="flow-chat-setting-header">
            <span>Zone Width (<span id="fc-zw-val">${settings.zoneW}</span>%)</span>
          </div>
          <input type="range" id="fc-zw" min="0" max="100" step="0.1" value="${settings.zoneW}">
        </div>
        <div class="flow-chat-setting-item">
          <div class="flow-chat-setting-header">
            <span>Zone Height (<span id="fc-zh-val">${settings.zoneH}</span>%)</span>
          </div>
          <input type="range" id="fc-zh" min="0" max="100" step="0.1" value="${settings.zoneH}">
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
      <div class="flow-chat-setting-item">
        <div class="flow-chat-setting-header">
          <span>Filter Words (comma separated)</span>
        </div>
        <input type="text" id="fc-filter-words" placeholder="None" style="width: 100%; box-sizing: border-box; margin-top: 5px; background: rgba(0,0,0,0.5); color: white; border: 1px solid #ccc; border-radius: 4px; padding: 4px;" value="${settings.filteredWords || ''}">
      </div>
    `;

    // Draggable panel logic
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    // Prevent clicks from bubbling up and pausing the video
    ['mousedown', 'mouseup', 'click'].forEach(eventType => {
      panel.addEventListener(eventType, (e) => {
        e.stopPropagation();
      });
    });

    panel.addEventListener('mousedown', (e) => {
      const isInteractive = e.target.tagName === 'INPUT' ||
        e.target.tagName === 'LABEL' ||
        e.target.closest('.flow-chat-switch');
      if (isInteractive) return;
      if (e.offsetX > panel.clientWidth) return; // Prevent drag on scrollbar

      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;

      initialLeft = panel.offsetLeft;
      initialTop = panel.offsetTop;

      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
      panel.style.left = initialLeft + 'px';
      panel.style.top = initialTop + 'px';

      panel.classList.add('fc-dragging');
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      panel.style.left = (initialLeft + dx) + 'px';
      panel.style.top = (initialTop + dy) + 'px';
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        panel.classList.remove('fc-dragging');
        document.body.style.userSelect = '';
      }
    }, true); // Use capture to ensure we catch it before panel's stopPropagation

    const playerContainer = document.querySelector('.html5-video-player');
    if (playerContainer) {
      playerContainer.appendChild(panel);
    }

    // Toggle menu visibility
    btn.addEventListener('click', (e) => {
      e.stopPropagation();

      // If we are opening the panel, reset its dragged position to default
      if (!panel.classList.contains('active')) {
        panel.style.left = '';
        panel.style.top = '';
        panel.style.bottom = '';
        panel.style.right = '';
      }

      panel.classList.toggle('active');
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && !btn.contains(e.target)) {
        panel.classList.remove('active');
      }
    });

    // Stop key events inside settings panel from triggering YouTube player shortcuts
    ['keydown', 'keyup', 'keypress'].forEach(eventType => {
      panel.addEventListener(eventType, (e) => {
        e.stopPropagation();
      });
    });

    // Event Listeners for inputs
    const saveSettings = () => {
      chrome.storage.local.set({ flowChatSettings: settings });
    };

    document.getElementById('fc-toggle').addEventListener('change', (e) => {
      settings.enabled = e.target.checked;
      isEnabled = settings.enabled;
      saveSettings();
      if (overlayContainer) overlayContainer.style.display = isEnabled ? "block" : "none";
      if (isEnabled) {
        updateButtonState('connecting');
        checkAndInjectHiddenChat();
      } else {
        const hiddenIframe = document.getElementById('flow-chat-hidden-iframe');
        if (hiddenIframe) hiddenIframe.remove();
        updateButtonState('none');
      }
    });

    document.getElementById('fc-zone-toggle').addEventListener('change', (e) => {
      settings.zoneEnabled = e.target.checked;
      saveSettings();
      updateOverlayMargins();
      updateSafeZonePreview(true);

      const zoneSettingsDiv = document.getElementById('fc-zone-settings');
      if (zoneSettingsDiv) {
        zoneSettingsDiv.style.display = settings.zoneEnabled ? 'block' : 'none';
      }
    });

    document.getElementById('fc-overlap-toggle').addEventListener('change', (e) => {
      settings.antiOverlap = e.target.checked;
      saveSettings();
      if (!settings.antiOverlap) {
        danmakuQueue.length = 0; // Clear queue if disabled
      }
    });

    document.getElementById('fc-keepup-toggle').addEventListener('change', (e) => {
      settings.autoKeepUp = e.target.checked;
      saveSettings();
      const keepUpSettingsDiv = document.getElementById('fc-keepup-settings');
      if (keepUpSettingsDiv) {
        keepUpSettingsDiv.style.display = settings.autoKeepUp ? 'block' : 'none';
      }
      tickAutoKeepUp();
    });

    document.getElementById('fc-sync-now-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      syncToLiveEdge();
    });

    document.getElementById('fc-keepup-speed')?.addEventListener('input', (e) => {
      settings.keepUpSpeed = parseFloat(e.target.value);
      document.getElementById('fc-keepup-speed-val').innerText = settings.keepUpSpeed;
      saveSettings();
      tickAutoKeepUp();
    });

    ['zx', 'zy', 'zw', 'zh'].forEach(prop => {
      document.getElementById(`fc-${prop}`).addEventListener('input', (e) => {
        const key = prop === 'zx' ? 'zoneX' : prop === 'zy' ? 'zoneY' : prop === 'zw' ? 'zoneW' : 'zoneH';
        settings[key] = e.target.value;
        document.getElementById(`fc-${prop}-val`).innerText = settings[key];
        saveSettings();
        updateOverlayMargins();
        updateSafeZonePreview(true);
      });
    });

    document.getElementById('fc-radiant-toggle').addEventListener('change', (e) => {
      settings.radiantStroke = e.target.checked;
      saveSettings();
    });

    document.getElementById('fc-stroke').addEventListener('input', (e) => {
      settings.strokeSize = e.target.value;
      document.getElementById('fc-stroke-val').innerText = settings.strokeSize;
      saveSettings();
      updateOverlayMargins();
    });

    document.getElementById('fc-opacity').addEventListener('input', (e) => {
      settings.opacity = e.target.value;
      document.getElementById('fc-opacity-val').innerText = settings.opacity;
      saveSettings();
      if (overlayContainer) overlayContainer.style.setProperty('--fc-opacity', settings.opacity / 100);
    });

    document.getElementById('fc-speed').addEventListener('input', (e) => {
      settings.speed = e.target.value;
      document.getElementById('fc-speed-val').innerText = settings.speed;
      saveSettings();
    });

    document.getElementById('fc-font').addEventListener('input', (e) => {
      settings.fontSize = e.target.value;
      document.getElementById('fc-font-val').innerText = settings.fontSize;
      saveSettings();
    });

    document.getElementById('fc-mt').addEventListener('input', (e) => {
      settings.marginTop = e.target.value;
      document.getElementById('fc-mt-val').innerText = settings.marginTop;
      saveSettings();
      updateOverlayMargins();
    });

    document.getElementById('fc-mb').addEventListener('input', (e) => {
      settings.marginBottom = e.target.value;
      document.getElementById('fc-mb-val').innerText = settings.marginBottom;
      saveSettings();
      updateOverlayMargins();
    });

    document.getElementById('fc-ml').addEventListener('input', (e) => {
      settings.marginLeft = e.target.value;
      document.getElementById('fc-ml-val').innerText = settings.marginLeft;
      saveSettings();
      updateOverlayMargins();
    });

    document.getElementById('fc-mr').addEventListener('input', (e) => {
      settings.marginRight = e.target.value;
      document.getElementById('fc-mr-val').innerText = settings.marginRight;
      saveSettings();
      updateOverlayMargins();
    });

    document.getElementById('fc-filter-words').addEventListener('input', (e) => {
      settings.filteredWords = e.target.value;
      saveSettings();
    });
  };

  // Restore hidden chat when enabled.
  // We no longer rely on the isLiveBroadcast meta tag because YouTube's SPA (Polymer)
  // does not reliably update it during navigation, causing the chat to fail until F5.
  function checkAndInjectHiddenChat() {
    if (!isEnabled) {
      const hiddenIframe = document.getElementById('flow-chat-hidden-iframe');
      if (hiddenIframe) hiddenIframe.remove();
      return;
    }

    let hiddenIframe = document.getElementById('flow-chat-hidden-iframe');
    if (!hiddenIframe) {
      let v = new URLSearchParams(window.location.search).get('v');
      if (!v && window.location.pathname.startsWith('/live/')) {
        v = window.location.pathname.split('/')[2];
      }
      if (v) {
        hiddenIframe = document.createElement('iframe');
        hiddenIframe.id = 'flow-chat-hidden-iframe';
        hiddenIframe.src = `/live_chat?is_popout=1&v=${v}`;
        hiddenIframe.style.position = 'fixed';
        hiddenIframe.style.width = '350px';
        hiddenIframe.style.height = '600px';
        hiddenIframe.style.opacity = '0.01'; // Virtually invisible
        hiddenIframe.style.pointerEvents = 'none'; // Unclickable
        hiddenIframe.style.top = '100px';
        hiddenIframe.style.left = '0';
        hiddenIframe.style.zIndex = '-999';

        document.body.appendChild(hiddenIframe);
        console.log("Flow Chat: Hidden Live Chat iframe injected");
      }
    }
  }

  setInterval(checkAndInjectHiddenChat, 2000);

  // We need to listen to messages from the chat iframe
  const seenMessageIds = new Set();

  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'FLOW_CHAT_CONNECTED' && isEnabled) {
      updateButtonState('connected');
      return;
    }

    // Restore focus to video player when iframe finishes sending chat
    if (event.data && event.data.type === 'CHAT_MESSAGE_SENT_RESTORE_FOCUS') {
      const videoPlayer = document.querySelector('.html5-video-player');
      if (videoPlayer) {
        videoPlayer.focus();
        videoPlayer.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      }
      return;
    }

    // Basic validation
    if (event.data && event.data.type === 'FLOW_CHAT_MESSAGE' && isEnabled) {
      // Deduplicate messages using their unique YouTube ID
      if (event.data.id) {
        if (seenMessageIds.has(event.data.id)) {
          return; // Ignore duplicate message
        }
        seenMessageIds.add(event.data.id);

        // Prevent memory leak by keeping Set size reasonable (e.g. max 500)
        if (seenMessageIds.size > 500) {
          const firstItem = seenMessageIds.values().next().value;
          seenMessageIds.delete(firstItem);
        }
      }

      if (settings.filteredWords && settings.filteredWords.trim() !== '') {
        const filterList = settings.filteredWords.split(',').map(w => w.trim()).filter(w => w !== '');
        if (filterList.length > 0) {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = event.data.html;

          const walk = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null, false);
          let node;
          while (node = walk.nextNode()) {
            let text = node.nodeValue;
            for (let word of filterList) {
              const regex = new RegExp(word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
              text = text.replace(regex, '');
            }
            node.nodeValue = text;
          }

          event.data.html = tempDiv.innerHTML;
        }
      }

      setupOverlay();
      if (overlayContainer) {
        createDanmaku(event.data.html);
      }
    }
  });

  const getMessageDiv = () => {
    const div = document.createElement('div');
    div.className = 'flow-chat-message';
    return div;
  };

  const releaseMessageDiv = (div) => {
    div.remove();
  };

  let danmakuQueue = [];
  const maxQueueSize = 100;

  setInterval(() => {
    if (document.hidden || danmakuQueue.length === 0 || !overlayContainer || !settings.antiOverlap) {
      if (!settings.antiOverlap && danmakuQueue.length > 0) danmakuQueue.length = 0;
      return;
    }

    let itemsToProcess = Math.min(danmakuQueue.length, 5);
    let itemsKept = [];

    for (let i = 0; i < itemsToProcess; i++) {
      let item = danmakuQueue.shift();
      if (Date.now() - item.time > 15000) continue; // Expire after 15s

      let spawned = attemptSpawn(item.html);
      if (!spawned) itemsKept.push(item);
    }

    if (itemsKept.length > 0) {
      danmakuQueue.unshift(...itemsKept);
    }
  }, 250);

  const createDanmaku = (html) => {
    if (document.hidden) return;

    let spawned = attemptSpawn(html);
    if (!spawned && settings.antiOverlap) {
      if (danmakuQueue.length < maxQueueSize) {
        danmakuQueue.push({ html, time: Date.now() });
      }
    }
  };

  const attemptSpawn = (html) => {
    const msgDiv = getMessageDiv();
    msgDiv.className = 'flow-chat-message';
    if (settings.radiantStroke) {
      msgDiv.classList.add('radiant-stroke');
    }
    msgDiv.innerHTML = html;
    msgDiv.style.fontSize = `${settings.fontSize}px`;

    // Temporarily append with visibility hidden to calculate dimensions
    msgDiv.style.visibility = 'hidden';
    overlayContainer.appendChild(msgDiv);

    const msgWidth = msgDiv.offsetWidth;
    const msgHeight = msgDiv.offsetHeight || (settings.fontSize * 1.3);
    const containerWidth = overlayContainer.clientWidth;
    const containerHeight = overlayContainer.clientHeight;

    // Random Speed
    const baseDuration = parseFloat(settings.speed);
    const duration = baseDuration + Math.random() * 2;
    const durationMs = duration * 1000;

    // Velocity: pixels per millisecond
    const distance = containerWidth + msgWidth;
    const velocity = distance / durationMs;

    // Collision Detection
    let bestTop = 0;
    let maxTop = containerHeight > 0 ? containerHeight - msgHeight : 0;
    if (maxTop < 0) maxTop = 0;

    const existingMessages = Array.from(overlayContainer.querySelectorAll('.flow-chat-message:not([style*="visibility: hidden"])'));

    const checkCollision = (testTop) => {
      for (let existing of existingMessages) {
        let eTop = existing.offsetTop;
        let eHeight = parseFloat(existing.dataset.height) || existing.offsetHeight;

        // Vertical Overlap Check
        const verticalPadding = 1;
        if (testTop < eTop + eHeight + verticalPadding && testTop + msgHeight + verticalPadding > eTop) {
          // Horizontal Overlap Check
          let eWidth = parseFloat(existing.dataset.width);
          let eVelocity = parseFloat(existing.dataset.velocity);
          let eStartTime = parseFloat(existing.dataset.startTime);

          if (!isNaN(eWidth) && !isNaN(eVelocity) && !isNaN(eStartTime)) {
            let elapsedTime = Date.now() - eStartTime;
            let eRightEdge = containerWidth - (eVelocity * elapsedTime) + eWidth;

            // 1. Existing message is still entering the screen
            if (eRightEdge > containerWidth) {
              return true;
            }

            // 2. New message is faster and catches up before existing message leaves
            let eTimeRemaining = eRightEdge / eVelocity;
            let nTimeToCross = containerWidth / velocity;
            if (eTimeRemaining > nTimeToCross) {
              return true;
            }
          }
        }
      }
      return false;
    };

    let foundSpot = false;

    // 1. Try a few random positions first (fastest)
    const maxAttempts = Math.floor(maxTop);
    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      let testTop = Math.random() * maxTop;

      if (!checkCollision(testTop)) {
        bestTop = testTop;
        foundSpot = true;
        break; // Found a safe spot
      }
    }

    // 2. If random fails, search systematically using larger steps (lanes)
    if (!foundSpot) {
      for (let testTop = 0; testTop <= maxTop; testTop += 1) {
        if (!checkCollision(testTop)) {
          bestTop = testTop;
          foundSpot = true;
          break; // Found a safe spot
        }
      }
    }

    // 3. Fallback: just place randomly
    if (!foundSpot) {
      if (settings.antiOverlap) {
        msgDiv.remove();
        return false;
      }
      bestTop = Math.random() * maxTop;
    }

    msgDiv.style.top = `${bestTop}px`;
    msgDiv.style.visibility = 'visible';

    // Save metadata for future collision checks
    msgDiv.dataset.width = msgWidth;
    msgDiv.dataset.height = msgHeight;
    msgDiv.dataset.velocity = velocity;
    msgDiv.dataset.startTime = Date.now();

    // Use Web Animations API
    const animation = msgDiv.animate([
      { transform: `translateX(${containerWidth}px)` },
      { transform: `translateX(-${msgWidth}px)` }
    ], {
      duration: durationMs, // API uses milliseconds
      easing: 'linear',
      fill: 'forwards'
    });

    // Clean up after animation finishes
    animation.onfinish = () => {
      releaseMessageDiv(msgDiv);
    };

    return true;
  };

  // Handle visibility change so danmaku pauses when the user switches tabs,
  // and trigger auto keep-up immediately when returning to the tab.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      tickAutoKeepUp();
    }
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

  // Global keydown listener for quick chat in full screen
  window.addEventListener('keydown', (e) => {
    // Don't intercept if user is already typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
      return;
    }

    if (e.key === 'Enter') {
      const isFullScreen = document.fullscreenElement !== null;
      const videoPlayer = document.querySelector('.html5-video-player');
      const isYtFullScreen = videoPlayer && videoPlayer.classList.contains('ytp-fullscreen');

      if (isFullScreen || isYtFullScreen) {
        const chatInput = document.querySelector('.flow-chat-quick-input');
        if (chatInput) {
          e.preventDefault();
          e.stopPropagation(); // Stop YouTube from doing anything with Enter

          // Wake up the player controls reliably without breaking YouTube's state machine
          if (videoPlayer) {
            const rect = videoPlayer.getBoundingClientRect();
            // Dispatch mousemove with coordinates to trigger YouTube's movement threshold
            videoPlayer.dispatchEvent(new MouseEvent('mousemove', {
              bubbles: true, cancelable: true, clientX: rect.left + 10, clientY: rect.top + 10
            }));
            setTimeout(() => {
              videoPlayer.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true, cancelable: true, clientX: rect.left + 50, clientY: rect.top + 50
              }));
            }, 10);
          }

          // Focus after a tiny delay to ensure controls are visible and ready
          setTimeout(() => {
            chatInput.focus();
            chatInput.click();
          }, 50);
        }
      }
    }
  }, { capture: true }); // Use capture to ensure we intercept before YouTube's player stops propagation

  // Keep attempting to setup overlay and settings UI if they are missing.
  // Using setInterval instead of MutationObserver on document.body(subtree:true)
  // drastically reduces background CPU load on YouTube's main page.
  setInterval(() => {
    if (document.querySelector('.html5-video-player')) {
      if (!document.getElementById('flow-chat-overlay')) {
        setupOverlay();
      }
      if (!document.querySelector('.flow-chat-ytp-btn')) {
        injectSettingsUI();
      }
    }
  }, 5000);
}
