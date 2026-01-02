# Read11 - ElevenLabs Screen Reader

A Firefox extension that uses ElevenLabs' natural text-to-speech to read web content aloud, helping you focus while learning.

## Features

- **Read Selected Text**: Highlight any text and press `Alt+R` or right-click to have it read aloud
- **Auto-Read Pages**: Automatically read the main content when you navigate to a page
- **Natural Voices**: Uses ElevenLabs' high-quality AI voices for natural-sounding speech
- **Customizable**: Adjust voice, speed, stability, and more in settings

## Installation

### From Source (Development)

1. Clone this repository
2. Open Firefox and navigate to `about:debugging`
3. Click "This Firefox" in the left sidebar
4. Click "Load Temporary Add-on"
5. Navigate to the extension folder and select `manifest.json`

### Configuration

1. Click the Read11 icon in your toolbar
2. Click "Settings" at the bottom
3. Enter your ElevenLabs API key (get one at [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys))
4. Choose your preferred voice and adjust settings

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+R` | Read selected text |
| `Alt+S` | Stop reading |
| `Alt+A` | Toggle auto-read mode |

## Usage Tips

- For Google Skills certifications, enable auto-read to have content read as you navigate
- Select specific paragraphs with `Alt+R` when you want to focus on particular sections
- Adjust the speed setting if the default pace is too fast or slow
- Use the stability slider to find the right balance between consistency and expressiveness

## API Usage

This extension uses the ElevenLabs Text-to-Speech API. Usage counts against your ElevenLabs quota. The extension uses efficient settings by default to minimize character usage.

## Privacy

- Your API key is stored locally in browser storage
- Text is sent to ElevenLabs API for conversion (subject to their privacy policy)
- No data is collected or stored by this extension beyond local settings

## License

MIT License
