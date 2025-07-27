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

const activeBrowser = fs.readFileSync(
  `${neteroState}/active-browser.txt`,
  "utf-8",
);
const _activeTab = fs.readFileSync(`${neteroState}/active-tab.txt`, "utf-8");

const dataDir = os.tmpdir();

const preference = {
  browser: {
    theme: {
      color_scheme2: theme === "dark" ? 2 : 1,
    },
  },
  devtools: {
    synced_preferences_sync_disabled: {
      "ui-theme": theme === "dark" ? '"dark"' : '"light"',
    },
  },
};

fs.mkdirSync(`${dataDir}/Default`, { recursive: true });

fs.writeFileSync(
  `${dataDir}/Default/Preferences`,
  JSON.stringify(preference, null, 2),
);

const browser = await chromium.launchPersistentContext(dataDir, {
  viewport: null,
  colorScheme: theme,
  ignoreDefaultArgs: ["--enable-automation"],
});

browser.on("close", () => {
  process.exit(0);
});

const cookiesStr = fs.readFileSync(
  `${neteroState}/browser/${activeBrowser}/cookie.txt`,
  "utf-8",
);

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

const newPage = await browser.newPage();

const configStr = fs.readFileSync(args.config, "utf-8");
const config: Config = JSON.parse(configStr);

const scenario = config.scenarios[args.scenario];
if (scenario === undefined) {
  throw new Error(`Scenario "${args.scenario}" not found in config.`);
}

for (const step of scenario.steps) {
  const action = config.steps[step];
  if (action === undefined) {
    throw new Error(`Action "${step}" not found in config.`);
  }
  await handleAction(neteroState, newPage, action);
}
