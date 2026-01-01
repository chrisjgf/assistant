import io
from faster_whisper import WhisperModel

model = None

def get_model():
    global model
    if model is None:
        print("Loading Whisper large-v3 on CUDA with float16...")
        model = WhisperModel("large-v3", device="cuda", compute_type="float16")
        print("Whisper model loaded successfully")
    return model

def transcribe(audio_bytes: bytes) -> str:
    """Transcribe audio bytes to text using faster-whisper."""
    whisper = get_model()
    audio_file = io.BytesIO(audio_bytes)

    # Initial prompt helps with domain-specific words
    initial_prompt = "Claude, Gemini, switch to Claude, switch to Gemini, accept, cancel, save chat"

    segments, _ = whisper.transcribe(
        audio_file,
        language="en",
        initial_prompt=initial_prompt,
        vad_filter=True,  # Filter out non-speech
    )
    text = " ".join(segment.text for segment in segments)
    return text.strip()
