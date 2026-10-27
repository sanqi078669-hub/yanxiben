"use client";

import { useState, type ComponentPropsWithoutRef } from "react";
import { Eye, EyeOff } from "lucide-react";

export default function PasswordInput(
  props: Omit<ComponentPropsWithoutRef<"input">, "type">,
) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <span className="password-field">
      <input {...props} type={visible ? "text" : "password"} />
      <button
        className="password-toggle"
        type="button"
        aria-label={visible ? "隐藏密码" : "显示密码"}
        aria-pressed={visible}
        disabled={props.disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setVisible((value) => !value)}
      >
        <Icon size={16} aria-hidden="true" />
      </button>
    </span>
  );
}
