import { describe, expect, it } from "vitest";

import { parseCliOptions } from "../src/index";

describe("parseCliOptions", () => {
  it("supports both space and equals flag formats", () => {
    const options = parseCliOptions([
      "--panel",
      "core",
      "--personas=custom/personas",
    ]);
    expect(options).toEqual({
      panelName: "core",
      personasDir: "custom/personas",
    });
  });

  it("ignores malformed flag pairs", () => {
    const options = parseCliOptions([
      "--panel",
      "--personas",
      "--personas=",
      "--panel=",
    ]);
    expect(options).toEqual({});
  });
});
