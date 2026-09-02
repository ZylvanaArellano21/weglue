import { describe, expect, it } from "vitest";
import {
  APP_STORE_URL,
  DOWNLOAD_APP_URL,
  PLAY_STORE_URL,
  downloadTargetFromClient,
  storeTargetFromUserAgent,
  storeUrlFor,
} from "../deviceRouting";

const iphoneIos17Safari =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ipadIos12Safari =
  "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1";
const ipadOs16DesktopSafari =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15";
const androidPixel =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
const androidTablet =
  "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const macChrome =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const macSafari =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const windowsChrome =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const linuxFirefox =
  "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0";
const googlebot =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

describe("We Glue smart download routing", () => {
  it("routes iPhone iOS 17 Safari to the App Store", () => {
    expect(storeTargetFromUserAgent(iphoneIos17Safari)).toBe("app-store");
    expect(
      downloadTargetFromClient({
        userAgent: iphoneIos17Safari,
        maxTouchPoints: 5,
      }),
    ).toBe("app-store");
  });

  it("routes a legacy iPad UA to the App Store", () => {
    expect(storeTargetFromUserAgent(ipadIos12Safari)).toBe("app-store");
    expect(
      downloadTargetFromClient({
        userAgent: ipadIos12Safari,
        maxTouchPoints: 5,
      }),
    ).toBe("app-store");
  });

  it("uses touch points to distinguish iPadOS 16 Safari from a Mac", () => {
    expect(storeTargetFromUserAgent(ipadOs16DesktopSafari)).toBeNull();
    expect(
      downloadTargetFromClient({
        userAgent: ipadOs16DesktopSafari,
        maxTouchPoints: 5,
        platform: "MacIntel",
      }),
    ).toBe("app-store");
    expect(
      downloadTargetFromClient({
        userAgent: ipadOs16DesktopSafari,
        maxTouchPoints: 0,
        platform: "MacIntel",
      }),
    ).toBe("download-page");
  });

  it("routes an Android phone to Google Play", () => {
    expect(storeTargetFromUserAgent(androidPixel)).toBe("play-store");
    expect(
      downloadTargetFromClient({
        userAgent: androidPixel,
        maxTouchPoints: 5,
      }),
    ).toBe("play-store");
  });

  it("routes an Android tablet to Google Play", () => {
    expect(storeTargetFromUserAgent(androidTablet)).toBe("play-store");
    expect(
      downloadTargetFromClient({
        userAgent: androidTablet,
        maxTouchPoints: 5,
      }),
    ).toBe("play-store");
  });

  it.each([
    ["macOS desktop Chrome", macChrome],
    ["macOS desktop Safari/WebKit", macSafari],
  ])("keeps %s on the download page", (_label, userAgent) => {
    expect(storeTargetFromUserAgent(userAgent)).toBeNull();
    expect(downloadTargetFromClient({ userAgent, maxTouchPoints: 0 })).toBe(
      "download-page",
    );
  });

  it.each([
    ["Windows 10 Chrome", windowsChrome],
    ["Linux Firefox", linuxFirefox],
    ["Googlebot", googlebot],
  ])("keeps %s on the download page", (_label, userAgent) => {
    expect(storeTargetFromUserAgent(userAgent)).toBeNull();
    expect(downloadTargetFromClient({ userAgent, maxTouchPoints: 0 })).toBe(
      "download-page",
    );
  });

  it("keeps empty and missing User-Agents on the download page", () => {
    expect(storeTargetFromUserAgent("")).toBeNull();
    expect(storeTargetFromUserAgent(undefined)).toBeNull();
    expect(downloadTargetFromClient({ userAgent: "", maxTouchPoints: 0 })).toBe(
      "download-page",
    );
  });

  it("maps store targets to the exact store URLs", () => {
    expect(storeUrlFor("app-store")).toBe(APP_STORE_URL);
    expect(storeUrlFor("play-store")).toBe(PLAY_STORE_URL);
    expect(APP_STORE_URL).toBe(
      "https://apps.apple.com/us/app/we-glue/id6786491344",
    );
    expect(PLAY_STORE_URL).toBe(
      "https://play.google.com/store/apps/details?id=com.weglue.app",
    );
  });

  it("keeps the QR URL on the permanent download page", () => {
    expect(DOWNLOAD_APP_URL).toBe("https://weglue.app/download");
    expect(DOWNLOAD_APP_URL).not.toContain("apple.com");
    expect(DOWNLOAD_APP_URL).not.toContain("play.google.com");
  });
});
