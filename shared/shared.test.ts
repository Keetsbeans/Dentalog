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

import { addDays, istToUtc, label12, overlaps, slots, utcToIst, weekStart } from "./time";

describe("India time", () => {
  it("converts clinic time to UTC and back", () => {
    expect(istToUtc("2026-11-17", "15:30")).toBe("2026-11-17T10:00:00.000Z");
    expect(istToUtc("2026-11-17", "03:00")).toBe("2026-11-16T21:30:00.000Z");
    expect(utcToIst("2026-11-16T21:30:00.000Z")).toEqual({ day: "2026-11-17", time: "03:00" });
  });
  it("finds the week and the slots", () => {
    expect(weekStart("2026-11-17")).toBe("2026-11-16");
    expect(weekStart("2026-11-22")).toBe("2026-11-16");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    const hours = { tue: ["15:30", "20:30"] as [string, string], sun: null };
    expect(slots(hours, "2026-11-17")).toHaveLength(10);
    expect(slots(hours, "2026-11-17")[0]).toBe("15:30");
    expect(slots(hours, "2026-11-22")).toEqual([]);
    expect(label12("15:30")).toBe("3:30 PM");
    expect(label12("12:00")).toBe("12:00 PM");
  });
  it("spots double bookings", () => {
    expect(overlaps("2026-11-17T10:00:00Z", 30, "2026-11-17T10:15:00Z", 30)).toBe(true);
    expect(overlaps("2026-11-17T10:00:00Z", 30, "2026-11-17T10:30:00Z", 30)).toBe(false);
  });
});

import { billTotal } from "./services";
describe("bills", () => {
  it("totals lines and takes off the discount", () => {
    expect(billTotal([{ amountPaise: 100000 }, { amountPaise: 20000 }], 0)).toBe(120000);
    expect(billTotal([{ amountPaise: 100000 }], 20000)).toBe(80000);
    expect(billTotal([{ amountPaise: 100000 }], 200000)).toBe(0);
  });
});

import { readSettings, DEFAULT_SETTINGS } from "./settings";
describe("settings", () => {
  it("falls back to defaults for anything not saved or broken", () => {
    expect(readSettings("{}")).toEqual(DEFAULT_SETTINGS);
    expect(readSettings("not json").services).toBe(DEFAULT_SETTINGS.services);
    const s = readSettings(JSON.stringify({ services: [{ name: "Consultation", paise: 30000 }] }));
    expect(s.services).toEqual([{ name: "Consultation", paise: 30000 }]);
    expect(s.drugs).toBe(DEFAULT_SETTINGS.drugs);
  });
});

describe("WhatsApp messages", async () => {
  const { fill, waLink, DEFAULT_TEMPLATES } = await import("./messages");
  it("fills a template and tidies missing words", () => {
    expect(fill("Hello {name}, pay {upi}. – {doctor}", { name: "Anitha", doctor: "Dr S" })).toBe("Hello Anitha, pay. – Dr S");
    expect(fill(DEFAULT_TEMPLATES.reminder, { name: "A", day: "Thursday", time: "5:30 PM", visit: "scaling", clinic: "Oyster", doctor: "Dr S" }))
      .toContain("scaling appointment at Oyster on Thursday at 5:30 PM");
  });
  it("makes wa.me links for Indian mobiles only", () => {
    expect(waLink("91", "98400 12345", "Hi there")).toBe("https://wa.me/919840012345?text=Hi%20there");
    expect(waLink("971", "501234567", "x")).toBe("https://wa.me/971501234567?text=x");
    expect(waLink("91", "044 2345678", "x")).toBeNull();
  });
  it("checks mobile numbers by country", async () => {
    const { checkPhone, formatPhone } = await import("./phone");
    expect(checkPhone("91", "9840012345")).toBeNull();
    expect(checkPhone("91", "98400123456")).not.toBeNull();
    expect(checkPhone("91", "1234567890")).not.toBeNull();
    expect(checkPhone("971", "501234567")).toBeNull();
    expect(formatPhone("91", "9840012345")).toBe("+91 98400 12345");
  });
});

describe("tooth chart", async () => {
  const { parseTeeth, lookOf, blank, toothName } = await import("./teeth");
  it("reads tooth numbers out of free text", () => {
    expect(parseTeeth("16, 36 37 and 99")).toEqual([16, 36, 37]);
    expect(parseTeeth("75")).toEqual([75]);
    expect(parseTeeth("")).toEqual([]);
  });
  it("colours teeth by condition and plan", () => {
    expect(lookOf(blank(16))).toBe("healthy");
    expect(lookOf({ ...blank(16), condition: "Caries" })).toBe("problem");
    expect(lookOf({ ...blank(16), plan: "RCT", done: 1 })).toBe("planned");
    expect(lookOf({ ...blank(16), plan: "RCT", done: 3 })).toBe("done");
    expect(lookOf({ ...blank(46), condition: "Missing" })).toBe("missing");
    expect(toothName(36)).toBe("Lower left first molar");
    expect(toothName(75)).toBe("Lower left baby second molar");
  });
});
