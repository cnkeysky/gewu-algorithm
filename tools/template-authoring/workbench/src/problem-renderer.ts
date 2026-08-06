import DOMPurify from "dompurify";
import katex from "katex";
import "katex/dist/katex.min.css";
import { marked } from "marked";

type MathFragment = { token: string; html: string };

export function renderProblemStatement(markdown: string): string {
  const fragments: MathFragment[] = [];
  const protect = (source: string, displayMode: boolean): string => {
    const token = `GEWU_MATH_${fragments.length}_TOKEN`;
    const html = katex.renderToString(source.trim(), {
      displayMode,
      throwOnError: false,
      strict: "warn",
      trust: false,
    });
    fragments.push({ token, html });
    return token;
  };

  const protectedMarkdown = markdown
    .replace(/\$\$([\s\S]+?)\$\$/g, (_match, source: string) => protect(source, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, source: string) => protect(source, true))
    .replace(/\\\((.+?)\\\)/g, (_match, source: string) => protect(source, false))
    .replace(/(^|[^\\])\$([^$\n]+?)\$/g, (_match, prefix: string, source: string) => `${prefix}${protect(source, false)}`);

  let html = marked.parse(protectedMarkdown, { gfm: true, breaks: false }) as string;
  for (const fragment of fragments) html = html.replaceAll(fragment.token, fragment.html);
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true, svg: true } });
}
