import { redirect } from "next/navigation";

// Team Performance is the home page; the old campaign dashboard lives under /archive.
export default function Home() {
  redirect("/team");
}
