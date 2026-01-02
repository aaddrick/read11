// Read11 - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  // Set up event listeners FIRST (before any async operations)
  setupEventListeners();

  // Then try to load state (can fail without breaking UI)
  loadState();
});

function setupEventListeners() {
  // Open options - set this up immediately
  document.getElementById('open-options').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const optionsUrl = browser.runtime.getURL('options.html');
    browser.tabs.create({ url: optionsUrl });
    window.close();
  });

  // Read page button
  document.getElementById('read-page').addEventListener('click', async () => {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        browser.tabs.sendMessage(tabs[0].id, { action: 'readPageContent' });
        updateStatus(true);
      }
    } catch (err) {
      console.error('Read page error:', err);
    }
  });

  // Stop button
  document.getElementById('stop-reading').addEventListener('click', async () => {
    try {
      await browser.runtime.sendMessage({ action: 'stop' });
      updateStatus(false);
    } catch (err) {
      console.error('Stop error:', err);
    }
  });

  // Auto-read toggle
  document.getElementById('auto-read-toggle').addEventListener('change', async (e) => {
    try {
      await browser.runtime.sendMessage({
        action: 'setAutoRead',
        enabled: e.target.checked
      });
    } catch (err) {
      console.error('Toggle auto-read error:', err);
    }
  });
}

async function loadState() {
  try {
    // Get current status
    const status = await browser.runtime.sendMessage({ action: 'getStatus' });
    if (status) {
      updateStatus(status.isPlaying);
    }
  } catch (err) {
    console.log('Could not get status:', err);
  }

  try {
    // Get settings
    const result = await browser.storage.local.get('settings');
    const settings = result.settings || {};

    // Check if API key is configured
    if (!settings.apiKey) {
      showConfigWarning();
    }

    // Set auto-read toggle state
    document.getElementById('auto-read-toggle').checked = settings.autoRead || false;
  } catch (err) {
    console.log('Could not load settings:', err);
  }
}

function updateStatus(isPlaying) {
  const statusIcon = document.getElementById('status-icon');
  const statusText = document.getElementById('status-text');
  const statusBar = document.getElementById('status-bar');
  const stopBtn = document.getElementById('stop-reading');
  const readBtn = document.getElementById('read-page');

  if (isPlaying) {
    statusIcon.textContent = '🔊';
    statusText.textContent = 'Reading...';
    statusBar.classList.add('active');
    stopBtn.disabled = false;
    readBtn.disabled = true;
  } else {
    statusIcon.textContent = '✓';
    statusText.textContent = 'Ready';
    statusBar.classList.remove('active');
    stopBtn.disabled = true;
    readBtn.disabled = false;
  }
}

function showConfigWarning() {
  const statusBar = document.getElementById('status-bar');
  const statusIcon = document.getElementById('status-icon');
  const statusText = document.getElementById('status-text');

  statusIcon.textContent = '⚠️';
  statusText.textContent = 'API key not configured';
  statusBar.classList.add('warning');

  // Disable read button
  document.getElementById('read-page').disabled = true;
}

// Listen for status updates
browser.runtime.onMessage.addListener((message) => {
  if (message.action === 'readingStarted') {
    updateStatus(true);
  } else if (message.action === 'readingEnded') {
    updateStatus(false);
  }
});
