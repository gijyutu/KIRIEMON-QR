"use strict";

const MAX_CHARACTERS = 60;
const MAX_UTF8_BYTES = 2330;
// 読み取り用の白い余白を上下左右に4セルずつ確保する。
const QUIET_ZONE = 4;
const encoder = new TextEncoder();
const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const allowedCharacter = /^[ぁ-んゔゕゖ！？。、ー 　]$/u;
const halfwidthKanaPattern = /[\uFF66-\uFF9D\uFF70][\uFF9E\uFF9F]?/gu;
const katakanaPattern = /[\u30A1-\u30F6]/gu;

const form = document.querySelector("#qr-form");
const input = document.querySelector("#qr-text");
const markers = document.querySelector("#qr-markers");
const counter = document.querySelector("#qr-count");
const error = document.querySelector("#qr-error");
const generateButton = document.querySelector(".generate-button");
const dialog = document.querySelector("#qr-dialog");
const caption = document.querySelector("#qr-caption");
const image = document.querySelector("#qr-image");
const close = document.querySelector("#qr-close");

function toHiragana(value) {
  return value
    .replace(halfwidthKanaPattern, (kana) => kana.normalize("NFKC"))
    .replace(katakanaPattern, (kana) => String.fromCodePoint(kana.codePointAt(0) - 0x60))
    .normalize("NFC");
}

function renderInvalidMarkers(source, ranges = []) {
  if (!markers) return;

  markers.replaceChildren();
  let offset = 0;
  for (const range of ranges) {
    if (range.start < offset || range.end <= range.start) continue;
    markers.append(document.createTextNode(source.slice(offset, range.start)));
    const markedText = document.createElement("span");
    markedText.className = "invalid-marker";
    markedText.textContent = source.slice(range.start, range.end);
    markers.append(markedText);
    offset = range.end;
  }
  markers.append(document.createTextNode(source.slice(offset)));
  markers.scrollTop = input.scrollTop;
  markers.scrollLeft = input.scrollLeft;
}

function setInputError(message, disabled = Boolean(message), invalidRanges = []) {
  const wasEmpty = error.textContent.length === 0;
  if (message) {
    input.setAttribute("aria-invalid", "true");
  } else {
    input.removeAttribute("aria-invalid");
  }
  if (error.textContent !== message) {
    error.textContent = message;
  }
  error.classList.toggle("has-message", Boolean(message));
  generateButton.disabled = disabled;
  renderInvalidMarkers(input.value, invalidRanges);

  if (wasEmpty && message && typeof error.scrollIntoView === "function") {
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    error.scrollIntoView({ block: "nearest", behavior });
  }
}

function validateInput(source, submitted = false) {
  const value = toHiragana(source.normalize("NFC"));
  const length = Array.from(segmenter.segment(value)).length;
  counter.textContent = `${length} / ${MAX_CHARACTERS}`;
  counter.classList.toggle("over-limit", length > MAX_CHARACTERS);

  const invalidItems = [];
  const invalidRanges = [];
  let position = 0;
  for (const { segment, index } of segmenter.segment(source)) {
    position++;
    let label = "";
    if (segment.includes("\n") || segment.includes("\r")) {
      label = "改行";
    } else if (segment.includes("\t")) {
      label = "タブ";
    } else if (segment.includes("-")) {
      label = "半角ハイフン「-」";
    } else {
      const convertedSegment = toHiragana(segment.normalize("NFC"));
      const unsupported = Array.from(segmenter.segment(convertedSegment)).some(
        ({ segment: outputSegment }) => !allowedCharacter.test(outputSegment),
      );
      if (unsupported) label = `「${segment}」`;
    }

    if (label) {
      invalidItems.push({ position, label });
      invalidRanges.push({ start: index, end: index + segment.length });
    }
  }

  if (length > MAX_CHARACTERS) {
    const sourceSegments = Array.from(segmenter.segment(source));
    if (sourceSegments[MAX_CHARACTERS]) {
      invalidRanges.push({ start: sourceSegments[MAX_CHARACTERS].index, end: source.length });
    }
  }

  invalidRanges.sort((a, b) => a.start - b.start);
  const mergedRanges = [];
  for (const range of invalidRanges) {
    const previous = mergedRanges.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      mergedRanges.push({ ...range });
    }
  }

  const messages = [];
  if (length > MAX_CHARACTERS) {
    messages.push(`${MAX_CHARACTERS + 1}文字目以降は${MAX_CHARACTERS}字の上限を超えています。`);
  }
  if (invalidItems.length > 0) {
    const locations = invalidItems.map(({ position, label }) => `${position}文字目の${label}`).join("、");
    const hasHyphen = invalidItems.some(({ label }) => label.startsWith("半角ハイフン"));
    const allowed = "ひらがな・カタカナ・句読点（！？。、）・長音（ー）・空白を使ってください。";
    messages.push(`${locations}は使えません。${hasHyphen ? "長音は「ー」を入力してください。" : allowed}`);
  }
  if (submitted && length === 0) messages.push("変換する文字を入力してください。");

  return { value, length, message: messages.join(" "), invalidRanges: mergedRanges };
}

function showInputError(result) {
  setInputError(result.message, true, result.invalidRanges);
  input.focus();
}

function makeQrPng(bytes) {
  const { QrCode, QrSegment } = qrcodegen;
  const segments = [QrSegment.makeEci(26), QrSegment.makeBytes(Array.from(bytes))];
  const qr = QrCode.encodeSegments(segments, QrCode.Ecc.MEDIUM, 1, 40, -1, false);
  const modules = qr.size + QUIET_ZONE * 2;
  const scale = Math.ceil(512 / modules);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = modules * scale;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000";
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) {
        context.fillRect((x + QUIET_ZONE) * scale, (y + QUIET_ZONE) * scale, scale, scale);
      }
    }
  }

  const png = canvas.toDataURL("image/png");
  if (!png.startsWith("data:image/png;base64,")) {
    throw new Error("Canvas PNG export failed.");
  }
  return png;
}

function updateInput() {
  const result = validateInput(input.value);
  setInputError(result.message, Boolean(result.message) || result.length === 0, result.invalidRanges);
}

input.addEventListener("input", (event) => {
  if (event.isComposing) {
    generateButton.disabled = true;
    renderInvalidMarkers(input.value);
  } else {
    updateInput();
  }
});
input.addEventListener("compositionend", updateInput);
input.addEventListener("scroll", () => {
  if (markers) {
    markers.scrollTop = input.scrollTop;
    markers.scrollLeft = input.scrollLeft;
  }
}, { passive: true });
window.addEventListener("pageshow", updateInput);
updateInput();

form.addEventListener("submit", (event) => {
  event.preventDefault();

  // 入力表示は保ち、カタカナをひらがなに変換した文字列をQRコードに入れる。
  const source = input.value;
  const result = validateInput(source, true);
  if (result.message) {
    showInputError(result);
    return;
  }

  const bytes = encoder.encode(result.value);
  if (bytes.length > MAX_UTF8_BYTES) {
    showInputError({ message: "文字の組み合わせが長すぎます。短くして再度お試しください。" });
    return;
  }

  setInputError("");
  try {
    image.src = makeQrPng(bytes);
    // QRコードはひらがなに変換し、画面の文字表示は入力どおりにする。
    if (caption) {
      caption.textContent = source;
    }
    dialog.showModal();
  } catch (cause) {
    console.error("QR code generation failed.", cause);
    setInputError("QRコードの生成に失敗しました。ページを再読み込みしてお試しください。", false);
  }
});

close.addEventListener("click", () => dialog.close());
