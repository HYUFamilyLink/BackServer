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
            prompt="김철수, 이영희, 박민준"
        )
        # 이름 앞뒤 공백/구두점 제거 후 첫 번째 단어만 추출
        raw = transcript.text.strip()
        name = raw.split()[0].strip(".,!?~") if raw else ""
        return {"status": "success", "text": name}
    except Exception as e:
        print(f"[Error] {str(e)}")
        raise HTTPException(status_code=500, detail="Audio processing failed.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5222)
