import io
import wave
from piper import PiperVoice

voice = None

def get_voice():
    global voice
    if voice is None:
        voice = PiperVoice.load("en_US-lessac-medium")
    return voice

def synthesize(text: str) -> bytes:
    """Synthesize text to audio bytes using Piper TTS."""
    piper = get_voice()

    audio_buffer = io.BytesIO()
    with wave.open(audio_buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(22050)
        piper.synthesize(text, wav_file)

    audio_buffer.seek(0)
    return audio_buffer.read()
