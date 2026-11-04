import { type NextRequest, NextResponse } from "next/server";
import { isLocalRequest } from "@/lib/local-request";

export function proxy(request: NextRequest) {
  const allowed = isLocalRequest({
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
  });
  if (!allowed) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return NextResponse.next();
}
