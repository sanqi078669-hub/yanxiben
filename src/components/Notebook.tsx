"use client";
import dynamic from "next/dynamic";
const Editor = dynamic(() => import("./Editor"), {
  loading: () => <p role="status">正在打开页面…</p>,
});
const SettingsPage = dynamic(() => import("./SettingsPage"), {
  loading: () => <p role="status">正在打开页面…</p>,
});
const KnowledgePage = dynamic(() => import("./KnowledgePage"), {
  loading: () => <p role="status">正在打开页面…</p>,
});
const ReviewPage = dynamic(() => import("./ReviewPage"), {
  loading: () => <p role="status">正在打开页面…</p>,
});
const Detail = dynamic(() => import("./Detail"), {
  loading: () => <p role="status">正在打开页面…</p>,
});
const LibraryPage = dynamic(() => import("./LibraryPage"), {
  loading: () => <p role="status">正在打开页面…</p>,
});
const Today = dynamic(() => import("./Today"), {
  loading: () => <p role="status">正在打开页面…</p>,
});
import Login from "./Login";
import { api } from "../lib/request";
import { Empty, ErrorBox } from "./ui";
import { RequestError } from "../lib/request";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  Sun,
  Inbox,
  Library,
  Plus,
  RotateCcw,
  Network,
  Trash2,
  Settings,
  LogOut,
  CheckCircle2,
  CircleAlert,
} from "lucide-react";

import { clearBrowserDrafts } from "../lib/drafts";

import { defaults } from "../lib/model";
export default function Notebook() {
  const queryParams = useSearchParams();
  const pathname = usePathname(),
    router = useRouter();
  const [profile, setProfile] = useState<typeof defaults | null>(null),
    [ready, setReady] = useState(false),
    [profileError, setProfileError] = useState(""),
    [loadAttempt, setLoadAttempt] = useState(0);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);
  useEffect(() => {
    let active = true;
    setReady(false);
    setProfileError("");
    api<typeof defaults>("settings")
      .then((p) => {
        if (active) setProfile(p);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof RequestError && error.status === 401)
          setProfile(null);
        else setProfileError(error.message);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt]);
  const notify = (message: string, tone: "success" | "error" = "success") => {
    setNotice({ message, tone });
    setTimeout(() => setNotice(null), 5000);
  };
  if (!ready) return <div className="loading">研习本 · 正在打开学习空间…</div>;
  if (profileError)
    return (
      <main className="panel form-panel">
        <h1>暂时无法打开学习空间</h1>
        <ErrorBox text={profileError} />
        <button className="button" onClick={() => setLoadAttempt((v) => v + 1)}>
          重试连接
        </button>
      </main>
    );
  if (!profile)
    return (
      <Login
        onLogin={(p) => {
          setProfile(p);
          router.push("/today");
        }}
      />
    );
  const nav = [
    ["/today", "今日学习", Sun],
    ["/inbox", "收集箱", Inbox],
    ["/library", "资料库", Library],
    ["/review", "复习计划", RotateCcw],
    ["/knowledge", "知识地图", Network],
  ] as const;
  const title = pathname.startsWith("/entries")
    ? "学习记录"
    : nav.find(([p]) => pathname.startsWith(p))?.[1] ||
      (pathname === "/settings"
        ? "设置与数据"
        : pathname === "/trash"
          ? "回收站"
          : "今日学习");
  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <Link className="brand" href="/today">
          <span className="brand-icon">
            <BookOpen size={25} />
          </span>
          <span>
            研习本<small>YOUR LEARNING NOTEBOOK</small>
          </span>
        </Link>
        <div className="workspace-tag">
          <span className="dot" />
          个人学习空间 <span>2028 考研</span>
        </div>
        <nav>
          {nav.map(([p, l, I]) => (
            <Link
              className={
                pathname.startsWith(p) || (p === "/today" && pathname === "/")
                  ? "active"
                  : ""
              }
              href={p}
              key={p}
            >
              <I size={19} />
              {l}
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <span>
            每一次回看，
            <br />
            都离理解更近一点。
          </span>
          <div className="line-art">↗</div>
        </div>
        <nav className="secondary">
          <Link href="/trash" className={pathname === "/trash" ? "active" : ""}>
            <Trash2 size={18} />
            回收站
          </Link>
          <Link
            href="/settings"
            className={pathname === "/settings" ? "active" : ""}
          >
            <Settings size={18} />
            设置与数据
          </Link>
        </nav>
        <div className="profile">
          <span className="avatar">{profile.displayName[0]}</span>
          <div>
            <b>{profile.displayName}</b>
            <small>慢慢积累，认真生长</small>
          </div>
          <button
            className="icon-button"
            aria-label="退出登录"
            onClick={async () => {
              await api("auth/logout", {});
              try {
                clearBrowserDrafts();
              } catch {}
              setProfile(null);
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <span>
            学习空间 <span className="slash">/</span> <b>{title}</b>
          </span>
          <div>
            <span className="private-label">
              <span className="dot" />
              私人笔记 · 本地存储
            </span>
            <Link href="/entries/new" className="button small">
              <Plus size={17} />
              收集一条
            </Link>
          </div>
        </header>
        <main key={pathname} id="main-content" tabIndex={-1}>
          {pathname === "/" ||
          pathname === "/today" ||
          pathname === "/login" ? (
            <Today profile={profile} />
          ) : pathname === "/inbox" ||
            pathname === "/library" ||
            pathname === "/trash" ? (
            <LibraryPage mode={pathname.slice(1)} notify={notify} />
          ) : pathname === "/entries/new" ? (
            <Editor />
          ) : pathname.startsWith("/entries/") && pathname.endsWith("/edit") ? (
            <Editor id={pathname.split("/")[2]} />
          ) : pathname.startsWith("/entries/") ? (
            <Detail id={pathname.split("/")[2]} notify={notify} />
          ) : pathname === "/review" ? (
            <ReviewPage
              key={queryParams.get("practice") || "scheduled"}
              notify={notify}
            />
          ) : pathname.startsWith("/knowledge") ? (
            <KnowledgePage notify={notify} timezone={profile.timezone} />
          ) : pathname === "/settings" ? (
            <SettingsPage
              profile={profile}
              onSave={setProfile}
              notify={notify}
            />
          ) : (
            <Empty title="没有找到这个页面" />
          )}
        </main>
        <footer>
          研习本 <span>·</span> 让错误成为下一次的答案。
        </footer>
      </div>
      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={"toast " + notice.tone}
        >
          {notice.tone === "error" ? (
            <CircleAlert size={18} />
          ) : (
            <CheckCircle2 size={18} />
          )}
          {notice.message}
        </div>
      )}
      <nav className="mobile-nav">
        <Link href="/today">
          <Sun />
          今日
        </Link>
        <Link href="/library">
          <Library />
          资料库
        </Link>
        <Link href="/entries/new">
          <Plus />
          收集
        </Link>
        <Link href="/review">
          <RotateCcw />
          复习
        </Link>
        <Link href="/settings">
          <Settings />
          设置
        </Link>
      </nav>
    </div>
  );
}
