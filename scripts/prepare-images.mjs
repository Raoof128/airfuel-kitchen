import sharp from "sharp";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
const inputDirectory = process.argv[2];
if (!inputDirectory) {
  console.error(
    "Usage: node scripts/prepare-images.mjs /path/to/original-generated-pngs",
  );
  process.exit(1);
}
const images = [
  {
    name: "seafood",
    path: "exec-47a16969-a7a4-4e43-80e8-a56492515c09.png",
  },
  {
    name: "chicken-turkey",
    path: "exec-2a363375-e478-4b5d-bc7b-1fcb71163f02.png",
  },
  {
    name: "meat",
    path: "exec-87743ac3-7044-4c92-ae40-2fcf995610bd.png",
  },
  {
    name: "vegetarian",
    path: "exec-97119a3a-8bd4-4fc8-90a3-55ab5e03e268.png",
  },
  {
    name: "breakfast",
    path: "exec-14392b93-02ac-43b3-bfb7-5b560888cd11.png",
  },
  {
    name: "quick-dinners",
    path: "exec-f15366a0-6de2-4be0-9838-0f3767370a85.png",
  },
  {
    name: "snacks-sides",
    path: "exec-80afd80d-81bf-445e-8d9a-75fac4d26ea0.png",
  },
  {
    name: "desserts",
    path: "exec-6de70b2f-7e96-4ee8-87b8-261305ed2367.png",
  },
];
try {
  await mkdir("public/images", { recursive: true });
  for (const { name, path } of images) {
    // Cards render at ~350-680 CSS px (DPR 2-3), so 1200px wide is enough and
    // keeps visual quality. The 1536px originals made ~2.7 MB of precache.
    await sharp(resolve(inputDirectory, path))
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 80, effort: 6 })
      .toFile("public/images/" + name + ".webp");
  }
  console.log("Prepared all eight local category illustrations.");
} catch (error) {
  console.error(
    "Image preparation failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
}
