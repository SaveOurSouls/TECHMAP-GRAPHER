import { describe, expect, it } from "vitest";
import { bytesToBase64, readTemplateAsset } from "./template-assets";

describe("component template image assets", () => {
  it("encodes arrays larger than the JavaScript argument limit in chunks", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 251);
    expect(atob(bytesToBase64(bytes))).toHaveLength(bytes.length);
  });

  it("accepts a server-supported raster media type", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "contact.png", { type: "image/png" });
    await expect(readTemplateAsset(file)).resolves.toEqual({
      fileName: "contact.png",
      mediaType: "image/png",
      contentBase64: "AQID",
    });
  });

  it("rejects unsupported and empty files before making a request", async () => {
    await expect(readTemplateAsset(new File(["svg"], "contact.svg", { type: "image/svg+xml" })))
      .rejects.toThrow("PNG");
    await expect(readTemplateAsset(new File([], "empty.png", { type: "image/png" })))
      .rejects.toThrow("от 1 байта");
  });
});
