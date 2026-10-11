# Image and typography provenance

Eight food category images and a design concept were generated for this project using the image-generation tool on 11 October 2026. No publisher food photographs, logos or likenesses were copied. Recipe cards and detail pages label these images as AI-generated category illustrations, not photographs of an individually tested dish. An image may illustrate a category rather than the exact ingredients or plating of the selected recipe.

| Asset | Brief description | Original generation ID |
|---|---|---|
| seafood.webp | Plated fish, greens and citrus | exec-47a16969-a7a4-4e43-80e8-a56492515c09 |
| chicken-turkey.webp | Chicken with vegetables | exec-2a363375-e478-4b5d-bc7b-1fcb71163f02 |
| meat.webp | Plated meat meal | exec-87743ac3-7044-4c92-ae40-2fcf995610bd |
| vegetarian.webp | Tofu and vegetables | exec-97119a3a-8bd4-4fc8-90a3-55ab5e03e268 |
| breakfast.webp | Eggs and breakfast ingredients | exec-14392b93-02ac-43b3-bfb7-5b560888cd11 |
| quick-dinners.webp | Wrap-style quick dinner | exec-f15366a0-6de2-4be0-9838-0f3767370a85 |
| snacks-sides.webp | Crisp savoury vegetables/snacks | exec-80afd80d-81bf-445e-8d9a-75fac4d26ea0 |
| desserts.webp | Small sweet baked dishes | exec-6de70b2f-7e96-4ee8-87b8-261305ed2367 |

These are descriptive briefs, not claims to reproduce the exact generation prompts. The original PNGs were converted to WebP at quality 88 using Sharp. Runtime files are bundled locally under `public/images/`; builds do not need an image API or the original generation directory. `scripts/prepare-images.mjs` accepts the directory of those named generated PNGs if reconversion is needed.

The saved interface direction is `docs/design-concept.png` (generation exec-b5539c34-a15b-46fe-b6a1-7d75fd9c7d44). It is a design reference, not a screenshot of functional software. The actual application screenshots are under `docs/screenshots/`.

The app icon is an original SVG illustration with derived 192px/512px PNGs. Lucide provides interface icons through the installed package; its licence is distributed with that package. Fraunces and DM Sans are loaded from local Fontsource packages, with their font licences copied into `public/THIRD-PARTY-NOTICES.txt` alongside the direct runtime dependency notices. This notice file is included in the built app and offline cache. No remote font request is required at runtime. Generated food assets have provenance labels rather than invented Creative Commons or stock-photo licences.
