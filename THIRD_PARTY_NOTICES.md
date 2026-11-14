# Third-party notices

## SPM family — Ist1na

`vendor/spm/spm_algorithm.js`, `tag_engine.js` and `dan_constants.json` are copied
unchanged from [SPM Map Analyser](https://github.com/Ist1na07/spm_rating_map_analyser)
at **b074e0f42410fa176e3c5c3be3b362fa8dc7375c**. Copyright (c) 2026 Ist1na.
MIT license: [vendor/spm/LICENSE](vendor/spm/LICENSE).

- [SPM Rating](https://github.com/Ist1na07/SPMRating): SPM Rating v1.2.0-rc3,
  Detailed and Compact parameter sets, JavaScript implementation by Ist1na.
- [SPM Submodel](https://github.com/Ist1na07/SPMSubmodel): RC/LN submodels,
  integrated by the same upstream analyser.
- [SPMTagClassifier](https://github.com/Ist1na07/SPMTagClassifier): package
  version 1.2.4, pinned runtime at **b311c408ef02d6705d30b51a4ea789d3e86d2976**.
  This includes the retuned local expert and pressure-aware Break repair;
  the published v1.2.4 tag alone does not identify this exact runtime.

The rating architecture acknowledges **sunnyxxy / sunny-rework**
([Star-Rating-Rebirth](https://github.com/sunnyxxy/Star-Rating-Rebirth)), as
recorded in SPM Rating's NOTICE. The SPM implementation is independently
implemented; this acknowledgment does not assert a license grant from that
project. No Sunny Rework runtime is bundled or used as SPM Box's rating engine.

## OsuManiaToolbox — zzzzv

[OsuManiaToolbox](https://github.com/zzzzv/OsuManiaToolbox), copyright (c) 2026
zzzzv, MIT. Acknowledged as the functional reference for local library browsing,
difficulty sorting and collection creation. SPM Box's desktop application,
database codec and collection ownership/transaction implementation are new;
no OsuManiaToolbox source files are bundled.

## Electron and development tooling

The desktop runtime uses [Electron](https://www.electronjs.org/), copyright
Electron contributors and GitHub Inc., MIT. Its runtime license and Chromium
third-party notices are retained in distributed builds as `LICENSE.electron.txt`
and `LICENSES.chromium.html`. Chromium and Node.js include their own third-party
components; those notices govern them rather than SPM Box's MIT license.

Build/test-only dependencies include electron-builder (MIT) and Playwright
(Apache-2.0). Their notices remain with the installed packages. They are not
application runtime dependencies. Exact versions are locked in `package-lock.json`.

No beatmaps, songs, user databases, research datasets or upstream screenshots
are distributed. UI screenshots in this repository use generated test fixtures.
