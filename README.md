# Bicycle Signal Navigator

自転車利用者向けの信号予測ナビアプリです。

## 概要

通学路や通勤路のように、同じルートを繰り返し使う利用者を想定しています。ルート上の信号を記録し、過去の観測から周期を推定して、青信号に合わせやすい走行を支援します。

## 主な機能

- ルート作成と保存
- 通過地点、信号地点の登録
- ナビ表示と信号モード
- 赤停止 / 青通過の観測記録
- 観測データを使った信号周期予測
- 推奨速度帯の表示
- シミュレーション機能

## 技術構成

- React
- Vite
- Firebase Authentication
- Firestore
- Leaflet / React Leaflet
- Mapbox Directions API

## 開発用コマンド

```bash
npm install
npm run dev
npm run build
npm run lint
```

## 環境変数

`.env.local` に以下を設定します。

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_MAPBOX_TOKEN`

## ドキュメント

実装ベースの仕様書は [SPECIFICATION.md](/Users/kawase/nav/SPECIFICATION.md) にあります。
