import os
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pathlib import Path
from dotenv import load_dotenv
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# 3. 디버깅 로그 (터미널 창을 꼭 확인하세요)
print(f"DEBUG: 현재 실행 위치 (CWD): {os.getcwd()}")
print(f"DEBUG: .env 파일을 찾는 위치: {env_path}")
print(f"DEBUG: 파일 존재 여부: {env_path.exists()}")
app = FastAPI(title="Audio Processing AI Server")
api_key = os.environ.get("OPENAI_API_KEY")
if not api_key:
    print("❌ ERROR: OPENAI_API_KEY를 찾을 수 없습니다. .env 파일을 확인하세요.")
else:
    print(f"✅ API Key 로드 완료: {api_key[:5]}****") # 보안을 위해 앞 5자리만 출력

client = OpenAI(api_key=api_key)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
load_dotenv()
print(f"API Key 확인: {os.environ.get('OPENAI_API_KEY')}")