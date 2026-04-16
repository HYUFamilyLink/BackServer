const fs = require("fs");
const OpenAI = require("openai");
const { processSttText } = require("../services/sttPostProcessor");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

exports.convertSpeechToText = async (req, res) => {
  const filePath = req.file?.path;
  const mode = req.body?.mode || "general";

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        code: "NO_AUDIO_FILE",
        message: "audio 파일이 없습니다.",
      });
    }

    const mimeType = req.file.mimetype || "";
    const allowedMimeTypes = [
      "audio/webm",
      "audio/wav",
      "audio/x-wav",
      "audio/wave",
    ];

    const isAllowed = allowedMimeTypes.some((type) => mimeType.includes(type.split("/")[1])) ||
      allowedMimeTypes.includes(mimeType);

    if (!isAllowed) {
      return res.status(400).json({
        success: false,
        code: "UNSUPPORTED_AUDIO_FORMAT",
        message: `지원하지 않는 음성 형식입니다: ${mimeType}`,
      });
    }

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "gpt-4o-transcribe",
      language: "ko",
    });

    const text = transcription?.text?.trim() || "";

    if (!text) {
      return res.status(422).json({
        success: false,
        code: "EMPTY_TRANSCRIPTION",
        message: "음성을 인식하지 못했습니다.",
      });
    }

    const processed = processSttText(text, mode);

    return res.status(200).json({
      success: true,
      code: "STT_SUCCESS",
      message: "음성 인식에 성공했습니다.",
      mode,
      text,        // STT 원문
      mimeType,
      intent: processed.intent,
      parsed: processed.parsed, // 후처리 결과
    });
  } catch (error) {
    console.error("STT Error:", error);

    return res.status(500).json({
      success: false,
      code: "STT_FAILED",
      message: "STT 변환 실패",
    });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
};