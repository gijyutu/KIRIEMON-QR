"use strict";

// KIRIEMON QRコード作成ページの処理。
// 入力された文字を検証してひらがなに正規化し、ブラウザー内でQRコードのPNG画像を生成して
// ダイアログに大きく表示する。入力内容をサーバーへ送信することはない。
// QRコードの生成には vendor/qrcodegen-v1.8.0-es6.js の qrcodegen を使う。


//constはjavascriptの変数宣言で、再代入できない定数を作るために使う。


// 入力できる文字数の上限。画面のカウンター表示と検証の両方で使う。
const MAX_CHARACTERS = 60;

// QRコードに格納できるUTF-8バイト数の上限。
// 文字数が60字以内でも、1文字あたりのバイト数によっては容量を超えることがあるため、
// QRコード生成前に別途チェックする。
const MAX_UTF8_BYTES = 2330;

// 読み取り用の白い余白を上下左右に4セルずつ確保する。
const QUIET_ZONE = 4;

// 文字列をUTF-8のバイト列に変換するためのエンコーダー。
const encoder = new TextEncoder();

// 文字数を「見た目の1文字（書記素）」単位で数えるためのセグメンター。
// 濁点や結合文字を分けて数えてしまわないようにする。
const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });

// ひらがな（ぁ〜ん・ゔ・ゕ・ゖ）・長音（ー）・句読点・空白だけを許可する。
// カタカナはひらがなに変換してから、この正規表現で1文字ずつ判定する。
const allowedCharacter = /^[ぁ-んゔゕゖ！？。、ー 　]$/u;

// 半角カタカナ（濁点・半濁点を含む）を検出するパターン。
// NFKCで全角カタカナに変換すると、濁点・半濁点も1文字に合成される。
const halfwidthKanaPattern = /[\uFF66-\uFF9D\uFF70][\uFF9E\uFF9F]?/gu;

// 全角カタカナ（ァ〜ヶ）を検出するパターン。
// コードポイントを0x60引いて、対応するひらがなにする。
const katakanaPattern = /[\u30A1-\u30F6]/gu;

// 入力フォーム全体。submitイベントをここで受け取る。
const form = document.querySelector("#qr-form");
// 文字を入力するテキストエリア。
const input = document.querySelector("#qr-text");
// 不正な文字に波線を重ねるための透明レイヤー。
const markers = document.querySelector("#qr-markers");
// 「0 / 60」のように字数を表示するカウンター。
const counter = document.querySelector("#qr-count");
// 入力内容のエラーメッセージを表示する領域。
const error = document.querySelector("#qr-error");
// QRコード生成ボタン。入力が不正なときや空のときは無効化する。
const generateButton = document.querySelector(".generate-button");
// 生成したQRコードを大きく表示するダイアログ。
const dialog = document.querySelector("#qr-dialog");
// ダイアログ内に表示する、入力どおりの文字列。
const caption = document.querySelector("#qr-caption");
// 生成したQRコードのPNG画像。
const image = document.querySelector("#qr-image");
// ダイアログを閉じるボタン。
const close = document.querySelector("#qr-close");

// 入力文字をQRコード格納用のひらがな表現に正規化する。
// 1. 半角カナをNFKCで全角カナに変換する（濁点・半濁点も合成される）。
// 2. 全角カタカナのコードポイントから0x60を引いて、対応するひらがなにする。
// 3. NFCで結合文字を1文字にまとめる。
function toHiragana(value) {
  return value
    .replace(halfwidthKanaPattern, (kana) => kana.normalize("NFKC"))
    .replace(katakanaPattern, (kana) => String.fromCodePoint(kana.codePointAt(0) - 0x60))
    .normalize("NFC");
}

// テキストエリアと同じ文字配置の透明レイヤーに、不正な範囲だけをspanで包んで波線を引く。
// ranges は { start, end } の配列（元の文字列のインデックス）。
function renderInvalidMarkers(source, ranges = []) {
  if (!markers) return;

  // 前回の描画を消してから作り直す。
  markers.replaceChildren();
  let offset = 0;
  for (const range of ranges) {
    // 範囲が前後逆になっている、または空の場合は無視する。
    if (range.start < offset || range.end <= range.start) continue;
    // 範囲の手前までの文字をそのまま置く。
    markers.append(document.createTextNode(source.slice(offset, range.start)));
    // 不正な範囲をspanで包み、CSSの波線下線を当てる。
    const markedText = document.createElement("span");
    markedText.className = "invalid-marker";
    markedText.textContent = source.slice(range.start, range.end);
    markers.append(markedText);
    offset = range.end;
  }
  // 残りの文字を置く。
  markers.append(document.createTextNode(source.slice(offset)));
  // テキストエリアのスクロール位置にレイヤーを合わせる。
  markers.scrollTop = input.scrollTop;
  markers.scrollLeft = input.scrollLeft;
}

// エラー状態を画面全体に反映する。
// message が空ならエラー解除。disabled で生成ボタンの有効・無効を切り替える。
function setInputError(message, disabled = Boolean(message), invalidRanges = []) {
  const wasEmpty = error.textContent.length === 0;
  // スクリーンリーダー向けに aria-invalid も切り替える。
  if (message) {
    input.setAttribute("aria-invalid", "true");
  } else {
    input.removeAttribute("aria-invalid");
  }
  // エラーメッセージが変わったときだけDOMを更新する。
  if (error.textContent !== message) {
    error.textContent = message;
  }
  error.classList.toggle("has-message", Boolean(message));
  generateButton.disabled = disabled;
  renderInvalidMarkers(input.value, invalidRanges);

  // エラーが新しく出たときは、エラー欄が見える位置までスクロールする。
  if (wasEmpty && message && typeof error.scrollIntoView === "function") {
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    error.scrollIntoView({ block: "nearest", behavior });
  }
}

// 入力内容を検証し、QRコードに入れる文字列とエラーメッセージを返す。
// submitted が true のときは、空入力もエラーにする（送信時のチェック用）。
function validateInput(source, submitted = false) {
  // カタカナをひらがなに変換した文字列で字数を数える。
  const value = toHiragana(source.normalize("NFC"));
  const length = Array.from(segmenter.segment(value)).length;
  // カウンターを更新し、上限を超えたら赤く表示する。
  counter.textContent = `${length} / ${MAX_CHARACTERS}`;
  counter.classList.toggle("over-limit", length > MAX_CHARACTERS);

  const invalidItems = [];
  const invalidRanges = [];
  let position = 0;
  // 元の入力を1文字ずつ見て、使えない文字を探す。
  for (const { segment, index } of segmenter.segment(source)) {
    position++;
    let label = "";
    // 改行・タブ・半角ハイフンは、変換前の文字として個別に分かりやすく案内する。
    if (segment.includes("\n") || segment.includes("\r")) {
      label = "改行";
    } else if (segment.includes("\t")) {
      label = "タブ";
    } else if (segment.includes("-")) {
      label = "半角ハイフン「-」";
    } else {
      // カタカナ→ひらがな変換後の文字が許可リストに含まれるか確認する。
      const convertedSegment = toHiragana(segment.normalize("NFC"));
      const unsupported = Array.from(segmenter.segment(convertedSegment)).some(
        ({ segment: outputSegment }) => !allowedCharacter.test(outputSegment),
      );
      if (unsupported) label = `「${segment}」`;
    }

    // 使えない文字は「何文字目に何が入っているか」と、波線を引く範囲を記録する。
    if (label) {
      invalidItems.push({ position, label });
      invalidRanges.push({ start: index, end: index + segment.length });
    }
  }

  // 上限を超えた分（61文字目以降）も波線を引く。
  if (length > MAX_CHARACTERS) {
    const sourceSegments = Array.from(segmenter.segment(source));
    if (sourceSegments[MAX_CHARACTERS]) {
      invalidRanges.push({ start: sourceSegments[MAX_CHARACTERS].index, end: source.length });
    }
  }

  // 隣接・重複する範囲を1つにまとめて、spanの数を減らす。
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

  // エラーメッセージを組み立てる。
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

// エラーを表示し、入力欄にフォーカスを戻す。
function showInputError(result) {
  setInputError(result.message, true, result.invalidRanges);
  input.focus();
}

// バイト列からQRコードのPNG画像（データURL）を作る。
function makeQrPng(bytes) {
  const { QrCode, QrSegment } = qrcodegen;
  // ECI 26 はUTF-8を表す。日本語が文字化けせずに読めるように指定する。
  const segments = [QrSegment.makeEci(26), QrSegment.makeBytes(Array.from(bytes))];
  // 誤り訂正レベルM、型番1〜40の範囲で、入る最小サイズを自動選択する。
  const qr = QrCode.encodeSegments(segments, QrCode.Ecc.MEDIUM, 1, 40, -1, false);
  // 余白を含めた一辺のモジュール数。
  const modules = qr.size + QUIET_ZONE * 2;
  // 全体が512px以上になるように、1モジュールあたりのピクセル数を決める。
  const scale = Math.ceil(512 / modules);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = modules * scale;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  // 背景を白で塗る。
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  // 黒モジュールを描く。余白の分だけ位置をずらす。
  context.fillStyle = "#000";
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) {
        context.fillRect((x + QUIET_ZONE) * scale, (y + QUIET_ZONE) * scale, scale, scale);
      }
    }
  }

  // PNGのデータURLに変換する。失敗した場合は例外にして呼び出し側で表示する。
  const png = canvas.toDataURL("image/png");
  if (!png.startsWith("data:image/png;base64,")) {
    throw new Error("Canvas PNG export failed.");
  }
  return png;
}

// 現在の入力内容で検証し、画面表示を更新する。
function updateInput() {
  const result = validateInput(input.value);
  setInputError(result.message, Boolean(result.message) || result.length === 0, result.invalidRanges);
}

// IMEの変換中は検証を保留し、生成ボタンを無効にしておく。
// 変換途中の未確定文字をエラー扱いしないための処理。
input.addEventListener("input", (event) => {
  if (event.isComposing) {
    generateButton.disabled = true;
    renderInvalidMarkers(input.value);
  } else {
    updateInput();
  }
});
// IMEの変換が確定したタイミングで検証する。
input.addEventListener("compositionend", updateInput);
// テキストエリアのスクロールに合わせて、波線レイヤーの位置も同期する。
input.addEventListener("scroll", () => {
  if (markers) {
    markers.scrollTop = input.scrollTop;
    markers.scrollLeft = input.scrollLeft;
  }
}, { passive: true });
// 戻る・進むでページが復元されたときも、現在の入力内容で再検証する。
window.addEventListener("pageshow", updateInput);
updateInput();

// 「QRコードを生成」が押されたときの処理。
form.addEventListener("submit", (event) => {
  event.preventDefault();

  // 入力表示は保ち、カタカナをひらがなに変換した文字列をQRコードに入れる。
  const source = input.value;
  const result = validateInput(source, true);
  if (result.message) {
    showInputError(result);
    return;
  }

  // UTF-8のバイト数がQRコードの容量を超えないか確認する。
  const bytes = encoder.encode(result.value);
  if (bytes.length > MAX_UTF8_BYTES) {
    showInputError({ message: "文字の組み合わせが長すぎます。短くして再度お試しください。" });
    return;
  }

  // エラー表示を消してからQRコードを生成し、ダイアログで表示する。
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

// 「閉じる」ボタンで結果ダイアログを閉じる。
close.addEventListener("click", () => dialog.close());
