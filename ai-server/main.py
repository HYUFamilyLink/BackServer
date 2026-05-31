import os
import sys
import uuid
import subprocess
import tempfile
import torch
import whisper
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydub import AudioSegment, silence

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

def _remove_silence(input_path: str, output_path: str) -> str:
    """pydub를 사용하여 무음 구간을 제거하고 저장된 경로를 반환"""
    try:
        audio = AudioSegment.from_file(input_path)
        
        # 무음 구간 분리 설정
        chunks = silence.split_on_silence(
            audio,
            min_silence_len=500,     # 0.5초 이상 소리가 없으면 무음으로 간주
            silence_thresh=-40,      # -40dBFS 이하의 작은 소리를 무음으로 간주
            keep_silence=200         # 잘라낸 목소리 앞뒤로 200ms 여유
        )
        
        # 유효한 소리가 전혀 없는 경우
        if not chunks:
            print("[VAD] 유효한 음성이 감지되지 않았습니다. 원본을 유지합니다.")
            return input_path
            
        # 잘라낸 음성 조각들을 하나로 다시 합치기
        processed_audio = sum(chunks)
        processed_audio.export(output_path, format="mp3")
        
        print(f"[VAD] 무음 구간 제거 완료. (원본 길이: {len(audio)}ms -> 압축 길이: {len(processed_audio)}ms)")
        return output_path
        
    except Exception as e:
        print(f"[VAD Error] 무음 제거 중 오류 발생: {str(e)}")
        # 에러가 발생하면 파이프라인이 멈추지 않도록 안전하게 원본 파일을 반환합니다.
        return input_path

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
    """오디오 바이트를 받아 VAD → Demucs → Whisper 실행 후 Raw 텍스트 반환"""
    if ffmpeg_bin:
        os.environ["PATH"] = ffmpeg_bin + os.pathsep + os.environ.get("PATH", "")

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, f"{uuid.uuid4().hex}.mp3") # VR에서 오는 원본 파일
        vad_output_path = os.path.join(tmpdir, f"vad_{uuid.uuid4().hex}.mp3") # VAD 처리된 파일
        
        with open(input_path, "wb") as f:
            f.write(audio_bytes)

        # 무음 제거 실행
        print("[AI Server] 1단계: VAD(무음 제거) 실행 중...")
        target_audio_path = _remove_silence(input_path, vad_output_path)

        # 보컬 추출 실행 
        print("[AI Server] 2단계: Demucs(보컬 추출) 실행 중...")
        vocals_path = _run_demucs(target_audio_path, tmpdir)
        
        if vocals_path is None:
            print("[AI Server] Demucs 실패, VAD 처리된 오디오(또는 원본)로 대체합니다.")
            vocals_path = target_audio_path

        # Whisper (STT) 실행
        print("[AI Server] 3단계: Whisper(텍스트 변환) 실행 중...")
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