# Releasing

The three packages, `@physiomelinks/math-ast`, `@physiomelinks/cellml-units` and `@physiomelinks/bg2cellml`, are released together with one version number, using [Changesets](https://github.com/changesets/changesets). `examples/browser` is private and never released.

## Recording a change

With a pull request that changes what a package does, add a changeset:

```sh
yarn changeset
```

Choose the packages and the bump (patch, minor or major), and write a line for the changelog. It goes in `.changeset/` as a Markdown file; commit it with the change. The three packages are a fixed group in `.changeset/config.json`, so whichever bump is the largest applies to all three.

## Making a release

1. On a branch, turn the changesets into versions and changelogs:

   ```sh
   yarn changeset version
   yarn install          # updates yarn.lock
   ```

   This bumps the version in each `package.json`, writes each `CHANGELOG.md` and deletes the changeset files. Check the changelogs, then commit and open a pull request.

2. Merge it into `main`. The **Release** workflow (`.github/workflows/release.yml`) builds and tests everything, checks that the packed packages install into an empty project and work, publishes every package whose version isn't on npm yet with `yarn changeset publish`, pushes a tag per package (`@physiomelinks/bg2cellml@0.1.0`), and then installs the released version from npm into an empty project to check it. It can also be run by hand from the Actions tab.

Publishing uses npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers): the workflow's GitHub identity is exchanged for a short-lived publish token, so there is no npm token in the repository, and each version gets a [provenance](https://docs.npmjs.com/generating-provenance-statements) statement linking it to the commit and workflow run that built it.

## Checking the packages install

```sh
yarn build
node tools/release/check-install.mjs --packed          # yarn pack each package, as it would be published
node tools/release/check-install.mjs --version 0.1.0   # from npm
```

Either way it makes an empty npm project in a temporary directory, installs the three packages with libcellml.js, oxigraph and `@xmldom/xmldom`, converts BG-RDF's `example_RC` in Node, and typechecks a TypeScript file against the packages' declarations (with `skipLibCheck` off; only oxigraph's own declarations, which don't pass that check, are excused).

## The first release (0.1.0), by hand

npm only lets a trusted publisher be added to a package that already exists, so 0.1.0 is published once from a computer, and the workflow takes over from 0.1.1 on.

1. The `@physiomelinks` organisation already exists on npm (it has `@physiomelinks/protocol-kit`). Make sure your npm account is a member that can publish to it, with two-factor authentication on.
2. Log in, from the repository root:

   ```sh
   yarn npm login --publish
   ```

3. From the 8.2 branch (`stage8.2-release`), where the versions are already 0.1.0, build and publish:

   ```sh
   yarn install && yarn build
   node tools/release/check-install.mjs --packed
   yarn changeset publish      # asks for a one-time password; no provenance from a computer
   git push origin --tags
   node tools/release/check-install.mjs --version 0.1.0
   ```

   Do this, and step 4, **before** merging the 8.2 pull request. Merging runs the Release workflow, which then finds 0.1.0 already on npm, publishes nothing, and checks the install from npm. Merged first, that run would fail, as the workflow can't publish until the trusted publishers exist.

4. On npmjs.com, for each of the three packages: *Settings* → *Trusted publishing* → *GitHub Actions*, with organisation or user `physiomelinks`, repository `celldl2cellml`, workflow file `release.yml`, and no environment.
5. Then, in each package's *Settings* → *Publishing access*, choose *Require two-factor authentication and disallow tokens*, so only the workflow (and you, with two-factor) can publish.
