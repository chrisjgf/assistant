import os
import google.generativeai as genai

model = None
chat = None

def init_gemini():
    global model, chat
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable not set")

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-1.5-flash")
    chat = model.start_chat(history=[])

def get_response(user_message: str) -> str:
    """Get a response from Gemini for the user message."""
    global chat
    if chat is None:
        init_gemini()

    response = chat.send_message(user_message)
    return response.text

def reset_chat():
    """Reset the chat history."""
    global chat
    if model is not None:
        chat = model.start_chat(history=[])
