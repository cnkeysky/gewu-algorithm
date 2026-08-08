import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/**
 * Renders the canonical problem statement (Markdown with optional image
 * references) into safe webview HTML. Mirrors the web workbench's rendering
 * for the supported subset: headings, lists, code, tables, links, and images
 * from https/data URIs. KaTeX math is left as literal text for now.
 */
export function renderStatement(markdown: string): string {
  const html = marked.parse(markdown, { gfm: true, breaks: false }) as string;
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "strong", "em", "del", "code", "pre", "ul", "ol", "li",
      "blockquote", "h1", "h2", "h3", "h4", "hr", "a", "img", "table",
      "thead", "tbody", "tr", "th", "td", "span",
    ],
    allowedAttributes: {
      a: ["href", "title", "rel", "target"],
      img: ["src", "alt", "title", "width", "height"],
      code: ["class"],
      span: ["class"],
    },
    allowedSchemes: ["http", "https", "data"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
    },
  });
}
