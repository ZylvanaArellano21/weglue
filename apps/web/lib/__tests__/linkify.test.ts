import { describe, expect, it } from "vitest";
import { linkify } from "@weglue/shared";

describe("linkify", () => {
  it("detects a single link", () => {
    expect(linkify("Visit https://example.com")).toEqual([
      { type: "text", value: "Visit " },
      { type: "link", value: "https://example.com", href: "https://example.com" },
    ]);
  });

  it("detects multiple links independently", () => {
    expect(linkify("https://one.example and www.two.example")).toEqual([
      { type: "link", value: "https://one.example", href: "https://one.example" },
      { type: "text", value: " and " },
      { type: "link", value: "www.two.example", href: "https://www.two.example" },
    ]);
  });

  it("detects a link in the middle of a sentence", () => {
    expect(linkify("Read https://example.com/docs for details.")).toEqual([
      { type: "text", value: "Read " },
      { type: "link", value: "https://example.com/docs", href: "https://example.com/docs" },
      { type: "text", value: " for details." },
    ]);
  });

  it.each([".", ",", "!", "?", ";", ":"])('excludes a trailing "%s"', (punctuation) => {
    expect(linkify(`See https://example.com${punctuation}`)).toEqual([
      { type: "text", value: "See " },
      { type: "link", value: "https://example.com", href: "https://example.com" },
      { type: "text", value: punctuation },
    ]);
  });

  it("excludes an unmatched closing parenthesis", () => {
    expect(linkify("See (https://example.com)")).toEqual([
      { type: "text", value: "See (" },
      { type: "link", value: "https://example.com", href: "https://example.com" },
      { type: "text", value: ")" },
    ]);
  });

  it("captures a long link without truncating it", () => {
    const path = "long/" + "segment/".repeat(20) + "end";
    const url = `https://example.com/${path}`;
    expect(url.length).toBeGreaterThan(100);
    expect(linkify(url)).toEqual([{ type: "link", value: url, href: url }]);
  });

  it("prepends https:// to a www. link while preserving its display value", () => {
    expect(linkify("www.example.com/path")).toEqual([
      { type: "link", value: "www.example.com/path", href: "https://www.example.com/path" },
    ]);
  });

  it("keeps balanced parentheses in a URL path", () => {
    const url = "https://en.wikipedia.org/wiki/Foo_(bar)";
    expect(linkify(url)).toEqual([{ type: "link", value: url, href: url }]);
  });

  it("keeps query strings with ampersands and equals signs", () => {
    const url = "https://example.com/search?query=links&sort=recent";
    expect(linkify(url)).toEqual([{ type: "link", value: url, href: url }]);
  });

  it("keeps trailing slashes and URL fragments", () => {
    const url = "https://example.com/path/#section";
    expect(linkify(url)).toEqual([{ type: "link", value: url, href: url }]);
  });

  it("trims a large adversarial run of unmatched closing parentheses quickly", () => {
    const trailingParentheses = 20_001;
    const input = `https://example.com${")".repeat(trailingParentheses)}`;
    const startedAt = performance.now();
    const result = linkify(input);
    const elapsedMilliseconds = performance.now() - startedAt;

    expect(result[0]).toEqual({ type: "link", value: "https://example.com", href: "https://example.com" });
    expect(result[1]).toEqual({ type: "text", value: ")".repeat(trailingParentheses) });
    expect(elapsedMilliseconds).toBeLessThan(100);
  });

  it("re-trims punctuation exposed by unmatched-parenthesis trimming", () => {
    expect(linkify("See https://example.com!).")).toEqual([
      { type: "text", value: "See " },
      { type: "link", value: "https://example.com", href: "https://example.com" },
      { type: "text", value: "!)." },
    ]);
  });

  it("excludes smart closing quotes from a link", () => {
    expect(linkify('Check “https://example.com” now')).toEqual([
      { type: "text", value: "Check “" },
      { type: "link", value: "https://example.com", href: "https://example.com" },
      { type: "text", value: "” now" },
    ]);
  });

  it("does not interpret Markdown-style link syntax specially", () => {
    expect(linkify("[example](https://example.com)")).toEqual([
      { type: "text", value: "[example](" },
      { type: "link", value: "https://example.com", href: "https://example.com" },
      { type: "text", value: ")" },
    ]);
  });

  it("does not linkify a javascript URI", () => {
    expect(linkify("javascript:alert(1)")).toEqual([
      { type: "text", value: "javascript:alert(1)" },
    ]);
  });

  it("does not linkify a data URI", () => {
    expect(linkify("data:text/plain,hello")).toEqual([
      { type: "text", value: "data:text/plain,hello" },
    ]);
  });

  it("returns unchanged plain text as one text segment", () => {
    expect(linkify("No links here.")).toEqual([{ type: "text", value: "No links here." }]);
  });

  it("returns one empty text segment for empty input", () => {
    expect(linkify("")).toEqual([{ type: "text", value: "" }]);
  });
});
