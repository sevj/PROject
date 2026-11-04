import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { displayPath } from "@/server/registry";
import { getSettings } from "@/server/settings";

export async function RootLabel() {
  await connection();
  return <span className="font-mono text-[12.5px] text-mut">{displayPath(getSettings(getDb()).root)}</span>;
}
