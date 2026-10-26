"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Register from "@/components/Register";
import type { defaults } from "@/lib/model";

export default function RegisterPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<typeof defaults | null>(null);

  if (profile) {
    return (
      <div className="loading" role="status">
        正在打开研习本…
      </div>
    );
  }

  return (
    <Register
      onRegister={(p) => {
        setProfile(p);
        router.push("/");
      }}
    />
  );
}
