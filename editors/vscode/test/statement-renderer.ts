import { renderStatement } from "../src/statement-renderer.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function has(html: string, needle: string): boolean {
  return html.includes(needle);
}

const statement = [
  "Given a string s, determine if it is valid.",
  "",
  "![Example diagram](https://assets.example.com/diagram.png)",
  "",
  "- Open brackets must close in order.",
  "- `stack` is the reviewed structure.",
  "",
  "See [the note](https://example.com/note).",
].join("\n");

const html = renderStatement(statement);
assert(has(html, "src=\"https://assets.example.com/diagram.png\"") && has(html, "alt=\"Example diagram\""), "image must render with src and alt");
assert(has(html, "<li>Open brackets must close in order.</li>"), "list must render");
assert(has(html, "<code>stack</code>"), "inline code must render");
assert(has(html, "target=\"_blank\""), "links must open in a new tab");

const scriptInjected = renderStatement("text <script>alert(1)</script> ![x](javascript:alert(1))");
assert(!has(scriptInjected, "<script>"), "scripts must be stripped");
assert(!has(scriptInjected, "javascript:"), "javascript: URLs must be stripped");

const dataImage = renderStatement("![inline](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)");
assert(has(dataImage, "data:image/gif"), "data URIs must stay allowed for images");

console.log("statement-renderer: ok");
