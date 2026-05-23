const googleTTS = require('google-tts-api');
async function generateTTSBase64(text) {
  try {
    const results = await googleTTS.getAllAudioBase64(text, {
      lang: 'ko',         // 한국어
      slow: false,        // 정상 속도
      host: 'https://translate.google.com',
      splitPunct: ',.?'   // 문장이 길면 끊어서 처리
    });

    // 변환된 데이터 반환
    return results[0]?.base64 || null;
  } catch (err) {
    console.error('[TTS Error]', err);
    return null;
  }
}

module.exports = { generateTTSBase64 };