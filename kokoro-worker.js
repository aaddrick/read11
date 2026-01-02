// Read11 - Kokoro TTS Worker Script

let tts = null;
let isLoading = false;
let loadError = null;
let downloadProgress = 0;
let isFirstRun = false;

// Voice quality grades from kokoro-js documentation
const VOICE_INFO = {
  'af_heart': { name: 'Heart', gender: 'female', accent: 'American', grade: 'A' },
  'af_bella': { name: 'Bella', gender: 'female', accent: 'American', grade: 'A-' },
  'af_nicole': { name: 'Nicole', gender: 'female', accent: 'American', grade: 'B-' },
  'af_aoede': { name: 'Aoede', gender: 'female', accent: 'American', grade: 'B-' },
  'af_kore': { name: 'Kore', gender: 'female', accent: 'American', grade: 'B-' },
  'af_sarah': { name: 'Sarah', gender: 'female', accent: 'American', grade: 'B-' },
  'af_sky': { name: 'Sky', gender: 'female', accent: 'American', grade: 'B-' },
  'am_fenrir': { name: 'Fenrir', gender: 'male', accent: 'American', grade: 'C+' },
  'am_michael': { name: 'Michael', gender: 'male', accent: 'American', grade: 'C+' },
  'am_puck': { name: 'Puck', gender: 'male', accent: 'American', grade: 'C+' },
  'am_adam': { name: 'Adam', gender: 'male', accent: 'American', grade: 'C' },
  'bf_emma': { name: 'Emma', gender: 'female', accent: 'British', grade: 'B-' },
  'bf_isabella': { name: 'Isabella', gender: 'female', accent: 'British', grade: 'C' },
  'bm_george': { name: 'George', gender: 'male', accent: 'British', grade: 'C' },
  'bm_fable': { name: 'Fable', gender: 'male', accent: 'British', grade: 'C' },
  'bm_lewis': { name: 'Lewis', gender: 'male', accent: 'British', grade: 'C' }
};

const statusEl = document.getElementById('status');

// Notify background script of status changes
function notifyStatus(status, details = {}) {
  browser.runtime.sendMessage({
    action: 'kokoro-status-update',
    status,
    ...details
  }).catch(() => {});
}

async function initTTS() {
  if (tts || isLoading) return { ready: !!tts, loading: isLoading };

  isLoading = true;
  downloadProgress = 0;

  const startTime = Date.now();

  statusEl.textContent = 'Loading Kokoro model...';
  notifyStatus('loading', { message: 'Initializing Kokoro TTS...' });

  try {
    // Dynamic import from CDN
    const kokoroModule = await import('https://cdn.jsdelivr.net/npm/kokoro-js@1/+esm');
    const KokoroTTS = kokoroModule.KokoroTTS;
    // Make TextSplitterStream available globally for streaming
    window.TextSplitterStream = kokoroModule.TextSplitterStream;

    // Check for WebGPU support (much faster than WASM)
    let device = 'wasm';
    let dtype = 'q8'; // q8 often faster than q4 (less dequantization overhead)

    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          device = 'webgpu';
          dtype = 'fp32'; // WebGPU works best with fp32
          console.log('Read11: Using WebGPU backend (fast)');
        }
      } catch (e) {
        console.log('Read11: WebGPU not available, using WASM');
      }
    } else {
      console.log('Read11: WebGPU not supported, using WASM (WARNING: very slow, ~0.3 sec per character)');
    }

    statusEl.textContent = `Loading Kokoro (${device})...`;
    notifyStatus('loading', { message: `Loading Kokoro (${device})...` });

    tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
      dtype: dtype,
      device: device,
      progress_callback: (progress) => {
        if (progress.status === 'downloading') {
          isFirstRun = true;
          downloadProgress = Math.round((progress.loaded / progress.total) * 100) || 0;
          const msg = `Downloading model: ${downloadProgress}%`;
          statusEl.textContent = msg;
          notifyStatus('downloading', {
            message: msg,
            progress: downloadProgress,
            file: progress.file || 'model'
          });
        } else if (progress.status === 'loading') {
          statusEl.textContent = 'Loading model into memory...';
          notifyStatus('loading', { message: 'Loading model into memory...' });
        }
      }
    });

    const loadTime = Date.now() - startTime;
    isFirstRun = loadTime > 5000;

    statusEl.textContent = 'Kokoro TTS ready';
    notifyStatus('ready', {
      message: 'Kokoro TTS ready',
      wasFirstRun: isFirstRun,
      loadTimeMs: loadTime
    });

    console.log('Read11: Kokoro TTS initialized in', loadTime, 'ms');
    return { ready: true, wasFirstRun: isFirstRun };

  } catch (error) {
    loadError = error.message;
    statusEl.textContent = 'Failed to load: ' + error.message;
    notifyStatus('error', { message: error.message });
    console.error('Read11: Kokoro init error:', error);
    return { ready: false, error: loadError };
  } finally {
    isLoading = false;
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Listen for messages from background script
browser.runtime.onMessage.addListener((message, sender) => {
  return (async () => {
    console.log('Read11 Kokoro worker received:', message.action);

    if (message.action === 'kokoro-init') {
      const result = await initTTS();
      return {
        success: !loadError,
        error: loadError,
        ...result
      };
    }

    if (message.action === 'kokoro-status') {
      return {
        ready: !!tts,
        loading: isLoading,
        error: loadError,
        progress: downloadProgress
      };
    }

    if (message.action === 'kokoro-voices') {
      if (!tts) {
        await initTTS();
      }
      if (!tts) {
        return { error: loadError || 'TTS not initialized' };
      }

      const voiceIds = tts.list_voices();
      const voices = voiceIds.map(id => ({
        voice_id: id,
        ...VOICE_INFO[id] || { name: id, gender: 'unknown', accent: 'unknown', grade: '?' }
      }));
      return { voices };
    }

    if (message.action === 'kokoro-generate') {
      if (!tts) {
        const initResult = await initTTS();
        if (!initResult.ready) {
          return { error: loadError || 'TTS not initialized' };
        }
      }

      // Return immediately, send audio via separate message to avoid timeout
      const targetTabId = message.targetTabId;
      const textLength = message.text.length;
      const useStreaming = message.text.length > 100; // Stream for longer text

      (async () => {
        try {
          const genStartTime = Date.now();
          statusEl.textContent = 'Generating speech...';
          notifyStatus('generating', {
            message: `Generating (${textLength} chars)...`,
            stage: 'generating'
          });

          console.log(`Read11: Starting ${useStreaming ? 'streaming' : 'batch'} generation for ${textLength} chars`);

          if (useStreaming && TextSplitterStream) {
            // Streaming mode: send chunks as they're generated
            const splitter = new TextSplitterStream();
            const stream = tts.stream(splitter, { voice: message.voice || 'af_heart' });

            let chunkIndex = 0;
            let firstChunkTime = null;

            // Start consuming the stream
            const streamConsumer = (async () => {
              for await (const { text, audio } of stream) {
                const blob = audio.toBlob();
                const arrayBuffer = await blob.arrayBuffer();
                const base64 = arrayBufferToBase64(arrayBuffer);

                if (chunkIndex === 0) {
                  firstChunkTime = ((Date.now() - genStartTime) / 1000).toFixed(1);
                  console.log(`Read11: First chunk ready in ${firstChunkTime}s`);
                }

                browser.runtime.sendMessage({
                  action: 'kokoro-audio-chunk',
                  audioData: base64,
                  mimeType: 'audio/wav',
                  targetTabId: targetTabId,
                  chunkIndex: chunkIndex,
                  isFirst: chunkIndex === 0
                });

                chunkIndex++;
                statusEl.textContent = `Generating chunk ${chunkIndex}...`;
              }
            })();

            // Feed text to the splitter
            splitter.push(message.text);
            splitter.close();

            // Wait for stream to complete
            await streamConsumer;

            const genTime = ((Date.now() - genStartTime) / 1000).toFixed(1);
            console.log(`Read11: Streaming generation completed in ${genTime}s, ${chunkIndex} chunks`);

            // Signal end of stream
            browser.runtime.sendMessage({
              action: 'kokoro-audio-chunk',
              targetTabId: targetTabId,
              isFinal: true,
              genTimeSeconds: parseFloat(genTime),
              firstChunkSeconds: parseFloat(firstChunkTime)
            });

          } else {
            // Batch mode for short text
            const audio = await tts.generate(message.text, {
              voice: message.voice || 'af_heart'
            });

            const genTime = ((Date.now() - genStartTime) / 1000).toFixed(1);
            console.log(`Read11: Batch generation completed in ${genTime}s for ${textLength} chars`);

            const blob = audio.toBlob();
            const arrayBuffer = await blob.arrayBuffer();
            const base64 = arrayBufferToBase64(arrayBuffer);

            browser.runtime.sendMessage({
              action: 'kokoro-audio-ready',
              audioData: base64,
              mimeType: 'audio/wav',
              targetTabId: targetTabId,
              genTimeSeconds: parseFloat(genTime)
            });
          }

          statusEl.textContent = 'Kokoro TTS ready';
          notifyStatus('ready', { message: 'Generation complete', stage: 'ready' });

        } catch (error) {
          statusEl.textContent = 'Generation failed: ' + error.message;
          notifyStatus('error', { message: error.message, stage: 'error' });
          console.error('Read11: Kokoro generate error:', error);

          browser.runtime.sendMessage({
            action: 'kokoro-audio-error',
            error: error.message,
            targetTabId: targetTabId
          });
        }
      })();

      return { success: true, pending: true };
    }

    return { error: 'Unknown action' };
  })();
});

// Auto-initialize on load
initTTS();
