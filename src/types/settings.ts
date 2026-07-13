/** 首页设置与播放界面设置类型 */

/** 播放界面设置（rnp-settings）相关类型 */
export type DisplayMode = "both" | "cover" | "lyrics";
export type ColorMode = "dark" | "light" | "auto";
export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "center" | "bottom";
export type BgType = "cover" | "blur" | "fluid" | "gradient" | "solid" | "none";
export type VisualizerStyle = "off" | "bars" | "lines" | "wave";
export type VisualizerColor = "accent" | "white" | "rainbow" | "album";
export type LyricAlign = "left" | "center";
export type AnimationTiming = "smooth" | "swift" | "bouncy" | "soft" | "spring";
export type FontFamily = "system" | "serif" | "rounded" | "mono" | "song";

/**
 * 3D 播放场景（移植自 Mineradio 粒子可视化引擎）
 * - off: 关闭 3D，使用原 2D 背景（blur/fluid/gradient/solid）
 * - silk: 丝绸粒子 — 封面粒子平面 + Z 位移
 */
export type Scene3D = "off" | "silk";

/** 首页设置（home-settings）相关类型 */
export type HomeBgType = "none" | "image";
