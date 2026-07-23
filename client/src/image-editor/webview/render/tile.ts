/**
 * The fixed unzoomed footprint (px) each frame is centered within. Shared so every layout sizes its
 * cells uniformly (CompassRose derives its circle radius from it, CycleGrid its cell size) and every
 * frame anchors at the same on-screen point regardless of its own width/height (FrameCanvas centers
 * within it).
 */
export const TILE_BASE_PX = 96;
