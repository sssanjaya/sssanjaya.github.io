# 3D models

Every model in this folder comes from [Poly Haven](https://polyhaven.com) and is
released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
(public domain). No attribution is required; this file is here so the source of
each file is on record.

| Folder | Poly Haven asset | Author |
|---|---|---|
| `plant` | [Potted Plant 04](https://polyhaven.com/a/potted_plant_04) | James Ray Cock |
| `lamp` | [Desk Lamp Arm 01](https://polyhaven.com/a/desk_lamp_arm_01) | Kuutti Siitonen (modelling and texturing), Yann Kervran (rigging) |
| `glasses` | [Round Spectacles](https://polyhaven.com/a/round_spectacles) | Sean Buckley |
| `stationery` | [Stationery Supplies](https://polyhaven.com/a/stationery_supplies) | Mateusz Sadek |
| `notebook` | [Binder Notebook](https://polyhaven.com/a/binder_notebook) | DaDrood |
| `clock` | [Wall Clock](https://polyhaven.com/a/wall_clock) | PierreB3D |

Licence terms: https://polyhaven.com/license

## How they were prepared

Each asset was downloaded as glTF with 1k textures and then shrunk for the web
with [glTF-Transform](https://gltf-transform.dev):

- unused parts removed (the open notebook, some of the pens)
- triangle count reduced where the model was heavy (lamp, glasses, notebook)
- textures resized to 256 to 1024 px and converted to WebP
- geometry quantized (`KHR_mesh_quantization`)
- refraction (`KHR_materials_transmission`) dropped; glass is drawn as plain
  blending by the scene

They are stored as `.gltf` + `.bin` + `.webp`, not `.glb`, and without Draco or
meshopt compression. That is deliberate: the site's Content-Security-Policy
allows neither WebAssembly (which those decoders need) nor `blob:` URLs (which
embedded textures need).
