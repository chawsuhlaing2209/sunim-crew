# Install and test the crew against a design system

The crew is its own repo. It builds into whatever design system repo you point it at. Test it two ways.

## What the crew reads

One config value, `project_path`: the local path of the design system repo the crew works in. Change that one value to switch targets. Nothing about a specific design system lives in the crew's code.

## Test A — a fresh design system

1. Create an empty repo, `sunim-design-system`, and clone it locally.
2. Set `project_path` to that repo.
3. Add a component request, for example Button. It becomes a `to_do`.
4. Run `npm run sweep`.
5. Expect: the crew builds Button from scratch and commits it in `sunim-design-system`. The crew repo stays untouched.

## Test B — an existing design system

1. Set `project_path` to your Productive Schedule repo, which already has components.
2. Add a request to add or improve one component. It becomes a `to_do`.
3. Run `npm run sweep`.
4. Expect: the crew reads the existing components, matches their conventions, builds the new one, and commits it there.

Note: pointing the crew at an existing repo and building into it works now. The Auditor, which reads an existing repo or a Figma file and pulls out its tokens and a component list for you, is Step 9. The full "audit an existing product" flow lands then.

## The rule this proves

If both tests build into the target repo and never touch the crew repo, the crew is truly installable. If something only works because a design-system detail leaked into the crew's code, you find it here, while it is cheap to fix.
