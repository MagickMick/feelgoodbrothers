/** "Paniek aanvallen!" -> "paniek-aanvallen" */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** strip markdown to plain text (for excerpts and word counts) */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function wordCount(md: string): number {
  const text = markdownToPlainText(md);
  return text ? text.split(" ").length : 0;
}

/** reading time in minutes (~220 wpm) */
export function readingTime(md: string): number {
  return Math.max(1, Math.round(wordCount(md) / 220));
}
