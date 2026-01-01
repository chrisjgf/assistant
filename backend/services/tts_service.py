import io
import re
import wave
import threading
from pathlib import Path
from typing import Optional, List

import numpy as np
import torch

_model = None
_model_lock = threading.Lock()
_chatterbox_available = False

# Reference voice for cloning
SAMPLE_DIR = Path(__file__).parent.parent / "sample"
REFERENCE_VOICE = SAMPLE_DIR / "reference_voice.wav"

try:
    from chatterbox.tts import ChatterboxTTS
    _chatterbox_available = True
except ImportError:
    print("Warning: chatterbox-tts not installed. TTS will not be available.")
    print("Install with: pip install chatterbox-tts torchaudio")

def _get_device() -> str:
    """Determine the best available device for inference."""
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def get_model() -> Optional["ChatterboxTTS"]:
    """Lazy-load the Chatterbox TTS model."""
    global _model

    if not _chatterbox_available:
        return None

    if _model is None:
        device = _get_device()
        print(f"Loading Chatterbox TTS on {device}...")
        try:
            _model = ChatterboxTTS.from_pretrained(device=device)
        except RuntimeError as e:
            if "CUDA" in str(e) or "out of memory" in str(e):
                print(f"CUDA error: {e}. Falling back to CPU...")
                _model = ChatterboxTTS.from_pretrained(device="cpu")
            else:
                raise
        print("Chatterbox TTS loaded successfully")

    return _model


def synthesize(text: str) -> bytes:
    """Synthesize text to audio bytes using Chatterbox TTS."""
    if not text or not text.strip():
        raise ValueError("Cannot synthesize empty text")

    model = get_model()

    if model is None:
        raise RuntimeError(
            "Chatterbox TTS not available. "
            "Install with: pip install chatterbox-tts torchaudio"
        )

    # Use lock for thread safety during generation
    with _model_lock:
        # Generate audio with voice cloning
        if REFERENCE_VOICE.exists():
            wav_tensor = model.generate(text, audio_prompt_path=str(REFERENCE_VOICE))
        else:
            wav_tensor = model.generate(text)

    # Convert tensor to numpy
    if wav_tensor.dim() == 1:
        wav_tensor = wav_tensor.unsqueeze(0)

    audio_np = wav_tensor.cpu().numpy().squeeze()

    # Normalize to [-1, 1] range if needed
    max_val = max(abs(audio_np.max()), abs(audio_np.min()))
    if max_val > 1.0:
        audio_np = audio_np / max_val

    # Convert to 16-bit PCM
    audio_int16 = (audio_np * 32767).astype(np.int16)

    # Get sample rate from model
    sample_rate = model.sr

    # Create WAV file in memory
    audio_buffer = io.BytesIO()
    with wave.open(audio_buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(audio_int16.tobytes())

    audio_buffer.seek(0)
    wav_bytes = audio_buffer.read()

    print(f"Synthesized {len(wav_bytes)} bytes at {sample_rate}Hz")
    return wav_bytes


def is_available() -> bool:
    """Check if TTS is available."""
    return _chatterbox_available


def split_into_sentences(text: str) -> List[str]:
    """Split text into sentences for chunked TTS."""
    # Split on sentence boundaries
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())

    # Filter empty and merge very short sentences
    result = []
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        # Merge short sentences with previous
        if result and len(result[-1]) < 20:
            result[-1] += " " + s
        else:
            result.append(s)

    return result if result else [text]
