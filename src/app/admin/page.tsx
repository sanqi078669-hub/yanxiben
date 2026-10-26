"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, RequestError } from "@/lib/request";
import AdminUsers from "@/components/AdminUsers";
import { ErrorBox } from "@/components/ui";

export default function AdminPage() {
  const router = useRouter();
  const [status, setStatus] = useState<
    "loading" | "ok" | "forbidden" | "unauth" | "error"
  >("loading");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api("admin/users")
      .then(() => {
        if (active) setStatus("ok");
      })
      .catch((e: unknown) => {
        if (!active) return;
        if (e instanceof RequestError && e.status === 401) {
          setStatus("unauth");
          router.replace("/login");
        } else if (e instanceof RequestError && e.status === 403) {
          setStatus("forbidden");
        } else {
          setError(e instanceof Error ? e.message : "加载失败");
          setStatus("error");
        }
      });
    return () => {
      active = false;
    };
  }, [router]);
  if (status === "loading")
    return (
      <div className="loading" role="status">
        正在加载…
      </div>
    );
  if (status === "unauth") return null;
  if (status !== "ok")
    return (
      <div className="login-page">
        <div className="login-form">
          <h2>{status === "forbidden" ? "无权访问" : "暂时无法加载"}</h2>
          {status === "forbidden" ? (
            <p className="muted">此页面仅限管理员访问。</p>
          ) : (
            <ErrorBox text={error} />
          )}
          <Link href="/today" className="button">
            返回
          </Link>
        </div>
      </div>
    );
  return (
    <main className="admin-page">
      <AdminUsers />
    </main>
  );
}
