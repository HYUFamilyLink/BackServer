import os
import sys
import uuid
import subprocess
import tempfile
import torch
import whisper
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Audio Processing AI Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_model_cache: dict[str, whisper.Whisper] = {}

def _get_whisper_model(model_size: str) -> whisper.Whisper:
    if model_size not in _model_cache:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _model_cache[model_size] = whisper.load_model(model_size, device=device)
    return _model_cache[model_size]

def _run_demucs(input_path: str, out_dir: str) -> str | None:
    device = "cuda" if torch.cuda.is_available() else "cpu"
    cmd = [sys.executable, "-m", "demucs", "-d", device, "--two-stems=vocals", "--out", out_dir, input_path]
    result = subprocess.run(cmd, capture_output=True, encoding="utf-8", errors="replace")
    
    if result.returncode != 0:
        print(f"[Demucs Error] {result.stderr}")
        return None
        
    base_name = os.path.splitext(os.path.basename(input_path))[0]
    vocals_path = os.path.join(out_dir, "htdemucs", base_name, "vocals.wav")
    
    return vocals_path if os.path.exists(vocals_path) else None

def _run_whisper(audio_path: str, model_size: str) -> str:
    model = _get_whisper_model(model_size)
    # 한국어 음성 인식
    result = model.transcribe(audio_path, language="ko")
    return result["text"]

def extract_text_from_audio(audio_bytes: bytes, ffmpeg_bin: str = "", whisper_model_size: str = "base") -> str:
    """오디오 바이트를 받아 Demucs → Whisper 실행 후 Raw 텍스트 반환"""
    if ffmpeg_bin:
        os.environ["PATH"] = ffmpeg_bin + os.pathsep + os.environ.get("PATH", "")

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, f"{uuid.uuid4().hex}.mp3") # VR에서 오는 형식이 mp3
        
        with open(input_path, "wb") as f:
            f.write(audio_bytes)

        print("[AI Server] Running Demucs...")
        vocals_path = _run_demucs(input_path, tmpdir)
        
        if vocals_path is None:
            print("[AI Server] Demucs failed, falling back to original audio.")
            vocals_path = input_path  # Demucs 실패 시 원본

        print("[AI Server] Running Whisper...")
        return _run_whisper(vocals_path, whisper_model_size)

# 2. API Endpoint
@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    if not file.filename.endswith(('.mp3', '.wav', '.m4a')):
        raise HTTPException(status_code=400, detail="Invalid file type. Send mp3, wav, or m4a.")
    
    try:
        audio_bytes = await file.read()
        extracted_text = extract_text_from_audio(audio_bytes, whisper_model_size="base")
        
        return {
            "status": "success",
            "text": extracted_text
        }
    except Exception as e:
        print(f"[Error] {str(e)}")
        raise HTTPException(status_code=500, detail="Audio processing failed.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5222)