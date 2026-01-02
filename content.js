// Read11 - Content Script

(function() {
  'use strict';

  let isReading = false;
  let autoReadEnabled = false;
  let statusIndicator = null;
  let lastReadContent = '';

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
        break;
      case 'readPageContent':
        readPageContent();
        break;
    }
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
        <button class="read11-stop" title="Stop reading (Alt+X)">✕</button>
      </div>
    `;
    document.body.appendChild(statusIndicator);

    // Add stop button handler
    statusIndicator.querySelector('.read11-stop').addEventListener('click', () => {
      browser.runtime.sendMessage({ action: 'stop' });
      setReadingState(false);
    });
  }

  function setReadingState(reading) {
    isReading = reading;
    if (statusIndicator) {
      if (reading) {
        statusIndicator.classList.remove('read11-hidden');
        statusIndicator.classList.add('read11-visible');
      } else {
        statusIndicator.classList.remove('read11-visible');
        statusIndicator.classList.add('read11-hidden');
      }
    }
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
