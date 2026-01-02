// Read11 - AI Screen Reader Background Script

const API_BASE = 'https://api.elevenlabs.io/v1';

// Default settings
const DEFAULT_SETTINGS = {
  apiKey: '',
  voiceId: 'EXAVITQu4vr4xnSDxMaL', // "Sarah" - natural conversational voice (ElevenLabs)
  kokoroVoiceId: 'af_heart', // "Heart" - highest quality Kokoro voice
  modelId: 'eleven_multilingual_v2',
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  speed: 1.0,
  autoRead: false,
  autoReadDelay: 1000,
  ttsEngine: 'auto', // 'auto', 'elevenlabs', 'kokoro', 'browser'
  browserVoiceName: '' // Browser speechSynthesis voice name
};

// State
let isPlaying = false;
let kokoroTabId = null;
let kokoroReady = false;
let kokoroInitializing = false;

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

  // Pre-initialize Kokoro in background (non-blocking)
  setTimeout(() => {
    initKokoroWorker().then(ready => {
      if (ready) console.log('Read11: Kokoro pre-initialized');
    }).catch(() => {});
  }, 2000);
});

// Handle context menu clicks
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'read-selection' && info.selectionText) {
    try {
      // Show loading state first
      if (tab?.id) {
        browser.tabs.sendMessage(tab.id, { action: 'startLoading' }).catch(() => {});
      }
      // Use unified generator (routes to appropriate engine)
      await generateAudio_Unified(info.selectionText, tab?.id);
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
          // Use unified generator (routes to appropriate engine)
          await generateAudio_Unified(message.text, sender.tab?.id);
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
        case 'getKokoroVoices':
          const kokoroVoices = await fetchKokoroVoices();
          sendResponse(kokoroVoices);
          break;
        case 'getTTSEngine':
          const currentEngine = await getTTSEngine();
          sendResponse({ engine: currentEngine });
          break;
        case 'testVoice':
          await testVoice(message.voiceId, message.text);
          sendResponse({ success: true });
          break;
        case 'testKokoroVoice':
          await testKokoroVoice(message.voiceId, message.text);
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
function playAudioInBackground(base64Audio, mimeType = 'audio/mpeg') {
  return new Promise((resolve, reject) => {
    try {
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes.buffer], { type: mimeType });
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

  // Ensure ttsEngine has a valid value
  if (!['auto', 'elevenlabs', 'kokoro'].includes(settings.ttsEngine)) {
    settings.ttsEngine = 'auto';
  }

  // Ensure kokoroVoiceId has a default
  if (!settings.kokoroVoiceId) {
    settings.kokoroVoiceId = 'af_heart';
  }

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

// ========================================
// Kokoro TTS Integration
// ========================================

// Initialize Kokoro worker tab
async function initKokoroWorker() {
  if (kokoroInitializing) {
    // Wait for existing init
    while (kokoroInitializing) {
      await new Promise(r => setTimeout(r, 100));
    }
    return kokoroReady;
  }

  if (kokoroReady && kokoroTabId) {
    // Check if tab still exists
    try {
      await browser.tabs.get(kokoroTabId);
      return true;
    } catch (e) {
      kokoroReady = false;
      kokoroTabId = null;
    }
  }

  kokoroInitializing = true;

  try {
    // Create hidden tab for Kokoro worker
    const tab = await browser.tabs.create({
      url: browser.runtime.getURL('kokoro-worker.html'),
      active: false
    });
    kokoroTabId = tab.id;

    // Wait for the worker to initialize
    let attempts = 0;
    const maxAttempts = 300; // 30 seconds max (for first download)

    while (attempts < maxAttempts) {
      try {
        const status = await browser.tabs.sendMessage(kokoroTabId, { action: 'kokoro-status' });
        if (status.ready) {
          kokoroReady = true;
          console.log('Read11: Kokoro worker ready');
          return true;
        }
        if (status.error) {
          console.error('Read11: Kokoro init error:', status.error);
          return false;
        }
      } catch (e) {
        // Tab not ready yet
      }
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    console.error('Read11: Kokoro worker timeout');
    return false;

  } catch (error) {
    console.error('Read11: Failed to create Kokoro worker:', error);
    return false;
  } finally {
    kokoroInitializing = false;
  }
}

// Generate audio using Kokoro
async function generateAudioKokoro(text, tabId) {
  if (!text || text.trim().length === 0) {
    throw new Error('No text provided');
  }

  // Limit text length for Kokoro (WASM is VERY slow - ~0.3s per char)
  // 200 chars ≈ 60 seconds generation time on WASM
  const maxLength = 200;
  if (text.length > maxLength) {
    // Try to cut at sentence boundary
    let cutText = text.substring(0, maxLength);
    const lastPeriod = cutText.lastIndexOf('.');
    const lastQuestion = cutText.lastIndexOf('?');
    const lastExclaim = cutText.lastIndexOf('!');
    const lastSentence = Math.max(lastPeriod, lastQuestion, lastExclaim);

    if (lastSentence > maxLength * 0.5) {
      cutText = text.substring(0, lastSentence + 1);
    }

    text = cutText;
    console.log('Read11: Trimmed text to', text.length, 'chars for Kokoro');

    // Notify user
    if (tabId) {
      browser.tabs.sendMessage(tabId, {
        action: 'updateLoadingStatus',
        message: 'Text trimmed (offline mode limit)...',
        isDownloading: false
      }).catch(() => {});
    }
  }

  // Estimate generation time for user feedback
  const estimatedSeconds = Math.round(text.length * 0.3);
  if (tabId) {
    browser.tabs.sendMessage(tabId, {
      action: 'updateLoadingStatus',
      message: `Generating (~${estimatedSeconds}s for ${text.length} chars)...`,
      stage: 'generating'
    }).catch(() => {});
  }

  const settings = await getSettings();

  // Ensure worker is ready
  if (!kokoroReady) {
    // Notify tab about initialization
    if (tabId) {
      browser.tabs.sendMessage(tabId, {
        action: 'updateLoadingStatus',
        message: 'Initializing Kokoro TTS...',
        isDownloading: true
      }).catch(() => {});
    }

    const ready = await initKokoroWorker();
    if (!ready) {
      throw new Error('Kokoro TTS failed to initialize');
    }
  }

  // Request audio generation (async - response comes via separate message)
  const result = await browser.tabs.sendMessage(kokoroTabId, {
    action: 'kokoro-generate',
    text: text,
    voice: settings.kokoroVoiceId || 'af_heart',
    targetTabId: tabId
  });

  if (result.error) {
    throw new Error(result.error);
  }

  console.log('Read11: Kokoro generation started');
  // Audio will be delivered via 'kokoro-audio-ready' message
}

// Determine which TTS engine to use
async function getTTSEngine() {
  const settings = await getSettings();

  if (settings.ttsEngine === 'elevenlabs') {
    if (!settings.apiKey) {
      console.log('Read11: ElevenLabs selected but no API key, falling back to browser');
      return 'browser';
    }
    return 'elevenlabs';
  }

  if (settings.ttsEngine === 'kokoro') {
    return 'kokoro';
  }

  if (settings.ttsEngine === 'browser') {
    return 'browser';
  }

  // Auto mode: use ElevenLabs if API key exists, otherwise browser (fast) instead of Kokoro (slow)
  if (settings.apiKey) {
    return 'elevenlabs';
  }

  // Default to browser TTS - it's instant and always works
  return 'browser';
}

// Unified generate function that routes to appropriate engine
async function generateAudio_Unified(text, tabId) {
  const engine = await getTTSEngine();
  console.log('Read11: Using TTS engine:', engine);

  // Notify content script which engine is being used
  if (tabId) {
    browser.tabs.sendMessage(tabId, {
      action: 'engineSelected',
      engine: engine
    }).catch(() => {});
  }

  if (engine === 'browser') {
    return generateBrowserTTS(text, tabId);
  }

  if (engine === 'kokoro') {
    return generateAudioKokoro(text, tabId);
  }

  // ElevenLabs - with fallback to browser TTS on error
  try {
    return await generateAudioStreaming(text, tabId);
  } catch (error) {
    console.log('Read11: ElevenLabs failed, falling back to browser TTS:', error.message);

    // Notify user of fallback
    if (tabId) {
      browser.tabs.sendMessage(tabId, {
        action: 'engineSelected',
        engine: 'browser'
      }).catch(() => {});
    }

    return generateBrowserTTS(text, tabId);
  }
}

// Generate using browser's built-in speechSynthesis (runs in content script)
async function generateBrowserTTS(text, tabId) {
  if (!text || text.trim().length === 0) {
    throw new Error('No text provided');
  }

  const settings = await getSettings();

  console.log('Read11: Using browser speechSynthesis');

  if (tabId) {
    browser.tabs.sendMessage(tabId, {
      action: 'speakWithBrowser',
      text: text,
      voiceName: settings.browserVoiceName || '',
      rate: settings.speed || 1.0
    }).catch(() => {});
  }
}

// Get Kokoro voices
async function fetchKokoroVoices() {
  if (!kokoroReady) {
    const ready = await initKokoroWorker();
    if (!ready) {
      throw new Error('Kokoro TTS not available');
    }
  }

  const result = await browser.tabs.sendMessage(kokoroTabId, { action: 'kokoro-voices' });
  if (result.error) {
    throw new Error(result.error);
  }
  return result.voices;
}

// Test a Kokoro voice
async function testKokoroVoice(voiceId, text = 'Hello, this is a test of the Read11 screen reader with Kokoro.') {
  if (!kokoroReady) {
    const ready = await initKokoroWorker();
    if (!ready) {
      throw new Error('Kokoro TTS not available');
    }
  }

  const result = await browser.tabs.sendMessage(kokoroTabId, {
    action: 'kokoro-generate',
    text: text,
    voice: voiceId
  });

  if (result.error) {
    throw new Error(result.error);
  }

  // Play directly in background script
  await playAudioInBackground(result.audioData, result.mimeType);
}

// Handle Kokoro messages from worker
browser.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'kokoro-status-update') {
    console.log('Read11: Kokoro status:', message.status, message.message);

    // Forward to all tabs for UI updates
    if (['downloading', 'loading', 'generating'].includes(message.status)) {
      browser.tabs.query({}).then(tabs => {
        for (const tab of tabs) {
          browser.tabs.sendMessage(tab.id, {
            action: 'updateLoadingStatus',
            message: message.message,
            progress: message.progress,
            stage: message.stage || message.status,
            isDownloading: message.status === 'downloading'
          }).catch(() => {});
        }
      });
    }
  }

  // Handle completed audio from Kokoro worker
  if (message.action === 'kokoro-audio-ready') {
    console.log('Read11: Kokoro audio ready, sending to tab:', message.targetTabId,
      `(generated in ${message.genTimeSeconds}s)`);

    if (message.targetTabId) {
      browser.tabs.sendMessage(message.targetTabId, {
        action: 'playAudio',
        audioData: message.audioData,
        mimeType: message.mimeType,
        engine: 'kokoro'
      }).catch((err) => {
        console.error('Read11: Failed to send audio to tab:', err);
      });
    }
  }

  // Handle streaming audio chunks from Kokoro worker
  if (message.action === 'kokoro-audio-chunk') {
    if (message.isFinal) {
      console.log(`Read11: Kokoro streaming complete. First chunk: ${message.firstChunkSeconds}s, Total: ${message.genTimeSeconds}s`);

      if (message.targetTabId) {
        browser.tabs.sendMessage(message.targetTabId, {
          action: 'streamEnd',
          engine: 'kokoro'
        }).catch(() => {});
      }
    } else {
      console.log(`Read11: Kokoro chunk ${message.chunkIndex} ready`);

      if (message.targetTabId) {
        browser.tabs.sendMessage(message.targetTabId, {
          action: 'playAudioChunk',
          audioData: message.audioData,
          mimeType: message.mimeType,
          isFirst: message.isFirst,
          chunkIndex: message.chunkIndex,
          engine: 'kokoro'
        }).catch((err) => {
          console.error('Read11: Failed to send chunk to tab:', err);
        });
      }
    }
  }

  // Handle Kokoro generation error
  if (message.action === 'kokoro-audio-error') {
    console.error('Read11: Kokoro generation error:', message.error);

    if (message.targetTabId) {
      browser.tabs.sendMessage(message.targetTabId, {
        action: 'error',
        message: 'Kokoro TTS error: ' + message.error
      }).catch(() => {});
    }
  }
});
