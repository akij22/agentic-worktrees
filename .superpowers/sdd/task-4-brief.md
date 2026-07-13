### Task 4: Verify the feature

**Files:**

- No source changes expected.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run static and production verification**

Run: `npm run typecheck && npm run package`

Expected: both commands exit with status 0.

- [ ] **Step 3: Review the diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors or unintentional files.
