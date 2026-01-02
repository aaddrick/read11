// Read11 - Content Script

(function() {
  'use strict';

  let isReading = false;
  let autoReadEnabled = false;
  let statusIndicator = null;
  let lastReadContent = '';

  // Audio playback state
  let audioContext = null;
  let currentSource = null;
  let isPaused = false;

  // Streaming audio state
  let audioQueue = [];
  let nextPlayTime = 0;
  let isStreamingPlayback = false;

  // Initialize
  init();

  function init() {
    // Get initial auto-read state
    browser.storage.local.get('settings').then((result) => {
      if (result.settings) {
        autoReadEnabled = result.settings.autoRead || false;
        if (autoReadEnabled) {
          scheduleAutoRead();
        }
      }
    });

    // Create status indicator
    createStatusIndicator();

    // Listen for messages from background script
    browser.runtime.onMessage.addListener(handleMessage);

    // Listen for page visibility changes (for auto-read)
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  function handleMessage(message) {
    switch (message.action) {
      case 'getSelection':
        const selection = window.getSelection().toString().trim();
        if (selection) {
          browser.runtime.sendMessage({ action: 'read', text: selection });
        }
        break;
      case 'startLoading':
        setWidgetState('loading');
        break;
      case 'playAudio':
        playAudioFromBase64(message.audioData);
        break;
      case 'playAudioChunk':
        handleAudioChunk(message.audioData, message.isFirst, message.isFinal);
        break;
      case 'stopAudio':
        stopAudio();
        break;
      case 'readingStarted':
        setReadingState(true);
        break;
      case 'readingEnded':
        setReadingState(false);
        break;
      case 'autoReadChanged':
        autoReadEnabled = message.enabled;
        if (autoReadEnabled) {
          scheduleAutoRead();
        }
        break;
      case 'error':
        showNotification(message.message, 'error');
        setReadingState(false);
        break;
      case 'readPageContent':
        readPageContent();
        break;
    }
  }

  // Convert base64 to ArrayBuffer
  function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Play audio from base64 data using Web Audio API
  async function playAudioFromBase64(base64Data) {
    try {
      // Create or resume audio context
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }

      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Stop any current playback
      stopAudio();

      // Convert base64 to ArrayBuffer
      const arrayBuffer = base64ToArrayBuffer(base64Data);

      console.log('Read11: Decoding audio, size:', arrayBuffer.byteLength);

      // Decode the audio data
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      console.log('Read11: Audio decoded, duration:', audioBuffer.duration, 'seconds');

      // Create and configure source
      currentSource = audioContext.createBufferSource();
      currentSource.buffer = audioBuffer;
      currentSource.connect(audioContext.destination);

      // Handle playback end
      currentSource.onended = () => {
        currentSource = null;
        setReadingState(false);
      };

      // Start playback
      setReadingState(true);
      currentSource.start(0);

    } catch (error) {
      console.error('Read11: Audio playback error:', error);
      showNotification('Audio playback failed: ' + error.message, 'error');
      setReadingState(false);
    }
  }

  // Toggle pause/resume
  async function togglePause() {
    if (!audioContext || !currentSource) return;

    const pauseBtn = statusIndicator?.querySelector('.read11-pause');

    if (isPaused) {
      // Resume
      await audioContext.resume();
      isPaused = false;
      if (pauseBtn) pauseBtn.textContent = '⏸';
      setWidgetState('playing');
    } else {
      // Pause
      await audioContext.suspend();
      isPaused = true;
      if (pauseBtn) pauseBtn.textContent = '▶';
      // Update widget to show paused state
      const icon = statusIndicator?.querySelector('.read11-icon');
      const text = statusIndicator?.querySelector('.read11-text');
      if (icon) icon.textContent = '⏸';
      if (text) text.textContent = 'Paused';
    }
  }

  // Stop current audio playback
  function stopAudio() {
    // Stop any streaming sources
    for (const source of audioQueue) {
      try {
        source.stop();
      } catch (e) {}
    }
    audioQueue = [];

    if (currentSource) {
      try {
        currentSource.stop();
      } catch (e) {
        // Ignore errors if already stopped
      }
      currentSource = null;
    }

    isPaused = false;
    isStreamingPlayback = false;
    nextPlayTime = 0;

    // Reset pause button
    const pauseBtn = statusIndicator?.querySelector('.read11-pause');
    if (pauseBtn) pauseBtn.textContent = '⏸';
    setReadingState(false);
  }

  // Handle streaming audio chunk (PCM format)
  async function handleAudioChunk(base64Data, isFirst, isFinal) {
    try {
      // Initialize audio context if needed
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }

      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      if (isFirst) {
        // Reset streaming state
        stopAudio();
        isStreamingPlayback = true;
        nextPlayTime = audioContext.currentTime;
        setWidgetState('playing');
      }

      if (base64Data && base64Data.length > 0) {
        // Convert base64 to PCM audio buffer
        const arrayBuffer = base64ToArrayBuffer(base64Data);
        const audioBuffer = createPCMAudioBuffer(arrayBuffer);

        // Create and schedule source
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        // Ensure we don't schedule in the past
        if (nextPlayTime < audioContext.currentTime) {
          nextPlayTime = audioContext.currentTime;
        }

        source.start(nextPlayTime);
        nextPlayTime += audioBuffer.duration;

        audioQueue.push(source);

        // Clean up finished sources
        source.onended = () => {
          const idx = audioQueue.indexOf(source);
          if (idx > -1) audioQueue.splice(idx, 1);

          // Check if all playback is done
          if (audioQueue.length === 0 && isFinal) {
            isStreamingPlayback = false;
            setReadingState(false);
          }
        };

        console.log('Read11: Scheduled chunk, duration:', audioBuffer.duration.toFixed(2), 's, queue:', audioQueue.length);
      }

      if (isFinal && audioQueue.length === 0) {
        // No audio was played
        isStreamingPlayback = false;
        setReadingState(false);
      }

    } catch (error) {
      console.error('Read11: Chunk playback error:', error);
      showNotification('Audio playback failed: ' + error.message, 'error');
      setReadingState(false);
    }
  }

  // Create AudioBuffer from PCM data (16-bit signed, 44100 Hz, mono)
  function createPCMAudioBuffer(arrayBuffer) {
    const dataView = new DataView(arrayBuffer);
    const numSamples = arrayBuffer.byteLength / 2; // 16-bit = 2 bytes per sample

    const audioBuffer = audioContext.createBuffer(1, numSamples, 44100);
    const channelData = audioBuffer.getChannelData(0);

    for (let i = 0; i < numSamples; i++) {
      // Read 16-bit signed integer (little-endian)
      const sample = dataView.getInt16(i * 2, true);
      // Convert to float (-1.0 to 1.0)
      channelData[i] = sample / 32768;
    }

    return audioBuffer;
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && autoReadEnabled) {
      scheduleAutoRead();
    }
  }

  // Create floating status indicator
  function createStatusIndicator() {
    statusIndicator = document.createElement('div');
    statusIndicator.id = 'read11-status';
    statusIndicator.className = 'read11-hidden';
    statusIndicator.innerHTML = `
      <div class="read11-status-content">
        <span class="read11-icon">🔊</span>
        <span class="read11-text">Reading...</span>
        <div class="read11-controls">
          <button class="read11-pause" title="Pause/Resume">⏸</button>
          <button class="read11-stop" title="Stop (Alt+X)">✕</button>
        </div>
      </div>
    `;
    document.body.appendChild(statusIndicator);

    // Add pause button handler
    statusIndicator.querySelector('.read11-pause').addEventListener('click', () => {
      togglePause();
    });

    // Add stop button handler
    statusIndicator.querySelector('.read11-stop').addEventListener('click', () => {
      stopAudio();
      browser.runtime.sendMessage({ action: 'stop' });
    });
  }

  function setWidgetState(state) {
    // States: 'hidden', 'loading', 'playing'
    if (!statusIndicator) return;

    const icon = statusIndicator.querySelector('.read11-icon');
    const text = statusIndicator.querySelector('.read11-text');

    switch (state) {
      case 'loading':
        statusIndicator.classList.remove('read11-hidden');
        statusIndicator.classList.add('read11-visible', 'read11-loading');
        statusIndicator.classList.remove('read11-playing');
        icon.textContent = '⏳';
        text.textContent = 'Loading...';
        break;
      case 'playing':
        statusIndicator.classList.remove('read11-hidden', 'read11-loading');
        statusIndicator.classList.add('read11-visible', 'read11-playing');
        icon.textContent = '🔊';
        text.textContent = 'Reading...';
        break;
      case 'hidden':
      default:
        statusIndicator.classList.remove('read11-visible', 'read11-loading', 'read11-playing');
        statusIndicator.classList.add('read11-hidden');
        break;
    }
  }

  function setReadingState(reading) {
    isReading = reading;
    setWidgetState(reading ? 'playing' : 'hidden');
  }

  // Schedule auto-read after page load
  function scheduleAutoRead() {
    browser.storage.local.get('settings').then((result) => {
      const delay = result.settings?.autoReadDelay || 1000;
      setTimeout(() => {
        if (autoReadEnabled && document.visibilityState === 'visible') {
          readPageContent();
        }
      }, delay);
    });
  }

  // Extract and read main page content
  function readPageContent() {
    const content = extractMainContent();
    if (content && content !== lastReadContent) {
      lastReadContent = content;
      browser.runtime.sendMessage({ action: 'read', text: content });
    }
  }

  // Extract main readable content from the page
  function extractMainContent() {
    // Priority selectors for main content
    const contentSelectors = [
      'article',
      '[role="main"]',
      'main',
      '.content',
      '.post-content',
      '.article-content',
      '.entry-content',
      '#content',
      '#main-content',
      '.main-content'
    ];

    let contentElement = null;

    // Try to find main content container
    for (const selector of contentSelectors) {
      contentElement = document.querySelector(selector);
      if (contentElement) break;
    }

    // Fallback to body if no specific content container found
    if (!contentElement) {
      contentElement = document.body;
    }

    // Clone to avoid modifying the actual DOM
    const clone = contentElement.cloneNode(true);

    // Remove unwanted elements
    const unwantedSelectors = [
      'script', 'style', 'noscript', 'iframe', 'object', 'embed',
      'nav', 'header', 'footer', 'aside',
      '.sidebar', '.navigation', '.menu', '.advertisement', '.ad',
      '.comments', '.comment-section', '.social-share',
      '[aria-hidden="true"]', '[hidden]',
      '.read11-status'
    ];

    unwantedSelectors.forEach(selector => {
      clone.querySelectorAll(selector).forEach(el => el.remove());
    });

    // Get text content and clean it up
    let text = clone.textContent || '';

    // Clean up whitespace
    text = text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();

    // Limit to reasonable length (ElevenLabs has limits)
    const maxLength = 5000;
    if (text.length > maxLength) {
      text = text.substring(0, maxLength);
      // Try to end at a sentence
      const lastPeriod = text.lastIndexOf('.');
      if (lastPeriod > maxLength * 0.8) {
        text = text.substring(0, lastPeriod + 1);
      }
    }

    return text;
  }

  // Show notification toast
  function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `read11-notification read11-notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    // Trigger animation
    setTimeout(() => notification.classList.add('read11-notification-visible'), 10);

    // Remove after delay
    setTimeout(() => {
      notification.classList.remove('read11-notification-visible');
      setTimeout(() => notification.remove(), 300);
    }, 4000);
  }
})();
