# Native Mofli companion actions

These offline packages contain @mofli/core and @mofli/grove 0.2.0 from the clean local Mofli checkout at commit `f594ea758755e12bcd3df8a2ea89eeaa45b4395e` (https://github.com/iHeyTang/Mofli).

They were packed with `npm pack --ignore-scripts` from the checkout’s built package directories. Each archive includes its MIT license and third-party notices. No absolute local path is needed at install time. The root pnpm override makes Grove use the same packaged Core. Studio remains at its published 0.1.1 version with its own compatible Core dependency.

The published 0.1.1 Grove package lacks companionActions. Onboarding uses the native `happy-dance`, `victory-hop`, and `brake-rock` actions. Replace both archives and the scoped override with published versions together when 0.2.0 is released.
