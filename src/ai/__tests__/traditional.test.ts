import { describe, expect, it } from "vitest";
import { toTraditional } from "../traditional";

describe("簡轉繁", () => {
  it("把混入的簡體字轉成台灣繁體", () => {
    expect(toTraditional("我老K玩这么久，別被带節奏")).toBe("我老K玩這麼久，別被帶節奏");
    expect(toTraditional("2号悍跳，今天全场归票")).toBe("2號悍跳，今天全場歸票");
  });

  it("本來就是繁體的發言保持不變", () => {
    const text = "預言家查殺了 3 號，今天全場歸票，裡面肯定有狼，著急的人最可疑。";
    expect(toTraditional(text)).toBe(text);
  });
});
