# Initial AirFuel Kitchen design and delivery plan

The implemented upgrade is described in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) and [ARCHITECTURE.md](ARCHITECTURE.md). This file preserves the original architecture checkpoint.

## Architecture before implementation
React + TypeScript + Vite. Static immutable, schema-validated recipe catalogue; user data in Dexie IndexedDB. No server, accounts, tracking or paid API is needed. Hash routes keep shared links and offline navigation portable. PWA caches the app, recipe data, local fonts and images. Optional cloud integration is isolated and unavailable unless configured and tested.

## Safety boundaries
React text rendering only (no source HTML). Strict Zod boundaries for custom recipes and backup imports with bounded sizes and safe URLs. Backup replace requires a preview and confirmation and uses an atomic transaction. Canonical records never share a table with user activity. Every mutation handles persistence failures. Allergen exclusions are hard recommendation constraints. Tried flags never imply consumption; only explicitly logged servings count towards consumed protein. Persistent storage is requested in Settings and backup remains necessary.

## Work streams
1. Recipe provenance: independently open sources, write original metric recipes, record verified dates, nutrition evidence and rejections. Target 300 after the user raised the original 180 goal; only validated recipes are counted.
2. Persistence, backup, recommendation and aggregation logic with focused unit tests.
3. Editorial visual design and complete responsive React workflows.
4. Integration, browser journeys, offline/reload/multi-tab/migration/import tests, accessibility and screenshots.
5. Document actual evidence and unresolved limitations. No remote push or public deployment.

## Visual direction
Warm off-white canvas, ink charcoal type, terracotta primary actions and sage accents. Editorial serif headings paired with a clean locally bundled sans serif. A quiet side navigation, generous main content and image-led hero. Real user statistics only. Card photography is explicitly illustrative if generated. Native controls, visible focus, comfortable touch targets and reduced motion.
