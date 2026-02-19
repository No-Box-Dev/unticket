# Test Suite Plan

## Setup
1. Install Vitest + React Testing Library + jsdom
2. Create `vitest.config.ts` with `@` alias matching vite config
3. Create `src/test/setup.ts` with testing-library matchers
4. Add `"test"` script to package.json

## Test Files (14 files, ~200 tests)

### 1. `src/lib/__tests__/metrics.test.ts` — Pure metric functions
- `computeMetric`: weekly bucketing, current/previous/change calculation, empty input
- `computeCumulativeMetric`: snapshot-based metrics, sorting
- `extractMergedDates` / `extractClosedDates` / `extractCreatedDates`: null handling, filtering
- `buildOpenIssueSnapshots`: open issue counting with created/closed dates

### 2. `src/lib/__tests__/cn.test.ts` — Class name utility
- Merging Tailwind classes, conditional classes, falsy values

### 3. `src/lib/__tests__/config-repo.test.ts` — Config repo operations
- `fetchSprint/Features/People/Settings`: mock Octokit, test JSON parsing, 404 handling
- `putFileContent`: SHA caching, base64 encoding
- `fetchSettings`: backward compat normalization (repos[] added if missing)

### 4. `src/hooks/__tests__/useGitHub.test.ts` — GitHub data hooks
- `useOpenIssues`: verify `.repo` field is added to each issue
- `useClosedIssues` / `useAllIssues` / `useMergedPRs`: same `.repo` mapping
- `safeMap`: skips errored repos, flattens results

### 5. `src/components/sprint/__tests__/PriorityTag.test.tsx`
- Renders correct flag color per priority level
- Click cycles none → low → medium → high → none
- Fill attribute toggles correctly

### 6. `src/components/sprint/__tests__/EffortTag.test.tsx`
- Renders correct label/color per effort level
- Click cycles medium → low → high → medium

### 7. `src/components/sprint/__tests__/AddFeatureInput.test.tsx`
- Shows "Add Feature" button initially
- Click reveals input field
- Enter submits, Escape cancels
- Empty input doesn't submit

### 8. `src/components/sprint/__tests__/AssignDropdown.test.tsx`
- Shows "+ Assign" when empty, shows names when populated
- Click toggles dropdown, checkbox toggles person
- Outside click closes dropdown

### 9. `src/components/sprint/__tests__/FeatureCard.test.tsx`
- Renders title, status dot color, effort/priority tags
- Title click calls onOpenDetail
- "Done" button calls onUpdate with status "done"
- "Delete" calls onDelete
- Sprint vs backlog mode shows different actions

### 10. `src/components/sprint/__tests__/SprintIssuesTable.test.tsx`
- Loading state shows spinner text
- Empty state message
- Renders open + closed sections with separator
- Issue row shows repo, assignee, age

### 11. `src/components/__tests__/Sparkline.test.tsx`
- Returns null for < 2 data points
- Renders SVG polyline + polygon
- Labels rendered when prop is true

### 12. `src/components/__tests__/MetricCard.test.tsx`
- Displays current value and title
- Positive change shows TrendingUp, negative shows TrendingDown
- Zero change shows "No change"
- invertTrend flips color logic

### 13. `src/components/sprint/__tests__/FeatureDetailModal.test.tsx`
- Renders feature title, team dropdown, priority/effort tags
- Text input debounces save (500ms)
- Discrete change saves immediately
- Close flushes pending save
- Add/remove spec works
- Backdrop click closes modal

### 14. `src/components/settings/__tests__/TeamManagement.test.tsx`
- Add team with name + color
- Edit team name/color/repos
- Delete team with confirmation
- Duplicate name rejected
- Repo assignment checkbox toggles
- Repos assigned to other teams shown as disabled

## Approach
- Mock `@/lib/github` (Octokit) at module level for hook/config tests
- Wrap component tests in QueryClientProvider where hooks are used
- Use `vi.useFakeTimers()` for debounce tests in FeatureDetailModal
- Use `@testing-library/user-event` for realistic user interactions
