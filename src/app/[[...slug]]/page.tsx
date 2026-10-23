import Notebook from "../../components/Notebook";
import { Suspense } from "react";
export default function Page() {
  return (
    <Suspense fallback={<div className="loading">正在打开研习本…</div>}>
      <Notebook />
    </Suspense>
  );
}
