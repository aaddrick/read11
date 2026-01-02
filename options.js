// Read11 - Options Script

const DEFAULT_SETTINGS = {
  apiKey: '',
  voiceId: 'EXAVITQu4vr4xnSDxMaL',
  modelId: 'eleven_multilingual_v2',
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  speed: 1.0,
  autoRead: false,
  autoReadDelay: 1000
};

// Popular voices with natural conversational style
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
  await loadVoices();
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

  // Test voice
  document.getElementById('test-voice').addEventListener('click', testVoice);

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

async function saveSettings(e) {
  e.preventDefault();

  const settings = {
    apiKey: document.getElementById('api-key').value,
    voiceId: document.getElementById('voice-select').value,
    modelId: document.getElementById('model-select').value,
    stability: parseFloat(document.getElementById('stability').value),
    similarityBoost: parseFloat(document.getElementById('similarity').value),
    style: parseFloat(document.getElementById('style').value),
    speed: parseFloat(document.getElementById('speed').value),
    autoRead: document.getElementById('auto-read').checked,
    autoReadDelay: parseInt(document.getElementById('auto-read-delay').value)
  };

  await browser.storage.local.set({ settings });

  // Notify background script of auto-read change
  await browser.runtime.sendMessage({
    action: 'setAutoRead',
    enabled: settings.autoRead
  });

  showNotification('Settings saved successfully!', 'success');

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

  showNotification('Testing voice...', 'info');

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

function showNotification(message, type = 'info') {
  const notification = document.getElementById('notification');
  notification.textContent = message;
  notification.className = `notification notification-${type} notification-visible`;

  setTimeout(() => {
    notification.classList.remove('notification-visible');
  }, 3000);
}
