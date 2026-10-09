"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function GroupSelect({ groups, value }: { groups: string[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <select
      aria-label="Team group"
      value={value}
      onChange={(e) => {
        const next = new URLSearchParams(sp.toString());
        next.set("group", e.target.value);
        router.push(`${pathname}?${next.toString()}`);
      }}
      className="input w-auto py-1.5 pr-8"
    >
      {groups.map((g) => (
        <option key={g} value={g}>
          {g}
        </option>
      ))}
    </select>
  );
}
