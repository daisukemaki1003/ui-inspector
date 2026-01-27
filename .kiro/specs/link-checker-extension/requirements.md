# Requirements Document

## Introduction
本ドキュメントは、現在閲覧しているWebページ内のリンク切れを検出・報告するGoogle Chrome拡張機能の要件を定義します。この拡張機能により、ユーザーはWebサイトの品質管理やメンテナンスを効率的に行うことができます。

## Requirements

### Requirement 1: リンク検出
**Objective:** As a Webサイト管理者/開発者, I want 現在閲覧中のページ内のすべてのリンクを自動的に検出したい, so that リンク切れチェックの対象を把握できる

#### Acceptance Criteria
1. When ユーザーがリンクチェック機能を起動する, the Extension shall ページ内のすべての`<a>`タグのリンクを検出する
2. When ユーザーがリンクチェック機能を起動する, the Extension shall ページ内のすべての`<img>`タグのソースURLを検出する
3. When ユーザーがリンクチェック機能を起動する, the Extension shall ページ内のすべての`<link>`タグ（CSS等）のURLを検出する
4. When ユーザーがリンクチェック機能を起動する, the Extension shall ページ内のすべての`<script>`タグのソースURLを検出する
5. The Extension shall 検出したリンクの総数を表示する

### Requirement 2: リンク検証
**Objective:** As a Webサイト管理者/開発者, I want 検出したリンクの有効性を検証したい, so that リンク切れを発見できる

#### Acceptance Criteria
1. When リンクが検出された, the Extension shall 各リンクに対してHTTPリクエストを送信し、応答ステータスを確認する
2. When リンクの検証が完了した, the Extension shall HTTPステータスコードに基づいてリンクの状態を分類する（正常: 2xx, リダイレクト: 3xx, クライアントエラー: 4xx, サーバーエラー: 5xx）
3. While リンク検証が進行中, the Extension shall 検証の進捗状況をリアルタイムで表示する
4. If リンクへのリクエストがタイムアウトした, then the Extension shall 該当リンクを「タイムアウト」として記録する
5. If ネットワークエラーが発生した, then the Extension shall 該当リンクを「接続エラー」として記録する

### Requirement 3: 結果表示
**Objective:** As a Webサイト管理者/開発者, I want リンク検証の結果をわかりやすく確認したい, so that 問題のあるリンクを素早く特定できる

#### Acceptance Criteria
1. When 検証が完了した, the Extension shall 結果をステータス別（正常/リダイレクト/エラー）にグループ化して表示する
2. When 検証が完了した, the Extension shall エラーのあるリンクを目立つ色で強調表示する
3. When ユーザーがリスト内のリンクをクリックする, the Extension shall ページ内の該当リンク要素までスクロールし、ハイライト表示する
4. The Extension shall 各リンクについてURL、ステータスコード、リンクテキスト（またはalt属性）を表示する
5. When ユーザーがフィルターを選択する, the Extension shall 選択したステータスのリンクのみを表示する

### Requirement 4: ユーザーインターフェース
**Objective:** As a Webサイト管理者/開発者, I want 直感的で使いやすいインターフェースでリンクチェックを行いたい, so that 効率的に作業できる

#### Acceptance Criteria
1. When ユーザーがブラウザのツールバーにある拡張機能アイコンをクリックする, the Extension shall ポップアップUIを表示する
2. When ポップアップが表示された, the Extension shall 「チェック開始」ボタンを表示する
3. While リンクチェックが進行中, the Extension shall 進捗バーまたはローディングインジケーターを表示する
4. When チェックが完了した, the Extension shall サマリー（総リンク数、正常数、エラー数）を表示する
5. The Extension shall レスポンシブなデザインでポップアップのサイズに適応する

### Requirement 5: パフォーマンスと制限
**Objective:** As a ユーザー, I want 拡張機能がブラウザのパフォーマンスに悪影響を与えないようにしたい, so that 快適にブラウジングを続けられる

#### Acceptance Criteria
1. The Extension shall 同時に実行するHTTPリクエストの数を制限する（並列処理数の上限設定）
2. The Extension shall 各リクエストにタイムアウト時間を設定する
3. While リンクチェックが進行中, the Extension shall ユーザーがチェックをキャンセルできるボタンを表示する
4. When ユーザーがキャンセルボタンをクリックする, the Extension shall 進行中のリクエストを中止し、それまでの結果を表示する
5. The Extension shall ブラウザのタブがアクティブでない場合でもバックグラウンドでチェックを継続する

### Requirement 6: エクスポート機能
**Objective:** As a Webサイト管理者/開発者, I want 検証結果をエクスポートしたい, so that レポートや記録として保存・共有できる

#### Acceptance Criteria
1. When ユーザーがエクスポートボタンをクリックする, the Extension shall 検証結果をCSV形式でダウンロードできるようにする
2. The Extension shall エクスポートファイルにURL、ステータスコード、ステータス説明、リンクテキストを含める
3. The Extension shall エクスポートファイルに検証日時とページURLを含める
