"use client";

export default function ErrorPage({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <main className="panel form-panel" role="alert">
      <h1>页面暂时无法显示</h1>
      <p>读取或显示内容时发生错误。可以重试，或返回今日学习。</p>
      <button className="button" onClick={retry}>
        重试加载页面
      </button>
      <a className="button outline" href="/today">
        返回今日学习
      </a>
    </main>
  );
}
