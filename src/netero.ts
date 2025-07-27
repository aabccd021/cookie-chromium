import * as fs from "node:fs";
import * as os from "node:os";
import * as util from "node:util";
import { chromium } from "playwright";
import { type Config, handleAction } from "./action";

let theme: "light" | "dark" | undefined;

const { values: args } = util.parseArgs({
  args: process.argv.slice(2),
  options: {
    theme: {
      type: "string",
    },
    config: {
      type: "string",
    },
    scenario: {
      type: "string",
    },
  },
  strict: true,
  allowPositionals: true,
});

if (
  args.theme === "light" ||
  args.theme === "dark" ||
  args.theme === undefined
) {
  theme = args.theme;
} else {
  throw new Error(
    `Invalid theme: ${args.theme}. Must be "light", "dark", or undefined.`,
  );
}

if (args.config === undefined) {
  throw new Error("No actions provided. Use --config to specify them.");
}

if (args.scenario === undefined) {
  throw new Error("No scenario provided. Use --scenario to specify it.");
}

const neteroState = process.env["NETERO_STATE"];
if (neteroState === undefined) {
  throw new Error("NETERO_STATE environment variable is not set.");
}

const configStr = fs.readFileSync(args.config, "utf-8");
const config: Config = JSON.parse(configStr);

const scenario = config.scenarios[args.scenario];
if (scenario === undefined) {
  throw new Error(`Scenario "${args.scenario}" not found in config.`);
}

const activeBrowser = fs.readFileSync(
  `${neteroState}/active-browser.txt`,
  "utf-8",
);

const activeTab = fs.readFileSync(`${neteroState}/active-tab.txt`, "utf-8");

const dataDir = os.tmpdir();

const browser = await chromium.launchPersistentContext(dataDir, {
  headless: true,
  colorScheme: theme,
});

browser.on("close", () => {
  process.exit(0);
});

const cookieFile = `${neteroState}/browser/${activeBrowser}/cookie.json`;
const urlFile = `${neteroState}/browser/${activeBrowser}/tab/${activeTab}/url.txt`;

if (fs.existsSync(cookieFile)) {
  const cookiesStr = fs.readFileSync(cookieFile, "utf-8");
  const cookies = JSON.parse(cookiesStr);
  await browser.addCookies(cookies);
}

const page = await browser.newPage();

if (fs.existsSync(urlFile)) {
  const url = fs.readFileSync(urlFile, "utf-8");
  await page.goto(url);
}

for (const step of scenario.steps) {
  const action = config.steps[step];
  if (action === undefined) {
    throw new Error(`Action "${step}" not found in config.`);
  }
  await handleAction(neteroState, page, action);
}

const url = page.url();
const cookies = await browser.cookies();

await Promise.all([
  fs.promises.writeFile(
    `${neteroState}/browser/${activeBrowser}/tab/${activeTab}/url.txt`,
    url,
  ),
  fs.promises.writeFile(
    `${neteroState}/browser/${activeBrowser}/cookie.json`,
    JSON.stringify(cookies, null, 2),
  ),
]);
process.exit(0);
