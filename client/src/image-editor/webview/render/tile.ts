/**
 * The fixed unzoomed footprint (px) each frame is centered within. Shared so the compass rose lays
 * its cells out on a uniform grid (CompassRose sizes its 3x3 tracks to this) and every frame anchors
 * at the same on-screen point regardless of its own width/height (FrameCanvas centers within it).
 */
export const TILE_BASE_PX = 96;
