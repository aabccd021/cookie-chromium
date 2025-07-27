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

type InputFill = {
  type: "fill";
  value: Parameters<Locator["fill"]>[0];
} & Parameters<Locator["fill"]>[1];

type InputCheck = {
  type: "check";
} & Parameters<Locator["check"]>[0];

type InputSelect = {
  type: "select";
  value: Parameters<Locator["selectOption"]>[0];
} & Parameters<Locator["selectOption"]>[1];

type InputFile = {
  type: "file";
  value: Parameters<Locator["setInputFiles"]>[0];
} & Parameters<Locator["setInputFiles"]>[1];

type FormData = InputFill | InputCheck | InputSelect | InputFile;

type InputSelector = {
  selector?: string;
};

type Actions =
  | {
      action: "goto-url";
      url: string;
    }
  | {
      action: "goto-link";
      xpath: string;
    }
  | {
      action: "submit";
      formSelector?: string;
      submitButtonSelector?: string;
      data: Record<string, FormData & InputSelector>;
    }
  | {
      action: "assert-url";
      url: string;
    }
  | {
      action: "assert-attribute";
      xpath: string;
      attribute: string;
      expectedRegex: string;
      options?: Parameters<Locator["getAttribute"]>[1];
    }
  | {
      action: "assert-text";
      xpath: string;
      expectedRegex: string;
      options?: Parameters<Locator["textContent"]>[0];
    };

async function handleInput(element: Locator, data: FormData): Promise<void> {
  if (data.type === "fill") {
    const { type: _type, value, ...options } = data;
    await element.fill(value, options);
    return;
  }
  if (data.type === "check") {
    const { type: _type, ...options } = data;
    await element.check(options);
    return;
  }
  if (data.type === "select") {
    const { type: _type, value, ...options } = data;
    await element.selectOption(value, options);
    return;
  }
  if (data.type === "file") {
    const { type: _type, value, ...options } = data;
    await element.setInputFiles(value, options);
    return;
  }
  data satisfies never;
}

function assertRegex(
  xpath: string,
  value: string | null,
  expectedRegex: string,
  errorMessage: string,
): void {
  if (value === null) {
    throw new Error(`Element at ${xpath} has no text content`);
  }
  const regex = new RegExp(expectedRegex);
  if (!regex.test(value)) {
    throw new Error(
      `Expected value at ${xpath} to match ${expectedRegex}, but got ${value}. ${errorMessage}`,
    );
  }
}

async function _handleAction(page: Page, action: Actions): Promise<void> {
  if (action.action === "goto-url") {
    await page.goto(action.url);
    return;
  }

  if (action.action === "goto-link") {
    await page.locator(`a[${action.xpath}"]`).click();
    return;
  }

  if (action.action === "submit") {
    const form = page.locator(action.formSelector ?? "form");
    for (const [name, value] of Object.entries(action.data)) {
      const input =
        value.selector !== undefined
          ? page.locator(value.selector)
          : form.locator(`input[name="${name}"]`);
      await handleInput(input, value);
    }
    const submitButton = action.submitButtonSelector
      ? page.locator(action.submitButtonSelector)
      : form.locator("button[type='submit'], input[type='submit']");

    await submitButton.click();
    return;
  }

  if (action.action === "assert-url") {
    const currentUrl = page.url();
    if (currentUrl !== action.url) {
      throw new Error(`Expected URL ${action.url}, but got ${currentUrl}`);
    }
    return;
  }

  if (action.action === "assert-attribute") {
    const element = page.locator(action.xpath);
    const attributeValue = await element.getAttribute(
      action.attribute,
      action.options,
    );
    assertRegex(
      action.xpath,
      attributeValue,
      action.expectedRegex,
      `Expected attribute ${action.attribute} to match ${action.expectedRegex}, but got ${attributeValue}`,
    );
    return;
  }

  if (action.action === "assert-text") {
    const element = page.locator(action.xpath);
    const textContent = await element.textContent(action.options);
    assertRegex(
      action.xpath,
      textContent,
      action.expectedRegex,
      `Expected text content to match ${action.expectedRegex}, but got ${textContent}`,
    );
    return;
  }

  action satisfies never;
}
