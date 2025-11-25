// content.js
// Listens for messages from extension to control playback and reports time/playing status back.

(function () {
  // Try a few selectors because different services use different players
  function findVideoElement() {
    // Netflix/Hulu/HBO often have <video> but sometimes nested in shadow DOM.
    const video = document.querySelector('video');
    if (video) return video;

    // Netflix sometimes uses video under #app-root ... search deeper
    const vids = document.getElementsByTagName('video');
    if (vids.length) return vids[0];

    return null;
  }

  let video = null;
  function init() {
    video = findVideoElement();
    if (!video) {
      // If not found initially, try again later
      setTimeout(init, 1000);
      return;
    }

    // Notify extension that video found
    chrome.runtime.sendMessage({ type: 'VIDEO_READY' });

    // Monitor video events and report to extension
    const sendState = (extra) => {
      chrome.runtime.sendMessage({
        type: 'VIDEO_STATE',
        currentTime: video.currentTime,
        paused: video.paused,
        playbackRate: video.playbackRate,
        ...extra
      });
    };

    video.addEventListener('play', () => sendState());
    video.addEventListener('pause', () => sendState());
    video.addEventListener('seeking', () => sendState({ seeking: true }));
    video.addEventListener('ratechange', () => sendState());
  }

  // Handle incoming control messages from extension
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!video) video = findVideoElement();
    if (!video && msg.type !== 'FIND_VIDEO') {
      sendResponse({ ok: false, reason: 'no-video' });
      return;
    }

    if (msg.type === 'PLAY') {
      video.play().catch(() => {/* might fail due to autoplay policies */});
      sendResponse({ ok: true });
    } else if (msg.type === 'PAUSE') {
      video.pause();
      sendResponse({ ok: true });
    } else if (msg.type === 'SEEK') {
      video.currentTime = msg.time;
      sendResponse({ ok: true });
    } else if (msg.type === 'GET_STATE') {
      sendResponse({
        ok: true,
        currentTime: video.currentTime,
        paused: video.paused,
        playbackRate: video.playbackRate
      });
    } else if (msg.type === 'FIND_VIDEO') {
      sendResponse({ ok: !!video });
    } else {
      sendResponse({ ok: false, reason: 'unknown' });
    }
  });

  init();
})();
