# KIRIEMON

入力した文字をQRコードに変換し、画面いっぱいに表示できます。入力内容の処理はブラウザー内で完結します。

## ローカルで開く

リポジトリのルートで `python3 -m http.server 8000 --bind 127.0.0.1 --directory dist` を実行し、ブラウザーで `http://127.0.0.1:8000/` を開きます。

## QRコードの仕様

入力できるのは、小さい文字や濁音・半濁音を含むひらがな（ぁ〜ん）で60字以内です。濁点や半濁点が別の文字として入力された場合は、合成できる組み合わせを1字にまとめてからQRコードに変換します。生成には、MITライセンスの [Project Nayuki QR Code generator v1.8.0](https://github.com/nayuki/QR-Code-generator/releases/tag/v1.8.0) を使用しています。
