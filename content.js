// content.js
let isEnabled = true;

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

  // Start observing on document.body so that we don't lose the observer if YouTube 
  // replaces the chat container (which happens often when switching tabs back and forth).
  chatObserver.observe(document.body, { childList: true, subtree: true });
} else {
  // --- MAIN PAGE LOGIC (Video Player) ---
  console.log("Flow Chat: Initializing on main page");
  let overlayContainer = null;

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
    zoneH: 20
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
    `;

    const playerContainer = document.querySelector('.html5-video-player');
    if (playerContainer) {
      playerContainer.appendChild(panel);
    }

    // Toggle menu visibility
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
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
        checkAndInjectHiddenChat();
      } else {
        const hiddenIframe = document.getElementById('flow-chat-hidden-iframe');
        if (hiddenIframe) hiddenIframe.remove();
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
  };

  // Restore hidden chat ONLY for actual live streams.
  // VOD replays require complex time-sync that YouTube blocks when the original iframe is destroyed.
  function checkAndInjectHiddenChat() {
    if (!isEnabled) {
      const hiddenIframe = document.getElementById('flow-chat-hidden-iframe');
      if (hiddenIframe) hiddenIframe.remove();
      return;
    }

    const isLive = document.querySelector('meta[itemprop="isLiveBroadcast"]');
    if (isLive) {
      let hiddenIframe = document.getElementById('flow-chat-hidden-iframe');
      if (!hiddenIframe) {
        const v = new URLSearchParams(window.location.search).get('v');
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
  }

  setInterval(checkAndInjectHiddenChat, 2000);

  // We need to listen to messages from the chat iframe
  const seenMessageIds = new Set();

  window.addEventListener('message', (event) => {
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

      setupOverlay();
      if (overlayContainer) {
        createDanmaku(event.data.html);
      }
    }
  });

  const createDanmaku = (html) => {
    // If the tab is hidden, don't create new danmaku to avoid them clumping together 
    // or disappearing instantly when the user returns.
    if (document.hidden) return;

    const msgDiv = document.createElement('div');
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

    for (let attempts = 0; attempts < 1000; attempts++) {
      let testTop = Math.random() * maxTop;
      let collision = false;

      for (let existing of existingMessages) {
        let eTop = existing.offsetTop;
        let eHeight = parseFloat(existing.dataset.height) || existing.offsetHeight;

        // Vertical Overlap Check
        // Add a small vertical padding (e.g. 10% of font size) to make it less crowded
        const verticalPadding = settings.fontSize * 0.1;
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
              collision = true;
              break;
            }

            // 2. New message is faster and catches up before existing message leaves
            let eTimeRemaining = eRightEdge / eVelocity;
            let nTimeToCross = containerWidth / velocity;
            if (eTimeRemaining > nTimeToCross) {
              collision = true;
              break;
            }
          }
        }
      }

      bestTop = testTop;
      if (!collision) {
        break; // Found a safe spot
      }
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
      { transform: 'translateX(100cqw)' },
      { transform: 'translateX(-100%)' }
    ], {
      duration: durationMs, // API uses milliseconds
      easing: 'linear',
      fill: 'forwards'
    });

    // Clean up after animation finishes
    animation.onfinish = () => {
      msgDiv.remove();
    };
  };

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

  // Keep attempting to setup overlay and settings UI if they are missing
  let observerTimeout = null;
  const appObserver = new MutationObserver(() => {
    if (observerTimeout) return;
    observerTimeout = setTimeout(() => {
      observerTimeout = null;
      if (document.querySelector('.html5-video-player')) {
        if (!document.getElementById('flow-chat-overlay')) {
          setupOverlay();
        }
        if (!document.querySelector('.flow-chat-ytp-btn')) {
          injectSettingsUI();
        }
      }
    }, 500);
  });
  appObserver.observe(document.body, { childList: true, subtree: true });
}
