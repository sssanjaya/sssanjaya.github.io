# Baking the desk's light

The 3D desk on the home page is not lit in the browser. Its light is
path-traced once with [Blender](https://www.blender.org) (Cycles) and stored
as eight greyscale lightmaps in `public/lightmap/`: for the room and for the
desk, one each for the table lamp, the desk lamp, the monitor and the window.
The page adds them up, each times how bright that source is at the moment, so
the lamps still switch (`src/scripts/rack.ts`, "light").

Re-bake whenever geometry in `src/scripts/rack.ts` changes: anything added,
removed, moved or reshaped. The page warns in the console when the stored
lightmaps no longer match the scene.

```bash
npm run dev                                   # serves the page; note the port
node tools/bake/dump.cjs http://localhost:4321 /tmp/bake    # 1. scene out of the page
python tools/bake/bake.py /tmp/bake 96                      # 2. path-trace (about 40 min on 4 cores)
node tools/bake/pack.cjs /tmp/bake                          # 3. write the site's files
```

- Step 1 needs [Playwright](https://playwright.dev) (`npm i -D playwright`, or
  set `PLAYWRIGHT` to its path). It opens the page with `?bake`, which lays
  the lightmap charts out afresh and hands over every lit mesh.
- Step 2 needs the `bpy` module (`pip install bpy`) or Blender's own Python.
  The second argument is samples per texel; a third picks sources (`l`, `r`,
  `m`, `a`) to re-bake only some.
- Step 3 writes `public/lightmap/*.webp` and `src/data/lightmap.ts` (where
  each mesh's charts are, and the light on each keycap and leaf). Commit both.

How bright and what colour each source is in the page is set in `rack.ts`
(`GAIN`, `TINT`), not baked, so those can be tuned without a re-bake.
