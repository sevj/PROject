"use client";

import bcrypt from "bcryptjs";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import { useMessages } from "@/i18n/provider";
import {
  type CronField,
  type CronFieldName,
  decodeBase64,
  decodeJwt,
  encodeBase64,
  formatJson,
  generatePassword,
  nextRuns,
  parseCron,
  type PasswordClass,
  readTimestamp,
  uuidV4,
  uuidV7,
} from "@/lib/tools";
import { copyText } from "../clipboard";
import { useFlash } from "../flash";
import { BADGE, BADGE_ALERT, BUTTON, BUTTON_SMALL, CARD, CHECKBOX, DATA, FIELD, LABEL, SECTION_TITLE, SEGMENT_SMALL, PAGE_TITLE } from "../ui";

const AREA = `${FIELD} ${DATA} min-h-24 py-2 placeholder:text-mut`;
const OUTPUT = `${DATA} max-h-80 overflow-auto border border-rule bg-field p-2 break-all whitespace-pre-wrap`;

/** Random values and the clock differ between the server and the browser: the tools start once in the browser. */
const useInBrowser = () =>
  useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

export function ToolsView() {
  const m = useMessages().tools;
  const inBrowser = useInBrowser();
  return (
    <section className="grid gap-4">
      <div>
        <h1 className={PAGE_TITLE}>{m.title}</h1>
      </div>
      {inBrowser ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <PasswordTool />
          <UuidTool />
          <BcryptTool />
          <JwtTool />
          <TimestampTool />
          <Base64Tool />
          <JsonTool />
          <CronTool />
        </div>
      ) : null}
    </section>
  );
}

function Tool({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${CARD} grid min-w-0 gap-3`}>
      <h2 className={SECTION_TITLE}>{title}</h2>
      {children}
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const m = useMessages().tools;
  const flash = useFlash();
  return (
    <button
      type="button"
      disabled={!text}
      onClick={() =>
        void copyText(text).then((done) => {
          if (done) flash("success", m.copied);
        })
      }
      className={BUTTON_SMALL}
    >
      {m.copy}
    </button>
  );
}

/** A result on one line, with its copy button. */
function Line({ label, value }: { label?: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      {label ? <span className={`${LABEL} w-28 shrink-0`}>{label}</span> : null}
      <code className={`${DATA} min-w-0 flex-1 border border-rule bg-field px-2 py-1.5 break-all`}>{value}</code>
      <CopyButton text={value} />
    </div>
  );
}

const CLASSES: PasswordClass[] = ["lower", "upper", "digits", "symbols"];

function PasswordTool() {
  const m = useMessages().tools;
  const [length, setLength] = useState(20);
  const [classes, setClasses] = useState<PasswordClass[]>(CLASSES);
  const [ambiguous, setAmbiguous] = useState(false);
  const [value, setValue] = useState(() => generatePassword({ length: 20, classes: CLASSES, ambiguous: false }));
  const make = (patch: Partial<{ length: number; classes: PasswordClass[]; ambiguous: boolean }> = {}) => {
    const options = { length, classes, ambiguous, ...patch };
    setLength(options.length);
    setClasses(options.classes);
    setAmbiguous(options.ambiguous);
    setValue(generatePassword(options));
  };
  return (
    <Tool title={m.password.title}>
      <Line value={value} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className={LABEL}>{m.password.length}</span>
          <input
            type="number"
            min={4}
            max={128}
            value={length}
            onChange={(event) => make({ length: Math.min(128, Math.max(4, Number(event.target.value) || 4)) })}
            className={`${FIELD} ${DATA} !w-20`}
          />
        </label>
        <div className="flex flex-wrap gap-1" role="group">
          {CLASSES.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={classes.includes(name)}
              onClick={() => {
                const next = classes.includes(name) ? classes.filter((item) => item !== name) : CLASSES.filter((item) => item === name || classes.includes(item));
                if (next.length > 0) make({ classes: next });
              }}
              className={SEGMENT_SMALL}
            >
              {m.password.classes[name]}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => make()} className={BUTTON_SMALL}>
          {m.generate}
        </button>
      </div>
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" className={CHECKBOX} checked={ambiguous} onChange={(event) => make({ ambiguous: event.target.checked })} />
        {m.password.ambiguous}
      </label>
    </Tool>
  );
}

function makeUuids(version: "v4" | "v7", count: number) {
  return Array.from({ length: count }, () => (version === "v4" ? uuidV4(crypto.getRandomValues(new Uint8Array(16))) : uuidV7(Date.now(), crypto.getRandomValues(new Uint8Array(10))))).join("\n");
}

function UuidTool() {
  const m = useMessages().tools;
  const [version, setVersion] = useState<"v4" | "v7">("v4");
  const [count, setCount] = useState(1);
  const [value, setValue] = useState(() => makeUuids("v4", 1));
  const make = (nextVersion = version, nextCount = count) => {
    setVersion(nextVersion);
    setCount(nextCount);
    setValue(makeUuids(nextVersion, nextCount));
  };
  return (
    <Tool title={m.uuid.title}>
      {count === 1 ? <Line value={value} /> : <pre className={OUTPUT}>{value}</pre>}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1" role="group">
          {(["v4", "v7"] as const).map((item) => (
            <button key={item} type="button" aria-pressed={version === item} onClick={() => make(item)} className={SEGMENT_SMALL}>
              {m.uuid[item]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <span className={LABEL}>{m.uuid.count}</span>
          <input type="number" min={1} max={50} value={count} onChange={(event) => make(version, Math.min(50, Math.max(1, Number(event.target.value) || 1)))} className={`${FIELD} ${DATA} !w-20`} />
        </label>
        <button type="button" onClick={() => make()} className={BUTTON_SMALL}>
          {m.generate}
        </button>
        {count > 1 ? <CopyButton text={value} /> : null}
      </div>
    </Tool>
  );
}

const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

function BcryptTool() {
  const m = useMessages().tools.bcrypt;
  const [password, setPassword] = useState("");
  const [cost, setCost] = useState(10);
  const [hash, setHash] = useState("");
  const [hashing, setHashing] = useState(false);
  const [against, setAgainst] = useState("");
  const [matches, setMatches] = useState<boolean | null>(null);

  const check = async (candidate: string, typed: string) => {
    setMatches(BCRYPT_HASH.test(typed.trim()) ? await bcrypt.compare(candidate, typed.trim()) : null);
  };

  return (
    <Tool title={m.title}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[200px] flex-1">
          <span className={`${LABEL} block pb-1`}>{m.password}</span>
          <input
            value={password}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setPassword(event.target.value);
              void check(event.target.value, against);
            }}
            className={`${FIELD} ${DATA}`}
          />
        </label>
        <label>
          <span className={`${LABEL} block pb-1`}>{m.cost}</span>
          <select value={cost} onChange={(event) => setCost(Number(event.target.value))} className={`${FIELD} !w-20`}>
            {[4, 6, 8, 10, 11, 12, 13, 14].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={hashing}
          onClick={() => {
            setHashing(true);
            void bcrypt
              .hash(password, cost)
              .then(setHash)
              .finally(() => setHashing(false));
          }}
          className={BUTTON}
        >
          {hashing ? m.hashing : m.hash}
        </button>
      </div>
      {hash ? <Line value={hash} /> : null}
      <label>
        <span className={`${LABEL} block pb-1`}>{m.check}</span>
        <input
          value={against}
          spellCheck={false}
          placeholder="$2y$10$…"
          onChange={(event) => {
            setAgainst(event.target.value);
            void check(password, event.target.value);
          }}
          className={`${FIELD} ${DATA} placeholder:text-mut`}
        />
      </label>
      {against.trim() ? (
        !BCRYPT_HASH.test(against.trim()) ? (
          <p className="text-alert">{m.invalid}</p>
        ) : matches === null ? null : (
          <p className={matches ? "text-ok" : "text-alert"}>{matches ? m.matches : m.differs}</p>
        )
      ) : null}
    </Tool>
  );
}

function JwtTool() {
  const m = useMessages().tools.jwt;
  const [token, setToken] = useState("");
  const [now] = useState(() => Date.now());
  const decoded = token.trim() ? decodeJwt(token, now) : null;
  return (
    <Tool title={m.title}>
      <textarea aria-label={m.token} value={token} spellCheck={false} placeholder="eyJhbGciOi…" onChange={(event) => setToken(event.target.value)} className={AREA} />
      {token.trim() && !decoded ? <p className="text-alert">{m.invalid}</p> : null}
      {decoded ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {decoded.expired === null ? null : <span className={decoded.expired ? BADGE_ALERT : BADGE}>{decoded.expired ? m.expired : m.valid}</span>}
            {decoded.times.map(({ name, at }) => (
              <span key={name} className={`${DATA} text-mut`}>
                {m.times[name]} {new Date(at).toLocaleString()}
              </span>
            ))}
          </div>
          <span className={LABEL}>{m.header}</span>
          <pre className={OUTPUT}>{JSON.stringify(decoded.header, null, 2)}</pre>
          <span className={LABEL}>{m.payload}</span>
          <pre className={OUTPUT}>{JSON.stringify(decoded.payload, null, 2)}</pre>
          <p className="text-[12px] text-mut">{m.unverified}</p>
        </>
      ) : null}
    </Tool>
  );
}

function TimestampTool() {
  const m = useMessages().tools.timestamp;
  const [input, setInput] = useState(() => String(Math.floor(Date.now() / 1000)));
  const at = readTimestamp(input);
  const date = at === null ? null : new Date(at);
  const valid = date !== null && !Number.isNaN(date.getTime());
  return (
    <Tool title={m.title}>
      <div className="flex gap-2">
        <input aria-label={m.title} value={input} spellCheck={false} onChange={(event) => setInput(event.target.value)} className={`${FIELD} ${DATA}`} />
        <button type="button" onClick={() => setInput(String(Math.floor(Date.now() / 1000)))} className={BUTTON}>
          {m.now}
        </button>
      </div>
      <p className="text-[12px] text-mut">{m.hint}</p>
      {input.trim() && !valid ? <p className="text-alert">{m.invalid}</p> : null}
      {valid && date ? (
        <div className="grid gap-1.5">
          <Line label={m.local} value={date.toLocaleString()} />
          <Line label={m.utc} value={date.toUTCString()} />
          <Line label={m.iso} value={date.toISOString()} />
          <Line label={m.seconds} value={String(Math.floor(date.getTime() / 1000))} />
          <Line label={m.milliseconds} value={String(date.getTime())} />
        </div>
      ) : null}
    </Tool>
  );
}

function Base64Tool() {
  const m = useMessages().tools;
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"encode" | "decode">("encode");
  const [urlSafe, setUrlSafe] = useState(false);
  const output = mode === "encode" ? encodeBase64(input, urlSafe) : input.trim() ? decodeBase64(input) : "";
  return (
    <Tool title={m.base64.title}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1" role="group">
          {(["encode", "decode"] as const).map((item) => (
            <button key={item} type="button" aria-pressed={mode === item} onClick={() => setMode(item)} className={SEGMENT_SMALL}>
              {m.base64[item]}
            </button>
          ))}
        </div>
        {mode === "encode" ? (
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" className={CHECKBOX} checked={urlSafe} onChange={(event) => setUrlSafe(event.target.checked)} />
            {m.base64.urlSafe}
          </label>
        ) : null}
      </div>
      <textarea aria-label={m.input} value={input} spellCheck={false} onChange={(event) => setInput(event.target.value)} className={AREA} />
      {output === null ? (
        <p className="text-alert">{m.base64.invalid}</p>
      ) : output ? (
        <div className="grid gap-1">
          <pre className={OUTPUT}>{output}</pre>
          <div>
            <CopyButton text={output} />
          </div>
        </div>
      ) : null}
    </Tool>
  );
}

function JsonTool() {
  const m = useMessages().tools;
  const [input, setInput] = useState("");
  const [indent, setIndent] = useState(2);
  const result = input.trim() ? formatJson(input, indent) : null;
  return (
    <Tool title={m.json.title}>
      <div className="flex gap-1" role="group">
        {[
          [2, m.json.pretty],
          [0, m.json.minify],
        ].map(([value, label]) => (
          <button key={value} type="button" aria-pressed={indent === value} onClick={() => setIndent(value as number)} className={SEGMENT_SMALL}>
            {label}
          </button>
        ))}
      </div>
      <textarea aria-label={m.input} value={input} spellCheck={false} placeholder='{"a": 1}' onChange={(event) => setInput(event.target.value)} className={AREA} />
      {result && "error" in result ? (
        <p className="text-alert">
          {m.json.error(result.line, result.column)}
          <span className={`${DATA} block text-mut`}>{result.error}</span>
        </p>
      ) : null}
      {result && "output" in result ? (
        <div className="grid gap-1">
          <pre className={OUTPUT}>{result.output}</pre>
          <div>
            <CopyButton text={result.output} />
          </div>
        </div>
      ) : null}
    </Tool>
  );
}

/** 1,2,3,5 reads 1–3, 5. */
function compact(values: number[], name: (value: number) => string): string {
  const parts: string[] = [];
  for (let index = 0; index < values.length; index++) {
    let end = index;
    while (end + 1 < values.length && values[end + 1] === values[end] + 1) end++;
    parts.push(end - index >= 2 ? `${name(values[index])}–${name(values[end])}` : values.slice(index, end + 1).map(name).join(", "));
    index = end;
  }
  return parts.join(", ");
}

function CronTool() {
  const m = useMessages().tools.cron;
  const [input, setInput] = useState("*/15 9-18 * * MON-FRI");
  const [now] = useState(() => Date.now());
  const cron = parseCron(input);
  const name = (field: CronFieldName) => (value: number) => (field === "dayOfWeek" ? m.days[value] : field === "month" ? m.months[value - 1] : String(value));
  const describe = (field: CronFieldName, read: CronField) =>
    read.kind === "all" ? m.every[field] : read.kind === "every" ? m.step(read.step, m.fieldNames[field]) : m.listed(m.fieldNames[field], compact(read.values, name(field)));
  const runs = "fields" in cron ? nextRuns(cron, now, 5) : [];
  const bothDays = "fields" in cron && cron.fields.dayOfMonth.kind !== "all" && cron.fields.dayOfWeek.kind !== "all";
  return (
    <Tool title={m.title}>
      <input aria-label={m.title} value={input} spellCheck={false} onChange={(event) => setInput(event.target.value)} className={`${FIELD} ${DATA}`} />
      <p className="text-[12px] text-mut">{m.hint}</p>
      {"fields" in cron ? (
        <>
          <ul className="grid gap-0.5">
            {(Object.keys(cron.fields) as CronFieldName[]).map((field) => (
              <li key={field}>{describe(field, cron.fields[field])}</li>
            ))}
          </ul>
          {bothDays ? <p className="text-[12px] text-mut">{m.dayRule}</p> : null}
          <span className={LABEL}>{m.next}</span>
          {runs.length === 0 ? (
            <p className="text-mut">{m.never}</p>
          ) : (
            <ul className={`${DATA} grid gap-0.5`}>
              {runs.map((at) => (
                <li key={at}>{new Date(at).toLocaleString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="text-alert">{m.invalid(cron.field === null ? null : m.fieldNames[cron.field], cron.text)}</p>
      )}
    </Tool>
  );
}
