// Read11 - Options Script

const DEFAULT_SETTINGS = {
  apiKey: '',
  voiceId: 'EXAVITQu4vr4xnSDxMaL',
  kokoroVoiceId: 'af_heart',
  modelId: 'eleven_multilingual_v2',
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  speed: 1.0,
  autoRead: false,
  autoReadDelay: 1000,
  ttsEngine: 'auto'
};

// Popular ElevenLabs voices with natural conversational style
const POPULAR_VOICES = [
  { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah (Recommended)', description: 'Soft, warm, conversational' },
  { voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', description: 'Calm, professional' },
  { voice_id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', description: 'Confident, engaging' },
  { voice_id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', description: 'Friendly, clear' },
  { voice_id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', description: 'Deep, narrative' },
  { voice_id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', description: 'Clear, authoritative' },
  { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', description: 'Deep, articulate' },
  { voice_id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', description: 'Dynamic, engaging' }
];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadSettings();
  setupEventListeners();
  setupTabs();
  await loadVoices();
  loadBrowserVoices();
  await updateEngineStatus();
}

function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active from all
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      // Add active to clicked
      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      document.getElementById(`tab-${tabId}`).classList.add('active');
    });
  });
}

async function loadSettings() {
  const result = await browser.storage.local.get('settings');
  const settings = { ...DEFAULT_SETTINGS, ...result.settings };

  // Clamp values to valid ranges
  settings.speed = Math.max(0.7, Math.min(1.2, settings.speed));
  settings.stability = Math.max(0, Math.min(1, settings.stability));
  settings.similarityBoost = Math.max(0, Math.min(1, settings.similarityBoost));
  settings.style = Math.max(0, Math.min(1, settings.style));

  // Populate form
  document.getElementById('api-key').value = settings.apiKey;
  document.getElementById('model-select').value = settings.modelId;
  document.getElementById('stability').value = settings.stability;
  document.getElementById('similarity').value = settings.similarityBoost;
  document.getElementById('style').value = settings.style;
  document.getElementById('speed').value = settings.speed;
  document.getElementById('auto-read').checked = settings.autoRead;
  document.getElementById('auto-read-delay').value = settings.autoReadDelay;
  document.getElementById('tts-engine').value = settings.ttsEngine || 'auto';
  document.getElementById('kokoro-voice-select').value = settings.kokoroVoiceId || 'af_heart';
  document.getElementById('browser-voice-select').value = settings.browserVoiceName || '';

  // Update display values
  updateSliderDisplays();
}

function setupEventListeners() {
  // Form submission
  document.getElementById('settings-form').addEventListener('submit', saveSettings);

  // Reset to defaults
  document.getElementById('reset-defaults').addEventListener('click', resetDefaults);

  // Toggle API key visibility
  document.getElementById('toggle-api-key').addEventListener('click', toggleApiKeyVisibility);

  // Refresh voices
  document.getElementById('refresh-voices').addEventListener('click', loadVoices);
  document.getElementById('refresh-kokoro-voices').addEventListener('click', loadKokoroVoices);

  // Test voices
  document.getElementById('test-voice').addEventListener('click', testVoice);
  document.getElementById('test-kokoro-voice').addEventListener('click', testKokoroVoice);
  document.getElementById('test-browser-voice').addEventListener('click', testBrowserVoice);

  // Engine change
  document.getElementById('tts-engine').addEventListener('change', updateEngineStatus);

  // Slider value updates
  const sliders = ['stability', 'similarity', 'style', 'speed', 'auto-read-delay'];
  sliders.forEach(id => {
    document.getElementById(id).addEventListener('input', updateSliderDisplays);
  });
}

function updateSliderDisplays() {
  document.getElementById('stability-value').textContent =
    parseFloat(document.getElementById('stability').value).toFixed(2);
  document.getElementById('similarity-value').textContent =
    parseFloat(document.getElementById('similarity').value).toFixed(2);
  document.getElementById('style-value').textContent =
    parseFloat(document.getElementById('style').value).toFixed(2);
  document.getElementById('speed-value').textContent =
    parseFloat(document.getElementById('speed').value).toFixed(2);
  document.getElementById('delay-value').textContent =
    document.getElementById('auto-read-delay').value;
}

async function updateEngineStatus() {
  const engine = document.getElementById('tts-engine').value;
  const apiKey = document.getElementById('api-key').value;
  const statusEl = document.getElementById('engine-status');

  let statusText = '';
  if (engine === 'auto') {
    if (apiKey) {
      statusText = 'Currently using: ElevenLabs (API key detected)';
    } else {
      statusText = 'Currently using: Browser TTS (instant, free)';
    }
  } else if (engine === 'elevenlabs') {
    if (apiKey) {
      statusText = 'ElevenLabs active';
    } else {
      statusText = '⚠️ No API key set - will fall back to Browser TTS';
    }
  } else if (engine === 'browser') {
    statusText = 'Browser TTS active (instant, free)';
  } else if (engine === 'kokoro') {
    statusText = '⚠️ Kokoro active - slow without WebGPU (~60s for 200 chars)';
  }

  statusEl.textContent = statusText;
}

async function loadVoices() {
  const voiceSelect = document.getElementById('voice-select');
  const apiKey = document.getElementById('api-key').value;

  // Start with popular voices
  voiceSelect.innerHTML = '<optgroup label="Popular Voices">' +
    POPULAR_VOICES.map(v =>
      `<option value="${v.voice_id}">${v.name} - ${v.description}</option>`
    ).join('') +
    '</optgroup>';

  // If we have an API key, try to fetch user's voices
  if (apiKey) {
    try {
      const voices = await browser.runtime.sendMessage({ action: 'getVoices' });
      if (voices && voices.length > 0) {
        const customVoices = voices.filter(v =>
          !POPULAR_VOICES.find(p => p.voice_id === v.voice_id)
        );

        if (customVoices.length > 0) {
          const customGroup = document.createElement('optgroup');
          customGroup.label = 'Your Voices';
          customVoices.forEach(v => {
            const option = document.createElement('option');
            option.value = v.voice_id;
            option.textContent = v.name;
            customGroup.appendChild(option);
          });
          voiceSelect.appendChild(customGroup);
        }
      }
    } catch (error) {
      console.log('Could not fetch custom voices:', error);
    }
  }

  // Set current value
  const result = await browser.storage.local.get('settings');
  if (result.settings?.voiceId) {
    voiceSelect.value = result.settings.voiceId;
  }
}

async function loadKokoroVoices() {
  const voiceSelect = document.getElementById('kokoro-voice-select');
  const statusEl = document.getElementById('kokoro-model-status');

  try {
    statusEl.innerHTML = '<span class="status-indicator status-loading"></span><span class="status-label">Loading voices...</span>';

    const voices = await browser.runtime.sendMessage({ action: 'getKokoroVoices' });

    if (voices && voices.length > 0) {
      voiceSelect.innerHTML = voices.map(v =>
        `<option value="${v.voice_id}">${v.name} (${v.gender}, ${v.accent}, Grade ${v.grade})</option>`
      ).join('');

      statusEl.innerHTML = '<span class="status-indicator status-ready"></span><span class="status-label">Model ready</span>';
    }

    // Set current value
    const result = await browser.storage.local.get('settings');
    if (result.settings?.kokoroVoiceId) {
      voiceSelect.value = result.settings.kokoroVoiceId;
    }
  } catch (error) {
    console.error('Could not fetch Kokoro voices:', error);
    statusEl.innerHTML = `<span class="status-indicator status-error"></span><span class="status-label">Error: ${error.message}</span>`;
  }
}

async function saveSettings(e) {
  e.preventDefault();

  const settings = {
    apiKey: document.getElementById('api-key').value,
    voiceId: document.getElementById('voice-select').value,
    kokoroVoiceId: document.getElementById('kokoro-voice-select').value,
    browserVoiceName: document.getElementById('browser-voice-select').value,
    modelId: document.getElementById('model-select').value,
    stability: parseFloat(document.getElementById('stability').value),
    similarityBoost: parseFloat(document.getElementById('similarity').value),
    style: parseFloat(document.getElementById('style').value),
    speed: parseFloat(document.getElementById('speed').value),
    autoRead: document.getElementById('auto-read').checked,
    autoReadDelay: parseInt(document.getElementById('auto-read-delay').value),
    ttsEngine: document.getElementById('tts-engine').value
  };

  await browser.storage.local.set({ settings });

  // Notify background script of auto-read change
  await browser.runtime.sendMessage({
    action: 'setAutoRead',
    enabled: settings.autoRead
  });

  showNotification('Settings saved successfully!', 'success');

  // Update engine status display
  await updateEngineStatus();

  // Reload voices in case API key changed
  if (settings.apiKey) {
    await loadVoices();
  }
}

async function resetDefaults() {
  if (confirm('Reset all settings to defaults? Your API key will be preserved.')) {
    const result = await browser.storage.local.get('settings');
    const apiKey = result.settings?.apiKey || '';

    const settings = { ...DEFAULT_SETTINGS, apiKey };
    await browser.storage.local.set({ settings });
    await loadSettings();
    await updateEngineStatus();
    showNotification('Settings reset to defaults', 'info');
  }
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('api-key');
  const btn = document.getElementById('toggle-api-key');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🔒';
  } else {
    input.type = 'password';
    btn.textContent = '👁';
  }
}

async function testVoice() {
  const apiKey = document.getElementById('api-key').value;
  if (!apiKey) {
    showNotification('Please enter your API key first', 'error');
    return;
  }

  // Save current settings first
  await saveSettings(new Event('submit'));

  showNotification('Testing ElevenLabs voice...', 'info');

  try {
    await browser.runtime.sendMessage({
      action: 'testVoice',
      voiceId: document.getElementById('voice-select').value,
      text: 'Hello! This is a test of the Read11 screen reader with your selected voice settings.'
    });
  } catch (error) {
    showNotification('Error testing voice: ' + error.message, 'error');
  }
}

async function testKokoroVoice() {
  const statusEl = document.getElementById('kokoro-test-status');
  const btn = document.getElementById('test-kokoro-voice');

  btn.disabled = true;
  statusEl.textContent = 'Initializing...';
  statusEl.className = 'status-text status-loading';

  try {
    // Save settings first so voice selection is applied
    await saveSettings(new Event('submit'));

    statusEl.textContent = 'Generating speech...';

    await browser.runtime.sendMessage({
      action: 'testKokoroVoice',
      voiceId: document.getElementById('kokoro-voice-select').value,
      text: 'Hello! This is a test of the Read11 screen reader with Kokoro offline voice.'
    });

    statusEl.textContent = 'Playing...';
    statusEl.className = 'status-text status-success';

    // Clear status after a delay
    setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);

  } catch (error) {
    statusEl.textContent = 'Error: ' + error.message;
    statusEl.className = 'status-text status-error';
  } finally {
    btn.disabled = false;
  }
}

function loadBrowserVoices() {
  const voiceSelect = document.getElementById('browser-voice-select');

  const populateVoices = () => {
    const voices = speechSynthesis.getVoices();
    voiceSelect.innerHTML = '<option value="">System Default</option>';

    voices.forEach(voice => {
      const option = document.createElement('option');
      option.value = voice.name;
      option.textContent = `${voice.name} (${voice.lang})`;
      voiceSelect.appendChild(option);
    });

    // Restore saved value
    browser.storage.local.get('settings').then(result => {
      if (result.settings?.browserVoiceName) {
        voiceSelect.value = result.settings.browserVoiceName;
      }
    });
  };

  // Voices may load async
  if (speechSynthesis.getVoices().length > 0) {
    populateVoices();
  }
  speechSynthesis.onvoiceschanged = populateVoices;
}

function testBrowserVoice() {
  const voiceName = document.getElementById('browser-voice-select').value;
  const rate = parseFloat(document.getElementById('speed').value) || 1.0;

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(
    'Hello! This is a test of the browser text to speech with your selected voice.'
  );
  utterance.rate = rate;

  if (voiceName) {
    const voices = speechSynthesis.getVoices();
    const voice = voices.find(v => v.name === voiceName);
    if (voice) {
      utterance.voice = voice;
    }
  }

  speechSynthesis.speak(utterance);
  showNotification('Testing browser voice...', 'info');
}

function showNotification(message, type = 'info') {
  const notification = document.getElementById('notification');
  notification.textContent = message;
  notification.className = `notification notification-${type} notification-visible`;

  setTimeout(() => {
    notification.classList.remove('notification-visible');
  }, 3000);
}
