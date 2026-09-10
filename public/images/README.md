# Marketing images

Drop the real photos in here at these exact paths (any landscape photo works —
each is `object-fit: cover`'d into its frame). Replacing a file with a real
photo and removing the `placeholder` prop on its `<Figure>` in
`app/(marketing)/page.tsx` clears the "Photo placeholder" tag.

The files currently in this folder are tiny brand-tinted **placeholders** so the
layout renders before the real photos exist.

| File | Where it appears | Suggested source (from the brief) | Aspect used |
|------|------------------|-----------------------------------|-------------|
| `teacher-overwhelmed.png` | Story band, right under the hero — the emotional hook | The stressed teacher at a desk buried in stacks of paper | 16:9 (16:9→4:3 on mobile) |
| `scanning-worksheet.png` | Lead image of the "How it works" section | The teacher photographing a worksheet with a phone | ~16:8 banner |
| `one-on-one.png` | Testimonials band | The teacher working one-on-one with a student | fills card |
| `marking-work.png` | Testimonials band | The "Character and Setting" rubric / handwritten margin feedback | fills card |

Notes
- If your real photos are `.jpg`, either export them as `.png` with the names
  above, or keep the `.jpg` name and update the `src` in the four `<Figure>`
  calls in `app/(marketing)/page.tsx` — that's the only edit needed.
- Recommended real dimensions: overwhelmed ~1600×900, scanning ~1600×850,
  the two testimonial photos ~1200×900. Larger is fine; they're responsive.
- Images are lazy-loaded via `next/image` with real `alt` text already written.
