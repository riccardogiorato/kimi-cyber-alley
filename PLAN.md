# PLAN — kimi-cyber-alley

A fully procedural, zero-asset cyberpunk back-alley. Vite + Three.js + TypeScript, Bun toolchain.
Everything (geometry, textures, signs, grime) is generated in code at startup.

## Subsystem breakdown

| # | Subsystem | Module(s) | Contract |
|---|-----------|-----------|----------|
| 1 | Toon shading | `src/core/toon.ts` | `makeToon(opts)` → MeshToonMaterial with hue-shifted shadow bands (teal/violet darks, never black). Hand-authored 2–4 band gradient ramp. |
| 2 | Ink post-pass | `src/core/post.ts` | `InkPipeline` — renders scene to depth, inks from the **second difference of linearised depth** (positive curvature strong, negative faint), distance-faded. Also owns the final split-tone grade pass (lifted blacks, teal/violet darks, warm highlights, sRGB) and FXAA resolve at 1.5–2x supersample. NO bloom/DoF/motion blur. |
| 3 | Canvas2D texture factory | `src/core/textures.ts` | Sign faces (latin + Japanese), posters, stickers, graffiti, menu strips, road grime + painted neon reflection smears. Flat graphic style, glow painted INTO the texture, system fonts only. Returns `CanvasTexture`. |
| 4 | Facade kit | `src/world/facades.ts` | Towering walls both sides, instanced box kits: AC units, louvered vents, pipes, ducts, conduit, balconies, external staircases. Lower walls layered with posters/graffiti. |
| 5 | Signage + local lights | `src/world/signs.ts` | THE SIGNS ARE THE LIGHTS. Pink hotel sign (huge, perpendicular, high), karaoke tube, 24時間営業 lightbox, round green 営業中, vertical kanji towers, flickering animated signs. Each major sign owns a coloured PointLight pool. Emissive toon materials, no bloom. |
| 6 | Noodle stand | `src/world/noodleStand.ts` | Mid-alley: steam, hanging menu strips, stools, glowing warmer case, warm stall lanterns. |
| 7 | Props & litter | `src/world/props.ts` | Vending machines (recessed, glowing, instanced cans behind glass), trash bags, cardboard, cans/bottles, newspapers, crates, one plastic chair, stray cat, red paper lantern rows + hanging lanterns. Inverted-hull outlines on 3–5 hero props (vending machine, noodle stand, hover-bike). |
| 8 | Particles & weather | `src/world/atmosphere.ts` | Steam/haze billboards at vents + T-junction, dripping pipes, light rain streaks through tarp gaps. |
| 9 | Overhead clutter | `src/world/overhead.ts` | Tarps, awnings, cable bundles, ductwork choking the sky; T-junction glimpse (steam, distant glow, one more neon sign) so the world feels bigger. |
| 10 | Player controller | `src/core/player.ts` | Pointer-lock FPS, WASD + Shift run, Esc release, AABB collision vs `ctx.colliders` + alley bounds. |
| 11 | Bootstrap | `src/main.ts` | Renderer, scene, camera, module assembly, loop, resize. |

## Shared contracts

- `src/core/types.ts`: `ALLEY` layout constants (alley along +Z, ~3.6m wide, 70m long, T-junction at the end), `AlleyContext` (seeded PRNG + collider list), `BuiltPart` (group + optional update hook).
- Deterministic: every module gets a seeded `mulberry32` PRNG — the alley is identical on every load.
- Collision: modules push world-space `Box3`es into `ctx.colliders`.

## Review log

_(filled in as review rounds complete)_
