import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values: args } = parseArgs({
	args: process.argv.slice(2),
	options: {
		cookies: { type: "string" },
		url: { type: "string", multiple: true },
		"data-dir": { type: "string" },
	},
	strict: true,
	allowPositionals: true,
});

const cookies = args.cookies;
const urls = args.url;
const dataDir = args["data-dir"] ?? tmpdir();
if (cookies === undefined || urls === undefined) {
	throw new Error(
		"Usage: cookie_browser --cookies <cookies-file> --url <url1> --url <url2> ...",
	);
}

const browser = await chromium.launchPersistentContext(dataDir, {
	viewport: null,
	headless: false,
});

const cookiesStr = readFileSync(cookies, "utf-8");

for (const line of cookiesStr.split("\n")) {
	const lineIsComment = line.startsWith("#") && !line.startsWith("#HttpOnly_");
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

const emptyPages = browser.pages();

for (const url of urls) {
	const newPage = await browser.newPage();
	await newPage.goto(url);
}

for (const emptyPage of emptyPages) {
	await emptyPage.close();
}
