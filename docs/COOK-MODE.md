# Cook mode

Open a recipe and choose **Start cooking**, then **Begin cooking** in its focused workspace. The URL is `#/cook/<recipe-slug>`; an optional `?servings=2` selects the initial portions. Invalid portion values fall back to the kitchen preference. An existing cook always supplies its saved portions.

The workspace shows one large step, ingredients scaled to the selected portions, a timer and distinct air-fryer and food-core temperatures. Safety and setup notes are always reachable from the temperature strip. **Done, next step** saves a step and moves to the next unfinished one. Previous/Next and the full step overview change the view without marking anything complete. Reopening cook mode resumes the first unfinished step; when all are checked, it shows the last step.

Checklist changes, portions, paused timer seconds and the absolute timer deadline use the existing IndexedDB active-cooking record. Closing the page does not erase them. The interface refreshes the remaining time on foregrounding; background throttling does not restart or extend the deadline. A timer is a reminder and does not verify food safety. There is no closed-app notification or audible alarm.

Starting another recipe asks before replacing the active checklist and timer. The confirmation is checked against the expected active recipe in an IndexedDB transaction. If another tab changes the active cook first, the operation fails and asks the user to review the current recipe. Ordinary timer, serving and checklist changes cannot replace a different recipe or recreate a completed cook.

**Keep screen awake** uses the browser Screen Wake Lock API only after the button is selected. Support depends on the device and browser. The lock is released when leaving the workspace or when another tab finishes, stops or replaces this cook. A pending lock request that resolves after the cook disappears is also released. Browsers may release the lock when the page is hidden or power-saving policies apply. A released lock can be requested again. Wake lock failure never blocks cooking or storage.

**Finish & save** opens the existing cooking-session form. The user records the portions actually prepared and eaten, timing, rating and notes. Saving marks the recipe as tried and atomically clears its active checklist and timer; opening or cancelling the form changes neither. Finishing is available even with unchecked steps because the checklist cannot prove what physically happened in the kitchen. The form makes no food-safety claim.

Replacement conflicts and failed session saves show an inline alert inside their dialog. The session draft remains available for correction and retry. Error visibility does not depend on the global toast outside the modal.

## Integration and validation

- `CookMode({ slug, initialServings? })` is exported from `src/pages/CookMode.tsx`.
- `CookingTimer({ recipe, servings })` is reusable in recipe details. It requires an active cook for that recipe and disables mutation otherwise.
- Both import `src/styles/cook-mode.css`; its rules use the existing theme variables and are scoped to cook-mode classes.
- Timer logic tests cover deadlines after backgrounding, pause/resume with fresh wall time, reset/restart and invalid input. Browser coverage lives in the upgrade test suite and checks interactions, persistence and responsive layouts.

No new dependency, cloud connection, notification permission or personal data collection is introduced by cook mode.
