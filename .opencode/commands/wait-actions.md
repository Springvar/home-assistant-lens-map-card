---
description: Wait for GitHub Actions and report status
agent: build
---

Wait for GitHub Actions to complete after a push and report the results.

## Steps

1. Get the latest commit SHA:
   ```bash
   git rev-parse HEAD
   ```

2. List workflow runs for the repository:
   ```bash
   gh run list --limit 10
   ```

3. Wait for workflows to complete:
   ```bash
   gh run watch <run-id>
   ```

4. Get the final status:
   ```bash
   gh run view <run-id>
   ```

## Expected Workflows

- **Validate**: Runs `npm test` then `npm run build`
- **Build**: Builds and uploads `dist/` as artifact

## Report Format

For each workflow, report:
- Name (Validate/Build)
- Status (queued/in_progress/completed/failed/success)
- Duration
- If failed, which step failed

## If Actions Fail

1. Review the error messages
2. Identify what needs to be fixed locally
3. Make the fixes
4. Run tests locally: `npm test`
5. Run build locally: `npm run build`
6. Commit and push the fixes
7. Wait for Actions again

## Notes

- Requires GitHub CLI (`gh`) to be installed and authenticated
- If `gh` is not available, manually check: https://github.com/Springvar/home-assistant-lens-map-card/actions