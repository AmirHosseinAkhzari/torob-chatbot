import { Fragment } from "react";

/** Small markdown subset the agent uses: paragraphs, "- " lists, **bold**. Everything else is plain text. */
function inline(s: string, key: string) {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <b key={`${key}-${i}`}>{p.slice(2, -2)}</b> : <Fragment key={`${key}-${i}`}>{p}</Fragment>,
  );
}

export default function RichText({ text, streaming }: { text: string; streaming?: boolean }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/).filter((b) => b.trim());
  return (
    <>
      {blocks.map((b, bi) => {
        const lines = b.split("\n").filter((l) => l.trim());
        const isList = lines.length > 0 && lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
        const last = bi === blocks.length - 1;
        if (isList) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""), `${bi}-${li}`)}</li>)}
            </ul>
          );
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 ? <br /> : null}
                {inline(l, `${bi}-${li}`)}
              </Fragment>
            ))}
            {streaming && last ? <span className="caret" aria-hidden="true" /> : null}
          </p>
        );
      })}
    </>
  );
}
