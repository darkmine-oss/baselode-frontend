# Contributing to Baselode Viewer

Thanks for your interest in improving Baselode Viewer. Bug reports, feature
ideas, documentation fixes and code are all welcome.

Please read this whole file before opening a pull request. Section 4, the
**Contributor Licence Agreement**, applies to every contribution and must be
accepted before any pull request can be merged.

---

## 1. Ways to contribute

- **Report a bug.** Open a GitHub issue with the app version, your operating
  system, what you expected, what happened, and, if possible, a small sample
  project folder that reproduces it. Please do not attach confidential or
  unreleased exploration data: reduce the problem to synthetic data or the
  bundled GSWA demo set (`test-data/demo-gswa/`).
- **Suggest a feature.** Open an issue describing the problem you are trying
  to solve before starting work, so we can agree on the approach.
- **Submit a change.** Fork the repository, make your change on a branch and
  open a pull request against `main`.

Security issues should not be reported in public issues. Use GitHub's
**Report a vulnerability** option on the repository's Security tab instead.

## 2. Development setup

See the **Running** section of [`README.md`](README.md) for prerequisites
(Node 24+, Rust via rustup, and on Windows the C++ Build Tools and WebView2).

```sh
npm install
npm run dev          # web build in the browser, no Rust needed
npm run tauri:dev    # full desktop app
npm run build        # must pass before you open a pull request
```

Use the bundled `test-data/demo-gswa/` folder to exercise the app.

## 3. Making a change

- **Keep pull requests focused.** One feature or fix per pull request.
- **Keep Tauri-specific code behind `src/lib/projectIo.js`.** The UI must keep
  working in a plain browser (`npm run dev`); check with `isTauri()` rather
  than importing `@tauri-apps/*` packages directly in components.
- **Rendering and parsing logic usually belongs upstream** in the
  [`baselode`](https://github.com/darkmine-oss/baselode) library rather than
  in this app. If a change needs a library change, say so in the pull request.
- **Feature notes.** Larger features are scoped in a short note under
  `.features/` (outcome, behaviour, dependencies, verification). Add or
  update one if your change adds user-facing behaviour.
- **Tauri dependency versions.** Keep the `@tauri-apps/*` JavaScript packages
  on the minor versions that match the Rust crates in `src-tauri/`.
- **Permissions.** Do not widen the filesystem scope in
  `src-tauri/capabilities/default.json` without explaining why in the pull
  request.
- **Data.** Only commit data you have the right to redistribute, and include
  its licence and attribution (see [`DATA_LICENSE.md`](DATA_LICENSE.md)).
- **Verification.** Describe in the pull request how you tested the change,
  including the platform(s) you ran it on.

## 4. Contributor Licence Agreement

Baselode Viewer is published under the GNU General Public License v3.0 or
later, with an additional permission for Darkmine Pty Ltd described in
[`LICENSE`](LICENSE). So that Darkmine can continue to maintain the project
and use it under that additional permission, every contributor must agree to
the terms below.

**You accept these terms by opening a pull request and ticking the
agreement box in its description.** If you contribute on behalf of an
employer or another organisation, you confirm that you are authorised to
accept these terms on its behalf.

### 4.1 Definitions

- **"Darkmine"** means Darkmine Pty Ltd (ACN 694 885 455) and its successors
  and assigns.
- **"You"** means the individual or legal entity submitting a Contribution.
- **"Contribution"** means any code, documentation, data, design or other
  material that You submit to this repository, by pull request, patch, issue
  or any other means, that is intended for inclusion in the project.

### 4.2 Copyright licence to Darkmine

You grant Darkmine a perpetual, worldwide, non-exclusive, no-charge,
royalty-free, irrevocable licence to use, reproduce, modify, prepare
derivative works of, publicly display, publicly perform, sublicense and
distribute Your Contributions and such derivative works, under any licence
terms Darkmine chooses, including proprietary and commercial terms and
including in web, desktop, mobile and hosted software.

### 4.3 Licence to everyone else

Your Contribution is also licensed to all recipients of the project under
the GNU General Public License v3.0 or later, the same terms as the rest of
the project.

### 4.4 Patent licence

You grant Darkmine and all recipients of the project a perpetual, worldwide,
non-exclusive, no-charge, royalty-free, irrevocable patent licence to make,
have made, use, sell, offer for sale, import and otherwise transfer Your
Contribution, alone or combined with the project, for any patent claims You
can license that are necessarily infringed by Your Contribution.

### 4.5 Moral rights

To the extent permitted by law, You consent to Darkmine and its licensees
doing anything with Your Contribution that would otherwise infringe Your
moral rights, including under Part IX of the *Copyright Act 1968* (Cth),
such as modifying it or using it without attribution.

### 4.6 Your representations

You confirm that:

1. each Contribution is Your original work, or You otherwise have the right
   to submit it under these terms;
2. if Your employer or anyone else has rights in the Contribution, they have
   given permission for You to submit it under these terms;
3. You will identify any part of a Contribution that is not Your original
   work, along with its source and licence; and
4. You will tell Darkmine if any of these statements stop being true.

### 4.7 You keep your copyright

These terms grant licences; they do not transfer ownership. You keep the
copyright in Your Contributions and may use them for any other purpose.

### 4.8 No obligation and no warranty

Darkmine is not required to accept or use any Contribution. Contributions
are provided "as is", without warranties of any kind, except as stated in
section 4.6.

### 4.9 Governing law

These terms are governed by the laws of Western Australia, Australia.

---

## 5. Pull request checklist

Copy this into your pull request description:

```markdown
- [ ] I have read CONTRIBUTING.md and agree to the Contributor Licence
      Agreement in section 4 on behalf of myself (and my employer, if
      applicable).
- [ ] `npm run build` passes.
- [ ] I have described how I tested this change and on which platform(s).
```

Pull requests without the agreement box ticked cannot be reviewed or
merged.

## 6. Code of conduct

Be respectful and constructive. Harassment or abusive behaviour in issues,
pull requests or discussions will not be tolerated, and maintainers may
remove such content or block participants.
