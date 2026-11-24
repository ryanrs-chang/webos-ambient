import { describe, expect, test } from "bun:test";
import { diffTime, sweepStyle, timeHtml } from "../src/anim";

describe("diffTime", () => {
  test("marks only the characters that changed", () => {
    expect(diffTime("08:59", "09:00")).toEqual([false, true, false, true, true]);
  });

  test("a single minute tick changes only the last digit", () => {
    expect(diffTime("18:00", "18:01")).toEqual([false, false, false, false, true]);
  });

  test("equal strings change nothing", () => {
    expect(diffTime("18:00", "18:00")).toEqual([false, false, false, false, false]);
  });

  test("the first render (no previous time) animates nothing", () => {
    expect(diffTime(null, "18:00")).toEqual([false, false, false, false, false]);
  });

  test("a longer next string marks the extra positions as changed", () => {
    expect(diffTime("9:59", "10:00")).toEqual([true, true, true, true, true]);
  });
});

describe("timeHtml", () => {
  test("wraps each digit in a span and the colon in .colon", () => {
    expect(timeHtml("18:00", null)).toBe(
      '<span class="digit">1</span><span class="digit">8</span><span class="colon">:</span>' +
        '<span class="digit">0</span><span class="digit">0</span>',
    );
  });

  test("a changed digit carries the old one in data-old and keeps the new one as its text", () => {
    expect(timeHtml("09:00", "08:59")).toBe(
      '<span class="digit">0</span>' +
        '<span class="digit digit--changed" data-old="8"><span class="digit__n">9</span></span>' +
        '<span class="colon">:</span>' +
        '<span class="digit digit--changed" data-old="5"><span class="digit__n">0</span></span>' +
        '<span class="digit digit--changed" data-old="9"><span class="digit__n">0</span></span>',
    );
  });

  test("unchanged time has no changed digits", () => {
    expect(timeHtml("18:00", "18:00")).not.toContain("digit--changed");
  });

  test("the plain text is still the time", () => {
    expect(timeHtml("09:00", "08:59").replace(/<[^>]*>/g, "")).toBe("09:00");
  });
});

describe("sweepStyle", () => {
  test("starts at the minute's angle, ends at the next, and joins the sweep mid-way", () => {
    expect(sweepStyle(90, 96, 12.5)).toBe("--a:90deg;--to:96deg;animation-delay:-12.50s");
  });

  test("at the top of the minute there is no head start", () => {
    expect(sweepStyle(354, 360, 0)).toBe("--a:354deg;--to:360deg;animation-delay:-0.00s");
  });
});
