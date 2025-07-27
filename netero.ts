import * as fs from "node:fs";
import * as os from "node:os";
import * as util from "node:util";
import { chromium, type Locator, type Page } from "playwright";

let theme: "light" | "dark" | undefined;

const { values: args } = util.parseArgs({
  args: process.argv.slice(2),
  options: {
    theme: {
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

const neteroState = process.env["NETERO_STATE"];
if (neteroState === undefined) {
  throw new Error("NETERO_STATE environment variable is not set.");
}

const activeBrowser = fs.readFileSync(
  `${neteroState}/active-browser.txt`,
  "utf-8",
);
const activeTab = fs.readFileSync(`${neteroState}/active-tab.txt`, "utf-8");

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
  headless: false,
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

const emptyPages = browser.pages();

const url = fs.readFileSync(
  `${neteroState}/browser/${activeBrowser}/tab/${activeTab}/url.txt`,
  "utf-8",
);
const newPage = await browser.newPage();
await newPage.goto(url);

await Promise.all(emptyPages.map((page) => page.close()));

while (true) {
  const mess = await fs.promises.readFile("/tmp/netero/browser.fifo", "utf-8");
  if (mess === "reload_all") {
    await Promise.all(browser.pages().map((page) => page.reload()));
  }
}

type ElementValue =
  | {
      type: "attribute";
      name: string;
    }
  | {
      type: "text";
    };

type PageValue =
  | {
      value: "url";
    }
  | {
      value: "title";
    };

type Value =
  | {
      source: "page";
      value: PageValue;
    }
  | {
      source: "element";
      xpath: string;
      value: ElementValue;
    };

type Actions =
  | {
      action: "goto";
      url: string;
    }
  | {
      action: "click";
      xpath: string;
    }
  | {
      action: "fill";
      xpath: string;
      value: string;
    }
  | {
      action: "check";
      xpath: string;
    }
  | {
      action: "selectOption";
      xpath: string;
      value: string | string[];
    }
  | {
      action: "setInputFile";
      xpath: string;
      value: string | string[];
    }
  // | {
  //     action: "submit";
  //     formSelector?: string;
  //     submitButtonSelector?: string;
  //     data: Record<string, FormInput & { selector?: string }>;
  //   }
  | {
      action: "assert";
      expected: string;
      value: Value;
    };

function getElementValue(
  element: Locator,
  value: ElementValue,
): Promise<string | null> {
  if (value.type === "attribute") {
    return element.getAttribute(value.name);
  }
  if (value.type === "text") {
    return element.textContent();
  }
  value satisfies never;
  throw new Error(`Unknown element value type: ${JSON.stringify(value)}`);
}

async function getPageValue(
  page: Page,
  value: PageValue,
): Promise<string | null> {
  if (value.value === "url") {
    return page.url();
  }
  if (value.value === "title") {
    return page.title();
  }
  value satisfies never;
  throw new Error(`Unknown page value type: ${JSON.stringify(value)}`);
}

function getValue(page: Page, value: Value): Promise<string | null> {
  if (value.source === "page") {
    return getPageValue(page, value.value);
  }
  if (value.source === "element") {
    const locator = page.locator(value.xpath);
    return getElementValue(locator, value.value);
  }
  value satisfies never;
  throw new Error(`Unknown value source: ${JSON.stringify(value)}`);
}

export async function handleAction(page: Page, action: Actions): Promise<void> {
  if (action.action === "goto") {
    await page.goto(action.url);
    return;
  }

  if (action.action === "click") {
    await page.locator(action.xpath).click();
    return;
  }

  if (action.action === "fill") {
    await page.locator(action.xpath).fill(action.value);
    return;
  }

  if (action.action === "check") {
    await page.locator(action.xpath).check();
    return;
  }

  if (action.action === "selectOption") {
    await page.locator(action.xpath).selectOption(action.value);
    return;
  }

  if (action.action === "setInputFile") {
    await page.locator(action.xpath).setInputFiles(action.value);
    return;
  }

  // if (action.action === "goto-link") {
  //   await page.locator(`a[${action.xpath}"]`).click();
  //   return;
  // }

  // if (action.action === "submit") {
  //   const form = page.locator(action.formSelector ?? "form");
  //   for (const [name, value] of Object.entries(action.data)) {
  //     const input =
  //       value.selector !== undefined
  //         ? page.locator(value.selector)
  //         : form.locator(`input[name="${name}"]`);
  //     await handleInput(input, value);
  //   }
  //   const submitButton = action.submitButtonSelector
  //     ? page.locator(action.submitButtonSelector)
  //     : form.locator("button[type='submit'], action.action='submit']");
  //
  //   await submitButton.click();
  //   return;
  // }

  if (action.action === "assert") {
    const value = await getValue(page, action.value);
    if (value === null) {
      throw new Error("Value is null");
    }
    const regex = new RegExp(action.expected);
    if (!regex.test(value)) {
      throw new Error(`Expected ${value} to match ${action.expected}`);
    }
    return;
  }

  action satisfies never;
}
