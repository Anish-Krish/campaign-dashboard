"use client";

import { useState, type ReactNode } from "react";

export function ViewTabs({ tabs }: { tabs: { label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(0);

  return (
    <div>
      <div className="hud-panel mb-4 inline-flex p-1">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            type="button"
            onClick={() => setActive(i)}
            className="hud-heading cursor-pointer rounded px-4 py-1.5 text-xs transition"
            style={
              active === i
                ? { background: "var(--series-blue)", color: "#04211f" }
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
