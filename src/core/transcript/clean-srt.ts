import SRTParser from "srt-parser-2";

function normalizeSubtitleText(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/\{[^}]+\}/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/♪/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanUpSrt(srtContent: string): string {
  const parser = new SRTParser();
  const subtitles = parser.fromSrt(srtContent);

  let cleanedText = "";
  let previousText = "";

  for (const subtitle of subtitles) {
    const currentText = normalizeSubtitleText(subtitle.text);
    if (!currentText) continue;
    if (currentText === previousText) continue;

    if (currentText.includes(previousText) && previousText !== "") {
      const newPart = currentText.substring(previousText.length).trim();
      if (newPart) cleanedText += ` ${newPart}`;
    } else if (!previousText.includes(currentText)) {
      if (cleanedText) cleanedText += " ";
      cleanedText += currentText;
    }

    previousText = currentText;
  }

  return normalizeSubtitleText(cleanedText);
}
