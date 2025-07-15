import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const allArgs = [...process.argv.slice(2)];

const urls: string[] = [];
const chromiumArgs: string[] = [];
let cookies: string | undefined;
let argDataDir: string | undefined;

while (allArgs.length > 0) {
  const key = allArgs.shift();
  if (key === undefined) {
    throw new Error("Usage: cookie_browser --url <url>");
  }

  if (key === "--url") {
    const url = allArgs.shift();
    if (url === undefined) {
      throw new Error("Usage: cookie_browser --url <url>");
    }
    urls.push(url);
  }

  if (key === "--cookies") {
    cookies = allArgs.shift();
    if (cookies === undefined) {
      throw new Error("Usage: cookie_browser --cookies <file>");
    }
  }

  if (key === "--data-dir") {
    argDataDir = allArgs.shift();
    if (argDataDir === undefined) {
      throw new Error("Usage: cookie_browser --data-dir <dir>");
    }
  }

  if (key === "--") {
    chromiumArgs.push(...allArgs);
    break;
  }
}

const dataDir = argDataDir ?? tmpdir();

const browser = await chromium.launchPersistentContext(dataDir, {
  viewport: null,
  headless: false,
  args: chromiumArgs,
});

if (cookies !== undefined) {
  const cookiesStr = readFileSync(cookies, "utf-8");

  for (const line of cookiesStr.split("\n")) {
    const lineIsComment =
      line.startsWith("#") && !line.startsWith("#HttpOnly_");
    if (lineIsComment || line === "") {
      continue;
    }

    const [firstArg, _, path, secureStr, expiresStr, name, value] =
      line.split("\t");

    if (firstArg === undefined || name === undefined || value === undefined) {
      throw new Error(`Invalid cookie line: ${line}`);
    }

    const httpOnly = firstArg.startsWith("#HttpOnly_");
    const domain = httpOnly ? firstArg.replace("#HttpOnly_", "") : firstArg;
    const expires =
      expiresStr === undefined ? undefined : Number.parseInt(expiresStr, 10);
    const secure = secureStr === "TRUE";
    await browser.addCookies([
      { name, value, path, httpOnly, domain, expires, secure },
    ]);
  }
}

const emptyPages = browser.pages();

for (const url of urls) {
  const newPage = await browser.newPage();
  await newPage.goto(url);
}

for (const emptyPage of emptyPages) {
  await emptyPage.close();
}
