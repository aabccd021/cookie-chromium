import * as fs from "node:fs";
import type { Locator, Page } from "playwright";

export type FormInput =
  | {
      type: "text";
      value: string;
    }
  | {
      type: "radio";
      value: string;
    }
  | {
      type: "checkbox";
      checked: boolean;
    };

export type Action =
  | {
      action: "goto-url";
      value: string;
    }
  | {
      action: "goto";
      xpath: string;
    }
  | {
      action: "submit";
      button?: string;
      data?: Record<string, { type: "text"; value: string }>;
    }
  | {
      action: "time-advance";
      value: number;
    }
  | {
      action: "assert-url";
      expected: string;
    }
  | {
      action: "assert-attribute";
      xpath: string;
      attribute: string;
      expected: string;
    }
  | {
      action: "assert-text";
      xpath: string;
      expected: string;
    };

export type Scenario = {
  prev: string;
  steps: string[];
};

export type Config = {
  steps: Record<string, Action>;
  scenarios: Record<string, Scenario>;
};

async function handleInput(
  form: Locator,
  name: string,
  input: FormInput,
): Promise<void> {
  if (input.type === "text") {
    const element = form.locator(`//input[@name='${name}']`);
    await element.fill(input.value);
    return;
  }
  if (input.type === "checkbox") {
    const element = form.locator(`//input[@name='${name}']`);
    if (input.checked) {
      await element.check();
    } else {
      await element.uncheck();
    }
    return;
  }
  if (input.type === "radio") {
    const element = form.locator(
      `//input[@name='${name}' and @value='${input.value}']`,
    );
    await element.check();
    return;
  }
  input satisfies never;
  throw new Error(`Unknown input type: ${JSON.stringify(input)}`);
}

export async function handleAction(
  neteroState: string,
  page: Page,
  action: Action,
): Promise<void> {
  if (action.action === "goto-url") {
    await page.goto(action.value);
    return;
  }

  if (action.action === "goto") {
    await page.locator(action.xpath).click();
    return;
  }

  if (action.action === "submit") {
    const form = page.locator("//form");
    for (const [name, input] of Object.entries(action.data ?? {})) {
      await handleInput(form, name, input);
    }
    const submitButton =
      action.button !== undefined
        ? page.locator(action.button)
        : form.locator("//button[@type='submit' or @action='submit']");
    await submitButton.click();
    return;
  }

  if (action.action === "time-advance") {
    const oldTimeStr = await fs.promises.readFile(
      `${neteroState}/now.txt`,
      "utf-8",
    );
    const oldTime = parseInt(oldTimeStr, 10);
    const newTime = oldTime + action.value;
    await fs.promises.writeFile(`${neteroState}/now.txt`, newTime.toString());
    return;
  }

  if (action.action === "assert-url") {
    const url = page.url();
    if (!new RegExp(action.expected).test(url)) {
      throw new Error(`Expected URL ${url} to match ${action.expected}`);
    }
    return;
  }

  if (action.action === "assert-attribute") {
    const attributeValue = await page
      .locator(action.xpath)
      .getAttribute(action.attribute);
    if (attributeValue === null) {
      throw new Error(
        `Attribute "${action.attribute}" not found for element at "${action.xpath}"`,
      );
    }
    if (!new RegExp(action.expected).test(attributeValue)) {
      throw new Error(
        `Expected attribute "${action.attribute}" to match "${action.expected}", but got "${attributeValue}"`,
      );
    }
    return;
  }

  if (action.action === "assert-text") {
    const textContent = await page.locator(action.xpath).textContent();
    if (textContent === null) {
      throw new Error(
        `Text content not found for element at "${action.xpath}"`,
      );
    }
    if (!new RegExp(action.expected).test(textContent)) {
      throw new Error(
        `Expected text content "${textContent}" to match "${action.expected}"`,
      );
    }
    return;
  }

  action satisfies never;
}
