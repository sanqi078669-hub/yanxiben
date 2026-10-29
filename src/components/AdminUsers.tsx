"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "../lib/request";
import { ErrorBox } from "./ui";
import styles from "./JournalFinal.module.css";

type User = {
  id: string;
  username: string;
  role: string;
  disabled: boolean;
  entriesCount: number;
  sessionsCount: number;
};

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [owner, setOwner] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const [deleting, setDeleting] = useState<Pick<
    User,
    "id" | "username"
  > | null>(null);
  const [confirmInput, setConfirmInput] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  const refresh = useCallback(async () => {
    const result = await api<{ users: User[] }>("admin/users");
    setUsers(result.users);
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([
      api<{ users: User[] }>("admin/users"),
      api<{ owner: string }>("auth/identity"),
    ])
      .then(([list, identity]) => {
        if (active) {
          setUsers(list.users);
          setOwner(identity.owner);
        }
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (deleting) dialog.current?.showModal();
    else dialog.current?.close();
  }, [deleting]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  function notify(message: string, tone: "success" | "error" = "success") {
    setNotice({ message, tone });
  }
  async function act(
    user: Pick<User, "id" | "username">,
    action: "disable" | "enable" | "delete",
  ) {
    if (submitting.current) return;
    if (action === "disable" && !confirm("禁用后该用户将无法登录，确认？"))
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (action === "delete")
        await api(`admin/users/${user.id}`, undefined, "DELETE");
      else await api(`admin/users/${user.id}/${action}`, {}, "POST");
      setDeleting(null);
      await refresh();
      notify(
        action === "delete"
          ? "用户已删除"
          : action === "disable"
            ? "用户已禁用"
            : "用户已启用",
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "操作失败，请稍后重试";
      setError(message);
      notify(message, "error");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      className={`panel form-panel ${styles.admin}`}
      aria-busy={loading || busy}
    >
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRATION</span>
          <h1>账号管理</h1>
          {!loading && !error && (
            <p className={styles.slots}>
              已注册 {users.length} / 7，剩余 {Math.max(7 - users.length, 0)}{" "}
              个名额
            </p>
          )}
        </div>
        <Link href="/today" className="button outline">
          返回研习本
        </Link>
      </div>
      <ErrorBox text={error} />
      {loading ? (
        <p role="status">正在加载用户…</p>
      ) : (
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="注册用户列表，可横向滚动"
        >
          <table>
            <caption>注册用户列表</caption>
            <thead>
              <tr>
                <th scope="col">账号</th>
                <th scope="col">角色</th>
                <th scope="col">状态</th>
                <th scope="col">学习记录</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    {user.username}
                    {user.id === owner ? "（自己）" : ""}
                  </td>
                  <td>{user.role === "admin" ? "管理员" : "普通用户"}</td>
                  <td>
                    <span
                      className={`badge ${user.disabled ? "admin-status-danger" : "admin-status-ok"}`}
                    >
                      {user.disabled ? "已禁用" : "正常"}
                    </span>
                  </td>
                  <td>{user.entriesCount}</td>
                  <td>
                    <button
                      className="button outline"
                      title={
                        user.id === owner ? "不能对自己执行此操作" : undefined
                      }
                      disabled={
                        busy || !owner || (!user.disabled && user.id === owner)
                      }
                      onClick={() =>
                        act(user, user.disabled ? "enable" : "disable")
                      }
                    >
                      {user.disabled ? "启用" : "禁用"}
                    </button>{" "}
                    <button
                      className="danger-button"
                      title={
                        user.id === owner ? "不能对自己执行此操作" : undefined
                      }
                      disabled={busy || !owner || user.id === owner}
                      onClick={() => {
                        setConfirmInput("");
                        setDeleting({ id: user.id, username: user.username });
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <dialog
        ref={dialog}
        className="panel form-panel"
        aria-labelledby="delete-user-title"
        aria-describedby="delete-user-warning"
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setDeleting(null);
        }}
      >
        <h2 id="delete-user-title">删除账号 {deleting?.username}</h2>
        <p id="delete-user-warning">
          该用户的所有学习数据（错题、词汇、复习记录、知识节点等）将被永久删除，无法恢复。附件文件保留在服务器但不影响新用户。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (deleting && confirmInput === deleting.username)
              void act(deleting, "delete");
          }}
        >
          <label htmlFor="delete-user-confirm">输入用户名确认</label>
          <input
            id="delete-user-confirm"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            autoComplete="off"
            required
            disabled={busy}
          />
          <ErrorBox text={error} />
          <button
            className="danger-button"
            disabled={busy || !deleting || confirmInput !== deleting.username}
          >
            {busy ? "处理中…" : "确认删除"}
          </button>{" "}
          <button
            className="button outline"
            type="button"
            disabled={busy}
            onClick={() => setDeleting(null)}
          >
            取消
          </button>
        </form>
      </dialog>
      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={"toast " + notice.tone}
        >
          {notice.message}
        </div>
      )}
    </section>
  );
}
