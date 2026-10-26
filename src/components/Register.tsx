"use client";
import { useState } from "react";
import Link from "next/link";
import { BookOpen, ArrowRight } from "lucide-react";
import { defaults } from "../lib/model";
import { api } from "../lib/request";
import { ErrorBox } from "./ui";

export default function Register({
  onRegister,
}: {
  onRegister: (p: typeof defaults) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="login-page">
      <div className="login-story">
        <BookOpen size={36} />
        <span className="eyebrow">CREATE ACCOUNT</span>
        <h1>建立你的研习本</h1>
        <p>
          错题、词汇、长难句。
          <br />
          从今天开始，留下每一次值得回顾的思考。
        </p>
        <div className="login-symbol">
          ∑ <span>→</span> ∞
        </div>
        <small>为 2028 考研，慢慢积累。</small>
      </div>
      <form
        className="login-form"
        aria-busy={busy}
        aria-describedby={error ? "register-error" : undefined}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError("");
          if (password !== confirm) {
            setError("两次输入的密码不一致");
            return;
          }
          setBusy(true);
          try {
            const r = await api<{ settings: typeof defaults }>(
              "auth/register",
              {
                username,
                password,
              },
            );
            onRegister(r.settings);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="eyebrow">JOIN</span>
        <h2>创建你的账号</h2>
        <p className="muted">网站最多容纳 7 个账号，注册后即可使用。</p>
        <label>
          账号
          <input
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-describedby={error ? "register-error" : undefined}
            required
            pattern="[a-zA-Z0-9_.\-]{1,100}"
            title="字母、数字、点、下划线和连字符，长度 1–100"
          />
        </label>
        <label>
          密码
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={error ? "register-error" : undefined}
            required
          />
        </label>
        <label>
          确认密码
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-describedby={error ? "register-error" : undefined}
            required
          />
        </label>
        <ErrorBox text={error} id="register-error" />
        <button disabled={busy} className="button">
          {busy ? "正在创建…" : "创建账号"}
          <ArrowRight size={17} />
        </button>
        <p className="login-hint">
          已有账号？<Link href="/login">直接登录</Link>
        </p>
      </form>
    </div>
  );
}
