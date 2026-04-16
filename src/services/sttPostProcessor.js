function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function extractName(text) {
  let cleaned = normalizeWhitespace(text);

  cleaned = cleaned
    .replace(/^제 이름은\s*/i, "")
    .replace(/^내 이름은\s*/i, "")
    .replace(/^이름은\s*/i, "")
    .replace(/입니다\.?$/i, "")
    .replace(/이에요\.?$/i, "")
    .replace(/예요\.?$/i, "")
    .trim();

  // 한글 이름만 우선 허용 (2~10자)
  const match = cleaned.match(/[가-힣]{2,10}/);

  return match ? match[0] : null;
}

function normalizeBirthDate(text) {
  const cleaned = normalizeWhitespace(text);

  // 예: 1958년 3월 12일
  let match = cleaned.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (match) {
    const year = match[1];
    const month = match[2].padStart(2, "0");
    const day = match[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // 예: 1958/3/12 또는 1958-3-12 또는 1958.3.12
  match = cleaned.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (match) {
    const year = match[1];
    const month = match[2].padStart(2, "0");
    const day = match[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return null;
}

function extractSongQuery(text) {
  let cleaned = normalizeWhitespace(text);

  cleaned = cleaned
    .replace(/노래\s*찾아줘$/i, "")
    .replace(/노래\s*검색해줘$/i, "")
    .replace(/검색해줘$/i, "")
    .replace(/찾아줘$/i, "")
    .replace(/틀어줘$/i, "")
    .replace(/재생해줘$/i, "")
    .trim();

  return cleaned || null;
}

function processGeneralText(text) {
  return {
    rawText: normalizeWhitespace(text),
  };
}

function processSttText(text, mode) {
  const normalizedText = normalizeWhitespace(text);

  switch (mode) {
    case "name": {
      const name = extractName(normalizedText);

      return {
        intent: "signup_name",
        parsed: {
          name,
        },
      };
    }

    case "birthdate": {
      const birthDate = normalizeBirthDate(normalizedText);

      return {
        intent: "signup_birthdate",
        parsed: {
          birthDate,
        },
      };
    }

    case "songSearch": {
      const query = extractSongQuery(normalizedText);

      return {
        intent: "song_search",
        parsed: {
          query,
        },
      };
    }

    default: {
      return {
        intent: "general",
        parsed: processGeneralText(normalizedText),
      };
    }
  }
}

module.exports = {
  processSttText,
};