"use client";
import { useState } from "react";
import Image from "next/image";

import { BookOpen, ArrowRight } from "lucide-react";

import { defaults } from "../lib/model";
import { api } from "../lib/request";
import { ErrorBox } from "./ui";
import PasswordInput from "./PasswordInput";
import styles from "./Login.module.css";
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
    <div className={styles.page}>
      <header className={styles.masthead}>
        <div className={styles.brand}>
          <BookOpen size={38} strokeWidth={1.4} aria-hidden="true" />
          <span>研习本</span>
        </div>
        <span className={styles.spaceLabel}>个人学习空间</span>
      </header>
      <main className={styles.spread}>
        <section className={styles.story} aria-labelledby="login-story-title">
          <p className={styles.columnLabel}>研习本 / PRIVATE LEARNING SPACE</p>
          <h1 id="login-story-title">
            把每一次思考，
            <br />
            变成向前的一步。
          </h1>
          <p className={styles.annotation}>
            错题、词汇、长难句。
            <span className={styles.description}>
              收集当下的疑问，留给下一次更清晰的自己。
            </span>
          </p>
          <Image
            className={styles.engraving}
            src="/login/study-engraving.webp"
            alt=""
            width={960}
            height={640}
            sizes="(max-width: 760px) 1px, (max-width: 1100px) 42vw, 480px"
          />
        </section>
        <form
          className={styles.form}
          aria-labelledby="login-form-title"
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
          <p className={styles.welcome}>WELCOME BACK</p>
          <h2 id="login-form-title">打开你的研习本</h2>
          <p className={styles.introduction}>这是只属于你的学习空间。</p>
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
            <PasswordInput
              aria-label="密码"
              autoComplete="current-password"
              aria-describedby={error ? "login-error" : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <ErrorBox text={error} id="login-error" />
          <button disabled={busy} className={styles.submit}>
            {busy ? "正在登录…" : "进入学习空间"}
            <ArrowRight size={17} />
          </button>
          <p className={styles.help}>
            受邀使用：请向维护人领取账号。忘记密码时请联系维护人重置。
          </p>
          <p className={styles.registration}>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            还没有账号？<a href="/register">创建账号</a>
          </p>
        </form>
      </main>
      <footer className={styles.footer}>为 2028 考研，慢慢积累。</footer>
    </div>
  );
}
