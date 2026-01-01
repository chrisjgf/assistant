import io
from faster_whisper import WhisperModel

model = None

def get_model():
    global model
    if model is None:
        model = WhisperModel("base", device="cpu", compute_type="int8")
    return model

def transcribe(audio_bytes: bytes) -> str:
    """Transcribe audio bytes to text using faster-whisper."""
    whisper = get_model()
    audio_file = io.BytesIO(audio_bytes)
    segments, _ = whisper.transcribe(audio_file, language="en")
    text = " ".join(segment.text for segment in segments)
    return text.strip()
