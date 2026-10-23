"use client";
import { useState } from "react";

import { BookOpen, ArrowRight } from "lucide-react";

import { defaults } from "../lib/model";
import { api, ErrorBox } from "./NotebookShared";
type Any = Record<string, any>;
export default function Login({
  onLogin,
}: {
  onLogin: (p: typeof defaults) => void;
}) {
  const [username, setUsername] = useState("student"),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <div className="login-story">
        <BookOpen size={36} />
        <span className="eyebrow">研习本 / PRIVATE LEARNING SPACE</span>
        <h1>
          把每一次思考，
          <br />
          变成向前的一步。
        </h1>
        <p>
          错题、词汇、长难句。
          <br />
          收集当下的疑问，留给下一次更清晰的自己。
        </p>
        <div className="login-symbol">
          ∑ <span>→</span> ∞
        </div>
        <small>为 2028 考研，慢慢积累。</small>
      </div>
      <form
        className="login-form"
        aria-describedby={error ? "login-error" : undefined}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const r = await api("auth/login", { username, password });
            onLogin(r.settings);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="eyebrow">WELCOME BACK</span>
        <h2>打开你的研习本</h2>
        <p className="muted">这是只属于你的学习空间。</p>
        <label>
          账号
          <input
            autoComplete="username"
            aria-describedby={error ? "login-error" : undefined}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label>
          密码
          <input
            type="password"
            autoComplete="current-password"
            aria-describedby={error ? "login-error" : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <ErrorBox text={error} id="login-error" />
        <button disabled={busy} className="button">
          {busy ? "正在登录…" : "进入学习空间"}
          <ArrowRight size={17} />
        </button>
        <p className="login-hint">
          首次使用：在项目的 data/local-login.txt 中查看初始账号与密码。
        </p>
      </form>
    </div>
  );
}
