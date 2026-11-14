// The only two places money can enter. Both are off until an address is filled in, both are plain
// labelled links, and neither is read by the ranking code (see js/rank.js: it never imports this file).
export const CONFIG = {
  // Optional and free: a Stack Apps key (stackapps.com/apps/oauth/register) raises the shared
  // Stack Exchange quota from 300 to 10,000 requests a day. It is a public identifier, not a secret.
  keys: {
    stackexchange: "",
  },
  // A page where people can chip in (GitHub Sponsors, Ko-fi, Buy Me a Coffee ...). https only.
  support: {
    label: "Support Sumber",
    url: "",
  },
  // One text line in the footer, always prefixed with the word "Sponsor". https only.
  sponsor: {
    text: "",
    url: "",
  },
};

/** Accept only https links so a typo in this file can never produce a script or data URL. */
export function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}
