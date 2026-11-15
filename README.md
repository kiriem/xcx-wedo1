# LEGO WeDo 1.0 for Xcratch

USB 接続の **LEGO WeDo 1.0**(セット 9580 / USB ハブ 9581)を [Xcratch](https://xcratch.github.io/) で使うための拡張機能です。
Chrome / Edge の **WebHID** でブラウザーから直接ハブを操作するので、Scratch Link などのソフトをインストールする必要はありません。

An [Xcratch](https://xcratch.github.io/) extension for the USB **LEGO WeDo 1.0** hub, using WebHID (Chrome / Edge). No helper app required.

## 使い方 / How to Use

1. Chrome か Edge で [Xcratch エディター](https://xcratch.github.io/editor) を開く
2. WeDo 1.0 の USB ハブをパソコンにつなぐ
3. 左下の「拡張機能を追加」→「拡張機能を読み込む」を選ぶ
4. 次の URL を入力して OK を押す
   ```
   https://kiriem.github.io/xcx-wedo1/dist/wedo1.mjs
   ```
5. 「LEGO WeDo 1.0」の接続画面で「検索を開始」を押し、ブラウザーの一覧から **LEGO USB Hub** を選ぶ

Safari・Firefox・iPad は WebHID に対応していないため使えません。

## ブロック / Blocks

| ブロック | 説明 |
| - | - |
| [モーター] を [n] 秒間オンにする / オンにする / オフにする | ポート A・B・すべて |
| [モーター] のパワーを [n] にする | 0〜100 |
| [モーター] の方向を [こちら向き / あちら向き / 逆向き] にする | |
| 距離 [< / >] [n] のとき / 距離 | 0(近い)〜100(遠い) |
| [向き] に傾いたとき / [向き] に傾いた | 上・下・左・右・どれかの向き |
| ポート [A / B] のセンサーの生の値 | 0〜255 の未加工値 |

センサーはポート A・B のどちらに挿しても自動で判別します。

## プロトコル / Protocol

USB HID, VID `0x0694` / PID `0x0003`.

- 出力 (8 bytes, no report ID): `[0x40, motorA, motorB, 0, 0, 0, 0, 0]` — motor values are signed 8-bit PWM
- 入力 (8 bytes): `[status, supply, valueA, idA, valueB, idB, 0, 0]`

| ID | Device |
| - | - |
| 0–15 | motor |
| 25–50 | tilt sensor |
| 165–190 | motion (distance) sensor |
| 225–255 | nothing connected |

## 開発 / Development

```sh
npm install
npm run setup-dev ../scratch-editor/packages/scratch-vm   # link scratch-vm sources
npm run build                                              # → dist/wedo1.mjs
npm test
```

## License

AGPL-3.0-only. The built module bundles code from [scratch-vm](https://github.com/scratchfoundation/scratch-editor), which is licensed under AGPL-3.0.
