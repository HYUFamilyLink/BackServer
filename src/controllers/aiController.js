const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

// AI 서버 주소
const AI_SERVER_URL = 'http://localhost:5222/api/transcribe';

async function transcribeAudio(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '오디오 파일이 전송되지 않았습니다.' });
  }

  const filePath = req.file.path; 
  const originalName = req.file.originalname;
  
  try {
    console.log('[Node] 퀘스트 프로 오디오 수신, AI 서버로 전송 준비 중...');

    const formData = new FormData();
    
    const fileNameToSend = originalName.includes('.') ? originalName : `${originalName}.wav`;
    formData.append('file', fs.createReadStream(filePath), { filename: fileNameToSend });

    // AI 서버(5222 포트)로 POST 
    const response = await axios.post(AI_SERVER_URL, formData, {
      headers: {
        ...formData.getHeaders(),
      },
      // 타임아웃을 60초 정도
      timeout: 60000 
    });

    // 전송 완료 후 임시 파일 삭제
    fs.unlinkSync(filePath);

    console.log(`[Node] AI 변환 완료: ${response.data.text}`);

    // 5. 프론트엔드(VR)로 텍스트 반환
    return res.json({ 
      success: true, 
      text: response.data.text 
    });

  } catch (error) {
    const errorMessage = error.response?.data?.detail || error.message;
    console.error('[Node] AI 서버 호출 에러:', errorMessage);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return res.status(500).json({ 
      success: false, 
      error: `음성 인식 처리 중 AI 서버에서 에러가 발생했습니다. (${errorMessage})` 
    });
  }
}

module.exports = {
  transcribeAudio
};