import Image from "next/image";

// 遊戲背景：夜晚／白天兩層疊放，以透明度淡入淡出切換；外加暗色漸層確保中間 UI 可讀
// fixed：用於可捲動的長頁面，背景固定在手機寬度的視窗內，不隨內容拉長
export function SceneBackground({ isNight, fixed = false }: { isNight: boolean; fixed?: boolean }) {
  const position = fixed ? "fixed inset-y-0 left-1/2 w-full max-w-[480px] -translate-x-1/2" : "absolute inset-0";
  return (
    <div aria-hidden className={`pointer-events-none -z-10 overflow-hidden ${position}`}>
      {(["night", "day"] as const).map((scene) => (
        <Image
          key={scene}
          src={`/scenes/${scene}.jpeg`}
          alt=""
          fill
          priority={scene === "night"}
          sizes="(max-width: 480px) 100vw, 480px"
          className={`object-cover transition-opacity duration-1000 ${(scene === "night") === isNight ? "opacity-100" : "opacity-0"}`}
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-b from-night/60 via-night/55 to-night/35" />
    </div>
  );
}
