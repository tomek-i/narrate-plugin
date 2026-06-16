# GitHub hardening — `tomek-i/narrate-plugin`

Protective configuration for this **public** repo. Items marked ✅ were applied
via the `gh` CLI already; items marked 🔲 are manual or need a decision.

> Repo: `tomek-i/narrate-plugin` · default branch: `main`

---

## 0. TL;DR of what's already on

✅ Branch protection on `main`: PRs required, force-pushes & deletions blocked,
   conversation resolution required (admins can still bypass — see §1).
✅ Secret scanning **+ push protection** (blocks committing credentials).
✅ Dependabot **alerts** + **automated security fixes**.
✅ GitHub Actions token defaults to **read-only**.
✅ Auto-delete head branches after merge.

🔲 Push the committed `.github/` files (CI, Dependabot config, templates, CODEOWNERS) — §6.
🔲 Make the **CI check required** once it has run once — §2.
🔲 Decide whether to enforce protection on admins too — §1.
🔲 Turn on account **2FA** if not already — §7.

---

## 1. Branch protection (no direct pushes → PRs only)

Already applied to `main`:

- **Require a pull request before merging** (0 required approvals — solo-friendly).
- **Dismiss stale approvals** on new commits.
- **Require conversation resolution** before merging.
- **Block force pushes** and **block branch deletion**.
- `enforce_admins = false` → **you (an admin) can still push to `main` directly**,
  so you can never lock yourself out. Collaborators you add must use PRs.

Verify / view:

```bash
gh api repos/tomek-i/narrate-plugin/branches/main/protection | jq '{pr:.required_pull_request_reviews,force:.allow_force_pushes,del:.allow_deletions,admins:.enforce_admins}'
```

### Make it stricter (optional)

- **Enforce on admins too** (forces *you* through PRs as well):
  ```bash
  gh api -X POST repos/tomek-i/narrate-plugin/branches/main/protection/enforce_admins
  ```
  Disable again with `-X DELETE`.
- **Require ≥1 approval** (note: GitHub won't let you approve your *own* PR, so on
  a solo repo this blocks merges until you add another reviewer):
  ```bash
  gh api -X PATCH repos/tomek-i/narrate-plugin/branches/main/protection/required_pull_request_reviews -F required_approving_review_count=1
  ```
- **Require Code Owner review** (uses `.github/CODEOWNERS`):
  ```bash
  gh api -X PATCH repos/tomek-i/narrate-plugin/branches/main/protection/required_pull_request_reviews -F require_code_owner_reviews=true
  ```

UI equivalent: **Settings → Branches → Branch protection rules → `main` → Edit**.

---

## 2. Require CI to pass before merge

The CI workflow (`.github/workflows/ci.yml`) runs typecheck, lint, tests, build,
and a stale-bundle guard on every PR. Make it a **required** check so red CI
blocks merging.

> Do this *after* the workflow has run at least once (open the first PR, or push
> the `.github` files), so GitHub knows the check name (`check`).

```bash
gh api -X PATCH repos/tomek-i/narrate-plugin/branches/main/protection/required_status_checks \
  -F strict=true -f 'contexts[]=check'
```

- `strict=true` = branch must be up to date with `main` before merging.
- If the context name differs, list available ones from a recent commit:
  ```bash
  gh api repos/tomek-i/narrate-plugin/commits/main/status | jq '.statuses[].context'
  ```

UI: **Settings → Branches → `main` → Require status checks to pass → search "check"**.

---

## 3. Secret scanning & push protection  ✅

Enabled. Push protection rejects pushes that contain known secret formats
(API keys, tokens). Nothing else to do; to review alerts: **Security → Secret
scanning alerts**.

Re-apply if ever needed:

```bash
echo '{ "security_and_analysis": { "secret_scanning": { "status": "enabled" }, "secret_scanning_push_protection": { "status": "enabled" } } }' \
  | gh api -X PATCH repos/tomek-i/narrate-plugin --input -
```

Keep TTS keys in `.env.narrate` (gitignored) — never commit real keys.

---

## 4. Dependabot

- ✅ **Alerts** and **automated security fixes** are enabled (security PRs open
  automatically for vulnerable deps).
- 🔲 **Version updates** come from the committed `.github/dependabot.yml` (weekly
  npm + GitHub Actions update PRs) — active once that file lands on `main` (§6).

Review alerts: **Security → Dependabot**.

---

## 5. GitHub Actions hardening

- ✅ Default workflow token is **read-only** (`default_workflow_permissions=read`);
  workflows opt into more via a `permissions:` block (CI already does this).
- 🔲 **Fork PR approval** (recommended for public repos): require approval before
  workflows run on PRs from first-time / all external contributors.
  UI: **Settings → Actions → General → Fork pull request workflows →
  "Require approval for all external contributors"**.
- 🔲 Optionally restrict which actions can run to
  **"Allow actions created by GitHub + verified creators"** in the same screen.

---

## 6. Push the repository files

These were added to the working tree and need to reach `main`:

```
.github/workflows/ci.yml          # CI: typecheck, lint, test, build, stale-bundle guard
.github/dependabot.yml            # weekly dependency + actions update PRs
.github/pull_request_template.md  # PR checklist
.github/CODEOWNERS                # @tomek-i owns everything
SECURITY.md                       # vulnerability reporting policy
```

Recommended (dogfood the PR flow):

```bash
git checkout -b chore/repo-hardening
git push -u origin chore/repo-hardening
gh pr create --fill --base main
# review CI, then:
gh pr merge --squash --delete-branch
```

(You can still `git push origin main` directly because admin bypass is on, but
using a PR validates CI and the protection rules.)

---

## 7. Account & repo hygiene

- 🔲 **Enable 2FA** on your GitHub account: **Settings (account) → Password and
  authentication → Two-factor authentication**. Single most important account
  protection.
- 🔲 **Squash-only merges** (clean linear history). UI: **Settings → General →
  Pull Requests** → tick only *Allow squash merging*. Or:
  ```bash
  echo '{ "allow_merge_commit": false, "allow_rebase_merge": false, "allow_squash_merge": true }' \
    | gh api -X PATCH repos/tomek-i/narrate-plugin --input -
  ```
- 🔲 Turn off unused features (**Settings → General → Features**): Wiki, Projects
  if you won't use them — smaller surface.
- 🔲 Consider enabling **Private vulnerability reporting**: **Settings → Security →
  Private vulnerability reporting** (pairs with `SECURITY.md`).
- 🔲 Optional: **require signed commits** on `main`
  (`gh api -X POST repos/tomek-i/narrate-plugin/branches/main/protection/required_signatures`).
  Only if you have commit signing set up, or it will block your own pushes.
- 🔲 Optional: **tag protection** for release tags (e.g. `v*`) under
  **Settings → Tags**, so releases can't be force-moved.

---

## Quick audit command

```bash
gh api repos/tomek-i/narrate-plugin --jq '{visibility,delete_branch_on_merge,security:.security_and_analysis}'
gh api repos/tomek-i/narrate-plugin/branches/main/protection --jq '{pr:.required_pull_request_reviews.required_approving_review_count,admins:.enforce_admins.enabled,checks:.required_status_checks}'
```
