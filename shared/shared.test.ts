import { describe, expect, it } from "vitest";
import { directions, quantity } from "./rx";
import { amountInWords, numberInWords, rupees } from "./money";
import { daysLeft, purgeBefore } from "./trash";
import { formatNumber } from "./numbering";

describe("prescription directions", () => {
  it("writes directions from the dose so they always match", () => {
    expect(directions("1-0-1", 3, "after")).toBe("Morning and night, after food for 3 days");
    expect(directions("1-1-1", 5, "after")).toBe("Morning, afternoon and night, after food for 5 days");
    expect(directions("1-0-0", 1, "before")).toBe("Morning, before food for 1 day");
    expect(directions("0-0-2", null, "any")).toBe("2 tablets night");
    expect(directions("SOS", null, "after")).toBe("Only if needed for pain");
  });
  it("refuses doses it does not understand", () => {
    expect(() => directions("twice daily", 3, "after")).toThrow();
    expect(() => directions("0-0-0", 3, "after")).toThrow();
  });
  it("works out how many tablets to give", () => {
    expect(quantity("1-0-1", 3)).toBe(6);
    expect(quantity("1-1-1", 5)).toBe(15);
    expect(quantity("SOS", 3)).toBeNull();
  });
});

describe("money", () => {
  it("formats rupees the Indian way", () => {
    expect(rupees(120000)).toBe("₹1,200");
    expect(rupees(12500000)).toBe("₹1,25,000");
    expect(rupees(150)).toBe("₹1.50");
  });
  it("writes amounts in words with lakh and crore", () => {
    expect(numberInWords(1200)).toBe("one thousand two hundred");
    expect(numberInWords(125000)).toBe("one lakh twenty-five thousand");
    expect(numberInWords(10000000)).toBe("one crore");
    expect(amountInWords(120000)).toBe("Rupees one thousand two hundred only");
    expect(amountInWords(120050)).toBe("Rupees one thousand two hundred and fifty paise only");
  });
});

describe("recently deleted", () => {
  it("counts down 30 days", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    expect(daysLeft("2026-11-17T12:00:00Z", now)).toBe(30);
    expect(daysLeft("2026-10-20T12:00:00Z", now)).toBe(2);
    expect(daysLeft("2026-09-01T00:00:00Z", now)).toBe(0);
    expect(purgeBefore(now)).toBe("2026-10-18T12:00:00.000Z");
  });
});

describe("numbering", () => {
  it("continues the old software's formats", () => {
    expect(formatNumber.patient(963)).toBe("CJ963");
    expect(formatNumber.file(1986)).toBe("DCJ-1986");
    expect(formatNumber.invoice(29)).toBe("INV-0029");
    expect(formatNumber.receipt(27)).toBe("RCPT27");
  });
});
