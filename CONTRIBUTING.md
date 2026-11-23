### Contributing

For a bug fix or feature, open an issue in the VibeTools TypeScript repository. A small documentation correction can go straight into a pull request. For an evaluation issue, include the provider, configuration, response text, and expected return type when relevant. GitHub offers the repository's templates when you open an issue or pull request. [VibeTools issues](https://github.com/vibe-engineers/vibetools-ts/issues/new/choose)

VibeTools follows a forking workflow. Branch from `main` in your fork and describe the effect of your change on the libraries that use VibeTools. Run `npm run lint` and `npm test` from the repository root. For a change to Python compatibility, install your packed build in each affected companion package and run its cross-language tests. [Testing instructions](docs/DeveloperGuide.md#testing)

### Releasing to npm

Maintainers can preview a release from **Actions → Publish to npm → Run workflow**. The workflow tests the package across supported Node.js versions and checks the exact npm archive installed by the tests.

For a release, update the version in the manifest and lockfile, update the changelog, then push a matching Git tag (for example, `v0.1.0`) on a commit from `main`. GitHub Actions uses npm trusted publishing to publish the tested archive automatically with signed provenance. The workflow checks its public npm integrity and provenance after publishing. Stable releases use `latest` and prereleases use `next`. [Publish workflow](https://github.com/vibe-engineers/vibetools-ts/actions/workflows/publish.yml) · [npm provenance](https://docs.npmjs.com/viewing-package-provenance/)

### Hacktoberfest Participation (October Yearly)

In October, the maintainers mark tasks for Hacktoberfest. [Open Hacktoberfest issues](https://github.com/vibe-engineers/vibetools-ts/issues?q=is%3Aissue+is%3Aopen+label%3Ahacktoberfest)

#### How to Get Involved

1. Read the overview of the shared modules. [VibeTools README](README.md)
2. Comment on an open issue and wait for a maintainer to assign it to you.
3. Read the sections of the guide that cover your change. [Developer Guide](docs/DeveloperGuide.md)
4. Submit a focused pull request with the related issue, test results, and any changes to downstream behavior.

#### Need Assistance?

For implementation questions, contact the team on Discord. The Contributor Covenant applies in project spaces. [Community Discord](https://discord.gg/dBW35GBCPZ) · [Code of Conduct](CODE_OF_CONDUCT.md)
