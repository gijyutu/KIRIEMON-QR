# KIRIEMON

入力した文字をQRコードに変換し、画面いっぱいに表示できます。入力内容の処理はブラウザー内で完結します。

## ローカルで開く

リポジトリのルートで `python3 -m http.server 8000 --bind 127.0.0.1 --directory dist` を実行し、ブラウザーで `http://127.0.0.1:8000/` を開きます。

## QRコードの仕様

入力は20字以内です。英字、数字、コロン、スペース（半角・全角を含む）、タブ、改行が入っている場合はエラーを表示します。結合文字や複数の文字からなる絵文字は、画面上のひとまとまりを1字として数えます。生成には、MITライセンスの [Project Nayuki QR Code generator v1.8.0](https://github.com/nayuki/QR-Code-generator/releases/tag/v1.8.0) を使用しています。
