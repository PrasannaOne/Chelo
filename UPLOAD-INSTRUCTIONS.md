# Install Chelo from Chelo.zip

1. Ensure `.github/workflows/chelo.yml` contains the current installer workflow supplied separately with this release. This is a one-time workflow setup/update.
2. Upload or replace `Chelo.zip` in the repository root. Do not upload it inside a folder.
3. Commit the upload to `main`. The installer validates the archive, builds and tests the native/WebAssembly engine, prepares a static-site artifact, then synchronizes the application into the repository root.
4. The sync removes obsolete application/project files that are absent from the archive. It preserves `.git/`, `.github/`, and `Chelo.zip`.
5. GitHub Pages deployment remains managed separately by the repository's Pages configuration.

## Archive layout

The ZIP top level contains application files directly: `index.html`, `cpp/`, `src/`, `models/`, `tests/`, `docs/`, and so on. It does not contain an enclosing version-named folder or GitHub workflow definitions.

## Safety

The installer rejects path traversal, duplicate paths, symlinks, secret `.env` files, Git metadata, and archives above its configured uncompressed-size limit.
