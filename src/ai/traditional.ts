import OpenCC from "opencc-js/cn2t";

// Qwen 偶爾會混入簡體字；回傳前轉成台灣繁體。只在伺服器端（API 路由）使用，字典不會打包進前端
const convert = OpenCC.Converter({ from: "cn", to: "tw" });

export const toTraditional = (text: string): string => convert(text);
