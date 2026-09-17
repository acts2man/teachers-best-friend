# URL parameters are copied into state through an effect

## What the pattern looks like

Eight screens read `useSearchParams()` inside an effect and copy the result
into `useState`:

```tsx
const [selected, setSelected] = useState<string | null>(null);
useEffect(() => {
  setSelected(params.get("id"));
  setTab(params.get("tab") || "questions");
}, [params]);
```

`react-hooks/set-state-in-effect` flags every one of them, and it is right to.
The URL is already state; copying it into `useState` means the component
renders once with the **previous** value and then re-renders with the new one.
That is the shape of "it showed the wrong thing for a moment" — the assessment
list briefly showing the previously selected assessment after a navigation, the
scan screen briefly pointing at the previous student.

## Where it is

| File | Line | Parameters copied |
|---|---|---|
| `components/teacher-assessments.tsx` | ~107 | `id`, `tab` |
| `components/teacher-scan.tsx` | ~87 | `assessment`, `student` |
| `components/teacher-scan.tsx` | ~104 | the assessment being edited → form fields |
| `components/teacher-review.tsx` | ~62 | `student` |
| `components/teacher-insights.tsx` | ~491 | `standard` |
| `components/teacher-insights.tsx` | ~1096 | `id`, `standard` |
| `components/teacher-insights.tsx` | ~1101 | selected student → `note` |
| `components/teacher-planning.tsx` | ~250 | `lesson`, `standard` → form fields |
| `components/teacher-planning.tsx` | ~1197 | `assessment` |
| `components/teacher-planning.tsx` | ~1632 | `category`, `standard` |
| `components/teacher-planning.tsx` | ~1957 | `w.settings` → form fields |
| `components/teacher-answer-key.tsx` | ~41 | assessment questions → `answers` |
| `app/login/page.tsx` | ~38 | `window.location.search` → admin variant |

## The fix

All of them share one semantic: **the URL seeds the value, the user can
override it, and the override expires the moment the URL changes.** That is
derivable without an effect, and `components/teacher-app.tsx` already does it
for the sidebar's optimistic highlight:

```tsx
const [override, setOverride] = useState<{ from: string; to: string } | null>(null);
const shownView = override && override.from === view ? override.to : view;
```

Applied to a parameter:

```tsx
const fromUrl = params.get("id");
const [override, setOverride] = useState<{ for: string | null; value: string | null } | null>(null);
const selected = override && override.for === fromUrl ? override.value : fromUrl;
// setSelected(v)  ->  setOverride({ for: fromUrl, value: v })
```

This is behaviour-preserving: when the parameter changes the override no longer
matches and the URL wins, exactly as the effect did; when the user picks
something it sticks until the URL changes, exactly as before. It removes the
extra render and the stale first frame.

The last three rows in the table are a different shape — entity → form state,
where React's documented answer is a `key` on the component so it remounts with
fresh initial state, rather than an override.

## Why it has not been done yet

Each site has its own fallback logic (`teacher-scan` falls back to "the first
assessment that is ready to grade", `teacher-planning` to "the first assessment
with needs"), so this is eight individually-reasoned changes across the entire
teacher workflow — assessments, scanning, review, insights and planning.

It wants a browser to verify against, which the environment these were written
in does not have. Doing it blind risks breaking the core flow in exchange for
removing a lint error, which is a bad trade. The rule is set to `warn` for these
files in `eslint.config.mjs` so the finding stays visible without masking new
violations elsewhere; it should go back to `error` as each file is converted.
