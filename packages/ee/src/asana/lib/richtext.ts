/**
 * Utilities for bidirectional conversion between HTML (Asana html_notes format)
 * and Tiptap JSON (Carbon's rich text format).
 *
 * Asana uses a limited HTML subset for the `html_notes` field:
 * <strong>, <em>, <u>, <s>, <a>, <ul>, <ol>, <li>, <code>, <br>, <h1>-<h6>
 */

export type TiptapNode = {
  type: string;
  attrs?: Record<string, any>;
  content?: TiptapNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, any> }[];
};

export type TiptapDocument = {
  type: "doc";
  content: TiptapNode[];
};

/**
 * Convert Asana HTML to Tiptap JSON format.
 * Used when syncing from Asana → Carbon.
 */
export function htmlToTiptap(html: string | null | undefined): TiptapDocument {
  if (!html || !html.trim()) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }

  // Strip the <body> wrapper Asana sometimes adds
  const body = html
    .replace(/^<body>/, "")
    .replace(/<\/body>$/, "")
    .trim();
  if (!body) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }

  const content = parseBlockElements(body);

  if (content.length === 0) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }

  return { type: "doc", content };
}

function parseBlockElements(html: string): TiptapNode[] {
  const nodes: TiptapNode[] = [];
  let remaining = html;

  while (remaining.length > 0) {
    remaining = remaining.trimStart();
    if (!remaining) break;

    // Heading
    const headingMatch = remaining.match(/^<(h[1-6])>([\s\S]*?)<\/\1>/i);
    if (headingMatch) {
      const level = parseInt(headingMatch[1]![1]!) as 1 | 2 | 3 | 4 | 5 | 6;
      const inlineContent = parseInlineHtml(headingMatch[2]!);
      nodes.push({
        type: "heading",
        attrs: { level },
        content: inlineContent.length > 0 ? inlineContent : undefined
      });
      remaining = remaining.slice(headingMatch[0].length);
      continue;
    }

    // Unordered list
    const ulMatch = remaining.match(/^<ul>([\s\S]*?)<\/ul>/i);
    if (ulMatch) {
      nodes.push(parseList("bulletList", ulMatch[1]!));
      remaining = remaining.slice(ulMatch[0].length);
      continue;
    }

    // Ordered list
    const olMatch = remaining.match(/^<ol>([\s\S]*?)<\/ol>/i);
    if (olMatch) {
      nodes.push(parseList("orderedList", olMatch[1]!));
      remaining = remaining.slice(olMatch[0].length);
      continue;
    }

    // Code block (pre > code)
    const codeBlockMatch = remaining.match(
      /^<pre><code>([\s\S]*?)<\/code><\/pre>/i
    );
    if (codeBlockMatch) {
      nodes.push({
        type: "codeBlock",
        content: [
          { type: "text", text: decodeHtmlEntities(codeBlockMatch[1]!) }
        ]
      });
      remaining = remaining.slice(codeBlockMatch[0].length);
      continue;
    }

    // Horizontal rule
    if (
      remaining.startsWith("<hr>") ||
      remaining.startsWith("<hr/>") ||
      remaining.startsWith("<hr />")
    ) {
      nodes.push({ type: "horizontalRule" });
      const hrMatch = remaining.match(/^<hr\s*\/?>/);
      remaining = remaining.slice(hrMatch![0].length);
      continue;
    }

    // Line break at top level → empty paragraph
    if (
      remaining.startsWith("<br>") ||
      remaining.startsWith("<br/>") ||
      remaining.startsWith("<br />")
    ) {
      nodes.push({ type: "paragraph" });
      const brMatch = remaining.match(/^<br\s*\/?>/);
      remaining = remaining.slice(brMatch![0].length);
      continue;
    }

    // Paragraph or any other block
    // Find the next block-level tag or end of string
    const nextBlockTag = remaining.search(/<(h[1-6]|ul|ol|pre|hr|br)[\s>/]/i);

    let paragraphHtml: string;
    if (nextBlockTag === 0) {
      // Unknown tag at start, skip one character
      paragraphHtml = remaining[0]!;
      remaining = remaining.slice(1);
    } else if (nextBlockTag > 0) {
      paragraphHtml = remaining.slice(0, nextBlockTag);
      remaining = remaining.slice(nextBlockTag);
    } else {
      paragraphHtml = remaining;
      remaining = "";
    }

    // Clean up stray paragraph tags
    paragraphHtml = paragraphHtml.trim();
    if (!paragraphHtml) continue;

    // Split on newlines to create separate paragraphs
    const paragraphs = paragraphHtml.split(/\n/).filter((p) => p.trim());
    for (const p of paragraphs) {
      const inlineContent = parseInlineHtml(p);
      if (inlineContent.length > 0) {
        nodes.push({ type: "paragraph", content: inlineContent });
      }
    }
  }

  return nodes;
}

function parseList(
  type: "bulletList" | "orderedList",
  html: string
): TiptapNode {
  const items: TiptapNode[] = [];
  const liRegex = /<li>([\s\S]*?)<\/li>/gi;
  let match;

  while ((match = liRegex.exec(html)) !== null) {
    const inlineContent = parseInlineHtml(match[1]!);
    items.push({
      type: "listItem",
      content: [
        {
          type: "paragraph",
          content: inlineContent.length > 0 ? inlineContent : undefined
        }
      ]
    });
  }

  return { type, content: items };
}

function parseInlineHtml(html: string): TiptapNode[] {
  if (!html) return [];

  const nodes: TiptapNode[] = [];
  let remaining = html;

  while (remaining.length > 0) {
    // Link
    const linkMatch = remaining.match(
      /^<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i
    );
    if (linkMatch) {
      nodes.push({
        type: "text",
        text: decodeHtmlEntities(linkMatch[2]!),
        marks: [{ type: "link", attrs: { href: linkMatch[1]! } }]
      });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Bold
    const boldMatch = remaining.match(/^<(strong|b)>([\s\S]*?)<\/\1>/i);
    if (boldMatch) {
      nodes.push({
        type: "text",
        text: decodeHtmlEntities(boldMatch[2]!),
        marks: [{ type: "bold" }]
      });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic
    const italicMatch = remaining.match(/^<(em|i)>([\s\S]*?)<\/\1>/i);
    if (italicMatch) {
      nodes.push({
        type: "text",
        text: decodeHtmlEntities(italicMatch[2]!),
        marks: [{ type: "italic" }]
      });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Strikethrough
    const strikeMatch = remaining.match(/^<s>([\s\S]*?)<\/s>/i);
    if (strikeMatch) {
      nodes.push({
        type: "text",
        text: decodeHtmlEntities(strikeMatch[1]!),
        marks: [{ type: "strike" }]
      });
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // Underline
    const underlineMatch = remaining.match(/^<u>([\s\S]*?)<\/u>/i);
    if (underlineMatch) {
      nodes.push({
        type: "text",
        text: decodeHtmlEntities(underlineMatch[1]!),
        marks: [{ type: "underline" }]
      });
      remaining = remaining.slice(underlineMatch[0].length);
      continue;
    }

    // Inline code
    const codeMatch = remaining.match(/^<code>([\s\S]*?)<\/code>/i);
    if (codeMatch) {
      nodes.push({
        type: "text",
        text: decodeHtmlEntities(codeMatch[1]!),
        marks: [{ type: "code" }]
      });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Line break
    const brMatch = remaining.match(/^<br\s*\/?>/i);
    if (brMatch) {
      nodes.push({ type: "hardBreak" });
      remaining = remaining.slice(brMatch[0].length);
      continue;
    }

    // Skip unknown tags
    const tagMatch = remaining.match(/^<\/?[a-zA-Z][^>]*>/);
    if (tagMatch) {
      remaining = remaining.slice(tagMatch[0].length);
      continue;
    }

    // Plain text up to next tag
    const nextTag = remaining.indexOf("<");
    if (nextTag === -1) {
      nodes.push({ type: "text", text: decodeHtmlEntities(remaining) });
      break;
    } else if (nextTag > 0) {
      nodes.push({
        type: "text",
        text: decodeHtmlEntities(remaining.slice(0, nextTag))
      });
      remaining = remaining.slice(nextTag);
    } else {
      // Tag at position 0 that didn't match any pattern
      nodes.push({ type: "text", text: "<" });
      remaining = remaining.slice(1);
    }
  }

  return nodes;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function encodeHtmlEntities(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert Tiptap JSON to HTML format.
 * Used when syncing from Carbon → Asana.
 */
export function tiptapToHtml(
  tiptapDoc: TiptapDocument | null | undefined
): string {
  if (!tiptapDoc || !tiptapDoc.content) return "";

  return tiptapDoc.content.map(nodeToHtml).join("\n");
}

function nodeToHtml(node: TiptapNode): string {
  switch (node.type) {
    case "paragraph":
      return node.content ? node.content.map(inlineToHtml).join("") : "<br>";

    case "heading": {
      const level = node.attrs?.level ?? 1;
      const text = node.content ? node.content.map(inlineToHtml).join("") : "";
      return `<h${level}>${text}</h${level}>`;
    }

    case "bulletList":
      return `<ul>${(node.content ?? []).map(nodeToHtml).join("")}</ul>`;

    case "orderedList":
      return `<ol>${(node.content ?? []).map(nodeToHtml).join("")}</ol>`;

    case "listItem": {
      const inner = node.content?.map(nodeToHtml).join("") ?? "";
      return `<li>${inner}</li>`;
    }

    case "blockquote": {
      const inner = node.content?.map(nodeToHtml).join("") ?? "";
      return `<blockquote>${inner}</blockquote>`;
    }

    case "codeBlock": {
      const code = node.content?.[0]?.text ?? "";
      return `<pre><code>${encodeHtmlEntities(code)}</code></pre>`;
    }

    case "horizontalRule":
      return "<hr>";

    default:
      return node.content ? node.content.map(inlineToHtml).join("") : "";
  }
}

function inlineToHtml(node: TiptapNode): string {
  if (node.type === "text") {
    let text = encodeHtmlEntities(node.text ?? "");

    if (node.marks) {
      for (const mark of node.marks) {
        switch (mark.type) {
          case "bold":
            text = `<strong>${text}</strong>`;
            break;
          case "italic":
            text = `<em>${text}</em>`;
            break;
          case "strike":
            text = `<s>${text}</s>`;
            break;
          case "underline":
            text = `<u>${text}</u>`;
            break;
          case "code":
            text = `<code>${text}</code>`;
            break;
          case "link":
            text = `<a href="${mark.attrs?.href ?? ""}">${text}</a>`;
            break;
        }
      }
    }

    return text;
  }

  if (node.type === "hardBreak") {
    return "<br>";
  }

  return "";
}

/**
 * Check if two Tiptap documents have the same content.
 */
export function tiptapDocumentsEqual(
  a: TiptapDocument | null | undefined,
  b: TiptapDocument | null | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Check if a Tiptap document is empty (no meaningful content).
 */
export function isTiptapEmpty(doc: TiptapDocument | null | undefined): boolean {
  if (!doc || !doc.content) return true;

  const hasContent = doc.content.some((node) => {
    if (node.type === "paragraph" && node.content) {
      return node.content.some(
        (inline) => inline.type === "text" && inline.text?.trim()
      );
    }
    return node.content && node.content.length > 0;
  });

  return !hasContent;
}
