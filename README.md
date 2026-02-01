# Link Checker - Chrome Extension

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](https://chrome.google.com/webstore)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen)](https://developer.chrome.com/docs/extensions/mv3/intro/)

Webページ上のリンク切れを自動検出するChrome拡張機能です。SEO対策やWebサイト品質管理において、リンク切れはユーザー体験とサイト評価に大きく影響します。本ツールはワンクリックでページ内の全リンクを検証し、問題のあるリンクを即座に特定できます。

<!-- Chrome Web Store公開後にリンクを追加
## インストール

[Chrome Web Storeからインストール](https://chrome.google.com/webstore/detail/link-checker/YOUR_EXTENSION_ID)
-->

## 主な機能

| 機能 | 説明 |
|------|------|
| **リンク検証** | ページ内の全リンク（`<a>`, `<img>`, `<link>`, `<script>`）を自動抽出・検証 |
| **ステータス分類** | 正常(2xx) / リダイレクト(3xx) / エラー(4xx, 5xx, timeout) を視覚的に分類 |
| **リアルタイム進捗表示** | プログレスバーで検証状況をリアルタイム表示 |
| **要素ハイライト** | 検証結果をクリックすると該当要素をページ上でハイライト |
| **フィルタリング** | ステータス別・タグ別に結果を絞り込み表示 |
| **CSV出力** | 検証結果をCSVファイルとしてエクスポート |
| **セッション復元** | ポップアップを閉じても検証結果を保持 |

## 技術スタック

- **言語**: TypeScript 5.4
- **ビルドツール**: esbuild
- **拡張機能API**: Chrome Extensions Manifest V3
- **アーキテクチャ**: Service Worker ベース

## アーキテクチャ

```
src/
├── background/              # Service Worker (バックグラウンド処理)
│   ├── background.ts        # メインエントリポイント
│   ├── linkValidator.ts     # HTTP検証ロジック (HEAD→GETフォールバック)
│   ├── batchProcessor.ts    # 並列リクエスト制御
│   ├── progressNotifier.ts  # リアルタイム進捗通知
│   ├── csvExporter.ts       # CSV出力機能
│   └── contentScriptInjector.ts
│
├── content/                 # Content Script (ページ内実行)
│   ├── content.ts           # メインエントリポイント
│   ├── linkExtractor.ts     # DOM解析・リンク抽出
│   └── elementHighlighter.ts # 要素ハイライト表示
│
├── popup/                   # ポップアップUI
│   └── popup.ts             # UI状態管理・イベントハンドリング
│
└── shared/                  # 共通モジュール
    ├── types.ts             # TypeScript型定義
    └── messaging.ts         # コンポーネント間メッセージング
```

### 設計上の工夫

1. **HEAD→GETフォールバック**: HEADリクエストをサポートしないサーバーに対してGETで再試行
2. **AbortControllerによるキャンセル制御**: ユーザー操作で即座に検証を中断可能
3. **Port接続による進捗通知**: `chrome.runtime.connect`を使用したリアルタイム通信
4. **型安全なメッセージング**: Union型とType Guardによる型安全なコンポーネント間通信

## ローカル開発

### 前提条件

- Node.js 18.0.0 以上
- npm または yarn

### セットアップ

```bash
# リポジトリをクローン
git clone https://github.com/YOUR_USERNAME/link-checker.git
cd link-checker

# 依存関係のインストール
npm install

# ビルド
npm run build

# 型チェック
npm run typecheck
```

### Chromeへの読み込み

1. Chromeで `chrome://extensions/` を開く
2. 「デベロッパーモード」を有効化
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このリポジトリのルートディレクトリを選択

## 使い方

1. 検証したいWebページを開く
2. ツールバーのLink Checkerアイコンをクリック
3. 「チェック開始」ボタンをクリック
4. 検証結果を確認（フィルターで絞り込み可能）
5. 必要に応じてCSV出力

## プロジェクト構成

```
link-checker/
├── manifest.json          # 拡張機能マニフェスト (V3)
├── popup.html             # ポップアップUI
├── popup.css              # スタイルシート
├── popup.js               # ビルド済みポップアップスクリプト
├── background.js          # ビルド済みService Worker
├── content.js             # ビルド済みContent Script
├── icons/                 # 拡張機能アイコン
├── src/                   # TypeScriptソースコード
├── release/               # リリース用ZIPファイル
└── package.json
```

## ライセンス

MIT License

---

**開発者**: [@makidaisuke](https://github.com/makidaisuke)
