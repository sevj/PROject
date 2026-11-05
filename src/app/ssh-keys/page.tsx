import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { listSshKeys } from "@/server/ssh-keys";
import { LoadingFallback } from "../loading-fallback";
import { SshKeysView } from "./ssh-keys-view";

async function SshKeys() {
  await connection();
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 pt-6 pb-10">
      <SshKeysView {...await listSshKeys(getDb())} />
    </main>
  );
}

export default function SshKeysPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SshKeys />
    </Suspense>
  );
}
