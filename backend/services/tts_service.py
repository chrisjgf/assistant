import io
import wave
import urllib.request
from pathlib import Path

voice = None
piper_available = False
MODEL_DIR = Path(__file__).parent.parent / "models"
MODEL_NAME = "en_US-hfc_female-medium"

try:
    from piper import PiperVoice
    piper_available = True
except ImportError:
    print("Warning: piper-tts not installed. TTS will not be available.")
    print("Install with: pip install piper-tts")

def download_model():
    """Download the Piper voice model if not present."""
    MODEL_DIR.mkdir(exist_ok=True)

    model_path = MODEL_DIR / f"{MODEL_NAME}.onnx"
    config_path = MODEL_DIR / f"{MODEL_NAME}.onnx.json"

    if model_path.exists() and config_path.exists():
        return str(model_path)

    base_url = f"https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/"

    print(f"Downloading Piper voice model to {MODEL_DIR}...")

    if not model_path.exists():
        print(f"  Downloading {MODEL_NAME}.onnx...")
        urllib.request.urlretrieve(f"{base_url}{MODEL_NAME}.onnx", model_path)

    if not config_path.exists():
        print(f"  Downloading {MODEL_NAME}.onnx.json...")
        urllib.request.urlretrieve(f"{base_url}{MODEL_NAME}.onnx.json", config_path)

    print("Download complete!")
    return str(model_path)

def get_voice():
    global voice
    if not piper_available:
        return None
    if voice is None:
        model_path = download_model()
        voice = PiperVoice.load(model_path)
    return voice

def synthesize(text: str) -> bytes:
    """Synthesize text to audio bytes using Piper TTS."""
    piper = get_voice()

    if piper is None:
        raise RuntimeError("Piper TTS not available. Install with: pip install piper-tts")

    # Collect all audio chunks
    audio_data = []
    sample_rate = None

    for chunk in piper.synthesize(text):
        audio_data.append(chunk.audio_int16_bytes)
        if sample_rate is None:
            sample_rate = chunk.sample_rate

    if not audio_data:
        raise RuntimeError("Piper produced no audio output")

    all_audio = b''.join(audio_data)
    print(f"Synthesized {len(all_audio)} bytes of audio at {sample_rate}Hz")

    # Create WAV file
    audio_buffer = io.BytesIO()
    with wave.open(audio_buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate or 22050)
        wav_file.writeframes(all_audio)

    audio_buffer.seek(0)
    return audio_buffer.read()

def is_available() -> bool:
    return piper_available
