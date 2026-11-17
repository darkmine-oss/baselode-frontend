# Baselode dependency update

Update the minimum Baselode dependency from `^0.1.71` to `^0.1.107`, the npm
`latest` release checked on 17 November 2026. Keep the existing caret policy
and ignored lockfile convention. No application API changes were required.

Verification: `npm ls baselode --depth=0` reports `0.1.107`; all 40 tests and
`npm run build` pass. No local server was started for this update.
