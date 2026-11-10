"use strict";

const MAX_CHARACTERS = 20;
const MAX_UTF8_BYTES = 2330;
// 読み取り用の白い余白を上下左右に4セルずつ確保する。
const QUIET_ZONE = 4;
const encoder = new TextEncoder();
const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const forbiddenCharacters = /[\p{Script=Latin}\p{Decimal_Number}:：]/u;
// 半角・全角スペースやタブに加え、改行も空白文字として検出する。
const whitespaceCharacters = /\p{White_Space}/u;

const form = document.querySelector("#qr-form");
const input = document.querySelector("#qr-text");
const counter = document.querySelector("#qr-count");
const error = document.querySelector("#qr-error");
const dialog = document.querySelector("#qr-dialog");
const caption = document.querySelector("#qr-caption");
const image = document.querySelector("#qr-image");
const close = document.querySelector("#qr-close");

function setInputError(message) {
  if (message) {
    input.setAttribute("aria-invalid", "true");
  } else {
    input.removeAttribute("aria-invalid");
  }
  if (error.textContent !== message) {
    error.textContent = message;
  }
}

function validateInput(value, submitted = false) {
  let length = 0;
  for (const segment of segmenter.segment(value)) {
    length++;
  }
  counter.textContent = `${length} / ${MAX_CHARACTERS}`;
  counter.classList.toggle("over-limit", length > MAX_CHARACTERS);

  if (length > MAX_CHARACTERS) {
    return "20字以内に短くしてください。";
  }
  if (forbiddenCharacters.test(value)) {
    return "英字、数字、コロンを削除してください。";
  }
  if (whitespaceCharacters.test(value)) {
    return "空白（スペース、タブ、改行）を削除してください。";
  }
  if (submitted && value.trim() === "") {
    return "変換する文字を入力してください。";
  }
  return "";
}

function showInputError(message) {
  setInputError(message);
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
  setInputError(validateInput(input.value));
}

input.addEventListener("input", (event) => {
  if (!event.isComposing) {
    updateInput();
  }
});
input.addEventListener("compositionend", updateInput);
window.addEventListener("pageshow", updateInput);

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const value = input.value;
  const validationError = validateInput(value, true);
  if (validationError) {
    showInputError(validationError);
    return;
  }

  const bytes = encoder.encode(value);
  if (bytes.length > MAX_UTF8_BYTES) {
    showInputError("文字の組み合わせが長すぎます。短くして再度お試しください。");
    return;
  }

  setInputError("");
  try {
    image.src = makeQrPng(bytes);
    // 入力した文字は画像の外にテキストとして表示し、白い余白を保つ。
    caption.textContent = value;
    dialog.showModal();
  } catch (cause) {
    console.error("QR code generation failed.", cause);
    error.textContent = "QRコードの生成に失敗しました。ページを再読み込みしてお試しください。";
  }
});

close.addEventListener("click", () => dialog.close());
