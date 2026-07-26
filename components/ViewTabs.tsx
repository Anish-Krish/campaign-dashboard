"use client";

import { useState, type ReactNode } from "react";

export function ViewTabs({ tabs }: { tabs: { label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(0);

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border p-1" style={{ borderColor: "var(--border-hairline)" }}>
        {tabs.map((t, i) => (
          <button
            key={t.label}
            type="button"
            onClick={() => setActive(i)}
            className="cursor-pointer rounded px-4 py-1.5 text-sm font-medium transition"
            style={
              active === i
                ? { background: "var(--series-blue)", color: "#fff" }
                : { color: "var(--text-secondary)" }
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs[active].content}
    </div>
  );
}
