// Read11 - ElevenLabs Screen Reader Background Script

const API_BASE = 'https://api.elevenlabs.io/v1';

// Default settings
const DEFAULT_SETTINGS = {
  apiKey: '',
  voiceId: 'EXAVITQu4vr4xnSDxMaL', // "Sarah" - natural conversational voice
  modelId: 'eleven_multilingual_v2',
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  speed: 1.0,
  autoRead: false,
  autoReadDelay: 1000
};

// State
let currentAudio = null;
let isPlaying = false;

// Initialize extension
browser.runtime.onInstalled.addListener(() => {
  // Create context menu
  browser.contextMenus.create({
    id: 'read-selection',
    title: 'Read with Read11',
    contexts: ['selection']
  });

  // Initialize default settings
  browser.storage.local.get('settings').then((result) => {
    if (!result.settings) {
      browser.storage.local.set({ settings: DEFAULT_SETTINGS });
    }
  });
});

// Handle context menu clicks
browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'read-selection' && info.selectionText) {
    readText(info.selectionText, tab.id);
  }
});

// Handle keyboard shortcuts
browser.commands.onCommand.addListener((command) => {
  if (command === 'read-selection') {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]) {
        browser.tabs.sendMessage(tabs[0].id, { action: 'getSelection' });
      }
    });
  } else if (command === 'stop-reading') {
    stopReading();
  } else if (command === 'toggle-auto-read') {
    toggleAutoRead();
  }
});

// Handle messages from content script and popup
browser.runtime.onMessage.addListener((message, sender) => {
  switch (message.action) {
    case 'read':
      return readText(message.text, sender.tab?.id);
    case 'stop':
      return stopReading();
    case 'getStatus':
      return Promise.resolve({ isPlaying, autoRead: getAutoReadState() });
    case 'getVoices':
      return fetchVoices();
    case 'testVoice':
      return testVoice(message.voiceId, message.text);
    case 'toggleAutoRead':
      return toggleAutoRead();
    case 'setAutoRead':
      return setAutoRead(message.enabled);
    default:
      return Promise.resolve();
  }
});

// Fetch available voices from ElevenLabs
async function fetchVoices() {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error('API key not configured');
  }

  const response = await fetch(`${API_BASE}/voices`, {
    headers: {
      'xi-api-key': settings.apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch voices: ${response.statusText}`);
  }

  const data = await response.json();
  return data.voices;
}

// Convert text to speech using ElevenLabs API
async function readText(text, tabId) {
  if (!text || text.trim().length === 0) {
    return { success: false, error: 'No text provided' };
  }

  // Stop any current playback
  stopReading();

  const settings = await getSettings();
  if (!settings.apiKey) {
    notifyError(tabId, 'Please configure your ElevenLabs API key in the extension options.');
    return { success: false, error: 'API key not configured' };
  }

  try {
    // Notify content script that reading is starting
    if (tabId) {
      browser.tabs.sendMessage(tabId, { action: 'readingStarted' }).catch(() => {});
    }

    const response = await fetch(`${API_BASE}/text-to-speech/${settings.voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': settings.apiKey
      },
      body: JSON.stringify({
        text: text,
        model_id: settings.modelId,
        voice_settings: {
          stability: settings.stability,
          similarity_boost: settings.similarityBoost,
          style: settings.style,
          speed: settings.speed
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);

    // Play the audio
    await playAudio(audioUrl, tabId);

    return { success: true };
  } catch (error) {
    console.error('Read11 error:', error);
    notifyError(tabId, `Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Play audio blob
function playAudio(audioUrl, tabId) {
  return new Promise((resolve, reject) => {
    currentAudio = new Audio();
    isPlaying = true;

    currentAudio.onended = () => {
      isPlaying = false;
      URL.revokeObjectURL(audioUrl);
      if (tabId) {
        browser.tabs.sendMessage(tabId, { action: 'readingEnded' }).catch(() => {});
      }
      resolve();
    };

    currentAudio.onerror = (e) => {
      isPlaying = false;
      URL.revokeObjectURL(audioUrl);
      if (tabId) {
        browser.tabs.sendMessage(tabId, { action: 'readingEnded' }).catch(() => {});
      }
      reject(new Error('Audio playback failed'));
    };

    // Wait for audio to be fully loaded before playing
    currentAudio.oncanplaythrough = () => {
      currentAudio.play().catch(reject);
    };

    // Preload the entire audio file
    currentAudio.preload = 'auto';
    currentAudio.src = audioUrl;
    currentAudio.load();
  });
}

// Stop current playback
function stopReading() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  isPlaying = false;
  return Promise.resolve({ success: true });
}

// Test a voice with sample text
async function testVoice(voiceId, text = 'Hello, this is a test of the Read11 screen reader.') {
  const settings = await getSettings();
  const originalVoiceId = settings.voiceId;

  // Temporarily use the test voice
  settings.voiceId = voiceId;
  await browser.storage.local.set({ settings });

  try {
    await readText(text);
  } finally {
    // Restore original voice
    settings.voiceId = originalVoiceId;
    await browser.storage.local.set({ settings });
  }
}

// Get current settings
async function getSettings() {
  const result = await browser.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...result.settings };
}

// Get auto-read state
async function getAutoReadState() {
  const settings = await getSettings();
  return settings.autoRead;
}

// Toggle auto-read mode
async function toggleAutoRead() {
  const settings = await getSettings();
  settings.autoRead = !settings.autoRead;
  await browser.storage.local.set({ settings });

  // Notify all tabs
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    browser.tabs.sendMessage(tab.id, {
      action: 'autoReadChanged',
      enabled: settings.autoRead
    }).catch(() => {});
  }

  return { autoRead: settings.autoRead };
}

// Set auto-read mode
async function setAutoRead(enabled) {
  const settings = await getSettings();
  settings.autoRead = enabled;
  await browser.storage.local.set({ settings });

  // Notify all tabs
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    browser.tabs.sendMessage(tab.id, {
      action: 'autoReadChanged',
      enabled: settings.autoRead
    }).catch(() => {});
  }

  return { autoRead: settings.autoRead };
}

// Notify tab of an error
function notifyError(tabId, message) {
  if (tabId) {
    browser.tabs.sendMessage(tabId, {
      action: 'error',
      message
    }).catch(() => {});
  }
}
