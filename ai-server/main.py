import os
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI

app = FastAPI(title="Audio Processing AI Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    if not file.filename.endswith(('.mp3', '.wav', '.m4a', '.webm', '.ogg')):
        raise HTTPException(status_code=400, detail="Invalid file type. Send mp3, wav, m4a, webm, or ogg.")

    try:
        audio_bytes = await file.read()
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=(file.filename, audio_bytes),
            language="ko",
            prompt="한 사람의 한국어 이름 하나만 말합니다. 이름 외의 다른 말은 없습니다."
        )
        return {"status": "success", "text": transcript.text}
    except Exception as e:
        print(f"[Error] {str(e)}")
        raise HTTPException(status_code=500, detail="Audio processing failed.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5222)
