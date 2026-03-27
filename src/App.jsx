// src/App.jsx
import { useEffect, useState } from "react";
import "./App.css";

import NavPage from "./ui/NavPage";
import MapPage from "./ui/MapPage";
import SimPage from "./ui/SimPage";

import {
  auth,
  isInAppBrowser,
  signInWithGoogle,
  handleGoogleRedirectResult,
  signupWithEmail,
  loginWithEmail,
  sendPasswordReset,
} from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";

function mapAuthError(error) {
  const code = String(error?.code ?? "");

  switch (code) {
    case "auth/invalid-email":
      return "メールアドレスの形式が正しくありません。";
    case "auth/user-disabled":
      return "このアカウントは無効化されています。";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "メールアドレスまたはパスワードが正しくありません。";
    case "auth/email-already-in-use":
      return "このメールアドレスは既に使われています。";
    case "auth/weak-password":
      return "パスワードは 6 文字以上で入力してください。";
    case "auth/too-many-requests":
      return "試行回数が多すぎます。少し待ってから再度お試しください。";
    default:
      return String(error?.message ?? error ?? "認証に失敗しました。");
  }
}

export default function App() {
  const [user, setUser] = useState(null);

  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  // page switch
  const [page, setPage] = useState("map"); // "map" | "nav" | "sim"
  const [activeRouteId, setActiveRouteId] = useState(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showGuideMore, setShowGuideMore] = useState(false);
  const [isNavSignalMode, setIsNavSignalMode] = useState(false);

  useEffect(() => {
    handleGoogleRedirectResult()
      .then((result) => {
        console.log("redirect result:", result);
      })
      .catch((e) => {
        console.error("Google redirect result error:", e);
        setErr(String(e?.message ?? e));
      });

    const unsub = onAuthStateChanged(auth, (u) => {
      console.log("auth user:", u);
      setUser(u);
    });

    return () => unsub();
  }, []);

  async function login() {
    setErr("");
    setInfo("");
    setAuthBusy(true);
    try {
      await loginWithEmail(email.trim(), pass);
    } catch (e) {
      setErr(mapAuthError(e));
      if (String(e?.message ?? "").includes("メール認証")) {
        setInfo(
          "認証メールを再送しました。メール内のリンクを開いてから、もう一度ログインしてください。",
        );
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function signup() {
    setErr("");
    setInfo("");
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setErr("メールアドレスを入力してください。");
      return;
    }
    if (pass.length < 6) {
      setErr("パスワードは 6 文字以上で入力してください。");
      return;
    }
    if (pass !== confirmPass) {
      setErr("確認用パスワードが一致しません。");
      return;
    }

    setAuthBusy(true);
    try {
      await signupWithEmail(trimmedEmail, pass);
      setInfo(
        `${trimmedEmail} に認証メールを送信しました。メール内のリンクを開いたあと、ログインしてください。`,
      );
      setAuthMode("login");
      setPass("");
      setConfirmPass("");
    } catch (e) {
      setErr(mapAuthError(e));
    } finally {
      setAuthBusy(false);
    }
  }

  async function loginWithGoogle() {
    setErr("");
    setInfo("");

    if (isInAppBrowser()) {
      setErr(
        "LINE などのアプリ内ブラウザでは Google ログインを使えません。Chrome または Safari でこのページを開いてからお試しください。",
      );
      return;
    }

    setAuthBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      setErr(mapAuthError(e));
    } finally {
      setAuthBusy(false);
    }
  }

  async function resetPassword() {
    setErr("");
    setInfo("");
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setErr("パスワード再設定にはメールアドレスを入力してください。");
      return;
    }

    setAuthBusy(true);
    try {
      await sendPasswordReset(trimmedEmail);
      setInfo(
        `${trimmedEmail} にパスワード再設定メールを送信しました。メールの案内に従って再設定してください。`,
      );
    } catch (e) {
      setErr(mapAuthError(e));
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn(e);
    }
  }

  if (!user) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <p className="auth-card__eyebrow">Urban Mobility HUD</p>
          <h2>{authMode === "login" ? "Login" : "Sign up"}</h2>
          <p className="auth-card__hint">
            {authMode === "login"
              ? "Google ログイン、メールログイン、パスワード再設定に対応しています。"
              : "メールアドレスで登録すると認証メールを送信します。認証完了後にログインできます。"}
          </p>

          <div className="auth-card__body">
            <div className="auth-switch">
              <button
                className={`auth-switch__button${authMode === "login" ? " is-active" : ""}`}
                onClick={() => {
                  setAuthMode("login");
                  setErr("");
                  setInfo("");
                }}
                type="button"
              >
                ログイン
              </button>
              <button
                className={`auth-switch__button${authMode === "signup" ? " is-active" : ""}`}
                onClick={() => {
                  setAuthMode("signup");
                  setErr("");
                  setInfo("");
                }}
                type="button"
              >
                新規登録
              </button>
            </div>

            <input
              placeholder="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <input
              placeholder="password"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete="current-password"
            />

            {authMode === "signup" && (
              <input
                placeholder="confirm password"
                type="password"
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                autoComplete="new-password"
              />
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {authMode === "login" ? (
                <button disabled={authBusy} onClick={login}>
                  ログイン
                </button>
              ) : (
                <button disabled={authBusy} onClick={signup}>
                  認証メールを送信
                </button>
              )}
              <button disabled={authBusy} onClick={loginWithGoogle}>
                Googleでログイン
              </button>
              {authMode === "login" && (
                <button disabled={authBusy} onClick={resetPassword} type="button">
                  パスワード再設定
                </button>
              )}
            </div>

            {info && <div className="auth-message auth-message--info">{info}</div>}
            {err && (
              <div className="auth-message auth-message--error">{err}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const showTopbar = !(page === "nav" && isNavSignalMode);

  return (
    <div className="app-shell">
      {showTopbar && (
        <div className="app-topbar">
          <div className="app-topbar__actions">
            {(page === "map" || page === "nav") && (
              <div className="app-guide-anchor">
                <button
                  aria-label={
                    page === "map"
                      ? "道順登録の使い方を表示"
                      : "ナビ画面の使い方を表示"
                  }
                  className="app-info-button"
                  onClick={() => {
                    setShowGuide((v) => {
                      const next = !v;
                      if (!next) setShowGuideMore(false);
                      return next;
                    });
                  }}
                  type="button"
                >
                  i
                </button>

                {showGuide && (
                  <div className="app-guide-popover">
                    <div className="app-guide-popover__header">
                      <div className="app-guide-popover__title">
                        {page === "map"
                          ? "道順登録の使い方"
                          : "ナビ画面の使い方"}
                      </div>
                      <button
                        aria-label="閉じる"
                        className="app-guide-popover__close"
                        onClick={() => {
                          setShowGuide(false);
                          setShowGuideMore(false);
                        }}
                        type="button"
                      >
                        ×
                      </button>
                    </div>

                    <div className="app-guide-popover__body">
                      {page === "map" ? (
                        <>
                          <div>1. 出発地点と到着地点を選びます</div>
                          <div>2. 必要なら通過地点を追加します</div>
                          <div>3. 信号モードで信号を追加します</div>
                          <div>4. よく使う出発時刻を登録します</div>
                          <div>
                            5. 登録した時刻の前後1時間の観測を、予測に利用します
                          </div>
                          <div>6. ルート名を付けて保存します</div>
                          <div>7. 保存後は編集やナビ開始ができます</div>
                          <div>
                            8. 保存したルートには使用回数が表示され、回数によって色が変わります
                          </div>
                          <div>9. 何度も使うことで、予測精度が高くなります</div>
                        </>
                      ) : (
                        <>
                          <div>
                            1. 現在の速度で進んだ場合の信号の色を表示します
                          </div>
                          <div>
                            2. 信号に近づくと、自動で信号モードに切り替わります
                          </div>
                          <div>
                            3. 赤や青の観測は自動でも手動でも記録できます
                          </div>
                          <div>
                            4. 自動検出は、自転車らしい動きをするほど正確になりやすくなります
                          </div>
                          <div>
                            5. 信号モードでは、実際の信号と同じ色を選んでください
                          </div>
                          <div>
                            6. 渋滞などで進みにくい場合は、渋滞モードを選んでください。このモードでは信号の自動検出はオフになります
                          </div>
                          <div>
                            7. 信号を飛ばすときはスキップ、信号モードをやめるときはキャンセルを押してください
                          </div>
                          <div>補足: 道順を外れた場合は再ルートされます</div>
                        </>
                      )}

                      <button
                        className="app-guide-popover__more"
                        onClick={() => setShowGuideMore((v) => !v)}
                        type="button"
                      >
                        {showGuideMore ? "閉じる" : "もっと見る"}
                      </button>

                      {showGuideMore && (
                        <div className="app-guide-popover__details">
                          {page === "map" ? (
                            <>
                              <div>1. 編集中の変更は、保存するまで確定されません</div>
                              <div>
                                2. 編集を終了して破棄すると、変更前の内容に戻ります
                              </div>
                              <div>
                                3. 信号を削除すると、その信号の観測データも失われます
                              </div>
                              <div>
                                4. 信号はルートの近くに追加してください。離れた信号は保存されません
                              </div>
                              <div>
                                5. 通過地点や信号を追加・移動すると、ルートが再計算されます
                              </div>
                              <div>6. 同じ名前のルートは保存できません</div>
                            </>
                          ) : (
                            <>
                              <div>
                                1. 青で通過したあとや、赤のあとに青を記録したあとは、自動で通常のナビ画面に戻ります
                              </div>
                              <div>
                                2. 信号に近づいて減速・停止すると、赤が自動で記録されやすくなります
                              </div>
                              <div>
                                3. 赤を記録したあとに発進すると、青への切り替わりも自動で記録されることがあります
                              </div>
                              <div>
                                4. 低速で通過した場合は、通常のナビ画面へ戻るまで少し時間がかかることがあります
                              </div>
                              <div>
                                5. 信号を通り過ぎて十分離れると、自動で信号モードを終了することがあります
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="app-status-pill">
              {page === "map" ? "Route Studio" : page === "nav" ? "Live Nav" : "Sim Mode"}
            </div>
            {page !== "map" && (
              <button className="app-action-button app-action-button--map" onClick={() => setPage("map")}>
                Map
              </button>
            )}
            <button className="app-action-button app-action-button--logout" onClick={logout}>
              ログアウト
            </button>
          </div>
        </div>
      )}

      <div className="app-main">
        {page === "map" && (
          <MapPage
            user={user}
            onDone={({ routeId, mode } = {}) => {
              if (!routeId) return;

              setActiveRouteId(routeId);

              if (mode === "nav") {
                setPage("nav");
                return;
              }

              setPage("sim");
            }}
          />
        )}

        {page === "nav" && (
          <NavPage
            user={user}
            routeId={activeRouteId}
            onSignalModeChange={setIsNavSignalMode}
            onDone={({ mode } = {}) => {
              if (mode === "back") setPage("map");
            }}
          />
        )}

        {page === "sim" && <SimPage user={user} routeId={activeRouteId} />}
      </div>
    </div>
  );
}
