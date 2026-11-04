import Link from "next/link";
import ReactMarkdown from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { resolveDocLink, stripFrontMatter } from "@/lib/docs";

/** Raw HTML stays disabled: a document found on disk must not run anything in this page. */
export function MarkdownDoc({
  content,
  file,
  docs,
  projectId,
}: {
  content: string;
  file: string;
  docs: string[];
  projectId: number;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        components={{
          a({ href, children }) {
            const link = resolveDocLink(href, file, docs);
            if (link.kind === "external") {
              return (
                <a href={link.href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              );
            }
            if (link.kind === "anchor") return <a href={link.href}>{children}</a>;
            if (link.kind === "document") {
              const hash = link.hash ? `#${link.hash}` : "";
              return (
                <Link href={`/projects/${projectId}?tab=documentation&doc=${encodeURIComponent(link.file)}${hash}`}>
                  {children}
                </Link>
              );
            }
            return <>{children}</>;
          },
          // A local image has no address here, and a remote one would call out from a local app.
          img({ alt }) {
            return alt ? <span className="markdown-image">{alt}</span> : null;
          },
          table({ children }) {
            return (
              <div className="markdown-table">
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {stripFrontMatter(content)}
      </ReactMarkdown>
    </div>
  );
}
