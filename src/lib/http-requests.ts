export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const isHttpMethod = (value: unknown): value is HttpMethod => typeof value === "string" && (HTTP_METHODS as readonly string[]).includes(value);

/** What changes something on the other side: asked twice on a protected environment. */
export const writes = (method: HttpMethod) => method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

/** A name usable as `{{name}}`. */
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]{0,63})\s*\}\}/g;

export type Variable = { name: string; value: string; secret: boolean };

/**
 * `{{name}}` replaced by its value. `shown` is the same text with each secret value masked, to
 * keep and display; `missing` lists the names that have no value.
 */
export function substitute(template: string, variables: Variable[]): { text: string; shown: string; missing: string[] } {
  const byName = new Map(variables.map((variable) => [variable.name, variable]));
  const missing = new Set<string>();
  const replace = (masked: boolean) =>
    template.replace(PLACEHOLDER, (whole, name: string) => {
      const variable = byName.get(name);
      if (!variable) {
        missing.add(name);
        return whole;
      }
      return masked && variable.secret ? "••••" : variable.value;
    });
  return { text: replace(false), shown: replace(true), missing: [...missing] };
}

/** The names a text uses, for the editor to say which are not defined. */
export const placeholdersIn = (text: string) => [...new Set([...text.matchAll(PLACEHOLDER)].map(([, name]) => name))];

/** A header's name as HTTP allows it. */
export const isHeaderName = (name: string) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name);

/** A secret value showing anyway: the headers that carry credentials are masked in what is kept. */
const CREDENTIAL_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "api-key"]);
export const maskHeader = ([name, value]: [string, string]): [string, string] => [name, CREDENTIAL_HEADERS.has(name.toLowerCase()) ? "••••" : value];

/** JSON indented when it is JSON, else as it came. */
export function prettyBody(body: string, contentType: string | null): string {
  if (!/json/i.test(contentType ?? "") && !/^\s*[[{]/.test(body)) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

/** 2xx fine, 3xx elsewhere, 4xx asked wrong, 5xx broken. */
export const statusTone = (status: number | null) => (status === null ? "error" : status < 300 ? "ok" : status < 400 ? "redirect" : status < 500 ? "client" : "server");
