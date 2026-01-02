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
let isPlaying = false;

// Initialize extension
browser.runtime.onInstalled.addListener(async () => {
  // Remove existing menu and create fresh
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: 'read-selection',
    title: 'Read with Read11',
    contexts: ['selection']
  });

  // Initialize default settings
  const result = await browser.storage.local.get('settings');
  if (!result.settings) {
    await browser.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
});

// Handle context menu clicks
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'read-selection' && info.selectionText) {
    try {
      // Show loading state first
      if (tab?.id) {
        browser.tabs.sendMessage(tab.id, { action: 'startLoading' }).catch(() => {});
      }
      // Use streaming for faster playback start
      await generateAudioStreaming(info.selectionText, tab?.id);
    } catch (error) {
      console.error('Read11 context menu error:', error);
      if (tab?.id) {
        browser.tabs.sendMessage(tab.id, {
          action: 'error',
          message: error.message
        }).catch(() => {});
      }
    }
  }
});

// Handle keyboard shortcuts
browser.commands.onCommand.addListener(async (command) => {
  if (command === 'read-selection') {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      browser.tabs.sendMessage(tabs[0].id, { action: 'getSelection' });
    }
  } else if (command === 'stop-reading') {
    // Notify all tabs to stop
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      browser.tabs.sendMessage(tab.id, { action: 'stopAudio' }).catch(() => {});
    }
    isPlaying = false;
  } else if (command === 'toggle-auto-read') {
    toggleAutoRead();
  }
});

// Handle messages from content script and popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle async operations without returning Promise directly to avoid DataCloneError
  (async () => {
    try {
      switch (message.action) {
        case 'read':
          // Show loading state first
          if (sender.tab?.id) {
            browser.tabs.sendMessage(sender.tab.id, { action: 'startLoading' }).catch(() => {});
          }
          // Use streaming for faster playback start
          await generateAudioStreaming(message.text, sender.tab?.id);
          sendResponse({ success: true });
          break;
        case 'stop':
          // Notify all tabs to stop
          const tabs = await browser.tabs.query({});
          for (const tab of tabs) {
            browser.tabs.sendMessage(tab.id, { action: 'stopAudio' }).catch(() => {});
          }
          isPlaying = false;
          sendResponse({ success: true });
          break;
        case 'getStatus':
          const autoRead = await getAutoReadState();
          sendResponse({ isPlaying, autoRead });
          break;
        case 'getVoices':
          const voices = await fetchVoices();
          sendResponse(voices);
          break;
        case 'testVoice':
          await testVoice(message.voiceId, message.text);
          sendResponse({ success: true });
          break;
        case 'toggleAutoRead':
          const result = await toggleAutoRead();
          sendResponse(result);
          break;
        case 'setAutoRead':
          const setResult = await setAutoRead(message.enabled);
          sendResponse(setResult);
          break;
        default:
          sendResponse({});
      }
    } catch (error) {
      console.error('Read11 message handler error:', error);
      sendResponse({ error: error.message });
    }
  })();
  return true; // Keep message channel open for async response
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

// Generate audio from text using ElevenLabs streaming API
async function generateAudioStreaming(text, tabId) {
  if (!text || text.trim().length === 0) {
    throw new Error('No text provided');
  }

  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error('API key not configured');
  }

  // Use streaming endpoint with MP3 format (available on all tiers)
  const response = await fetch(`${API_BASE}/text-to-speech/${settings.voiceId}/stream?output_format=mp3_44100_128`, {
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

  // Stream the audio data and accumulate (MP3 needs complete data for decoding)
  const reader = response.body.getReader();
  let chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    totalBytes += value.length;
  }

  // Combine all chunks and send to content script
  const combined = concatenateChunks(chunks);
  const base64 = arrayBufferToBase64(combined.buffer);

  console.log('Read11: Audio streamed, total size:', totalBytes, 'bytes');

  if (tabId) {
    browser.tabs.sendMessage(tabId, {
      action: 'playAudio',
      audioData: base64
    }).catch(() => {});
  }
}

// Concatenate Uint8Array chunks
function concatenateChunks(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// Non-streaming fallback (for testing/debugging)
async function generateAudio(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('No text provided');
  }

  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error('API key not configured');
  }

  const response = await fetch(`${API_BASE}/text-to-speech/${settings.voiceId}?output_format=mp3_44100_128`, {
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

  // Get the full audio data as arrayBuffer and convert to base64
  const arrayBuffer = await response.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);

  console.log('Read11: Audio size:', arrayBuffer.byteLength, 'bytes');

  return base64;
}

// Convert ArrayBuffer to base64 string
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Test a voice with sample text (plays directly from background script)
async function testVoice(voiceId, text = 'Hello, this is a test of the Read11 screen reader.') {
  const settings = await getSettings();
  const originalVoiceId = settings.voiceId;

  // Temporarily use the test voice (keeps all other settings like speed, stability, etc.)
  settings.voiceId = voiceId;
  await browser.storage.local.set({ settings });

  try {
    // Generate audio using non-streaming for simpler playback
    const base64Audio = await generateAudio(text);

    // Play directly in background script (options page doesn't have content script)
    await playAudioInBackground(base64Audio);
  } finally {
    // Restore original voice
    settings.voiceId = originalVoiceId;
    await browser.storage.local.set({ settings });
  }
}

// Play audio directly in background script (for testing)
function playAudioInBackground(base64Audio) {
  return new Promise((resolve, reject) => {
    try {
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes.buffer], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };

      audio.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(new Error('Audio playback failed'));
      };

      audio.play().catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

// Get current settings with validation
async function getSettings() {
  const result = await browser.storage.local.get('settings');
  const settings = { ...DEFAULT_SETTINGS, ...result.settings };

  // Clamp speed to valid range (ElevenLabs requires 0.7-1.2)
  settings.speed = Math.max(0.7, Math.min(1.2, settings.speed));

  // Clamp other values to valid ranges
  settings.stability = Math.max(0, Math.min(1, settings.stability));
  settings.similarityBoost = Math.max(0, Math.min(1, settings.similarityBoost));
  settings.style = Math.max(0, Math.min(1, settings.style));

  return settings;
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
