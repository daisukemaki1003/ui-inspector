# Implementation Plan

## Task Overview
Chrome拡張機能「Link Checker」の実装タスク。Manifest V3準拠、Service Worker/Content Script/Popup UIの3層アーキテクチャで構成。

---

## Tasks

- [x] 1. プロジェクト基盤とマニフェスト設定
- [x] 1.1 拡張機能プロジェクト構造を作成する
  - 拡張機能のディレクトリ構成を整備（src/popup, src/background, src/content, src/shared）
  - TypeScript設定ファイルを作成し、ES Modules対応を構成
  - 共通の型定義ファイルを配置（LinkInfo, ValidationResult, MessageType等）
  - _Requirements: 4.1_

- [x] 1.2 Manifest V3設定ファイルを構成する
  - manifest.jsonを作成し、Manifest V3形式で定義
  - **`chrome.scripting`権限を追加し、オンデマンドContent Scriptインジェクション方式を採用**（常時ロードを避けパフォーマンス向上）
  - host_permissions、activeTab、storage、downloads、scripting権限を設定
  - アイコン、ポップアップ、Service Workerエントリポイントを定義
  - _Requirements: 4.1, 5.1_

---

- [x] 2. メッセージング基盤の実装
- [x] 2.1 型安全なメッセージバスを構築する
  - 全メッセージタイプの型定義（START_CHECK, CANCEL_CHECK, EXTRACT_LINKS等）
  - chrome.runtime.sendMessage/onMessage のラッパー関数を実装
  - chrome.runtime.connect/Port APIのラッパーを実装（進捗ストリーミング用）
  - メッセージタイプによる型ガードを実装
  - _Requirements: 2.3_

---

- [x] 3. Content Script機能の実装
- [x] 3.1 (P) リンク抽出機能を実装する
  - a[href], img[src], link[href], script[src]タグからURLを収集
  - **一意識別用のdata属性（data-lc-id）を各要素に付与**（DOM変更に対する堅牢性向上）
  - 相対URLを絶対URLに変換し、無効なスキーム（javascript:, mailto:, data:）を除外
  - 重複URLの除去と要素情報（タグ名、テキスト/alt属性）の取得
  - 抽出結果をService Workerへ送信
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 3.2 (P) 要素ハイライト機能を実装する
  - **data-lc-id属性を使用して対象要素を特定**（インデックス方式より堅牢）
  - scrollIntoViewで要素をビューポートに表示
  - CSSアニメーションによるハイライト効果を適用（点滅、枠線）
  - 既存ハイライトのクリア処理とタイムアウトによる自動解除
  - _Requirements: 3.3_

---

- [ ] 4. Service Worker コア機能の実装
- [ ] 4.1 HTTP検証エンジンを実装する
  - HEADリクエストによるステータスコード取得（失敗時GETフォールバック）
  - HTTPステータスコードの分類ロジック（2xx:success, 3xx:redirect, 4xx/5xx:error）
  - AbortControllerによるタイムアウト管理（デフォルト10秒）
  - タイムアウト/ネットワークエラーの個別カテゴリ分類
  - _Requirements: 2.1, 2.2, 2.4, 2.5, 5.2_

- [ ] 4.2 バッチ処理と並列制御を実装する
  - Promiseベースのセマフォで並列リクエスト数を制御（デフォルト5）
  - **バッチ単位での処理分割（20件ごと）とchrome.storage.localへの中間結果保存**
  - **Service Worker再起動時の検証再開ロジック**（5分タイムアウト対策）
  - キャンセルフラグによる中断処理とAbortControllerの一括abort
  - _Requirements: 5.1, 5.3, 5.4, 5.5_

- [ ] 4.3 進捗通知システムを実装する
  - Port API経由でのリアルタイム進捗送信
  - 検証完了件数、現在処理中のURL、残り件数の通知
  - Popup切断時の状態保持とchrome.storage経由の復元
  - 検証完了イベントの発火
  - _Requirements: 2.3_

- [ ] 4.4 (P) Content Scriptのオンデマンドインジェクションを実装する
  - **chrome.scripting.executeScriptによるContent Script動的注入**
  - 現在のタブIDを取得し、必要時のみスクリプトを実行
  - インジェクション済みフラグの管理（二重実行防止）
  - _Requirements: 5.1_

---

- [ ] 5. Popup UI 実装
- [ ] 5.1 基本UIレイアウトを構築する
  - ポップアップのHTML/CSS構造を作成（レスポンシブ対応、最小幅300px）
  - チェック開始ボタン、キャンセルボタン、エクスポートボタンを配置
  - 進捗バーコンポーネントを実装（パーセント表示、現在処理中URL表示）
  - サマリー表示エリア（総数、正常数、エラー数）を構築
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 5.2 結果一覧表示を実装する
  - ステータス別グループ化表示（正常/リダイレクト/エラー）
  - エラーリンクの目立つ色による強調（赤系配色）
  - 各結果アイテムにURL、ステータスコード、リンクテキストを表示
  - 結果クリック時のハイライト連携メッセージ送信
  - _Requirements: 3.1, 3.2, 3.4_

- [ ] 5.3 フィルタリング機能を実装する
  - ステータス別フィルターボタン（全て/正常/リダイレクト/エラー）
  - フィルター選択時の表示切り替えロジック
  - フィルター状態の視覚的表示（選択中ハイライト）
  - _Requirements: 3.5_

- [ ] 5.4 状態管理と復元を実装する
  - PopupState型に基づく状態管理（phase, progress, results, filter, summary）
  - chrome.storageからの前回結果復元（Popup再オープン時）
  - Service Workerへの接続確立とPort管理
  - _Requirements: 1.5, 2.3, 4.4_

---

- [ ] 6. CSVエクスポート機能の実装
- [ ] 6.1 CSV生成とダウンロードを実装する
  - 検証結果をCSV形式に変換（URL, ステータスコード, ステータス説明, リンクテキスト）
  - ヘッダー行にページURLと検証日時を含める
  - 特殊文字のエスケープ処理（カンマ、改行、ダブルクォート）
  - BOM付きUTF-8エンコーディングでExcel互換性を確保
  - chrome.downloads APIによるファイル保存トリガー
  - _Requirements: 6.1, 6.2, 6.3_

---

- [ ] 7. 統合とエンドツーエンド動作確認
- [ ] 7.1 全コンポーネント間の連携を統合する
  - Popup→Service Worker→Content Scriptのメッセージフロー結合
  - チェック開始からリンク抽出、検証、結果表示までの一連の動作確認
  - キャンセル操作の全コンポーネント連携確認
  - エクスポート機能の結合確認
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 4.1, 4.2, 4.3, 4.4_

- [ ] 7.2 エッジケースとエラーハンドリングを検証する
  - 大量リンク（100+）ページでのパフォーマンス検証
  - Service Worker再起動後の検証再開動作確認
  - ネットワークエラー、タイムアウト発生時の表示確認
  - DOM変更後のハイライト機能の堅牢性確認
  - _Requirements: 2.4, 2.5, 5.1, 5.2, 5.3, 5.4, 5.5_

---

## Requirements Coverage

| Requirement | Tasks |
|-------------|-------|
| 1.1 | 3.1, 7.1 |
| 1.2 | 3.1, 7.1 |
| 1.3 | 3.1, 7.1 |
| 1.4 | 3.1, 7.1 |
| 1.5 | 5.4, 7.1 |
| 2.1 | 4.1, 7.1 |
| 2.2 | 4.1, 7.1 |
| 2.3 | 2.1, 4.3, 5.4, 7.1 |
| 2.4 | 4.1, 7.2 |
| 2.5 | 4.1, 7.2 |
| 3.1 | 5.2 |
| 3.2 | 5.2 |
| 3.3 | 3.2 |
| 3.4 | 5.2 |
| 3.5 | 5.3 |
| 4.1 | 1.1, 1.2, 5.1, 7.1 |
| 4.2 | 5.1 |
| 4.3 | 5.1, 7.1 |
| 4.4 | 5.1, 5.4, 7.1 |
| 4.5 | 5.1 |
| 5.1 | 1.2, 4.2, 4.4, 7.2 |
| 5.2 | 4.1, 7.2 |
| 5.3 | 4.2, 7.2 |
| 5.4 | 4.2, 7.2 |
| 5.5 | 4.2, 7.2 |
| 6.1 | 6.1 |
| 6.2 | 6.1 |
| 6.3 | 6.1 |
