import type { Messages } from "@/i18n";
import type { ContainerFact } from "@/server/db/schema";
import type { DockerStack } from "@/server/docker-stack";
import { DATA, LABEL } from "../../ui";

const CELL = "border-b border-rule py-2 pr-4 align-top";

/** What the project declares, next to what Docker actually runs for it. */
export function DockerComponents({
  stack,
  containers,
  m,
}: {
  stack: DockerStack | null;
  containers: ContainerFact[];
  m: Messages["sheet"]["dockerComponents"];
}) {
  const components = stack?.components ?? [];
  const declared = new Set(components.map(({ service }) => service));
  const undeclared = containers.filter((container) => !declared.has(container.service));
  const stateOf = (service: string) => containers.find((container) => container.service === service);
  const State = ({ container }: { container?: ContainerFact }) => (
    <span className={container?.state === "running" ? "" : "text-mut"}>{container?.status ?? "—"}</span>
  );

  return (
    <>
      {stack?.invalidFiles.map((file) => (
        <p key={file} role="alert" className={`${DATA} mb-2 text-alert`}>
          {m.invalidFile(file)}
        </p>
      ))}
      {components.length === 0 && undeclared.length === 0 ? (
        <p className="text-mut">{m.none}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-rule-strong">
                {[m.service, m.image, m.version, m.source, m.ports, m.state].map((title) => (
                  <th key={title} scope="col" className={`${LABEL} pr-4 pb-1.5 font-normal`}>
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {components.map(({ service, images, builtFrom, sources, ports }) => (
                <tr key={service}>
                  <th scope="row" className={`${CELL} font-semibold`}>
                    {service}
                  </th>
                  <td className={`${CELL} ${DATA}`}>
                    {images.length === 0 ? <span className="text-mut">{m.unknownImage}</span> : null}
                    {images.map(({ name, version }) => (
                      <div key={`${name}:${version}`} className="break-all">
                        {name}
                      </div>
                    ))}
                  </td>
                  <td className={`${CELL} ${DATA} font-medium text-accent`}>
                    {images.map(({ name, version }) => (
                      <div key={`${name}:${version}`} className="break-all">
                        {version}
                      </div>
                    ))}
                  </td>
                  <td className={`${CELL} ${DATA} break-all text-mut`}>{builtFrom ?? sources.join(", ")}</td>
                  <td className={`${CELL} ${DATA}`}>
                    {ports.length === 0 ? <span className="text-mut">—</span> : ports.map((port) => <div key={port}>{port}</div>)}
                  </td>
                  <td className={`${CELL} ${DATA}`}>
                    <State container={stateOf(service)} />
                  </td>
                </tr>
              ))}
              {undeclared.map((container) => (
                <tr key={container.name}>
                  <th scope="row" className={`${CELL} font-semibold`}>
                    {container.service || container.name}
                  </th>
                  <td colSpan={2} className={`${CELL} text-mut`}>
                    {m.notDeclared}
                  </td>
                  <td className={`${CELL} ${DATA} text-mut`}>—</td>
                  <td className={`${CELL} ${DATA} break-words`}>{container.ports || "—"}</td>
                  <td className={`${CELL} ${DATA}`}>
                    <State container={container} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
