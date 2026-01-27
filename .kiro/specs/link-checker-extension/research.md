# Research & Design Decisions

## Summary
- **Feature**: `link-checker-extension`
- **Discovery Scope**: New Feature（グリーンフィールド開発）
- **Key Findings**:
  - Chrome拡張機能はManifest V3が必須、Service Workerベースのバックグラウンド処理が標準
  - CORSバイパスにはService Worker経由のfetchとhost_permissionsが必要
  - Content ScriptとService Worker間はメッセージパッシングで通信

## Research Log

### Chrome Extension Manifest V3 アーキテクチャ
- **Context**: Chrome拡張機能の最新アーキテクチャパターンを調査
- **Sources Consulted**:
  - [Chrome for Developers - Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
  - [Chrome Extension Development Guide 2026](https://jinlow.medium.com/chrome-extension-development-the-complete-system-architecture-guide-for-2026-9ae81415f93e)
- **Findings**:
  - Manifest V3ではBackground PageがService Workerに置き換わり、イベント駆動で動作
  - Service Workerはアイドル時に5分後に終了するため、永続的な状態管理に工夫が必要
  - リモートコードの実行が禁止され、セキュリティが強化
  - Declarative Net Request APIでネットワーク操作のパフォーマンスが向上
- **Implications**:
  - リンクチェック処理はService Workerで実行し、進捗状態はchrome.storage経由で永続化
  - Content Scriptはページ内DOM操作専用、HTTP通信はService Workerに委譲

### Content Script / Service Worker 間通信
- **Context**: 複数コンポーネント間のデータ通信パターンを調査
- **Sources Consulted**:
  - [Message passing in Chrome extension](https://victoronsoftware.com/posts/message-passing-in-chrome-extension/)
  - [Chrome for Developers - Service Workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers)
- **Findings**:
  - chrome.runtime.sendMessage / chrome.runtime.onMessage で単発メッセージ送受信
  - chrome.runtime.connect / Port APIで長時間接続（ストリーミング通信向け）
  - Content ScriptはChrome APIへのアクセスが制限され、特権操作はService Worker経由
  - Service Workerからtabsへの通信はchrome.tabs.sendMessage使用
- **Implications**:
  - リンク検証の進捗通知はPort API（長時間接続）が適切
  - 検証開始/キャンセルは単発メッセージで十分

### CORS とクロスオリジンリクエスト
- **Context**: リンク検証時のHTTPリクエストにおけるCORS制約を調査
- **Sources Consulted**:
  - [Cross-origin network requests - Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
  - [Changes to Cross-Origin Requests in Chrome Extension Content Scripts](https://www.chromium.org/Home/chromium-security/extension-content-script-fetches/)
- **Findings**:
  - Content Scriptからのfetchはページと同じオリジンポリシーに従う
  - Service Worker/Background PageからのfetchはCORSをバイパス可能
  - host_permissionsに`<all_urls>`または`*://*/*`を設定することで全ドメインへのアクセスを許可
  - HEAD/GETリクエストでステータスコードのみ取得可能（ボディ不要）
- **Implications**:
  - 全てのHTTPリクエストはService Workerで実行
  - manifest.jsonにhost_permissions: ["<all_urls>"]を設定

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Message-Driven Architecture | Content Script ↔ Service Worker間のメッセージパッシング | 疎結合、テスタブル、Chromeネイティブ | メッセージ設計の複雑さ | Manifest V3の標準パターン |
| Centralized State in Storage | chrome.storage.localで状態管理 | Service Worker再起動後も状態維持 | 同期コスト | 進捗状態の永続化に必須 |
| Popup-Driven UI | 拡張機能ポップアップで結果表示 | 標準的なUX、実装シンプル | 画面サイズ制限 | 主要UIとして採用 |

## Design Decisions

### Decision: Service Workerでの一括HTTP検証
- **Context**: リンク検証をどこで実行するか
- **Alternatives Considered**:
  1. Content Scriptで直接fetch → CORSエラーが発生
  2. Service Workerで一括fetch → CORSバイパス可能
  3. 外部プロキシサーバー経由 → インフラ必要、プライバシー懸念
- **Selected Approach**: Service Workerで直接fetchリクエスト実行
- **Rationale**: host_permissions設定でCORSをバイパス可能、外部依存なし
- **Trade-offs**: Service Workerの5分タイムアウト制約あり、大量リンクでは分割処理必要
- **Follow-up**: 並列リクエスト数の最適値をテストで検証

### Decision: 進捗通知にPort APIを使用
- **Context**: リアルタイム進捗表示の実現方法
- **Alternatives Considered**:
  1. sendMessage繰り返し → オーバーヘッド大
  2. Port API（長時間接続） → 効率的なストリーミング
  3. chrome.storage.onChanged → 遅延あり
- **Selected Approach**: chrome.runtime.connectによるPort API
- **Rationale**: 双方向通信が効率的、進捗更新頻度に適合
- **Trade-offs**: 接続管理が必要、Service Worker終了時に再接続処理
- **Follow-up**: Popup閉じた場合のハンドリング実装

### Decision: HEADリクエストによる軽量検証
- **Context**: リンク検証のHTTPメソッド選択
- **Alternatives Considered**:
  1. GETリクエスト → レスポンスボディ取得でオーバーヘッド
  2. HEADリクエスト → ステータスのみ取得、軽量
- **Selected Approach**: まずHEADで試行、失敗時にGETフォールバック
- **Rationale**: 帯域幅削減、高速化。一部サーバーはHEAD非対応のためフォールバック必須
- **Trade-offs**: 2段階リクエストで実装複雑化
- **Follow-up**: HEADサポート率の実測

## Risks & Mitigations
- **Service Worker 5分タイムアウト** — chrome.alarmsで定期的にpingし、長時間処理を分割
- **大量リンク時のパフォーマンス低下** — 並列数を5-10に制限、キューイング処理
- **サーバー側レート制限** — 同一ドメインへのリクエスト間隔を調整、指数バックオフ
- **ネットワーク切断時のエラーハンドリング** — AbortController使用、タイムアウト設定

## References
- [Chrome Extensions Manifest V3 Migration Guide](https://developer.chrome.com/docs/extensions/develop/migrate) — 公式マイグレーションドキュメント
- [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) — クロスオリジンリクエストの実装ガイド
- [Extension service workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers) — Service Workerのライフサイクルと制約
